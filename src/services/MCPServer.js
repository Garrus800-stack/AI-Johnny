const WebSocket = require('ws');
const http      = require('http');
const logger    = require('../core/Logger');

/**
 * MCPServer v2 — Anthropic Model Context Protocol
 *
 * Implementiert das offizielle MCP JSON-RPC-Protokoll:
 * https://spec.modelcontextprotocol.io/specification/
 *
 * Kompatibel mit: Claude Desktop, Continue.dev, Cursor, Zed, und anderen MCP-Clients.
 *
 * Protokoll-Ablauf:
 *   1. Client sendet:  initialize   → Server antwortet mit capabilities
 *   2. Client sendet:  notifications/initialized  (Bestätigung)
 *   3. Client kann:    tools/list, tools/call, resources/list, resources/read,
 *                      prompts/list, prompts/get
 *
 * Transport: stdio (Standard) oder WebSocket (Johnny-Modus auf Port 8765)
 * Alle Nachrichten: JSON-RPC 2.0 Format
 */
class MCPServer {
  constructor(config) {
    this.port         = config.port         || 8765;
    this.agentManager = config.agentManager;
    this.server       = null;
    this.wss          = null;
    this.clients      = new Map();  // socketId → { ws, initialized, clientInfo }

    // Server-Capabilities (was dieser MCP-Server anbietet)
    this._serverInfo = {
      name:    'johnny-mcp',
      version: '2.0.0',
    };
    this._capabilities = {
      tools:     { listChanged: true },
      resources: { subscribe: false, listChanged: false },
      prompts:   { listChanged: false },
      logging:   {},
    };

    // Protokoll-Version
    this._protocolVersion = '2024-11-05';
  }

  // ══════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════

  async start() {
    this.server = http.createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          protocol: 'MCP',
          version:  this._protocolVersion,
          server:   this._serverInfo,
          clients:  this.clients.size,
          status:   'running',
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });

    this.wss = new WebSocket.Server({ server: this.server });
    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));

    await new Promise((resolve, reject) => {
      this.server.listen(this.port, '127.0.0.1', err => err ? reject(err) : resolve());
    });

    logger.info('MCPServer', `MCP Server bereit — ws://127.0.0.1:${this.port} (Protokoll ${this._protocolVersion})`);
    return { port: this.port };
  }

  async stop() {
    if (this.wss)    this.wss.close();
    if (this.server) this.server.close();
    logger.info('MCPServer', 'MCP Server gestoppt');
  }

  // ══════════════════════════════════════════════════════════════════════
  // CONNECTION MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════

  _onConnection(ws, req) {
    const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const client = { ws, id, initialized: false, clientInfo: null };
    this.clients.set(id, client);
    logger.info('MCPServer', `Client verbunden: ${id} (${req.socket.remoteAddress})`);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await this._handleMessage(client, msg);
      } catch (e) {
        this._sendError(ws, null, -32700, 'Parse error', e.message);
      }
    });

    ws.on('close', () => {
      this.clients.delete(id);
      logger.info('MCPServer', `Client getrennt: ${id}`);
    });

    ws.on('error', (e) => logger.warn('MCPServer', `Client ${id} Fehler: ${e.message}`));
  }

  // ══════════════════════════════════════════════════════════════════════
  // MESSAGE DISPATCH (JSON-RPC 2.0)
  // ══════════════════════════════════════════════════════════════════════

  async _handleMessage(client, msg) {
    // Notification (kein id) → kein Response nötig
    if (msg.method && msg.id === undefined) {
      await this._handleNotification(client, msg);
      return;
    }

    // Request → Response erforderlich
    if (msg.method && msg.id !== undefined) {
      await this._handleRequest(client, msg);
      return;
    }

    // Response auf Server-seitige Anfragen (falls gesendet)
    if (msg.result !== undefined || msg.error !== undefined) {
      return; // Ignorieren für jetzt
    }

    this._sendError(client.ws, msg.id ?? null, -32600, 'Invalid Request');
  }

  async _handleNotification(client, msg) {
    switch (msg.method) {
      case 'notifications/initialized':
        client.initialized = true;
        logger.info('MCPServer', `Client ${client.id} initialisiert: ${JSON.stringify(client.clientInfo?.name || '?')}`);
        break;
      case 'notifications/cancelled':
        // Request-Abbruch — nichts zu tun
        break;
      default:
        logger.warn('MCPServer', `Unbekannte Notification: ${msg.method}`);
    }
  }

  async _handleRequest(client, msg) {
    const { id, method, params } = msg;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = await this._handleInitialize(client, params);
          break;

        case 'tools/list':
          result = await this._handleToolsList(params?.cursor);
          break;

        case 'tools/call':
          result = await this._handleToolsCall(client, params);
          break;

        case 'resources/list':
          result = await this._handleResourcesList(params?.cursor);
          break;

        case 'resources/read':
          result = await this._handleResourcesRead(params?.uri);
          break;

        case 'prompts/list':
          result = await this._handlePromptsList(params?.cursor);
          break;

        case 'prompts/get':
          result = await this._handlePromptsGet(params?.name, params?.arguments);
          break;

        case 'ping':
          result = {};
          break;

        default:
          return this._sendError(client.ws, id, -32601, 'Method not found', `Unknown method: ${method}`);
      }

      this._sendResult(client.ws, id, result);

    } catch (e) {
      logger.error('MCPServer', `Fehler bei ${method}: ${e.message}`);
      this._sendError(client.ws, id, -32603, 'Internal error', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // MCP HANDLERS
  // ══════════════════════════════════════════════════════════════════════

  async _handleInitialize(client, params) {
    client.clientInfo       = params?.clientInfo || {};
    client._protocolVersion = params?.protocolVersion || this._protocolVersion;

    return {
      protocolVersion: this._protocolVersion,
      capabilities:    this._capabilities,
      serverInfo:      this._serverInfo,
      instructions:    'Johnny AI Assistant. Alle registrierten Johnny-Tools sind verfügbar. Rufe tools/list auf um sie zu sehen.',
    };
  }

  async _handleToolsList(cursor = null) {
    const tools = this._getJohnnyToolsAsMCP();

    // Einfaches Cursor-Paging (50 Tools pro Seite)
    const PAGE = 50;
    const allKeys = tools.map((_, i) => i);
    const startIdx = cursor ? parseInt(cursor, 10) : 0;
    const page = tools.slice(startIdx, startIdx + PAGE);
    const nextCursor = startIdx + PAGE < tools.length ? String(startIdx + PAGE) : undefined;

    return {
      tools:      page,
      nextCursor,
    };
  }

  async _handleToolsCall(client, params) {
    const { name, arguments: args = {} } = params || {};

    if (!name) {
      return { isError: true, content: [{ type: 'text', text: 'Tool name erforderlich' }] };
    }

    if (!this.agentManager) {
      return { isError: true, content: [{ type: 'text', text: 'AgentManager nicht verfügbar' }] };
    }

    // Tool im AgentManager finden
    const toolDef = this.agentManager.toolRegistry?.get(name);
    if (!toolDef) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool '${name}' nicht gefunden. Verfügbar: ${[...( this.agentManager.toolRegistry?.keys() || [])].join(', ')}` }],
      };
    }

    logger.info('MCPServer', `Tool-Call: ${name} (von Client ${client.id})`);

    try {
      const result = await toolDef.execute(args, null, this.agentManager);

      // Ergebnis in MCP-Format konvertieren
      const text = typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);

      return {
        content: [{ type: 'text', text }],
        isError: result?.error ? true : false,
      };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool-Fehler: ${e.message}` }],
      };
    }
  }

  async _handleResourcesList(cursor = null) {
    // Johnny-Ressourcen: Agenten, Konversationen, Memories
    const resources = [];

    if (this.agentManager) {
      try {
        const agents = await this.agentManager.getAgents();
        for (const agent of agents) {
          resources.push({
            uri:         `johnny://agents/${encodeURIComponent(agent.name)}`,
            name:        `Agent: ${agent.name}`,
            description: agent.role || agent.personality || 'KI-Agent',
            mimeType:    'application/json',
          });
        }
      } catch {}
    }

    resources.push({
      uri:         'johnny://status',
      name:        'Johnny Status',
      description: 'Aktueller System-Status',
      mimeType:    'application/json',
    });

    return { resources };
  }

  async _handleResourcesRead(uri) {
    if (!uri) throw new Error('URI erforderlich');

    if (uri === 'johnny://status') {
      const status = {
        agents:  this.agentManager ? (await this.agentManager.getAgents()).length : 0,
        uptime:  process.uptime(),
        version: this._serverInfo.version,
      };
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(status, null, 2) }],
      };
    }

    if (uri.startsWith('johnny://agents/')) {
      const name = decodeURIComponent(uri.replace('johnny://agents/', ''));
      const agents = await this.agentManager?.getAgents() || [];
      const agent = agents.find(a => a.name === name);
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(agent || { error: 'Agent nicht gefunden' }, null, 2),
        }],
      };
    }

    throw new Error(`Unbekannte URI: ${uri}`);
  }

  async _handlePromptsList(cursor = null) {
    return {
      prompts: [
        {
          name:        'ask-johnny',
          description: 'Stellt Johnny eine Frage und bekommt eine Antwort mit Zugriff auf alle Tools',
          arguments:   [
            { name: 'message', description: 'Die Frage oder Aufgabe', required: true },
            { name: 'agent',   description: 'Agent-Name (Standard: Johnny)', required: false },
          ],
        },
        {
          name:        'johnny-summarize',
          description: 'Lässt Johnny einen Text zusammenfassen',
          arguments:   [
            { name: 'text', description: 'Der zusammenzufassende Text', required: true },
          ],
        },
      ],
    };
  }

  async _handlePromptsGet(name, args = {}) {
    switch (name) {
      case 'ask-johnny':
        return {
          description: 'Frage an Johnny',
          messages: [
            {
              role:    'user',
              content: { type: 'text', text: args.message || 'Hallo Johnny!' },
            },
          ],
        };

      case 'johnny-summarize':
        return {
          description: 'Text-Zusammenfassung',
          messages: [
            {
              role:    'user',
              content: { type: 'text', text: `Bitte fasse folgenden Text zusammen:\n\n${args.text || '(kein Text)'}` },
            },
          ],
        };

      default:
        throw new Error(`Unbekannter Prompt: ${name}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // TOOL CONVERSION — Johnny-Format → MCP-Format
  // ══════════════════════════════════════════════════════════════════════

  _getJohnnyToolsAsMCP() {
    if (!this.agentManager || !this.agentManager.toolRegistry) return [];

    const mcpTools = [];
    for (const [name, tool] of this.agentManager.toolRegistry) {
      if (!name || !tool) continue;

      // Johnny parameters-Format → JSON-Schema
      let inputSchema;
      const params = tool.parameters;

      if (params && typeof params === 'object' && params.type === 'object') {
        // Ist schon JSON-Schema
        inputSchema = params;
      } else if (params && typeof params === 'object') {
        // Johnny-Format: { param: 'type - description' }
        const properties = {};
        const required   = [];
        for (const [key, val] of Object.entries(params)) {
          const desc = typeof val === 'string' ? val : String(val);
          const isRequired = !desc.toLowerCase().includes('optional');
          properties[key] = {
            type:        'string',
            description: desc,
          };
          if (isRequired) required.push(key);
        }
        inputSchema = { type: 'object', properties, required };
      } else {
        inputSchema = { type: 'object', properties: {} };
      }

      mcpTools.push({
        name,
        description: tool.description || `Johnny Tool: ${name}`,
        inputSchema,
      });
    }

    return mcpTools;
  }

  // ══════════════════════════════════════════════════════════════════════
  // JSON-RPC HELPERS
  // ══════════════════════════════════════════════════════════════════════

  _sendResult(ws, id, result) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  _sendError(ws, id, code, message, data = undefined) {
    if (ws.readyState !== ws.OPEN) return;
    const err = { jsonrpc: '2.0', id, error: { code, message } };
    if (data !== undefined) err.error.data = data;
    ws.send(JSON.stringify(err));
  }

  _sendNotification(ws, method, params = undefined) {
    if (ws.readyState !== ws.OPEN) return;
    const msg = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;
    ws.send(JSON.stringify(msg));
  }

  // Broadcast tools/list Changed zu allen initialisierten Clients
  notifyToolsChanged() {
    for (const { ws, initialized } of this.clients.values()) {
      if (initialized) this._sendNotification(ws, 'notifications/tools/list_changed');
    }
  }
}

module.exports = MCPServer;
