/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  EMBEDDING SERVICE v1.0  (Johnny v1.8)                              ║
 * ║                                                                      ║
 * ║  Semantische Embeddings via Ollama (nomic-embed-text)               ║
 * ║  Kein externer API-Key nötig — läuft vollständig lokal.             ║
 * ║                                                                      ║
 * ║  Features:                                                           ║
 * ║  - Kosinus-Ähnlichkeitssuche für Memories                           ║
 * ║  - Embedding-Cache (In-Memory, begrenzt auf 2000 Einträge)          ║
 * ║  - Automatischer Fallback auf Keyword-Suche wenn Ollama offline      ║
 * ║  - Semantisch verwandte Konversationen finden                        ║
 * ║  - Themen-Cluster aus Memories ableiten                             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');

const EMBED_MODEL    = 'nomic-embed-text';   // Standard; kann überschrieben werden
const CACHE_MAX      = 2000;
const EMBED_DIM      = 768;                  // nomic-embed-text Dimensionen

class EmbeddingService {
  constructor(config = {}) {
    this.ollamaUrl   = config.ollamaUrl || 'http://127.0.0.1:11434';
    this.model       = config.embeddingModel || EMBED_MODEL;
    this.cache       = new Map();          // text → Float32Array
    this._available  = null;               // null=ungeprüft, true/false
    this._checkTimer = null;
  }

  async initialize() {
    this._available = await this._checkModel();
    if (this._available) {
      console.log(`[EmbeddingService] ${this.model} ready ✓`);
    } else {
      console.warn(`[EmbeddingService] ${this.model} nicht verfügbar — Keyword-Fallback aktiv`);
      console.warn(`[EmbeddingService] Installieren mit: ollama pull ${this.model}`);
    }
  }

  // ── Embedding erzeugen ─────────────────────────────────────────────────────

  async embed(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.slice(0, 2000).trim();

    // Cache-Hit
    if (this.cache.has(clean)) return this.cache.get(clean);

    if (!this._available) return null;

    try {
      const res = await axios.post(
        `${this.ollamaUrl}/api/embeddings`,
        { model: this.model, prompt: clean },
        { timeout: 10000 }
      );
      const vec = new Float32Array(res.data.embedding);
      this._cacheSet(clean, vec);
      return vec;
    } catch (e) {
      if (this._available !== false) {
        console.warn('[EmbeddingService] Embedding failed:', e.message);
        this._available = false;
      }
      return null;
    }
  }

  async embedBatch(texts) {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  // ── Ähnlichkeitssuche ──────────────────────────────────────────────────────

  /**
   * Findet die k ähnlichsten Texte aus einer Kandidatenliste.
   * Gibt sortiertes Array zurück: [{ text, score, index }, ...]
   */
  async findSimilar(query, candidates, k = 5) {
    const queryVec = await this.embed(query);

    if (!queryVec) {
      // Fallback: Keyword-Matching
      return this._keywordSearch(query, candidates, k);
    }

    const scored = [];
    for (let i = 0; i < candidates.length; i++) {
      const candVec = await this.embed(candidates[i]);
      if (!candVec) continue;
      scored.push({ text: candidates[i], score: _cosine(queryVec, candVec), index: i });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }

  /**
   * Semantische Memory-Suche.
   * memories: Array von { id, content, type, importance, ... }
   * Gibt memories sortiert nach semantischer Relevanz zurück.
   */
  async searchMemories(query, memories, k = 8) {
    if (!memories.length) return [];

    const queryVec = await this.embed(query);
    if (!queryVec) {
      // Keyword-Fallback
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      return memories
        .map(m => ({ ...m, score: words.filter(w => m.content.toLowerCase().includes(w)).length * 2 + m.importance }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    }

    const scored = [];
    for (const mem of memories) {
      const vec = await this.embed(mem.content);
      if (!vec) { scored.push({ ...mem, score: mem.importance }); continue; }
      const sim = _cosine(queryVec, vec);
      // Gewichtete Kombination: 70% semantisch, 30% importance
      scored.push({ ...mem, score: sim * 0.7 + mem.importance * 0.3 });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }

  /**
   * Gruppiert Memories in semantische Cluster (einfaches K-Means-ähnliches Verfahren).
   * Nützlich für "Themen-Übersicht".
   */
  async clusterMemories(memories, numClusters = 5) {
    if (memories.length < numClusters * 2) return [memories];

    // Embeddings für alle Memories holen
    const embedded = [];
    for (const mem of memories) {
      const vec = await this.embed(mem.content);
      if (vec) embedded.push({ mem, vec });
    }
    if (embedded.length < 2) return [memories];

    // Greedy Clustering: ersten numClusters als Zentroiden nehmen
    const centroids = embedded.slice(0, numClusters).map(e => e.vec);
    const clusters  = Array.from({ length: numClusters }, () => []);

    for (const { mem, vec } of embedded) {
      let bestCluster = 0;
      let bestSim     = -1;
      for (let c = 0; c < centroids.length; c++) {
        const sim = _cosine(vec, centroids[c]);
        if (sim > bestSim) { bestSim = sim; bestCluster = c; }
      }
      clusters[bestCluster].push(mem);
    }

    return clusters.filter(c => c.length > 0);
  }

  // ── Hilfsfunktionen ────────────────────────────────────────────────────────

  isAvailable() { return this._available === true; }

  async ensureModel() {
    if (this._available) return true;
    this._available = await this._checkModel();
    return this._available;
  }

  async _checkModel() {
    try {
      const res = await axios.get(`${this.ollamaUrl}/api/tags`, { timeout: 3000 });
      const models = res.data.models || [];
      return models.some(m => m.name.startsWith(this.model.split(':')[0]));
    } catch {
      return false;
    }
  }

  _cacheSet(key, vec) {
    if (this.cache.size >= CACHE_MAX) {
      // Ältesten Eintrag löschen
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, vec);
  }

  _keywordSearch(query, candidates, k) {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    return candidates
      .map((text, index) => ({
        text,
        index,
        score: words.filter(w => text.toLowerCase().includes(w)).length / words.length
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  clearCache() { this.cache.clear(); }
}

// ── Kosinus-Ähnlichkeit ────────────────────────────────────────────────────

function _cosine(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = EmbeddingService;
