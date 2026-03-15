/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FEEDBACK LEARNING SERVICE v1.0                                      ║
 * ║                                                                      ║
 * ║  Lernen aus User-Feedback für Johnny:                               ║
 * ║  - Explizites Feedback erfassen (Ratings, Korrekturen)              ║
 * ║  - Implizites Feedback erkennen (Wiederholung, Abbruch, Ton)       ║
 * ║  - Antwort-Qualität tracken & verbessern                           ║
 * ║  - Verhaltens-Anpassung basierend auf Feedback-Mustern             ║
 * ║  - Feedback-gesteuerte Prompt-Optimierung                          ║
 * ║  - Integration mit JohnnyCore.traits                               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs').promises;
const path = require('path');
const os   = require('os');

const MAX_FEEDBACK_LOG = 1000;
const MAX_ADAPTATIONS  = 200;
const LEARNING_RATE    = 0.05;   // Wie schnell sich Verhalten anpasst

class FeedbackLearningService {
  constructor(config = {}) {
    this.dataDir      = config.dataDir || path.join(os.homedir(), '.johnny', 'feedback');
    this.johnnyCore   = config.johnnyCore;
    this.agentManager = config.agentManager;
    this.gateway      = config.gateway;

    this.feedbackLog  = [];
    this.adaptations  = new Map();   // Verhaltens-Anpassungen
    this.qualityScore = {
      overall:     0.7,
      helpfulness: 0.7,
      accuracy:    0.7,
      tone:        0.7,
      speed:       0.7,
    };
    this.userPreferences = new Map();   // userId → { preferences }
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this._loadFeedback();
    await this._loadAdaptations();
    this._recalculateScores();
    console.log(`[FeedbackLearning] ${this.feedbackLog.length} Feedbacks, Qualität: ${(this.qualityScore.overall * 100).toFixed(0)}%`);
  }

  // ════════════════════════════════════════════════════════════════════
  // FEEDBACK ERFASSEN
  // ════════════════════════════════════════════════════════════════════

  /**
   * Erfasst explizites User-Feedback
   */
  async recordFeedback(feedback) {
    const {
      userId       = 'default',
      type         = 'rating',       // 'rating'|'correction'|'preference'|'complaint'|'praise'
      rating       = null,           // 1-5 oder null
      message      = '',
      context      = {},             // { userMessage, botResponse, toolsUsed }
      category     = null,           // 'helpfulness'|'accuracy'|'tone'|'speed'|'creativity'
    } = feedback;

    const entry = {
      id:       `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts:       new Date().toISOString(),
      userId,
      type,
      rating:   rating ? Math.max(1, Math.min(5, rating)) : null,
      message:  message.slice(0, 500),
      category: category || this._detectCategory(message),
      context: {
        userMessage:  context.userMessage?.slice(0, 200) || null,
        botResponse:  context.botResponse?.slice(0, 200) || null,
        toolsUsed:    context.toolsUsed || [],
      },
      sentiment: this._analyzeSentiment(message),
      processed: false,
    };

    this.feedbackLog.push(entry);

    // Feedback verarbeiten
    await this._processFeedback(entry);

    // Log begrenzen
    if (this.feedbackLog.length > MAX_FEEDBACK_LOG) {
      this.feedbackLog = this.feedbackLog.slice(-MAX_FEEDBACK_LOG * 0.8);
    }

    this._scheduleSave();

    if (this.gateway) {
      this.gateway.publish('feedback.received', {
        id: entry.id, type, rating, category: entry.category,
      });
    }

    return entry;
  }

  /**
   * Erkennt implizites Feedback aus dem Gesprächsverlauf
   */
  detectImplicitFeedback(userMessage, previousBotResponse, context = {}) {
    const signals = [];
    const lower = userMessage.toLowerCase();

    // Wiederholung der gleichen Frage → Bot hat nicht gut geantwortet
    if (context.previousUserMessage) {
      const similarity = this._stringSimilarity(userMessage, context.previousUserMessage);
      if (similarity > 0.7) {
        signals.push({
          type: 'repetition',
          confidence: similarity,
          implication: 'negative',
          note: 'User wiederholt seine Frage — Antwort war möglicherweise unbefriedigend',
        });
      }
    }

    // Korrektur-Signale
    if (/nein|falsch|nicht richtig|das stimmt nicht|wrong|incorrect|no,? that'?s/i.test(lower)) {
      signals.push({
        type: 'correction',
        confidence: 0.8,
        implication: 'negative',
        note: 'User korrigiert Johnny',
      });
    }

    // Positive Signale
    if (/danke|super|toll|perfekt|genau|richtig|das hilft|thanks|great|perfect|exactly/i.test(lower)) {
      signals.push({
        type: 'praise',
        confidence: 0.7,
        implication: 'positive',
        note: 'User gibt positives Feedback',
      });
    }

    // Frustrations-Signale
    if (/verstehst.*nicht|kapierst.*nicht|you don'?t understand|lass es|forget it|egal/i.test(lower)) {
      signals.push({
        type: 'frustration',
        confidence: 0.85,
        implication: 'negative',
        note: 'User zeigt Frustration',
      });
    }

    // Stil-Preference-Signale
    if (/kürzer|weniger|shorter|briefer|zu lang|too long/i.test(lower)) {
      signals.push({
        type: 'preference',
        confidence: 0.9,
        implication: 'neutral',
        preference: { responseLength: 'shorter' },
        note: 'User möchte kürzere Antworten',
      });
    }

    if (/mehr detail|genauer|ausführlicher|more detail|elaborate/i.test(lower)) {
      signals.push({
        type: 'preference',
        confidence: 0.9,
        implication: 'neutral',
        preference: { responseLength: 'longer' },
        note: 'User möchte ausführlichere Antworten',
      });
    }

    if (/deutsch|auf deutsch|in german/i.test(lower)) {
      signals.push({
        type: 'preference',
        confidence: 0.95,
        implication: 'neutral',
        preference: { language: 'de' },
        note: 'User bevorzugt Deutsch',
      });
    }

    // Implizites Feedback als reguläres Feedback erfassen
    for (const signal of signals) {
      if (signal.confidence > 0.6) {
        this.recordFeedback({
          userId: context.userId,
          type: signal.type === 'praise' ? 'praise' : signal.type === 'correction' ? 'correction' : 'implicit',
          rating: signal.implication === 'positive' ? 4 : signal.implication === 'negative' ? 2 : 3,
          message: signal.note,
          context: { userMessage, botResponse: previousBotResponse },
          category: signal.type === 'preference' ? 'tone' : 'helpfulness',
        });

        if (signal.preference) {
          this._updatePreference(context.userId || 'default', signal.preference);
        }
      }
    }

    return signals;
  }

  // ════════════════════════════════════════════════════════════════════
  // FEEDBACK VERARBEITEN & LERNEN
  // ════════════════════════════════════════════════════════════════════

  async _processFeedback(entry) {
    // Qualitäts-Score aktualisieren
    if (entry.rating) {
      const normalized = (entry.rating - 1) / 4;  // 0–1
      const cat = entry.category || 'overall';

      if (this.qualityScore[cat] !== undefined) {
        this.qualityScore[cat] = this.qualityScore[cat] * (1 - LEARNING_RATE) + normalized * LEARNING_RATE;
      }
      this.qualityScore.overall =
        (this.qualityScore.helpfulness + this.qualityScore.accuracy +
         this.qualityScore.tone + this.qualityScore.speed) / 4;
    }

    // Verhaltens-Anpassungen ableiten
    const adaptation = this._deriveAdaptation(entry);
    if (adaptation) {
      this.adaptations.set(adaptation.key, {
        ...adaptation,
        ts: new Date().toISOString(),
        feedbackId: entry.id,
      });

      if (this.adaptations.size > MAX_ADAPTATIONS) {
        // Älteste Anpassungen entfernen
        const sorted = [...this.adaptations.entries()].sort((a, b) =>
          new Date(a[1].ts).getTime() - new Date(b[1].ts).getTime()
        );
        this.adaptations = new Map(sorted.slice(-MAX_ADAPTATIONS * 0.8));
      }
    }

    // JohnnyCore-Traits anpassen
    if (this.johnnyCore && entry.rating) {
      this._adjustTraits(entry);
    }

    entry.processed = true;
  }

  _deriveAdaptation(entry) {
    if (!entry.message && !entry.rating) return null;

    const lower = (entry.message || '').toLowerCase();

    // Antwort-Länge
    if (/zu lang|kürzer|too long|shorter|weniger text/i.test(lower)) {
      return { key: 'response_length', direction: 'shorter', strength: 0.3 };
    }
    if (/zu kurz|ausführlicher|too short|longer|mehr detail/i.test(lower)) {
      return { key: 'response_length', direction: 'longer', strength: 0.3 };
    }

    // Formalität
    if (/formeller|professional|förmlich/i.test(lower)) {
      return { key: 'formality', direction: 'more_formal', strength: 0.3 };
    }
    if (/locker|casual|entspannt|weniger formal/i.test(lower)) {
      return { key: 'formality', direction: 'less_formal', strength: 0.3 };
    }

    // Technisches Level
    if (/zu technisch|einfacher|simpler|anfänger/i.test(lower)) {
      return { key: 'technical_level', direction: 'simpler', strength: 0.3 };
    }
    if (/technischer|fortgeschritten|advanced|detail/i.test(lower)) {
      return { key: 'technical_level', direction: 'more_technical', strength: 0.3 };
    }

    // Humor
    if (/mehr humor|witziger|lustiger|funnier/i.test(lower)) {
      return { key: 'humor', direction: 'more', strength: 0.2 };
    }
    if (/weniger humor|ernst|sachlich|serious/i.test(lower)) {
      return { key: 'humor', direction: 'less', strength: 0.2 };
    }

    // Proaktivität
    if (/mach einfach|handle das|just do it|nicht fragen/i.test(lower)) {
      return { key: 'proactivity', direction: 'more', strength: 0.3 };
    }
    if (/erst fragen|frag vorher|ask first|bestätig/i.test(lower)) {
      return { key: 'proactivity', direction: 'less', strength: 0.3 };
    }

    // Negatives Rating ohne spezifisches Feedback
    if (entry.rating && entry.rating <= 2) {
      return { key: `quality_${entry.category || 'general'}`, direction: 'improve', strength: 0.1 };
    }

    return null;
  }

  _adjustTraits(entry) {
    if (!this.johnnyCore?.self?.traits) return;
    const traits = this.johnnyCore.self.traits;
    const delta = LEARNING_RATE * 0.5;

    if (entry.rating >= 4) {
      // Positive Feedback → aktuelle Traits verstärken
      this.johnnyCore.self.interactionStats.positiveFeedback++;
    } else if (entry.rating <= 2) {
      // Negative Feedback → Traits anpassen
      this.johnnyCore.self.interactionStats.negativeFeedback++;

      const cat = entry.category;
      if (cat === 'tone') {
        traits.empathy = Math.min(1, traits.empathy + delta);
        traits.patience = Math.min(1, traits.patience + delta);
      }
      if (cat === 'helpfulness') {
        traits.initiative = Math.min(1, traits.initiative + delta);
      }
      if (cat === 'accuracy') {
        traits.selfAwareness = Math.min(1, traits.selfAwareness + delta);
      }
    }
  }

  _updatePreference(userId, preference) {
    const current = this.userPreferences.get(userId) || {};
    this.userPreferences.set(userId, {
      ...current,
      ...preference,
      lastUpdated: new Date().toISOString(),
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // ANPASSUNGEN ABFRAGEN
  // ════════════════════════════════════════════════════════════════════

  /**
   * Gibt Stil-Hinweise basierend auf gelerntem Feedback zurück
   * Kann in buildSystemPrompt() integriert werden
   */
  getStyleHints(userId = 'default') {
    const hints = [];
    const prefs = this.userPreferences.get(userId) || {};

    // User-Präferenzen
    if (prefs.responseLength === 'shorter') hints.push('Antworte prägnant und kurz.');
    if (prefs.responseLength === 'longer') hints.push('Antworte ausführlich mit Details.');
    if (prefs.language) hints.push(`Bevorzugte Sprache: ${prefs.language}`);

    // Gelernte Anpassungen
    for (const [key, adapt] of this.adaptations) {
      switch (key) {
        case 'response_length':
          if (adapt.direction === 'shorter') hints.push('User bevorzugt kürzere Antworten.');
          if (adapt.direction === 'longer') hints.push('User möchte detaillierte Antworten.');
          break;
        case 'formality':
          if (adapt.direction === 'more_formal') hints.push('Formellerer Ton gewünscht.');
          if (adapt.direction === 'less_formal') hints.push('Lockerer, informeller Ton gewünscht.');
          break;
        case 'technical_level':
          if (adapt.direction === 'simpler') hints.push('Einfachere Erklärungen verwenden.');
          if (adapt.direction === 'more_technical') hints.push('Technisch detailliert antworten.');
          break;
        case 'humor':
          if (adapt.direction === 'more') hints.push('Mehr Humor einsetzen.');
          if (adapt.direction === 'less') hints.push('Sachlich und ernst bleiben.');
          break;
        case 'proactivity':
          if (adapt.direction === 'more') hints.push('Proaktiv handeln, weniger fragen.');
          if (adapt.direction === 'less') hints.push('Vor Aktionen nachfragen.');
          break;
      }
    }

    // Qualitäts-basierte Hinweise
    if (this.qualityScore.accuracy < 0.5) {
      hints.push('ACHTUNG: Genauigkeit niedrig — Antworten sorgfältig prüfen.');
    }
    if (this.qualityScore.tone < 0.5) {
      hints.push('ACHTUNG: Ton-Feedback negativ — empathischer antworten.');
    }

    return hints;
  }

  /**
   * Gibt die aktuellen Qualitäts-Scores zurück
   */
  getQualityScores() {
    return { ...this.qualityScore };
  }

  /**
   * Gibt Feedback-Statistiken zurück
   */
  getStats() {
    const byType = {};
    const byCategory = {};
    const ratings = [];

    for (const fb of this.feedbackLog) {
      byType[fb.type] = (byType[fb.type] || 0) + 1;
      if (fb.category) byCategory[fb.category] = (byCategory[fb.category] || 0) + 1;
      if (fb.rating) ratings.push(fb.rating);
    }

    const avgRating = ratings.length
      ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 100) / 100
      : null;

    return {
      totalFeedback:   this.feedbackLog.length,
      byType,
      byCategory,
      averageRating:   avgRating,
      qualityScores:   this.qualityScore,
      adaptations:     this.adaptations.size,
      userPreferences: this.userPreferences.size,
      recentTrend:     this._getRecentTrend(),
    };
  }

  _getRecentTrend() {
    const recent = this.feedbackLog.slice(-20);
    const ratings = recent.filter(f => f.rating).map(f => f.rating);
    if (ratings.length < 5) return 'insufficient_data';

    const firstHalf = ratings.slice(0, Math.floor(ratings.length / 2));
    const secondHalf = ratings.slice(Math.floor(ratings.length / 2));
    const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (avg2 > avg1 + 0.3) return 'improving';
    if (avg2 < avg1 - 0.3) return 'declining';
    return 'stable';
  }

  // ════════════════════════════════════════════════════════════════════
  // NLP-HILFS-METHODEN
  // ════════════════════════════════════════════════════════════════════

  _analyzeSentiment(text) {
    if (!text) return 0;
    const lower = text.toLowerCase();
    const pos = ['super', 'toll', 'gut', 'danke', 'perfekt', 'genial', 'great', 'awesome', 'thanks', 'perfect', 'love', 'amazing'];
    const neg = ['schlecht', 'falsch', 'fehler', 'nervig', 'schlimm', 'bad', 'wrong', 'terrible', 'awful', 'hate', 'useless'];
    let score = 0;
    for (const w of pos) if (lower.includes(w)) score += 0.25;
    for (const w of neg) if (lower.includes(w)) score -= 0.25;
    return Math.max(-1, Math.min(1, score));
  }

  _detectCategory(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (/richtig|falsch|korrekt|genau|wrong|correct|accura/i.test(lower)) return 'accuracy';
    if (/hilf|nützlich|brauchbar|help|useful/i.test(lower)) return 'helpfulness';
    if (/ton|stil|freundlich|rude|tone|style|friendly/i.test(lower)) return 'tone';
    if (/schnell|langsam|speed|slow|fast/i.test(lower)) return 'speed';
    if (/kreativ|langweilig|creative|boring/i.test(lower)) return 'creativity';
    return null;
  }

  _stringSimilarity(a, b) {
    if (!a || !b) return 0;
    const sa = new Set(a.toLowerCase().split(/\s+/));
    const sb = new Set(b.toLowerCase().split(/\s+/));
    const inter = [...sa].filter(x => sb.has(x)).length;
    const union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  _recalculateScores() {
    const recent = this.feedbackLog.slice(-100);
    const byCategory = { helpfulness: [], accuracy: [], tone: [], speed: [] };

    for (const fb of recent) {
      if (fb.rating && fb.category && byCategory[fb.category]) {
        byCategory[fb.category].push((fb.rating - 1) / 4);
      }
    }

    for (const [cat, scores] of Object.entries(byCategory)) {
      if (scores.length >= 5) {
        this.qualityScore[cat] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100;
      }
    }

    this.qualityScore.overall =
      (this.qualityScore.helpfulness + this.qualityScore.accuracy +
       this.qualityScore.tone + this.qualityScore.speed) / 4;
  }

  // ── Persistenz ───────────────────────────────────────────────────────

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(async () => {
      this._saveTimer = null;
      await this._save();
    }, 5000);
  }

  async _loadFeedback() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'feedback.json'), 'utf-8');
      this.feedbackLog = JSON.parse(raw);
    } catch { this.feedbackLog = []; }

    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'preferences.json'), 'utf-8');
      this.userPreferences = new Map(Object.entries(JSON.parse(raw)));
    } catch { this.userPreferences = new Map(); }
  }

  async _loadAdaptations() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'adaptations.json'), 'utf-8');
      this.adaptations = new Map(Object.entries(JSON.parse(raw)));
    } catch { this.adaptations = new Map(); }
  }

  async _save() {
    try {
      const write = async (name, data) => {
        const tmp = path.join(this.dataDir, `${name}.tmp`);
        const fin = path.join(this.dataDir, `${name}.json`);
        await fs.writeFile(tmp, JSON.stringify(data, null, 2));
        await fs.rename(tmp, fin);
      };

      await write('feedback', this.feedbackLog);
      await write('adaptations', Object.fromEntries(this.adaptations));
      await write('preferences', Object.fromEntries(this.userPreferences));
    } catch (e) {
      console.error('[FeedbackLearning] Speichern fehlgeschlagen:', e.message);
    }
  }
}

module.exports = FeedbackLearningService;
