/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CREATIVITY SERVICE v1.0                                             ║
 * ║                                                                      ║
 * ║  Kreativitäts-Engine für Johnny:                                    ║
 * ║  - Kreative Prompt-Templates & Techniken                            ║
 * ║  - Brainstorming-Modi (SCAMPER, Six Hats, Mind Map)                 ║
 * ║  - Stil-Mixing und Perspektivwechsel                                ║
 * ║  - Analogie-Generator                                               ║
 * ║  - Storytelling-Frameworks                                           ║
 * ║  - Kreative Datenquellen-Integration                                ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const { EventEmitter } = require('events');

// ── Kreative Techniken-Bibliothek ──────────────────────────────────────
const TECHNIQUES = {
  scamper: {
    name: 'SCAMPER',
    description: 'Systematische Kreativitätstechnik',
    prompts: [
      'Substitute: Was könnte ersetzt werden?',
      'Combine: Was könnte kombiniert werden?',
      'Adapt: Was könnte angepasst werden?',
      'Modify/Magnify: Was könnte vergrößert oder verändert werden?',
      'Put to other uses: Wofür könnte es noch verwendet werden?',
      'Eliminate: Was könnte entfernt werden?',
      'Reverse/Rearrange: Was könnte umgedreht oder umgestellt werden?',
    ],
  },

  sixHats: {
    name: 'Six Thinking Hats',
    description: 'De Bonos Sechs Denkhüte',
    perspectives: {
      white:  'Fakten und Daten — was wissen wir objektiv?',
      red:    'Emotionen und Intuition — was fühlt sich richtig an?',
      black:  'Kritisches Denken — was könnte schiefgehen?',
      yellow: 'Optimismus — was sind die Vorteile?',
      green:  'Kreativität — welche neuen Ideen gibt es?',
      blue:   'Prozess — wie strukturieren wir das?',
    },
  },

  fiveWhys: {
    name: 'Five Whys',
    description: 'Tiefenanalyse durch wiederholtes Fragen nach dem Warum',
    template: 'Warum ist das so? (Wiederhole 5x um zur Wurzel zu gelangen)',
  },

  morphologicalBox: {
    name: 'Morphologischer Kasten',
    description: 'Systematische Kombination von Parametern und Ausprägungen',
  },

  randomStimulus: {
    name: 'Zufalls-Stimulus',
    description: 'Zufällige Begriffe als Kreativitäts-Auslöser',
    stimuli: [
      'Wolke', 'Brücke', 'Spiegel', 'Labyrinth', 'Schmetterling',
      'Vulkan', 'Uhrwerk', 'Ozean', 'Diamant', 'Samen',
      'Flamme', 'Puzzle', 'Kompass', 'Echo', 'Netz',
      'Wurzel', 'Blitz', 'Perle', 'Welle', 'Schlüssel',
      'Mosaik', 'Horizont', 'Prism', 'Schatten', 'Spirale',
    ],
  },
};

// ── Storytelling-Frameworks ────────────────────────────────────────────
const STORY_FRAMEWORKS = {
  heroJourney: {
    name: 'Heldenreise',
    stages: ['Gewöhnliche Welt', 'Ruf des Abenteuers', 'Weigerung',
             'Mentor', 'Überschreitung der Schwelle', 'Prüfungen',
             'Annäherung an die tiefste Höhle', 'Entscheidende Prüfung',
             'Belohnung', 'Rückweg', 'Auferstehung', 'Rückkehr'],
  },
  storySpine: {
    name: 'Story Spine',
    template: [
      'Es war einmal...',
      'Jeden Tag...',
      'Aber eines Tages...',
      'Und deshalb...',
      'Und deshalb...',
      'Bis schließlich...',
      'Und seit diesem Tag...',
    ],
  },
  problemSolution: {
    name: 'Problem-Lösung',
    template: ['Situation', 'Komplikation', 'Wendepunkt', 'Lösung', 'Ergebnis'],
  },
};

// ── Schreib-Stile ──────────────────────────────────────────────────────
const WRITING_STYLES = {
  technical:   { tone: 'sachlich', structure: 'präzise', vocab: 'fachsprachlich' },
  creative:    { tone: 'bildhaft', structure: 'fließend', vocab: 'ausdrucksstark' },
  persuasive:  { tone: 'überzeugend', structure: 'argumentativ', vocab: 'wirkungsvoll' },
  humorous:    { tone: 'humorvoll', structure: 'überraschend', vocab: 'spielerisch' },
  poetic:      { tone: 'lyrisch', structure: 'rhythmisch', vocab: 'metaphorisch' },
  journalistic:{ tone: 'neutral', structure: 'pyramidal', vocab: 'klar' },
  academic:    { tone: 'formal', structure: 'systematisch', vocab: 'wissenschaftlich' },
  casual:      { tone: 'locker', structure: 'natürlich', vocab: 'umgangssprachlich' },
};

class CreativityService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.agentManager = config.agentManager;
    this.webSearch    = config.webSearchService;
    this.ollamaService = config.ollamaService || null;
    this.sessionLog   = [];
  }

  // ════════════════════════════════════════════════════════════════════
  // BRAINSTORMING
  // ════════════════════════════════════════════════════════════════════

  /**
   * Führt eine strukturierte Brainstorming-Session durch
   * @param {string} topic - Das Thema
   * @param {string} technique - 'scamper'|'sixHats'|'fiveWhys'|'random'|'morphological'
   * @param {Object} options
   */
  async brainstorm(topic, technique = 'scamper', options = {}) {
    const { maxIdeas = 10, depth = 'normal' } = options;

    this.emit('brainstorm.started', { topic, technique });

    let result;
    switch (technique) {
      case 'scamper':
        result = await this._brainstormScamper(topic, maxIdeas);
        break;
      case 'sixHats':
        result = await this._brainstormSixHats(topic);
        break;
      case 'fiveWhys':
        result = await this._brainstormFiveWhys(topic);
        break;
      case 'random':
        result = await this._brainstormRandom(topic, maxIdeas);
        break;
      case 'morphological':
        result = await this._brainstormMorphological(topic);
        break;
      default:
        result = await this._brainstormScamper(topic, maxIdeas);
    }

    this.sessionLog.push({ ts: new Date().toISOString(), topic, technique, ideaCount: result.ideas?.length || 0 });
    this.emit('brainstorm.completed', { topic, technique, ideaCount: result.ideas?.length || 0 });

    return result;
  }

  async _brainstormScamper(topic, maxIdeas) {
    if (!this.agentManager) return this._offlineBrainstorm(topic, 'scamper');

    const prompt = `Wende die SCAMPER-Methode auf folgendes Thema an: "${topic}"

Gehe jeden SCAMPER-Schritt durch und generiere mindestens eine Idee pro Schritt:
${TECHNIQUES.scamper.prompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Antworte als JSON: {"ideas":[{"step":"...","idea":"...","potential":"hoch/mittel/niedrig"}],"bestIdea":"...","reasoning":"..."}`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      const json = result.response.match(/\{[\s\S]*\}/);
      return json ? JSON.parse(json[0]) : this._offlineBrainstorm(topic, 'scamper');
    } catch {
      return this._offlineBrainstorm(topic, 'scamper');
    }
  }

  async _brainstormSixHats(topic) {
    if (!this.agentManager) return this._offlineBrainstorm(topic, 'sixHats');

    const perspectives = TECHNIQUES.sixHats.perspectives;
    const prompt = `Analysiere "${topic}" aus 6 verschiedenen Perspektiven (De Bonos Denkhüte):

${Object.entries(perspectives).map(([color, desc]) => `${color.toUpperCase()}: ${desc}`).join('\n')}

Antworte als JSON: {"perspectives":{${Object.keys(perspectives).map(c => `"${c}":"..."`).join(',')}},"synthesis":"...","recommendation":"..."}`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      const json = result.response.match(/\{[\s\S]*\}/);
      if (json) {
        const parsed = JSON.parse(json[0]);
        return {
          ideas: Object.entries(parsed.perspectives || {}).map(([hat, insight]) => ({
            step: hat, idea: insight, potential: 'mittel',
          })),
          synthesis: parsed.synthesis,
          recommendation: parsed.recommendation,
        };
      }
    } catch {}
    return this._offlineBrainstorm(topic, 'sixHats');
  }

  async _brainstormFiveWhys(topic) {
    if (!this.agentManager) return { technique: 'fiveWhys', topic, ideas: [{ step: 'Warum?', idea: topic }] };

    const prompt = `Wende die "5 Warum"-Technik auf "${topic}" an.
Frage 5x "Warum?" um zur Kernursache/Kernerkenntnis zu gelangen.

Antworte als JSON: {"whys":[{"level":1,"question":"Warum...?","answer":"..."},...],"rootCause":"...","insight":"..."}`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      const json = result.response.match(/\{[\s\S]*\}/);
      if (json) {
        const parsed = JSON.parse(json[0]);
        return {
          ideas: (parsed.whys || []).map(w => ({ step: `Warum ${w.level}`, idea: `${w.question} → ${w.answer}` })),
          rootCause: parsed.rootCause,
          insight: parsed.insight,
        };
      }
    } catch {}
    return { technique: 'fiveWhys', topic, ideas: [] };
  }

  async _brainstormRandom(topic, maxIdeas) {
    const stimuli = TECHNIQUES.randomStimulus.stimuli;
    const picked = [];
    for (let i = 0; i < 3; i++) {
      picked.push(stimuli[Math.floor(Math.random() * stimuli.length)]);
    }

    if (!this.agentManager) {
      return {
        technique: 'random',
        stimuli: picked,
        ideas: picked.map(s => ({ step: `Stimulus: ${s}`, idea: `Verbindung zwischen "${topic}" und "${s}" herstellen`, potential: 'mittel' })),
      };
    }

    const prompt = `Kreativ-Übung: Verbinde "${topic}" mit diesen zufälligen Stimuli: ${picked.join(', ')}

Finde für jeden Stimulus eine kreative Verbindung oder Idee.
Antworte als JSON: {"ideas":[{"stimulus":"...","connection":"...","idea":"...","potential":"hoch/mittel/niedrig"}],"bestIdea":"..."}`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      const json = result.response.match(/\{[\s\S]*\}/);
      if (json) return { ...JSON.parse(json[0]), technique: 'random', stimuli: picked };
    } catch {}
    return { technique: 'random', stimuli: picked, ideas: [] };
  }

  async _brainstormMorphological(topic) {
    if (!this.agentManager) return this._offlineBrainstorm(topic, 'morphological');

    const prompt = `Erstelle einen Morphologischen Kasten für "${topic}".

1. Identifiziere 3-4 Parameter/Dimensionen
2. Finde für jeden Parameter 3-4 mögliche Ausprägungen
3. Kombiniere verschiedene Ausprägungen zu innovativen Lösungen

Antworte als JSON:
{"parameters":[{"name":"...","options":["..."]}],"combinations":[{"combo":{"param1":"opt1","param2":"opt2"},"idea":"...","potential":"hoch/mittel/niedrig"}],"bestCombination":"..."}`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      const json = result.response.match(/\{[\s\S]*\}/);
      if (json) return { ...JSON.parse(json[0]), technique: 'morphological' };
    } catch {}
    return this._offlineBrainstorm(topic, 'morphological');
  }

  _offlineBrainstorm(topic, technique) {
    return {
      technique,
      topic,
      ideas: [{ step: 'offline', idea: `Kreativ-Analyse von "${topic}" — LLM nicht verfügbar`, potential: 'niedrig' }],
      note: 'Für beste Ergebnisse wird eine LLM-Verbindung benötigt.',
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // KREATIVE TEXTGENERIERUNG
  // ════════════════════════════════════════════════════════════════════

  /**
   * Generiert kreativen Text mit spezifischem Stil und Framework
   */
  async generateCreativeText(prompt, options = {}) {
    const {
      style     = 'creative',
      framework = null,
      maxLength = 500,
      language  = 'de',
      mixStyles = null,   // z.B. ['technical', 'humorous'] für Stil-Mixing
    } = options;

    const styleInfo = mixStyles
      ? this._mixStyles(mixStyles)
      : WRITING_STYLES[style] || WRITING_STYLES.creative;

    let enhancedPrompt = prompt;

    // Stil-Anweisungen
    enhancedPrompt += `\n\nSchreibstil: ${styleInfo.tone}, ${styleInfo.structure}, ${styleInfo.vocab}`;

    // Framework anwenden
    if (framework && STORY_FRAMEWORKS[framework]) {
      const fw = STORY_FRAMEWORKS[framework];
      enhancedPrompt += `\n\nStruktur (${fw.name}): ${(fw.stages || fw.template).join(' → ')}`;
    }

    enhancedPrompt += `\nSprache: ${language === 'de' ? 'Deutsch' : 'English'}`;
    enhancedPrompt += `\nMaximale Länge: ca. ${maxLength} Wörter`;

    if (!this.agentManager) {
      return { text: `[Kreativ-Prompt vorbereitet, LLM benötigt]\n${enhancedPrompt}`, prompt: enhancedPrompt };
    }

    try {
      const result = await this.agentManager.sendMessage('Johnny', enhancedPrompt);
      return { text: result.response, style, framework, prompt: enhancedPrompt };
    } catch (e) {
      return { text: `Fehler bei Textgenerierung: ${e.message}`, error: true };
    }
  }

  _mixStyles(styleNames) {
    const styles = styleNames
      .map(s => WRITING_STYLES[s])
      .filter(Boolean);

    if (!styles.length) return WRITING_STYLES.creative;

    return {
      tone:      styles.map(s => s.tone).join(' + '),
      structure: styles.map(s => s.structure).join(' mit '),
      vocab:     styles.map(s => s.vocab).join(' und '),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // ANALOGIE-GENERATOR
  // ════════════════════════════════════════════════════════════════════

  /**
   * Generiert Analogien zwischen zwei Domänen
   */
  async generateAnalogy(concept, targetDomain = null) {
    const domains = targetDomain
      ? [targetDomain]
      : ['Natur', 'Kochen', 'Sport', 'Musik', 'Architektur', 'Medizin', 'Reisen'];

    const randomDomain = domains[Math.floor(Math.random() * domains.length)];

    if (!this.agentManager) {
      return {
        concept,
        domain: randomDomain,
        analogy: `"${concept}" ist wie... [LLM benötigt für Analogie-Generierung]`,
      };
    }

    const prompt = `Erstelle eine kraftvolle Analogie:
Erkläre "${concept}" durch eine Analogie aus dem Bereich "${randomDomain}".

Die Analogie soll:
- Intuitiv verständlich sein
- Die Kernaspekte des Konzepts abdecken
- Überraschend aber treffend sein

Antworte als JSON: {"analogy":"...","explanation":"...","strengthsOfAnalogy":["..."],"limitations":["..."]}`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      const json = result.response.match(/\{[\s\S]*\}/);
      if (json) return { concept, domain: randomDomain, ...JSON.parse(json[0]) };
    } catch {}

    return { concept, domain: randomDomain, analogy: 'Analogie-Generierung fehlgeschlagen' };
  }

  // ════════════════════════════════════════════════════════════════════
  // PERSPEKTIV-WECHSEL
  // ════════════════════════════════════════════════════════════════════

  /**
   * Betrachtet ein Thema aus verschiedenen Perspektiven
   */
  async changePerspective(topic, perspectives = []) {
    const defaultPerspectives = [
      { role: 'Kind (8 Jahre)',     focus: 'Einfachheit und Staunen' },
      { role: 'Skeptiker',          focus: 'Kritisches Hinterfragen' },
      { role: 'Zukunftsforscher',   focus: 'Langfristige Auswirkungen' },
      { role: 'Künstler',           focus: 'Ästhetik und Emotion' },
      { role: 'Ingenieur',          focus: 'Machbarkeit und Effizienz' },
    ];

    const activePerspectives = perspectives.length > 0 ? perspectives : defaultPerspectives;

    if (!this.agentManager) {
      return {
        topic,
        perspectives: activePerspectives.map(p => ({
          ...p,
          insight: `[Perspektive "${p.role}" benötigt LLM]`,
        })),
      };
    }

    const prompt = `Betrachte "${topic}" aus diesen Perspektiven:

${activePerspectives.map((p, i) => `${i + 1}. ${p.role} (Fokus: ${p.focus})`).join('\n')}

Gib für jede Perspektive einen einzigartigen Einblick (2-3 Sätze).
Antworte als JSON: {"perspectives":[{"role":"...","insight":"...","surprisingAngle":"..."}],"synthesis":"..."}`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      const json = result.response.match(/\{[\s\S]*\}/);
      if (json) return { topic, ...JSON.parse(json[0]) };
    } catch {}

    return { topic, perspectives: activePerspectives, error: 'LLM nicht erreichbar' };
  }

  // ════════════════════════════════════════════════════════════════════
  // INSPIRATION AUS EXTERNEN QUELLEN
  // ════════════════════════════════════════════════════════════════════

  /**
   * Sucht Inspiration aus dem Web für ein kreatives Thema
   */
  async findInspiration(topic, sources = ['quotes', 'concepts', 'examples']) {
    if (!this.webSearch) {
      return { topic, sources: [], note: 'WebSearchService nicht verfügbar' };
    }

    const results = [];

    for (const source of sources) {
      try {
        let query;
        switch (source) {
          case 'quotes':    query = `inspirierende Zitate ${topic}`; break;
          case 'concepts':  query = `innovative Konzepte ${topic}`; break;
          case 'examples':  query = `kreative Beispiele ${topic}`; break;
          case 'art':       query = `Kunstwerke inspiriert von ${topic}`; break;
          case 'science':   query = `wissenschaftliche Entdeckungen ${topic}`; break;
          default:          query = `${source} ${topic}`; break;
        }

        const searchResult = await this.webSearch.search(query, { maxResults: 3 });
        if (searchResult?.results?.length) {
          results.push({
            source,
            items: searchResult.results.map(r => ({
              title: r.title, snippet: r.snippet, url: r.url,
            })),
          });
        }
      } catch (e) {
        results.push({ source, error: e.message });
      }
    }

    return { topic, inspiration: results };
  }

  // ════════════════════════════════════════════════════════════════════
  // HILFSMETHODEN
  // ════════════════════════════════════════════════════════════════════

  getAvailableTechniques() {
    return Object.entries(TECHNIQUES).map(([key, t]) => ({
      id: key, name: t.name, description: t.description,
    }));
  }

  getAvailableFrameworks() {
    return Object.entries(STORY_FRAMEWORKS).map(([key, f]) => ({
      id: key, name: f.name, stages: f.stages || f.template,
    }));
  }

  getAvailableStyles() {
    return Object.entries(WRITING_STYLES).map(([key, s]) => ({
      id: key, ...s,
    }));
  }

  getSessionLog() {
    return this.sessionLog;
  }

  // ════════════════════════════════════════════════════════════════════
  // MULTI-MODELL-VERGLEICH (NEU v1.8)
  // ════════════════════════════════════════════════════════════════════

  /**
   * Sendet denselben Prompt an mehrere Modelle parallel und vergleicht die Ergebnisse.
   *
   * @param {string} prompt      Der kreative Prompt
   * @param {object} options     { models: ['llama3.1', 'mistral', 'qwen2.5'], judgeModel, style }
   * @returns {{ results, winner, comparison, prompt }}
   */
  async compareModels(prompt, options = {}) {
    if (!this.ollamaService) {
      return { error: 'OllamaService nicht verfügbar', results: [] };
    }

    const models      = options.models || await this._getAvailableModels(3);
    const judgeModel  = options.judgeModel || models[0];
    const style       = options.style || 'creative';
    const styleInfo   = WRITING_STYLES[style] || WRITING_STYLES.creative;

    const enhancedPrompt = `${prompt}\n\nStil: ${styleInfo.tone}. ${styleInfo.structure}.`;

    console.log(`[CreativityService] Multi-Modell-Vergleich: ${models.join(', ')}`);

    // ── Alle Modelle parallel abfragen ────────────────────────────────────
    const resultPromises = models.map(async (model) => {
      const start = Date.now();
      try {
        const text = await this.ollamaService.generateWithModel(enhancedPrompt, model);
        return { model, text, duration: Date.now() - start, success: true };
      } catch (e) {
        return { model, text: null, error: e.message, duration: Date.now() - start, success: false };
      }
    });

    const results = await Promise.all(resultPromises);
    const successful = results.filter(r => r.success && r.text);

    if (successful.length === 0) {
      return { error: 'Alle Modelle fehlgeschlagen', results, prompt };
    }
    if (successful.length === 1) {
      return { results, winner: successful[0].model, comparison: null, prompt,
               best: successful[0].text };
    }

    // ── Judge-Modell wählt den besten Output ─────────────────────────────
    let winner     = null;
    let comparison = null;

    try {
      const judgePrompt = this._buildJudgePrompt(prompt, successful);
      const judgeResult = await this.ollamaService.generateWithModel(judgePrompt, judgeModel);
      const parsed      = this._parseJudgeResult(judgeResult, successful);
      winner     = parsed.winner;
      comparison = parsed.reasoning;
    } catch (e) {
      console.warn('[CreativityService] Judge fehlgeschlagen, wähle längsten Output:', e.message);
      // Fallback: längsten Output als Gewinner
      winner = successful.reduce((best, r) =>
        r.text.length > (best?.text?.length || 0) ? r : best
      ).model;
    }

    const bestResult = successful.find(r => r.model === winner) || successful[0];

    return {
      prompt,
      style,
      models,
      results,
      winner,
      best:       bestResult.text,
      comparison,
      durations:  Object.fromEntries(results.map(r => [r.model, `${r.duration}ms`])),
    };
  }

  /**
   * Generiert mehrere kreative Varianten desselben Prompts mit einem Modell
   * (unterschiedliche Temperature/Sampling).
   */
  async generateVariants(prompt, options = {}) {
    if (!this.ollamaService) return { error: 'OllamaService nicht verfügbar' };

    const count       = Math.min(options.count || 3, 5);
    const model       = options.model || null;
    const temperatures = [0.5, 0.8, 1.1].slice(0, count);

    const variantPromises = temperatures.map(async (temp, i) => {
      try {
        const text = await this.ollamaService.generateWithModel(prompt, model, { temperature: temp });
        return { variant: i + 1, temperature: temp, text, success: true };
      } catch (e) {
        return { variant: i + 1, temperature: temp, text: null, error: e.message, success: false };
      }
    });

    const variants = await Promise.all(variantPromises);
    return { prompt, variants: variants.filter(v => v.success), model };
  }

  // ── Hilfsmethoden für Multi-Modell ────────────────────────────────────────

  async _getAvailableModels(max = 3) {
    if (!this.ollamaService) return [];
    try {
      const models = await this.ollamaService.getAvailableModels();
      // Vision-Modelle rausfiltern, bevorzuge Instruction-Tuned
      return models
        .filter(m => !m.toLowerCase().includes('vision') && !m.toLowerCase().includes('embed'))
        .slice(0, max);
    } catch {
      return [];
    }
  }

  _buildJudgePrompt(originalPrompt, results) {
    const options = results.map((r, i) =>
      `=== Antwort ${i + 1} (Modell: ${r.model}) ===\n${r.text.slice(0, 800)}`
    ).join('\n\n');

    return `Du bewertest kreative Texte. Ursprüngliche Aufgabe: "${originalPrompt}"

${options}

Welche Antwort ist am kreativsten, kohärentesten und passendsten?
Antworte in diesem Format:
GEWINNER: [Modellname]
BEGRÜNDUNG: [1-2 Sätze warum]`;
  }

  _parseJudgeResult(judgeText, results) {
    const winnerMatch = judgeText.match(/GEWINNER:\s*([^\n]+)/i);
    const reasonMatch = judgeText.match(/BEGRÜNDUNG:\s*([^\n]+)/i);

    if (winnerMatch) {
      const winnerName = winnerMatch[1].trim();
      // Fuzzy match: Modell-Name im Judge-Output finden
      const matched = results.find(r =>
        r.model.includes(winnerName) || winnerName.includes(r.model.split(':')[0])
      );
      return {
        winner:    matched?.model || results[0].model,
        reasoning: reasonMatch?.[1]?.trim() || judgeText.slice(0, 200),
      };
    }
    return { winner: results[0].model, reasoning: judgeText.slice(0, 200) };
  }
}

module.exports = CreativityService;
