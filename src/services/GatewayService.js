const WebSocket = require('ws');
const http = require('http');
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * GatewayService – Zentraler WebSocket Event-Bus
 *
 * Funktionen:
 *  - Externe Tools können sich verbinden und Johnny-Events empfangen
 *  - Skill/Plugin-Entwickler können über WS Nachrichten senden
 *  - Inter-Service-Kommunikation (z.B. SmartHome → Agent)
 *  - Kompatibel mit OpenClaw Gateway-Protokoll (basic)
 *
 * Protokoll:
 *  { type: 'auth', token: '...' }
 *  { type: 'subscribe', channels: ['agent.*', 'tool.*'] }
 *  { type: 'publish', channel: 'tool.result', data: {...} }
 *  { type: 'rpc', method: 'sendMessage', params: {...}, id: '...' }
 */
class GatewayService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.port       = config.port || 18789;
    this.authToken  = config.authToken || null; // null = no auth
    this.agentManager = config.agentManager;
    this.server     = null;
    this.wss        = null;
    this.clients    = new Map(); // socketId → { ws, subscriptions, authenticated, name }
    this.running    = false;
    this._eventLog  = [];        // last 200 events for replay
  }

  async start() {
    if (this.running) return { port: this.port };

    this.server = http.createServer((req, res) => {
      if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(this.getStatus()));
      } else if (req.url === '/events') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(this._eventLog.slice(-50)));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this._buildDashboard());
      }
    });

    this.wss = new WebSocket.Server({ server: this.server });
    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));

    await new Promise((resolve, reject) => {
      this.server.listen(this.port, '0.0.0.0', err => err ? reject(err) : resolve());
    });

    this.running = true;
    console.log(`[Gateway] Running on ws://0.0.0.0:${this.port}`);
    return { port: this.port };
  }

  async stop() {
    if (!this.running) return;
    this.wss?.close();
    await new Promise(r => this.server?.close(r));
    this.running = false;
    console.log('[Gateway] Stopped');
  }

  // ── WebSocket Connection Handler ──────────────────────────────────
  _onConnection(ws, req) {
    const socketId = uuidv4().slice(0, 12);
    const client = {
      ws, socketId,
      ip: req.socket.remoteAddress,
      name: 'anonymous',
      authenticated: !this.authToken, // auto-auth if no token set
      subscriptions: new Set(['system.*']),
      connectedAt: Date.now()
    };
    this.clients.set(socketId, client);

    this._send(ws, { type: 'welcome', socketId, version: '1.0', needsAuth: !!this.authToken });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        this._handleMessage(socketId, msg);
      } catch (e) {
        this._send(ws, { type: 'error', message: 'Invalid JSON' });
      }
    });

    ws.on('close', () => {
      this.clients.delete(socketId);
      this._publishInternal('system.client_disconnected', { socketId });
    });

    this._publishInternal('system.client_connected', { socketId, ip: client.ip });
  }

  _handleMessage(socketId, msg) {
    const client = this.clients.get(socketId);
    if (!client) return;

    switch (msg.type) {
      case 'auth': {
        if (this.authToken && msg.token === this.authToken) {
          client.authenticated = true;
          client.name = msg.name || 'tool-client';
          this._send(client.ws, { type: 'auth_ok', name: client.name });
        } else if (this.authToken) {
          this._send(client.ws, { type: 'auth_failed' });
        }
        break;
      }

      case 'subscribe': {
        if (!client.authenticated) return this._send(client.ws, { type: 'error', message: 'Not authenticated' });
        (msg.channels || []).forEach(ch => client.subscriptions.add(ch));
        this._send(client.ws, { type: 'subscribed', channels: Array.from(client.subscriptions) });
        break;
      }

      case 'unsubscribe': {
        (msg.channels || []).forEach(ch => client.subscriptions.delete(ch));
        break;
      }

      case 'publish': {
        if (!client.authenticated) return;
        this.publish(msg.channel, msg.data, socketId);
        break;
      }

      case 'rpc': {
        if (!client.authenticated) return;
        this._handleRPC(socketId, msg);
        break;
      }

      case 'ping': {
        this._send(client.ws, { type: 'pong', ts: Date.now() });
        break;
      }
    }
  }

  // ── RPC: Direkte Befehle über Gateway ──────────────────────────────
  async _handleRPC(socketId, msg) {
    const client = this.clients.get(socketId);
    const { method, params, id } = msg;

    try {
      let result;
      switch (method) {
        case 'sendMessage':
          if (!this.agentManager) throw new Error('AgentManager not available');
          result = await this.agentManager.sendMessage(
            params.agent || 'Johnny', params.message, params.conversationId
          );
          break;
        case 'getAgents':
          result = this.agentManager ? await this.agentManager.getAgents() : [];
          break;
        case 'getStatus':
          result = this.getStatus();
          break;
        case 'executeTool':
          if (!this.agentManager) throw new Error('AgentManager not available');
          result = await this.agentManager.executeTool(
            params.tool, params.parameters,
            this.agentManager.agents.get(params.agent || 'Johnny')
          );
          break;
        default:
          throw new Error(`Unknown RPC method: ${method}`);
      }
      this._send(client.ws, { type: 'rpc_result', id, result });
    } catch (e) {
      this._send(client.ws, { type: 'rpc_error', id, error: e.message });
    }
  }

  // ── Event Publishing ──────────────────────────────────────────────
  publish(channel, data, sourceSocketId = null) {
    const event = { type: 'event', channel, data, ts: Date.now(), source: sourceSocketId };

    // Log
    this._eventLog.push(event);
    if (this._eventLog.length > 200) this._eventLog.shift();

    // Emit locally
    this.emit(channel, data);
    this.emit('*', channel, data);

    // Broadcast to subscribed WS clients
    const json = JSON.stringify(event);
    this.clients.forEach((client, sid) => {
      if (sid === sourceSocketId) return;
      if (!client.authenticated) return;
      if (client.ws.readyState !== WebSocket.OPEN) return;
      if (this._matchesSubscription(channel, client.subscriptions)) {
        client.ws.send(json);
      }
    });
  }

  _publishInternal(channel, data) {
    this.publish(channel, data, null);
  }

  _matchesSubscription(channel, subscriptions) {
    for (const sub of subscriptions) {
      if (sub === channel) return true;
      if (sub === '*') return true;
      if (sub.endsWith('.*')) {
        const prefix = sub.slice(0, -2);
        if (channel.startsWith(prefix)) return true;
      }
    }
    return false;
  }

  // ── Utility ───────────────────────────────────────────────────────
  _send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  getStatus() {
    return {
      running: this.running,
      port: this.port,
      clients: this.clients.size,
      clientList: Array.from(this.clients.values()).map(c => ({
        socketId: c.socketId, name: c.name, authenticated: c.authenticated,
        subscriptions: Array.from(c.subscriptions), ip: c.ip
      })),
      eventCount: this._eventLog.length
    };
  }

  _buildDashboard() {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Johnny Gateway</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d0d0d;color:#e0e0e0;padding:20px}
h1{color:#3dd6ac;margin-bottom:16px}#events{background:#111;border:1px solid #222;border-radius:8px;padding:12px;max-height:70vh;overflow-y:auto;font-family:monospace;font-size:12px}
.ev{padding:4px 8px;border-bottom:1px solid #1a1a1a}.ch{color:#3dd6ac}.ts{color:#555}
#stats{display:flex;gap:16px;margin-bottom:16px}.stat{background:#111;border:1px solid #222;border-radius:8px;padding:12px 20px}
.stat-val{font-size:24px;font-weight:700;color:#3dd6ac}.stat-label{font-size:11px;color:#666;text-transform:uppercase}</style></head>
<body><h1>🔌 Johnny Gateway</h1>
<div id="stats"><div class="stat"><div class="stat-val" id="s-clients">0</div><div class="stat-label">Clients</div></div>
<div class="stat"><div class="stat-val" id="s-events">0</div><div class="stat-label">Events</div></div></div>
<div id="events"></div>
<script>
const proto=location.protocol==='https:'?'wss':'ws';
const ws=new WebSocket(proto+'://'+location.host);
ws.onopen=()=>{ws.send(JSON.stringify({type:'subscribe',channels:['*']}));};
ws.onmessage=e=>{
  const m=JSON.parse(e.data);
  if(m.type==='event'){
    const d=document.createElement('div');d.className='ev';
    d.innerHTML='<span class="ts">'+new Date(m.ts).toLocaleTimeString()+'</span> <span class="ch">'+m.channel+'</span> '+JSON.stringify(m.data).slice(0,120);
    document.getElementById('events').prepend(d);
  }
  if(m.type==='welcome'){fetch('/status').then(r=>r.json()).then(s=>{
    document.getElementById('s-clients').textContent=s.clients;
    document.getElementById('s-events').textContent=s.eventCount;
  });}
};
setInterval(()=>fetch('/status').then(r=>r.json()).then(s=>{
  document.getElementById('s-clients').textContent=s.clients;
  document.getElementById('s-events').textContent=s.eventCount;
}),3000);
</script></body></html>`;
  }
}

module.exports = GatewayService;
