// chromadb wird lazy geladen damit undici nicht beim Start crasht
// wenn globalThis.File noch nicht gesetzt ist
let ChromaClient = null;
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

/**
 * RAGService - Retrieval Augmented Generation
 * 
 * Features:
 * - Vector Database (ChromaDB)
 * - Semantic Search
 * - Document Storage
 * - Context Retrieval
 * - Long-term Memory
 */
class RAGService {
  constructor(config) {
    this.client = null;
    this.collections = new Map();
    this.embeddingProvider = config.embeddingProvider || 'ollama';  // v1.8.6: Ollama nomic-embed-text als Standard (kein API-Key nötig)
    this.apiKeys = config.apiKeys || {};
    this.chromaUrl          = config.chromaUrl    || 'http://localhost:8000';
    this._ollamaBaseUrl     = config.ollamaBaseUrl || 'http://127.0.0.1:11434';
    this._ollamaEmbedModel  = config.ollamaEmbedModel || 'nomic-embed-text';
    this._nomicPullAttempted = false;
  }

  async initialize() {
    console.log('Initializing RAG Service...');
    
    // Wenn File-Polyfill fehlt → sofort In-Memory, kein chromadb-Versuch
    if (typeof globalThis.File === 'undefined') {
      console.warn('RAG: globalThis.File not defined, skipping ChromaDB → using in-memory');
      this.client = null;
      this.inMemoryStore = { conversations: [], documents: [], code: [], knowledge: [] };
      return;
    }

    try {
      // Lazy load: chromadb erst hier laden, damit der undici-Polyfill
      // in main.js bereits gesetzt ist bevor undici ausgeführt wird
      if (!ChromaClient) {
        ChromaClient = require('chromadb').ChromaClient;
      }
      this.client = new ChromaClient({ path: this.chromaUrl });
      
      // Erstelle Standard-Collections (Fehler werden still ignoriert wenn ChromaDB offline)
      try { await this.getOrCreateCollection('conversations'); } catch {}
      try { await this.getOrCreateCollection('documents'); } catch {}
      try { await this.getOrCreateCollection('code'); } catch {}
      try { await this.getOrCreateCollection('knowledge'); } catch {}
      
      console.log('RAG Service initialized with ChromaDB ✓');
    } catch (error) {
      console.warn('[RAG] ChromaDB nicht erreichbar — In-Memory-Fallback aktiv (kein ChromaDB-Server nötig)');
      this.client = null;
      this.inMemoryStore = { conversations: [], documents: [], code: [], knowledge: [] };
    }
  }

  async getOrCreateCollection(name) {
    try {
      let collection;
      try {
        collection = await this.client.getCollection({ name });
      } catch {
        collection = await this.client.createCollection({
          name,
          metadata: { 'hnsw:space': 'cosine' }
        });
      }
      this.collections.set(name, collection);
      return collection;
    } catch (error) {
      // Fehler wird vom initialize()-Catch behandelt — kein Spam im Log
      throw error;
    }
  }

  async getEmbedding(text) {
    if (this.embeddingProvider === 'openai') {
      return await this.getOpenAIEmbedding(text);
    } else if (this.embeddingProvider === 'ollama') {
      return await this.getOllamaEmbedding(text);
    }
    
    // Fallback: Simple hash-based embedding (NOT recommended for production)
    return this.simpleEmbedding(text);
  }

  async getOpenAIEmbedding(text) {
    const apiKey = this.apiKeys.openai;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          model: 'text-embedding-3-small',
          input: text
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.data[0].embedding;
    } catch (error) {
      console.error('OpenAI Embedding error:', error);
      throw error;
    }
  }

  async getOllamaEmbedding(text) {
    // v1.8.6: nomic-embed-text ist der Standard — kostenlos, lokal, 768-dim
    // Wenn Modell fehlt → einmaliger Auto-Pull (zeigt Fortschritt im Log)
    const model   = this._ollamaEmbedModel || 'nomic-embed-text';
    const baseUrl = this._ollamaBaseUrl    || 'http://127.0.0.1:11434';

    try {
      const response = await axios.post(
        `${baseUrl}/api/embeddings`,
        { model, prompt: text },
        { timeout: 30000 }
      );
      return response.data.embedding;
    } catch (error) {
      // Modell nicht gefunden → einmal pullen
      if ((error.response?.status === 404 || error.message?.includes('model')) && !this._nomicPullAttempted) {
        this._nomicPullAttempted = true;
        console.log(`[RAG] Embedding-Modell "${model}" nicht gefunden — versuche Pull...`);
        try {
          await axios.post(`${baseUrl}/api/pull`, { name: model, stream: false }, { timeout: 300000 });
          console.log(`[RAG] ${model} erfolgreich geladen — Embedding wird wiederholt`);
          const retry = await axios.post(`${baseUrl}/api/embeddings`, { model, prompt: text }, { timeout: 30000 });
          return retry.data.embedding;
        } catch (pullErr) {
          console.warn(`[RAG] Auto-Pull fehlgeschlagen: ${pullErr.message} — Fallback auf simpleEmbedding`);
        }
      }
      // Fallback auf simpleEmbedding statt Exception
      console.warn(`[RAG] Ollama Embedding fehlgeschlagen (${error.message}) — simpleEmbedding Fallback`);
      return this.simpleEmbedding(text);
    }
  }

  simpleEmbedding(text) {
    // Sehr einfache Embedding-Alternative (nur für Fallback)
    // In Produktion NICHT verwenden!
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(384).fill(0);
    
    words.forEach((word, i) => {
      const hash = this.hashCode(word);
      embedding[hash % 384] += 1;
    });
    
    // Normalisieren
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  async addDocument(collectionName, document) {
    const collection = this.collections.get(collectionName);
    
    if (!collection && !this.inMemoryStore) {
      throw new Error(`Collection ${collectionName} not found`);
    }

    const id = document.id || `doc_${Date.now()}_${Math.random()}`;
    const text = document.text || document.content;
    const metadata = document.metadata || {};

    if (collection) {
      // ChromaDB
      const embedding = await this.getEmbedding(text);
      
      await collection.add({
        ids: [id],
        documents: [text],
        embeddings: [embedding],
        metadatas: [metadata]
      });
    } else {
      // In-Memory Fallback
      this.inMemoryStore[collectionName].push({
        id,
        text,
        metadata,
        embedding: await this.getEmbedding(text)
      });
    }

    return { id, success: true };
  }

  async search(collectionName, query, limit = 5) {
    const collection = this.collections.get(collectionName);
    
    if (!collection && !this.inMemoryStore) {
      throw new Error(`Collection ${collectionName} not found`);
    }

    const queryEmbedding = await this.getEmbedding(query);

    if (collection) {
      // ChromaDB
      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: limit
      });

      return {
        success: true,
        results: results.documents[0].map((doc, i) => ({
          document: doc,
          metadata: results.metadatas[0][i],
          distance: results.distances[0][i],
          id: results.ids[0][i]
        }))
      };
    } else {
      // In-Memory Fallback
      const store = this.inMemoryStore[collectionName];
      const similarities = store.map(item => ({
        ...item,
        similarity: this.cosineSimilarity(queryEmbedding, item.embedding)
      }));
      
      similarities.sort((a, b) => b.similarity - a.similarity);
      
      return {
        success: true,
        results: similarities.slice(0, limit).map(item => ({
          document: item.text,
          metadata: item.metadata,
          similarity: item.similarity,
          id: item.id
        }))
      };
    }
  }

  cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Spezialisierte Funktionen

  async addConversation(agentName, messages, metadata = {}) {
    const text = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    
    return await this.addDocument('conversations', {
      text,
      metadata: {
        agent: agentName,
        messageCount: messages.length,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    });
  }

  async searchConversations(query, agentName = null, limit = 5) {
    const results = await this.search('conversations', query, limit * 2);
    
    if (agentName) {
      // Filtere nach Agent
      const filtered = results.results.filter(r => 
        r.metadata.agent === agentName
      );
      return {
        success: true,
        results: filtered.slice(0, limit)
      };
    }
    
    return {
      success: true,
      results: results.results.slice(0, limit)
    };
  }

  async addCode(code, language, description, metadata = {}) {
    return await this.addDocument('code', {
      text: `${description}\n\n${code}`,
      metadata: {
        language,
        description,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    });
  }

  async searchCode(query, language = null, limit = 5) {
    const results = await this.search('code', query, limit * 2);
    
    if (language) {
      const filtered = results.results.filter(r => 
        r.metadata.language === language
      );
      return {
        success: true,
        results: filtered.slice(0, limit)
      };
    }
    
    return results;
  }

  async addKnowledge(topic, content, metadata = {}) {
    return await this.addDocument('knowledge', {
      text: `${topic}\n\n${content}`,
      metadata: {
        topic,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    });
  }

  async searchKnowledge(query, agentName = null, limit = 5) {
    // Suche in knowledge UND conversations (gefiltert nach Agent)
    const knowledgeResults = await this.search('knowledge', query, limit);
    const conversationResults = agentName
      ? await this.searchConversations(query, agentName, limit)
      : { results: [] };

    const combined = [
      ...(knowledgeResults.results || []),
      ...(conversationResults.results || [])
    ]
      .map(r => ({ ...r, content: r.content || r.document || r.text || '' }))
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, limit);

    return { success: true, results: combined };
  }

  // Context Building für RAG
  async buildContext(query, collections = ['conversations', 'knowledge'], limit = 3) {
    const context = [];
    
    for (const collectionName of collections) {
      const results = await this.search(collectionName, query, limit);
      
      results.results.forEach(result => {
        context.push({
          source: collectionName,
          content: result.document,
          metadata: result.metadata,
          relevance: result.similarity || (1 - result.distance)
        });
      });
    }
    
    // Sortiere nach Relevanz
    context.sort((a, b) => b.relevance - a.relevance);
    
    return {
      success: true,
      context: context.slice(0, limit * collections.length),
      query
    };
  }

  // Statistiken
  async getStats() {
    const stats = {};
    
    for (const [name, collection] of this.collections) {
      if (collection) {
        const count = await collection.count();
        stats[name] = { count };
      }
    }
    
    if (this.inMemoryStore) {
      for (const [name, items] of Object.entries(this.inMemoryStore)) {
        stats[name] = { count: items.length, mode: 'in-memory' };
      }
    }
    
    return stats;
  }

  // Liste Knowledge-Einträge für einen Agenten
  async listKnowledge(agentName) {
    try {
      if (this.client) {
        // ChromaDB: Query knowledge collection
        const collection = this.collections.get('knowledge');
        if (!collection) return { items: [] };
        const results = await collection.get({ limit: 50 });
        const items = (results.documents || []).map((doc, i) => ({
          id: results.ids[i],
          content: doc,
          metadata: results.metadatas ? results.metadatas[i] : {}
        }));
        if (agentName) {
          return { items: items.filter(it => !it.metadata.agent || it.metadata.agent === agentName) };
        }
        return { items };
      } else if (this.inMemoryStore) {
        // In-Memory
        let items = this.inMemoryStore.knowledge.map(item => ({
          id: item.id,
          content: item.text,
          metadata: item.metadata
        }));
        if (agentName) {
          items = items.filter(it => !it.metadata.agent || it.metadata.agent === agentName);
        }
        return { items };
      }
      return { items: [] };
    } catch (e) {
      console.error('listKnowledge error:', e.message);
      return { items: [], error: e.message };
    }
  }
}

module.exports = RAGService;
