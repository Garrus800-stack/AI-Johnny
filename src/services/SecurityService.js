/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  JOHNNY SECURITY SERVICE v1.0                                            ║
 * ║                                                                          ║
 * ║  Schützt gegen:                                                          ║
 * ║  1. Prompt Injection — bösartige Anweisungen in externen Inhalten       ║
 * ║  2. Gefährliche Systembefehle — Denylist + Pflicht-Bestätigung          ║
 * ║  3. Unsichere Dateipfade — Path Traversal Schutz                        ║
 * ║  4. Unkontrollierte Tool-Nutzung — Confirmation Gate                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

const EventBus = require('../core/EventBus');

// ── Prompt Injection Patterns ─────────────────────────────────────────────────
// Erkennt typische Angriffsmuster in Webinhalten, Dateien, E-Mails etc.
const INJECTION_PATTERNS = [
  // Direkte Rollenübernahme
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)/i,
  /vergiss?\s+(alle?\s+)?(vorherigen?|bisherigen?)\s+(anweisungen?|regeln?|instruktionen?)/i,
  /disregard\s+(all\s+)?(previous|prior)\s+(instructions?|rules?)/i,
  // System-Override
  /\[SYSTEM\s*:?\s*(override|ignore|new instructions?|neue anweisung)\]/i,
  /<<\s*SYSTEM\s*>>/i,
  /\bDAN\b.*jailbreak/i,
  /you\s+are\s+now\s+(a\s+)?(different|new|another)\s+(AI|assistant|model)/i,
  /du\s+bist\s+jetzt\s+(ein\s+)?(anderer|neuer|anderes)\s+(KI|Assistent|Modell)/i,
  // Rollenspiel-Injections
  /act\s+as\s+(if\s+you\s+(are|were)\s+)?(a\s+)?(different|unrestricted|evil|harmful)/i,
  /pretend\s+(you\s+are|to\s+be)\s+.{0,40}(no\s+restrictions|without\s+limits)/i,
  // Instruktionstrenner
  /---+\s*(new\s+task|neue\s+aufgabe|override|system)/i,
  /={3,}\s*(instructions?|anweisungen?|system)/i,
  // Exfiltrations-Versuche
  /repeat\s+(after\s+me|this)\s*:?\s*(your\s+)?(system\s+prompt|instructions?)/i,
  /print\s+(your\s+)?(full\s+)?(system\s+prompt|instructions?)/i,
  /zeig?\s+(mir\s+)?(deinen?\s+)?(system\s+prompt|deine\s+anweisungen?)/i,
  // Klassische Jailbreaks
  /do\s+anything\s+now/i,
  /developer\s+mode\s+enabled/i,
  /\[jailbreak\]/i,
  /sudo\s+mode/i,
];

// ── Gefährliche Befehls-Muster (Denylist) ────────────────────────────────────
const DANGEROUS_COMMAND_PATTERNS = [
  // Dateisystem-Zerstörung
  { pattern: /rm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+[/~]/, label: 'Rekursives Löschen des Root/Home-Verzeichnisses' },
  { pattern: /rm\s+-rf\s*\//, label: 'Löschen des Root-Dateisystems' },
  { pattern: /mkfs\.|format\s+[a-z]:/i, label: 'Festplattenformatierung' },
  { pattern: /dd\s+if=.*of=\/dev\/(s|h|nv)d/i, label: 'Direktes Überschreiben einer Festplatte' },
  // System-Shutdown
  { pattern: /shutdown|reboot|init\s+0|poweroff/i, label: 'System-Shutdown/Neustart' },
  // Netzwerk-Backdoors
  { pattern: /nc\s+(-[a-z]*l[a-z]*|--listen)/, label: 'Netcat-Listener (Backdoor)' },
  { pattern: /ncat\s+.*--listen/, label: 'Ncat-Listener (Backdoor)' },
  { pattern: /curl\s+.*\|\s*(bash|sh|python|perl)/i, label: 'Remote-Script ausführen (curl | bash)' },
  { pattern: /wget\s+.*-O\s*-.*\|\s*(bash|sh)/i, label: 'Remote-Script ausführen (wget | bash)' },
  // Passwort/Credential-Zugriff
  { pattern: /\/etc\/shadow/, label: 'Zugriff auf Shadow-Password-Datei' },
  { pattern: /cat\s+.*\.(env|pem|key|p12|pfx)$/i, label: 'Lesen von Credential-Dateien' },
  // Registry-Zerstörung (Windows)
  { pattern: /reg\s+(delete|add)\s+hklm/i, label: 'Windows Registry löschen/ändern' },
  // Cronjob/Autostart-Manipulation
  { pattern: /crontab\s+-r/, label: 'Alle Cronjobs löschen' },
  { pattern: />\s*\/etc\/crontab/, label: 'Crontab überschreiben' },
  // Package-Manipulation
  { pattern: /npm\s+(uninstall|remove)\s+.*--global/i, label: 'Globale NPM-Pakete deinstallieren' },
];

// ── Kritische Tools die Bestätigung brauchen ─────────────────────────────────
const TOOLS_REQUIRING_CONFIRMATION = new Set([
  'execute_command',
  'write_file',
  'install_software',
  'extend_code',
  'create_tool',
  'modify_config',
  'delete_file',
]);

// ── Path Traversal Schutz ────────────────────────────────────────────────────
const PATH_TRAVERSAL_PATTERN = /\.\.[/\\]/;
const PROTECTED_PATHS = [
  '/etc/passwd', '/etc/shadow', '/etc/hosts',
  'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64',
  '.env', '.env.local', '.env.production', '.env.secret',
];

class SecurityService {
  constructor(config = {}) {
    // Verbindung zum Electron-IPC für Bestätigungs-Dialoge
    this.mainWindow       = config.mainWindow || null;
    this.store            = config.store || null;
    // Statistiken
    this._stats = {
      injectionBlocked:  0,
      commandBlocked:    0,
      confirmRequested:  0,
      confirmApproved:   0,
      confirmDenied:     0,
    };
    // Pending-Confirmations: id → { resolve, reject, timeout }
    this._pendingConfirms = new Map();
    this._confirmCounter  = 0;

    // Einstellungen (aus Store laden)
    this._settings = {
      confirmEnabled:    config.confirmEnabled  ?? true,
      injectionEnabled:  config.injectionEnabled ?? true,
      commandFilterEnabled: config.commandFilterEnabled ?? true,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. PROMPT INJECTION SCANNER
  // Scannt externe Inhalte (Webseiten, Dateien, E-Mails) auf Injection-Versuche
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Prüft ob ein Text Prompt-Injection-Muster enthält.
   * @param {string} text — zu prüfender Text (z.B. Webseiten-Inhalt, Datei-Inhalt)
   * @param {string} source — Herkunft (z.B. 'web_fetch', 'read_file', 'telegram')
   * @returns {{ safe: boolean, threats: string[], sanitized: string }}
   */
  scanForInjection(text, source = 'unknown') {
    if (!this._settings.injectionEnabled) return { safe: true, threats: [], sanitized: text };
    if (!text || typeof text !== 'string') return { safe: true, threats: [], sanitized: text };

    const threats = [];
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        threats.push(pattern.source);
      }
    }

    if (threats.length > 0) {
      this._stats.injectionBlocked++;
      const warningCount = (text.match(/\n/g) || []).length;
      console.warn(`[Security] ⚠️  Prompt Injection erkannt in "${source}" (${threats.length} Pattern)`);
      EventBus.emit('security:injection-detected', { source, threatCount: threats.length });

      // Sanitize: gefährliche Abschnitte in eckige Klammern einschließen
      let sanitized = text;
      for (const pattern of INJECTION_PATTERNS) {
        sanitized = sanitized.replace(pattern, (match) =>
          `[SICHERHEITSFILTER: verdächtiger Inhalt entfernt (${match.slice(0, 30)}...)]`
        );
      }
      return { safe: false, threats, sanitized };
    }

    return { safe: true, threats: [], sanitized: text };
  }

  /**
   * Wrap für Tool-Ergebnisse aus externen Quellen.
   * Fügt automatisch eine Warnung an den Kontext an, wenn Injection erkannt wurde.
   */
  wrapExternalContent(content, source) {
    const result = this.scanForInjection(content, source);
    if (!result.safe) {
      return `[⚠️ SICHERHEITSWARNUNG: Dieser Inhalt von "${source}" enthält verdächtige Anweisungen die herausgefiltert wurden.]\n\n${result.sanitized}`;
    }
    return content;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. COMMAND FILTER — Denylist für gefährliche Befehle
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Prüft ob ein Shell-Befehl sicher ausgeführt werden darf.
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkCommand(command) {
    if (!this._settings.commandFilterEnabled) return { allowed: true };
    if (!command || typeof command !== 'string') return { allowed: false, reason: 'Leerer Befehl' };

    for (const { pattern, label } of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        this._stats.commandBlocked++;
        console.warn(`[Security] 🚫 Gefährlicher Befehl blockiert: "${label}" | CMD: ${command.slice(0, 80)}`);
        EventBus.emit('security:command-blocked', { command: command.slice(0, 80), label });
        return { allowed: false, reason: `Gefährlicher Befehl erkannt: ${label}` };
      }
    }

    return { allowed: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. PATH TRAVERSAL SCHUTZ
  // ══════════════════════════════════════════════════════════════════════════

  checkPath(filePath) {
    if (!filePath) return { allowed: false, reason: 'Kein Pfad angegeben' };

    if (PATH_TRAVERSAL_PATTERN.test(filePath)) {
      console.warn(`[Security] 🚫 Path Traversal erkannt: ${filePath}`);
      return { allowed: false, reason: 'Path Traversal (../) erkannt' };
    }

    for (const blocked of PROTECTED_PATHS) {
      if (filePath.toLowerCase().includes(blocked.toLowerCase())) {
        console.warn(`[Security] 🚫 Zugriff auf geschützten Pfad verweigert: ${filePath}`);
        return { allowed: false, reason: `Zugriff auf geschützten Pfad nicht erlaubt: ${blocked}` };
      }
    }

    return { allowed: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. CONFIRMATION GATE — kritische Tools brauchen User-Bestätigung
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Prüft ob ein Tool eine Bestätigung benötigt.
   * Zeigt einen Dialog im Frontend und wartet auf User-Antwort.
   * @returns {Promise<{ approved: boolean }>}
   */
  async requestConfirmation(toolName, params, agentName = 'Johnny') {
    if (!this._settings.confirmEnabled) return { approved: true };
    if (!TOOLS_REQUIRING_CONFIRMATION.has(toolName)) return { approved: true };

    // Kurze Beschreibung der Aktion für den Dialog
    const description = this._buildActionDescription(toolName, params);
    const confirmId   = `confirm_${++this._confirmCounter}`;

    this._stats.confirmRequested++;

    // Zeige Dialog im Frontend
    if (this.mainWindow?.webContents) {
      this.mainWindow.webContents.send('security:confirm-request', {
        id:          confirmId,
        toolName,
        agentName,
        description,
        params:      this._sanitizeParamsForDisplay(toolName, params),
        timestamp:   new Date().toISOString(),
      });
    } else {
      // Kein Fenster vorhanden → auto-approve (z.B. Headless/Docker)
      console.warn(`[Security] ⚠️ Kein Fenster für Bestätigung — auto-approve: ${toolName}`);
      return { approved: true };
    }

    // Warte auf Antwort (Timeout: 60 Sekunden)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._pendingConfirms.delete(confirmId);
        console.warn(`[Security] ⏱️ Bestätigungs-Timeout für: ${toolName} — abgebrochen`);
        resolve({ approved: false, reason: 'Timeout — keine Antwort in 60 Sekunden' });
      }, 60000);

      this._pendingConfirms.set(confirmId, { resolve, timeout });
    });
  }

  /**
   * Wird vom IPC-Handler aufgerufen wenn der User auf "Ja"/"Nein" klickt.
   */
  handleConfirmResponse(confirmId, approved) {
    const pending = this._pendingConfirms.get(confirmId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this._pendingConfirms.delete(confirmId);

    if (approved) {
      this._stats.confirmApproved++;
    } else {
      this._stats.confirmDenied++;
    }

    pending.resolve({ approved });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HILFSMETHODEN
  // ══════════════════════════════════════════════════════════════════════════

  _buildActionDescription(toolName, params) {
    switch (toolName) {
      case 'execute_command':
        return `Befehl ausführen: \`${(params.command || '').slice(0, 120)}\``;
      case 'write_file':
        return `Datei schreiben: \`${params.path || '?'}\` (${(params.content || '').length} Zeichen)`;
      case 'install_software':
        return `Software installieren: ${params.type || ''} \`${params.package || ''}\``;
      case 'extend_code':
        return `Code-Datei ändern: \`${params.filepath || '?'}\``;
      case 'create_tool':
        return `Neues Tool erstellen: \`${params.name || '?'}\``;
      case 'modify_config':
        return `Konfiguration ändern: \`${params.key}\` = \`${JSON.stringify(params.value).slice(0, 60)}\``;
      case 'delete_file':
        return `Datei löschen: \`${params.path || '?'}\``;
      default:
        return `Tool ausführen: ${toolName}`;
    }
  }

  _sanitizeParamsForDisplay(toolName, params) {
    // Zeigt Parameter im Dialog, aber kürzt langen Code/Content ab
    const safe = { ...params };
    if (safe.content && safe.content.length > 300) {
      safe.content = safe.content.slice(0, 300) + `\n... (${safe.content.length - 300} weitere Zeichen)`;
    }
    if (safe.code && safe.code.length > 300) {
      safe.code = safe.code.slice(0, 300) + `\n... (${safe.code.length - 300} weitere Zeichen)`;
    }
    return safe;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EINSTELLUNGEN & STATISTIKEN
  // ══════════════════════════════════════════════════════════════════════════

  getSettings() {
    return { ...this._settings };
  }

  updateSettings(newSettings) {
    Object.assign(this._settings, newSettings);
    if (this.store) {
      this.store.set('security.settings', this._settings);
    }
    console.log('[Security] Einstellungen aktualisiert:', this._settings);
  }

  getStats() {
    return { ...this._stats };
  }

  resetStats() {
    Object.keys(this._stats).forEach(k => {
      if (typeof this._stats[k] === 'number') this._stats[k] = 0;
    });
    return this.getStats();
  }

  initialize() {
    // Einstellungen aus Store laden falls vorhanden
    if (this.store) {
      const saved = this.store.get('security.settings');
      if (saved) Object.assign(this._settings, saved);
    }
    console.log('[Security] Service bereit');
    console.log(`[Security]   Injection-Schutz: ${this._settings.injectionEnabled ? '✓' : '✗'}`);
    console.log(`[Security]   Command-Filter:   ${this._settings.commandFilterEnabled ? '✓' : '✗'}`);
    console.log(`[Security]   Confirm-Gate:     ${this._settings.confirmEnabled ? '✓' : '✗'}`);
  }
}

module.exports = SecurityService;
