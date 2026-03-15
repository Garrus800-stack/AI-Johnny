/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ERROR ANALYSIS SERVICE v1.0                                         ║
 * ║                                                                      ║
 * ║  Fehlerprotokollierung & -analyse für Johnny:                       ║
 * ║  - Strukturierte Fehlererfassung mit Kontext                        ║
 * ║  - Muster-Erkennung (wiederkehrende Fehler)                         ║
 * ║  - Root-Cause-Kategorisierung                                       ║
 * ║  - Automatische Fix-Vorschläge                                      ║
 * ║  - Fehler-Dashboard-Daten                                           ║
 * ║  - Integration mit SelfImprovementService                           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs').promises;
const path = require('path');
const os   = require('os');

const MAX_ERROR_LOG  = 2000;
const PATTERN_WINDOW = 50;    // Letzte N Fehler für Muster-Analyse
const MAX_FIX_SUGGESTIONS = 100;

// ── Fehler-Kategorien ──────────────────────────────────────────────────
const ERROR_CATEGORIES = {
  TOOL_EXECUTION:  { severity: 'medium', autoRetry: true,  description: 'Tool-Ausführungsfehler' },
  LLM_API:         { severity: 'high',   autoRetry: true,  description: 'LLM API-Fehler (Timeout, Rate-Limit, etc.)' },
  PARSE_ERROR:     { severity: 'low',    autoRetry: false, description: 'JSON/Daten-Parsing-Fehler' },
  FILE_SYSTEM:     { severity: 'medium', autoRetry: true,  description: 'Dateisystem-Fehler' },
  NETWORK:         { severity: 'high',   autoRetry: true,  description: 'Netzwerk-/Verbindungsfehler' },
  PERMISSION:      { severity: 'high',   autoRetry: false, description: 'Berechtigungsfehler' },
  VALIDATION:      { severity: 'low',    autoRetry: false, description: 'Eingabe-Validierungsfehler' },
  INTERNAL:        { severity: 'high',   autoRetry: false, description: 'Interner Johnny-Fehler' },
  USER_INPUT:      { severity: 'low',    autoRetry: false, description: 'Ungültige User-Eingabe' },
  TIMEOUT:         { severity: 'medium', autoRetry: true,  description: 'Timeout-Fehler' },
  DEPENDENCY:      { severity: 'high',   autoRetry: false, description: 'Fehlende Abhängigkeit' },
  UNKNOWN:         { severity: 'medium', autoRetry: false, description: 'Unbekannter Fehler' },
};

class ErrorAnalysisService {
  constructor(config = {}) {
    this.dataDir          = config.dataDir || path.join(os.homedir(), '.johnny', 'errors');
    this.agentManager     = config.agentManager;
    this.selfImprovement  = config.selfImprovement;
    this.gateway          = config.gateway;

    this.errorLog         = [];
    this.patterns         = new Map();     // pattern_key → { count, lastSeen, suggestion }
    this.fixSuggestions   = [];
    this.sessionErrors    = [];            // Fehler der aktuellen Session
    this._errorIndex      = new Map();     // category → [errorIds]
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this._loadErrorLog();
    await this._loadPatterns();
    this._detectPatterns();
    console.log(`[ErrorAnalysis] ${this.errorLog.length} Fehler geladen, ${this.patterns.size} Muster erkannt`);
  }

  // ════════════════════════════════════════════════════════════════════
  // FEHLER ERFASSEN
  // ════════════════════════════════════════════════════════════════════

  /**
   * Protokolliert einen Fehler mit vollem Kontext
   */
  async logError(error, context = {}) {
    const entry = {
      id:        `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts:        new Date().toISOString(),
      category:  this._categorizeError(error, context),
      message:   error.message || String(error),
      stack:     error.stack?.split('\n').slice(0, 5).join('\n') || null,
      code:      error.code || null,
      context: {
        service:    context.service || 'unknown',
        method:     context.method || null,
        userAction: context.userAction || null,
        input:      context.input ? String(context.input).slice(0, 200) : null,
        toolName:   context.toolName || null,
        agentName:  context.agentName || null,
      },
      resolved:  false,
      resolution: null,
      retryable: false,
    };

    // Kategorie-Metadaten
    const catInfo = ERROR_CATEGORIES[entry.category] || ERROR_CATEGORIES.UNKNOWN;
    entry.severity = catInfo.severity;
    entry.retryable = catInfo.autoRetry;

    // Log speichern
    this.errorLog.push(entry);
    this.sessionErrors.push(entry);

    // Index aktualisieren
    if (!this._errorIndex.has(entry.category)) this._errorIndex.set(entry.category, []);
    this._errorIndex.get(entry.category).push(entry.id);

    // Pattern-Matching
    const pattern = this._matchPattern(entry);
    if (pattern) {
      entry.patternId = pattern.id;
      entry.knownIssue = true;
      if (pattern.suggestion) {
        entry.suggestedFix = pattern.suggestion;
      }
    }

    // Log-Größe begrenzen
    if (this.errorLog.length > MAX_ERROR_LOG) {
      this.errorLog = this.errorLog.slice(-MAX_ERROR_LOG * 0.8);
      this._rebuildIndex();
    }

    // Persistieren (debounced)
    this._scheduleSave();

    // Gateway-Event
    if (this.gateway) {
      this.gateway.publish('error.logged', {
        id: entry.id, category: entry.category, severity: entry.severity,
        message: entry.message.slice(0, 100),
      });
    }

    // Muster-Erkennung nach jedem 10. Fehler
    if (this.sessionErrors.length % 10 === 0) {
      this._detectPatterns();
    }

    return entry;
  }

  /**
   * Markiert einen Fehler als gelöst
   */
  resolveError(errorId, resolution) {
    const err = this.errorLog.find(e => e.id === errorId);
    if (err) {
      err.resolved = true;
      err.resolution = resolution;
      err.resolvedAt = new Date().toISOString();

      // Pattern-Suggestion aktualisieren wenn erfolgreich
      if (err.patternId) {
        const pattern = this.patterns.get(err.patternId);
        if (pattern) {
          pattern.successfulResolution = resolution;
          pattern.resolvedCount = (pattern.resolvedCount || 0) + 1;
        }
      }
    }
    return err;
  }

  // ════════════════════════════════════════════════════════════════════
  // FEHLER-KATEGORISIERUNG
  // ════════════════════════════════════════════════════════════════════

  _categorizeError(error, context) {
    const msg = (error.message || '').toLowerCase();
    const code = error.code || '';

    // Netzwerk
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|network/i.test(msg + code)) {
      return 'NETWORK';
    }

    // Timeout
    if (/timeout|ETIMEDOUT|timed out/i.test(msg)) return 'TIMEOUT';

    // API-Fehler
    if (/rate.?limit|429|503|api.?key|unauthorized|401|403/i.test(msg)) return 'LLM_API';
    if (context.service?.includes('ModelProvider') || context.service?.includes('Ollama')) return 'LLM_API';

    // Parse-Fehler
    if (/JSON|parse|syntax|unexpected token/i.test(msg)) return 'PARSE_ERROR';

    // Dateisystem
    if (/ENOENT|EACCES|EPERM|EISDIR|EEXIST|file|directory/i.test(msg + code)) {
      return /EACCES|EPERM/i.test(msg + code) ? 'PERMISSION' : 'FILE_SYSTEM';
    }

    // Abhängigkeiten
    if (/MODULE_NOT_FOUND|Cannot find module|not installed/i.test(msg)) return 'DEPENDENCY';

    // Tool-Fehler
    if (context.toolName || context.service?.includes('Tool') || context.service?.includes('Plugin')) {
      return 'TOOL_EXECUTION';
    }

    // Validierung
    if (/invalid|required|missing|expected/i.test(msg) && !context.service) return 'VALIDATION';

    // User-Input
    if (context.userAction) return 'USER_INPUT';

    return 'UNKNOWN';
  }

  // ════════════════════════════════════════════════════════════════════
  // MUSTER-ERKENNUNG
  // ════════════════════════════════════════════════════════════════════

  _detectPatterns() {
    const recent = this.errorLog.slice(-PATTERN_WINDOW);
    if (recent.length < 3) return;

    // Gruppiere nach Kategorie + Service + ähnlicher Nachricht
    const groups = new Map();

    for (const err of recent) {
      // Normalisierte Schlüssel-Generierung
      const normalizedMsg = err.message
        .replace(/\d+/g, 'N')
        .replace(/[a-f0-9]{8,}/gi, 'HASH')
        .replace(/\/[^\s]+/g, '/PATH')
        .slice(0, 100);

      const key = `${err.category}:${err.context.service}:${normalizedMsg}`;

      if (!groups.has(key)) {
        groups.set(key, { errors: [], key, category: err.category, normalizedMsg });
      }
      groups.get(key).errors.push(err);
    }

    // Muster erkennen (mind. 3 Wiederholungen)
    for (const [key, group] of groups) {
      if (group.errors.length >= 3) {
        const patternId = `pat_${key.slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_')}`;

        if (!this.patterns.has(patternId)) {
          this.patterns.set(patternId, {
            id: patternId,
            category: group.category,
            normalizedMessage: group.normalizedMsg,
            service: group.errors[0].context.service,
            count: group.errors.length,
            firstSeen: group.errors[0].ts,
            lastSeen: group.errors[group.errors.length - 1].ts,
            suggestion: this._generateFixSuggestion(group),
            resolvedCount: 0,
            successfulResolution: null,
          });
        } else {
          const existing = this.patterns.get(patternId);
          existing.count = group.errors.length;
          existing.lastSeen = group.errors[group.errors.length - 1].ts;
        }
      }
    }

    this._schedulePatternSave();
  }

  _matchPattern(error) {
    const normalizedMsg = error.message
      .replace(/\d+/g, 'N')
      .replace(/[a-f0-9]{8,}/gi, 'HASH')
      .replace(/\/[^\s]+/g, '/PATH')
      .slice(0, 100);

    for (const [, pattern] of this.patterns) {
      if (pattern.category === error.category &&
          pattern.service === error.context.service &&
          this._stringSimilarity(pattern.normalizedMessage, normalizedMsg) > 0.7) {
        return pattern;
      }
    }
    return null;
  }

  _generateFixSuggestion(group) {
    const cat = group.category;
    const service = group.errors[0]?.context.service || '';

    const suggestions = {
      NETWORK:       'Netzwerkverbindung prüfen. Proxy-Einstellungen checken. DNS-Auflösung testen.',
      TIMEOUT:       `Timeout erhöhen oder Service ${service} neu starten. Möglicherweise überlastet.`,
      LLM_API:       'API-Key prüfen. Rate-Limits checken. Fallback-Provider konfigurieren.',
      PARSE_ERROR:   'JSON-Response-Format hat sich geändert. Parsing-Logik anpassen oder Fallback hinzufügen.',
      FILE_SYSTEM:   'Dateipfad und Berechtigungen prüfen. Verzeichnis existiert möglicherweise nicht.',
      PERMISSION:    'Berechtigungen der Datei/des Verzeichnisses prüfen. Ggf. mit Admin-Rechten ausführen.',
      TOOL_EXECUTION:`Tool "${group.errors[0]?.context.toolName || service}" liefert wiederholt Fehler. Parameter und Verfügbarkeit prüfen.`,
      DEPENDENCY:    'Fehlende Abhängigkeit installieren: npm install oder pip install.',
      VALIDATION:    'Eingabe-Validierung anpassen. Häufiges Pattern: fehlende Pflichtfelder.',
    };

    return suggestions[cat] || `Wiederkehrender Fehler in ${service}: ${group.normalizedMsg}. Manuelle Analyse empfohlen.`;
  }

  // ════════════════════════════════════════════════════════════════════
  // LLM-GESTÜTZTE ANALYSE
  // ════════════════════════════════════════════════════════════════════

  /**
   * Analysiert Fehlermuster mit LLM und generiert detaillierte Fix-Vorschläge
   */
  async analyzeWithLLM() {
    if (!this.agentManager) return { error: 'AgentManager nicht verfügbar' };
    if (this.sessionErrors.length < 3) return { note: 'Zu wenige Fehler für Analyse' };

    const errorSummary = this.getErrorSummary();
    const topPatterns = this.getTopPatterns(5);

    const prompt = `Analysiere diese Fehler-Statistiken von Johnny und gib konkrete Verbesserungsvorschläge:

ZUSAMMENFASSUNG:
${JSON.stringify(errorSummary, null, 2)}

TOP MUSTER:
${JSON.stringify(topPatterns, null, 2)}

LETZTE 10 FEHLER:
${JSON.stringify(this.sessionErrors.slice(-10).map(e => ({
  category: e.category, message: e.message.slice(0, 100), service: e.context.service
})), null, 2)}

Erstelle:
1. Root-Cause-Analyse (Was ist die Hauptursache?)
2. Prioritäten-Liste (Was zuerst fixen?)
3. Konkrete Code-Änderungen oder Konfigurationsvorschläge
4. Präventive Maßnahmen

Antworte als JSON: {"rootCauses":[{"cause":"...","affected":"...","priority":"hoch/mittel/niedrig"}],"fixes":[{"description":"...","effort":"klein/mittel/groß","impact":"hoch/mittel/niedrig"}],"prevention":["..."]}`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      const json = result.response.match(/\{[\s\S]*\}/);
      if (json) {
        const analysis = JSON.parse(json[0]);
        this.fixSuggestions.push({
          ts: new Date().toISOString(),
          ...analysis,
          errorCount: this.sessionErrors.length,
        });
        if (this.fixSuggestions.length > MAX_FIX_SUGGESTIONS) {
          this.fixSuggestions = this.fixSuggestions.slice(-MAX_FIX_SUGGESTIONS * 0.8);
        }
        return analysis;
      }
    } catch (e) {
      return { error: `LLM-Analyse fehlgeschlagen: ${e.message}` };
    }

    return { error: 'Keine verwertbare Antwort vom LLM' };
  }

  /**
   * Versucht automatischen Fix über SelfImprovementService
   */
  async autoFix(patternId) {
    if (!this.selfImprovement) return { error: 'SelfImprovementService nicht verfügbar' };

    const pattern = this.patterns.get(patternId);
    if (!pattern) return { error: `Pattern ${patternId} nicht gefunden` };
    if (!pattern.successfulResolution) return { error: 'Keine bekannte Lösung für dieses Pattern' };

    // Hier könnte SelfImprovementService.patchFile() aufgerufen werden
    return {
      pattern: patternId,
      suggestion: pattern.suggestion,
      knownFix: pattern.successfulResolution,
      note: 'Automatischer Fix muss manuell bestätigt werden.',
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // DASHBOARD / STATISTIKEN
  // ════════════════════════════════════════════════════════════════════

  getErrorSummary() {
    const byCategory = {};
    const bySeverity = { low: 0, medium: 0, high: 0 };
    const byService = {};
    let resolved = 0;

    for (const err of this.errorLog) {
      byCategory[err.category] = (byCategory[err.category] || 0) + 1;
      bySeverity[err.severity] = (bySeverity[err.severity] || 0) + 1;
      const svc = err.context.service || 'unknown';
      byService[svc] = (byService[svc] || 0) + 1;
      if (err.resolved) resolved++;
    }

    return {
      total: this.errorLog.length,
      resolved,
      unresolved: this.errorLog.length - resolved,
      byCategory,
      bySeverity,
      byService,
      patterns: this.patterns.size,
      sessionErrors: this.sessionErrors.length,
    };
  }

  getTopPatterns(limit = 10) {
    return [...this.patterns.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(p => ({
        id: p.id,
        category: p.category,
        service: p.service,
        count: p.count,
        lastSeen: p.lastSeen,
        suggestion: p.suggestion,
        resolved: p.resolvedCount > 0,
      }));
  }

  getRecentErrors(limit = 20) {
    return this.errorLog.slice(-limit).reverse().map(e => ({
      id: e.id,
      ts: e.ts,
      category: e.category,
      severity: e.severity,
      message: e.message.slice(0, 150),
      service: e.context.service,
      resolved: e.resolved,
      patternId: e.patternId || null,
    }));
  }

  getErrorsByCategory(category) {
    const ids = this._errorIndex.get(category) || [];
    return this.errorLog.filter(e => ids.includes(e.id));
  }

  // ════════════════════════════════════════════════════════════════════
  // HILFSMETHODEN
  // ════════════════════════════════════════════════════════════════════

  _stringSimilarity(a, b) {
    if (!a || !b) return 0;
    const sa = new Set(a.toLowerCase().split(/\s+/));
    const sb = new Set(b.toLowerCase().split(/\s+/));
    const inter = [...sa].filter(x => sb.has(x)).length;
    const union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  _rebuildIndex() {
    this._errorIndex.clear();
    for (const err of this.errorLog) {
      if (!this._errorIndex.has(err.category)) this._errorIndex.set(err.category, []);
      this._errorIndex.get(err.category).push(err.id);
    }
  }

  // ── Persistenz ───────────────────────────────────────────────────────

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(async () => {
      this._saveTimer = null;
      await this._saveErrorLog();
    }, 5000);
  }

  _schedulePatternSave() {
    if (this._patternTimer) return;
    this._patternTimer = setTimeout(async () => {
      this._patternTimer = null;
      await this._savePatterns();
    }, 10000);
  }

  async _loadErrorLog() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'errors.json'), 'utf-8');
      this.errorLog = JSON.parse(raw);
      this._rebuildIndex();
    } catch { this.errorLog = []; }
  }

  async _saveErrorLog() {
    const tmp = path.join(this.dataDir, 'errors.json.tmp');
    const final = path.join(this.dataDir, 'errors.json');
    try {
      await fs.writeFile(tmp, JSON.stringify(this.errorLog));
      await fs.rename(tmp, final);
    } catch (e) {
      console.error('[ErrorAnalysis] Fehler beim Speichern:', e.message);
    }
  }

  async _loadPatterns() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'patterns.json'), 'utf-8');
      const obj = JSON.parse(raw);
      this.patterns = new Map(Object.entries(obj));
    } catch { this.patterns = new Map(); }
  }

  async _savePatterns() {
    const obj = Object.fromEntries(this.patterns);
    const tmp = path.join(this.dataDir, 'patterns.json.tmp');
    const final = path.join(this.dataDir, 'patterns.json');
    try {
      await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
      await fs.rename(tmp, final);
    } catch (e) {
      console.error('[ErrorAnalysis] Pattern-Speicherung fehlgeschlagen:', e.message);
    }
  }
}

module.exports = ErrorAnalysisService;
