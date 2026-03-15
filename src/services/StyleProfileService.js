/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  STYLE PROFILE SERVICE v1.0  (Johnny v1.8)                         ║
 * ║                                                                      ║
 * ║  Persistente Stil-Profile in SQLite (via ConversationStore).        ║
 * ║  Erweitert JohnnyCore's bestehendes Style-System um:               ║
 * ║                                                                      ║
 * ║  - Automatische Stil-Erkennung aus Nutzertext                       ║
 * ║  - Persistenz zwischen Sessions (kein Verlust beim Neustart)        ║
 * ║  - Stil-Historie: "Wann wolltest du welchen Ton?"                   ║
 * ║  - Kontext-sensitiver Stil: Uhrzeit, Thema, Mood                   ║
 * ║  - Explizite Befehle: "Sei förmlicher", "Mehr Humor"               ║
 * ║  - Stil-Zusammenfassung für UI-Anzeige                              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// Mapping: Schlüsselwörter → Stil-Wert
const STYLE_SIGNALS = {
  formality: {
    formal: [
      'bitte', 'würden sie', 'könnten sie', 'sehr geehrte', 'mit freundlichen grüßen',
      'förmlich', 'sie-form', 'gesiezt', 'professionell schreiben', 'formell',
      'please could you', 'kindly', 'i would appreciate',
    ],
    casual: [
      'du', 'hey', 'hi', 'jo', 'moin', 'klar', 'cool', 'ok', 'naja', 'echt?',
      'locker', 'entspannt', 'chillig', 'kein stress', 'kein problem',
      'yo', 'hey man', 'sup', 'lol', 'haha',
    ],
  },
  humor: {
    high: [
      'haha', 'lol', 'xd', '😄', '😂', '🤣', 'witzig', 'lustig', 'fun',
      'humor', 'witz', 'joke', 'scherz', 'spaß', 'ironie',
    ],
    low: [
      'sachlich', 'nüchtern', 'ernst', 'professionell', 'kein spaß',
      'direkt', 'ohne floskeln', 'no jokes', 'serious',
    ],
  },
  emotion: {
    warm: ['danke', 'toll', 'super', 'klasse', 'wunderbar', 'großartig', 'schön', 'lieb',
           'freut mich', 'nice', 'great', 'awesome', 'love it'],
    serious: ['analytisch', 'präzise', 'exakt', 'wissenschaftlich', 'objektiv',
              'neutral', 'sachlich', 'ohne emotion'],
    playful: ['kreativ', 'fantasie', 'stell dir vor', 'was wäre wenn', 'spielerisch',
              'imagine', 'what if', 'creative', 'fun'],
  },
};

// Direkte Stil-Befehle die sofort greifen
const DIRECT_COMMANDS = [
  { pattern: /sei\s+(bitte\s+)?(mehr\s+)?(förmlich|formal|formell|professionell)/i, set: { formalityLevel: 'formal' } },
  { pattern: /sei\s+(bitte\s+)?(mehr\s+)?(locker|casual|entspannt|informell)/i,     set: { formalityLevel: 'casual' } },
  { pattern: /(mehr|mehr\s+)humor|sei\s+lustiger|sei\s+witzig/i,                    set: { humorLevel: 'high' } },
  { pattern: /kein\s+humor|sachlicher|weniger\s+witzig|ernster/i,                   set: { humorLevel: 'low' } },
  { pattern: /sei\s+(warm|herzlich|empathisch)/i,                                   set: { responseEmotion: 'warm' } },
  { pattern: /sei\s+(ernst|seriös|professionell)/i,                                 set: { responseEmotion: 'serious' } },
  { pattern: /sei\s+(spielerisch|kreativ|playful)/i,                                set: { responseEmotion: 'playful' } },
  { pattern: /kürzer|kurz(\s+und\s+knapp)?|fass\s+dich\s+kürzer/i,                 set: { verbosity: 'short' } },
  { pattern: /ausführlich(er)?|detailliert(er)?|mehr\s+details?/i,                  set: { verbosity: 'long' } },
  { pattern: /kreativ(er)?\s+modus|kreativ\s+sein|kreativität/i,                    set: { creativeMode: true } },
  { pattern: /normaler?\s+modus|standard\s+modus/i,                                 set: { creativeMode: false } },
  { pattern: /tiefe(re)?\s+analyse|analysier\s+genau|deep\s+analysis/i,             set: { analysisDepth: 'deep' } },
  { pattern: /schnelle\s+antwort|quick|kurze\s+analyse/i,                           set: { analysisDepth: 'quick' } },
];

class StyleProfileService {
  constructor(config = {}) {
    this.conversationStore = config.conversationStore || null;
    this.johnnyCore        = config.johnnyCore        || null;
    // In-Memory-Cache der aktiven Profile (SessionStore-Backup wenn kein SQLite)
    this._profileCache     = new Map();
  }

  async initialize() {
    // Profile aus SQLite laden wenn vorhanden
    if (this.conversationStore) {
      try {
        const stored = this.conversationStore.getAllMemories('default', 600)
          .filter(m => m.type === 'style_profile');
        for (const mem of stored) {
          try {
            const profile = JSON.parse(mem.content);
            this._profileCache.set(profile.userId || 'default', profile);
          } catch {}
        }
        console.log(`[StyleProfileService] ${this._profileCache.size} Profile geladen ✓`);
      } catch (e) {
        console.warn('[StyleProfileService] Fehler beim Laden:', e.message);
      }
    }
  }

  // ── Stil-Profil lesen ──────────────────────────────────────────────────────

  getProfile(userId = 'default') {
    if (!this._profileCache.has(userId)) {
      this._profileCache.set(userId, this._defaultProfile(userId));
    }
    return this._profileCache.get(userId);
  }

  _defaultProfile(userId) {
    return {
      userId,
      formalityLevel:   'auto',
      humorLevel:       'auto',
      responseEmotion:  'auto',
      analysisDepth:    'standard',
      creativeMode:     false,
      verbosity:        'medium',
      lockedBy:         null,        // 'user' = explizit gesetzt
      autoDetected:     {},          // zuletzt auto-erkannte Werte
      history:          [],          // letzte 10 Style-Änderungen
      signalCounts:     { formal: 0, casual: 0, humor_high: 0, humor_low: 0,
                          warm: 0, serious: 0, playful: 0 },
      createdAt:        new Date().toISOString(),
      updatedAt:        new Date().toISOString(),
    };
  }

  // ── Stil-Befehle erkennen und anwenden ────────────────────────────────────

  /**
   * Verarbeitet Nutzer-Nachricht: erkennt direkte Stilbefehle und sammelt
   * schwächere Signale für Auto-Detection.
   * Gibt zurück: { changed, direct, profile } oder null wenn keine Änderung.
   */
  async processMessage(userMessage, userId = 'default') {
    if (!userMessage || typeof userMessage !== 'string') return null;
    const msg     = userMessage.toLowerCase();
    const profile = this.getProfile(userId);
    let   changed = false;
    let   direct  = false;
    const changes = {};

    // 1) Direkte Befehle prüfen (höchste Priorität)
    for (const cmd of DIRECT_COMMANDS) {
      if (cmd.pattern.test(userMessage)) {
        Object.assign(changes, cmd.set);
        direct  = true;
        changed = true;
      }
    }

    // 2) Signal-Counting für Auto-Detection (nur wenn kein expliziter Lock)
    if (profile.lockedBy !== 'user') {
      this._updateSignals(msg, profile);

      // Nach 5 konsistenten Signalen auto-setzen
      const sc = profile.signalCounts;
      if (sc.formal  >= 5 && profile.formalityLevel !== 'formal')
        { changes.formalityLevel = 'formal'; changed = true; }
      if (sc.casual  >= 5 && profile.formalityLevel !== 'casual')
        { changes.formalityLevel = 'casual'; changed = true; }
      if (sc.humor_high >= 4 && profile.humorLevel !== 'high')
        { changes.humorLevel = 'high'; changed = true; }
      if (sc.humor_low  >= 4 && profile.humorLevel !== 'low')
        { changes.humorLevel = 'low'; changed = true; }
      if (sc.warm >= 4    && profile.responseEmotion !== 'warm')
        { changes.responseEmotion = 'warm'; changed = true; }
      if (sc.serious >= 4 && profile.responseEmotion !== 'serious')
        { changes.responseEmotion = 'serious'; changed = true; }
      if (sc.playful >= 4 && profile.responseEmotion !== 'playful')
        { changes.responseEmotion = 'playful'; changed = true; }
    }

    if (!changed) return null;

    // Änderungen auf Profil anwenden
    await this.applyChanges(userId, changes, direct ? 'user' : 'auto');

    // JohnnyCore-Profil synchronisieren
    if (this.johnnyCore && direct) {
      await this.johnnyCore.setStylePreference(userId, changes, 'user');
    }

    return { changed: true, direct, changes, profile: this.getProfile(userId) };
  }

  async applyChanges(userId, changes, source = 'user') {
    const profile = this.getProfile(userId);
    const prev    = {
      formalityLevel:  profile.formalityLevel,
      humorLevel:      profile.humorLevel,
      responseEmotion: profile.responseEmotion,
      analysisDepth:   profile.analysisDepth,
      creativeMode:    profile.creativeMode,
      verbosity:       profile.verbosity,
    };

    Object.assign(profile, changes);
    profile.lockedBy  = source === 'user' ? 'user' : profile.lockedBy;
    profile.updatedAt = new Date().toISOString();

    // History (max 10)
    profile.history.push({ ts: new Date().toISOString(), source, changes, prev });
    if (profile.history.length > 10) profile.history.shift();

    this._profileCache.set(userId, profile);

    // In SQLite persistieren
    if (this.conversationStore) {
      this.conversationStore.addMemory({
        userId,
        type:       'style_profile',
        content:    JSON.stringify(profile),
        importance: 0.9,
        source:     'StyleProfileService',
        tags:       ['style', 'profile', 'persistent'],
      });
    }
  }

  async resetProfile(userId = 'default') {
    const fresh = this._defaultProfile(userId);
    this._profileCache.set(userId, fresh);
    if (this.conversationStore) {
      this.conversationStore.addMemory({
        userId, type: 'style_profile',
        content: JSON.stringify(fresh), importance: 0.9,
        source: 'StyleProfileService', tags: ['style', 'profile', 'reset'],
      });
    }
    if (this.johnnyCore) {
      await this.johnnyCore.setStylePreference(userId, {
        formalityLevel: 'auto', humorLevel: 'auto',
        responseEmotion: 'auto', analysisDepth: 'standard',
        creativeMode: false, verbosity: 'medium',
      }, 'reset');
    }
    return fresh;
  }

  // ── System-Prompt Erweiterung ─────────────────────────────────────────────

  /**
   * Gibt den Stil-Block zurück der in jeden System-Prompt eingefügt wird.
   * Kompakt gehalten — kein Bloat.
   */
  getStyleBlock(userId = 'default') {
    const p = this.getProfile(userId);
    const lines = [];

    if (p.formalityLevel !== 'auto') {
      lines.push(p.formalityLevel === 'formal'
        ? '• Ton: förmlich (Siez-Form, strukturiert, kein Slang)'
        : '• Ton: locker (Du-Form, entspannt, natürlich)');
    }
    if (p.humorLevel !== 'auto') {
      lines.push(p.humorLevel === 'high'
        ? '• Humor: ausdrücklich erwünscht, gerne witzige Einwürfe'
        : '• Humor: kein Humor, direkt und sachlich');
    }
    if (p.responseEmotion !== 'auto') {
      const map = { serious: 'professionell-sachlich', warm: 'warm und empathisch', playful: 'spielerisch und lebendig' };
      lines.push(`• Emotion: ${map[p.responseEmotion] || p.responseEmotion}`);
    }
    if (p.analysisDepth !== 'standard') {
      lines.push(p.analysisDepth === 'deep'
        ? '• Analyse: tiefgründig — Zusammenhänge, Implikationen, Gegenargumente'
        : '• Analyse: kurz und prägnant');
    }
    if (p.verbosity !== 'medium') {
      lines.push(p.verbosity === 'long'
        ? '• Länge: ausführlich, Details willkommen'
        : '• Länge: kurz und knapp');
    }
    if (p.creativeMode) {
      lines.push('• Kreativ-Modus: ungewöhnliche Perspektiven, Metaphern, bildhafte Sprache');
    }

    if (!lines.length) return null;
    return `[Stil-Einstellungen für diesen User]\n${lines.join('\n')}`;
  }

  // ── UI / Anzeige ───────────────────────────────────────────────────────────

  getSummary(userId = 'default') {
    const p = this.getProfile(userId);
    return {
      formalityLevel:  p.formalityLevel,
      humorLevel:      p.humorLevel,
      responseEmotion: p.responseEmotion,
      analysisDepth:   p.analysisDepth,
      verbosity:       p.verbosity,
      creativeMode:    p.creativeMode,
      lockedBy:        p.lockedBy,
      historyCount:    p.history.length,
      updatedAt:       p.updatedAt,
    };
  }

  getHistory(userId = 'default') {
    return this.getProfile(userId).history;
  }

  // ── Interne Hilfsmethoden ─────────────────────────────────────────────────

  _updateSignals(msg, profile) {
    const sc = profile.signalCounts;
    const text = msg.toLowerCase();

    for (const kw of STYLE_SIGNALS.formality.formal) {
      if (text.includes(kw)) { sc.formal = Math.min(10, sc.formal + 1); break; }
    }
    for (const kw of STYLE_SIGNALS.formality.casual) {
      if (text.includes(kw)) { sc.casual = Math.min(10, sc.casual + 1); break; }
    }
    for (const kw of STYLE_SIGNALS.humor.high) {
      if (text.includes(kw)) { sc.humor_high = Math.min(10, sc.humor_high + 1); break; }
    }
    for (const kw of STYLE_SIGNALS.humor.low) {
      if (text.includes(kw)) { sc.humor_low = Math.min(10, sc.humor_low + 1); break; }
    }
    for (const kw of STYLE_SIGNALS.emotion.warm)    {
      if (text.includes(kw)) { sc.warm = Math.min(10, sc.warm + 1); break; }
    }
    for (const kw of STYLE_SIGNALS.emotion.serious) {
      if (text.includes(kw)) { sc.serious = Math.min(10, sc.serious + 1); break; }
    }
    for (const kw of STYLE_SIGNALS.emotion.playful) {
      if (text.includes(kw)) { sc.playful = Math.min(10, sc.playful + 1); break; }
    }

    // Sanftes Decay (Vergessen alter Signale)
    for (const key of Object.keys(sc)) {
      if (sc[key] > 0) sc[key] = Math.max(0, sc[key] - 0.05);
    }
  }
}

module.exports = StyleProfileService;
