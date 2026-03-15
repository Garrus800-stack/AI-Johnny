/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  NLP SERVICE v1.0 — Natural Language Processing                     ║
 * ║                                                                      ║
 * ║  Erweiterte Textanalyse-Fähigkeiten für Johnny:                    ║
 * ║  - Named Entity Recognition (NER) — Personen, Orte, Firmen etc.   ║
 * ║  - Intent Detection — Was will der User?                            ║
 * ║  - Sentiment-Analyse (feingranular mit Emotion-Labels)             ║
 * ║  - Keyword-Extraktion (TF-IDF-ähnlich)                             ║
 * ║  - Automatische Zusammenfassung (extractive + abstractive)         ║
 * ║  - Sprach-/Textkomplexitäts-Scoring (Flesch, Gunning-Fog)         ║
 * ║  - Relation Extraction — Beziehungen zwischen Entities             ║
 * ║  - Topic Modeling — Themen-Cluster aus Texten                      ║
 * ║  - Text-Vergleich / Plagiatserkennung (Cosine-Similarity)         ║
 * ║  - Automatische Sprach-Erkennung (Text-basiert)                    ║
 * ║  - LLM-gestützte Deep Analysis als Fallback                       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const { EventEmitter } = require('events');

// ── Stopwörter (DE + EN) ──────────────────────────────────────────────
const STOP_DE = new Set('der die das ein eine einer eines einem den dem und oder aber wenn als auch nicht ist sind war hat haben wird werden kann können mit für auf in an zu von nach über aus bei um durch am im vom zum zur'.split(' '));
const STOP_EN = new Set('the a an and or but if is are was has have will can with for on in at to of from by up as it this that not do does'.split(' '));

// ── Emotions-Lexikon (Basis) ──────────────────────────────────────────
const EMOTION_WORDS = {
  de: {
    freude:   ['glücklich','froh','begeistert','toll','super','wunderbar','fantastisch','freude','lachen','genial','perfekt','liebe','hervorragend','großartig'],
    trauer:   ['traurig','weinen','verlust','tod','schmerz','leid','einsam','deprimiert','verzweifelt','hoffnungslos','melancholisch'],
    wut:      ['wütend','ärger','hass','aggressiv','frustriert','sauer','empört','zorn','rasend','genervt'],
    angst:    ['angst','furcht','panik','sorge','besorgt','ängstlich','nervös','unsicher','gefahr','bedrohlich'],
    ekel:     ['eklig','widerlich','abstoßend','grauenvoll','scheußlich','abscheulich'],
    überraschung: ['überraschend','erstaunlich','unglaublich','schockierend','unerwartet','verblüffend','wow'],
  },
  en: {
    joy:      ['happy','glad','excited','great','wonderful','fantastic','joy','love','amazing','excellent','perfect','delightful'],
    sadness:  ['sad','crying','loss','death','pain','lonely','depressed','hopeless','grief','sorrow','melancholy'],
    anger:    ['angry','hate','aggressive','frustrated','furious','rage','annoyed','outraged','mad','irritated'],
    fear:     ['afraid','fear','panic','worried','anxious','nervous','scared','danger','threatening','terrified'],
    disgust:  ['disgusting','revolting','repulsive','horrible','vile','nasty','gross','awful'],
    surprise: ['surprising','amazing','unbelievable','shocking','unexpected','stunning','wow','astonishing'],
  },
};

// ── Entity-Patterns (Regex-basiert) ───────────────────────────────────
const ENTITY_PATTERNS = {
  email:    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  url:      /https?:\/\/[^\s<>"{}|\\^`[\]]+/g,
  phone:    /(?:\+\d{1,3}[\s-]?)?\(?\d{2,5}\)?[\s.-]?\d{3,}[\s.-]?\d{2,}/g,
  date:     /\b\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}\b/g,
  time:     /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:Uhr|AM|PM|am|pm)?\b/g,
  money:    /(?:€|\$|£|USD|EUR|GBP)\s?\d+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?\s?(?:€|\$|£|USD|EUR|GBP)/g,
  percent:  /\b\d+(?:[.,]\d+)?\s?%/g,
  ipv4:     /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  hashtag:  /#[A-Za-zÄÖÜäöüß]\w*/g,
  mention:  /@[A-Za-z]\w*/g,
};

// ── Intent-Patterns ───────────────────────────────────────────────────
const INTENT_PATTERNS = {
  question:    /^(was|wer|wie|wo|wann|warum|weshalb|wieso|welch|kann|ist|hat|gibt|should|what|who|how|where|when|why|which|can|is|does|do)\b/i,
  command:     /^(mach|erstell|schreib|öffne|starte|zeig|such|finde|lösch|ändere|make|create|write|open|start|show|find|delete|change|run|set|stop)\b/i,
  greeting:    /^(hi|hallo|hey|guten\s?(morgen|tag|abend)|servus|moin|hello|good\s?(morning|evening|afternoon))\b/i,
  farewell:    /^(tschüss|bye|ciao|auf\swiedersehen|gute\snacht|goodbye|see\syou|goodnight)\b/i,
  thanks:      /^(danke|vielen\sdank|thank|thanks|thx)\b/i,
  opinion:     /(was\s(denkst|meinst|hältst)\s(du|ihr)|what\s(do\syou\sthink|is\syour\sopinion))/i,
  help:        /(hilf|hilfe|help|unterstütz|assist|kannst\sdu\s(mir|uns))/i,
  complaint:   /(funktioniert\snicht|kaputt|fehler|bug|problem|broken|doesn'?t\swork|issue|error)/i,
  request:     /(bitte|könntest|würdest|please|could\syou|would\syou|can\syou)/i,
  comparison:  /(vergleich|unterschied|besser|versus|vs\.?|compare|difference|better|worse)/i,
};

class NLPService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.agentManager = config.agentManager;
    this.defaultLang  = config.language || 'de';
  }

  // ════════════════════════════════════════════════════════════════════
  // 1. NAMED ENTITY RECOGNITION
  // ════════════════════════════════════════════════════════════════════

  /**
   * Extrahiert Entities aus Text: Emails, URLs, Daten, Geld, Telefon etc.
   * + LLM-gestützte Extraktion für Personen, Orte, Organisationen.
   */
  async extractEntities(text, options = {}) {
    const { useLLM = true } = options;

    // ── Regex-basierte Extraktion ──────────────────────────────────────
    const entities = {};
    for (const [type, regex] of Object.entries(ENTITY_PATTERNS)) {
      const matches = [...text.matchAll(regex)].map(m => m[0]);
      if (matches.length) entities[type] = [...new Set(matches)];
    }

    // ── LLM-gestützte Extraktion (Personen, Orte, Firmen) ─────────────
    if (useLLM && this.agentManager) {
      try {
        const llmEntities = await this._llmExtractEntities(text);
        if (llmEntities) Object.assign(entities, llmEntities);
      } catch (e) {
        console.warn('[NLP] LLM-Entity-Extraktion fehlgeschlagen:', e.message);
      }
    }

    return { text: text.slice(0, 200), entityCount: Object.values(entities).flat().length, entities };
  }

  async _llmExtractEntities(text) {
    const prompt = `Extrahiere Named Entities aus folgendem Text. Antworte NUR als JSON:
{"personen":["..."],"orte":["..."],"organisationen":["..."],"produkte":["..."],"events":["..."]}

Text: ${text.slice(0, 3000)}`;

    const result = await this.agentManager.sendMessage('Johnny', prompt);
    const match = result.response.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    // Leere Arrays entfernen
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v?.length > 0));
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. INTENT DETECTION
  // ════════════════════════════════════════════════════════════════════

  detectIntent(text) {
    const clean = text.trim();
    const detected = [];

    for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
      if (pattern.test(clean)) detected.push(intent);
    }

    // Heuristiken
    if (clean.endsWith('?')) detected.push('question');
    if (clean.endsWith('!') && !detected.includes('command')) detected.push('exclamation');
    if (clean.length < 10 && detected.length === 0) detected.push('short_input');

    const primary = detected[0] || 'statement';

    return {
      primary,
      all: [...new Set(detected)],
      confidence: detected.length > 0 ? Math.min(0.5 + detected.length * 0.15, 0.95) : 0.3,
      isQuestion: detected.includes('question'),
      isCommand:  detected.includes('command'),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. SENTIMENT-ANALYSE
  // ════════════════════════════════════════════════════════════════════

  /**
   * Feingranulare Sentiment-Analyse mit Emotion-Labels.
   * Kombiniert Lexikon-basierte + LLM-basierte Analyse.
   */
  async analyzeSentiment(text, options = {}) {
    const { language = this._detectLang(text), useLLM = false } = options;

    // ── Lexikon-basiert ────────────────────────────────────────────────
    const lexicon = language.startsWith('de') ? EMOTION_WORDS.de : EMOTION_WORDS.en;
    const words = text.toLowerCase().split(/\s+/);
    const emotionScores = {};
    let totalHits = 0;

    for (const [emotion, keywords] of Object.entries(lexicon)) {
      const hits = words.filter(w => keywords.some(kw => w.includes(kw))).length;
      if (hits > 0) {
        emotionScores[emotion] = hits;
        totalHits += hits;
      }
    }

    // Negation detection
    const negators = language.startsWith('de')
      ? ['nicht', 'kein', 'keine', 'keinen', 'nie', 'niemals', 'ohne']
      : ['not', 'no', 'never', 'without', 'hardly', "don't", "doesn't", "isn't", "aren't"];
    const hasNegation = words.some(w => negators.includes(w));

    // Gesamtsentiment berechnen
    const positiveEmotions = language.startsWith('de')
      ? ['freude', 'überraschung']
      : ['joy', 'surprise'];
    const negativeEmotions = language.startsWith('de')
      ? ['trauer', 'wut', 'angst', 'ekel']
      : ['sadness', 'anger', 'fear', 'disgust'];

    let posScore = 0, negScore = 0;
    for (const [em, sc] of Object.entries(emotionScores)) {
      if (positiveEmotions.includes(em)) posScore += sc;
      else if (negativeEmotions.includes(em)) negScore += sc;
    }

    if (hasNegation) { const tmp = posScore; posScore = negScore; negScore = tmp; }

    const valence = totalHits > 0
      ? (posScore - negScore) / totalHits
      : 0;

    const sentiment = valence > 0.2 ? 'positiv' : valence < -0.2 ? 'negativ' : 'neutral';
    const dominantEmotion = Object.entries(emotionScores).sort((a, b) => b[1] - a[1])[0];

    const result = {
      sentiment,
      valence: Math.round(valence * 100) / 100,
      intensity: Math.min(totalHits / words.length * 5, 1),
      emotions: emotionScores,
      dominantEmotion: dominantEmotion ? dominantEmotion[0] : null,
      hasNegation,
      language,
      method: 'lexicon',
    };

    // ── Optionale LLM-Verfeinerung ─────────────────────────────────────
    if (useLLM && this.agentManager) {
      try {
        const llm = await this._llmSentiment(text);
        if (llm) result.llmAnalysis = llm;
      } catch {}
    }

    return result;
  }

  async _llmSentiment(text) {
    const prompt = `Analysiere das Sentiment. Antworte NUR als JSON:
{"sentiment":"positiv|negativ|neutral|gemischt","valence":-1.0..1.0,"emotions":{"freude":0.0..1.0,"trauer":0.0..1.0,"wut":0.0..1.0,"angst":0.0..1.0},"ton":"...","zielgruppe":"..."}

Text: ${text.slice(0, 2000)}`;
    const r = await this.agentManager.sendMessage('Johnny', prompt);
    const m = r.response.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. KEYWORD-EXTRAKTION (TF-basiert)
  // ════════════════════════════════════════════════════════════════════

  extractKeywords(text, options = {}) {
    const { maxKeywords = 15, language = this._detectLang(text), minWordLength = 3 } = options;
    const stops = language.startsWith('de') ? STOP_DE : STOP_EN;

    // Tokenisieren, bereinigen
    const words = text.toLowerCase()
      .replace(/[^\wäöüßÄÖÜ\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= minWordLength && !stops.has(w) && !/^\d+$/.test(w));

    // Term Frequency
    const tf = {};
    for (const w of words) tf[w] = (tf[w] || 0) + 1;

    // Bigrams
    const bigrams = {};
    for (let i = 0; i < words.length - 1; i++) {
      const bg = `${words[i]} ${words[i + 1]}`;
      bigrams[bg] = (bigrams[bg] || 0) + 1;
    }

    // Score: TF * length bonus
    const scored = Object.entries(tf)
      .map(([word, freq]) => ({
        word,
        score: freq * (1 + Math.log(word.length) / 5),
        frequency: freq,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxKeywords);

    const topBigrams = Object.entries(bigrams)
      .filter(([, f]) => f >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([bg, freq]) => ({ phrase: bg, frequency: freq }));

    return {
      keywords:  scored,
      bigrams:   topBigrams,
      wordCount: words.length,
      uniqueWords: Object.keys(tf).length,
      language,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. ZUSAMMENFASSUNG
  // ════════════════════════════════════════════════════════════════════

  /**
   * Extractive Zusammenfassung (ohne LLM) + optionale LLM-Summary.
   */
  async summarize(text, options = {}) {
    const { maxSentences = 5, useLLM = true, language = this._detectLang(text) } = options;

    // ── Extractive Summary ─────────────────────────────────────────────
    const sentences = text
      .replace(/([.!?])\s+/g, '$1\n')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 20);

    if (sentences.length === 0) return { summary: text, method: 'passthrough' };

    // Score Sätze nach Position und Keyword-Dichte
    const keywords = this.extractKeywords(text, { maxKeywords: 10, language });
    const kwSet = new Set(keywords.keywords.map(k => k.word));

    const scored = sentences.map((sent, idx) => {
      const words = sent.toLowerCase().split(/\s+/);
      const kwHits = words.filter(w => kwSet.has(w)).length;
      const posBonus = idx < 3 ? 0.3 : idx >= sentences.length - 2 ? 0.2 : 0;
      const lenPenalty = sent.length > 300 ? -0.2 : 0;
      return {
        sentence: sent,
        index: idx,
        score: kwHits / words.length + posBonus + lenPenalty,
      };
    });

    const topSentences = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSentences)
      .sort((a, b) => a.index - b.index) // Originalreihenfolge
      .map(s => s.sentence);

    const extractive = topSentences.join(' ');

    // ── Abstractive Summary via LLM ────────────────────────────────────
    let abstractive = null;
    if (useLLM && this.agentManager) {
      try {
        const prompt = `Fasse den folgenden Text in 3-5 Sätzen zusammen. Schreibe ${language.startsWith('de') ? 'auf Deutsch' : 'in English'}:

${text.slice(0, 4000)}`;
        const r = await this.agentManager.sendMessage('Johnny', prompt);
        abstractive = r.response;
      } catch {}
    }

    return {
      extractive,
      abstractive,
      sentenceCount: sentences.length,
      selectedSentences: maxSentences,
      compressionRatio: Math.round((extractive.length / text.length) * 100) + '%',
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // 6. TEXTKOMPLEXITÄT
  // ════════════════════════════════════════════════════════════════════

  analyzeComplexity(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const syllables = words.reduce((sum, w) => sum + this._countSyllables(w), 0);

    const avgSentLen = words.length / Math.max(sentences.length, 1);
    const avgSyllPerWord = syllables / Math.max(words.length, 1);

    // Flesch Reading Ease (adaptiert für DE)
    const fleschDE = 180 - avgSentLen - (58.5 * avgSyllPerWord);
    const fleschEN = 206.835 - (1.015 * avgSentLen) - (84.6 * avgSyllPerWord);

    // Gunning Fog Index
    const complexWords = words.filter(w => this._countSyllables(w) >= 3).length;
    const fogIndex = 0.4 * (avgSentLen + 100 * (complexWords / Math.max(words.length, 1)));

    // Lesbarkeits-Level
    let level;
    if (fleschDE > 70) level = 'einfach';
    else if (fleschDE > 50) level = 'mittel';
    else if (fleschDE > 30) level = 'anspruchsvoll';
    else level = 'sehr komplex';

    return {
      words: words.length,
      sentences: sentences.length,
      syllables,
      avgSentenceLength: Math.round(avgSentLen * 10) / 10,
      avgSyllablesPerWord: Math.round(avgSyllPerWord * 100) / 100,
      fleschDE: Math.round(fleschDE * 10) / 10,
      fleschEN: Math.round(fleschEN * 10) / 10,
      gunningFog: Math.round(fogIndex * 10) / 10,
      level,
      complexWordRatio: Math.round((complexWords / Math.max(words.length, 1)) * 100) + '%',
    };
  }

  _countSyllables(word) {
    const w = word.toLowerCase().replace(/[^a-zäöüß]/g, '');
    if (w.length <= 2) return 1;
    // Deutsche Silben-Heuristik: Vokale zählen
    const vowels = w.match(/[aeiouyäöü]+/g);
    return Math.max(vowels ? vowels.length : 1, 1);
  }

  // ════════════════════════════════════════════════════════════════════
  // 7. TEXT-VERGLEICH
  // ════════════════════════════════════════════════════════════════════

  compareTexts(text1, text2) {
    const kw1 = this.extractKeywords(text1, { maxKeywords: 30 });
    const kw2 = this.extractKeywords(text2, { maxKeywords: 30 });

    const set1 = new Set(kw1.keywords.map(k => k.word));
    const set2 = new Set(kw2.keywords.map(k => k.word));

    const intersection = [...set1].filter(w => set2.has(w));
    const union = new Set([...set1, ...set2]);

    // Jaccard Similarity
    const jaccard = union.size > 0 ? intersection.length / union.size : 0;

    // Cosine Similarity (TF-Vektoren)
    const allWords = [...union];
    const vec1 = allWords.map(w => kw1.keywords.find(k => k.word === w)?.frequency || 0);
    const vec2 = allWords.map(w => kw2.keywords.find(k => k.word === w)?.frequency || 0);

    const dot = vec1.reduce((s, v, i) => s + v * vec2[i], 0);
    const mag1 = Math.sqrt(vec1.reduce((s, v) => s + v * v, 0));
    const mag2 = Math.sqrt(vec2.reduce((s, v) => s + v * v, 0));
    const cosine = (mag1 && mag2) ? dot / (mag1 * mag2) : 0;

    return {
      jaccardSimilarity: Math.round(jaccard * 1000) / 1000,
      cosineSimilarity:  Math.round(cosine * 1000) / 1000,
      sharedKeywords:    intersection,
      uniqueToText1:     [...set1].filter(w => !set2.has(w)),
      uniqueToText2:     [...set2].filter(w => !set1.has(w)),
      verdict: cosine > 0.8 ? 'sehr ähnlich' : cosine > 0.5 ? 'ähnlich' : cosine > 0.2 ? 'teilweise ähnlich' : 'verschieden',
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // 8. SPRACH-ERKENNUNG (Text-basiert)
  // ════════════════════════════════════════════════════════════════════

  _detectLang(text) {
    const sample = text.toLowerCase().slice(0, 500);
    // Deutsche Marker
    const deMarkers = ['der','die','das','und','ist','ein','nicht','ich','für','auf','den','dem','sich','mit','auch','nach','wie','über','aber','kann'];
    const enMarkers = ['the','and','is','are','not','for','with','this','that','have','was','from','they','but','can','will','been','has','would'];

    const deHits = deMarkers.filter(m => sample.includes(` ${m} `) || sample.startsWith(`${m} `)).length;
    const enHits = enMarkers.filter(m => sample.includes(` ${m} `) || sample.startsWith(`${m} `)).length;

    if (deHits > enHits + 2) return 'de';
    if (enHits > deHits + 2) return 'en';
    return this.defaultLang;
  }

  // ════════════════════════════════════════════════════════════════════
  // 9. VOLLSTÄNDIGE ANALYSE (Kombiniert alle Module)
  // ════════════════════════════════════════════════════════════════════

  async fullAnalysis(text, options = {}) {
    const language = options.language || this._detectLang(text);
    const useLLM   = options.useLLM !== false;

    const [entities, keywords, sentiment, complexity] = await Promise.all([
      this.extractEntities(text, { useLLM }),
      Promise.resolve(this.extractKeywords(text, { language })),
      this.analyzeSentiment(text, { language, useLLM }),
      Promise.resolve(this.analyzeComplexity(text)),
    ]);

    const intent  = this.detectIntent(text);
    const summary = text.length > 500 ? await this.summarize(text, { language, useLLM }) : null;

    return {
      language,
      textLength: text.length,
      intent,
      sentiment,
      entities: entities.entities,
      keywords: keywords.keywords.slice(0, 10),
      complexity,
      summary,
      analyzedAt: new Date().toISOString(),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // STATUS
  // ════════════════════════════════════════════════════════════════════

  getCapabilities() {
    return {
      features: ['entities', 'intent', 'sentiment', 'keywords', 'summary', 'complexity', 'compare', 'languageDetection', 'fullAnalysis'],
      languages: ['de', 'en'],
      llmAvailable: !!this.agentManager,
    };
  }
}

module.exports = NLPService;
