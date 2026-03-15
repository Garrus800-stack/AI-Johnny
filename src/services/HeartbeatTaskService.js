const fs = require('fs').promises;
const path = require('path');

/**
 * HeartbeatTaskService – Proaktive autonome Aufgaben
 *
 * Funktionen:
 *  - Morning Briefings (Wetter, Kalender, News)
 *  - Cron-basierte wiederkehrende Agent-Aufgaben
 *  - Inbox-Überwachung (Email, Messenger)
 *  - System-Health Alerts
 *  - Erinnerungen und Follow-Ups
 *  - Aufgaben per natürliche Sprache definierbar
 */
class HeartbeatTaskService {
  constructor(config = {}) {
    this.agentManager    = config.agentManager;
    this.messengerService = config.messengerService || null;  // v1.8.6: für notifyMessenger
    this.gateway         = config.gateway;
    this.store           = config.store;
    this.dataDir         = config.dataDir || './heartbeat-data';
    this.tasks           = new Map();
    this._cron           = null;
    this._intervals      = [];
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});

    try {
      this._cron = require('node-cron');
    } catch (e) {
      console.warn('[Heartbeat] node-cron not installed, using setInterval fallback');
    }

    // Lade gespeicherte Tasks
    await this._loadTasks();

    // Starte alle aktiven Tasks
    for (const [id, task] of this.tasks) {
      if (task.enabled) this._scheduleTask(task);
    }

    console.log(`[Heartbeat] Initialized with ${this.tasks.size} tasks`);
  }

  // ── Task erstellen ────────────────────────────────────────────────
  async createTask(config) {
    const task = {
      id: config.id || `hb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: config.name,
      description: config.description || '',
      type: config.type || 'agent',  // agent | command | check | briefing
      schedule: config.schedule,      // Cron-Syntax oder Intervall in ms
      scheduleType: config.scheduleType || 'cron', // cron | interval | once
      agent: config.agent || 'Johnny',
      prompt: config.prompt || '',
      command: config.command || '',
      enabled: config.enabled !== false,
      notifyMessenger:  config.notifyMessenger  || null, // z.B. 'telegram', 'discord', 'whatsapp'
      notifyRecipient:  config.notifyRecipient  || null, // Empfänger-ID/Nummer/Channel für Benachrichtigung
      conditions: config.conditions || [],   // Bedingungen für Ausführung
      lastRun: null,
      lastResult: null,
      runCount: 0,
      createdAt: new Date().toISOString()
    };

    this.tasks.set(task.id, task);
    if (task.enabled) this._scheduleTask(task);
    await this._saveTasks();

    console.log(`[Heartbeat] Task created: ${task.name} (${task.schedule})`);
    return task;
  }

  // ── Vordefinierte Briefings ───────────────────────────────────────
  async createMorningBriefing(config = {}) {
    const { time = '0 8 * * *', agent = 'Johnny', topics = [] } = config;
    const topicList = topics.length > 0 ? topics.join(', ') : 'Wetter, Termine, Nachrichten, anstehende Aufgaben';

    return this.createTask({
      name: 'Morning Briefing',
      description: `Tägliches Morgen-Briefing um ${time}`,
      type: 'briefing',
      schedule: time,
      agent,
      prompt: `Erstelle ein kurzes Morgen-Briefing. Fasse folgende Themen zusammen: ${topicList}.
Nutze web_search für aktuelle Nachrichten. Fasse dich kurz und klar.
Format: Begrüßung, dann Punkte mit Emoji.`
    });
  }

  async createSystemHealthCheck(config = {}) {
    const { schedule = '*/30 * * * *', thresholds = {} } = config;
    return this.createTask({
      name: 'System Health Check',
      description: 'Prüft CPU, RAM, Disk via SensorService — warnt bei Problemen.',
      type: 'health',
      schedule,
      thresholds: { cpuMax: thresholds.cpu || 90, ramMax: thresholds.ram || 85, diskMax: thresholds.disk || 90 },
    });
  }

  /** Tägliche Selbstreflexion — Johnny analysiert seine eigene Performance */
  async createDailyReflection(config = {}) {
    return this.createTask({
      name: config.name || 'Tägliche Selbstreflexion',
      description: 'Johnny reflektiert über Interaktionen, Muster, Verbesserungspotential.',
      type: 'reflection',
      schedule: config.schedule || '0 22 * * *',
      agent: 'Johnny',
    });
  }

  /** Service-Watchdog — prüft ob kritische Services laufen */
  async createServiceWatchdog(config = {}) {
    return this.createTask({
      name: config.name || 'Service Watchdog',
      description: 'Prüft Erreichbarkeit von Ollama und anderen Services.',
      type: 'watchdog',
      schedule: config.schedule || '*/10 * * * *',
      services: config.services || ['ollama'],
    });
  }

  /** Proaktives Aufräumen — temp-Dateien, alte Logs */
  async createCleanupTask(config = {}) {
    return this.createTask({
      name: config.name || 'Proaktives Aufräumen',
      description: 'Bereinigt temporäre Audio/Video-Dateien und Cache.',
      type: 'cleanup',
      schedule: config.schedule || '0 3 * * *',
      maxAgeHours: config.maxAgeHours || 24,
    });
  }

  async createWebMonitor(config = {}) {
    const { url, schedule = '0 */6 * * *', agent = 'Johnny', keywords = [] } = config;
    const kwStr = keywords.length > 0 ? ` Look for: ${keywords.join(', ')}` : '';

    return this.createTask({
      name: `Web Monitor: ${url}`,
      description: `Überwacht ${url} auf Änderungen`,
      type: 'agent',
      schedule,
      agent,
      prompt: `Check the website ${url} for any important updates or changes.${kwStr}
Use web_fetch to read the page. Only report if there's something noteworthy.`
    });
  }

  // ── Task-Ausführung ───────────────────────────────────────────────
  _scheduleTask(task) {
    if (task._timer) {
      if (task._timer.stop) task._timer.stop();
      else clearInterval(task._timer);
    }

    if (task.scheduleType === 'cron' && this._cron) {
      if (!this._cron.validate(task.schedule)) {
        console.warn(`[Heartbeat] Invalid cron: ${task.schedule} for task ${task.name}`);
        return;
      }
      task._timer = this._cron.schedule(task.schedule, () => this._executeTask(task));
    } else if (task.scheduleType === 'interval') {
      const ms = parseInt(task.schedule) || 60000;
      task._timer = setInterval(() => this._executeTask(task), ms);
      this._intervals.push(task._timer);
    } else if (task.scheduleType === 'once') {
      const runAt = new Date(task.schedule).getTime();
      const delay = runAt - Date.now();
      if (delay > 0) {
        task._timer = setTimeout(() => this._executeTask(task), delay);
      }
    }
  }

  async _executeTask(task) {
    if (!task.enabled) return;

    console.log(`[Heartbeat] Executing: ${task.name}`);
    const startedAt = Date.now();

    try {
      let result;

      switch (task.type) {
        case 'agent':
        case 'briefing': {
          if (!this.agentManager) throw new Error('AgentManager not available');
          const response = await this.agentManager.sendMessage(task.agent, task.prompt);
          result = response.response;
          break;
        }
        case 'command': {
          const { promisify } = require('util');
          const exec = promisify(require('child_process').exec);
          const { stdout } = await exec(task.command, { timeout: 60000 });
          result = stdout;
          break;
        }
        case 'check': {
          if (!this.agentManager) throw new Error('AgentManager not available');
          const response = await this.agentManager.sendMessage(task.agent || 'Johnny', task.prompt);
          result = response.response;
          break;
        }

        // ── NEU: System Health Check via SensorService ────────────────
        case 'health': {
          const sensor = this.agentManager?.sensorService;
          if (!sensor) {
            // Fallback: systeminformation direkt
            const si = require('systeminformation');
            const [load, mem, disk] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
            const warnings = [];
            const cpuLoad = Math.round(load.currentLoad);
            const ramPct  = Math.round(mem.used / mem.total * 100);
            if (cpuLoad > (task.thresholds?.cpuMax || 90)) warnings.push(`⚠ CPU: ${cpuLoad}%`);
            if (ramPct  > (task.thresholds?.ramMax || 85)) warnings.push(`⚠ RAM: ${ramPct}%`);
            for (const d of (disk || [])) {
              if (Math.round(d.use) > (task.thresholds?.diskMax || 90)) warnings.push(`⚠ Disk ${d.mount}: ${Math.round(d.use)}%`);
            }
            result = warnings.length ? warnings.join('\n') : null;  // Nur melden wenn Probleme
          } else {
            const snap = await sensor.getSystemSnapshot();
            const warnings = [];
            if (snap.cpu?.load > (task.thresholds?.cpuMax || 90)) warnings.push(`⚠ CPU: ${snap.cpu.load}%${snap.cpu.temperature ? ' ('+snap.cpu.temperature+'°C)' : ''}`);
            if (snap.memory?.usedPct > (task.thresholds?.ramMax || 85)) warnings.push(`⚠ RAM: ${snap.memory.usedPct}% (${snap.memory.used}/${snap.memory.total} GB)`);
            for (const d of (snap.disk || [])) {
              if (d.usedPct > (task.thresholds?.diskMax || 90)) warnings.push(`⚠ Disk ${d.mount}: ${d.usedPct}%`);
            }
            if (snap.battery && snap.battery.percent < 15 && !snap.battery.charging) warnings.push(`⚠ Akku: ${snap.battery.percent}%`);
            result = warnings.length ? `System Health Alert:\n${warnings.join('\n')}` : null;
          }
          break;
        }

        // ── NEU: Selbstreflexion ──────────────────────────────────────
        case 'reflection': {
          if (!this.agentManager?.johnny) { result = null; break; }
          const johnny = this.agentManager.johnny;
          const diary  = await johnny.getDiaryEntries(20);
          const reflection = johnny.getLastReflection?.() || '';
          const patterns   = johnny.getInteractionPatterns?.() || {};
          const toolPats   = johnny.getToolPatterns?.() || {};
          const topTools   = Object.entries(toolPats).sort((a, b) => b[1].uses - a[1].uses).slice(0, 5);
          const topTopics  = Object.entries(patterns.topics || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);

          const summary = [
            `📊 Tagesreflexion — ${diary.length} Interaktionen heute`,
            diary.filter(d => d.summary?.toolErrors > 0).length > 0
              ? `⚠ ${diary.filter(d => d.summary?.toolErrors > 0).length} Interaktionen mit Tool-Fehlern`
              : '✓ Keine Tool-Fehler',
            topTools.length ? `Top-Tools: ${topTools.map(([n, d]) => `${n}(${d.uses}x)`).join(', ')}` : '',
            topTopics.length ? `Themen: ${topTopics.map(([t]) => t).join(', ')}` : '',
            `Energie: ${Math.round(johnny.self.energy * 100)}% | Stimmung: ${johnny.getMood?.() || johnny.self.emotions.current.type}`,
            reflection || '',
          ].filter(Boolean).join('\n');

          // Nur senden wenn es etwas Interessantes gibt
          result = diary.length > 0 ? summary : null;
          break;
        }

        // ── NEU: Service Watchdog ─────────────────────────────────────
        case 'watchdog': {
          const axios = require('axios');
          const problems = [];
          const servicesToCheck = task.services || ['ollama'];

          for (const svc of servicesToCheck) {
            try {
              switch (svc) {
                case 'ollama':
                  await axios.get(this.store?.get('settings.ollamaUrl') || 'http://127.0.0.1:11434/api/tags', { timeout: 5000 });
                  break;
                case 'chromadb':
                  await axios.get(this.store?.get('settings.chromaUrl') || 'http://localhost:8000/api/v1/heartbeat', { timeout: 5000 });
                  break;
                case 'stable-diffusion':
                  await axios.get(this.store?.get('settings.sdUrl') || 'http://localhost:7860/sdapi/v1/sd-models', { timeout: 5000 });
                  break;
                default:
                  // Custom URL check
                  if (svc.startsWith('http')) await axios.get(svc, { timeout: 5000 });
              }
            } catch (e) {
              problems.push(`✗ ${svc}: ${e.code || e.message}`);
            }
          }
          result = problems.length ? `Service Watchdog:\n${problems.join('\n')}` : null;
          break;
        }

        // ── NEU: Cleanup ──────────────────────────────────────────────
        case 'cleanup': {
          const fsp = require('fs').promises;
          const osTmp = require('os').tmpdir();
          const maxAge = (task.maxAgeHours || 24) * 3600000;
          const cutoff = Date.now() - maxAge;
          let cleaned = 0;

          const dirs = [
            path.join(osTmp, 'johnny-audio'),
            path.join(osTmp, 'johnny-video'),
            path.join(osTmp, 'johnny-code'),
            path.join(osTmp, 'johnny-sensors'),
            path.join(osTmp, 'johnny-web'),
            path.join(osTmp, 'johnny-cdp'),
          ];

          for (const dir of dirs) {
            try {
              const files = await fsp.readdir(dir);
              for (const f of files) {
                const fp = path.join(dir, f);
                try {
                  const stat = await fsp.stat(fp);
                  if (stat.mtimeMs < cutoff) { await fsp.unlink(fp); cleaned++; }
                } catch {}
              }
            } catch {}
          }
          result = cleaned > 0 ? `🧹 ${cleaned} temporäre Dateien bereinigt` : null;
          break;
        }
      }

      task.lastRun = new Date().toISOString();
      task.lastResult = (result || '').slice(0, 2000);
      task.runCount++;

      // Gateway Event
      if (this.gateway) {
        this.gateway.publish('heartbeat.task_completed', {
          taskId: task.id, name: task.name, type: task.type,
          duration: Date.now() - startedAt,
          result: task.lastResult.slice(0, 200)
        });
      }

      // Benachrichtigung senden wenn konfiguriert
      if (task.notifyMessenger && result && result.trim()) {
        await this._sendNotification(task, result);
      }

      await this._saveTasks();
      return result;
    } catch (e) {
      console.error(`[Heartbeat] Task ${task.name} failed:`, e.message);
      task.lastResult = `Error: ${e.message}`;
      task.lastRun = new Date().toISOString();

      if (this.gateway) {
        this.gateway.publish('heartbeat.task_error', { taskId: task.id, name: task.name, error: e.message });
      }
    }
  }

  async _sendNotification(task, result) {
    // ── Electron System-Notification ──────────────────────────────────────
    try {
      const { Notification } = require('electron');
      new Notification({ title: `📋 ${task.name}`, body: result.slice(0, 256) }).show();
    } catch (_) {}

    // ── Messenger-Benachrichtigung (v1.8.6: tatsächlich implementiert) ────
    if (!task.notifyMessenger || !task.notifyRecipient) return;

    const ms = this.messengerService || this.agentManager?.messengerService;
    if (!ms) {
      console.warn(`[Heartbeat] notifyMessenger konfiguriert ("${task.notifyMessenger}") aber kein MessengerService verfügbar`);
      return;
    }

    const msg = `📋 *${task.name}*\n${result.slice(0, 1500)}`;
    try {
      await ms.sendMessage(task.notifyMessenger, task.notifyRecipient, msg);
      console.log(`[Heartbeat] ✓ Benachrichtigung via ${task.notifyMessenger} an ${task.notifyRecipient} gesendet`);
    } catch (e) {
      console.error(`[Heartbeat] Messenger-Benachrichtigung fehlgeschlagen: ${e.message}`);
    }
  }

  // ── Task-Management ───────────────────────────────────────────────
  async updateTask(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Task not found: ' + taskId);
    Object.assign(task, updates);
    if (task.enabled) this._scheduleTask(task);
    await this._saveTasks();
    return task;
  }

  async deleteTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task?._timer) {
      if (task._timer.stop) task._timer.stop();
      else { clearInterval(task._timer); clearTimeout(task._timer); }
    }
    this.tasks.delete(taskId);
    await this._saveTasks();
  }

  async toggleTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Task not found');
    task.enabled = !task.enabled;
    if (task.enabled) this._scheduleTask(task);
    else if (task._timer) {
      if (task._timer.stop) task._timer.stop();
      else { clearInterval(task._timer); clearTimeout(task._timer); }
    }
    await this._saveTasks();
    return task;
  }

  async runNow(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Task not found');
    return await this._executeTask(task);
  }

  getTasks() {
    return Array.from(this.tasks.values()).map(t => ({
      id: t.id, name: t.name, description: t.description, type: t.type,
      schedule: t.schedule, scheduleType: t.scheduleType, enabled: t.enabled,
      agent: t.agent, lastRun: t.lastRun, lastResult: t.lastResult?.slice(0, 200),
      runCount: t.runCount, createdAt: t.createdAt
    }));
  }

  // ── Persistenz ────────────────────────────────────────────────────
  async _saveTasks() {
    try {
      const data = {};
      this.tasks.forEach((t, id) => {
        const { _timer, ...rest } = t;
        data[id] = rest;
      });
      await fs.writeFile(path.join(this.dataDir, 'tasks.json'), JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('[Heartbeat] Save failed:', e.message);
    }
  }

  async _loadTasks() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'tasks.json'), 'utf8');
      const data = JSON.parse(raw);
      for (const [id, task] of Object.entries(data)) {
        this.tasks.set(id, task);
      }
    } catch (_) {}
  }

  async shutdown() {
    for (const [, task] of this.tasks) {
      if (task._timer) {
        if (task._timer.stop) task._timer.stop();
        else { clearInterval(task._timer); clearTimeout(task._timer); }
      }
    }
    this._intervals.forEach(i => clearInterval(i));
    await this._saveTasks();
  }
}

module.exports = HeartbeatTaskService;
