/**
 * VisualReasoningService — Johnnys visuelles Gedächtnis
 *
 * Löst das "Token-Gefängnis"-Problem: Statt Bilder nur in Text
 * zu übersetzen, baut dieser Service eine strukturierte
 * visuelle Repräsentation auf.
 *
 * Drei Ebenen:
 *   1. PERCEPTION  — Was sehe ich? (Objekte, Text, Farben, Layout)
 *   2. CONTEXT     — Was bedeutet es? (Szene, Beziehungen, Funktion)
 *   3. REASONING   — Was kann ich daraus schließen? (Logik, Vergleich)
 *
 * Visuelles Gedächtnis:
 *   - Speichert strukturierte Bild-Analysen (nicht nur Text-Beschreibungen)
 *   - Vergleicht neue Bilder mit gespeicherten (semantisch)
 *   - Erkennt Veränderungen über Zeit (Monitoring, Diff)
 */
'use strict';

const fs = require('fs').promises;
const path = require('path');

class VisualReasoningService {
  constructor(config = {}) {
    this.dataDir = config.dataDir || './data/visual';
    this._visualMemory = [];  // Strukturierte Bild-Analysen
    this._maxMemory = 100;
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    await this._loadMemory();
    console.log(`[VisualReasoning] Initialized — ${this._visualMemory.length} images in memory`);
  }

  // ══════════════════════════════════════════════════════════════════
  //  MULTI-PASS ANALYSE (statt einmalige Text-Beschreibung)
  // ══════════════════════════════════════════════════════════════════

  /**
   * Tiefe Bildanalyse in 3 Passes.
   * Ergebnis ist ein strukturiertes Objekt, kein Fließtext.
   */
  async analyzeDeep(imagePath, context = '') {
    if (!this.agentManager) return { error: 'AgentManager nicht verfügbar' };

    const visionService = this.agentManager.visionService || this.agentManager.enhancedVision;
    if (!visionService) return { error: 'VisionService nicht verfügbar' };

    const result = {
      timestamp: Date.now(),
      imagePath,
      perception: null,
      structure: null,
      reasoning: null,
    };

    // ── Pass 1: PERCEPTION — Was sehe ich? ──────────────────────
    const p1 = await this._visionQuery(visionService, imagePath,
      `Analysiere dieses Bild STRUKTURIERT. Antworte als JSON:
{
  "objects": [{"name":"...", "position":"oben-links/mitte/...", "size":"klein/mittel/groß", "color":"..."}],
  "text": ["erkannter Text 1", "..."],
  "colors": {"dominant":"...", "palette":["...", "..."]},
  "type": "foto/screenshot/diagram/chart/kunst/dokument/UI",
  "resolution": "hoch/mittel/niedrig",
  "mood": "hell/dunkel/warm/kalt/neutral"
}`
    );
    result.perception = this._safeParseJSON(p1) || { raw: p1 };

    // ── Pass 2: STRUCTURE — Beziehungen und Layout ──────────────
    const p2 = await this._visionQuery(visionService, imagePath,
      `Basierend auf diesem Bild, analysiere die STRUKTUR. JSON:
{
  "scene": "Was zeigt die Szene?",
  "layout": "Wie ist das Bild aufgebaut? (Hierarchie, Fluss, Grid)",
  "relationships": [{"from":"Objekt A", "to":"Objekt B", "relation":"enthält/zeigt-auf/neben/über"}],
  "focus": "Was ist das zentrale Element?",
  "context": "In welchem Kontext wurde das erstellt? (App, Webseite, Foto, Diagramm)"
}`
    );
    result.structure = this._safeParseJSON(p2) || { raw: p2 };

    // ── Pass 3: REASONING — Was kann ich schließen? ─────────────
    const contextHint = context ? `\nUser-Kontext: ${context}` : '';
    const p3 = await this._visionQuery(visionService, imagePath,
      `Basierend auf diesem Bild, beantworte LOGISCHE Fragen. JSON:
{
  "interpretation": "Was bedeutet dieses Bild?",
  "anomalies": ["Ungewöhnliches oder Fehler im Bild"],
  "suggestions": ["Was könnte der User damit tun wollen?"],
  "questions": ["Welche Fragen könnte der User dazu haben?"],
  "comparableWith": "Womit könnte man das vergleichen?"
}${contextHint}`
    );
    result.reasoning = this._safeParseJSON(p3) || { raw: p3 };

    // In visuelles Gedächtnis speichern
    this._remember(result);

    return result;
  }

  // ══════════════════════════════════════════════════════════════════
  //  VISUELLES GEDÄCHTNIS
  // ══════════════════════════════════════════════════════════════════

  /** Bild-Analyse im Gedächtnis speichern. */
  _remember(analysis) {
    this._visualMemory.push({
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: analysis.timestamp,
      imagePath: analysis.imagePath,
      type: analysis.perception?.type || 'unknown',
      scene: analysis.structure?.scene || '',
      focus: analysis.structure?.focus || '',
      objects: (analysis.perception?.objects || []).map(o => o.name),
    });
    if (this._visualMemory.length > this._maxMemory) {
      this._visualMemory = this._visualMemory.slice(-this._maxMemory / 2);
    }
    this._saveMemory();
  }

  /** Ähnliche Bilder im Gedächtnis finden (nach Objekten/Szene). */
  findSimilar(query) {
    const q = (query || '').toLowerCase();
    return this._visualMemory.filter(m =>
      m.scene.toLowerCase().includes(q) ||
      m.focus.toLowerCase().includes(q) ||
      m.objects.some(o => o.toLowerCase().includes(q))
    ).slice(-10);
  }

  /** Vergleiche zwei Bilder: Was hat sich geändert? */
  async compareImages(imagePath1, imagePath2) {
    if (!this.agentManager) return { error: 'AgentManager nicht verfügbar' };
    const vs = this.agentManager.visionService || this.agentManager.enhancedVision;
    if (!vs) return { error: 'VisionService nicht verfügbar' };

    // Beide Bilder einzeln analysieren
    const [a1, a2] = await Promise.all([
      this.analyzeDeep(imagePath1, 'Vergleich Bild 1'),
      this.analyzeDeep(imagePath2, 'Vergleich Bild 2'),
    ]);

    // LLM vergleicht die strukturierten Analysen
    const prompt = `Vergleiche diese zwei Bild-Analysen und finde Unterschiede.

BILD 1: ${JSON.stringify(a1.perception)}
BILD 2: ${JSON.stringify(a2.perception)}

Antworte als JSON:
{
  "differences": [{"what":"...", "in_image1":"...", "in_image2":"..."}],
  "similarity": 0.0-1.0,
  "summary": "Kurze Zusammenfassung der Unterschiede"
}`;

    try {
      const ollama = this.agentManager.ollamaService;
      if (!ollama) return { image1: a1, image2: a2, comparison: null };
      const resp = await ollama.generate(prompt, { temperature: 0.2 });
      return {
        image1: a1, image2: a2,
        comparison: this._safeParseJSON(resp) || { raw: resp },
      };
    } catch (e) {
      return { image1: a1, image2: a2, error: e.message };
    }
  }

  /** Zusammenfassung des visuellen Gedächtnisses für System-Prompt. */
  getVisualContext() {
    if (this._visualMemory.length === 0) return '';
    const recent = this._visualMemory.slice(-5);
    const summary = recent.map(m =>
      `[${new Date(m.timestamp).toLocaleTimeString('de')}] ${m.type}: ${m.scene || m.focus} (${m.objects.join(', ')})`
    ).join('\n');
    return `[VISUAL MEMORY — Letzte ${recent.length} Bilder]\n${summary}`;
  }

  // ══════════════════════════════════════════════════════════════════
  //  HELPER
  // ══════════════════════════════════════════════════════════════════

  async _visionQuery(visionService, imagePath, prompt) {
    try {
      // EnhancedVisionService oder VisionService
      if (visionService.analyzeImage) {
        const result = await visionService.analyzeImage(imagePath, { prompt });
        return typeof result === 'string' ? result : result?.description || result?.text || JSON.stringify(result);
      }
      if (visionService.analyze) {
        const result = await visionService.analyze({ imagePath, prompt });
        return typeof result === 'string' ? result : result?.description || JSON.stringify(result);
      }
      return null;
    } catch (e) {
      return `Error: ${e.message}`;
    }
  }

  _safeParseJSON(text) {
    if (!text) return null;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    } catch { return null; }
  }

  async _saveMemory() {
    await fs.writeFile(
      path.join(this.dataDir, 'visual-memory.json'),
      JSON.stringify(this._visualMemory, null, 2)
    ).catch(() => {});
  }

  async _loadMemory() {
    try {
      const data = await fs.readFile(path.join(this.dataDir, 'visual-memory.json'), 'utf-8');
      this._visualMemory = JSON.parse(data) || [];
    } catch { this._visualMemory = []; }
  }

  getStatus() {
    return {
      memorySize: this._visualMemory.length,
      maxMemory: this._maxMemory,
      recentTypes: this._visualMemory.slice(-10).map(m => m.type),
    };
  }
}

module.exports = VisualReasoningService;
