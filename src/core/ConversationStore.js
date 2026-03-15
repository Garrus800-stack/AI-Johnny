/**
 * ConversationStore — SQLite-Persistenz via sql.js
 *
 * sql.js ist reines JavaScript (WebAssembly) — kein nativer Build nötig,
 * funktioniert mit jeder Node.js-Version ohne electron-rebuild.
 */

const path = require('path');
const fs   = require('fs');
const fsP  = require('fs').promises;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  agent         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  title         TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  agent           TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  tool_calls      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent, updated_at);
CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL DEFAULT 'default',
  agent         TEXT NOT NULL DEFAULT 'Johnny',
  type          TEXT NOT NULL DEFAULT 'general',
  content       TEXT NOT NULL,
  importance    REAL NOT NULL DEFAULT 0.5,
  source        TEXT DEFAULT 'observation',
  tags          TEXT DEFAULT '[]',
  access_count  INTEGER DEFAULT 0,
  last_accessed INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, importance, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent, created_at);
`;

class ConversationStore {
  constructor(config) {
    this.dataDir    = config.dataDir;
    this.dbName     = config.dbName || 'johnny.db';
    this.db         = null;
    this.SQL        = null;
    this._dirty     = false;
    this._saveTimer = null;
  }

  async initialize() {
    let initSqlJs;
    try {
      initSqlJs = require('sql.js');
    } catch (e) {
      throw new Error('sql.js nicht gefunden. Bitte installieren: npm install sql.js\n' + e.message);
    }

    await fsP.mkdir(this.dataDir, { recursive: true });
    this.SQL    = await initSqlJs();
    this.dbPath = path.join(this.dataDir, this.dbName);

    if (fs.existsSync(this.dbPath)) {
      this.db = new this.SQL.Database(fs.readFileSync(this.dbPath));
      console.log('[ConversationStore] Loaded existing DB:', this.dbPath);
    } else {
      this.db = new this.SQL.Database();
      console.log('[ConversationStore] Created new DB:', this.dbPath);
    }

    this.db.run(SCHEMA);
    this._saveToDisk();
    console.log('[ConversationStore] sql.js ready \u2713');
  }

  _saveToDisk() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
      this._dirty = false;
    } catch (e) {
      console.error('[ConversationStore] Save to disk failed:', e.message);
    }
  }

  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveToDisk(), 1000);
  }

  // ── Conversations ──────────────────────────────────────────────────────────

  loadConversation(agentName, conversationId) {
    const convRes = this.db.exec('SELECT * FROM conversations WHERE id = ?', [conversationId]);
    if (!convRes.length || !convRes[0].values.length) return null;

    const msgRes  = this.db.exec(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [conversationId]
    );
    const messages = [];
    if (msgRes.length && msgRes[0].values.length) {
      for (const row of msgRes[0].values) {
        const r = _obj(msgRes[0].columns, row);
        messages.push({
          role:      r.role,
          content:   r.content,
          timestamp: new Date(r.created_at).toISOString(),
          toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
        });
      }
    }
    const c = _obj(convRes[0].columns, convRes[0].values[0]);
    return { id: c.id, agent: c.agent, created: new Date(c.created_at).toISOString(), messages };
  }

  saveConversation(agentName, conversation) {
    const now = Date.now();
    this.db.run(
      'INSERT INTO conversations(id,agent,created_at,updated_at,message_count) VALUES(?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET updated_at=?',
      [conversation.id, agentName, new Date(conversation.created).getTime() || now, now, now]
    );

    const countRes = this.db.exec('SELECT COUNT(*) FROM messages WHERE conversation_id=?', [conversation.id]);
    const existing = countRes[0]?.values[0]?.[0] || 0;

    for (const msg of conversation.messages.slice(existing)) {
      this.db.run(
        'INSERT INTO messages(conversation_id,agent,role,content,tool_calls,created_at) VALUES(?,?,?,?,?,?)',
        [conversation.id, agentName, msg.role, msg.content || '',
         msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
         msg.timestamp ? new Date(msg.timestamp).getTime() : now]
      );
    }
    this.db.run(
      'UPDATE conversations SET updated_at=?, message_count=(SELECT COUNT(*) FROM messages WHERE conversation_id=?) WHERE id=?',
      [now, conversation.id, conversation.id]
    );
    this._scheduleSave();
  }

  getConversations(agentName, limit = 200, offset = 0) {
    const res = this.db.exec(
      'SELECT id FROM conversations WHERE agent=? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [agentName, limit, offset]
    );
    return res[0]?.values?.map(r => r[0]) || [];
  }

  getConversationsWithMeta(agentName, limit = 50, offset = 0) {
    const res = this.db.exec(
      'SELECT * FROM conversations WHERE agent=? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [agentName, limit, offset]
    );
    if (!res[0]?.values?.length) return [];
    return res[0].values.map(row => {
      const r = _obj(res[0].columns, row);
      return { id: r.id, agent: r.agent, created: new Date(r.created_at).toISOString(),
               updated: new Date(r.updated_at).toISOString(), messageCount: r.message_count };
    });
  }

  deleteConversation(conversationId) {
    this.db.run('DELETE FROM messages WHERE conversation_id=?', [conversationId]);
    this.db.run('DELETE FROM conversations WHERE id=?', [conversationId]);
    this._scheduleSave();
  }

  searchConversations(agentName, query, limit = 20) {
    if (!query || !query.trim()) return [];
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (!words.length) return [];

    // SQL-basierte Suche statt JS-Filter über alle Nachrichten
    const likeClauses = words.map(() => 'LOWER(content) LIKE ?');
    const likeParams  = words.map(w => `%${w}%`);
    const sql = `SELECT * FROM messages WHERE agent=? AND (${likeClauses.join(' OR ')}) ORDER BY created_at DESC LIMIT ?`;
    const res = this.db.exec(sql, [agentName, ...likeParams, limit]);

    if (!res[0]?.values?.length) return [];
    return res[0].values.map(row => _obj(res[0].columns, row));
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  addMemory(mem) {
    if (!mem.content || typeof mem.content !== 'string') return null;
    const now    = Date.now();
    const userId = mem.userId || 'default';
    const id     = `mem_${now}_${Math.random().toString(36).slice(2,6)}`;

    // Duplikat-Schutz
    const recent = this.db.exec(
      'SELECT content FROM memories WHERE user_id=? AND type=? AND created_at>? LIMIT 20',
      [userId, mem.type || 'general', now - 86400000]
    );
    if (recent[0]?.values?.length) {
      for (const row of recent[0].values) {
        if (_similarity(row[0], mem.content) > 0.8) return null;
      }
    }

    this.db.run(
      'INSERT OR REPLACE INTO memories(id,user_id,agent,type,content,importance,source,tags,access_count,last_accessed,created_at) VALUES(?,?,?,?,?,?,?,?,0,NULL,?)',
      [id, userId, mem.agent||'Johnny', mem.type||'general', mem.content.slice(0,500),
       Math.max(0, Math.min(1, mem.importance||0.5)), mem.source||'observation',
       JSON.stringify(Array.isArray(mem.tags)?mem.tags:[]), now]
    );

    // Trim auf 600
    const cnt = this.db.exec('SELECT COUNT(*) FROM memories WHERE user_id=?', [userId]);
    if ((cnt[0]?.values[0]?.[0] || 0) > 600) {
      this.db.run(
        'DELETE FROM memories WHERE user_id=? AND id NOT IN (SELECT id FROM memories WHERE user_id=? ORDER BY importance DESC, created_at DESC LIMIT 500)',
        [userId, userId]
      );
    }
    this._scheduleSave();
    return { id, ts: new Date(now).toISOString(), type: mem.type||'general',
             content: mem.content.slice(0,500), importance: mem.importance||0.5, userId };
  }

  getRelevantMemories(query, limit = 6, userId = 'default') {
    if (!query) return '';
    const res = this.db.exec(
      'SELECT * FROM memories WHERE user_id=? ORDER BY importance DESC, created_at DESC LIMIT 300',
      [userId]
    );
    if (!res[0]?.values?.length) return '';
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored = res[0].values.map(row => {
      const r    = _obj(res[0].columns, row);
      const hits = words.filter(w => r.content.toLowerCase().includes(w)).length;
      return { ...r, score: hits * 2 + r.importance };
    }).sort((a,b) => b.score - a.score).slice(0, limit).filter(m => m.score > 0);

    for (const m of scored) {
      this.db.run('UPDATE memories SET access_count=access_count+1, last_accessed=? WHERE id=?', [Date.now(), m.id]);
    }
    this._scheduleSave();
    return scored.map(m => `[${m.type}] ${m.content}`).join('\n');
  }

  getAllMemories(userId = 'default', limit = 600) {
    const res = this.db.exec(
      'SELECT * FROM memories WHERE user_id=? ORDER BY importance DESC, created_at DESC LIMIT ?',
      [userId, limit]
    );
    if (!res[0]?.values?.length) return [];
    return res[0].values.map(row => {
      const r = _obj(res[0].columns, row);
      return { id: r.id, ts: new Date(r.created_at).toISOString(), type: r.type,
               content: r.content, importance: r.importance, userId: r.user_id,
               source: r.source, tags: JSON.parse(r.tags||'[]'),
               accessCount: r.access_count };
    });
  }

  getMemoryCount(userId = 'default') {
    return this.db.exec('SELECT COUNT(*) FROM memories WHERE user_id=?', [userId])[0]?.values[0]?.[0] || 0;
  }

  // ── Migration ──────────────────────────────────────────────────────────────

  async migrateFromMarkdown(knowledgeDir) {
    let imported = 0;
    try {
      const agents = await fsP.readdir(knowledgeDir).catch(() => []);
      for (const agent of agents) {
        const agentDir = path.join(knowledgeDir, agent);
        if (!(await fsP.stat(agentDir).catch(()=>null))?.isDirectory()) continue;
        const files = await fsP.readdir(agentDir).catch(() => []);
        for (const file of files) {
          if (!file.startsWith('conversation-') || !file.endsWith('.md')) continue;
          const convId = file.replace('conversation-','').replace('.md','');
          if (this.db.exec('SELECT id FROM conversations WHERE id=?',[convId])[0]?.values?.length) continue;
          try {
            const content = await fsP.readFile(path.join(agentDir, file), 'utf-8');
            const conv    = _parseMarkdown(content, agent, file);
            if (conv?.messages?.length) { this.saveConversation(agent, conv); imported++; }
          } catch {}
        }
      }
    } catch {}
    if (imported > 0) { console.log(`[ConversationStore] Migrated ${imported} conversations`); this._saveToDisk(); }
    return imported;
  }

  close() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    if (this._dirty) this._saveToDisk();
    if (this.db) { this.db.close(); this.db = null; }
  }
}

function _obj(cols, row) {
  const o = {};
  cols.forEach((c, i) => { o[c] = row[i]; });
  return o;
}

function _similarity(a, b) {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let n = 0; for (const w of wa) if (wb.has(w)) n++;
  return n / Math.max(wa.size, wb.size);
}

function _parseMarkdown(content, agent, filename) {
  const id = (filename.match(/conversation-(.+)\.md/)||[])[1] || `m_${Date.now()}`;
  const messages = [];
  const rx = /## (USER|ASSISTANT|TOOL)\n\*\*Time:\*\* ([^\n]+)\n\n([\s\S]*?)(?=\n\n---|\n\n## |\s*$)/g;
  let m;
  while ((m = rx.exec(content)) !== null) {
    let c = m[3].trim();
    const i = c.indexOf('\n**Tool Calls:**');
    if (i >= 0) c = c.substring(0, i).trim();
    if (c) messages.push({ role: m[1].toLowerCase(), content: c, timestamp: new Date().toISOString() });
  }
  return { id, agent, created: new Date().toISOString(), messages };
}

module.exports = ConversationStore;
