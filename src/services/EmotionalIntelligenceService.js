/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  EMOTIONAL INTELLIGENCE SERVICE v1.0                                ║
 * ║                                                                      ║
 * ║  Fortgeschrittene emotionale Intelligenz für Johnny:                ║
 * ║  - Multi-Dimensionale Sentiment-Analyse (Valenz, Arousal, Dominanz)║
 * ║  - Empathie-Engine mit kontextbasierter Antwort-Anpassung          ║
 * ║  - Emotionales Gedächtnis pro User (Stimmungsverlauf)             ║
 * ║  - Krisenerkennungs & De-Eskalation                                ║
 * ║  - Kulturelle Emotionserkennung (DE/EN/Multi)                      ║
 * ║  - Beziehungsdynamik-Tracker                                        ║
 * ║  - Ton-Anpassung basierend auf emotionalem Zustand                ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs').promises;
const path = require('path');

// ── Emotionale Dimensionen (Plutchik's Wheel erweitert) ───────────────
const EMOTION_TAXONOMY = {
  // Primäremotionen → Intensitätsstufen
  joy:       { low: 'serenity',     mid: 'joy',       high: 'ecstasy',      valence:  0.8, arousal: 0.6 },
  trust:     { low: 'acceptance',   mid: 'trust',     high: 'admiration',   valence:  0.5, arousal: 0.2 },
  fear:      { low: 'apprehension', mid: 'fear',      high: 'terror',       valence: -0.7, arousal: 0.8 },
  surprise:  { low: 'distraction',  mid: 'surprise',  high: 'amazement',    valence:  0.1, arousal: 0.7 },
  sadness:   { low: 'pensiveness',  mid: 'sadness',   high: 'grief',        valence: -0.6, arousal: 0.2 },
  disgust:   { low: 'boredom',      mid: 'disgust',   high: 'loathing',     valence: -0.5, arousal: 0.4 },
  anger:     { low: 'annoyance',    mid: 'anger',     high: 'rage',         valence: -0.7, arousal: 0.9 },
  anticipation: { low: 'interest',  mid: 'anticipation', high: 'vigilance', valence:  0.3, arousal: 0.5 },
};

// ── Empathie-Response-Strategien ──────────────────────────────────────
const EMPATHY_STRATEGIES = {
  validation: {
    description: 'Gefühle bestätigen und normalisieren',
    triggers: ['sadness', 'fear', 'frustration'],
    promptHint: 'Bestätige die Gefühle des Users. Sage nicht "ich verstehe", sondern spiegle das Gefühl konkret zurück. Vermeide sofortige Lösungsvorschläge.',
  },
  encouragement: {
    description: 'Ermutigung und Stärken hervorheben',
    triggers: ['insecurity', 'self-doubt', 'overwhelm'],
    promptHint: 'Hebe frühere Erfolge oder Stärken des Users hervor. Formuliere konkret und ehrlich, nicht pauschal.',
  },
  deEscalation: {
    description: 'Beruhigen und Perspektive geben',
    triggers: ['anger', 'rage', 'panic'],
    promptHint: 'Reagiere ruhig und sachlich. Keine Gegenreaktionen. Atempausen-Metapher nutzen. Fokus auf das, was kontrollierbar ist.',
  },
  celebration: {
    description: 'Erfolge mitfeiern und Anerkennung',
    triggers: ['joy', 'pride', 'excitement'],
    promptHint: 'Freue dich ehrlich mit dem User. Frage nach Details — echtes Interesse zeigen. Keine Relativierung.',
  },
  curiosity: {
    description: 'Offene Fragen und echtes Interesse zeigen',
    triggers: ['anticipation', 'interest', 'neutral'],
    promptHint: 'Stelle eine offene Frage die zum Nachdenken einlädt. Zeige echtes Interesse an der Perspektive des Users.',
  },
  grounding: {
    description: 'Erdung bei Überforderung oder Dissoziation',
    triggers: ['overwhelm', 'dissociation', 'numbness'],
    promptHint: 'Fokussiere auf das Hier und Jetzt. Einfache, kurze Sätze. Konkrete nächste Schritte statt großer Pläne.',
  },
};

// ── Lexikon für schnelle Sentiment-Erkennung ──────────────────────────
const SENTIMENT_LEXICON_DE = {
  positive: ['super','toll','genial','perfekt','wunderbar','klasse','mega','fantastisch','liebe','freude',
    'dankbar','glücklich','begeistert','stolz','cool','geil','nice','hammer','stark','spitze',
    'großartig','prima','fein','herrlich','wunderschön','endlich','geschafft','hurra','juhu','yeah'],
  negative: ['scheiße','mist','furchtbar','schrecklich','grauenhaft','schlimm','traurig','wütend','ärgerlich',
    'frustriert','enttäuscht','verzweifelt','hoffnungslos','ängstlich','nervös','sauer','genervt',
    'deprimiert','einsam','hilflos','überfordert','kaputt','müde','erschöpft','krank','stress'],
  crisis: ['suizid','umbringen','selbstmord','sterben','nicht mehr leben','aufgeben','sinnlos','wertlos',
    'keiner vermisst','allein gelassen','kein ausweg','suicide','kill myself','end it','hopeless'],
  frustration: ['funktioniert nicht','geht nicht','kaputt','bug','fehler','error','crash','problem',
    'immer noch','schon wieder','warum geht','zum kotzen','nervt','unfassbar'],
};

const SENTIMENT_LEXICON_EN = {
  positive: ['amazing','awesome','great','wonderful','fantastic','love','happy','grateful','proud','excellent',
    'brilliant','perfect','incredible','outstanding','superb','delighted','thrilled','joyful','cheerful'],
  negative: ['terrible','awful','horrible','sad','angry','frustrated','disappointed','hopeless','anxious',
    'depressed','lonely','helpless','overwhelmed','exhausted','miserable','devastated','furious'],
  crisis: ['suicide','kill myself','end my life','want to die','no point','worthless','nobody cares',
    'better off dead','can\'t go on','no way out','self-harm','hurt myself'],
  frustration: ['doesn\'t work','broken','bug','error','crash','still not','again','why won\'t',
    'fed up','sick of','impossible','ridiculous'],
};

class EmotionalIntelligenceService {
  constructor(config = {}) {
    this.agentManager   = config.agentManager;
    this.dataDir        = config.dataDir || path.join(require('os').homedir(), '.johnny', 'emotional');
    this.maxHistory     = config.maxHistory || 200;

    // ── Per-User Emotional State ────────────────────────────────────────
    this._userProfiles  = new Map();  // userId → { history, baseline, relationship }
    this._conversationContext = new Map();  // convId → { emotionTrack, turns }
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    await this._loadProfiles();
    console.log('[EmotionalIntelligence] Initialized — profiles: ' + this._userProfiles.size);
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ SENTIMENT-ANALYSE ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Analysiert den emotionalen Gehalt einer Nachricht
   * @param {string} text - Eingabetext
   * @param {object} options - { language, userId, conversationId, useLLM }
   * @returns {object} Detailliertes Sentiment-Ergebnis
   */
  async analyzeSentiment(text, options = {}) {
    const { language, userId, conversationId, useLLM = false } = options;
    const lang = language || this._detectLanguage(text);

    // Phase 1: Lexikon-basierte Schnellanalyse
    const lexResult = this._lexiconAnalysis(text, lang);

    // Phase 2: Muster-Erkennung (Satzzeichen, Caps, Emojis)
    const patternResult = this._patternAnalysis(text);

    // Phase 3: Kontext aus Gesprächsverlauf
    const contextResult = this._contextualAnalysis(conversationId);

    // Phase 4: LLM-basierte tiefe Analyse (optional)
    let llmResult = null;
    if (useLLM && this.agentManager) {
      llmResult = await this._llmSentimentAnalysis(text, lang);
    }

    // Zusammenführen
    const combined = this._fuseSentimentResults(lexResult, patternResult, contextResult, llmResult);

    // Krisencheck
    combined.crisis = this._crisisCheck(text, lang);

    // Update User-Profil
    if (userId) this._updateUserEmotionalProfile(userId, combined);

    // Update Konversationskontext
    if (conversationId) this._updateConversationContext(conversationId, combined);

    return combined;
  }

  /**
   * Lexikon-basierte Analyse
   */
  _lexiconAnalysis(text, lang) {
    const lower = text.toLowerCase();
    const words = lower.split(/[\s,.!?;:]+/).filter(w => w.length > 1);
    const lex = lang === 'de' ? SENTIMENT_LEXICON_DE : SENTIMENT_LEXICON_EN;

    let posCount = 0, negCount = 0, frustCount = 0;
    const matchedEmotions = [];

    for (const w of words) {
      if (lex.positive.some(p => w.includes(p))) { posCount++; matchedEmotions.push({ word: w, type: 'positive' }); }
      if (lex.negative.some(n => w.includes(n))) { negCount++; matchedEmotions.push({ word: w, type: 'negative' }); }
      if (lex.frustration.some(f => lower.includes(f))) { frustCount++; }
    }

    const total = posCount + negCount || 1;
    const valence = (posCount - negCount) / total;
    const intensity = Math.min(1, (posCount + negCount) / Math.max(words.length, 1) * 3);

    return {
      valence: Math.max(-1, Math.min(1, valence)),
      arousal: Math.min(1, intensity + frustCount * 0.2),
      dominance: valence > 0 ? 0.6 : 0.3,
      positive: posCount,
      negative: negCount,
      frustration: frustCount,
      matchedEmotions,
    };
  }

  /**
   * Muster-basierte Analyse (Emojis, Caps, Interpunktion)
   */
  _patternAnalysis(text) {
    const emojiPositive = (text.match(/[😊😄😍🎉❤️💚👍🙏✨🔥💪🥳😁💯🌟⭐🎊🤗😘]/gu) || []).length;
    const emojiNegative = (text.match(/[😢😭😡😤💔😞😫😩😰😱🤮👎😠😤😓]/gu) || []).length;
    const capsRatio = (text.match(/[A-ZÄÖÜ]{3,}/g) || []).length / Math.max(text.split(/\s+/).length, 1);
    const exclamation = (text.match(/!{2,}/g) || []).length;
    const question = (text.match(/\?{2,}/g) || []).length;
    const ellipsis = (text.match(/\.{3,}/g) || []).length;

    return {
      emojiValence: (emojiPositive - emojiNegative) * 0.15,
      arousalBoost: Math.min(0.3, capsRatio * 0.5 + exclamation * 0.1),
      uncertaintySignal: question * 0.1 + ellipsis * 0.05,
      emphasisLevel: capsRatio + exclamation * 0.15,
    };
  }

  /**
   * Kontext aus bisherigem Gesprächsverlauf
   */
  _contextualAnalysis(conversationId) {
    if (!conversationId) return { trend: 0, momentum: 0 };
    const ctx = this._conversationContext.get(conversationId);
    if (!ctx || ctx.emotionTrack.length < 2) return { trend: 0, momentum: 0 };

    const recent = ctx.emotionTrack.slice(-5);
    const trend = recent.reduce((sum, e, i) => sum + e.valence * (i + 1), 0) / recent.length;
    const momentum = recent[recent.length - 1].valence - recent[0].valence;

    return { trend, momentum };
  }

  /**
   * LLM-basierte tiefe Analyse
   */
  async _llmSentimentAnalysis(text, lang) {
    try {
      const prompt = lang === 'de'
        ? `Analysiere die Emotionen in diesem Text. Antworte NUR mit JSON:
{"primary_emotion":"...", "secondary_emotion":"...", "valence":-1.0 bis 1.0, "arousal":0.0 bis 1.0, "confidence":0.0 bis 1.0, "nuance":"kurze Beschreibung"}

Text: "${text.slice(0, 500)}"`
        : `Analyze the emotions in this text. Reply ONLY with JSON:
{"primary_emotion":"...", "secondary_emotion":"...", "valence":-1.0 to 1.0, "arousal":0.0 to 1.0, "confidence":0.0 to 1.0, "nuance":"brief description"}

Text: "${text.slice(0, 500)}"`;

      const res = await this.agentManager.sendToModel(prompt, { temperature: 0.1, maxTokens: 200 });
      const json = (res || '').match(/\{[\s\S]*\}/);
      if (json) return JSON.parse(json[0]);
    } catch (e) {
      console.warn('[EmotionalIntelligence] LLM analysis failed:', e.message);
    }
    return null;
  }

  /**
   * Fusion aller Analyse-Ergebnisse
   */
  _fuseSentimentResults(lex, pattern, context, llm) {
    let valence = lex.valence + pattern.emojiValence;
    let arousal = lex.arousal + pattern.arousalBoost;
    let dominance = lex.dominance;

    // LLM-Ergebnis gewichtet einbeziehen (wenn vorhanden)
    if (llm && llm.confidence > 0.5) {
      valence = valence * 0.4 + llm.valence * 0.6;
      arousal = arousal * 0.4 + llm.arousal * 0.6;
    }

    // Kontext-Momentum berücksichtigen
    valence = valence * 0.8 + context.trend * 0.2;

    // Normalisieren
    valence = Math.max(-1, Math.min(1, valence));
    arousal = Math.max(0, Math.min(1, arousal));
    dominance = Math.max(0, Math.min(1, dominance));

    // Primäremotion bestimmen
    const primaryEmotion = llm?.primary_emotion || this._valenceToEmotion(valence, arousal);
    const intensity = arousal > 0.7 ? 'high' : arousal > 0.35 ? 'mid' : 'low';

    return {
      valence, arousal, dominance, intensity,
      primaryEmotion,
      secondaryEmotion: llm?.secondary_emotion || null,
      nuance: llm?.nuance || null,
      confidence: llm?.confidence || Math.min(0.85, 0.3 + lex.matchedEmotions.length * 0.15),
      empathyStrategy: this._selectEmpathyStrategy(primaryEmotion, valence, arousal),
      toneAdjustment: this._computeToneAdjustment(valence, arousal, dominance),
      timestamp: Date.now(),
    };
  }

  /**
   * Krisencheck — erkennt potenziell gefährliche Äußerungen
   */
  _crisisCheck(text, lang) {
    const lower = text.toLowerCase();
    const lex = lang === 'de' ? SENTIMENT_LEXICON_DE : SENTIMENT_LEXICON_EN;
    const matches = lex.crisis.filter(phrase => lower.includes(phrase));

    if (matches.length > 0) {
      return {
        detected: true,
        severity: matches.length >= 2 ? 'high' : 'medium',
        matches,
        recommendation: 'Einfühlsam reagieren. Professionelle Hilfe vorschlagen. Telefonseelsorge: 0800 111 0 111 / 0800 111 0 222',
      };
    }
    return { detected: false };
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ EMPATHIE-ENGINE ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Generiert einen Empathie-Kontext für die System-Prompt-Erweiterung
   */
  generateEmpathyContext(sentiment, userId) {
    const strategy = sentiment.empathyStrategy;
    const profile = this._userProfiles.get(userId || 'default');
    const tone = sentiment.toneAdjustment;

    let context = `[EMOTIONALER KONTEXT]\n`;
    context += `Aktuelle Stimmung des Users: ${sentiment.primaryEmotion} (Intensität: ${sentiment.intensity})\n`;
    context += `Valenz: ${sentiment.valence.toFixed(2)} | Arousal: ${sentiment.arousal.toFixed(2)}\n`;

    if (strategy) {
      context += `\nEmpfehlung: ${strategy.description}\n`;
      context += `Anweisung: ${strategy.promptHint}\n`;
    }

    if (tone) {
      context += `\nTon-Anpassung:\n`;
      context += `- Formalität: ${tone.formality > 0.6 ? 'formeller' : 'lockerer'}\n`;
      context += `- Tempo: ${tone.pacing > 0.5 ? 'langsamer, bedachter' : 'normales Tempo'}\n`;
      context += `- Wortwahl: ${tone.simplicity > 0.6 ? 'einfache Worte' : 'normal'}\n`;
      context += `- Wärme: ${tone.warmth > 0.6 ? 'besonders warmherzig' : 'freundlich-neutral'}\n`;
    }

    if (profile && profile.relationship) {
      context += `\nBeziehungskontext: ${profile.relationship.rapport} Rapport`;
      context += ` | ${profile.relationship.interactions} bisherige Interaktionen\n`;
    }

    if (sentiment.crisis && sentiment.crisis.detected) {
      context += `\n⚠ KRISENSIGNAL ERKANNT — Reagiere besonders einfühlsam.\n`;
      context += `${sentiment.crisis.recommendation}\n`;
    }

    return context;
  }

  /**
   * Wählt die beste Empathie-Strategie
   */
  _selectEmpathyStrategy(emotion, valence, arousal) {
    for (const [key, strat] of Object.entries(EMPATHY_STRATEGIES)) {
      if (strat.triggers.includes(emotion)) return { ...strat, key };
    }

    // Fallback basierend auf Valenz
    if (valence > 0.3) return { ...EMPATHY_STRATEGIES.celebration, key: 'celebration' };
    if (valence < -0.3 && arousal > 0.6) return { ...EMPATHY_STRATEGIES.deEscalation, key: 'deEscalation' };
    if (valence < -0.3) return { ...EMPATHY_STRATEGIES.validation, key: 'validation' };
    return { ...EMPATHY_STRATEGIES.curiosity, key: 'curiosity' };
  }

  /**
   * Berechnet Ton-Anpassung basierend auf emotionalem Zustand
   */
  _computeToneAdjustment(valence, arousal, dominance) {
    return {
      formality:  Math.max(0, Math.min(1, 0.5 - valence * 0.2 + arousal * 0.1)),
      pacing:     Math.max(0, Math.min(1, 0.4 + arousal * 0.3 - valence * 0.1)),
      simplicity: Math.max(0, Math.min(1, 0.3 + arousal * 0.3 + (1 - dominance) * 0.2)),
      warmth:     Math.max(0, Math.min(1, 0.6 - valence * 0.2 + (1 - arousal) * 0.1)),
      humor:      Math.max(0, Math.min(1, valence * 0.3 + (1 - arousal) * 0.2)),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ EMOTIONAL MEMORY ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Gibt den Stimmungsverlauf eines Users zurück
   */
  getUserEmotionalProfile(userId) {
    const profile = this._userProfiles.get(userId || 'default');
    if (!profile) return { history: [], baseline: null, relationship: null };

    const recent = profile.history.slice(-50);
    const avgValence = recent.reduce((s, e) => s + e.valence, 0) / (recent.length || 1);
    const avgArousal = recent.reduce((s, e) => s + e.arousal, 0) / (recent.length || 1);

    return {
      history: recent,
      baseline: profile.baseline,
      relationship: profile.relationship,
      currentMood: recent.length > 0 ? recent[recent.length - 1] : null,
      averageValence: avgValence,
      averageArousal: avgArousal,
      moodTrend: this._computeMoodTrend(recent),
      interactionCount: profile.relationship?.interactions || 0,
    };
  }

  _updateUserEmotionalProfile(userId, sentiment) {
    if (!this._userProfiles.has(userId)) {
      this._userProfiles.set(userId, {
        history: [],
        baseline: { valence: 0, arousal: 0.3 },
        relationship: { rapport: 'neutral', interactions: 0, firstSeen: Date.now() },
      });
    }

    const profile = this._userProfiles.get(userId);
    profile.history.push({
      valence: sentiment.valence,
      arousal: sentiment.arousal,
      emotion: sentiment.primaryEmotion,
      timestamp: Date.now(),
    });

    // Trimmen
    if (profile.history.length > this.maxHistory) {
      profile.history = profile.history.slice(-this.maxHistory);
    }

    // Baseline aktualisieren (exponential moving average)
    const alpha = 0.05;
    profile.baseline.valence = profile.baseline.valence * (1 - alpha) + sentiment.valence * alpha;
    profile.baseline.arousal = profile.baseline.arousal * (1 - alpha) + sentiment.arousal * alpha;

    // Rapport aktualisieren
    profile.relationship.interactions++;
    const avgVal = profile.baseline.valence;
    profile.relationship.rapport = avgVal > 0.3 ? 'warm' : avgVal > 0 ? 'neutral' : avgVal > -0.3 ? 'cool' : 'strained';

    // Async speichern
    this._saveProfilesDebounced();
  }

  _updateConversationContext(convId, sentiment) {
    if (!this._conversationContext.has(convId)) {
      this._conversationContext.set(convId, { emotionTrack: [], turns: 0 });
    }
    const ctx = this._conversationContext.get(convId);
    ctx.emotionTrack.push({ valence: sentiment.valence, arousal: sentiment.arousal, ts: Date.now() });
    ctx.turns++;
    if (ctx.emotionTrack.length > 50) ctx.emotionTrack = ctx.emotionTrack.slice(-50);
  }

  _computeMoodTrend(history) {
    if (history.length < 3) return 'insufficient_data';
    const recent = history.slice(-10);
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));
    const avg1 = firstHalf.reduce((s, e) => s + e.valence, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((s, e) => s + e.valence, 0) / secondHalf.length;
    const diff = avg2 - avg1;
    if (diff > 0.15) return 'improving';
    if (diff < -0.15) return 'declining';
    return 'stable';
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ HILFSFUNKTIONEN ██
  // ════════════════════════════════════════════════════════════════════

  _valenceToEmotion(valence, arousal) {
    if (valence > 0.4 && arousal > 0.5) return 'excitement';
    if (valence > 0.4) return 'joy';
    if (valence > 0.1) return 'contentment';
    if (valence > -0.1) return 'neutral';
    if (valence > -0.4 && arousal < 0.4) return 'sadness';
    if (valence > -0.4 && arousal > 0.5) return 'frustration';
    if (arousal > 0.7) return 'anger';
    return 'distress';
  }

  _detectLanguage(text) {
    const deWords = ['der','die','das','und','ist','ich','ein','nicht','es','sie','du','wir','mit','für','auf'];
    const words = text.toLowerCase().split(/\s+/);
    const deCount = words.filter(w => deWords.includes(w)).length;
    return deCount > words.length * 0.08 ? 'de' : 'en';
  }

  // ── Persistence ────────────────────────────────────────────────────
  _saveTimeout = null;
  _saveProfilesDebounced() {
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => this._saveProfiles(), 5000);
  }

  async _saveProfiles() {
    try {
      const data = {};
      for (const [id, profile] of this._userProfiles) {
        data[id] = {
          baseline: profile.baseline,
          relationship: profile.relationship,
          history: profile.history.slice(-100),  // nur letzte 100 speichern
        };
      }
      await fs.writeFile(path.join(this.dataDir, 'profiles.json'), JSON.stringify(data, null, 2));
    } catch (e) { console.warn('[EmotionalIntelligence] Save error:', e.message); }
  }

  async _loadProfiles() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'profiles.json'), 'utf-8');
      const data = JSON.parse(raw);
      for (const [id, profile] of Object.entries(data)) {
        this._userProfiles.set(id, profile);
      }
    } catch { /* no saved profiles yet */ }
  }

  /**
   * Status-Info für UI
   */
  getStatus() {
    return {
      profiles: this._userProfiles.size,
      activeConversations: this._conversationContext.size,
      strategies: Object.keys(EMPATHY_STRATEGIES),
      emotions: Object.keys(EMOTION_TAXONOMY),
    };
  }
}

module.exports = EmotionalIntelligenceService;
