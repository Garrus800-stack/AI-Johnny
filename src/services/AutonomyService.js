/**
 * AutonomyService — Johnnys proaktives Bewusstsein
 *
 * Das fehlende Puzzleteil: Johnny reagiert nicht nur auf User-Input,
 * sondern nimmt selbstständig die Welt wahr und handelt — innerhalb
 * definierter Safety-Bounds.
 *
 * Drei Stufen:
 *   OBSERVE  — Daten sammeln (Sensoren, Heartbeat, Events)
 *   EVALUATE — LLM bewertet: Ist Handlung nötig? Wie dringend?
 *   ACT      — Innerhalb erlaubter Grenzen handeln ODER User fragen
 *
 * Safety-Bounds (vom User konfigurierbar):
 *   - allowed:  ["fix-code", "send-notification", "create-task", "run-health-check"]
 *   - forbidden: ["send-email", "delete-files", "execute-code", "make-purchases"]
 *   - ask-first: ["deploy", "modify-config", "contact-external"]
 */
'use strict';

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class AutonomyService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.dataDir       = config.dataDir || './data/autonomy';
    this.enabled       = config.enabled !== false;
    this.evaluationInterval = config.evaluationInterval || 60000; // 1min
    this._timer        = null;
    this._eventQueue   = [];
    this._actionLog    = [];
    this._running      = false;

    // Safety Bounds — defaults sind konservativ
    this.bounds = {
      allowed:   ['notify-user', 'create-task', 'run-health-check', 'log-insight', 'self-reflect'],
      forbidden: ['send-email', 'delete-files', 'execute-arbitrary-code', 'modify-system'],
      askFirst:  ['deploy', 'send-message-external', 'modify-config', 'install-software'],
      maxActionsPerHour: 10,
      confidenceThreshold: 0.8,  // Nur handeln wenn >80% sicher
    };

    // Counters
    this._actionsThisHour = 0;
    this._hourResetTimer  = null;
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    await this._loadConfig();

    // Rate-Limit Reset jede Stunde
    this._hourResetTimer = setInterval(() => { this._actionsThisHour = 0; }, 3600000);

    if (this.enabled) this.start();
    console.log(`[Autonomy] Initialized — enabled: ${this.enabled}, bounds: ${this.bounds.allowed.length} allowed, ${this.bounds.forbidden.length} forbidden`);
  }

  /**
   * Event in die Warteschlange legen.
   * Quellen: SensorService, HeartbeatTask, WebAutonomy, System-Events.
   */
  pushEvent(event) {
    this._eventQueue.push({
      ...event,
      timestamp: Date.now(),
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    });

    // Bei kritischen Events sofort evaluieren
    if (event.priority === 'critical') {
      this._evaluateNext().catch(e => console.warn('[Autonomy] Critical eval failed:', e.message));
    }
  }

  /** Evaluation-Loop starten. */
  start() {
    if (this._running) return;
    this._running = true;
    this._timer = setInterval(() => this._evaluateNext().catch(() => {}), this.evaluationInterval);
    console.log('[Autonomy] Loop started — evaluating every', this.evaluationInterval / 1000, 's');
  }

  stop() {
    this._running = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  /**
   * Kern: Nächstes Event evaluieren und ggf. handeln.
   */
  async _evaluateNext() {
    if (this._eventQueue.length === 0) return;
    if (this._actionsThisHour >= this.bounds.maxActionsPerHour) return;

    const event = this._eventQueue.shift();

    // ── OBSERVE → EVALUATE ──────────────────────────────────────────
    const evaluation = await this._evaluateWithLLM(event);

    if (!evaluation) return;

    // ── Safety Check ────────────────────────────────────────────────
    const actionType = evaluation.proposedAction;

    if (this.bounds.forbidden.some(f => actionType.includes(f))) {
      this._log('blocked', event, evaluation, 'Action in forbidden list');
      return;
    }

    if (evaluation.confidence < this.bounds.confidenceThreshold) {
      this._log('low-confidence', event, evaluation, `Confidence ${evaluation.confidence} < ${this.bounds.confidenceThreshold}`);
      return;
    }

    // ── ACT oder ASK ────────────────────────────────────────────────
    if (this.bounds.askFirst.some(a => actionType.includes(a))) {
      // User muss bestätigen
      this.emit('ask-permission', {
        event, evaluation,
        approve: () => this._executeAction(event, evaluation),
        deny:    () => this._log('denied', event, evaluation, 'User denied'),
      });
      this._log('asking', event, evaluation, 'Waiting for user permission');
      return;
    }

    if (this.bounds.allowed.some(a => actionType.includes(a))) {
      await this._executeAction(event, evaluation);
      return;
    }

    // Unbekannte Aktion → ask-first Fallback
    this.emit('ask-permission', {
      event, evaluation,
      approve: () => this._executeAction(event, evaluation),
      deny:    () => this._log('denied', event, evaluation, 'Unknown action type'),
    });
  }

  /**
   * LLM evaluiert ein Event und schlägt Handlung vor.
   */
  async _evaluateWithLLM(event) {
    if (!this.agentManager) return null;

    const prompt = `Du bist Johnny, ein autonomer KI-Assistent. Ein Event ist aufgetreten:

EVENT: ${JSON.stringify(event, null, 2)}

DEINE SAFETY-BOUNDS:
- Erlaubt: ${this.bounds.allowed.join(', ')}
- Verboten: ${this.bounds.forbidden.join(', ')}
- Erst fragen: ${this.bounds.askFirst.join(', ')}

Analysiere das Event und antworte NUR im JSON-Format:
{
  "shouldAct": true/false,
  "proposedAction": "action-type",
  "reasoning": "Warum diese Aktion",
  "confidence": 0.0-1.0,
  "message": "Nachricht an User (falls nötig)",
  "parameters": {}
}

Wenn kein Handlungsbedarf: {"shouldAct": false, "reasoning": "..."}`;

    try {
      const ollamaService = this.agentManager?.ollamaService || this.agentManager?.modelProvider;
      if (!ollamaService) return null;

      const response = await ollamaService.generate(prompt, {
        model: this.agentManager?.agents?.get('Johnny')?.model || 'gemma2:9b',
        temperature: 0.3, // Niedrig für zuverlässige Entscheidungen
      });

      // JSON aus Response extrahieren
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);
      if (!result.shouldAct) return null;
      return result;
    } catch (e) {
      console.warn('[Autonomy] LLM evaluation failed:', e.message);
      return null;
    }
  }

  /**
   * Aktion ausführen.
   */
  async _executeAction(event, evaluation) {
    this._actionsThisHour++;

    const action = evaluation.proposedAction;
    let result = null;

    try {
      switch (action) {
        case 'notify-user':
          this.emit('notification', { message: evaluation.message, priority: event.priority || 'info', source: 'autonomy' });
          result = { success: true };
          break;

        case 'create-task':
          if (this.agentManager?.heartbeatTask) {
            result = await this.agentManager.heartbeatTask.createTask({
              name: evaluation.message || 'Autonome Aufgabe',
              type: 'agent', prompt: evaluation.parameters?.prompt || evaluation.reasoning,
              enabled: true, schedule: 'once',
            });
          }
          break;

        case 'run-health-check':
          if (this.agentManager?.sensorService) {
            result = await this.agentManager.sensorService.getSystemInfo();
          }
          break;

        case 'log-insight':
          if (this.agentManager?.johnny) {
            this.agentManager.johnny.addDiary(evaluation.message || evaluation.reasoning);
            result = { success: true };
          }
          break;

        case 'self-reflect':
          if (this.agentManager?.johnny) {
            result = await this.agentManager.johnny.selfReflect();
          }
          break;

        default:
          // Generischer Agent-Call
          if (this.agentManager) {
            result = await this.agentManager.sendMessage('Johnny',
              `[AUTONOM] ${evaluation.reasoning}\n\nAktion: ${action}\nParameter: ${JSON.stringify(evaluation.parameters || {})}`
            );
          }
          break;
      }

      this._log('executed', event, evaluation, result);
      this.emit('action-executed', { event, evaluation, result });
    } catch (e) {
      this._log('error', event, evaluation, e.message);
      this.emit('action-error', { event, evaluation, error: e.message });
    }
  }

  /** Action-Log schreiben. */
  _log(status, event, evaluation, detail) {
    const entry = {
      timestamp: Date.now(),
      status,
      event: { type: event.type, source: event.source },
      action: evaluation?.proposedAction,
      confidence: evaluation?.confidence,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 200),
    };
    this._actionLog.push(entry);
    if (this._actionLog.length > 500) this._actionLog = this._actionLog.slice(-200);

    // Persistieren (async, fire-and-forget)
    const logFile = path.join(this.dataDir, 'action-log.jsonl');
    fs.appendFile(logFile, JSON.stringify(entry) + '\n').catch(() => {});
  }

  /** Safety-Bounds konfigurieren. */
  updateBounds(newBounds) {
    Object.assign(this.bounds, newBounds);
    this._saveConfig();
  }

  /** Status abfragen. */
  getStatus() {
    return {
      enabled: this.enabled,
      running: this._running,
      queueLength: this._eventQueue.length,
      actionsThisHour: this._actionsThisHour,
      maxActionsPerHour: this.bounds.maxActionsPerHour,
      recentActions: this._actionLog.slice(-20),
      bounds: this.bounds,
    };
  }

  async _loadConfig() {
    try {
      const data = await fs.readFile(path.join(this.dataDir, 'config.json'), 'utf-8');
      const cfg = JSON.parse(data);
      if (cfg.bounds) Object.assign(this.bounds, cfg.bounds);
      if (cfg.enabled != null) this.enabled = cfg.enabled;
    } catch {}
  }

  async _saveConfig() {
    await fs.writeFile(
      path.join(this.dataDir, 'config.json'),
      JSON.stringify({ bounds: this.bounds, enabled: this.enabled }, null, 2)
    ).catch(() => {});
  }
}

module.exports = AutonomyService;
