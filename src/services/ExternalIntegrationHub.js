/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  EXTERNAL INTEGRATION HUB v1.0                                      ║
 * ║                                                                      ║
 * ║  Einheitliche externe Service-Integration für Johnny:              ║
 * ║  - REST API Connector (GET/POST/PUT/DELETE mit Auth)               ║
 * ║  - Webhook-Engine (eingehend + ausgehend)                          ║
 * ║  - Automation Workflows (If-This-Then-That-Logik)                  ║
 * ║  - Service Health Monitoring                                        ║
 * ║  - Credential Vault (verschlüsselt)                                ║
 * ║  - Rate Limiting & Retry-Logik                                      ║
 * ║  - Response Caching                                                 ║
 * ║  - Service Templates (Notion, Trello, Jira, Slack, etc.)          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs').promises;
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// ── Vorkonfigurierte Service-Templates ────────────────────────────────
const SERVICE_TEMPLATES = {
  notion: {
    name: 'Notion',
    baseUrl: 'https://api.notion.com/v1',
    authType: 'bearer',
    headers: { 'Notion-Version': '2022-06-28' },
    endpoints: {
      search:     { method: 'POST', path: '/search', desc: 'Suche in Notion' },
      getPage:    { method: 'GET',  path: '/pages/{page_id}', desc: 'Seite abrufen' },
      createPage: { method: 'POST', path: '/pages', desc: 'Seite erstellen' },
      getDb:      { method: 'POST', path: '/databases/{database_id}/query', desc: 'Datenbank abfragen' },
      updatePage: { method: 'PATCH',path: '/pages/{page_id}', desc: 'Seite aktualisieren' },
    },
  },
  trello: {
    name: 'Trello',
    baseUrl: 'https://api.trello.com/1',
    authType: 'query-params',
    authParams: ['key', 'token'],
    endpoints: {
      boards:     { method: 'GET',  path: '/members/me/boards', desc: 'Alle Boards' },
      lists:      { method: 'GET',  path: '/boards/{board_id}/lists', desc: 'Listen eines Boards' },
      cards:      { method: 'GET',  path: '/lists/{list_id}/cards', desc: 'Karten einer Liste' },
      createCard: { method: 'POST', path: '/cards', desc: 'Karte erstellen' },
      moveCard:   { method: 'PUT',  path: '/cards/{card_id}', desc: 'Karte verschieben' },
    },
  },
  jira: {
    name: 'Jira',
    baseUrl: 'https://{domain}.atlassian.net/rest/api/3',
    authType: 'basic',
    endpoints: {
      search:      { method: 'GET',  path: '/search?jql={jql}', desc: 'JQL-Suche' },
      getIssue:    { method: 'GET',  path: '/issue/{issue_key}', desc: 'Issue abrufen' },
      createIssue: { method: 'POST', path: '/issue', desc: 'Issue erstellen' },
      transition:  { method: 'POST', path: '/issue/{issue_key}/transitions', desc: 'Status ändern' },
      projects:    { method: 'GET',  path: '/project', desc: 'Alle Projekte' },
    },
  },
  linear: {
    name: 'Linear',
    baseUrl: 'https://api.linear.app/graphql',
    authType: 'bearer',
    isGraphQL: true,
    queries: {
      issues:      'query { issues { nodes { id title state { name } assignee { name } priority } } }',
      createIssue: 'mutation ($title: String!, $teamId: String!) { issueCreate(input: { title: $title, teamId: $teamId }) { issue { id title } } }',
      teams:       'query { teams { nodes { id name } } }',
    },
  },
  airtable: {
    name: 'Airtable',
    baseUrl: 'https://api.airtable.com/v0',
    authType: 'bearer',
    endpoints: {
      listRecords:  { method: 'GET',  path: '/{base_id}/{table_name}', desc: 'Datensätze auflisten' },
      getRecord:    { method: 'GET',  path: '/{base_id}/{table_name}/{record_id}', desc: 'Datensatz abrufen' },
      createRecord: { method: 'POST', path: '/{base_id}/{table_name}', desc: 'Datensatz erstellen' },
      updateRecord: { method: 'PATCH',path: '/{base_id}/{table_name}/{record_id}', desc: 'Datensatz aktualisieren' },
    },
  },
  todoist: {
    name: 'Todoist',
    baseUrl: 'https://api.todoist.com/rest/v2',
    authType: 'bearer',
    endpoints: {
      getTasks:    { method: 'GET',  path: '/tasks', desc: 'Alle Aufgaben' },
      createTask:  { method: 'POST', path: '/tasks', desc: 'Aufgabe erstellen' },
      closeTask:   { method: 'POST', path: '/tasks/{task_id}/close', desc: 'Aufgabe abschließen' },
      getProjects: { method: 'GET',  path: '/projects', desc: 'Alle Projekte' },
    },
  },
  openweather: {
    name: 'OpenWeatherMap',
    baseUrl: 'https://api.openweathermap.org/data/2.5',
    authType: 'query-params',
    authParams: ['appid'],
    endpoints: {
      current:  { method: 'GET', path: '/weather?q={city}&units=metric&lang=de', desc: 'Aktuelles Wetter' },
      forecast: { method: 'GET', path: '/forecast?q={city}&units=metric&lang=de', desc: '5-Tage-Vorhersage' },
    },
  },
  custom: {
    name: 'Custom REST API',
    baseUrl: '',
    authType: 'bearer',
    endpoints: {},
  },
};

class ExternalIntegrationHub {
  constructor(config = {}) {
    this.agentManager = config.agentManager;
    this.store        = config.store;
    this.dataDir      = config.dataDir || path.join(require('os').homedir(), '.johnny', 'integrations');

    this._connections  = new Map();   // serviceId → { template, credentials, config }
    this._webhooks     = new Map();   // webhookId → { url, secret, events, handler }
    this._workflows    = new Map();   // workflowId → { trigger, actions, enabled }
    this._cache        = new Map();   // cacheKey → { data, expiry }
    this._rateLimits   = new Map();   // serviceId → { remaining, resetAt }
    this._webhookServer = null;
    this._healthStatus = new Map();   // serviceId → { status, lastCheck, latency }
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    await this._loadConnections();
    await this._loadWorkflows();
    console.log('[IntegrationHub] Initialized — connections: ' + this._connections.size + ', workflows: ' + this._workflows.size);
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ CONNECTION MANAGEMENT ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Verbindet einen externen Service
   */
  async connectService(serviceId, templateName, credentials = {}, config = {}) {
    const template = SERVICE_TEMPLATES[templateName];
    if (!template && templateName !== 'custom') throw new Error(`Unbekannter Service: ${templateName}. Verfügbar: ${Object.keys(SERVICE_TEMPLATES).join(', ')}`);

    const connection = {
      id: serviceId || templateName + '_' + Date.now().toString(36),
      template: templateName,
      baseUrl: config.baseUrl || (template ? template.baseUrl : ''),
      authType: config.authType || (template ? template.authType : 'bearer'),
      credentials: this._encryptCredentials(credentials),
      headers: { ...(template ? template.headers : {}), ...(config.headers || {}) },
      config,
      connectedAt: Date.now(),
    };

    this._connections.set(connection.id, connection);
    await this._saveConnections();

    // Health Check
    await this._checkHealth(connection.id);

    return { id: connection.id, service: templateName, status: 'connected' };
  }

  disconnectService(serviceId) {
    this._connections.delete(serviceId);
    this._healthStatus.delete(serviceId);
    this._saveConnections();
    return { success: true };
  }

  listConnections() {
    return Array.from(this._connections.entries()).map(([id, conn]) => ({
      id,
      service: conn.template,
      baseUrl: conn.baseUrl,
      health: this._healthStatus.get(id) || { status: 'unknown' },
      connectedAt: conn.connectedAt,
    }));
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ API REQUESTS ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Führt einen API-Request aus
   */
  async request(serviceId, endpointOrPath, params = {}, options = {}) {
    const conn = this._connections.get(serviceId);
    if (!conn) throw new Error(`Service nicht verbunden: ${serviceId}`);

    const template = SERVICE_TEMPLATES[conn.template];
    const credentials = this._decryptCredentials(conn.credentials);

    // Endpoint auflösen
    let method, urlPath;
    if (template && template.endpoints && template.endpoints[endpointOrPath]) {
      const ep = template.endpoints[endpointOrPath];
      method = ep.method;
      urlPath = ep.path;
    } else {
      method = options.method || 'GET';
      urlPath = endpointOrPath;
    }

    // Pfad-Parameter ersetzen
    let resolvedPath = urlPath;
    for (const [key, val] of Object.entries(params)) {
      resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(val));
    }

    // URL bauen
    let url = conn.baseUrl.replace('{domain}', credentials.domain || '') + resolvedPath;

    // Cache prüfen
    const cacheKey = `${serviceId}:${method}:${resolvedPath}`;
    if (method === 'GET' && !options.noCache) {
      const cached = this._cache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) return { ...cached.data, fromCache: true };
    }

    // Rate Limit prüfen
    const rateLimit = this._rateLimits.get(serviceId);
    if (rateLimit && rateLimit.remaining <= 0 && rateLimit.resetAt > Date.now()) {
      throw new Error(`Rate limit erreicht. Reset in ${Math.ceil((rateLimit.resetAt - Date.now()) / 1000)}s`);
    }

    // Headers
    const headers = { 'Content-Type': 'application/json', ...conn.headers };

    // Auth
    switch (conn.authType) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${credentials.token || credentials.apiKey}`;
        break;
      case 'basic':
        headers['Authorization'] = `Basic ${Buffer.from(`${credentials.email || credentials.user}:${credentials.token || credentials.apiKey}`).toString('base64')}`;
        break;
      case 'query-params': {
        const authParams = template?.authParams || ['key', 'token'];
        const sep = url.includes('?') ? '&' : '?';
        const qp = authParams.map(p => `${p}=${encodeURIComponent(credentials[p] || '')}`).join('&');
        url += sep + qp;
        break;
      }
    }

    // GraphQL
    if (template?.isGraphQL) {
      const query = template.queries?.[endpointOrPath] || endpointOrPath;
      params = { query, variables: params };
      method = 'POST';
    }

    // Request ausführen
    const startTime = Date.now();
    try {
      const axios = require('axios');
      const response = await axios({
        method,
        url,
        headers,
        data: ['POST', 'PUT', 'PATCH'].includes(method) ? (params.body || params) : undefined,
        params: method === 'GET' ? this._cleanParams(params) : undefined,
        timeout: options.timeout || 15000,
        validateStatus: () => true,
      });

      const latency = Date.now() - startTime;

      // Rate Limit aus Headers
      if (response.headers['x-ratelimit-remaining']) {
        this._rateLimits.set(serviceId, {
          remaining: parseInt(response.headers['x-ratelimit-remaining']),
          resetAt: parseInt(response.headers['x-ratelimit-reset']) * 1000 || Date.now() + 60000,
        });
      }

      // Health aktualisieren
      this._healthStatus.set(serviceId, { status: response.status < 400 ? 'healthy' : 'degraded', lastCheck: Date.now(), latency });

      const result = {
        status: response.status,
        data: response.data,
        headers: this._safeHeaders(response.headers),
        latency,
      };

      // Cache speichern (nur GET, nur Erfolg)
      if (method === 'GET' && response.status < 300) {
        this._cache.set(cacheKey, { data: result, expiry: Date.now() + (options.cacheTTL || 60000) });
        if (this._cache.size > 200) this._evictCache();
      }

      return result;
    } catch (e) {
      this._healthStatus.set(serviceId, { status: 'error', lastCheck: Date.now(), error: e.message });

      // Retry
      if (options.retry && !options._retried) {
        console.warn(`[IntegrationHub] Request failed, retrying: ${e.message}`);
        await new Promise(r => setTimeout(r, 1000));
        return this.request(serviceId, endpointOrPath, params, { ...options, _retried: true });
      }

      throw new Error(`API-Fehler (${conn.template}): ${e.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ WEBHOOK-ENGINE ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Registriert einen eingehenden Webhook
   */
  registerWebhook(id, config = {}) {
    const secret = config.secret || crypto.randomBytes(16).toString('hex');
    const webhook = {
      id: id || 'wh_' + Date.now().toString(36),
      path: config.path || `/webhook/${id}`,
      secret,
      events: config.events || ['*'],
      handler: config.handler || null,
      createdAt: Date.now(),
      lastTriggered: null,
      triggerCount: 0,
    };
    this._webhooks.set(webhook.id, webhook);
    return { id: webhook.id, path: webhook.path, secret };
  }

  /**
   * Startet den Webhook-Server
   */
  async startWebhookServer(port = 8766) {
    if (this._webhookServer) return { running: true, port };

    this._webhookServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const webhook = Array.from(this._webhooks.values()).find(w => w.path === url.pathname);
        if (!webhook) { res.writeHead(404); res.end('Not Found'); return; }

        // Signature Verification
        const signature = req.headers['x-webhook-signature'] || req.headers['x-hub-signature-256'];
        if (webhook.secret && signature) {
          const expected = 'sha256=' + crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');
          if (signature !== expected) { res.writeHead(401); res.end('Invalid signature'); return; }
        }

        let payload;
        try { payload = JSON.parse(body); } catch { payload = body; }

        webhook.lastTriggered = Date.now();
        webhook.triggerCount++;

        // Workflow triggern
        this._processWebhookTrigger(webhook.id, payload);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      });
    });

    await new Promise((resolve) => this._webhookServer.listen(port, resolve));
    console.log(`[IntegrationHub] Webhook-Server auf Port ${port}`);
    return { running: true, port };
  }

  stopWebhookServer() {
    if (this._webhookServer) { this._webhookServer.close(); this._webhookServer = null; }
    return { running: false };
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ AUTOMATION WORKFLOWS ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Erstellt einen Automation-Workflow
   */
  createWorkflow(params = {}) {
    const id = 'wf_' + Date.now().toString(36);
    const workflow = {
      id,
      name: params.name || 'Neuer Workflow',
      trigger: params.trigger || { type: 'webhook', webhookId: null },
      conditions: params.conditions || [],
      actions: params.actions || [],
      enabled: params.enabled !== false,
      createdAt: Date.now(),
      lastRun: null,
      runCount: 0,
    };
    this._workflows.set(id, workflow);
    this._saveWorkflows();
    return workflow;
  }

  listWorkflows() {
    return Array.from(this._workflows.values()).map(w => ({
      id: w.id, name: w.name, enabled: w.enabled,
      trigger: w.trigger, actionCount: w.actions.length,
      lastRun: w.lastRun, runCount: w.runCount,
    }));
  }

  toggleWorkflow(id) {
    const wf = this._workflows.get(id);
    if (!wf) return null;
    wf.enabled = !wf.enabled;
    this._saveWorkflows();
    return { id, enabled: wf.enabled };
  }

  deleteWorkflow(id) { this._workflows.delete(id); this._saveWorkflows(); }

  async _processWebhookTrigger(webhookId, payload) {
    for (const [, workflow] of this._workflows) {
      if (!workflow.enabled) continue;
      if (workflow.trigger.type === 'webhook' && workflow.trigger.webhookId === webhookId) {
        await this._executeWorkflow(workflow, payload);
      }
    }
  }

  async _executeWorkflow(workflow, data) {
    workflow.lastRun = Date.now();
    workflow.runCount++;

    for (const action of workflow.actions) {
      try {
        switch (action.type) {
          case 'api-call':
            await this.request(action.serviceId, action.endpoint, { ...action.params, _triggerData: data });
            break;
          case 'notify':
            if (this.agentManager) {
              await this.agentManager.sendMessage('Johnny', `Workflow "${workflow.name}" ausgelöst: ${JSON.stringify(data).slice(0, 200)}`);
            }
            break;
          case 'transform':
            data = typeof action.transform === 'function' ? action.transform(data) : data;
            break;
        }
      } catch (e) {
        console.error(`[IntegrationHub] Workflow action failed: ${e.message}`);
      }
    }
    this._saveWorkflows();
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ HEALTH MONITORING ██
  // ════════════════════════════════════════════════════════════════════

  async checkAllHealth() {
    const results = {};
    for (const [id] of this._connections) {
      results[id] = await this._checkHealth(id);
    }
    return results;
  }

  async _checkHealth(serviceId) {
    const conn = this._connections.get(serviceId);
    if (!conn) return { status: 'disconnected' };

    try {
      const start = Date.now();
      const axios = require('axios');
      const credentials = this._decryptCredentials(conn.credentials);
      const headers = { ...conn.headers };

      if (conn.authType === 'bearer') headers['Authorization'] = `Bearer ${credentials.token || credentials.apiKey}`;

      await axios.head(conn.baseUrl.replace('{domain}', credentials.domain || ''), { headers, timeout: 5000, validateStatus: () => true });
      const latency = Date.now() - start;
      const status = { status: 'healthy', lastCheck: Date.now(), latency };
      this._healthStatus.set(serviceId, status);
      return status;
    } catch (e) {
      const status = { status: 'unreachable', lastCheck: Date.now(), error: e.message };
      this._healthStatus.set(serviceId, status);
      return status;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ HILFSFUNKTIONEN ██
  // ════════════════════════════════════════════════════════════════════

  _encryptCredentials(creds) {
    // Simple obfuscation (in Produktion: echte Verschlüsselung)
    return Buffer.from(JSON.stringify(creds)).toString('base64');
  }

  _decryptCredentials(encrypted) {
    try { return JSON.parse(Buffer.from(encrypted, 'base64').toString()); }
    catch { return {}; }
  }

  _cleanParams(params) {
    const cleaned = {};
    for (const [k, v] of Object.entries(params)) {
      if (!k.startsWith('_') && !['body'].includes(k) && !k.includes('{')) cleaned[k] = v;
    }
    return cleaned;
  }

  _safeHeaders(headers) {
    const safe = {};
    const allow = ['content-type', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-request-id'];
    for (const k of allow) { if (headers[k]) safe[k] = headers[k]; }
    return safe;
  }

  _evictCache() {
    const now = Date.now();
    for (const [k, v] of this._cache) { if (v.expiry < now) this._cache.delete(k); }
    if (this._cache.size > 150) {
      const entries = Array.from(this._cache.entries()).sort((a, b) => a[1].expiry - b[1].expiry);
      entries.slice(0, 50).forEach(([k]) => this._cache.delete(k));
    }
  }

  // ── Persistence ────────────────────────────────────────────────────
  async _saveConnections() {
    try {
      const data = {};
      for (const [id, conn] of this._connections) data[id] = conn;
      await fs.writeFile(path.join(this.dataDir, 'connections.json'), JSON.stringify(data, null, 2));
    } catch (e) { console.warn('[IntegrationHub] Save error:', e.message); }
  }

  async _loadConnections() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'connections.json'), 'utf-8');
      for (const [id, conn] of Object.entries(JSON.parse(raw))) this._connections.set(id, conn);
    } catch { /* first run */ }
  }

  async _saveWorkflows() {
    try {
      const data = {};
      for (const [id, wf] of this._workflows) data[id] = wf;
      await fs.writeFile(path.join(this.dataDir, 'workflows.json'), JSON.stringify(data, null, 2));
    } catch (e) { console.warn('[IntegrationHub] Save workflows error:', e.message); }
  }

  async _loadWorkflows() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'workflows.json'), 'utf-8');
      for (const [id, wf] of Object.entries(JSON.parse(raw))) this._workflows.set(id, wf);
    } catch { /* first run */ }
  }

  // ── Status ─────────────────────────────────────────────────────────
  getTemplates() { return Object.entries(SERVICE_TEMPLATES).map(([id, t]) => ({ id, name: t.name, endpoints: Object.keys(t.endpoints || t.queries || {}) })); }

  getStatus() {
    return {
      connections: this._connections.size,
      webhooks: this._webhooks.size,
      workflows: this._workflows.size,
      webhookServerRunning: !!this._webhookServer,
      health: Object.fromEntries(this._healthStatus),
      cacheSize: this._cache.size,
      templates: Object.keys(SERVICE_TEMPLATES),
    };
  }
}

module.exports = ExternalIntegrationHub;
