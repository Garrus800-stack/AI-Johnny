/**
 * IPC Handlers — alle ipcMain.handle() Registrierungen
 *
 * Wurde aus main.js extrahiert (~1500 Zeilen → eigenes Modul).
 * Greift ausschließlich über das ServiceRegistry auf Services zu.
 *
 * register(ipcMain, registry, { sendToRenderer, mainWindow, store })
 */

'use strict';

// ── Task Tracker (intern, kein Service) ──────────────────────────────────────
const taskTracker = {
  tasks: [],
  maxTasks: 100,
  add(agentName, message) {
    const task = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      agent: agentName, message: message.slice(0, 120),
      status: 'running', steps: [],
      created: new Date().toISOString(), startedAt: Date.now(),
      finishedAt: null, duration: null,
    };
    this.tasks.unshift(task);
    if (this.tasks.length > this.maxTasks) this.tasks.pop();
    return task;
  },
  addStep(taskId, step) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) task.steps.push({ ...step, ts: Date.now() });
  },
  finish(taskId, status = 'done') {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = status;
      task.finishedAt = Date.now();
      task.duration = task.finishedAt - task.startedAt;
    }
  },
  getAll()   { return this.tasks; },
  getStats() {
    const running = this.tasks.filter(t => t.status === 'running').length;
    const done    = this.tasks.filter(t => t.status === 'done').length;
    const errors  = this.tasks.filter(t => t.status === 'error').length;
    const avgMs   = this.tasks.filter(t => t.duration).reduce((a, t) => a + t.duration, 0)
                  / (this.tasks.filter(t => t.duration).length || 1);
    return { running, done, errors, total: this.tasks.length, avgDurationMs: Math.round(avgMs) };
  },
};

let _webServer = null;

/**
 * Alle IPC Handler registrieren.
 * @param {Electron.IpcMain}  ipcMain
 * @param {ServiceRegistry}   registry
 * @param {{ sendToRenderer: Function, mainWindow: Function, store: Store }} ctx
 */
function register(ipcMain, registry, ctx) {
  const { sendToRenderer, store } = ctx;
  const win = () => ctx.mainWindow(); // lazy getter

  // ── Globale Module für alle Handler ─────────────────────────────────────
  const path = require('path');
  const { app, shell } = require('electron');
  const fs   = require('fs').promises;

  // ── Helper: Service sicher abrufen ────────────────────────────────────────
  const svc = (name) => registry.get(name);

  // ════════════════════════════════════════════════════════════════════
  // VOICE / AUDIO
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('transcribe-audio', async (_, audioBuffer) => {
    const fsp   = require('fs').promises;
    const os    = require('os');
    const pth   = require('path');
    const execA = require('util').promisify(require('child_process').exec);
    const tmpBase  = pth.join(os.tmpdir(), `johnny_audio_${Date.now()}`);
    const webmFile = tmpBase + '.webm';
    const wavFile  = tmpBase + '.wav';
    const cleanup  = async () => { await fsp.unlink(webmFile).catch(()=>{}); await fsp.unlink(wavFile).catch(()=>{}); };

    await fsp.writeFile(webmFile, Buffer.from(audioBuffer));
    const voiceLang = store.get('settings.voiceLanguage', 'de');

    // ── 1. OPENAI WHISPER API (akzeptiert webm direkt — KEIN ffmpeg nötig) ──
    const openaiKey = store.get('apiKeys.openai');
    if (openaiKey) {
      try {
        const axios    = require('axios');
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file', await fsp.readFile(webmFile), { filename: 'audio.webm', contentType: 'audio/webm' });
        form.append('model', 'whisper-1');
        if (voiceLang && voiceLang !== 'auto') form.append('language', voiceLang);
        const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
          headers: { 'Authorization': `Bearer ${openaiKey}`, ...form.getHeaders() }, timeout: 30000,
        });
        if (res.data?.text?.trim()) { await cleanup(); return res.data.text.trim(); }
      } catch (e) { console.warn('[STT] OpenAI API:', e.response?.data?.error?.message || e.message); }
    }

    // ── 2. ffmpeg webm→wav konvertieren (für lokale Provider) ──────────
    let hasWav = false;
    try {
      await execA(`ffmpeg -i "${webmFile}" -ar 16000 -ac 1 -y "${wavFile}"`, { timeout: 15000 });
      hasWav = true;
    } catch { console.warn('[STT] ffmpeg nicht verfügbar — lokale Provider brauchen es'); }

    if (hasWav) {
      // ── 3. SpeechService ────────────────────────────────────────────
      const speech = svc('speech');
      if (speech && speech._initialized) {
        try {
          const result = await speech.transcribe(wavFile, { language: voiceLang === 'auto' ? 'auto' : voiceLang, denoise: false });
          if (result?.text?.trim()) { await cleanup(); return result.text.trim(); }
        } catch (e) { console.warn('[STT] SpeechService:', e.message); }
      }

      // ── 4. faster-whisper CLI ───────────────────────────────────────
      try {
        const langArg = voiceLang && voiceLang !== 'auto' ? `--language ${voiceLang}` : '';
        const { stdout } = await execA(`faster-whisper "${wavFile}" --model base ${langArg}`, { timeout: 60000, maxBuffer: 5*1024*1024 });
        if (stdout.trim()) { await cleanup(); return stdout.trim(); }
      } catch {}

      // ── 5. Python openai-whisper ────────────────────────────────────
      for (const py of (process.platform === 'win32' ? ['python','python3','py'] : ['python3','python'])) {
        try {
          const esc = wavFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const la  = voiceLang === 'auto' ? '' : `, language="${voiceLang}"`;
          const { stdout } = await execA(`${py} -c "import whisper; m=whisper.load_model('base'); r=m.transcribe(\\"${esc}\\"${la}); print(r['text'])"`, { timeout: 60000 });
          if (stdout.trim()) { await cleanup(); return stdout.trim(); }
        } catch {}
      }
    }

    await cleanup();
    console.warn('[STT] Alle Provider fehlgeschlagen. Benötigt: OpenAI API-Key ODER ffmpeg + (faster-whisper | whisper)');
    return null;
  });

  // ════════════════════════════════════════════════════════════════════
  // AGENTS
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('create-agent', async (_, agentConfig) => {
    const agentManager = svc('agentManager');
    if (!agentConfig.model) {
      const activeProvider = store.get('settings.defaultProvider', 'ollama');
      agentConfig.model         = store.get('settings.model', 'gemma2:9b');
      agentConfig.modelProvider = agentConfig.modelProvider || activeProvider;
    }
    if (!agentConfig.modelProvider) agentConfig.modelProvider = store.get('settings.defaultProvider', 'ollama');
    return agentManager.createAgent(agentConfig);
  });

  ipcMain.handle('get-agents', async () => {
    const agentManager = svc('agentManager');
    if (!agentManager) return [];
    return agentManager.getAgents();
  });

  ipcMain.handle('update-agent-model', async (_, { agentName, model, modelProvider: prov }) => {
    const agentManager = svc('agentManager');
    if (!agentManager) return { success: false, error: 'AgentManager not ready' };
    const agent = agentManager.agents.get(agentName);
    if (!agent) return { success: false, error: 'Agent not found: ' + agentName };
    agent.model         = model;
    agent.modelProvider = prov || 'ollama';
    await agentManager.saveAgentMarkdown(agent);
    return { success: true };
  });

  ipcMain.handle('delete-agent', async (_, agentName) => {
    await svc('agentManager').deleteAgent(agentName);
    return { success: true };
  });

  ipcMain.handle('get-conversations', async (_, agentName) => {
    const agentManager = svc('agentManager');
    if (!agentManager) return [];
    return agentManager.getConversations(agentName);
  });

  // Alias — UI nutzt list-conversations
  ipcMain.handle('list-conversations', async (_, agentName) => {
    const cs = svc('conversationStore');
    if (cs) return cs.getConversationsWithMeta(agentName || 'Johnny', 50, 0);
    const am = svc('agentManager');
    return am ? am.getConversations(agentName || 'Johnny') : [];
  });

  ipcMain.handle('get-conversations-meta', async (_, { agentName, limit, offset }) => {
    const cs = svc('conversationStore');
    if (!cs) return [];
    return cs.getConversationsWithMeta(agentName, limit || 50, offset || 0);
  });

  ipcMain.handle('load-conversation', async (_, { agentName, conversationId }) => {
    const am = svc('agentManager');
    if (!am) return null;
    return am.loadConversation(agentName, conversationId);
  });

  // Alias — UI nutzt export-conversation (singular)
  ipcMain.handle('export-conversation', async (_, { conversationId, agentName }) => {
    const am = svc('agentManager');
    if (!am) return { error: 'AgentManager nicht verfügbar' };
    try {
      const conv = await am.loadConversation(agentName || 'Johnny', conversationId);
      if (!conv) return { error: 'Gespräch nicht gefunden' };
      const content = (conv.messages || []).map(function(m) {
        return '[' + m.role.toUpperCase() + '] ' + (m.content || '');
      }).join('\n\n');
      const filename = 'conversation-' + (conversationId || '').slice(0, 8) + '.md';
      const fsp = require('fs').promises;
      const path = require('path');
      const { app } = require('electron');
      const outDir = path.join(app.getPath('userData'), 'outputs');
      await fsp.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, filename);
      await fsp.writeFile(outPath, '# Gespräch ' + conversationId + '\n\n' + content);
      return { success: true, path: outPath };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('get-consciousness-state', async () => {
    const agentManager = registry.get('agentManager');
    if (!agentManager || !agentManager.johnny) return { error: 'Johnny nicht initialisiert' };
    try {
      return agentManager.johnny.getConsciousnessState();
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('get-johnny-summary', async () => {
    const am = svc('agentManager');
    if (!am?.johnny) return null;
    return am.johnny.getSummary();
  });

  ipcMain.handle('search-conversations', async (_, { agentName, query }) => {
    const cs = svc('conversationStore');
    if (!cs) return [];
    return cs.searchConversations(agentName, query);
  });

  // ── Memory Management ─────────────────────────────────────────────────────
  ipcMain.handle('get-memories', async (_, { userId, limit }) => {
    const cs = svc('conversationStore');
    if (!cs) return [];
    return cs.getAllMemories(userId || 'default', limit || 100);
  });

  ipcMain.handle('get-memory-count', async (_, { userId }) => {
    const cs = svc('conversationStore');
    if (!cs) return 0;
    return cs.getMemoryCount(userId || 'default');
  });

  ipcMain.handle('add-memory', async (_, memData) => {
    const cs = svc('conversationStore');
    if (!cs) return null;
    return cs.addMemory(memData);
  });

  // ════════════════════════════════════════════════════════════════════
  // SEND MESSAGE (mit Task Tracker + Streaming)
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('send-message', async (_, data) => {
    const agentManager = svc('agentManager');
    if (!agentManager) return { response: 'Johnny is still initializing...', conversationId: null };
    const { agentName, message, conversationId } = data;
    if (!message || !message.trim()) return { response: 'Leere Nachricht.', conversationId: null };

    const task = taskTracker.add(agentName, message);
    agentManager.stepEmitter = (stepData) => {
      taskTracker.addStep(task.id, stepData);
      win()?.webContents?.send('tool-step',    stepData);
      win()?.webContents?.send('task-update',  { task: { ...task, steps: task.steps } });
    };

    try {
      const response = await agentManager.sendMessage(agentName, message, conversationId);
      agentManager.stepEmitter = null;
      taskTracker.finish(task.id, 'done');
      win()?.webContents?.send('task-update', { task: { ...task, status: 'done' } });
      return response;
    } catch (err) {
      agentManager.stepEmitter = null;
      taskTracker.finish(task.id, 'error');
      win()?.webContents?.send('task-update', { task: { ...task, status: 'error' } });
      throw err;
    }
  });

  ipcMain.handle('send-message-stream', async (_, data) => {
    const agentManager = svc('agentManager');
    if (!agentManager) return { error: 'Johnny is still initializing...' };
    const { agentName, message, conversationId } = data;

    const task = taskTracker.add(agentName, message);
    let chunkIndex = 0;

    agentManager.streamEmitter = (chunk) => {
      win()?.webContents?.send('stream-chunk', { index: chunkIndex++, text: chunk, done: false });
    };
    agentManager.stepEmitter = (stepData) => {
      taskTracker.addStep(task.id, stepData);
      win()?.webContents?.send('tool-step',   stepData);
      win()?.webContents?.send('task-update', { task: { ...task, steps: task.steps } });
    };

    try {
      const response = await agentManager.sendMessage(agentName, message, conversationId);
      agentManager.streamEmitter = null;
      agentManager.stepEmitter   = null;
      taskTracker.finish(task.id, 'done');
      win()?.webContents?.send('stream-chunk', { index: chunkIndex, text: '', done: true });
      win()?.webContents?.send('task-update',  { task: { ...task, status: 'done' } });
      return response;
    } catch (err) {
      agentManager.streamEmitter = null;
      agentManager.stepEmitter   = null;
      taskTracker.finish(task.id, 'error');
      win()?.webContents?.send('stream-chunk', { index: chunkIndex, text: '', done: true, error: err.message });
      throw err;
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // TASK TRACKER
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('get-tasks',       async () => taskTracker.getAll());
  ipcMain.handle('get-task-stats',  async () => taskTracker.getStats());
  ipcMain.handle('clear-tasks',     async () => { taskTracker.tasks = []; return { ok: true }; });

  // ════════════════════════════════════════════════════════════════════
  // SETTINGS & PROVIDERS
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('get-settings',  async () => store.store);

  ipcMain.handle('save-settings', async (_, settings) => {
    // Bekannte Settings mit korrektem Namespace speichern
    const knownMappings = {
      model:           'settings.model',
      ollamaUrl:       'settings.ollamaUrl',
      telegramToken:   'settings.telegramToken',
      defaultProvider: 'settings.defaultProvider',
      voiceLanguage:   'settings.voiceLanguage',
      ttsProvider:     'settings.ttsProvider',
      openaiTtsVoice:  'settings.openaiTtsVoice',
      searchEngine:    'settings.searchEngine',
      sandboxMode:     'settings.sandboxMode',
    };
    const keyMappings = {
      elevenlabsKey: 'apiKeys.elevenlabs',
    };
    for (const [k, v] of Object.entries(settings)) {
      if (v === undefined || v === null) continue;
      if (knownMappings[k]) {
        store.set(knownMappings[k], v);
      } else if (keyMappings[k]) {
        store.set(keyMappings[k], v);
      } else if (k.includes('.')) {
        // Bereits namespaced (z.B. 'settings.X' oder 'apiKeys.Y')
        store.set(k, v);
      }
      // Unbekannte flache Keys werden ignoriert → verhindert Store-Verschmutzung
    }

    const ollama        = svc('ollama');
    const modelProvider = svc('modelProvider');
    if (settings.model     && ollama)        ollama.model         = settings.model;
    if (settings.ollamaUrl && ollama)        ollama.baseUrl       = settings.ollamaUrl;
    if (settings.defaultProvider && modelProvider) modelProvider.defaultProvider = settings.defaultProvider;
    return { success: true };
  });

  ipcMain.handle('get-system-stats', async () => {
    const si = require('systeminformation');
    try {
      const [cpu, mem, disk, network, processes] = await Promise.all([
        si.currentLoad(), si.mem(), si.fsSize(), si.networkStats(), si.processes(),
      ]);
      return {
        timestamp: Date.now(),
        cpu:     { usage: cpu.currentLoad, cores: cpu.cpus.length },
        memory:  { total: mem.total, used: mem.used, free: mem.free, percentage: (mem.used / mem.total) * 100 },
        disk:    disk.map(d => ({ mount: d.mount, total: d.size, used: d.used, percentage: d.use || 0 })),
        network: network.map(n => ({ interface: n.iface, rx: n.rx_sec || 0, tx: n.tx_sec || 0 })),
        processes: {
          all: processes.all, running: processes.running,
          list: processes.list.slice(0, 80).map(p => ({
            pid: p.pid, name: p.name, cpu: p.cpu, mem: p.mem,
            path: p.path || '',
          })),
        },
      };
    } catch (e) {
      // Minimal fallback
      const si2 = require('systeminformation');
      const [cpu, mem] = await Promise.all([si2.currentLoad(), si2.mem()]);
      return {
        timestamp: Date.now(),
        cpu:    { usage: cpu.currentLoad, cores: cpu.cpus.length },
        memory: { total: mem.total, used: mem.used, free: mem.free, percentage: (mem.used / mem.total) * 100 },
        disk: [], network: [], processes: { all: 0, running: 0, list: [] },
      };
    }
  });

  ipcMain.handle('set-clipboard-text', async (_, text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    return { success: true };
  });

  ipcMain.handle('execute-system-command', async (_, command) => {
    return svc('agentManager').executeSystemCommand(command);
  });

  ipcMain.handle('get-providers', async () => {
    const mp = svc('modelProvider');
    return mp ? mp.getProviders() : [];
  });

  ipcMain.handle('get-models', async (_, provider) => {
    const mp = svc('modelProvider');
    if (!mp) return [];
    // Für Ollama: live Modelle von der API holen
    if (provider === 'ollama') {
      const ollamaUrl = store.get('settings.ollamaUrl', 'http://127.0.0.1:11434');
      return mp.getOllamaModels(ollamaUrl);
    }
    return mp.getModels(provider) || [];
  });

  ipcMain.handle('set-active-provider-model', async (_, { provider, model }) => {
    const ollama        = svc('ollama');
    const agentManager  = svc('agentManager');
    const modelProvider = svc('modelProvider');

    if (provider === 'ollama' && ollama) {
      const oldModel = ollama.model;
      if (oldModel && oldModel !== model) {
        const axios = require('axios');
        await axios.post(`${ollama.baseUrl}/api/generate`, { model: oldModel, prompt: '', keep_alive: 0 }, { timeout: 5000 }).catch(() => {});
      }
    }
    store.set('settings.defaultProvider', provider);
    store.set('settings.model', model);
    if (provider === 'ollama' && ollama)   ollama.model = model;
    if (modelProvider) modelProvider.defaultProvider = provider;
    if (agentManager) {
      const johnny = agentManager.agents.get('Johnny');
      if (johnny) {
        johnny.modelProvider = provider;
        johnny.model         = model;
        await agentManager.saveAgentMarkdown(johnny).catch(() => {});
      }
    }
    win()?.webContents?.send('model-switched', { provider, model });
    return { success: true, provider, model };
  });

  ipcMain.handle('set-api-key', async (_, { provider, apiKey }) => {
    svc('modelProvider')?.setApiKey(provider, apiKey);
    store.set(`apiKeys.${provider}`, apiKey);
    return { success: true };
  });

  ipcMain.handle('test-provider', async (_, { provider, model }) => {
    return svc('modelProvider')?.testProvider(provider, model);
  });

  // ════════════════════════════════════════════════════════════════════
  // OLLAMA
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('list-ollama-models', async () => {
    const axios      = require('axios');
    const ollamaUrl  = store.get('settings.ollamaUrl', 'http://127.0.0.1:11434');
    try {
      const response = await axios.get(ollamaUrl + '/api/tags', { timeout: 3000 });
      return response.data.models || [];
    } catch {
      return svc('ollama')?.listModels() || [];
    }
  });

  ipcMain.handle('pull-ollama-model', async (_, modelName) => {
    const axios     = require('axios');
    const ollamaUrl = store.get('settings.ollamaUrl', 'http://127.0.0.1:11434');
    const response  = await axios.post(ollamaUrl + '/api/pull', { name: modelName, stream: true }, { responseType: 'stream' });
    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        try {
          for (const line of chunk.toString().split('\n').filter(l => l.trim())) {
            const data = JSON.parse(line);
            const pct  = data.total && data.completed ? Math.round((data.completed / data.total) * 100) : null;
            win()?.webContents?.send('model-pull-progress', { status: data.status || '', percent: pct });
          }
        } catch {}
      });
      response.data.on('end',   () => resolve({ success: true }));
      response.data.on('error', reject);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // WEBSERVER
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('start-webserver', async (_, config) => {
    if (_webServer) throw new Error('Webserver already running');
    const express  = require('express');
    const webApp   = express();
    const port     = config.port || 3000;
    const authToken = config.authToken || store.get('settings.webserverToken') || null;

    webApp.use(express.json({ limit: '1mb' }));

    // ── Rate-Limiting (einfach, ohne externe Deps) ────────────────────────
    const rateLimiter = new Map(); // IP → { count, resetAt }
    const RATE_LIMIT  = 30;       // Max 30 Requests pro Minute
    webApp.use('/api', (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      let entry = rateLimiter.get(ip);
      if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + 60000 }; rateLimiter.set(ip, entry); }
      entry.count++;
      if (entry.count > RATE_LIMIT) { return res.status(429).json({ error: 'Too many requests. Max 30/min.' }); }
      // Auth-Token prüfen wenn gesetzt
      if (authToken) {
        const bearer = req.headers.authorization?.replace('Bearer ', '');
        if (bearer !== authToken) { return res.status(401).json({ error: 'Invalid or missing auth token' }); }
      }
      next();
    });
    // Rate-Limiter aufräumen alle 5min
    const rlCleanup = setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of rateLimiter) { if (now > entry.resetAt) rateLimiter.delete(ip); }
    }, 300000);

    webApp.use(express.static(config.publicDir || 'public'));

    // ── GET /health — Health-Check für Docker / Monitoring ──────────────
    webApp.get('/health', (req, res) => {
      const am = svc('agentManager');
      const ol = svc('ollamaService');
      res.json({
        status:   'ok',
        version:  '1.8.3',
        model:    ol?.model || store.get('settings.model') || 'unknown',
        provider: store.get('settings.defaultProvider') || 'ollama',
        agents:   am ? am.agents.size : 0,
        uptime:   Math.round(process.uptime()),
        ts:       new Date().toISOString(),
      });
    });

    webApp.post('/api/chat', async (req, res) => {
      try {
        const { message, agent } = req.body;
        if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
        const response = await svc('agentManager').sendMessage(agent || 'Johnny', message.slice(0, 10000));
        res.json(response);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    _webServer = webApp.listen(port, () => {
      sendToRenderer('webserver-started', { port, hasAuth: !!authToken });
    });
    _webServer._rlCleanup = rlCleanup;
    return { port, status: 'running', hasAuth: !!authToken };
  });

  ipcMain.handle('stop-webserver', async () => {
    if (!_webServer) throw new Error('No webserver running');
    if (_webServer._rlCleanup) clearInterval(_webServer._rlCleanup);
    _webServer.close();
    _webServer = null;
    sendToRenderer('webserver-stopped', {});
    return { status: 'stopped' };
  });

  // ════════════════════════════════════════════════════════════════════
  // PLUGINS & SKILLS
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('list-skills',     async () => svc('pluginManager')?.listSkills() || []);
  ipcMain.handle('create-skill',    async (_, config) => svc('pluginManager').createSkill(config));
  ipcMain.handle('update-skill',    async (_, config) => svc('pluginManager').updateSkill(config));
  ipcMain.handle('delete-skill',    async (_, skillId) => { await svc('pluginManager').deleteSkill(skillId); return { success: true }; });
  ipcMain.handle('list-plugins',    async () => svc('pluginManager')?.listPlugins() || []);
  ipcMain.handle('install-plugin',  async (_, url) => svc('pluginManager').installPluginFromUrl(url));

  // ════════════════════════════════════════════════════════════════════
  // RAG
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('rag-search', async (_, { query, agentName }) => {
    if (!svc('rag')) return { results: [] };
    return svc('rag').searchKnowledge(query, agentName);
  });
  ipcMain.handle('rag-add-knowledge', async (_, { topic, content }) => {
    if (!svc('rag')) return { success: false };
    return svc('rag').addKnowledge(topic, content);
  });
  ipcMain.handle('rag-stats',  async () => svc('rag')?.getStats() || {});
  ipcMain.handle('rag-status', async () => {
    const rag = svc('rag');
    if (!rag) return { available: false, mode: 'none' };
    return { available: true, mode: rag.client ? 'chromadb' : 'in-memory' };
  });
  ipcMain.handle('rag-list-knowledge', async (_, { agentName }) => {
    if (!svc('rag')) return { items: [] };
    return svc('rag').listKnowledge(agentName);
  });

  // ════════════════════════════════════════════════════════════════════
  // VISION, BROWSER, SEARCH
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('browser-screenshot', async (_, url) => {
    if (!svc('browser')) return { error: 'Browser service not available' };
    return svc('browser').navigateAndCapture(url);
  });
  ipcMain.handle('vision-analyze', async (_, { imagePath, imageData, prompt, mode }) => {
    if (!svc('vision')) return { error: 'Vision service not available' };
    const input = imageData || imagePath;
    if (!input) return { error: 'Kein Bild angegeben' };
    if (mode) return svc('vision').analyzeMode(input, mode);
    return svc('vision').analyzeImage(input, prompt || 'Was siehst du auf diesem Bild?');
  });
  ipcMain.handle('vision-status', async () => {
    const v = svc('vision');
    return { available: !!v, localModel: v?.getAvailableModel() || null, isLocal: v?.isLocalAvailable() || false };
  });

  // ── v1.8: Style Profile ───────────────────────────────────────────────────
  ipcMain.handle('style-get', async (_, { userId } = {}) => {
    const sp = svc('styleProfile');
    return sp ? sp.getSummary(userId) : null;
  });
  ipcMain.handle('style-set', async (_, { userId, changes }) => {
    const sp = svc('styleProfile');
    if (!sp) return { error: 'StyleProfile service not available' };
    await sp.applyChanges(userId, changes, 'user');
    const am = svc('agentManager');
    if (am?.johnny) await am.johnny.setStylePreference(userId, changes, 'user');
    return sp.getSummary(userId);
  });
  ipcMain.handle('style-reset', async (_, { userId } = {}) => {
    const sp = svc('styleProfile');
    if (!sp) return { error: 'StyleProfile service not available' };
    return sp.resetProfile(userId);
  });
  ipcMain.handle('style-history', async (_, { userId } = {}) => {
    const sp = svc('styleProfile');
    return sp ? sp.getHistory(userId) : [];
  });

  // ── v1.8: Embeddings ──────────────────────────────────────────────────────
  ipcMain.handle('embedding-search-memories', async (_, { query, userId, limit }) => {
    const em = svc('embedding');
    const cs = svc('conversationStore');
    if (!cs) return { error: 'ConversationStore nicht verfügbar' };
    const memories = cs.getAllMemories(userId || 'default', 200);
    if (em?.isAvailable()) {
      return em.searchMemories(query, memories, limit || 8);
    }
    return cs.getAllMemories(userId || 'default', limit || 8);
  });
  ipcMain.handle('embedding-status', async () => {
    const em = svc('embedding');
    return { available: em?.isAvailable() || false, model: em?.model || null };
  });

  // ── v1.8: Kreativ-Modus / Multi-Modell-Vergleich ─────────────────────────
  ipcMain.handle('creativity-compare-models', async (_, { prompt, models, style }) => {
    const cr = svc('creativity');
    if (!cr) return { error: 'Creativity service not available' };
    return cr.compareModels(prompt, { models, style });
  });
  ipcMain.handle('creativity-variants', async (_, { prompt, count, model }) => {
    const cr = svc('creativity');
    if (!cr) return { error: 'Creativity service not available' };
    return cr.generateVariants(prompt, { count, model });
  });
  ipcMain.handle('web-search', async (_, { query, engine, limit }) => {
    if (!svc('search')) return { error: 'Search service not available' };
    return svc('search').search(query, { engine, limit });
  });
  ipcMain.handle('set-search-api-key', async (_, { engine, apiKey, cx }) => {
    store.set(`apiKeys.${engine}`, apiKey);
    if (cx) store.set('apiKeys.googleSearchCx', cx);
    const search = svc('search');
    if (search) search.apiKeys[engine] = apiKey;
    return { success: true };
  });

  // ════════════════════════════════════════════════════════════════════
  // IMAGE & VIDEO
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('generate-image', async (_, { prompt, provider, size, style, quality, n }) => {
    const imgSvc = svc('imageGen');
    if (!imgSvc) {
      // Try to initialize on demand
      const ImageGenerationService = require('./src/services/ImageGenerationService');
      const newSvc = new ImageGenerationService({
        apiKeys: {
          openai:    store.get('apiKeys.openai'),
          replicate: store.get('apiKeys.replicate'),
          sdUrl:     store.get('settings.sdUrl', 'http://localhost:7860'),
        },
        outputDir: path.join(app.getPath('userData'), 'generated-images'),
        defaultProvider: store.get('settings.imageProvider', 'openai'),
      });
      await newSvc.initialize().catch(() => {});
      registry.registerInstance('imageGen', newSvc);
    }
    try {
      return await svc('imageGen').generate({ prompt, provider, size, style, quality, n });
    } catch (err) {
      const msg = err.message || 'Unbekannter Fehler';
      if (msg.includes('ECONNREFUSED') || msg.includes('7860')) {
        return { error: 'Stable Diffusion nicht erreichbar (localhost:7860). Starte AUTOMATIC1111 mit: python launch.py --api --listen' };
      }
      if (msg.includes('API key') || msg.includes('apiKey')) {
        return { error: 'API-Key fehlt. Gehe zu Models → Cloud Providers und trage den Key ein.' };
      }
      return { error: msg };
    }
  });
  ipcMain.handle('get-image-providers', async () => svc('imageGen')?.getProviders() || [
    { id: 'openai', name: 'DALL-E 3 (OpenAI)', requiresKey: 'openai', hasKey: !!store.get('apiKeys.openai'), sizes: ['1024x1024','1792x1024','1024x1792'] },
    { id: 'replicate', name: 'SDXL (Replicate)', requiresKey: 'replicate', hasKey: !!store.get('apiKeys.replicate'), sizes: ['1024x1024'] },
    { id: 'stable-diffusion', name: 'Stable Diffusion (Lokal)', requiresKey: false, hasKey: true, sizes: ['512x512','768x768','1024x1024'] },
  ]);

  ipcMain.handle('analyze-video', async (_, { videoPath, prompt, provider, maxFrames, includeAudio }) => {
    if (!svc('video')) return { error: 'Video analysis service not available' };
    return svc('video').analyze(videoPath, { prompt, provider, maxFrames, includeAudio });
  });
  ipcMain.handle('video-service-status', async () => {
    const v = svc('video');
    const platform = process.platform;
    const hint = v?.isAvailable() ? null
      : platform === 'win32' ? 'winget install ffmpeg  (dann App neu starten)'
      : platform === 'darwin' ? 'brew install ffmpeg  (dann App neu starten)'
      : 'sudo apt install ffmpeg  (dann App neu starten)';
    return {
      available:  v?.isAvailable()  || false,
      ffmpegPath: v?.ffmpegBin      || null,
      installHint: hint,
    };
  });

  // ════════════════════════════════════════════════════════════════════
  // SANDBOX
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('sandbox-run', async (_, { language, code, timeout }) => {
    if (!svc('sandbox')) return { error: 'Sandbox service not initialized' };
    return svc('sandbox').runCode(language, code, { timeout });
  });
  ipcMain.handle('sandbox-status',   async () => svc('sandbox')?.getStatus() || { mode: 'unavailable' });
  ipcMain.handle('sandbox-set-mode', async (_, mode) => {
    if (!svc('sandbox')) return { error: 'Sandbox service not initialized' };
    const status = await svc('sandbox').setMode(mode);
    store.set('settings.sandboxMode', mode);
    return status;
  });

  // ════════════════════════════════════════════════════════════════════
  // EMAIL & MESSENGER
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('create-email-account', async (_, config) => svc('email').createAccount(config));
  ipcMain.handle('list-email-accounts',  async () => svc('email')?.listAccounts() || []);
  ipcMain.handle('send-email',           async (_, config) => svc('email').sendEmail(config));
  ipcMain.handle('delete-email-account', async (_, accountId) => { await svc('email').deleteAccount(accountId); return { success: true }; });

  ipcMain.handle('connect-messenger', async (_, { messenger, config }) => {
    const ms = svc('messenger');
    if (!ms) return { error: 'Messenger Service nicht initialisiert', messenger, status: 'error' };
    switch (messenger) {
      case 'whatsapp': return ms.connectWhatsApp(config || {});
      case 'signal':   return ms.connectSignal(config || {});
      case 'discord':  return ms.connectDiscord(config || {});
      case 'slack':    return ms.connectSlack(config || {});
      case 'matrix':   return ms.connectMatrix(config || {});
      default:         return { error: `Unbekannter Messenger: ${messenger}`, messenger, status: 'error' };
    }
  });
  ipcMain.handle('disconnect-messenger',    async (_, messenger) => { await svc('messenger')?.disconnect(messenger); return { success: true }; });
  ipcMain.handle('get-messenger-status',    async () => svc('messenger')?.getStatus() || []);
  ipcMain.handle('send-messenger-message',  async (_, { messenger, recipient, message }) => {
    if (!svc('messenger')) return { success: false, error: 'nicht initialisiert' };
    return svc('messenger').sendMessage(messenger, recipient, message);
  });

  // ════════════════════════════════════════════════════════════════════
  // SERVICE STATUS
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('get-service-status', async () => {
    const statusMap = registry.getStatusMap();
    const speechSvc = svc('speech');
    const sensorSvc = svc('sensor');

    return {
      ollama:        statusMap.ollama === 'ok',
      rag:           statusMap.rag    === 'ok',
      browser:       statusMap.browser === 'ok',
      vision:        statusMap.vision === 'ok',
      search:        statusMap.search === 'ok',
      sandbox:       svc('sandbox')?.resolvedMode || false,
      imageGen:      statusMap.imageGen === 'ok',
      video:         svc('video')?.isAvailable() || false,
      collaboration: svc('collaboration')?.running || false,
      telegram:      statusMap.telegram === 'ok',
      mcp:           statusMap.mcp === 'ok',
      email:         svc('email')?.accounts?.size || 0,
      messenger:     svc('messenger')?.messengers?.size || 0,
      // v2.1: Neue Services
      nlp:           statusMap.nlp === 'ok',
      sensor:        statusMap.sensor === 'ok',
      webAutonomy:   statusMap.webAutonomy === 'ok',
      speech:        statusMap.speech === 'ok',
      creativity:    statusMap.creativity === 'ok',
      smartHome:     statusMap.smartHome === 'ok',
      // Detaillierte Capabilities
      speechCapabilities: speechSvc?.getCapabilities?.() || null,
      sensorCapabilities: sensorSvc?.getCapabilities?.() || null,
      // Vollständige Registry-Status
      registry:      statusMap,
    };
  });

  // Registry Health (v2.1 — ServiceRegistry v2)
  ipcMain.handle('get-registry-health', async () => {
    return registry.getHealth ? registry.getHealth() : { error: 'ServiceRegistry v1 — kein Health-Check' };
  });

  // ════════════════════════════════════════════════════════════════════
  // CONVERSATION MANAGEMENT
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('delete-conversation', async (_, { agentName, conversationId }) => {
    const cs = svc('conversationStore');
    if (cs) {
      cs.deleteConversation(conversationId);
      return { success: true };
    }
    // Fallback: Markdown-Datei löschen über AgentManager
    const am = svc('agentManager');
    if (am?.knowledgeDir) {
      const path = require('path');
      const fs   = require('fs').promises;
      await fs.unlink(path.join(am.knowledgeDir, agentName, `conversation-${conversationId}.md`)).catch(() => {});
    }
    return { success: true };
  });

  ipcMain.handle('export-conversations', async (_, agentName) => {
    const cs = svc('conversationStore');
    if (cs) {
      const convIds = cs.getConversations(agentName);
      const conversations = convIds.map(id => {
        const conv = cs.loadConversation(agentName, id);
        return { id, messages: conv?.messages || [] };
      });
      return { success: true, conversations };
    }
    return { success: false, conversations: [], error: 'No store available' };
  });

  // ════════════════════════════════════════════════════════════════════
  // SCHEDULER
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('list-scheduled-tasks', async () => {
    const agentManager = svc('agentManager');
    if (!agentManager?._scheduledTasks) return [];
    const tasks = [];
    agentManager._scheduledTasks.forEach((v, k) => tasks.push({ id: k, name: v.name, cron: v.cron, command: v.command }));
    return tasks;
  });
  ipcMain.handle('cancel-scheduled-task', async (_, taskId) => {
    const agentManager = svc('agentManager');
    if (!agentManager?._scheduledTasks) return { error: 'No tasks' };
    const t = agentManager._scheduledTasks.get(taskId);
    if (t) { t.task.stop(); agentManager._scheduledTasks.delete(taskId); return { success: true }; }
    return { error: 'Task not found' };
  });

  // ════════════════════════════════════════════════════════════════════
  // CLOUDFLARE
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('start-cloudflare-tunnel', async (_, config) => {
    if (!svc('cloudflare')) throw new Error('Cloudflare service not initialized');
    return svc('cloudflare').createTunnel(config);
  });
  ipcMain.handle('stop-cloudflare-tunnel', async () => {
    await svc('cloudflare')?.stopTunnel();
    return { success: true };
  });
  ipcMain.handle('install-cloudflared', async () => {
    if (!svc('cloudflare')) throw new Error('Cloudflare service not available');
    return svc('cloudflare').install();
  });

  // ════════════════════════════════════════════════════════════════════
  // GATEWAY, SWARM, HEARTBEAT TASKS
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('get-gateway-status', async () => svc('gateway')?.getStatus() || { running: false });
  ipcMain.handle('start-gateway',      async () => { try { return { success: true, ...await svc('gateway').start() }; } catch (e) { return { error: e.message }; } });
  ipcMain.handle('stop-gateway',       async () => { try { await svc('gateway')?.stop(); return { success: true }; } catch (e) { return { error: e.message }; } });

  ipcMain.handle('run-swarm',    async (_, config)   => svc('swarm')?.runSwarm(config) || { error: 'Swarm not available' });
  ipcMain.handle('get-swarms',   async ()             => svc('swarm')?.getActiveSwarms() || []);
  ipcMain.handle('cancel-swarm', async (_, swarmId)  => { await svc('swarm')?.cancelSwarm(swarmId); return { success: true }; });

  ipcMain.handle('create-heartbeat-task',      async (_, config) => svc('heartbeatTask')?.createTask(config));
  ipcMain.handle('create-morning-briefing',    async (_, config) => svc('heartbeatTask')?.createMorningBriefing(config));
  ipcMain.handle('create-system-health-check', async (_, config) => svc('heartbeatTask')?.createSystemHealthCheck(config));
  ipcMain.handle('create-web-monitor',         async (_, config) => svc('heartbeatTask')?.createWebMonitor(config));
  ipcMain.handle('create-daily-reflection',    async (_, config) => svc('heartbeatTask')?.createDailyReflection(config));
  ipcMain.handle('create-service-watchdog',    async (_, config) => svc('heartbeatTask')?.createServiceWatchdog(config));
  ipcMain.handle('create-cleanup-task',        async (_, config) => svc('heartbeatTask')?.createCleanupTask(config));
  ipcMain.handle('get-heartbeat-tasks',        async ()          => svc('heartbeatTask')?.getTasks() || []);
  ipcMain.handle('toggle-heartbeat-task',      async (_, taskId) => svc('heartbeatTask')?.toggleTask(taskId));
  ipcMain.handle('delete-heartbeat-task',      async (_, taskId) => { await svc('heartbeatTask')?.deleteTask(taskId); return { success: true }; });
  ipcMain.handle('run-heartbeat-task-now',     async (_, taskId) => { const r = await svc('heartbeatTask')?.runNow(taskId); return { success: true, result: r }; });

  // ════════════════════════════════════════════════════════════════════
  // SKILL MARKETPLACE
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('marketplace-search',        async (_, { query, registryId }) => svc('skillMarketplace')?.searchSkills(query, registryId) || []);
  ipcMain.handle('marketplace-categories',    async () => svc('skillMarketplace')?.getCategories() || {});
  ipcMain.handle('marketplace-install',       async (_, { skillId, registryId }) => svc('skillMarketplace')?.installSkill(skillId, registryId));
  ipcMain.handle('marketplace-uninstall',     async (_, skillId) => { await svc('skillMarketplace')?.uninstallSkill(skillId); return { success: true }; });
  ipcMain.handle('marketplace-installed',     async () => svc('skillMarketplace')?.getInstalled() || []);
  ipcMain.handle('marketplace-registries',    async () => svc('skillMarketplace')?.getRegistries() || []);
  ipcMain.handle('marketplace-add-registry',  async (_, reg) => { svc('skillMarketplace')?.addRegistry(reg); return { success: true }; });

  // ════════════════════════════════════════════════════════════════════
  // SMART HOME & INTEGRATIONS
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('smarthome-devices',  async (_, domain) => svc('smartHome')?.getDevices(domain) || []);
  ipcMain.handle('smarthome-sync',     async () => svc('smartHome')?.syncDevices() || []);
  ipcMain.handle('smarthome-status',   async () => svc('smartHome')?.getStatus() || {});
  ipcMain.handle('smarthome-hue-pair', async () => svc('smartHome')?.pairHueBridge());
  ipcMain.handle('smarthome-control',  async (_, { action, entityId, data }) => {
    const sh = svc('smartHome');
    if (!sh) return { error: 'SmartHome not available' };
    switch (action) {
      case 'turn_on':    return sh.turnOn(entityId, data || {});
      case 'turn_off':   return sh.turnOff(entityId);
      case 'toggle':     return sh.toggle(entityId);
      case 'set_light':  return sh.setLight(entityId, data?.brightness, data?.color);
      case 'set_climate':return sh.setClimate(entityId, data?.temperature, data?.mode);
      case 'scene':      return sh.executeScene(entityId);
      default:           return { error: 'Unknown action: ' + action };
    }
  });

  ipcMain.handle('spotify-search',           async (_, { query, type })               => svc('integrations')?.spotifySearch(query, type));
  ipcMain.handle('spotify-now-playing',      async (_, userToken)                     => svc('integrations')?.spotifyNowPlaying(userToken));
  ipcMain.handle('spotify-control',          async (_, { action, uri, userToken })    => {
    const i = svc('integrations');
    if (!i) return { error: 'not available' };
    switch (action) {
      case 'play':  return i.spotifyPlay(uri, userToken);
      case 'pause': return i.spotifyPause(userToken);
      case 'next':  return i.spotifyNext(userToken);
      case 'prev':  return i.spotifyPrev(userToken);
    }
  });
  ipcMain.handle('calendar-events',          async (_, { calendarId, days })          => svc('integrations')?.calendarEvents(calendarId, days));
  ipcMain.handle('calendar-create-event',    async (_, eventData)                     => svc('integrations')?.calendarCreateEvent(eventData));
  ipcMain.handle('github-repos',             async (_, user)                          => svc('integrations')?.ghListRepos(user));
  ipcMain.handle('github-issues',            async (_, { repo, state })               => svc('integrations')?.ghListIssues(repo, state));
  ipcMain.handle('github-create-issue',      async (_, { repo, title, body, labels }) => svc('integrations')?.ghCreateIssue(repo, title, body, labels));
  ipcMain.handle('github-actions',           async (_, repo)                          => svc('integrations')?.ghListWorkflows(repo));
  ipcMain.handle('github-trigger-workflow',  async (_, { repo, workflowId, ref, inputs }) => svc('integrations')?.ghTriggerWorkflow(repo, workflowId, ref, inputs));
  ipcMain.handle('github-notifications',     async ()                                 => svc('integrations')?.ghGetNotifications());
  ipcMain.handle('integrations-status',      async () => svc('integrations')?.getStatus() || {});

  // ════════════════════════════════════════════════════════════════════
  // CDP BROWSER
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('cdp-status',       async ()                       => svc('cdpBrowser')?.getStatus() || { connected: false });
  ipcMain.handle('cdp-launch',       async (_, url)                 => svc('cdpBrowser')?.launchChrome(url));
  ipcMain.handle('cdp-tabs',         async ()                       => svc('cdpBrowser')?.getTabs() || []);
  ipcMain.handle('cdp-navigate',     async (_, { url, tabId })      => { await svc('cdpBrowser')?.navigate(url, tabId); return { success: true }; });
  ipcMain.handle('cdp-screenshot',   async (_, tabId)               => svc('cdpBrowser')?.screenshot(tabId));
  ipcMain.handle('cdp-page-content', async (_, tabId)               => svc('cdpBrowser')?.getPageContent(tabId));
  ipcMain.handle('cdp-eval',         async (_, { expression, tabId }) => ({ result: await svc('cdpBrowser')?.evaluateJS(expression, tabId) }));
  ipcMain.handle('cdp-click',        async (_, { selector, tabId }) => svc('cdpBrowser')?.click(selector, tabId));
  ipcMain.handle('cdp-type',         async (_, { selector, text, tabId }) => svc('cdpBrowser')?.type(selector, text, tabId));

  // ════════════════════════════════════════════════════════════════════
  // COLLABORATION
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('start-collaboration', async () => {
    const cs = svc('collaboration');
    if (!cs) return { error: 'Collaboration service not available' };
    const result = await cs.start();
    if (!global._collabHeartbeat) {
      global._collabHeartbeat = setInterval(() => {
        if (!cs.running || !win()?.webContents) return;
        try { win().webContents.send('collab-update', cs.getStatus()); } catch {}
      }, 3000);
    }
    return { success: true, ...result };
  });
  ipcMain.handle('stop-collaboration',         async () => { await svc('collaboration')?.stop(); return { success: true }; });
  ipcMain.handle('get-collaboration-status',   async () => svc('collaboration')?.getStatus() || { running: false, port: 9090, clients: 0, rooms: [] });
  ipcMain.handle('get-collaboration-rooms',    async () => svc('collaboration')?.getRooms() || []);
  ipcMain.handle('open-collaboration-connect', async () => {
    const cs = svc('collaboration');
    if (!cs?.running) return { error: 'Collaboration nicht aktiv' };
    const urls = cs._getURLs();
    const connectUrl = (urls.find(u => !u.includes('localhost')) || urls[0]) + '/connect';
    const { shell } = require('electron');
    await shell.openExternal(connectUrl);
    return { success: true, url: connectUrl };
  });

  // ════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════

  // Open a local file with the system's default application
  ipcMain.handle('open-file-path', async (_, filePath) => {
    if (!filePath || typeof filePath !== 'string') return { error: 'Invalid path' };
    try {
      const { shell } = require('electron');
      await shell.openPath(filePath);
      return { success: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('open-url', async (_, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle('check-whisper', async () => {
    const execA = require('util').promisify(require('child_process').exec);
    const results = { available: false, providers: [], version: null, pythonCmd: null };

    // 1. faster-whisper (empfohlen — schnellstes lokales STT)
    try {
      const { stdout } = await execA('faster-whisper --help', { timeout: 5000 });
      results.providers.push('faster-whisper');
      results.available = true;
      results.version = 'faster-whisper';
    } catch {}

    // 2. whisper.cpp (C++ native)
    try {
      await execA('whisper-cpp --help', { timeout: 5000 });
      results.providers.push('whisper-cpp');
      results.available = true;
    } catch {}

    // 3. openai-whisper (Python)
    for (const py of ['python', 'python3', 'py']) {
      try {
        const { stdout } = await execA(`${py} -c "import whisper; print(whisper.__version__)"`, { timeout: 10000 });
        if (stdout?.trim()) {
          results.providers.push('openai-whisper');
          results.available = true;
          results.version = results.version || stdout.trim();
          results.pythonCmd = py;
          break;
        }
      } catch {}
    }

    // 4. SpeechService Status (falls initialisiert)
    const speech = svc('speech');
    if (speech && speech._cap) {
      results.speechService = speech.getCapabilities();
      if (speech._cap.openaiSTT) results.providers.push('openai-api');
    }

    results.recommended = results.providers.includes('faster-whisper') ? 'faster-whisper'
      : results.providers.includes('whisper-cpp') ? 'whisper-cpp'
      : results.providers.includes('openai-whisper') ? 'openai-whisper'
      : results.providers.includes('openai-api') ? 'openai-api' : null;

    return results;
  });

  // ── ffmpeg / Sox / Audio-Tools Check ─────────────────────────────────
  ipcMain.handle('check-audio-tools', async () => {
    const execA = require('util').promisify(require('child_process').exec);
    const tools = {};

    // ffmpeg — plattformübergreifend
    try {
      const { stdout } = await execA('ffmpeg -version', { timeout: 5000 });
      const ver = stdout.match(/ffmpeg version (\S+)/)?.[1];
      tools.ffmpeg = { available: true, version: ver || 'found' };
    } catch {
      // Fallback-Pfade prüfen
      const paths = process.platform === 'win32'
        ? ['C:\\ffmpeg\\bin\\ffmpeg.exe', `${process.env.LOCALAPPDATA}\\Programs\\ffmpeg\\bin\\ffmpeg.exe`]
        : ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
      let found = false;
      for (const p of paths) {
        try { const fst = require('fs'); if (fst.existsSync(p)) { tools.ffmpeg = { available: true, version: 'found at ' + p, path: p }; found = true; break; } } catch {}
      }
      if (!found) tools.ffmpeg = { available: false, hint: process.platform === 'win32' ? 'winget install ffmpeg' : process.platform === 'darwin' ? 'brew install ffmpeg' : 'sudo apt install ffmpeg' };
    }

    // sox
    try {
      const { stdout } = await execA('sox --version', { timeout: 5000 });
      tools.sox = { available: true, version: stdout.trim().split('\n')[0] };
    } catch { tools.sox = { available: false }; }

    // edge-tts
    try {
      await execA('edge-tts --help', { timeout: 5000 });
      tools.edgeTTS = { available: true };
    } catch { tools.edgeTTS = { available: false, hint: 'pip install edge-tts --break-system-packages' }; }

    // Coqui TTS
    try {
      await execA('tts --help', { timeout: 5000 });
      tools.coquiTTS = { available: true };
    } catch { tools.coquiTTS = { available: false }; }

    return tools;
  });

  ipcMain.handle('install-whisper', async () => {
    const execA  = require('util').promisify(require('child_process').exec);
    const isWin  = process.platform === 'win32';

    // 1. Versuche faster-whisper (empfohlen — schneller, weniger RAM)
    const fwCmds = isWin
      ? ['pip install faster-whisper', 'pip3 install faster-whisper', 'py -m pip install faster-whisper']
      : ['pip3 install faster-whisper --break-system-packages', 'pip install faster-whisper --break-system-packages'];
    for (const cmd of fwCmds) {
      try { await execA(cmd, { timeout: 180000, maxBuffer: 10*1024*1024 }); return { success: true, method: cmd, provider: 'faster-whisper' }; } catch {}
    }

    // 2. Fallback: openai-whisper
    const owCmds = isWin
      ? ['pip install openai-whisper', 'pip3 install openai-whisper', 'py -m pip install openai-whisper']
      : ['pip3 install openai-whisper --break-system-packages', 'pip install openai-whisper --break-system-packages'];
    for (const cmd of owCmds) {
      try { await execA(cmd, { timeout: 180000, maxBuffer: 10*1024*1024 }); return { success: true, method: cmd, provider: 'openai-whisper' }; } catch {}
    }

    return { success: false, error: 'pip nicht gefunden. Bitte Python installieren von python.org' };
  });

  ipcMain.handle('speak-text', async (_, { text, provider, voice, lang }) => {
    if (!text?.trim()) return { success: false, error: 'No text' };
    const ttsProvider = provider || store.get('settings.ttsProvider', 'browser');
    const ttsLang     = lang    || store.get('settings.voiceLanguage', 'de');

    if (ttsProvider === 'openai-tts') {
      const openaiKey = store.get('apiKeys.openai');
      if (!openaiKey) return { success: false, error: 'OpenAI API-Key fehlt' };
      const axios    = require('axios');
      const ttsVoice = voice || store.get('settings.openaiTtsVoice', 'nova');
      const response = await axios.post('https://api.openai.com/v1/audio/speech',
        { model: 'tts-1', input: text.slice(0, 4096), voice: ttsVoice, response_format: 'mp3' },
        { headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, responseType: 'arraybuffer', timeout: 30000 }
      );
      return { success: true, audioBase64: Buffer.from(response.data).toString('base64'), mimeType: 'audio/mpeg', provider: 'openai-tts' };
    }

    if (ttsProvider === 'elevenlabs') {
      const elKey = store.get('apiKeys.elevenlabs');
      if (!elKey) return { success: false, error: 'ElevenLabs API-Key fehlt' };
      const axios   = require('axios');
      const voiceId = voice || store.get('settings.elevenlabsVoiceId', '21m00Tcm4TlvDq8ikWAM');
      const response = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        { text: text.slice(0, 5000), model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } },
        { headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json' }, responseType: 'arraybuffer', timeout: 30000 }
      );
      return { success: true, audioBase64: Buffer.from(response.data).toString('base64'), mimeType: 'audio/mpeg', provider: 'elevenlabs' };
    }

    return { success: true, provider: 'browser', lang: ttsLang, text };
  });

  ipcMain.handle('check-docker', async () => {
    try {
      const { stdout } = await require('util').promisify(require('child_process').exec)(
        'docker version --format "{{.Server.Version}}"', { timeout: 8000 }
      );
      return { available: true, version: stdout.trim() };
    } catch { return { available: false }; }
  });

  ipcMain.handle('get-docker-compose', async () => {
    const fsp = require('fs').promises;
    const path = require('path');
    const { app } = require('electron');
    const possiblePaths = [
      path.join(__dirname, 'docker-compose.yml'),
      path.join(__dirname, 'docker-compose.yaml'),
      path.join(app.getPath('userData'), 'docker-compose.yml'),
    ];
    for (const p of possiblePaths) {
      try {
        const content = await fsp.readFile(p, 'utf-8');
        return { content, path: p };
      } catch {}
    }
    // Generiere eine vollständige docker-compose.yml
    const generatedYml = `version: "3.9"

services:
  johnny:
    build: .
    container_name: johnny-ai
    restart: unless-stopped
    ports:
      - "8765:8765"   # Johnny Web API
      - "9090:9090"   # Collaboration Server
    environment:
      - NODE_ENV=production
      - OLLAMA_URL=http://ollama:11434
    volumes:
      - johnny-data:/app/user-data
    depends_on:
      - ollama

  ollama:
    image: ollama/ollama:latest
    container_name: johnny-ollama
    restart: unless-stopped
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama

  chromadb:
    image: chromadb/chroma:latest
    container_name: johnny-chroma
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - chroma-data:/chroma/chroma

volumes:
  johnny-data:
  ollama-data:
  chroma-data:
`;
    return { content: generatedYml, generated: true };
  });

  // ── WhatsApp QR-Code Callback ────────────────────────────────────────────
  global._messengerUICallback = (event, data) => {
    if (win()?.webContents && !win().webContents.isDestroyed()) {
      win().webContents.send(event, data);
    } else {
      setTimeout(() => { win()?.webContents?.send(event, data); }, 1000);
    }
  };

  // ════════════════════════════════════════════════════════════════════
  // v2.0 ADVANCED SERVICE HANDLERS
  // ════════════════════════════════════════════════════════════════════

  // ── Emotional Intelligence ────────────────────────────────────────
  ipcMain.handle('ei-analyze', async (_, data) => {
    const ei = registry.get('emotionalIntelligence');
    if (!ei) return { error: 'EmotionalIntelligence nicht verfügbar' };
    return ei.analyzeSentiment(data.text, data.options || {});
  });
  ipcMain.handle('ei-profile', async (_, userId) => {
    const ei = registry.get('emotionalIntelligence');
    if (!ei) return { error: 'EmotionalIntelligence nicht verfügbar' };
    return ei.getUserEmotionalProfile(userId || 'default');
  });
  ipcMain.handle('ei-status', async () => {
    const ei = registry.get('emotionalIntelligence');
    return ei ? ei.getStatus() : { error: 'not available' };
  });

  // ── Creative Writing ──────────────────────────────────────────────
  ipcMain.handle('cw-generate', async (_, params) => {
    const cw = registry.get('creativeWriting');
    if (!cw) return { error: 'CreativeWriting nicht verfügbar' };
    return cw.generate(params);
  });
  ipcMain.handle('cw-analyze', async (_, data) => {
    const cw = registry.get('creativeWriting');
    if (!cw) return { error: 'CreativeWriting nicht verfügbar' };
    return cw.analyzeWriting(data.text, data.options || {});
  });
  ipcMain.handle('cw-variants', async (_, data) => {
    const cw = registry.get('creativeWriting');
    if (!cw) return { error: 'CreativeWriting nicht verfügbar' };
    return cw.generateVariants(data.text, data.count || 3, data.style || {});
  });
  ipcMain.handle('cw-create-character', async (_, params) => {
    const cw = registry.get('creativeWriting');
    if (!cw) return { error: 'CreativeWriting nicht verfügbar' };
    return cw.createCharacter(params);
  });
  ipcMain.handle('cw-list-characters', async () => {
    const cw = registry.get('creativeWriting');
    return cw ? cw.listCharacters() : [];
  });
  ipcMain.handle('cw-create-project', async (_, params) => {
    const cw = registry.get('creativeWriting');
    if (!cw) return { error: 'CreativeWriting nicht verfügbar' };
    return cw.createProject(params);
  });
  ipcMain.handle('cw-list-projects', async () => {
    const cw = registry.get('creativeWriting');
    return cw ? cw.listProjects() : [];
  });
  ipcMain.handle('cw-get-genres', async () => {
    const cw = registry.get('creativeWriting');
    return cw ? { genres: cw.getGenres(), plotStructures: cw.getPlotStructures(), styles: cw.getStyleElements(), archetypes: cw.getArchetypes() } : {};
  });
  ipcMain.handle('cw-status', async () => {
    const cw = registry.get('creativeWriting');
    return cw ? cw.getStatus() : { error: 'not available' };
  });

  // ── Enhanced Vision ───────────────────────────────────────────────
  ipcMain.handle('ev-analyze', async (_, data) => {
    const ev = registry.get('enhancedVision');
    if (!ev) return { error: 'EnhancedVision nicht verfügbar' };
    return ev.analyze(data.image, data.mode || 'describe', data.options || {});
  });
  ipcMain.handle('ev-deep-analyze', async (_, data) => {
    const ev = registry.get('enhancedVision');
    if (!ev) return { error: 'EnhancedVision nicht verfügbar' };
    return ev.deepAnalyze(data.image, data.options || {});
  });
  ipcMain.handle('ev-compare', async (_, data) => {
    const ev = registry.get('enhancedVision');
    if (!ev) return { error: 'EnhancedVision nicht verfügbar' };
    return ev.compareImages(data.image1, data.image2, data.prompt || '');
  });
  ipcMain.handle('ev-workflow', async (_, data) => {
    const ev = registry.get('enhancedVision');
    if (!ev) return { error: 'EnhancedVision nicht verfügbar' };
    return ev.analyzeWorkflow(data.screenshots, data.options || {});
  });
  ipcMain.handle('ev-modes', async () => {
    const ev = registry.get('enhancedVision');
    return ev ? ev.getModes() : [];
  });
  ipcMain.handle('ev-status', async () => {
    const ev = registry.get('enhancedVision');
    return ev ? ev.getStatus() : { error: 'not available' };
  });

  // ── Time Series Analysis ──────────────────────────────────────────
  ipcMain.handle('tsa-load', async (_, data) => {
    const tsa = registry.get('timeSeriesAnalysis');
    if (!tsa) return { error: 'TimeSeriesAnalysis nicht verfügbar' };
    return tsa.loadTimeSeries(data.data, data.options || {});
  });
  ipcMain.handle('tsa-statistics', async (_, datasetId) => {
    const tsa = registry.get('timeSeriesAnalysis');
    if (!tsa) return { error: 'TimeSeriesAnalysis nicht verfügbar' };
    return tsa.statistics(datasetId);
  });
  ipcMain.handle('tsa-trend', async (_, data) => {
    const tsa = registry.get('timeSeriesAnalysis');
    if (!tsa) return { error: 'TimeSeriesAnalysis nicht verfügbar' };
    return tsa.detectTrend(data.datasetId, data.options || {});
  });
  ipcMain.handle('tsa-anomalies', async (_, data) => {
    const tsa = registry.get('timeSeriesAnalysis');
    if (!tsa) return { error: 'TimeSeriesAnalysis nicht verfügbar' };
    return tsa.detectAnomalies(data.datasetId, data.options || {});
  });
  ipcMain.handle('tsa-forecast', async (_, data) => {
    const tsa = registry.get('timeSeriesAnalysis');
    if (!tsa) return { error: 'TimeSeriesAnalysis nicht verfügbar' };
    return tsa.forecast(data.datasetId, data.periods || 10, data.options || {});
  });
  ipcMain.handle('tsa-changepoints', async (_, data) => {
    const tsa = registry.get('timeSeriesAnalysis');
    if (!tsa) return { error: 'TimeSeriesAnalysis nicht verfügbar' };
    return tsa.detectChangePoints(data.datasetId, data.options || {});
  });
  ipcMain.handle('tsa-summarize', async (_, datasetId) => {
    const tsa = registry.get('timeSeriesAnalysis');
    if (!tsa) return { error: 'TimeSeriesAnalysis nicht verfügbar' };
    return tsa.summarize(datasetId);
  });
  ipcMain.handle('tsa-list', async () => {
    const tsa = registry.get('timeSeriesAnalysis');
    return tsa ? tsa.listDatasets() : [];
  });
  ipcMain.handle('tsa-status', async () => {
    const tsa = registry.get('timeSeriesAnalysis');
    return tsa ? tsa.getStatus() : { error: 'not available' };
  });

  // ── External Integration Hub ──────────────────────────────────────
  ipcMain.handle('hub-connect', async (_, data) => {
    const hub = registry.get('integrationHub');
    if (!hub) return { error: 'IntegrationHub nicht verfügbar' };
    return hub.connectService(data.serviceId, data.template, data.credentials || {}, data.config || {});
  });
  ipcMain.handle('hub-disconnect', async (_, serviceId) => {
    const hub = registry.get('integrationHub');
    if (!hub) return { error: 'IntegrationHub nicht verfügbar' };
    return hub.disconnectService(serviceId);
  });
  ipcMain.handle('hub-request', async (_, data) => {
    const hub = registry.get('integrationHub');
    if (!hub) return { error: 'IntegrationHub nicht verfügbar' };
    return hub.request(data.serviceId, data.endpoint, data.params || {}, data.options || {});
  });
  ipcMain.handle('hub-connections', async () => {
    const hub = registry.get('integrationHub');
    return hub ? hub.listConnections() : [];
  });
  ipcMain.handle('hub-templates', async () => {
    const hub = registry.get('integrationHub');
    return hub ? hub.getTemplates() : [];
  });
  ipcMain.handle('hub-health', async () => {
    const hub = registry.get('integrationHub');
    if (!hub) return { error: 'IntegrationHub nicht verfügbar' };
    return hub.checkAllHealth();
  });
  ipcMain.handle('hub-create-workflow', async (_, params) => {
    const hub = registry.get('integrationHub');
    if (!hub) return { error: 'IntegrationHub nicht verfügbar' };
    return hub.createWorkflow(params);
  });
  ipcMain.handle('hub-list-workflows', async () => {
    const hub = registry.get('integrationHub');
    return hub ? hub.listWorkflows() : [];
  });
  ipcMain.handle('hub-toggle-workflow', async (_, id) => {
    const hub = registry.get('integrationHub');
    if (!hub) return { error: 'IntegrationHub nicht verfügbar' };
    return hub.toggleWorkflow(id);
  });
  ipcMain.handle('hub-delete-workflow', async (_, id) => {
    const hub = registry.get('integrationHub');
    if (!hub) return { error: 'IntegrationHub nicht verfügbar' };
    hub.deleteWorkflow(id);
    return { success: true };
  });
  ipcMain.handle('hub-webhook-server', async (_, data) => {
    const hub = registry.get('integrationHub');
    if (!hub) return { error: 'IntegrationHub nicht verfügbar' };
    if (data.action === 'start') return hub.startWebhookServer(data.port || 8766);
    if (data.action === 'stop') return hub.stopWebhookServer();
    return { error: 'Unbekannte Aktion' };
  });
  ipcMain.handle('hub-status', async () => {
    const hub = registry.get('integrationHub');
    return hub ? hub.getStatus() : { error: 'not available' };
  });

  // ── File Output & ZIP ─────────────────────────────────────────────────────
  ipcMain.handle('write-output-file', async (_, { filename, content, encoding }) => {
    const outputDir = path.join(app.getPath('downloads'), 'Johnny-Output');
    await require('fs').promises.mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, filename.replace(/[/\\:*?"<>|]/g, '_'));
    await require('fs').promises.writeFile(filePath, content, encoding || 'utf-8');
    return { success: true, path: filePath };
  });

  ipcMain.handle('create-output-zip', async (_, { files, zipName }) => {
    // files: [{name, content, encoding?}]
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    for (const f of files) {
      const buf = Buffer.from(f.content, f.encoding || 'utf8');
      zip.addFile(f.name, buf);
    }
    const outputDir = path.join(app.getPath('downloads'), 'Johnny-Output');
    await require('fs').promises.mkdir(outputDir, { recursive: true });
    const zipPath = path.join(outputDir, (zipName || 'johnny-output').replace(/[/\\:*?"<>|]/g, '_') + '.zip');
    zip.writeZip(zipPath);
    return { success: true, path: zipPath };
  });

  ipcMain.handle('read-zip-contents', async (_, zipPath) => {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries()
      .filter(e => !e.isDirectory)
      .map(e => {
        const name = e.entryName;
        const ext = path.extname(name).toLowerCase();
        const textExts = ['.js','.jsx','.ts','.tsx','.py','.java','.c','.cpp','.h','.cs',
          '.go','.rs','.rb','.php','.html','.css','.json','.yml','.yaml','.md','.txt',
          '.sh','.bat','.env','.gitignore','.toml','.ini','.cfg','.xml','.sql'];
        const isText = textExts.includes(ext) || !ext;
        const size = e.header.size;
        return { name, size, isText, content: isText && size < 500000 ? zip.readAsText(e) : null };
      });
    return { success: true, files: entries, count: entries.length };
  });

  ipcMain.handle('read-zip-contents-b64', async (_, { data, name }) => {
    const AdmZip = require('adm-zip');
    const buf = Buffer.from(data, 'base64');
    const zip = new AdmZip(buf);
    const textExts = new Set(['.js','.jsx','.ts','.tsx','.py','.java','.c','.cpp','.h','.cs',
      '.go','.rs','.rb','.php','.html','.css','.json','.yml','.yaml','.md','.txt',
      '.sh','.bat','.env','.gitignore','.toml','.ini','.cfg','.xml','.sql','.vue','.svelte']);
    const entries = zip.getEntries()
      .filter(e => !e.isDirectory)
      .map(e => {
        const entryName = e.entryName;
        const ext = path.extname(entryName).toLowerCase();
        const isText = textExts.has(ext) || !ext;
        const size = e.header.size;
        return { name: entryName, size, isText, content: isText && size < 300000 ? zip.readAsText(e) : null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { success: true, files: entries, count: entries.length, zipName: name };
  });

  ipcMain.handle('open-output-folder', async () => {
    const outputDir = path.join(app.getPath('downloads'), 'Johnny-Output');
    await require('fs').promises.mkdir(outputDir, { recursive: true });
    const { shell } = require('electron');
    shell.openPath(outputDir);
    return { success: true, path: outputDir };
  });

  console.log('[IPC] All handlers registered');
}

module.exports = { register };
