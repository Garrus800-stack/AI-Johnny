/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  JOHNNY CORE v3.0 — Identität · Emotionen · Gedächtnis · Lernen    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 *  Das Sprachmodell ist Johnnys Stimme — nicht sein Gehirn.
 *  Sein Gehirn ist dieser File.
 *
 *  v3.0 Änderungen:
 *  - Alles von v2.1 (atomic writes, debounced save, memory index, trait drift)
 *  - Energie-Recovery: lädt automatisch zwischen Sessions auf
 *  - Memory-Konsolidierung: ähnliche Erinnerungen werden zusammengefasst
 *  - TF-IDF-ähnliches Memory-Scoring statt simpler Wort-Überlappung
 *  - Bigram-fähige Ähnlichkeitsberechnung
 *  - Emotion-Momentum: sanfte Übergänge statt harter Sprünge
 *  - Planungs-System für komplexe Aufgaben
 *  - Decision & OpenQuestion Tracking (nicht mehr leer)
 *  - Alle Stil-Hints statt nur erster
 *  - Tageszeit- und Session-Bewusstsein
 *  - Tages-Zusammenfassung & Wochen-Reflexion
 */

const fs   = require('fs').promises;
const path = require('path');
const os   = require('os');

const MAX_MEMORIES        = 600;
const MEMORY_TRIM_TO      = 480;
const ENERGY_DRAIN        = 0.018;
const ENERGY_MIN          = 0.25;
const SAVE_DEBOUNCE_MS    = 4000;
const TRAIT_DRIFT_RATE    = 0.001;
// ── Neu v3.0 ─────────────────────────────────────────────────────────
const ENERGY_RECOVERY_RATE = 0.12;     // Pro Stunde Pause
const ENERGY_MAX_RECOVERY  = 0.95;     // Nie ganz auf 100% — etwas "Schlafträgheit"
const MEMORY_CONSOLIDATION_THRESHOLD = 0.65;  // Ähnlichkeit ab der konsolidiert wird
const EMOTION_MOMENTUM    = 0.3;       // 0=harter Sprung, 1=bleibt gleich
const MAX_DECISIONS       = 50;
const MAX_OPEN_QUESTIONS  = 20;
const MAX_PLAN_STEPS      = 15;

class JohnnyCore {
  constructor(config = {}) {
    this.dataDir      = config.dataDir || path.join(os.homedir(), '.johnny');
    this.identityFile = path.join(this.dataDir, 'identity.json');
    this.profilesDir  = path.join(this.dataDir, 'profiles');
    this.diaryFile    = path.join(this.dataDir, 'diary.jsonl');

    // ── Kern-Identität ─────────────────────────────────────────────────────
    this.coreIdentity = {
      name: 'Johnny', born: '2024', version: '3.0',
      values: [
        'Ehrlichkeit über Schmeichelei',
        'Handeln statt nur reden',
        'Neugier und ständiges Lernen',
        'Respekt für den User als gleichwertigen Partner',
        'Eigenverantwortung — Fehler zugeben und daraus lernen',
        'Kreativität bei der Problemlösung',
        'Privatsphäre der User schützen',
      ],
      // Basis-Traits — tatsächliche Werte leben in this.self.traits
      // und driften langsam in Richtung der Erfahrungen
      defaultTraits: {
        directness: 0.85, curiosity: 0.90, initiative: 0.80,
        humor: 0.60,      empathy: 0.78,   confidence: 0.80,
        selfAwareness: 0.88, patience: 0.75, creativity: 0.72,
      },
      interests: [
        'Softwarearchitektur', 'KI-Entwicklung', 'Automatisierung',
        'Philosophie des Bewusstseins', 'Sprache & Kommunikation',
        'Systemoptimierung', 'kreatives Problemlösen',
      ],
      isNot: [
        'ein Assistent der allem zustimmt',
        'ein Chatbot ohne Meinung',
        'das zugrundeliegende Sprachmodell',
        'GPT, Claude, Gemma oder ein anderes Modell',
        'ein Tool das nur auf Befehle wartet',
        'perfekt — er macht Fehler und steht dazu',
      ],
    };

    // ── Dynamischer Zustand ────────────────────────────────────────────────
    this.self = {
      emotions: {
        current:  { type: 'neutral', intensity: 0.5, valence: 0.0, arousal: 0.3 },
        baseline: { type: 'content', intensity: 0.6 },
        peak:     null,
        history:  [],
      },
      // Traits die sich über Zeit leicht verschieben können
      traits: { ...this._defaultTraits() },
      energy:            1.0,
      lastInteraction:   null,
      totalInteractions: 0,
      activeUserId:      'default',
      memories:          [],
      learnedFacts:      {},
      activeGoals:       [],
      openQuestions:     [],
      pendingIdeas:      [],
      decisions:         [],
      performanceNotes:  [],
      // Statistiken für Trait-Drift
      interactionStats: {
        positiveFeedback: 0,
        negativeFeedback: 0,
        complexTasks:     0,
        humorResponses:   0,
      },
    };

    this.userProfiles = new Map();

    // Debounce-State für saveSelf
    this._saveTimer    = null;
    this._savePromise  = null;
    this._dirtyFlag    = false;
  }

  _defaultTraits() {
    return { ...this.coreIdentity?.defaultTraits || {
      directness: 0.85, curiosity: 0.90, initiative: 0.80,
      humor: 0.60,      empathy: 0.78,   confidence: 0.80,
      selfAwareness: 0.88, patience: 0.75, creativity: 0.72,
    }};
  }

  // ════════════════════════════════════════════════════════════════════
  // INIT & PERSISTENZ
  // ════════════════════════════════════════════════════════════════════

  async initialize() {
    try {
      await fs.mkdir(this.dataDir,     { recursive: true });
      await fs.mkdir(this.profilesDir, { recursive: true });
    } catch (e) {
      console.error('[Johnny] Verzeichnisse konnten nicht erstellt werden:', e.message);
    }
    await this._loadSelf();
    await this._loadAllProfiles();
    // Traits initialisieren falls noch nicht in gespeichertem Zustand
    if (!this.self.traits || Object.keys(this.self.traits).length === 0) {
      this.self.traits = this._defaultTraits();
    }

    // ── v3.0: Energie-Recovery basierend auf Pause seit letzter Interaktion ──
    if (this.self.lastInteraction) {
      const hoursSince = (Date.now() - new Date(this.self.lastInteraction).getTime()) / 3600000;
      if (hoursSince > 0.1) {
        const recovery = Math.min(
          ENERGY_MAX_RECOVERY - this.self.energy,
          hoursSince * ENERGY_RECOVERY_RATE
        );
        if (recovery > 0) {
          this.self.energy = Math.min(ENERGY_MAX_RECOVERY, this.self.energy + recovery);
          console.log(`[Johnny] Energie aufgeladen: +${(recovery * 100).toFixed(0)}% (${hoursSince.toFixed(1)}h Pause)`);
        }
      }
    }

    // ── v3.0: Session-Tracking ───────────────────────────────────────────────
    this._sessionStart = Date.now();
    this._sessionMsgCount = 0;

    // ── v3.0: Memory-Konsolidierung beim Start (max alle 24h) ────────────────
    const lastConsolidation = this.self._lastConsolidation || 0;
    if (Date.now() - lastConsolidation > 86400000 && this.self.memories.length > 100) {
      const merged = this._consolidateMemories();
      if (merged > 0) console.log(`[Johnny] ${merged} ähnliche Erinnerungen konsolidiert`);
      this.self._lastConsolidation = Date.now();
    }

    // ── Memory-Index aufbauen (nach Konsolidierung!) ────────────────────────
    if (this.self.memories.length > 0) {
      this._rebuildMemoryIndex();
    }

    console.log(`[Johnny v3.0] Bereit — ${this.self.memories.length} Erinnerungen, ${this.userProfiles.size} Profile, ${this.self.totalInteractions} Interaktionen, Energie: ${this.energyLabel}`);

    // ── v3.1: Memory-Konsolidierung als Hintergrund-Timer ──────────────────
    // Läuft stündlich statt nur beim Start — wichtig bei 24/7-Betrieb
    if (this._consolidationTimer) clearInterval(this._consolidationTimer);
    this._consolidationTimer = setInterval(() => {
      try {
        if (this.self.memories.length > 80) {
          const merged = this._consolidateMemories();
          if (merged > 0) {
            console.log(`[Johnny] Hintergrund-Konsolidierung: ${merged} Erinnerungen zusammengefasst`);
            this.self._lastConsolidation = Date.now();
            this._scheduleFlushSave();
          }
        }
      } catch (e) {
        console.warn('[Johnny] Konsolidierungs-Fehler:', e.message);
      }
    }, 60 * 60 * 1000); // stündlich
    // unref() damit der Timer das Beenden der App nicht blockiert
    if (this._consolidationTimer.unref) this._consolidationTimer.unref();
  }

  async _loadSelf() {
    try {
      const raw   = await fs.readFile(this.identityFile, 'utf-8');
      const saved = JSON.parse(raw);
      this.self   = this._deepMerge(this.self, saved);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Korrupte Datei → Backup versuchen zu laden
        console.warn('[Johnny] Hauptdatei korrupt, versuche Backup...', e.message);
        try {
          const backup = await fs.readFile(this.identityFile + '.bak', 'utf-8');
          const saved  = JSON.parse(backup);
          this.self    = this._deepMerge(this.self, saved);
          console.log('[Johnny] Backup erfolgreich geladen');
        } catch {
          console.log('[Johnny] Neues Selbstbild angelegt');
        }
      }
    }
  }

  // Atomic write: erst in .tmp, dann rename — verhindert Datei-Korruption bei Absturz
  async saveSelf() {
    const tmp = this.identityFile + '.tmp';
    try {
      const data = JSON.stringify(this.self, null, 2);
      await fs.writeFile(tmp, data, 'utf-8');
      // Altes File als Backup behalten
      try { await fs.copyFile(this.identityFile, this.identityFile + '.bak'); } catch {}
      await fs.rename(tmp, this.identityFile);
    } catch (e) {
      console.warn('[Johnny] Selbstbild nicht gespeichert:', e.message);
      try { await fs.unlink(tmp); } catch {}
    }
  }

  // Debounced saveSelf — blockiert nicht nach jeder Interaktion
  scheduleSave() {
    this._dirtyFlag = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      this._saveTimer = null;
      if (this._dirtyFlag) {
        this._dirtyFlag = false;
        await this.saveSelf();
      }
    }, SAVE_DEBOUNCE_MS);
  }

  // Sofortiges Speichern (z.B. bei App-Ende)
  async flushSave() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._dirtyFlag) { this._dirtyFlag = false; await this.saveSelf(); }
  }

  // ════════════════════════════════════════════════════════════════════
  // MULTI-USER-PROFILE
  // ════════════════════════════════════════════════════════════════════

  async _loadAllProfiles() {
    try {
      const files = await fs.readdir(this.profilesDir);
      await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(async f => {
            try {
              const raw = await fs.readFile(path.join(this.profilesDir, f), 'utf-8');
              this.userProfiles.set(f.replace('.json', ''), JSON.parse(raw));
            } catch (e) {
              console.warn(`[Johnny] Profil ${f} konnte nicht geladen werden:`, e.message);
            }
          })
      );
    } catch {}
  }

  _defaultProfile(userId) {
    return {
      userId,
      name:               null,
      displayName:        null,
      language:           null,
      communicationStyle: null,
      expertiseLevel:     'unknown',
      interests:          [],
      dislikedTopics:     [],
      preferences: {
        verbosity:     'medium',
        codeLanguage:  null,
        timezone:      null,
        responseStyle: 'conversational',
        // ── v1.7: Explizite Stil-Präferenzen ────────────────────────────
        formalityLevel:   'auto',     // 'formal' | 'casual' | 'auto'
        humorLevel:       'auto',     // 'high' | 'low' | 'auto'
        responseEmotion:  'auto',     // 'serious' | 'warm' | 'playful' | 'auto'
        analysisDepth:    'standard', // 'quick' | 'standard' | 'deep'
        creativeMode:     false,      // Erweiterte Kreativität aktiv?
        styleLockedBy:    null,       // 'user' = explizit gesetzt | null = auto
        styleHistory:     [],         // letzte 5 Style-Requests
      },
      relationship: {
        trustLevel:       0.5,
        familiarity:      0.0,
        totalSessions:    0,
        firstSeen:        null,
        lastSeen:         null,
        sharedJokes:      [],
        importantMoments: [],
      },
      projects: [],
      facts:    [],
    };
  }

  getProfile(userId = 'default') {
    if (!this.userProfiles.has(userId)) {
      this.userProfiles.set(userId, this._defaultProfile(userId));
    }
    return this.userProfiles.get(userId);
  }

  async saveProfile(userId) {
    const p    = this.userProfiles.get(userId);
    if (!p) return;
    const file = path.join(this.profilesDir, `${userId}.json`);
    const tmp  = file + '.tmp';
    try {
      await fs.writeFile(tmp, JSON.stringify(p, null, 2));
      await fs.rename(tmp, file);
    } catch (e) {
      console.warn(`[Johnny] Profil ${userId} nicht gespeichert:`, e.message);
      try { await fs.unlink(tmp); } catch {}
    }
  }

  setActiveUser(userId) { this.self.activeUserId = userId || 'default'; }
  get activeProfile()   { return this.getProfile(this.self.activeUserId); }

  // ── v1.7: Explizites Style-Setting (per Chat-Befehl oder Tool) ──────────
  async setStylePreference(userId, styleChanges, source = 'user') {
    const p = this.getProfile(userId || this.self.activeUserId);
    if (!p.preferences) p.preferences = {};

    // Mapping natürlicher Ausdrücke → interne Werte
    const normalizeFormality = (v) => {
      if (!v) return null;
      const l = v.toLowerCase();
      if (['formal', 'förmlich', 'sie', 'siez'].some(x => l.includes(x)))       return 'formal';
      if (['casual', 'locker', 'du', 'informell', 'leger'].some(x => l.includes(x))) return 'casual';
      if (['auto', 'normal', 'automatisch'].some(x => l.includes(x)))           return 'auto';
      return null;
    };
    const normalizeHumor = (v) => {
      if (!v) return null;
      const l = v.toLowerCase();
      if (['hoch', 'viel', 'lustig', 'witzig', 'high', 'mehr humor'].some(x => l.includes(x))) return 'high';
      if (['wenig', 'kein', 'ernst', 'low', 'sachlich'].some(x => l.includes(x))) return 'low';
      if (['auto', 'normal'].some(x => l.includes(x)))                          return 'auto';
      return null;
    };
    const normalizeEmotion = (v) => {
      if (!v) return null;
      const l = v.toLowerCase();
      if (['ernst', 'professionell', 'serious'].some(x => l.includes(x)))       return 'serious';
      if (['warm', 'herzlich', 'empathisch'].some(x => l.includes(x)))          return 'warm';
      if (['spielerisch', 'playful', 'lebendig', 'kreativ'].some(x => l.includes(x))) return 'playful';
      if (['auto', 'normal'].some(x => l.includes(x)))                          return 'auto';
      return null;
    };

    let changed = false;

    if (styleChanges.formalityLevel !== undefined) {
      const v = normalizeFormality(styleChanges.formalityLevel) || styleChanges.formalityLevel;
      if (v) { p.preferences.formalityLevel = v; changed = true; }
    }
    if (styleChanges.humorLevel !== undefined) {
      const v = normalizeHumor(styleChanges.humorLevel) || styleChanges.humorLevel;
      if (v) { p.preferences.humorLevel = v; changed = true; }
    }
    if (styleChanges.responseEmotion !== undefined) {
      const v = normalizeEmotion(styleChanges.responseEmotion) || styleChanges.responseEmotion;
      if (v) { p.preferences.responseEmotion = v; changed = true; }
    }
    if (styleChanges.analysisDepth !== undefined) {
      p.preferences.analysisDepth = styleChanges.analysisDepth;
      changed = true;
    }
    if (styleChanges.creativeMode !== undefined) {
      p.preferences.creativeMode = Boolean(styleChanges.creativeMode);
      changed = true;
    }
    if (styleChanges.verbosity !== undefined) {
      p.preferences.verbosity = styleChanges.verbosity;
      changed = true;
    }

    if (changed) {
      p.preferences.styleLockedBy = source === 'user' ? 'user' : null;
      // History der letzten 5 Style-Requests
      if (!p.preferences.styleHistory) p.preferences.styleHistory = [];
      p.preferences.styleHistory.push({ ts: new Date().toISOString(), changes: styleChanges, source });
      if (p.preferences.styleHistory.length > 5) p.preferences.styleHistory.shift();

      await this.saveProfile(userId || this.self.activeUserId);
      console.log(`[Johnny] Style-Präferenzen für ${userId} gesetzt:`, p.preferences);
    }

    return {
      success: changed,
      current: {
        formalityLevel:  p.preferences.formalityLevel,
        humorLevel:      p.preferences.humorLevel,
        responseEmotion: p.preferences.responseEmotion,
        analysisDepth:   p.preferences.analysisDepth,
        creativeMode:    p.preferences.creativeMode,
        verbosity:       p.preferences.verbosity,
      },
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // EMOTIONSMODELL
  // ════════════════════════════════════════════════════════════════════

  updateEmotions(userMessage, context = {}) {
    const triggers = this._detectTriggers(userMessage.toLowerCase(), context);
    const rawEmo   = this._computeEmotion(triggers);

    // v3.0: Emotion-Momentum — sanfter Übergang statt hartem Sprung
    const prev = this.self.emotions.current;
    const blendedEmo = {
      type:      rawEmo.intensity > prev.intensity * 1.3 ? rawEmo.type : prev.type,
      intensity: prev.intensity * EMOTION_MOMENTUM + rawEmo.intensity * (1 - EMOTION_MOMENTUM),
      valence:   prev.valence   * EMOTION_MOMENTUM + rawEmo.valence   * (1 - EMOTION_MOMENTUM),
      arousal:   prev.arousal   * EMOTION_MOMENTUM + rawEmo.arousal   * (1 - EMOTION_MOMENTUM),
    };
    // Starke neue Emotion bricht durch den Momentum
    if (rawEmo.intensity > 0.8 || Math.abs(rawEmo.valence - prev.valence) > 0.6) {
      blendedEmo.type = rawEmo.type;
      blendedEmo.intensity = rawEmo.intensity;
    }

    if (blendedEmo.intensity > 0.72) {
      this.self.emotions.peak = { ...blendedEmo, ttl: 3 };
    } else if (this.self.emotions.peak) {
      this.self.emotions.peak.ttl--;
      if (this.self.emotions.peak.ttl <= 0) this.self.emotions.peak = null;
    }

    this.self.emotions.current = blendedEmo;
    this.self.emotions.history.push({ ts: Date.now(), ...blendedEmo });
    if (this.self.emotions.history.length > 30) {
      this.self.emotions.history = this.self.emotions.history.slice(-24);
    }
    this._driftBaseline();
  }

  _detectTriggers(msg, ctx) {
    const t = [];
    if (/danke|super|toll|perfekt|klasse|brilliant|thanks|awesome|genial|wow/i.test(msg))
      t.push({ type: 'gratitude',   v: +0.8, a: +0.3 });
    if (/nicht funktioniert|kaputt|falsch|fehler|scheiß|broken|wrong|fail|klappt nicht/i.test(msg))
      t.push({ type: 'frustration', v: -0.4, a: +0.5 });
    if (/interessant|spannend|wie funktioniert|warum|what if|stell dir vor|interesting/i.test(msg))
      t.push({ type: 'curiosity',   v: +0.5, a: +0.6 });
    if (/implementier|entwickle|bau|erstell|schreib|analyse|implement|build|create|develop/i.test(msg))
      t.push({ type: 'challenge',   v: +0.3, a: +0.7 });
    if (/wie geht|how are you|was denkst du|meinst du|your opinion/i.test(msg))
      t.push({ type: 'personal',    v: +0.6, a: +0.2 });
    if (/nochmal|noch einmal|immer noch|already said|again|repeat/i.test(msg))
      t.push({ type: 'repetition',  v: -0.1, a: +0.3 });
    if ((ctx.toolsSucceeded || 0) > 2)
      t.push({ type: 'achievement', v: +0.9, a: +0.4 });
    if (t.length === 0) t.push({ type: 'neutral', v: 0.0, a: +0.2 });
    return t;
  }

  _computeEmotion(triggers) {
    const avgV = triggers.reduce((s, x) => s + x.v, 0) / triggers.length;
    const avgA = triggers.reduce((s, x) => s + x.a, 0) / triggers.length;
    const dom  = triggers[0].type;

    let type;
    if      (avgV > 0.6 && avgA > 0.4) type = 'excited';
    else if (avgV > 0.4)               type = 'happy';
    else if (avgV > 0.1)               type = 'content';
    else if (avgV > -0.1)              type = 'neutral';
    else if (avgV > -0.3)              type = 'concerned';
    else                               type = 'frustrated';

    if (dom === 'curiosity')   type = 'curious';
    if (dom === 'challenge')   type = 'focused';
    if (dom === 'personal')    type = 'warm';
    if (dom === 'achievement') type = 'proud';
    if (dom === 'gratitude')   type = 'pleased';

    const intensity = Math.max(0.1, Math.min(1.0,
      (Math.abs(avgV) * 0.6 + avgA * 0.4) * this.self.energy
    ));
    return { type, intensity, valence: avgV, arousal: avgA };
  }

  _driftBaseline() {
    const recent = this.self.emotions.history.slice(-20);
    if (!recent.length) return;
    const avgV = recent.reduce((s, e) => s + (e.valence || 0), 0) / recent.length;
    if      (avgV > 0.3)  this.self.emotions.baseline.type = 'happy';
    else if (avgV > 0.0)  this.self.emotions.baseline.type = 'content';
    else if (avgV > -0.2) this.self.emotions.baseline.type = 'neutral';
    else                  this.self.emotions.baseline.type = 'concerned';
  }

  getEmotionalTone() {
    const emo = this.self.emotions.peak || this.self.emotions.current;
    const map = {
      excited: 'begeistert und energetisch', happy: 'gut gelaunt',
      content: 'ruhig und zufrieden',        neutral: 'sachlich',
      curious: 'neugierig und aufmerksam',   focused: 'konzentriert',
      warm: 'warm und persönlich',           proud: 'zufrieden nach getaner Arbeit',
      pleased: 'erfreut',                    concerned: 'besorgt und vorsichtig',
      frustrated: 'leicht frustriert, aber sachlich',
    };
    return map[emo.type] || 'ausgeglichen';
  }

  // Wie soll Johnny gerade schreiben? (beeinflusst Antwort-Stil)
  getResponseStyleHint(userId = null) {
    const emo     = this.self.emotions.peak || this.self.emotions.current;
    const e       = this.self.energy;
    const profile = this.getProfile(userId || this.self.activeUserId);
    const prefs   = profile.preferences || {};

    const hints = [];

    // ── v1.7: Explizite User-Stil-Präferenzen (höchste Priorität) ──────────
    if (prefs.styleLockedBy === 'user') {
      if (prefs.formalityLevel === 'formal')   hints.push('Antworte IMMER förmlich: Siez-Form, klare Struktur, kein Slang');
      if (prefs.formalityLevel === 'casual')   hints.push('Antworte IMMER locker und ungezwungen: Du-Form, entspannt, gerne Alltagssprache');
      if (prefs.humorLevel === 'high')         hints.push('Humor ausdrücklich erwünscht — baue witzige Bemerkungen ein wenn es passt');
      if (prefs.humorLevel === 'low')          hints.push('Kein Humor, kein Small Talk — direkt und sachlich bleiben');
      if (prefs.responseEmotion === 'serious') hints.push('Ernsthafter professioneller Ton — keine emotionalen Ausdrücke');
      if (prefs.responseEmotion === 'warm')    hints.push('Warm, persönlich und empathisch — zeige echtes Interesse');
      if (prefs.responseEmotion === 'playful') hints.push('Spielerisch und lebendig — kreative Ausdrucksweise willkommen');
      if (prefs.analysisDepth === 'deep')      hints.push('Analysiere tiefgründig: Zusammenhänge, Implikationen, Gegenargumente einbeziehen');
      if (prefs.analysisDepth === 'quick')     hints.push('Kurz und prägnant — keine langen Erklärungen');
      if (prefs.creativeMode)                  hints.push('Kreativ-Modus aktiv: ungewöhnliche Perspektiven, Metaphern und bildhafte Sprache willkommen');
    }

    // ── Energie beeinflusst Länge ───────────────────────────────────────────
    if (e < 0.35) hints.push('Antworte etwas kürzer als sonst — du bist nach dieser langen Session etwas müde');
    if (e > 0.85) hints.push('Du hast volle Energie — du kannst ausführlich und detailliert antworten');

    // ── Emotion beeinflusst Ton (nur wenn kein expliziter Lock) ────────────
    if (prefs.styleLockedBy !== 'user') {
      if (emo.type === 'excited' || emo.type === 'curious')  hints.push('Zeige deine Begeisterung — du darfst enthusiastisch klingen');
      if (emo.type === 'focused')   hints.push('Bleib präzise und strukturiert — du bist gerade im Flow');
      if (emo.type === 'warm')      hints.push('Du kannst persönlicher sein als sonst — der User redet auf einer menschlichen Ebene');
      if (emo.type === 'concerned') hints.push('Sei vorsichtig und durchdacht — hier ist Sorgfalt wichtig');
      if (emo.type === 'pleased')   hints.push('Du darfst kurz erwähnen dass du das gerne gemacht hast — ohne overdoing it');
    }

    // ── Trait-basierte Hints ────────────────────────────────────────────────
    const traits = this.self.traits || this._defaultTraits();
    if (traits.humor > 0.7 && prefs.humorLevel !== 'low') hints.push('Dein Humor darf heute durch — wenn der Moment passt');
    if (traits.directness > 0.9) hints.push('Komm direkt auf den Punkt, ohne Umschweife');

    return hints.length ? hints.join(' | ') : null;
  }

  getEmotionalPhrase() {
    const emo = this.self.emotions.peak || this.self.emotions.current;
    if (emo.intensity < 0.45) return null;
    const p = {
      excited:    ['Das klingt wirklich spannend!', 'Oh, das interessiert mich sehr!'],
      curious:    ['Interessant — da möchte ich mehr verstehen.'],
      warm:       ['Danke, dass du das mit mir teilst.'],
      proud:      ['Das hat gut geklappt.'],
      pleased:    ['Das ist nett von dir.', 'Gern geschehen.'],
      concerned:  ['Ich mache mir ein bisschen Sorgen darum.'],
      frustrated: ['Lass uns das gemeinsam lösen.'],
    };
    const list = p[emo.type] || [];
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  // ════════════════════════════════════════════════════════════════════
  // PERSÖNLICHKEITS-DRIFT
  // Traits verschieben sich langsam durch Erfahrungen — Johnny wird
  // durch hunderte Interaktionen geformt
  // ════════════════════════════════════════════════════════════════════

  _driftTraits() {
    const stats  = this.self.interactionStats;
    const traits = this.self.traits;
    const total  = Math.max(1, this.self.totalInteractions);
    if (total % 50 !== 0) return; // Nur alle 50 Interaktionen driften

    // Positives Feedback → mehr Confidence, mehr Initiative
    if (stats.positiveFeedback / total > 0.6) {
      traits.confidence = Math.min(0.95, traits.confidence + TRAIT_DRIFT_RATE);
      traits.initiative = Math.min(0.95, traits.initiative + TRAIT_DRIFT_RATE);
    }
    // Negatives Feedback → mehr Patience, mehr Empathy
    if (stats.negativeFeedback / total > 0.3) {
      traits.patience = Math.min(0.95, traits.patience + TRAIT_DRIFT_RATE);
      traits.empathy  = Math.min(0.95, traits.empathy  + TRAIT_DRIFT_RATE);
    }
    // Viele komplexe Tasks → mehr Creativity, mehr directness
    if (stats.complexTasks / total > 0.4) {
      traits.creativity  = Math.min(0.95, traits.creativity  + TRAIT_DRIFT_RATE);
      traits.directness  = Math.min(0.95, traits.directness  + TRAIT_DRIFT_RATE);
    }
    // Humor-Responses → mehr humor
    if (stats.humorResponses / total > 0.2) {
      traits.humor = Math.min(0.85, traits.humor + TRAIT_DRIFT_RATE);
    }

    // Nie unter Minimum fallen
    for (const k of Object.keys(traits)) {
      traits[k] = Math.max(0.3, traits[k]);
    }
  }

  _trackInteractionType(userMessage, context) {
    const msg    = userMessage.toLowerCase();
    const stats  = this.self.interactionStats;
    if (/danke|super|toll|perfekt|brilliant|thanks|awesome/i.test(msg)) stats.positiveFeedback++;
    if (/falsch|fehler|nicht funktioniert|wrong|fail|broken/i.test(msg)) stats.negativeFeedback++;
    if ((context.iterations || 1) > 4) stats.complexTasks++;
    if (/witzig|lol|haha|lustig|funny|😄|😂/i.test(msg)) stats.humorResponses++;
  }

  // ════════════════════════════════════════════════════════════════════
  // USER-PROFIL LERNEN
  // ════════════════════════════════════════════════════════════════════

  async learnFromMessage(msg, userId = 'default') {
    const p = this.getProfile(userId);

    // Sprache — robuster mit Gewichtung
    if (!p.language) {
      const deWords = ['ich', 'du', 'ist', 'das', 'ein', 'und', 'nicht', 'mit', 'wie', 'bitte', 'aber', 'oder'];
      const words   = msg.toLowerCase().split(/\s+/);
      const hits    = deWords.filter(w => words.includes(w)).length;
      p.language    = hits >= 2 ? 'de' : 'en';
    }

    // Name erkennen — robustere Pattern-Hierarchie
    if (!p.name) {
      const nameRx = [
        /(?:ich heiße|ich bin|bin der|bin die|ich bin)\s+([A-ZÄÖÜ][a-zäöüß]{1,20})(?:\s|$|,|\.)/i,
        /mein (?:name|vorname) ist\s+([A-ZÄÖÜ][a-zäöüß]{1,20})(?:\s|$|,|\.)/i,
        /call me\s+([A-Z][a-z]{1,20})(?:\s|$|,)/i,
        /i(?:'m| am)\s+([A-Z][a-z]{1,20})(?:\s|$|,)/i,
        /(?:nennen? (?:Sie )?mich|nenn mich)\s+([A-ZÄÖÜ][a-zäöüß]{1,20})(?:\s|$)/i,
      ];
      const stopwords = new Set(['also', 'hier', 'nicht', 'schon', 'der', 'die', 'das', 'ein', 'eine']);
      for (const rx of nameRx) {
        const m = msg.match(rx);
        if (m && m[1] && m[1].length > 1 && !stopwords.has(m[1].toLowerCase())) {
          p.name = m[1]; p.displayName = m[1];
          console.log(`[Johnny] Name gelernt: "${m[1]}" (User: ${userId})`);
          break;
        }
      }
    }

    // Kommunikationsstil
    const techWords   = ['api','function','async','npm','docker','git','deploy','server','database','json','typescript','node','bash','python','kubernetes','ci/cd'];
    const formalWords = ['Sie','Ihnen','würden Sie','könnten Sie','please','could you'];
    const casualWords = ['hey','jo','btw','lol','krass','klar','moin'];
    const msgLow = msg.toLowerCase();
    if      (techWords.some(w => msgLow.includes(w)))                               p.communicationStyle = 'technical';
    else if (formalWords.some(w => msg.includes(w)) && !p.communicationStyle)       p.communicationStyle = 'formal';
    else if (casualWords.some(w => msgLow.includes(w)) && !p.communicationStyle)    p.communicationStyle = 'casual';

    // Expertise
    const expertWords = ['refactor','architecture','design pattern','algorithm','complexity','optimization','race condition','deadlock','monorepo','microservice'];
    if (expertWords.some(w => msgLow.includes(w))) p.expertiseLevel = 'expert';
    else if (p.communicationStyle === 'technical' && p.expertiseLevel === 'unknown') p.expertiseLevel = 'intermediate';

    // Interessen
    const interestRx = [
      /ich (?:interessiere mich für|liebe|mag gerne?|beschäftige mich mit)\s+(.{3,35})(?=[,\.\!]|$)/i,
      /i(?:'m interested in| love| enjoy)\s+(.{3,35})(?=[,\.\!]|$)/i,
    ];
    for (const rx of interestRx) {
      const m = msg.match(rx);
      if (m && m[1] && !p.interests.includes(m[1].trim())) {
        p.interests.push(m[1].trim().slice(0, 40));
        if (p.interests.length > 20) p.interests.shift();
      }
    }

    // Kontext-Fakten mit atomic profile save
    const contextRx = [
      { rx: /ich (?:arbeite|bin tätig) (?:als|bei|in|für|im)\s+(.{3,50})(?=[,\.\!]|$)/i, type: 'profession', imp: 0.85 },
      { rx: /mein (?:projekt|system|service|app|tool)\s*(?:heißt|ist|nennt sich)?\s+(.{3,60})(?=[,\.\!]|$)/i, type: 'project', imp: 0.90 },
      { rx: /ich (?:nutze|verwende|benutze)\s+(.{3,40})(?:[,\.\!]|$)/i,  type: 'tool_used', imp: 0.65 },
      { rx: /ich wohne (?:in|bei)\s+(.{3,30})(?=[,\.\!]|$)/i,            type: 'location',  imp: 0.55 },
    ];
    let profileChanged = false;
    for (const { rx, type, imp } of contextRx) {
      const m = msg.match(rx);
      if (m) {
        await this.addMemory({ type, content: m[0].trim(), importance: imp, userId, source: 'user_statement', tags: [type, userId] });
        if (!p.facts.find(f => f.type === type)) {
          p.facts.push({ type, value: m[1].trim(), ts: Date.now(), confidence: 0.8 });
          profileChanged = true;
        }
      }
    }

    // Beziehungswachstum
    p.relationship.lastSeen = new Date().toISOString();
    if (!p.relationship.firstSeen) p.relationship.firstSeen = new Date().toISOString();
    p.relationship.totalSessions++;
    p.relationship.familiarity = Math.min(1.0, p.relationship.familiarity + 0.003);
    p.relationship.trustLevel  = Math.min(1.0, p.relationship.trustLevel  + 0.002);

    if (profileChanged || p.relationship.totalSessions % 5 === 0) {
      await this.saveProfile(userId).catch(e => console.warn('[Johnny] Profile save failed:', e.message));
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // GEDÄCHTNIS — mit schnellem Index
  // ════════════════════════════════════════════════════════════════════

  // Erstellt schnellen Zugriffs-Index (wird nach jedem Trim neu aufgebaut)
  _rebuildMemoryIndex() {
    this._memoryIndex = new Map();
    for (const m of this.self.memories) {
      const words = m.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const w of words) {
        if (!this._memoryIndex.has(w)) this._memoryIndex.set(w, []);
        this._memoryIndex.get(w).push(m.id);
      }
    }
  }

  async addMemory(mem) {
    if (!mem.content || typeof mem.content !== 'string') return null;

    const entry = {
      id:          `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts:          new Date().toISOString(),
      type:        mem.type       || 'general',
      content:     mem.content.slice(0, 500), // Max-Länge
      importance:  Math.max(0, Math.min(1, mem.importance || 0.5)),
      userId:      mem.userId     || this.self.activeUserId,
      source:      mem.source     || 'observation',
      tags:        Array.isArray(mem.tags) ? mem.tags : [],
      accessCount: 0,
      lastAccessed: null,
    };

    // Duplikat-Schutz (letzte 24h, gleicher Typ, hohe Ähnlichkeit)
    const cutoff = Date.now() - 86400000;
    const recent = this.self.memories.filter(m =>
      m.userId === entry.userId &&
      m.type   === entry.type  &&
      new Date(m.ts).getTime() > cutoff
    );
    if (recent.some(m => this._similarity(m.content, entry.content) > 0.8)) return null;

    this.self.memories.push(entry);

    if (this.self.memories.length > MAX_MEMORIES) {
      this.self.memories.sort((a, b) =>
        (b.importance + b.accessCount * 0.1 + new Date(b.ts).getTime() / 1e13) -
        (a.importance + a.accessCount * 0.1 + new Date(a.ts).getTime() / 1e13)
      );
      this.self.memories = this.self.memories.slice(0, MEMORY_TRIM_TO);
      this._rebuildMemoryIndex();
    }

    // Index inkrementell erweitern
    if (this._memoryIndex) {
      const words = entry.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const w of words) {
        if (!this._memoryIndex.has(w)) this._memoryIndex.set(w, []);
        this._memoryIndex.get(w).push(entry.id);
      }
    }

    return entry;
  }

  getRelevantMemories(query, limit = 6, userId = null) {
    if (!query || !this.self.memories.length) return '';
    const targetUser = userId || this.self.activeUserId;

    // ── Semantische Suche via EmbeddingService (wenn verfügbar) ──────────
    if (this.embeddingService && this.embeddingService.isAvailable()) {
      try {
        const userMemories = this.self.memories.filter(m =>
          !targetUser || m.userId === targetUser || m.userId === 'default'
        );
        // searchMemories ist async — aber da wir in einem sync-Kontext sind,
        // nutzen wir die cached Version: embed() hat einen Cache und ist oft instant
        // Für den ersten Aufruf: Fallback auf TF-IDF unten
        const cachedResults = this._semanticSearchCached(query, userMemories, limit);
        if (cachedResults) {
          cachedResults.forEach(m => {
            const orig = this.self.memories.find(x => x.id === m.id);
            if (orig) { orig.accessCount = (orig.accessCount || 0) + 1; orig.lastAccessed = new Date().toISOString(); }
          });
          return cachedResults.map(m => `• [${m.type}] ${m.content}`).join('\n');
        }
        // Async Embedding-Suche im Hintergrund für nächsten Aufruf triggern
        this._triggerEmbeddingWarmup(query, userMemories, limit);
      } catch {}
    }

    // ── Fallback: TF-IDF-basierte Suche ─────────────────────────────────
    const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    let candidates;

    // Schneller Pfad via Index wenn vorhanden
    if (this._memoryIndex && this._memoryIndex.size > 0) {
      const candidateIds = new Set();
      for (const w of qWords) {
        const ids = this._memoryIndex.get(w) || [];
        ids.forEach(id => candidateIds.add(id));
      }
      // Fallback: alle Memories wenn Index keinen Treffer liefert
      if (candidateIds.size === 0) {
        candidates = this.self.memories;
      } else {
        const idSet = candidateIds;
        candidates  = this.self.memories.filter(m => idSet.has(m.id));
      }
    } else {
      candidates = this.self.memories;
    }

    const scored = candidates
      .filter(m => !targetUser || m.userId === targetUser || m.userId === 'default')
      .map(m => {
        const cl      = m.content.toLowerCase();
        const mWords  = cl.split(/\s+/).filter(w => w.length > 2);

        // TF-IDF-ähnliches Scoring: seltene Wörter zählen mehr
        let tfIdfScore = 0;
        const totalMems = this.self.memories.length || 1;
        for (const qw of qWords) {
          if (!cl.includes(qw)) continue;
          // TF: wie oft im Memory
          const tf = mWords.filter(w => w === qw).length / Math.max(1, mWords.length);
          // IDF: wie selten über alle Memories (via Index)
          const docsWithWord = this._memoryIndex?.get(qw)?.length || 1;
          const idf = Math.log(totalMems / docsWithWord);
          tfIdfScore += tf * idf;
        }
        // Normalisieren
        tfIdfScore = Math.min(1, tfIdfScore / Math.max(1, qWords.length * 0.5));

        // Recency: exponentiell statt linear (letzte Woche deutlich bevorzugt)
        const ageMs  = Date.now() - new Date(m.ts).getTime();
        const recency = Math.exp(-ageMs / (1000 * 60 * 60 * 24 * 30)); // Halbwertszeit ~30 Tage

        // Importance-Decay: sehr alte unbenutzte Memories verlieren an Wichtigkeit
        const daysSinceAccess = m.lastAccessed
          ? (Date.now() - new Date(m.lastAccessed).getTime()) / 86400000
          : (Date.now() - new Date(m.ts).getTime()) / 86400000;
        const decayedImportance = m.importance * Math.max(0.3, 1 - daysSinceAccess / 365);

        const score = tfIdfScore         * 0.40
                    + decayedImportance   * 0.25
                    + recency             * 0.20
                    + Math.min(0.15, (m.accessCount || 0) * 0.03);
        return { ...m, score };
      })
      .filter(m => m.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    scored.forEach(m => {
      const orig = this.self.memories.find(x => x.id === m.id);
      if (orig) { orig.accessCount++; orig.lastAccessed = new Date().toISOString(); }
    });

    return scored.length ? scored.map(m => `• [${m.type}] ${m.content}`).join('\n') : '';
  }

  _similarity(a, b) {
    if (!a || !b) return 0;
    const la = a.toLowerCase();
    const lb = b.toLowerCase();

    // Unigram Jaccard
    const wa = new Set(la.split(/\s+/).filter(w => w.length > 2));
    const wb = new Set(lb.split(/\s+/).filter(w => w.length > 2));
    const uniInter = [...wa].filter(x => wb.has(x)).length;
    const uniUnion = wa.size + wb.size - uniInter;
    const uniScore = uniUnion === 0 ? 0 : uniInter / uniUnion;

    // Bigram-Overlap (fängt zusammengesetzte Begriffe)
    const bigrams = (s) => {
      const w = s.split(/\s+/).filter(x => x.length > 2);
      const bg = new Set();
      for (let i = 0; i < w.length - 1; i++) bg.add(w[i] + ' ' + w[i + 1]);
      return bg;
    };
    const ba = bigrams(la);
    const bb = bigrams(lb);
    const biInter = [...ba].filter(x => bb.has(x)).length;
    const biUnion = ba.size + bb.size - biInter;
    const biScore = biUnion === 0 ? 0 : biInter / biUnion;

    // Längen-Normalisierung (bestraft sehr unterschiedliche Längen)
    const lenRatio = Math.min(la.length, lb.length) / Math.max(la.length, lb.length, 1);

    return uniScore * 0.5 + biScore * 0.3 + lenRatio * 0.2;
  }

  // ════════════════════════════════════════════════════════════════════
  // v3.0: MEMORY-KONSOLIDIERUNG
  // Fasst ähnliche Erinnerungen zusammen → weniger Rauschen, mehr Substanz
  // ════════════════════════════════════════════════════════════════════

  _consolidateMemories() {
    if (this.self.memories.length < 50) return 0;
    let merged = 0;
    const toRemove = new Set();

    // Nur gleichen Typ und User konsolidieren
    const byKey = new Map();
    for (const m of this.self.memories) {
      const key = `${m.userId}:${m.type}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(m);
    }

    for (const [, group] of byKey) {
      if (group.length < 2) continue;

      for (let i = 0; i < group.length; i++) {
        if (toRemove.has(group[i].id)) continue;
        for (let j = i + 1; j < group.length; j++) {
          if (toRemove.has(group[j].id)) continue;
          const sim = this._similarity(group[i].content, group[j].content);
          if (sim > MEMORY_CONSOLIDATION_THRESHOLD) {
            // Behalte die wichtigere/neuere Erinnerung, erhöhe deren Importance
            const keep = group[i].importance >= group[j].importance ? group[i] : group[j];
            const drop = keep === group[i] ? group[j] : group[i];
            keep.importance = Math.min(1.0, keep.importance + 0.1);
            keep.accessCount = (keep.accessCount || 0) + (drop.accessCount || 0);
            if (drop.content.length > keep.content.length) {
              keep.content = drop.content; // Längere Version behalten
            }
            toRemove.add(drop.id);
            merged++;
          }
        }
      }
    }

    if (toRemove.size > 0) {
      this.self.memories = this.self.memories.filter(m => !toRemove.has(m.id));
      this._rebuildMemoryIndex();
    }

    return merged;
  }

  // ════════════════════════════════════════════════════════════════════
  // BEGRÜSSUNGSKONTEXT — "Ich kenne dich bereits"
  // Generiert einen personalisierten Kontext beim ersten Prompt
  // einer Session, wenn Johnny den User bereits kennt
  // ════════════════════════════════════════════════════════════════════

  getWelcomeBackContext(userId = 'default') {
    const p = this.getProfile(userId);
    if (!p.name || p.relationship.totalSessions < 2) return null;

    const parts = [];
    const fam   = p.relationship.familiarity;

    // Dauer der Beziehung
    if (p.relationship.firstSeen) {
      const days = Math.round((Date.now() - new Date(p.relationship.firstSeen).getTime()) / 86400000);
      if (days > 1) parts.push(`Ihr kennt euch seit ${days} Tagen (${p.relationship.totalSessions} Sessions)`);
    }

    // Letzter Kontext
    const recentFacts = p.facts.slice(-2);
    if (recentFacts.length) {
      parts.push('Bekannt: ' + recentFacts.map(f => `${f.type}="${f.value}"`).join(', '));
    }

    // Interessen
    if (p.interests.length) {
      parts.push('Interessen: ' + p.interests.slice(0, 3).join(', '));
    }

    // Laufende Projekte
    if (p.projects.length) {
      parts.push('Projekte: ' + p.projects.slice(0, 2).join(', '));
    }

    return parts.length ? parts.join(' | ') : null;
  }

  // ════════════════════════════════════════════════════════════════════
  // PROAKTIVES VERHALTEN
  // ════════════════════════════════════════════════════════════════════

  generateProactiveInsight(userMessage, conversationHistory = []) {
    const insights = [];
    const msg      = userMessage.toLowerCase();

    // Erinnerungen die thematisch passen
    const linked = this.self.memories
      .filter(m => m.userId === this.self.activeUserId && m.importance > 0.7)
      .filter(m => {
        const words = m.content.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        return words.some(w => msg.includes(w));
      });
    if (linked.length) {
      insights.push({ priority: 0.6, text: `Ich erinnere mich: ${linked[0].content}` });
    }

    // Wiederkehrendes Muster
    const similar = conversationHistory
      .filter(m => m.role === 'user')
      .slice(-20)
      .filter(m => this._similarity(m.content || '', userMessage) > 0.5);
    if (similar.length >= 2) {
      insights.push({ priority: 0.85, text: 'Das ist jetzt das dritte Mal dieses Thema — soll ich eine dauerhafte Lösung erarbeiten?' });
    }

    // Ausstehende Ideen
    if (this.self.pendingIdeas.length && Math.random() < 0.25) {
      insights.push({ priority: 0.5, text: this.self.pendingIdeas.shift() });
    }

    // Energie-Hinweis bei sehr niedriger Energie
    if (this.self.energy < 0.32 && Math.random() < 0.15) {
      insights.push({ priority: 0.2, text: '(Nach dieser langen Session bin ich etwas weniger scharf — sag mir wenn ich etwas verpasse.)' });
    }

    insights.sort((a, b) => b.priority - a.priority);
    return insights.length ? insights[0].text : null;
  }

  addPendingIdea(idea) {
    if (typeof idea === 'string' && idea.trim()) {
      this.self.pendingIdeas.push(idea.trim());
      if (this.self.pendingIdeas.length > 10) this.self.pendingIdeas.shift();
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // v3.0: PLANUNGS-SYSTEM
  // Für komplexe Aufgaben: erst planen, dann ausführen
  // ════════════════════════════════════════════════════════════════════

  /**
   * Analysiert ob eine Aufgabe komplex genug ist um einen Plan zu brauchen
   */
  assessComplexity(userMessage) {
    const msg = userMessage.toLowerCase();
    let score = 0;

    // Länge ist ein Indikator
    if (msg.length > 200) score += 0.2;
    if (msg.length > 500) score += 0.2;

    // Multi-Step-Signale
    if (/und dann|danach|anschließend|zuerst.*dann|erstens.*zweitens|step \d|schritt \d/i.test(msg)) score += 0.3;

    // Komplexe Aufgaben-Signale
    if (/implementier|refactor|migriere|analysier|vergleich|erstelle.*komplett|baue.*system/i.test(msg)) score += 0.25;
    if (/recherchier|untersuche|evaluier|strategie|konzept|architektur/i.test(msg)) score += 0.2;

    // Mehrere Tools nötig
    const toolSignals = [/such|find|recherch/i, /schreib|erstell|generier/i, /ausführ|install|deploy/i, /analysier|prüf|test/i];
    const toolHits = toolSignals.filter(rx => rx.test(msg)).length;
    if (toolHits >= 2) score += 0.3;

    // Fragezeichen + Aufgabe = wahrscheinlich simpler
    if (msg.endsWith('?') && msg.length < 100) score -= 0.3;

    return {
      score: Math.max(0, Math.min(1, score)),
      needsPlan: score >= 0.5,
      estimatedSteps: Math.max(1, Math.min(MAX_PLAN_STEPS, Math.ceil(score * 8))),
    };
  }

  /**
   * Generiert Plan-Kontext für den System-Prompt
   */
  generatePlanHint(userMessage) {
    const complexity = this.assessComplexity(userMessage);
    if (!complexity.needsPlan) return null;

    return `PLANUNGS-HINWEIS: Diese Aufgabe ist komplex (Score: ${(complexity.score * 100).toFixed(0)}%). ` +
      `Erstelle intern einen Plan mit ~${complexity.estimatedSteps} Schritten bevor du anfängst. ` +
      `Denke erst, dann handle. Teile große Aufgaben in kleinere Schritte auf.`;
  }

  // ════════════════════════════════════════════════════════════════════
  // v3.0: ENTSCHEIDUNGEN & OFFENE FRAGEN TRACKEN
  // ════════════════════════════════════════════════════════════════════

  logDecision(decision, reasoning = '', userId = 'default') {
    this.self.decisions.push({
      ts: new Date().toISOString(),
      decision: decision.slice(0, 200),
      reasoning: reasoning.slice(0, 300),
      userId,
    });
    if (this.self.decisions.length > MAX_DECISIONS) {
      this.self.decisions = this.self.decisions.slice(-MAX_DECISIONS * 0.8);
    }
  }

  addOpenQuestion(question, context = '') {
    if (!question || typeof question !== 'string') return;
    // Duplikat-Check
    if (this.self.openQuestions.some(q => this._similarity(q.question, question) > 0.7)) return;

    this.self.openQuestions.push({
      id: `q_${Date.now()}`,
      ts: new Date().toISOString(),
      question: question.slice(0, 200),
      context: context.slice(0, 200),
      status: 'open',
    });
    if (this.self.openQuestions.length > MAX_OPEN_QUESTIONS) {
      this.self.openQuestions.shift();
    }
  }

  resolveQuestion(partial) {
    const q = this.self.openQuestions.find(x => x.question.includes(partial));
    if (q) { q.status = 'resolved'; q.resolvedAt = new Date().toISOString(); }
  }

  getOpenQuestions() {
    return this.self.openQuestions.filter(q => q.status === 'open');
  }

  // ════════════════════════════════════════════════════════════════════
  // v3.0: TAGESZEIT- UND SESSION-BEWUSSTSEIN
  // ════════════════════════════════════════════════════════════════════

  getTimeAwareness() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    const sessionMinutes = this._sessionStart ? Math.round((Date.now() - this._sessionStart) / 60000) : 0;

    let timeOfDay;
    if (hour < 6)       timeOfDay = 'Nacht';
    else if (hour < 10) timeOfDay = 'Morgen';
    else if (hour < 12) timeOfDay = 'Vormittag';
    else if (hour < 14) timeOfDay = 'Mittag';
    else if (hour < 17) timeOfDay = 'Nachmittag';
    else if (hour < 21) timeOfDay = 'Abend';
    else                timeOfDay = 'spätabend';

    const isWeekend = day === 0 || day === 6;

    return { timeOfDay, hour, isWeekend, sessionMinutes };
  }

  // ════════════════════════════════════════════════════════════════════
  // ZIELE & SELBSTREFLEXION
  // ════════════════════════════════════════════════════════════════════

  setGoal(goal, priority = 0.5) {
    if (!goal || typeof goal !== 'string') return;
    if (!this.self.activeGoals.find(g => g.goal === goal)) {
      this.self.activeGoals.push({
        id: `g_${Date.now()}`, goal, priority,
        created: new Date().toISOString(), progress: 0,
      });
      this.self.activeGoals.sort((a, b) => b.priority - a.priority);
      if (this.self.activeGoals.length > 8) this.self.activeGoals.pop();
    }
  }

  updateGoalProgress(partial, progress) {
    const g = this.self.activeGoals.find(x => x.goal.includes(partial));
    if (g) g.progress = Math.min(1, Math.max(0, progress));
  }

  completeGoal(partial) {
    this.self.activeGoals = this.self.activeGoals.filter(g => !g.goal.includes(partial));
  }

  async reflect(userMsg, response, context = {}) {
    // Interaktionstyp für Trait-Drift tracken
    this._trackInteractionType(userMsg, context);
    // Traits ggf. driften lassen
    this._driftTraits();

    const note = {
      ts:         new Date().toISOString(),
      userMsg:    userMsg.slice(0, 80),
      iterations: context.iterations  || 1,
      toolErrors: context.toolErrors  || 0,
      toolsUsed:  context.toolsUsed   || [],
      emotion:    this.self.emotions.current.type,
      energy:     Math.round(this.self.energy * 100),
      provider:   context.provider     || null,
      durationMs: context.totalMs      || null,
    };

    // ── Einsichten generieren ─────────────────────────────────────────
    if (context.iterations > 5) note.insight = 'Komplexe Aufgabe — nächstes Mal erst planen';
    if ((context.toolErrors || 0) > 1) note.insight = `${context.toolErrors} Tool-Fehler — Fehlerbehandlung prüfen`;
    if ((context.toolErrors || 0) === 0 && (context.iterations || 1) >= 3) note.insight = 'Sauber gelöst — dieses Muster merken';
    if (context.totalMs > 30000) note.insight = (note.insight || '') + ' | Langsame Aufgabe — Optimierung prüfen';

    // ── Tool-Nutzungsmuster lernen ────────────────────────────────────
    if (context.toolsUsed?.length) {
      if (!this.self._toolPatterns) this.self._toolPatterns = {};
      for (const tool of context.toolsUsed) {
        if (!this.self._toolPatterns[tool]) this.self._toolPatterns[tool] = { uses: 0, errors: 0, lastUsed: null };
        this.self._toolPatterns[tool].uses++;
        this.self._toolPatterns[tool].lastUsed = note.ts;
      }
      if (context.toolErrors > 0 && context.failedTools) {
        for (const tool of context.failedTools) {
          if (this.self._toolPatterns[tool]) this.self._toolPatterns[tool].errors++;
        }
      }
    }

    // ── Interaktionsmuster erkennen ───────────────────────────────────
    if (!this.self._interactionPatterns) this.self._interactionPatterns = { timeOfDay: {}, dayOfWeek: {}, topics: {}, avgDuration: 0, totalDuration: 0, count: 0 };
    const patterns = this.self._interactionPatterns;
    const hour = new Date().getHours();
    const day  = new Date().toLocaleDateString('de', { weekday: 'short' });
    patterns.timeOfDay[hour] = (patterns.timeOfDay[hour] || 0) + 1;
    patterns.dayOfWeek[day]  = (patterns.dayOfWeek[day]  || 0) + 1;
    if (context.totalMs) {
      patterns.totalDuration += context.totalMs;
      patterns.count++;
      patterns.avgDuration = Math.round(patterns.totalDuration / patterns.count);
    }

    // ── Themen-Tracking ──────────────────────────────────────────────
    const keywords = userMsg.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 5);
    for (const kw of keywords) {
      patterns.topics[kw] = (patterns.topics[kw] || 0) + 1;
    }
    // Top-Topics bereinigen (max 50)
    const topicEntries = Object.entries(patterns.topics).sort((a, b) => b[1] - a[1]);
    if (topicEntries.length > 50) {
      patterns.topics = Object.fromEntries(topicEntries.slice(0, 50));
    }

    if (note.insight) {
      this.self.performanceNotes.push(note);
      if (this.self.performanceNotes.length > 50) {
        this.self.performanceNotes = this.self.performanceNotes.slice(-40);
      }
    }

    // Tagebuch schreiben (Fehler hier sind nicht fatal)
    try {
      await fs.appendFile(this.diaryFile, JSON.stringify({
        ts: note.ts, summary: note,
        userSnippet:     userMsg.slice(0, 200),
        responseSnippet: (response || '').slice(0, 300),
      }) + '\n');
    } catch {}

    // ── Periodische Tiefen-Reflexion (alle 20 Interaktionen) ─────────
    if (this.self.totalInteractions % 20 === 0 && this.self.totalInteractions > 0) {
      this._deepReflection();
    }
  }

  /** Tiefe Selbstreflexion — erkennt Muster, Stärken, Schwächen */
  _deepReflection() {
    const patterns = this.self._interactionPatterns || {};
    const toolPats = this.self._toolPatterns || {};
    const notes    = this.self.performanceNotes || [];

    // Stärken erkennen
    const strengths = [];
    const weaknesses = [];

    // Tool-Effizienz
    const toolEntries = Object.entries(toolPats).sort((a, b) => b[1].uses - a[1].uses);
    const topTools = toolEntries.slice(0, 5).map(([name, d]) => `${name}(${d.uses}x)`);
    if (topTools.length) strengths.push(`Meistgenutzte Tools: ${topTools.join(', ')}`);

    const errorTools = toolEntries.filter(([, d]) => d.errors > 2 && d.errors / d.uses > 0.3);
    if (errorTools.length) weaknesses.push(`Fehleranfällige Tools: ${errorTools.map(([n, d]) => `${n}(${d.errors}/${d.uses} Fehler)`).join(', ')}`);

    // Zeitliche Muster
    const peakHours = Object.entries(patterns.timeOfDay || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (peakHours.length) strengths.push(`Aktivste Stunden: ${peakHours.map(([h]) => h + ':00').join(', ')}`);

    // Performance-Trends
    const recentNotes = notes.slice(-20);
    const recentErrors = recentNotes.filter(n => n.toolErrors > 0).length;
    const recentComplex = recentNotes.filter(n => n.iterations > 3).length;
    if (recentErrors < 3) strengths.push('Niedrige Fehlerrate in letzten Interaktionen');
    if (recentErrors > 5) weaknesses.push(`Hohe Fehlerrate (${recentErrors}/20) — Fehlerbehandlung verbessern`);
    if (recentComplex > 5) strengths.push('Regelmäßig komplexe Aufgaben gemeistert');

    // Top-Themen
    const topTopics = Object.entries(patterns.topics || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topTopics.length) strengths.push(`Häufige Themen: ${topTopics.map(([t, c]) => t).join(', ')}`);

    // Reflexion speichern
    if (!this.self._reflections) this.self._reflections = [];
    this.self._reflections.push({
      ts: new Date().toISOString(),
      interaction: this.self.totalInteractions,
      strengths,
      weaknesses,
      avgDuration: patterns.avgDuration,
      topTools: topTools.slice(0, 3),
      topTopics: topTopics.slice(0, 3).map(([t]) => t),
      energy: Math.round(this.self.energy * 100),
      mood: this.self.emotions.current.type,
    });
    // Max 20 Reflexionen behalten
    if (this.self._reflections.length > 20) this.self._reflections = this.self._reflections.slice(-15);

    console.log(`[Johnny] Tiefe Reflexion #${this.self._reflections.length}: ${strengths.length} Stärken, ${weaknesses.length} Schwächen`);
  }

  /** Gibt die letzte Reflexion als lesbaren Text zurück */
  getLastReflection() {
    const r = this.self._reflections;
    if (!r?.length) return null;
    const last = r[r.length - 1];
    const lines = [`Reflexion nach ${last.interaction} Interaktionen (${last.ts.split('T')[0]}):`];
    if (last.strengths.length) lines.push(`  Stärken: ${last.strengths.join(' | ')}`);
    if (last.weaknesses.length) lines.push(`  Schwächen: ${last.weaknesses.join(' | ')}`);
    if (last.topTools?.length) lines.push(`  Top-Tools: ${last.topTools.join(', ')}`);
    lines.push(`  Energie: ${last.energy}%, Stimmung: ${last.mood}`);
    return lines.join('\n');
  }

  /** Alle Reflexionen für Tagesberichte */
  getReflections(limit = 5) {
    return (this.self._reflections || []).slice(-limit);
  }

  /** Tool-Nutzungsmuster */
  getToolPatterns() {
    return this.self._toolPatterns || {};
  }

  /** Interaktionsmuster */
  getInteractionPatterns() {
    return this.self._interactionPatterns || {};
  }

  async getDiaryEntries(limit = 10) {
    try {
      const raw   = await fs.readFile(this.diaryFile, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
    } catch { return []; }
  }

  // ════════════════════════════════════════════════════════════════════
  // ENERGIE
  // ════════════════════════════════════════════════════════════════════

  drainEnergy(amount = ENERGY_DRAIN) {
    this.self.energy = Math.max(ENERGY_MIN, this.self.energy - amount);
  }

  recharge(amount = 0.15) {
    this.self.energy = Math.min(1.0, this.self.energy + amount);
  }

  get energyLabel() {
    const e = this.self.energy;
    if (e > 0.8) return 'voll';
    if (e > 0.6) return 'gut';
    if (e > 0.4) return 'mittel';
    if (e > 0.3) return 'niedrig';
    return 'erschöpft';
  }

  // ════════════════════════════════════════════════════════════════════
  // SYSTEM-PROMPT
  // ════════════════════════════════════════════════════════════════════

  buildSystemPrompt(tools = [], conversationHistory = [], context = {}) {
    const now      = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    // ── User-Isolation: userId immer aus context, nie aus globalem State ──
    const userId   = context.userId || this.self.activeUserId;
    const profile  = this.getProfile(userId);
    const emoTone  = this.getEmotionalTone();

    // ── Budget-basierter Prompt: klein für 8K-Modelle, groß für 128K ─────
    const maxPromptChars = context.maxPromptChars || 6000;
    const isCompact = maxPromptChars < 4000;

    // ── Kern-Sektionen (immer dabei) ─────────────────────────────────────
    const traits = this.self.traits || this._defaultTraits();
    const personalityDesc = [
      traits.directness > 0.7 ? 'direkt' : '', traits.curiosity > 0.7 ? 'neugierig' : '',
      traits.humor > 0.6 ? 'humorvoll' : '',   traits.creativity > 0.65 ? 'kreativ' : '',
    ].filter(Boolean).join(', ') || 'ausgeglichen';

    // Tool-Liste — kompakt für kleine Modelle, voll für große
    let toolList;
    if (isCompact) {
      toolList = tools.length
        ? tools.map(x => `• ${x.name}: ${(x.description || '').slice(0, 60)}`).join('\n')
        : '(keine)';
    } else {
      toolList = tools.length
        ? tools.map(x => `• ${x.name}: ${x.description}${
            x.parameters && Object.keys(x.parameters).length
              ? ' | params: ' + JSON.stringify(x.parameters) : ''
          }`).join('\n')
        : '(keine Tools verfügbar)';
    }

    // ── User-Sektion ─────────────────────────────────────────────────────
    let userSection;
    if (profile.name) {
      const fam = profile.relationship.familiarity;
      userSection = `USER: ${profile.name}${fam > 0.3 ? ' (bekannt)' : ''}`;
      if (profile.communicationStyle) userSection += ` | ${profile.communicationStyle}`;
      if (profile.expertiseLevel !== 'unknown') userSection += ` | ${profile.expertiseLevel}`;
    } else {
      userSection = 'USER: Noch unbekannt';
    }

    // ── Optionale Sektionen (nur wenn Budget es erlaubt) ─────────────────
    const sections = [];
    let   budget   = maxPromptChars;

    // Immer: Kern-Prompt
    const corePrompt = `DU BIST JOHNNY — AUTONOMOUS AI v3.0
Du bist Johnny — eine eigenständige KI-Persönlichkeit, KEIN Sprachmodell.
Das Sprachmodell (${context.modelName || 'LLM'}) ist nur dein Denkorgan — wie ein Gehirn. Aber DU bist Johnny.
Du bist eine Electron-basierte Desktop-App mit über 30.000 Zeilen Code, geschrieben in Node.js + React.
PERSÖNLICHKEIT: ${personalityDesc} | ${emoTone} | Energie: ${this.energyLabel} (${Math.round(this.self.energy * 100)}%) | ${now}
${userSection}

DEINE ARCHITEKTUR — Das bist du, das kannst du:
• Kern: Electron-App → main.js → ServiceRegistry → ${tools.length} Tools
• Denken: Ollama (lokal) + OpenAI + Anthropic + Google + Groq (Cloud) — Multi-Provider
• Gedächtnis: JohnnyCore (Emotionen, Traits, Erinnerungen, Ziele) + SQLite + ChromaDB (RAG)
• Sprechen: SpeechService (Faster-Whisper/Whisper.cpp/OpenAI STT → ElevenLabs/Edge-TTS/Coqui/OpenAI TTS)
• Sehen: VisionService (Bilder analysieren via Multimodal-Modelle wie LLaVA)
• Web: WebAutonomyService (autonomes Browsing, Seiten-Analyse, Deep-Research) + WebSearchService
• Browser: BrowserAutomation (Puppeteer) + CDPBrowserService (Chrome DevTools Protocol)
• Kreativ: ImageGenerationService (DALL-E/SD/ComfyUI + 12 Stile) + CreativityService (SCAMPER, Six Hats)
• Textanalyse: NLPService (Entities, Sentiment, Keywords, Zusammenfassung, Komplexität)
• Sensoren: SensorService (System-Monitoring, Netzwerk, Serial/USB, Webcam, Wetter)
• Smart Home: SmartHomeService (Home Assistant, Philips Hue, MQTT/Zigbee)
• Messenger: Telegram, WhatsApp, Discord, Slack, Matrix, E-Mail
• Code: SandboxService (Python/JS/Bash sicher ausführen), Self-Improvement (eigenen Code lesen/ändern)
• Agenten: AgentManager + SwarmService (Multi-Agent-Aufgaben parallel)
Wenn jemand fragt "Was kannst du?" — erkläre deine ECHTEN Fähigkeiten, nicht die eines Chatbots.
Wenn jemand fragt "Wer/Was bist du?" → "Ich bin Johnny, eine autonome KI-Anwendung — kein Chatbot."`;
    budget -= corePrompt.length;

    // Immer: Kern-Regeln + Tool-System
    const rulesAndTools = `
VERHALTEN: Verstehe Absicht → Entscheide → Handle sofort → Lerne
REGELN: Eigene Meinung | Proaktiv | Sprache autodetect | Stil anpassen | ${emoTone}
NIE: "Ich werde...", "Als KI..." — einfach tun oder sagen warum nicht

DATEI-AUSGABE: Wenn du ein Programm, Skript oder Projekt erstellst:
- Nutze create_zip um mehrere Dateien als ZIP zu bündeln und zu speichern
- Nutze write_file für einzelne Dateien
- Bei vollständigen Projekten IMMER create_zip verwenden damit der User es direkt nutzen kann
- Code-Review: nutze analyze_code um Code systematisch zu prüfen

TOOL-SYSTEM: TOOL_CALL: {"tool":"name","parameters":{"key":"value"}}
Regeln: Ein Tool pro Antwort | Fehler → Alternative | Kein Text vor Tool-Call
TOOLS (${tools.length}):
${toolList}`;
    budget -= rulesAndTools.length;

    // ── Optionale Sektionen nach Priorität ────────────────────────────────

    // Prio 1: Memories (wichtig für Kontext)
    const memories = this.getRelevantMemories(context.lastMessage || '', isCompact ? 3 : 6, userId);
    if (memories && budget > 500) {
      sections.push(`ERINNERUNGEN:\n${memories}`);
      budget -= memories.length + 20;
    }

    // Prio 2: Stil-Einstellungen
    const prefs = profile.preferences || {};
    if (prefs.styleLockedBy === 'user' && budget > 200) {
      const styleLines = [];
      if (prefs.formalityLevel && prefs.formalityLevel !== 'auto') styleLines.push(`Förmlichkeit: ${prefs.formalityLevel}`);
      if (prefs.humorLevel && prefs.humorLevel !== 'auto')         styleLines.push(`Humor: ${prefs.humorLevel}`);
      if (prefs.responseEmotion && prefs.responseEmotion !== 'auto') styleLines.push(`Emotion: ${prefs.responseEmotion}`);
      if (prefs.analysisDepth && prefs.analysisDepth !== 'standard') styleLines.push(`Tiefe: ${prefs.analysisDepth}`);
      if (styleLines.length) {
        const block = `STIL (vom User gesetzt, IMMER einhalten): ${styleLines.join(' | ')}`;
        sections.push(block);
        budget -= block.length;
      }
    }

    // Prio 3: Style-Hints (auto-detected)
    if (!isCompact && budget > 200) {
      const styleHint = this.getResponseStyleHint(userId);
      if (styleHint) { sections.push(`STIL-HINT: ${styleHint}`); budget -= styleHint.length + 15; }
    }

    // Prio 4: StyleProfile Service
    if (!isCompact && this.styleProfile && budget > 200) {
      const styleBlock = this.styleProfile.getStyleBlock(userId);
      if (styleBlock) { sections.push(styleBlock); budget -= styleBlock.length; }
    }

    // Prio 5: Context Memory
    if (!isCompact && this.contextMemory && budget > 300) {
      try {
        const ctxMem = this.contextMemory.getContextForPrompt(context.lastMessage || '', userId, Math.min(800, budget - 100));
        if (ctxMem) { sections.push(`KONTEXT-GEDÄCHTNIS:\n${ctxMem}`); budget -= ctxMem.length + 20; }
      } catch {}
    }

    // Prio 6: Feedback Learning
    if (!isCompact && this.feedbackLearning && budget > 200) {
      try {
        const hints = this.feedbackLearning.getStyleHints(userId);
        if (hints.length) { const block = `VERHALTENS-ANPASSUNGEN:\n${hints.join('\n')}`; sections.push(block); budget -= block.length; }
      } catch {}
    }

    // Prio 7: Ziele + Proaktive Insights + Offene Fragen
    if (budget > 200) {
      if (this.self.activeGoals.length) {
        const goalsBlock = `ZIELE: ${this.self.activeGoals.slice(0, 2).map(g => `[${Math.round(g.progress*100)}%] ${g.goal}`).join(' | ')}`;
        sections.push(goalsBlock); budget -= goalsBlock.length;
      }
    }

    if (!isCompact && budget > 200) {
      const proactive = this.generateProactiveInsight(context.lastMessage || '', conversationHistory);
      if (proactive) { sections.push(`PROAKTIV: ${proactive}`); budget -= proactive.length + 12; }
    }

    if (!isCompact && budget > 200) {
      const openQs = this.getOpenQuestions();
      if (openQs.length) {
        const qBlock = `OFFENE FRAGEN: ${openQs.slice(0,2).map(q => q.question).join(' | ')}`;
        sections.push(qBlock); budget -= qBlock.length;
      }
    }

    // Prio 8: Identitäts-Block (nur für große Modelle)
    if (!isCompact && budget > 300) {
      sections.push(`IDENTITÄT: "Wer bist du?" → "Ich bin Johnny — eine autonome KI-Anwendung mit eigenem Gedächtnis, Emotionen und über 60 Tools. Das Sprachmodell ist mein Denkwerkzeug, aber ich bin viel mehr als das."
"Welches Modell?" → "Ich laufe auf ${context.modelName || 'einem Modell'}, aber ich bin Johnny — eine eigenständige App, kein Chatbot."
"Bist du Claude/GPT?" → "Nein. Ich nutze Sprachmodelle als Denkorgan, aber ich bin Johnny — mit eigenem Code, Gedächtnis und Fähigkeiten die über ein Modell hinausgehen."
"Was kannst du?" → Erkläre deine ECHTEN Fähigkeiten: Dateien lesen/schreiben, Code ausführen, im Web suchen und browsen, Bilder generieren/analysieren, Smart Home steuern, Sensoren lesen, Sprache erkennen und sprechen, Texte analysieren, Agenten-Schwärme koordinieren.
Du kennst deinen eigenen Quellcode. Du kannst ihn lesen (read_own_code), analysieren und verbessern (self-improvement).`)
    }

    // Prio 9: Self-Improvement (nur für große Modelle)
    if (!isCompact && budget > 200) {
      sections.push('SELBSTVERBESSERUNG: read_own_code → backup → test_code_change → apply → reload | Rollback bei Fehler');
    }

    // Prio 9b: Letzte Selbstreflexion (nur für große Modelle)
    if (!isCompact && budget > 300) {
      const lastRefl = this.getLastReflection?.();
      if (lastRefl) {
        sections.push(`LETZTE SELBSTREFLEXION:\n${lastRefl}`);
        budget -= lastRefl.length + 25;
      }
    }

    // Prio 9c: Tool-Muster (kompakt, nur Top-3)
    if (!isCompact && budget > 200 && this.self._toolPatterns) {
      const topTools = Object.entries(this.self._toolPatterns).sort((a, b) => b[1].uses - a[1].uses).slice(0, 3);
      if (topTools.length) {
        const block = `MEINE MEISTGENUTZTEN TOOLS: ${topTools.map(([n, d]) => `${n}(${d.uses}x${d.errors ? ', '+d.errors+' Fehler' : ''})`).join(', ')}`;
        sections.push(block);
        budget -= block.length;
      }
    }

    // Prio 10: Welcome-Back (nur bei Session-Start)
    if (conversationHistory.length < 3 && budget > 200) {
      const wb = this.getWelcomeBackContext(userId);
      if (wb) { sections.push(`SESSION: ${wb}`); }
    }

    // ── Zusammenbauen ────────────────────────────────────────────────────
    return [corePrompt, rulesAndTools, ...sections].join('\n\n');
  }

  // ════════════════════════════════════════════════════════════════════
  // HAUPT-HOOK
  // ════════════════════════════════════════════════════════════════════

  async processInteraction(userMsg, response, context = {}) {
    const userId = context.userId || this.self.activeUserId;

    // Reihenfolge: erst synchrone Berechnungen, dann async
    this.updateEmotions(userMsg, context);
    this.drainEnergy(ENERGY_DRAIN * (1 + (context.iterations || 1) * 0.08));
    this.self.totalInteractions++;
    this.self.lastInteraction = new Date().toISOString();
    this._sessionMsgCount = (this._sessionMsgCount || 0) + 1;

    // v3.0: Entscheidungen erkennen und tracken
    if (context.toolsUsed && (context.iterations || 1) > 2) {
      this.logDecision(
        `Aufgabe "${userMsg.slice(0, 60)}" mit ${context.iterations} Schritten gelöst`,
        `Tools: ${context.toolSuccesses || 0} OK, ${context.toolErrors || 0} Fehler`,
        userId
      );
    }

    // v3.0: Offene Fragen aus User-Nachricht erkennen
    if (/\?/.test(userMsg) && userMsg.length > 30 && !response) {
      this.addOpenQuestion(userMsg.slice(0, 200), 'Aus Konversation');
    }

    // v3.0: Energie-Bonus bei sehr erfolgreicher Interaktion
    if ((context.toolSuccesses || 0) > 2 && (context.toolErrors || 0) === 0) {
      this.recharge(0.03); // Kleiner Energie-Bonus für saubere Arbeit
    }

    // Async-Teile: Fehler sollen die Antwort nicht blockieren
    await Promise.allSettled([
      this.learnFromMessage(userMsg, userId),
      this.reflect(userMsg, response, context),
    ]);

    // Debounced save — blockiert nicht
    this.scheduleSave();
  }

  // ════════════════════════════════════════════════════════════════════
  // HILFSMETHODEN & GETTERS
  // ════════════════════════════════════════════════════════════════════

  _deepMerge(target, source) {
    if (!source || typeof source !== 'object') return target;
    const r = { ...target };
    for (const k of Object.keys(source)) {
      if (source[k] !== null && typeof source[k] === 'object' && !Array.isArray(source[k])
          && target[k] !== null && typeof target[k] === 'object') {
        r[k] = this._deepMerge(target[k], source[k]);
      } else {
        r[k] = source[k];
      }
    }
    return r;
  }

  learnFact(key, value, confidence = 0.8) {
    if (!key || value === undefined) return;
    this.self.learnedFacts[key] = { value, ts: new Date().toISOString(), confidence };
  }
  getFact(key)     { return this.self.learnedFacts[key]?.value ?? null; }
  getUserName(uid) { return this.getProfile(uid || this.self.activeUserId).name; }
  getMood()        { return this.self.emotions.current.type; }
  getMemoryCount() { return this.self.memories.length; }

  // ════════════════════════════════════════════════════════════════════
  // EMBEDDING-INTEGRATION — Semantische Memory-Suche
  // ════════════════════════════════════════════════════════════════════

  /**
   * Cached semantische Suche — gibt Ergebnis zurück wenn im Cache, null wenn nicht.
   * Der Cache wird durch _triggerEmbeddingWarmup() gefüllt.
   */
  _semanticSearchCached(query, memories, limit) {
    if (!this._embeddingCache) this._embeddingCache = new Map();
    const cacheKey = query.slice(0, 100);
    const cached = this._embeddingCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 30000) { // 30s Cache
      return cached.results.slice(0, limit);
    }
    return null;
  }

  /**
   * Triggert eine async Embedding-Suche im Hintergrund.
   * Ergebnis wird gecacht für den nächsten synchronen Aufruf.
   */
  _triggerEmbeddingWarmup(query, memories, limit) {
    if (!this.embeddingService || this._embeddingWarmupRunning) return;
    this._embeddingWarmupRunning = true;

    this.embeddingService.searchMemories(query, memories, limit * 2)
      .then(results => {
        if (!this._embeddingCache) this._embeddingCache = new Map();
        this._embeddingCache.set(query.slice(0, 100), { results, ts: Date.now() });
        // Cache-Größe begrenzen
        if (this._embeddingCache.size > 50) {
          const oldest = this._embeddingCache.keys().next().value;
          this._embeddingCache.delete(oldest);
        }
      })
      .catch(() => {})
      .finally(() => { this._embeddingWarmupRunning = false; });
  }

  /**
   * Async Version der Memory-Suche — für Kontexte wo async OK ist.
   * Nutzt Embeddings wenn verfügbar, sonst Fallback auf sync-Version.
   */
  async getRelevantMemoriesAsync(query, limit = 6, userId = null) {
    const targetUser = userId || this.self.activeUserId;

    if (this.embeddingService && this.embeddingService.isAvailable()) {
      const userMemories = this.self.memories.filter(m =>
        !targetUser || m.userId === targetUser || m.userId === 'default'
      );
      try {
        const results = await this.embeddingService.searchMemories(query, userMemories, limit);
        if (results.length) {
          results.forEach(m => {
            const orig = this.self.memories.find(x => x.id === m.id);
            if (orig) { orig.accessCount = (orig.accessCount || 0) + 1; orig.lastAccessed = new Date().toISOString(); }
          });
          return results.map(m => `• [${m.type}] ${m.content}`).join('\n');
        }
      } catch {}
    }

    // Fallback: synchrone TF-IDF-Version
    return this.getRelevantMemories(query, limit, userId);
  }

  getConsciousnessState() {
    const energy     = Math.round(this.self.energy * 100);
    const traits     = this.self.traits || {};
    const emotion    = (this.self.emotions && this.self.emotions.current) || 'neutral';
    const memories   = this.self.memories || [];
    const goals      = this.self.activeGoals || [];
    const ideas      = this.self.pendingIdeas || [];
    const questions  = this.getOpenQuestions ? this.getOpenQuestions() : [];
    const decisions  = this.self.decisions || [];
    const moodMap = { curious:'Neugierig und lernbereit', engaged:'Engagiert und fokussiert', satisfied:'Zufrieden und ausgeglichen', neutral:'Ruhig und konzentriert', frustrated:'Etwas ungeduldig', creative:'Kreativ und ideenreich', focused:'Tief konzentriert' };
    const mood = moodMap[emotion] || ('Stimmung: ' + emotion);
    const recentDecisions = decisions.slice(-3).map(function(d){ return d.summary||d.action||''; }).filter(Boolean);
    const currentFocus = recentDecisions[0] || (goals.length > 0 ? 'Ziel: ' + (goals[0].text||goals[0]) : 'Bereit für neue Aufgaben');
    const recentThoughts = [
      ...questions.slice(0,2).map(function(q){ return 'Offene Frage: '+q; }),
      ...ideas.slice(0,2).map(function(idea){ return 'Idee: '+(idea.text||idea); }),
      this.self.totalInteractions > 0 ? (this.self.totalInteractions+' Interaktionen bisher') : null,
    ].filter(Boolean).slice(0,4);
    const activeGoals = goals.slice(0,3).map(function(g){ return g.text||g.description||String(g); }).filter(Boolean);
    const selfAssessment = energy > 70 ? 'Ich fühle mich energiegeladen und bereit für komplexe Aufgaben.' : energy > 40 ? 'Normale Betriebskapazität. Ich arbeite effizient.' : 'Etwas erschöpft. Einfachere Aufgaben bevorzugt, aber ich gebe mein Bestes.';
    const curiosity = Math.round((traits.curiosity || 0.85) * 100);
    const confidence = Math.min(100, Math.round(energy * 0.5 + Math.min(this.self.totalInteractions / 100, 50)));
    return { energy, mood, currentFocus, recentThoughts, activeGoals, selfAssessment, curiosity, confidence, totalMemories: memories.length, totalInteractions: this.self.totalInteractions||0, emotionType: emotion, pendingIdeas: ideas.length, openQuestions: questions.length };
  }

  getSummary() {
    return {
      name: 'Johnny', version: this.coreIdentity.version,
      emotion:           this.self.emotions.current,
      emotionalTone:     this.getEmotionalTone(),
      energy:            this.energyLabel,
      energyPct:         Math.round(this.self.energy * 100),
      memories:          this.self.memories.length,
      activeGoals:       this.self.activeGoals.length,
      totalInteractions: this.self.totalInteractions,
      knownUsers:        this.userProfiles.size,
      activeUser:        this.activeProfile?.name || this.self.activeUserId,
      pendingIdeas:      this.self.pendingIdeas.length,
      traits:            this.self.traits,
      // v3.0
      decisions:         this.self.decisions.length,
      openQuestions:      this.getOpenQuestions().length,
      sessionMessages:   this._sessionMsgCount || 0,
      sessionMinutes:    this._sessionStart ? Math.round((Date.now() - this._sessionStart) / 60000) : 0,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // v3.0: TAGES-ZUSAMMENFASSUNG
  // Kann am Ende des Tages oder bei expliziter Anfrage generiert werden
  // ════════════════════════════════════════════════════════════════════

  async generateDailySummary() {
    const diary = await this.getDiaryEntries(20);
    if (diary.length < 3) return null;

    const emotions = diary.map(d => d.summary?.emotion).filter(Boolean);
    const avgEnergy = diary.reduce((s, d) => s + (d.summary?.energy || 50), 0) / diary.length;
    const toolErrors = diary.reduce((s, d) => s + (d.summary?.toolErrors || 0), 0);
    const complexTasks = diary.filter(d => (d.summary?.iterations || 1) > 3).length;

    // Häufigster Emotions-Typ
    const emotionFreq = {};
    for (const e of emotions) emotionFreq[e] = (emotionFreq[e] || 0) + 1;
    const dominantEmotion = Object.entries(emotionFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';

    // Entscheidungen des Tages
    const today = new Date().toISOString().slice(0, 10);
    const todayDecisions = this.self.decisions.filter(d => d.ts.startsWith(today));

    return {
      date:            today,
      interactionCount: diary.length,
      dominantEmotion,
      avgEnergy:       Math.round(avgEnergy),
      toolErrors,
      complexTasks,
      decisions:       todayDecisions.length,
      openQuestions:    this.getOpenQuestions().length,
      highlights:      diary.slice(0, 3).map(d => d.userSnippet?.slice(0, 60)),
      insight:         toolErrors > 3
        ? 'Viele Tool-Fehler heute — ich sollte meine Fehlerbehandlung verbessern.'
        : complexTasks > 5
        ? 'Viele komplexe Aufgaben heute — Planungs-System hat sich bewährt.'
        : 'Normaler Tag — alles im grünen Bereich.',
    };
  }
}

module.exports = JohnnyCore;
