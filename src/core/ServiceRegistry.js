/**
 * ServiceRegistry v2.0 — Zentraler Service-Container für Johnny
 *
 * v2.0 Verbesserungen:
 *   1. Zwei-Phasen-Init: Phase 1 (init) + Phase 2 (wire)
 *      → Services starten unabhängig, werden danach verdrahtet
 *   2. Deklarative Wiring: wireDeps/wireMap in register() definieren
 *      → Kein manuelles post-init Wiring mehr in main.js
 *   3. Health-Checks: getHealth() für Service-Übersicht
 *   4. Abwärtskompatibel: register() mit altem Format funktioniert weiterhin
 *
 * Verwendung:
 *   registry.register('nlp', NLPService, config, [], {
 *     wireDeps: ['agentManager'],                  // Phase 2: inject
 *     wireMap: { agentManager: 'agentManager' },   // this.agentManager = get('agentManager')
 *   });
 */

const EventEmitter = require('events');

class ServiceRegistry extends EventEmitter {
  constructor() {
    super();
    this._entries   = new Map();
    this._instances = new Map();
    this._status    = new Map();
    this._initLog   = [];
    this._wireLog   = [];
    this._wirings   = new Map();  // explicit registerWiring() calls
  }

  /**
   * @param {string}   name
   * @param {Function} Factory
   * @param {object}   config
   * @param {string[]} deps       – Phase 1 init-deps
   * @param {object}   [opts]
   * @param {boolean}  [opts.optional=true]
   * @param {boolean}  [opts.lazy=false]
   * @param {string[]} [opts.wireDeps=[]]    – Phase 2: service names to inject
   * @param {object}   [opts.wireMap={}]     – Phase 2: { localProp: 'registryName' }
   */
  register(name, Factory, config = {}, deps = [], opts = {}) {
    if (this._entries.has(name)) {
      console.warn(`[ServiceRegistry] Duplicate: "${name}" — overwriting`);
    }
    this._entries.set(name, {
      name, Factory, config, deps,
      optional:  opts.optional !== false,
      lazy:      opts.lazy || false,
      wireDeps:  opts.wireDeps || [],
      wireMap:   opts.wireMap  || {},
    });
    this._status.set(name, 'pending');
  }

  /** Explicit wiring (alternative to opts.wireDeps). */
  registerWiring(serviceName, depName, property, bidir = false) {
    if (!this._wirings.has(serviceName)) this._wirings.set(serviceName, []);
    this._wirings.get(serviceName).push({ from: depName, property: property || depName, bidir });
  }

  registerInstance(name, instance) {
    this._instances.set(name, instance);
    this._status.set(name, 'ok');
  }

  /**
   * Phase 1: Init all (topological) + Phase 2: Wire all.
   */
  async initializeAll() {
    const order = this._topologicalSort();
    console.log('[ServiceRegistry] Phase 1 — Init:', order.join(' → '));

    for (const name of order) {
      const entry = this._entries.get(name);
      if (!entry || entry.lazy) continue;
      await this._initService(name);
    }

    console.log('[ServiceRegistry] Phase 2 — Wiring...');
    this._wireAll();
    this._printSummary();
  }

  /** Phase 2: Execute all wirings. */
  _wireAll() {
    for (const [name, entry] of this._entries) {
      const instance = this._instances.get(name);
      if (!instance) continue;

      // wireMap: { localProp: 'registryName' }
      for (const [prop, depName] of Object.entries(entry.wireMap)) {
        const dep = this.get(depName);
        if (dep) { instance[prop] = dep; this._wireLog.push({ target: name, prop, source: depName, ok: true }); }
        else { this._wireLog.push({ target: name, prop, source: depName, ok: false }); }
      }

      // wireDeps: this[depName] = get(depName)
      for (const depName of entry.wireDeps) {
        if (entry.wireMap[depName]) continue;
        const dep = this.get(depName);
        if (dep) { instance[depName] = dep; this._wireLog.push({ target: name, prop: depName, source: depName, ok: true }); }
      }
    }

    // Explicit registerWiring() calls
    for (const [svcName, wirings] of this._wirings) {
      const inst = this.get(svcName);
      if (!inst) continue;
      for (const w of wirings) {
        const dep = this.get(w.from);
        if (dep) {
          inst[w.property] = dep;
          this._wireLog.push({ target: svcName, prop: w.property, source: w.from, ok: true });
          if (w.bidir) { dep[svcName] = inst; }
        }
      }
    }

    const ok = this._wireLog.filter(w => w.ok).length;
    const fail = this._wireLog.filter(w => !w.ok).length;
    console.log(`[ServiceRegistry] Wiring: ${ok} connected, ${fail} unavailable`);
  }

  async _initService(name) {
    if (this._status.get(name) === 'ok') return true;
    if (this._status.get(name) === 'failed') return false;

    const entry = this._entries.get(name);
    if (!entry) { console.error(`[ServiceRegistry] Unknown: "${name}"`); return false; }

    for (const dep of entry.deps) {
      const depOk = await this._initService(dep);
      if (!depOk) {
        const msg = `Dep "${dep}" failed — skipping "${name}"`;
        console.warn(`[ServiceRegistry] ${msg}`);
        this._status.set(name, 'skipped');
        this._initLog.push({ name, status: 'skipped', reason: msg });
        return false;
      }
    }

    const resolvedConfig = this._resolveConfig(entry.config);

    try {
      let instance;
      if (typeof entry.Factory === 'function' && entry.Factory.prototype) {
        instance = new entry.Factory(resolvedConfig);
      } else if (typeof entry.Factory === 'function') {
        instance = await entry.Factory(this, resolvedConfig);
      }

      if (instance && typeof instance.initialize === 'function') {
        await instance.initialize();
      }

      this._instances.set(name, instance);
      this._status.set(name, 'ok');
      this._initLog.push({ name, status: 'ok' });
      console.log(`[ServiceRegistry] ✓ ${name}`);
      this.emit('service:ready', name, instance);
      return true;
    } catch (err) {
      this._status.set(name, 'failed');
      this._initLog.push({ name, status: 'failed', error: err.message });
      if (entry.optional) {
        console.warn(`[ServiceRegistry] ✗ ${name} (optional): ${err.message}`);
        this.emit('service:failed', name, err);
        return false;
      } else {
        console.error(`[ServiceRegistry] ✗ ${name} (required): ${err.message}`);
        throw err;
      }
    }
  }

  get(name) {
    if (this._instances.has(name)) return this._instances.get(name);
    const entry = this._entries.get(name);
    if (entry && entry.lazy && entry.Factory) {
      try {
        const cfg = this._resolveConfig(entry.config);
        let inst;
        if (typeof entry.Factory === 'function' && entry.Factory.prototype) inst = new entry.Factory(cfg);
        if (inst) {
          this._instances.set(name, inst);
          this._status.set(name, 'ok');
          if (typeof inst.initialize === 'function') inst.initialize().catch(() => {});
          return inst;
        }
      } catch {}
    }
    return null;
  }

  async ensure(name) { await this._initService(name); return this.get(name); }
  status(name)       { return this._status.get(name) || 'unregistered'; }

  getStatusMap() {
    const map = {};
    this._status.forEach((s, n) => { map[n] = s; });
    return map;
  }

  /** Full health report. */
  getHealth() {
    const services = [];
    for (const [name, entry] of this._entries) {
      const wirings = this._wireLog.filter(w => w.target === name);
      services.push({
        name, status: this._status.get(name) || 'unknown',
        hasInstance: this._instances.has(name),
        deps: entry.deps, wireDeps: entry.wireDeps, optional: entry.optional,
        wiredOk: wirings.filter(w => w.ok).length,
        wiredFail: wirings.filter(w => !w.ok).length,
      });
    }
    return {
      total: services.length,
      ok:      services.filter(s => s.status === 'ok').length,
      failed:  services.filter(s => s.status === 'failed').length,
      skipped: services.filter(s => s.status === 'skipped').length,
      wirings: this._wireLog.filter(w => w.ok).length,
      services,
    };
  }

  _resolveConfig(config) {
    if (!config || typeof config !== 'object') return config;
    const resolved = Array.isArray(config) ? [] : {};
    for (const [k, v] of Object.entries(config)) {
      if (v && typeof v === 'object' && v.$ref) resolved[k] = this.get(v.$ref);
      else if (v && typeof v === 'object') resolved[k] = this._resolveConfig(v);
      else resolved[k] = v;
    }
    return resolved;
  }

  _topologicalSort() {
    const names = Array.from(this._entries.keys());
    const inDeg = new Map(names.map(n => [n, 0]));
    const adj   = new Map(names.map(n => [n, []]));

    for (const [name, entry] of this._entries) {
      for (const dep of entry.deps) {
        if (this._entries.has(dep)) {
          adj.get(dep).push(name);
          inDeg.set(name, (inDeg.get(name) || 0) + 1);
        }
      }
    }

    const queue = names.filter(n => (inDeg.get(n) || 0) === 0);
    const result = [];
    while (queue.length) {
      const n = queue.shift();
      result.push(n);
      for (const next of (adj.get(n) || [])) {
        inDeg.set(next, inDeg.get(next) - 1);
        if (inDeg.get(next) === 0) queue.push(next);
      }
    }
    if (result.length !== names.length) {
      const cycle = names.filter(n => !result.includes(n));
      console.warn('[ServiceRegistry] Circular dep:', cycle.join(', '));
      result.push(...cycle);
    }
    return result;
  }

  _printSummary() {
    const ok = this._initLog.filter(e => e.status === 'ok').length;
    const fail = this._initLog.filter(e => e.status === 'failed').length;
    const skip = this._initLog.filter(e => e.status === 'skipped').length;
    const wired = this._wireLog.filter(w => w.ok).length;
    console.log(`[ServiceRegistry] Complete — ✓ ${ok}  ✗ ${fail}  ⊘ ${skip}  🔗 ${wired}`);
  }
}

module.exports = ServiceRegistry;
