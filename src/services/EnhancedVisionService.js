/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ENHANCED VISION SERVICE v1.0                                       ║
 * ║                                                                      ║
 * ║  Fortgeschrittenes visuelles Verständnis für Johnny:               ║
 * ║  - Multi-Pass Bildanalyse (Detail → Kontext → Bedeutung)          ║
 * ║  - Vergleichsanalyse (Vorher/Nachher, A/B, Unterschiede)          ║
 * ║  - Technische Analyse (Code-Screenshots, UI, Diagramme)            ║
 * ║  - OCR mit Strukturerkennung (Tabellen, Formulare)                 ║
 * ║  - Bild-zu-Text-Beschreibung (barrierefrei)                        ║
 * ║  - Visuelle Suche in gespeicherten Bildern                        ║
 * ║  - Chart/Graph-Interpretation                                       ║
 * ║  - Screenshot-Workflow-Analyse                                      ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs').promises;
const path = require('path');

// ── Analyse-Modi ─────────────────────────────────────────────────────
const ANALYSIS_MODES = {
  describe: {
    name: 'Beschreibung',
    systemPrompt: 'Beschreibe dieses Bild detailliert und strukturiert. Beginne mit dem Hauptmotiv, dann Details, Farben, Stimmung und mögliche Bedeutung.',
    temperature: 0.4,
  },
  technical: {
    name: 'Technische Analyse',
    systemPrompt: 'Analysiere dieses Bild technisch: identifiziere UI-Elemente, Code, Fehlermeldungen, Architektur-Diagramme oder technische Zeichnungen. Sei präzise und strukturiert.',
    temperature: 0.2,
  },
  ocr: {
    name: 'Texterkennung (OCR)',
    systemPrompt: 'Extrahiere ALLEN sichtbaren Text aus diesem Bild. Behalte die Struktur bei (Überschriften, Listen, Tabellen). Gib den Text als strukturiertes Markdown zurück.',
    temperature: 0.1,
  },
  compare: {
    name: 'Vergleichsanalyse',
    systemPrompt: 'Vergleiche die gezeigten Bilder/Bereiche. Identifiziere Unterschiede, Gemeinsamkeiten und Veränderungen. Strukturiere die Antwort in: Gleich, Unterschiedlich, Bewertung.',
    temperature: 0.3,
  },
  chart: {
    name: 'Chart-Interpretation',
    systemPrompt: 'Analysiere dieses Diagramm/Chart/Graph. Identifiziere: Typ (Bar, Line, Pie etc.), Achsen/Labels, Haupttrends, Ausreißer, und die Kernaussage der Visualisierung.',
    temperature: 0.2,
  },
  accessibility: {
    name: 'Barrierefreiheit (Alt-Text)',
    systemPrompt: 'Erstelle einen informativen, barrierefreien Alt-Text für dieses Bild. Maximal 2-3 Sätze. Beschreibe was dargestellt ist, nicht wie es aussieht. Für Screenreader optimiert.',
    temperature: 0.3,
  },
  ui_review: {
    name: 'UI/UX Review',
    systemPrompt: 'Analysiere dieses UI-Design/Screenshot. Bewerte: Layout, Typografie, Farbschema, Benutzerführung, Konsistenz, Accessibility. Gib konkrete Verbesserungsvorschläge.',
    temperature: 0.4,
  },
  document: {
    name: 'Dokument-Analyse',
    systemPrompt: 'Analysiere dieses Dokument. Extrahiere die Struktur (Titel, Abschnitte, Tabellen), den Hauptinhalt und die Kernaussagen. Fasse zusammen.',
    temperature: 0.2,
  },
  creative: {
    name: 'Kreative Interpretation',
    systemPrompt: 'Interpretiere dieses Bild kreativ: Was erzählt es für eine Geschichte? Welche Emotionen vermittelt es? Welcher Kontext könnte dahinterstecken? Sei poetisch und assoziativ.',
    temperature: 0.8,
  },
};

// ── Multi-Pass Analyse-Pipeline ──────────────────────────────────────
const MULTI_PASS_PIPELINE = [
  { pass: 'overview',    prompt: 'Was zeigt dieses Bild auf den ersten Blick? (1-2 Sätze)', temperature: 0.2 },
  { pass: 'details',     prompt: 'Welche Details fallen auf? Beschreibe spezifische Elemente, Farben, Text, Objekte.', temperature: 0.3 },
  { pass: 'context',     prompt: 'Welcher Kontext ist erkennbar? (Ort, Zeit, Situation, Zweck)', temperature: 0.4 },
  { pass: 'meaning',     prompt: 'Was ist die wahrscheinliche Bedeutung oder Absicht des Bildes?', temperature: 0.5 },
  { pass: 'actionable',  prompt: 'Was kann der User damit anfangen? Gibt es Handlungsempfehlungen?', temperature: 0.4 },
];

class EnhancedVisionService {
  constructor(config = {}) {
    this.visionService  = config.visionService;   // Referenz auf bestehenden VisionService
    this.agentManager   = config.agentManager;
    this.dataDir        = config.dataDir || path.join(require('os').homedir(), '.johnny', 'vision');
    this._analysisCache = new Map();
    this._maxCache      = 100;
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    console.log('[EnhancedVision] Initialized — modes: ' + Object.keys(ANALYSIS_MODES).length);
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ KERN-ANALYSE ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Analysiert ein Bild mit dem gewählten Modus
   * @param {string|Buffer} imageInput - Dateipfad, Buffer oder Base64
   * @param {string} mode - Analyse-Modus (describe, technical, ocr, etc.)
   * @param {object} options - { customPrompt, language, detail }
   */
  async analyze(imageInput, mode = 'describe', options = {}) {
    const modeConfig = ANALYSIS_MODES[mode];
    if (!modeConfig) throw new Error(`Unbekannter Modus: ${mode}. Verfügbar: ${Object.keys(ANALYSIS_MODES).join(', ')}`);

    const prompt = options.customPrompt
      ? `${modeConfig.systemPrompt}\n\nZusätzliche Anweisung: ${options.customPrompt}`
      : modeConfig.systemPrompt;

    const language = options.language || 'de';
    if (language !== 'de') {
      const langHint = `\nAntwort bitte auf ${language === 'en' ? 'Englisch' : language}.`;
    }

    // Delegiere an VisionService oder direkte LLM-Analyse
    const result = await this._analyzeWithVision(imageInput, prompt, {
      temperature: modeConfig.temperature,
      ...options,
    });

    return {
      mode,
      modeName: modeConfig.name,
      analysis: result,
      timestamp: Date.now(),
    };
  }

  /**
   * Multi-Pass Deep Analysis — mehrere Durchgänge für maximale Tiefe
   */
  async deepAnalyze(imageInput, options = {}) {
    const results = [];
    const passes = options.passes || MULTI_PASS_PIPELINE;

    for (const pass of passes) {
      try {
        const result = await this._analyzeWithVision(imageInput, pass.prompt, {
          temperature: pass.temperature,
        });
        results.push({ pass: pass.pass, result });
      } catch (e) {
        results.push({ pass: pass.pass, error: e.message });
      }
    }

    // Synthese aller Durchgänge
    const synthesis = await this._synthesize(results);

    return {
      mode: 'deep-analysis',
      passes: results,
      synthesis,
      timestamp: Date.now(),
    };
  }

  /**
   * Vergleicht zwei Bilder
   */
  async compareImages(image1, image2, prompt = '') {
    const comparePrompt = ANALYSIS_MODES.compare.systemPrompt +
      (prompt ? `\n\nSpezifischer Fokus: ${prompt}` : '');

    // Beide Bilder laden
    const img1Data = await this._loadImage(image1);
    const img2Data = await this._loadImage(image2);

    // Wenn VisionService Multi-Image unterstützt
    if (this.visionService && typeof this.visionService.analyzeImage === 'function') {
      try {
        const result = await this.visionService.analyzeImage(
          img1Data,
          `${comparePrompt}\n\nVergleiche Bild 1 (dieses Bild) mit dem beschriebenen Bild 2.`,
          { temperature: 0.3 }
        );
        return { comparison: result, timestamp: Date.now() };
      } catch (e) { /* fallback below */ }
    }

    // Fallback: einzelne Analysen + LLM-Vergleich
    const [analysis1, analysis2] = await Promise.all([
      this.analyze(image1, 'describe', { customPrompt: 'Sei besonders detailliert bei Farben, Positionen und Texten.' }),
      this.analyze(image2, 'describe', { customPrompt: 'Sei besonders detailliert bei Farben, Positionen und Texten.' }),
    ]);

    if (this.agentManager) {
      const compResult = await this.agentManager.sendToModel(
        `Vergleiche diese zwei Bildbeschreibungen und identifiziere Unterschiede:\n\nBild 1: ${analysis1.analysis}\n\nBild 2: ${analysis2.analysis}\n\n${prompt}`,
        { temperature: 0.3, maxTokens: 800 }
      );
      return { comparison: compResult, image1Analysis: analysis1.analysis, image2Analysis: analysis2.analysis, timestamp: Date.now() };
    }

    return { image1Analysis: analysis1.analysis, image2Analysis: analysis2.analysis, timestamp: Date.now() };
  }

  /**
   * Batch-Analyse mehrerer Bilder
   */
  async batchAnalyze(images, mode = 'describe', options = {}) {
    const results = [];
    for (let i = 0; i < images.length; i++) {
      try {
        const result = await this.analyze(images[i], mode, options);
        results.push({ index: i, ...result });
      } catch (e) {
        results.push({ index: i, error: e.message });
      }
    }
    return results;
  }

  /**
   * Screenshot-Workflow — analysiert eine Reihe von Screenshots als Workflow
   */
  async analyzeWorkflow(screenshots, options = {}) {
    const stepAnalyses = [];

    for (let i = 0; i < screenshots.length; i++) {
      const result = await this.analyze(screenshots[i], 'technical', {
        customPrompt: `Dies ist Schritt ${i + 1} von ${screenshots.length} eines Workflows. Beschreibe was in diesem Schritt passiert.`,
      });
      stepAnalyses.push({ step: i + 1, analysis: result.analysis });
    }

    // Workflow-Synthese
    if (this.agentManager) {
      const synthesis = await this.agentManager.sendToModel(
        `Analysiere diesen mehrstufigen Workflow:\n\n${stepAnalyses.map(s => `Schritt ${s.step}: ${s.analysis}`).join('\n\n')}\n\nGib eine Zusammenfassung des Gesamtworkflows, identifiziere mögliche Probleme und Optimierungen.`,
        { temperature: 0.3, maxTokens: 1000 }
      );
      return { steps: stepAnalyses, synthesis, timestamp: Date.now() };
    }

    return { steps: stepAnalyses, timestamp: Date.now() };
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ INTERNE HELFER ██
  // ════════════════════════════════════════════════════════════════════

  async _analyzeWithVision(imageInput, prompt, options = {}) {
    // Versuch über bestehenden VisionService
    if (this.visionService && typeof this.visionService.analyzeImage === 'function') {
      try {
        const result = await this.visionService.analyzeImage(imageInput, prompt, options);
        if (result && (result.analysis || result.text || result.description)) {
          return result.analysis || result.text || result.description;
        }
        if (typeof result === 'string') return result;
      } catch (e) {
        console.warn('[EnhancedVision] VisionService failed, trying AgentManager fallback:', e.message);
      }
    }

    // Fallback: über AgentManager mit Bild-Support
    if (this.agentManager && typeof this.agentManager.sendToModel === 'function') {
      const imageData = await this._loadImage(imageInput);
      return await this.agentManager.sendToModel(prompt, {
        images: [imageData],
        temperature: options.temperature || 0.3,
        maxTokens: options.maxTokens || 800,
      });
    }

    throw new Error('Kein Vision-Provider verfügbar. Installiere ein Vision-Modell: ollama pull llama3.2-vision');
  }

  async _loadImage(input) {
    if (Buffer.isBuffer(input)) return input.toString('base64');
    if (typeof input === 'string') {
      if (input.startsWith('data:')) return input.split(',')[1];
      if (input.length > 500 && !input.includes('/')) return input; // already base64
      const buf = await fs.readFile(input);
      return buf.toString('base64');
    }
    throw new Error('Ungültiger Bild-Input. Erwartet: Dateipfad, Buffer oder Base64-String.');
  }

  async _synthesize(passResults) {
    if (!this.agentManager) {
      return passResults.map(p => `${p.pass}: ${p.result || p.error}`).join('\n');
    }

    const summary = passResults
      .filter(p => p.result)
      .map(p => `[${p.pass.toUpperCase()}] ${p.result}`)
      .join('\n\n');

    return await this.agentManager.sendToModel(
      `Fasse diese mehrstufige Bildanalyse zu einer kohärenten Gesamtbeschreibung zusammen:\n\n${summary}`,
      { temperature: 0.3, maxTokens: 600 }
    );
  }

  // ── Status ─────────────────────────────────────────────────────────
  getModes() { return Object.entries(ANALYSIS_MODES).map(([k, v]) => ({ id: k, name: v.name })); }

  getStatus() {
    return {
      modes: Object.keys(ANALYSIS_MODES),
      hasVisionService: !!this.visionService,
      hasAgentManager: !!this.agentManager,
      cacheSize: this._analysisCache.size,
    };
  }
}

module.exports = EnhancedVisionService;
