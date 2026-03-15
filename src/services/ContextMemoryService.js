/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CONTEXT MEMORY SERVICE v1.0                                        ║
 * ║                                                                      ║
 * ║  Erweiterte Kontext-Speicherung für Johnny:                         ║
 * ║  - Konversations-Zusammenfassungen (automatisch nach jeder Session) ║
 * ║  - Semantische Themen-Extraktion                                    ║
 * ║  - Cross-Session Kontext-Verknüpfung                               ║
 * ║  - Langzeit- vs Kurzzeit-Gedächtnis                                ║
 * ║  - Kontext-Fenster-Optimierung für LLM-Prompts                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs').promises;
const path = require('path');
const os   = require('os');

const MAX_SUMMARIES         = 200;
const MAX_TOPICS            = 500;
const MAX_SHORT_TERM        = 50;
const SUMMARY_THRESHOLD     = 6;     // Mindest-Nachrichten bevor Summary erstellt wird
const TOPIC_SIMILARITY_THRESHOLD = 0.4;

class ContextMemoryService {
  constructor(config = {}) {
    this.dataDir     = config.dataDir || path.join(os.homedir(), '.johnny', 'context');
    this.agentManager = config.agentManager;
    this.ragService   = config.ragService;

    // ── Speicher-Ebenen ────────────────────────────────────────────────
    this.shortTerm = [];            // Aktuelle Session (flüchtig)
    this.conversationSummaries = []; // Zusammenfassungen vergangener Sessions
    this.topicGraph = new Map();    // Thema → verknüpfte Themen & Kontext
    this.userContexts = new Map();  // userId → persönlicher Kontext-Cache
    this.activeTopics = [];         // Aktuelle Themen der laufenden Session
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this._loadSummaries();
    await this._loadTopicGraph();
    console.log(`[ContextMemory] Initialisiert: ${this.conversationSummaries.length} Summaries, ${this.topicGraph.size} Themen`);
  }

  // ════════════════════════════════════════════════════════════════════
  // KURZZEIT-GEDÄCHTNIS — Tracking der aktuellen Session
  // ════════════════════════════════════════════════════════════════════

  /**
   * Trackt eine Nachricht in der aktuellen Session
   */
  trackMessage(role, content, metadata = {}) {
    const entry = {
      ts:       new Date().toISOString(),
      role,
      content:  content.slice(0, 2000),
      topics:   this._extractTopics(content),
      intent:   this._classifyIntent(content),
      sentiment: this._analyzeSentiment(content),
      ...metadata,
    };

    this.shortTerm.push(entry);

    // Aktuelle Themen aktualisieren
    for (const topic of entry.topics) {
      if (!this.activeTopics.includes(topic)) {
        this.activeTopics.push(topic);
      }
    }

    // Kurzzeit-Speicher begrenzen
    if (this.shortTerm.length > MAX_SHORT_TERM) {
      this.shortTerm = this.shortTerm.slice(-MAX_SHORT_TERM);
    }

    return entry;
  }

  /**
   * Gibt optimierten Kontext für den nächsten LLM-Prompt zurück
   */
  getContextForPrompt(userMessage, userId = 'default', maxTokensBudget = 2000) {
    const parts = [];
    const topics = this._extractTopics(userMessage);

    // 1. Relevante Summaries aus vergangenen Sessions
    const relevantSummaries = this._findRelevantSummaries(topics, userId, 3);
    if (relevantSummaries.length) {
      parts.push('RELEVANTER KONTEXT AUS FRÜHEREN GESPRÄCHEN:');
      for (const s of relevantSummaries) {
        const age = Math.round((Date.now() - new Date(s.ts).getTime()) / 86400000);
        parts.push(`[vor ${age}d] ${s.summary}`);
        if (s.keyDecisions?.length) {
          parts.push(`  Entscheidungen: ${s.keyDecisions.join('; ')}`);
        }
      }
    }

    // 2. Themen-Verknüpfungen
    const relatedContext = this._getTopicContext(topics, 3);
    if (relatedContext.length) {
      parts.push('\nVERKNÜPFTES WISSEN:');
      for (const ctx of relatedContext) {
        parts.push(`• ${ctx.topic}: ${ctx.context}`);
      }
    }

    // 3. User-spezifischer Kontext
    const userCtx = this.userContexts.get(userId);
    if (userCtx) {
      parts.push(`\nUSER-KONTEXT: ${userCtx.preferences || ''} ${userCtx.workingOn || ''}`);
    }

    // 4. Aktuelle Session-Zusammenfassung (wenn lang genug)
    if (this.shortTerm.length > 4) {
      const recentSummary = this._summarizeShortTerm();
      parts.push(`\nAKTUELLE SESSION: ${recentSummary}`);
    }

    // Token-Budget einhalten (grob: 1 Token ≈ 4 Zeichen)
    let result = parts.join('\n');
    const maxChars = maxTokensBudget * 4;
    if (result.length > maxChars) {
      result = result.slice(0, maxChars) + '\n[...gekürzt]';
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════════════
  // SESSION-ZUSAMMENFASSUNG — Am Ende jeder Konversation
  // ════════════════════════════════════════════════════════════════════

  /**
   * Erstellt eine Zusammenfassung der aktuellen Session
   * Sollte am Ende einer Konversation aufgerufen werden
   */
  async summarizeSession(userId = 'default') {
    if (this.shortTerm.length < SUMMARY_THRESHOLD) return null;

    let summary;

    // Versuche LLM-basierte Zusammenfassung
    if (this.agentManager) {
      summary = await this._llmSummarize(userId);
    } else {
      summary = this._heuristicSummarize(userId);
    }

    if (summary) {
      this.conversationSummaries.push(summary);

      // Themen-Graph aktualisieren
      this._updateTopicGraph(summary);

      // Alte Summaries aufräumen
      if (this.conversationSummaries.length > MAX_SUMMARIES) {
        this.conversationSummaries = this._compactSummaries();
      }

      // In RAG indexieren wenn verfügbar
      if (this.ragService) {
        try {
          await this.ragService.addKnowledge(
            `session_summary_${summary.id}`,
            `${summary.summary}\nThemen: ${summary.topics.join(', ')}\nEntscheidungen: ${(summary.keyDecisions || []).join('; ')}`,
            { userId, sessionId: summary.id, ts: summary.ts }
          );
        } catch (e) {
          console.warn('[ContextMemory] RAG-Indexierung fehlgeschlagen:', e.message);
        }
      }

      await this._saveSummaries();
      await this._saveTopicGraph();

      // Kurzzeit-Speicher leeren
      this.shortTerm = [];
      this.activeTopics = [];
    }

    return summary;
  }

  async _llmSummarize(userId) {
    const messages = this.shortTerm
      .map(m => `[${m.role}] ${m.content.slice(0, 300)}`)
      .join('\n');

    const prompt = `Fasse diese Konversation in 2-3 Sätzen zusammen. Extrahiere:
1. Hauptthemen (als komma-separierte Liste)
2. Getroffene Entscheidungen
3. Offene Fragen
4. Wichtige Fakten über den User

Konversation:
${messages}

Antwort als JSON:
{"summary":"...","topics":["..."],"keyDecisions":["..."],"openQuestions":["..."],"userFacts":["..."]}`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      const json = result.response.match(/\{[\s\S]*\}/);
      if (json) {
        const parsed = JSON.parse(json[0]);
        return {
          id:           `sum_${Date.now()}`,
          ts:           new Date().toISOString(),
          userId,
          summary:      parsed.summary || '',
          topics:       parsed.topics || this.activeTopics,
          keyDecisions: parsed.keyDecisions || [],
          openQuestions: parsed.openQuestions || [],
          userFacts:    parsed.userFacts || [],
          messageCount: this.shortTerm.length,
          sentiment:    this._overallSentiment(),
        };
      }
    } catch (e) {
      console.warn('[ContextMemory] LLM-Summary fehlgeschlagen, nutze Heuristik:', e.message);
    }

    return this._heuristicSummarize(userId);
  }

  _heuristicSummarize(userId) {
    const userMsgs = this.shortTerm.filter(m => m.role === 'user');
    const allTopics = [...new Set(this.shortTerm.flatMap(m => m.topics))];

    // Extrahiere wichtigste Aussagen (längste User-Nachrichten als Proxy für Wichtigkeit)
    const keyMessages = userMsgs
      .sort((a, b) => b.content.length - a.content.length)
      .slice(0, 3)
      .map(m => m.content.slice(0, 100));

    return {
      id:           `sum_${Date.now()}`,
      ts:           new Date().toISOString(),
      userId,
      summary:      `Gespräch über ${allTopics.slice(0, 4).join(', ')}. ${keyMessages[0] || ''}`,
      topics:       allTopics,
      keyDecisions: [],
      openQuestions: [],
      userFacts:    [],
      messageCount: this.shortTerm.length,
      sentiment:    this._overallSentiment(),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // THEMEN-GRAPH — Verknüpftes Wissen
  // ════════════════════════════════════════════════════════════════════

  _updateTopicGraph(summary) {
    const topics = summary.topics || [];

    for (const topic of topics) {
      if (!this.topicGraph.has(topic)) {
        this.topicGraph.set(topic, {
          firstSeen:  summary.ts,
          lastSeen:   summary.ts,
          count:      0,
          related:    [],
          contexts:   [],
          userFacts:  [],
        });
      }

      const node = this.topicGraph.get(topic);
      node.lastSeen = summary.ts;
      node.count++;

      // Verwandte Themen verknüpfen
      for (const other of topics) {
        if (other !== topic && !node.related.includes(other)) {
          node.related.push(other);
        }
      }

      // Kontext speichern
      node.contexts.push({
        ts:      summary.ts,
        snippet: summary.summary.slice(0, 200),
      });
      if (node.contexts.length > 10) node.contexts = node.contexts.slice(-8);

      // User-Fakten
      if (summary.userFacts?.length) {
        node.userFacts.push(...summary.userFacts);
        node.userFacts = [...new Set(node.userFacts)].slice(-20);
      }
    }

    // Graph-Größe begrenzen
    if (this.topicGraph.size > MAX_TOPICS) {
      const sorted = [...this.topicGraph.entries()]
        .sort((a, b) => b[1].count - a[1].count);
      this.topicGraph = new Map(sorted.slice(0, MAX_TOPICS * 0.8));
    }
  }

  _getTopicContext(topics, limit = 3) {
    const results = [];

    for (const topic of topics) {
      // Exakter Match
      if (this.topicGraph.has(topic)) {
        const node = this.topicGraph.get(topic);
        const latest = node.contexts.slice(-1)[0];
        if (latest) {
          results.push({ topic, context: latest.snippet, relevance: 1.0 });
        }
      }

      // Verwandte Themen
      for (const [key, node] of this.topicGraph) {
        if (node.related.includes(topic) || this._topicSimilarity(key, topic) > TOPIC_SIMILARITY_THRESHOLD) {
          const latest = node.contexts.slice(-1)[0];
          if (latest) {
            results.push({ topic: key, context: latest.snippet, relevance: 0.6 });
          }
        }
      }
    }

    return results
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  // ════════════════════════════════════════════════════════════════════
  // NLP-HILFS-METHODEN
  // ════════════════════════════════════════════════════════════════════

  _extractTopics(text) {
    if (!text) return [];
    const lower = text.toLowerCase();

    // Einfache Keyword-Extraktion (Nomen-ähnliche Wörter > 4 Zeichen)
    const words = lower
      .replace(/[^a-zäöüß\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4);

    // Stopwörter entfernen (DE + EN)
    const stops = new Set([
      'nicht', 'einen', 'einer', 'eines', 'diese', 'dieser', 'dieses', 'werden',
      'wurde', 'worden', 'haben', 'hatte', 'hatten', 'seine', 'seiner', 'seinem',
      'ihrer', 'ihrem', 'ihren', 'kannst', 'können', 'könnte', 'möchte', 'sollte',
      'würde', 'about', 'could', 'would', 'should', 'which', 'their', 'there',
      'where', 'these', 'those', 'through', 'after', 'before', 'between',
      'bitte', 'danke', 'schon', 'nochmal', 'vielleicht', 'eigentlich', 'einfach',
    ]);

    const filtered = words.filter(w => !stops.has(w));

    // Bi-Gramme für zusammengesetzte Begriffe
    const bigrams = [];
    for (let i = 0; i < filtered.length - 1; i++) {
      if (filtered[i].length > 3 && filtered[i + 1].length > 3) {
        bigrams.push(`${filtered[i]} ${filtered[i + 1]}`);
      }
    }

    // Häufigste Wörter als Themen
    const freq = new Map();
    for (const w of filtered) freq.set(w, (freq.get(w) || 0) + 1);

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w]) => w);
  }

  _classifyIntent(text) {
    if (!text) return 'unknown';
    const lower = text.toLowerCase();

    if (/\?|wie kann|was ist|warum|wieso|wer |wo |wann |how |what |why |who |where |when /.test(lower)) return 'question';
    if (/mach|erstell|bau|schreib|implementier|create|build|write|implement|make/.test(lower)) return 'create';
    if (/fix|reparier|beheb|korrigier|debug|repair|correct/.test(lower)) return 'fix';
    if (/erklär|explain|beschreib|describe/.test(lower)) return 'explain';
    if (/such|find|recherchier|search|look up/.test(lower)) return 'search';
    if (/änder|modifizier|update|change|modify/.test(lower)) return 'modify';
    return 'statement';
  }

  _analyzeSentiment(text) {
    if (!text) return 0;
    const lower = text.toLowerCase();

    const positive = ['super', 'toll', 'gut', 'prima', 'danke', 'perfekt', 'genial', 'great', 'awesome', 'nice', 'thanks', 'perfect', 'excellent', 'cool', 'klasse', 'wunderbar'];
    const negative = ['schlecht', 'falsch', 'fehler', 'problem', 'nervig', 'frustrierend', 'bad', 'wrong', 'error', 'annoying', 'frustrating', 'broken', 'kaputt', 'mist', 'scheiße'];

    let score = 0;
    for (const w of positive) if (lower.includes(w)) score += 0.3;
    for (const w of negative) if (lower.includes(w)) score -= 0.3;

    return Math.max(-1, Math.min(1, score));
  }

  _overallSentiment() {
    if (!this.shortTerm.length) return 0;
    const sum = this.shortTerm.reduce((acc, m) => acc + (m.sentiment || 0), 0);
    return Math.round((sum / this.shortTerm.length) * 100) / 100;
  }

  _topicSimilarity(a, b) {
    if (!a || !b) return 0;
    const sa = new Set(a.toLowerCase().split(/\s+/));
    const sb = new Set(b.toLowerCase().split(/\s+/));
    const inter = [...sa].filter(x => sb.has(x)).length;
    const union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  _summarizeShortTerm() {
    const topics = [...new Set(this.shortTerm.flatMap(m => m.topics))].slice(0, 4);
    const intents = this.shortTerm.map(m => m.intent).filter(i => i !== 'unknown');
    const mainIntent = intents.length
      ? [...new Map(intents.map(i => [i, intents.filter(x => x === i).length])).entries()]
          .sort((a, b) => b[1] - a[1])[0][0]
      : 'Gespräch';

    return `${mainIntent}-orientiert über ${topics.join(', ')} (${this.shortTerm.length} Nachrichten)`;
  }

  _findRelevantSummaries(topics, userId, limit = 3) {
    return this.conversationSummaries
      .filter(s => !userId || s.userId === userId || s.userId === 'default')
      .map(s => {
        const topicOverlap = topics.filter(t =>
          s.topics.some(st => st === t || this._topicSimilarity(st, t) > 0.5)
        ).length;
        const recency = Math.max(0, 1 - (Date.now() - new Date(s.ts).getTime()) / (1000 * 60 * 60 * 24 * 90));
        const score = topicOverlap * 0.6 + recency * 0.3 + (s.keyDecisions?.length ? 0.1 : 0);
        return { ...s, _score: score };
      })
      .filter(s => s._score > 0.1)
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
  }

  _compactSummaries() {
    // Behalte neueste + wichtigste Summaries
    const sorted = this.conversationSummaries
      .map(s => ({
        ...s,
        _priority: (s.keyDecisions?.length || 0) * 0.3
          + (s.topics?.length || 0) * 0.1
          + (1 - (Date.now() - new Date(s.ts).getTime()) / (1000 * 60 * 60 * 24 * 365)) * 0.6,
      }))
      .sort((a, b) => b._priority - a._priority);

    return sorted.slice(0, MAX_SUMMARIES * 0.8).map(({ _priority, ...s }) => s);
  }

  // ════════════════════════════════════════════════════════════════════
  // USER-KONTEXT
  // ════════════════════════════════════════════════════════════════════

  updateUserContext(userId, updates) {
    const current = this.userContexts.get(userId) || {};
    this.userContexts.set(userId, { ...current, ...updates, lastUpdated: new Date().toISOString() });
  }

  getUserContext(userId) {
    return this.userContexts.get(userId) || null;
  }

  // ════════════════════════════════════════════════════════════════════
  // PERSISTENZ
  // ════════════════════════════════════════════════════════════════════

  async _loadSummaries() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'summaries.json'), 'utf-8');
      this.conversationSummaries = JSON.parse(raw);
    } catch { this.conversationSummaries = []; }
  }

  async _saveSummaries() {
    const tmp = path.join(this.dataDir, 'summaries.json.tmp');
    const final = path.join(this.dataDir, 'summaries.json');
    await fs.writeFile(tmp, JSON.stringify(this.conversationSummaries, null, 2));
    await fs.rename(tmp, final);
  }

  async _loadTopicGraph() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'topics.json'), 'utf-8');
      const obj = JSON.parse(raw);
      this.topicGraph = new Map(Object.entries(obj));
    } catch { this.topicGraph = new Map(); }
  }

  async _saveTopicGraph() {
    const obj = Object.fromEntries(this.topicGraph);
    const tmp = path.join(this.dataDir, 'topics.json.tmp');
    const final = path.join(this.dataDir, 'topics.json');
    await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
    await fs.rename(tmp, final);
  }

  // ════════════════════════════════════════════════════════════════════
  // STATISTIKEN
  // ════════════════════════════════════════════════════════════════════

  getStats() {
    return {
      shortTermMessages: this.shortTerm.length,
      totalSummaries:    this.conversationSummaries.length,
      topicCount:        this.topicGraph.size,
      topTopics:         [...this.topicGraph.entries()]
                           .sort((a, b) => b[1].count - a[1].count)
                           .slice(0, 10)
                           .map(([k, v]) => ({ topic: k, count: v.count, related: v.related.length })),
      activeTopics:      this.activeTopics,
      userContexts:      this.userContexts.size,
    };
  }
}

module.exports = ContextMemoryService;
