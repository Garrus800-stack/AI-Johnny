/**
 * BiographicalMemory — Johnnys Lebensgeschichte
 *
 * Löst das "Grabstein-Problem": Johnny liest nicht nur alte Texte,
 * sondern hat eine narrative Selbstgeschichte.
 *
 * Drei Schichten:
 *   1. EPISODISCH — Was ist gerade passiert? (Session-Log)
 *   2. SEMANTISCH — Was weiß ich? (Fakten über User, Projekte, Vorlieben)
 *   3. NARRATIV   — Wer bin ich? (Zusammengefasste Biografie)
 *
 * Die Biografie wird periodisch verdichtet:
 *   - Alle 50 Interaktionen: Episode → Semantisch
 *   - Täglich: Semantisch → Narrativ
 *   - Narrativ ist max 2000 Tokens — immer aktuell, nie überfüllt
 */
'use strict';

const fs = require('fs').promises;
const path = require('path');

class BiographicalMemory {
  constructor(config = {}) {
    this.dataDir = config.dataDir || './data/biography';
    this._episodes  = [];     // Kurzfristig: aktuelle Session
    this._facts     = {};     // Mittelfristig: User-Fakten, Projekt-Details
    this._narrative  = '';     // Langfristig: Johnnys komprimierte Biografie
    this._interactionCount = 0;
    this._lastCondense = 0;
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    await this._load();
    console.log(`[BiographicalMemory] Loaded — ${Object.keys(this._facts).length} facts, narrative: ${this._narrative.length} chars, episodes: ${this._episodes.length}`);
  }

  // ══════════════════════════════════════════════════════════════════
  //  EPISODISCHES GEDÄCHTNIS (Session-Level)
  // ══════════════════════════════════════════════════════════════════

  /** Neue Interaktion aufzeichnen. */
  recordEpisode(episode) {
    this._episodes.push({
      timestamp: Date.now(),
      type: episode.type || 'interaction',  // interaction, tool-use, error, insight
      summary: episode.summary || '',
      userMessage: (episode.userMessage || '').slice(0, 200),
      johnnyResponse: (episode.johnnyResponse || '').slice(0, 200),
      toolsUsed: episode.toolsUsed || [],
      emotion: episode.emotion || null,
      topic: episode.topic || null,
    });

    this._interactionCount++;

    // Alle 50 Interaktionen: Episoden → Fakten verdichten
    if (this._interactionCount % 50 === 0) {
      this._condenseEpisodes().catch(e => console.warn('[BiographicalMemory] Condense failed:', e.message));
    }

    // Max 200 Episoden im RAM
    if (this._episodes.length > 200) {
      this._episodes = this._episodes.slice(-100);
    }

    this._saveDebounced();
  }

  // ══════════════════════════════════════════════════════════════════
  //  SEMANTISCHES GEDÄCHTNIS (Fakten)
  // ══════════════════════════════════════════════════════════════════

  /** Fakt über User/Projekt/Welt speichern. */
  learnFact(category, key, value) {
    if (!this._facts[category]) this._facts[category] = {};
    this._facts[category][key] = {
      value,
      learnedAt: Date.now(),
      confidence: 1.0,
      source: 'interaction',
    };
    this._saveDebounced();
  }

  /** Fakt abrufen. */
  getFact(category, key) {
    return this._facts[category]?.[key]?.value || null;
  }

  /** Alle Fakten einer Kategorie. */
  getCategory(category) {
    const cat = this._facts[category] || {};
    const result = {};
    for (const [k, v] of Object.entries(cat)) {
      result[k] = v.value;
    }
    return result;
  }

  /** Alle bekannten Kategorien. */
  getCategories() {
    return Object.keys(this._facts);
  }

  // ══════════════════════════════════════════════════════════════════
  //  NARRATIVES GEDÄCHTNIS (Biografie)
  // ══════════════════════════════════════════════════════════════════

  /** Johnnys aktuelle Biografie (für System-Prompt). */
  getNarrative() {
    return this._narrative;
  }

  /** Biografie als formatierten Block für den System-Prompt. */
  getSystemPromptBlock() {
    const facts = this._getFactsSummary();
    const recentEpisodes = this._getRecentEpisodesSummary();

    return `[BIOGRAPHICAL MEMORY]
${this._narrative || 'Ich bin Johnny. Meine Geschichte beginnt gerade.'}

[KNOWN FACTS]
${facts || 'Noch keine Fakten gesammelt.'}

[RECENT CONTEXT]
${recentEpisodes || 'Neue Session — keine vorherigen Episoden.'}`;
  }

  // ══════════════════════════════════════════════════════════════════
  //  VERDICHTUNG (Episoden → Fakten → Narrativ)
  // ══════════════════════════════════════════════════════════════════

  /**
   * Episoden in Fakten verdichten.
   * Wird periodisch aufgerufen (alle 50 Interaktionen).
   */
  async _condenseEpisodes() {
    if (this._episodes.length < 10) return;
    if (!this.agentManager) return;

    const episodeSummary = this._episodes.slice(-50).map(ep => {
      return `[${new Date(ep.timestamp).toLocaleString('de')}] ${ep.type}: ${ep.summary || ep.userMessage || ''}`;
    }).join('\n');

    const prompt = `Analysiere diese Interaktions-Episoden und extrahiere Fakten.

EPISODEN:
${episodeSummary}

BESTEHENDE FAKTEN:
${JSON.stringify(this._facts, null, 2)}

Antworte NUR als JSON:
{
  "newFacts": {
    "user": {"key": "value"},
    "projects": {"key": "value"},
    "preferences": {"key": "value"},
    "world": {"key": "value"}
  },
  "narrativeUpdate": "1-2 Sätze die zur Biografie hinzugefügt werden sollten"
}`;

    try {
      const ollama = this.agentManager?.ollamaService;
      if (!ollama) return;
      const response = await ollama.generate(prompt, { temperature: 0.2 });
      const json = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}');

      // Neue Fakten einpflegen
      if (json.newFacts) {
        for (const [cat, facts] of Object.entries(json.newFacts)) {
          for (const [k, v] of Object.entries(facts || {})) {
            this.learnFact(cat, k, v);
          }
        }
      }

      // Narrativ erweitern
      if (json.narrativeUpdate) {
        this._narrative += '\n' + json.narrativeUpdate;
        // Max 2000 Zeichen — bei Überlauf: verdichten
        if (this._narrative.length > 2000) {
          await this._condenseNarrative();
        }
      }

      this._lastCondense = Date.now();
      await this._save();
    } catch (e) {
      console.warn('[BiographicalMemory] Condense failed:', e.message);
    }
  }

  /** Narrativ komprimieren wenn es zu lang wird. */
  async _condenseNarrative() {
    if (!this.agentManager?.ollamaService) return;

    const prompt = `Komprimiere diese Biografie auf maximal 800 Zeichen.
Behalte die wichtigsten Meilensteine, Beziehungen und Erkenntnisse.

AKTUELLE BIOGRAFIE:
${this._narrative}

Antworte NUR mit der komprimierten Biografie, kein JSON.`;

    try {
      const response = await this.agentManager.ollamaService.generate(prompt, { temperature: 0.3 });
      this._narrative = response.trim().slice(0, 1200);
    } catch {}
  }

  // ══════════════════════════════════════════════════════════════════
  //  HELPER
  // ══════════════════════════════════════════════════════════════════

  _getFactsSummary() {
    const lines = [];
    for (const [cat, facts] of Object.entries(this._facts)) {
      const items = Object.entries(facts).map(([k, v]) => `${k}: ${v.value}`).join(', ');
      if (items) lines.push(`${cat}: ${items}`);
    }
    return lines.join('\n') || null;
  }

  _getRecentEpisodesSummary() {
    return this._episodes.slice(-5).map(ep => {
      const time = new Date(ep.timestamp).toLocaleTimeString('de');
      return `[${time}] ${ep.summary || ep.userMessage || ep.type}`;
    }).join('\n') || null;
  }

  // ══════════════════════════════════════════════════════════════════
  //  PERSISTENZ
  // ══════════════════════════════════════════════════════════════════

  _saveTimer = null;
  _saveDebounced() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), 5000);
  }

  async _save() {
    const data = {
      narrative: this._narrative,
      facts: this._facts,
      episodes: this._episodes.slice(-100),
      interactionCount: this._interactionCount,
      lastCondense: this._lastCondense,
    };
    await fs.writeFile(path.join(this.dataDir, 'memory.json'), JSON.stringify(data, null, 2)).catch(() => {});
  }

  async _load() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'memory.json'), 'utf-8');
      const data = JSON.parse(raw);
      this._narrative        = data.narrative || '';
      this._facts            = data.facts || {};
      this._episodes         = data.episodes || [];
      this._interactionCount = data.interactionCount || 0;
      this._lastCondense     = data.lastCondense || 0;
    } catch {}
  }
}

module.exports = BiographicalMemory;
