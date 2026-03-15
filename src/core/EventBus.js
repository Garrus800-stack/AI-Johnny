/**
 * EventBus — zentraler Nachrichtenbus für lose Service-Kopplung
 *
 * Ersetzt direkte Referenz-Ketten wie:
 *   this.agentManager.johnny.contextMemory.feedbackLearning.track(...)
 *
 * Stattdessen:
 *   bus.emit('memory:track', { role, content, userId })
 *   bus.on('memory:track', handler)
 *
 * Kein Service muss den anderen kennen — nur den Bus.
 *
 * Bekannte Event-Namespaces:
 *   agent:*       – AgentManager Events (message:sent, tool:called, etc.)
 *   memory:*      – Memory/Context Events
 *   system:*      – Systemzustand (heartbeat, stats, etc.)
 *   ui:*          – Renderer-Events (step, stream-chunk, etc.)
 *   service:*     – ServiceRegistry Events (service:ready, service:failed)
 */

const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // Viele Services hören zu
    this._history = [];       // Letzten N Events für Debugging
    this._historyMax = 100;
  }

  /**
   * Event emittieren und optional in History aufzeichnen.
   * @param {string} event
   * @param {any}    payload
   * @param {boolean} [record=false] – in History aufnehmen (für Debug-Events)
   */
  emit(event, payload, record = false) {
    if (record) {
      this._history.push({ event, payload, ts: Date.now() });
      if (this._history.length > this._historyMax) this._history.shift();
    }
    return super.emit(event, payload);
  }

  /**
   * Event-History für Debugging.
   */
  getHistory(filter = null) {
    if (!filter) return this._history;
    return this._history.filter(e => e.event.startsWith(filter));
  }

  /**
   * Einen Handler einmalig registrieren — wird nach erstem Aufruf entfernt.
   * Standard-EventEmitter hat `once`, aber diese Version gibt ein Promise zurück.
   */
  waitFor(event, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener(event, handler);
        reject(new Error(`EventBus: waitFor("${event}") timed out after ${timeout}ms`));
      }, timeout);
      const handler = (payload) => {
        clearTimeout(timer);
        resolve(payload);
      };
      this.once(event, handler);
    });
  }
}

// Singleton — die ganze App nutzt denselben Bus
const bus = new EventBus();
module.exports = bus;
