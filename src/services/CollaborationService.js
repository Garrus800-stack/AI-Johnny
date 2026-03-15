const { EventEmitter } = require('events');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class CollaborationService extends EventEmitter {
  constructor(config) {
    super();
    this.port         = config.port || 9090;
    this.agentManager = config.agentManager;
    this.dataDir      = config.dataDir || path.join(os.homedir(), 'AppData', 'Roaming', 'johnny-ai-assistant', 'collab');
    this.server  = null; this.wss = null; this.running = false;
    this.clients = new Map();
    this.rooms   = new Map();
    this.files   = new Map();
    this._typingTimers = new Map();
  }

  async start() {
    if (this.running) return { port: this.port };
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    await this._loadPersistedRooms();
    this.server = http.createServer((req, res) => this._handleHttp(req, res));
    this.wss    = new WebSocket.Server({ server: this.server });
    this.wss.on('connection', (ws, req) => this._handleConnection(ws, req));
    await new Promise((resolve, reject) => {
      this.server.listen(this.port, '0.0.0.0', err => err ? reject(err) : resolve());
    });
    this.running = true;
    // Detect LAN IPs
    this._lanIPs = this._getLanIPs();
    console.log('[Collab] Running on port', this.port);
    console.log('[Collab] LAN URLs:', this._lanIPs.map(ip => `http://${ip}:${this.port}`).join(', '));
    return { port: this.port, lanIPs: this._lanIPs, urls: this._getURLs() };
  }

  _getLanIPs() {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          ips.push(net.address);
        }
      }
    }
    return ips;
  }

  _getURLs() {
    const urls = [`http://localhost:${this.port}`];
    (this._lanIPs || []).forEach(ip => urls.push(`http://${ip}:${this.port}`));
    return urls;
  }

  async stop() {
    if (!this.running) return;
    await this._persistRooms();
    this.wss?.close();
    await new Promise(r => this.server?.close(r));
    this.running = false;
  }

  _handleHttp(req, res) {
    if (req.url === '/' || req.url === '/client') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this._buildWebClient());
    } else if (req.url === '/connect') {
      // Verbindungsinfo-Seite mit QR-Code
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this._buildConnectPage());
    } else if (req.url === '/status' || req.url === '/api/info') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ...this.getStatus(), urls: this._getURLs(), lanIPs: this._lanIPs || [] }));
    } else {
      res.writeHead(404); res.end('Not found');
    }
  }

  _handleConnection(ws, req) {
    const socketId = uuidv4();
    const client = {
      ws, socketId, ip: req.socket.remoteAddress || '?',
      userId: null, name: 'Anonym', color: this._randomColor(),
      rooms: new Set(), currentRoom: null, lastSeen: Date.now()
    };
    this.clients.set(socketId, client);
    ws.on('message', raw => {
      try { client.lastSeen = Date.now(); this._handleMessage(socketId, JSON.parse(raw.toString())); }
      catch (e) { console.error('[Collab] parse error:', e.message); }
    });
    ws.on('close', () => {
      this._leaveAllRooms(socketId);
      this.clients.delete(socketId);
      this._broadcastPresence();
    });
    ws.on('error', e => console.error('[Collab] WS error:', e.message));
    this._send(ws, { type: 'connected', socketId, version: 2 });
  }

  _handleMessage(socketId, msg) {
    const client = this.clients.get(socketId);
    if (!client) return;

    switch (msg.type) {
      case 'join': {
        client.userId = msg.userId || socketId;
        client.name = (msg.name || 'User').slice(0, 32);
        if (msg.color) client.color = msg.color;
        const roomId = msg.roomId || 'general';
        const room = this.rooms.get(roomId);
        if (room && room.password && room.password !== this._hashPass(msg.password || '')) {
          this._send(client.ws, { type: 'error', code: 'WRONG_PASSWORD', message: 'Falsches Passwort' });
          return;
        }
        this._joinRoom(socketId, roomId, msg.roomName || 'Allgemein', msg.password);
        this._broadcastPresence();
        break;
      }
      case 'create_room': {
        const rid = msg.roomId || uuidv4().slice(0, 8);
        if (!this.rooms.has(rid)) this.rooms.set(rid, this._newRoom(rid, msg.roomName || 'Neuer Raum', msg.password));
        this._joinRoom(socketId, rid, msg.roomName, msg.password);
        this._broadcastPresence(); this._broadcastRoomList();
        break;
      }
      case 'chat': {
        const m = { id: uuidv4(), type: 'chat', from: client.name, color: client.color, text: msg.text, ts: Date.now(), reactions: {} };
        this._roomBroadcast(msg.roomId, m);
        this._saveRoomMessage(msg.roomId, m);
        this._clearTyping(socketId, msg.roomId);
        const agentMatch = msg.text.match(/^@(\w+)\s+([\s\S]+)/);
        if (agentMatch && this.agentManager) {
          const [, agentName, question] = agentMatch;
          this._roomBroadcast(msg.roomId, { type: 'agent_thinking', agent: agentName });
          this.agentManager.sendMessage(agentName, question).then(res => {
            const am = { id: uuidv4(), type: 'agent', agent: agentName, from: agentName, text: res.response, ts: Date.now(), reactions: {} };
            this._roomBroadcast(msg.roomId, am);
            this._saveRoomMessage(msg.roomId, am);
          }).catch(e => this._roomBroadcast(msg.roomId, { type: 'agent_error', agent: agentName, error: e.message }));
        }
        break;
      }
      case 'react': {
        const room = this.rooms.get(msg.roomId);
        if (!room) break;
        const m = room.messages.find(x => x.id === msg.messageId);
        if (!m) break;
        if (!m.reactions) m.reactions = {};
        if (!m.reactions[msg.emoji]) m.reactions[msg.emoji] = [];
        const arr = m.reactions[msg.emoji];
        const idx = arr.indexOf(client.name);
        if (idx >= 0) arr.splice(idx, 1); else arr.push(client.name);
        this._roomBroadcast(msg.roomId, { type: 'reaction_update', messageId: msg.messageId, reactions: m.reactions });
        break;
      }
      case 'typing': {
        this._roomBroadcast(msg.roomId, { type: 'typing', from: client.name, color: client.color }, socketId);
        clearTimeout(this._typingTimers.get(socketId));
        this._typingTimers.set(socketId, setTimeout(() => this._clearTyping(socketId, msg.roomId), 3000));
        break;
      }
      case 'note': {
        const room = this.rooms.get(msg.roomId);
        if (room) { room.notes = msg.content; room.notesBy = client.name; room.notesTs = Date.now(); }
        this._roomBroadcast(msg.roomId, { type: 'note', content: msg.content, from: client.name, ts: Date.now() }, socketId);
        break;
      }
      case 'code_full': {
        const room = this.rooms.get(msg.roomId);
        if (room) {
          room.code = msg.code; room.codeLang = msg.lang || room.codeLang || 'javascript';
          room.codeVersion = (room.codeVersion || 0) + 1;
          this._roomBroadcast(msg.roomId, { type: 'code_full', code: msg.code, lang: room.codeLang, version: room.codeVersion, from: client.name }, socketId);
        }
        break;
      }
      case 'kanban_add': {
        const room = this.rooms.get(msg.roomId);
        if (!room) break;
        if (!room.kanban) room.kanban = { columns: ['Ideen', 'In Arbeit', 'Review', 'Fertig'], cards: [] };
        room.kanban.cards.push({ id: uuidv4(), title: msg.title, desc: msg.desc || '', column: msg.column || room.kanban.columns[0], assignee: msg.assignee || null, color: msg.color || '#3dd6ac', createdBy: client.name, ts: Date.now(), comments: [] });
        this._roomBroadcast(msg.roomId, { type: 'kanban_update', kanban: room.kanban });
        break;
      }
      case 'kanban_move': {
        const room = this.rooms.get(msg.roomId);
        if (!room?.kanban) break;
        const card = room.kanban.cards.find(c => c.id === msg.cardId);
        if (card) { card.column = msg.column; this._roomBroadcast(msg.roomId, { type: 'kanban_update', kanban: room.kanban }); }
        break;
      }
      case 'kanban_delete': {
        const room = this.rooms.get(msg.roomId);
        if (!room?.kanban) break;
        room.kanban.cards = room.kanban.cards.filter(c => c.id !== msg.cardId);
        this._roomBroadcast(msg.roomId, { type: 'kanban_update', kanban: room.kanban });
        break;
      }
      case 'kanban_add_column': {
        const room = this.rooms.get(msg.roomId);
        if (!room?.kanban || room.kanban.columns.includes(msg.column)) break;
        room.kanban.columns.push(msg.column);
        this._roomBroadcast(msg.roomId, { type: 'kanban_update', kanban: room.kanban });
        break;
      }
      case 'poll_create': {
        const room = this.rooms.get(msg.roomId);
        if (!room) break;
        if (!room.polls) room.polls = [];
        const poll = { id: uuidv4(), question: msg.question, options: msg.options.map(o => ({ label: o, votes: [] })), createdBy: client.name, ts: Date.now(), closed: false };
        room.polls.push(poll);
        const pm = { id: uuidv4(), type: 'poll', poll, ts: Date.now(), reactions: {} };
        this._roomBroadcast(msg.roomId, pm); this._saveRoomMessage(msg.roomId, pm);
        break;
      }
      case 'poll_vote': {
        const room = this.rooms.get(msg.roomId);
        if (!room?.polls) break;
        const poll = room.polls.find(p => p.id === msg.pollId);
        if (!poll || poll.closed) break;
        poll.options.forEach(o => { o.votes = o.votes.filter(v => v !== client.name); });
        const opt = poll.options[msg.optionIndex];
        if (opt) { opt.votes.push(client.name); this._roomBroadcast(msg.roomId, { type: 'poll_update', pollId: poll.id, options: poll.options }); }
        break;
      }
      case 'file_upload': {
        const fileId = uuidv4();
        this.files.set(fileId, { id: fileId, name: msg.name, data: msg.data, uploadedBy: client.name, roomId: msg.roomId, ts: Date.now() });
        const fm = { id: uuidv4(), type: 'file', fileId, fileName: msg.name, fileSize: (msg.data||'').length, from: client.name, color: client.color, ts: Date.now(), reactions: {} };
        this._roomBroadcast(msg.roomId, fm); this._saveRoomMessage(msg.roomId, fm);
        break;
      }
      case 'file_download': {
        const file = this.files.get(msg.fileId);
        if (file) this._send(client.ws, { type: 'file_data', fileId: msg.fileId, name: file.name, data: file.data });
        break;
      }
      case 'history': {
        const room = this.rooms.get(msg.roomId);
        if (room) this._send(client.ws, { type: 'history', roomId: msg.roomId, messages: room.messages.slice(-100), notes: room.notes || '', code: room.code || '', codeLang: room.codeLang || 'javascript', codeVersion: room.codeVersion || 0, kanban: room.kanban || null, polls: room.polls || [], roomName: room.name });
        break;
      }
      case 'list_rooms': {
        const publicRooms = Array.from(this.rooms.values()).filter(r => !r.password).map(r => ({ id: r.id, name: r.name, members: r.members.size }));
        this._send(client.ws, { type: 'room_list', rooms: publicRooms });
        break;
      }
      case 'cursor':
        this._roomBroadcast(msg.roomId, { type: 'cursor', from: client.name, color: client.color, x: msg.x, y: msg.y }, socketId, true);
        break;
    }
  }

  _newRoom(id, name, password) {
    return { id, name, password: password ? this._hashPass(password) : null, members: new Set(), messages: [], notes: '', code: '// Kollaborativer Code-Editor\n// Schreibe @Johnny Frage im Chat für AI\n', codeLang: 'javascript', codeVersion: 0, kanban: { columns: ['Ideen', 'In Arbeit', 'Review', 'Fertig'], cards: [] }, polls: [], createdAt: Date.now() };
  }

  _joinRoom(socketId, roomId, roomName, password) {
    const client = this.clients.get(socketId);
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, this._newRoom(roomId, roomName || 'Raum', password));
    const room = this.rooms.get(roomId);
    room.members.add(socketId); client.rooms.add(roomId); client.currentRoom = roomId;
    this._send(client.ws, { type: 'history', roomId, messages: room.messages.slice(-100), notes: room.notes || '', code: room.code || '', codeLang: room.codeLang || 'javascript', codeVersion: room.codeVersion || 0, kanban: room.kanban || null, polls: room.polls || [], roomName: room.name });
    this._roomBroadcast(roomId, { type: 'presence', action: 'join', name: client.name, color: client.color, ts: Date.now() });
    this._send(client.ws, { type: 'joined', roomId, roomName: room.name });
  }

  _leaveAllRooms(socketId) {
    const client = this.clients.get(socketId);
    if (!client) return;
    client.rooms.forEach(roomId => {
      const room = this.rooms.get(roomId);
      if (room) { room.members.delete(socketId); this._roomBroadcast(roomId, { type: 'presence', action: 'leave', name: client.name, color: client.color, ts: Date.now() }); }
    });
    this._clearTyping(socketId, client.currentRoom);
  }

  _clearTyping(socketId, roomId) {
    const client = this.clients.get(socketId);
    clearTimeout(this._typingTimers.get(socketId));
    this._typingTimers.delete(socketId);
    if (client && roomId) this._roomBroadcast(roomId, { type: 'typing_stop', from: client.name }, socketId);
  }

  _roomBroadcast(roomId, msg, excludeSocketId = null, skipSave = false) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const json = JSON.stringify(msg);
    room.members.forEach(sid => {
      if (sid === excludeSocketId) return;
      const c = this.clients.get(sid);
      if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(json);
    });
  }

  _saveRoomMessage(roomId, msg) {
    const room = this.rooms.get(roomId);
    if (room) { room.messages.push(msg); if (room.messages.length > 500) room.messages.shift(); }
  }

  _broadcastPresence() {
    const users = Array.from(this.clients.values()).map(c => ({ name: c.name, color: c.color, rooms: Array.from(c.rooms), lastSeen: c.lastSeen }));
    const json = JSON.stringify({ type: 'presence_list', users });
    this.clients.forEach(c => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(json); });
  }

  _broadcastRoomList() {
    const rooms = Array.from(this.rooms.values()).filter(r => !r.password).map(r => ({ id: r.id, name: r.name, members: r.members.size }));
    const json = JSON.stringify({ type: 'room_list', rooms });
    this.clients.forEach(c => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(json); });
  }

  async _persistRooms() {
    try {
      const data = {};
      this.rooms.forEach((room, id) => { data[id] = { id: room.id, name: room.name, password: room.password, messages: room.messages.slice(-200), notes: room.notes, code: room.code, codeLang: room.codeLang, kanban: room.kanban, polls: room.polls, createdAt: room.createdAt }; });
      await fs.writeFile(path.join(this.dataDir, 'rooms.json'), JSON.stringify(data, null, 2));
    } catch (e) { console.error('[Collab] Persist error:', e.message); }
  }

  async _loadPersistedRooms() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'rooms.json'), 'utf8');
      Object.values(JSON.parse(raw)).forEach(r => {
        const room = this._newRoom(r.id, r.name, null);
        Object.assign(room, { password: r.password || null, messages: r.messages || [], notes: r.notes || '', code: r.code || room.code, codeLang: r.codeLang || 'javascript', kanban: r.kanban || room.kanban, polls: r.polls || [], createdAt: r.createdAt });
        this.rooms.set(r.id, room);
      });
      console.log('[Collab] Loaded', this.rooms.size, 'rooms');
    } catch (_) {}
  }

  _hashPass(p) { return crypto.createHash('sha256').update(p).digest('hex').slice(0, 16); }
  _randomColor() { return ['#3dd6ac','#f39c12','#e74c3c','#9b59b6','#3498db','#1abc9c','#e67e22','#fd79a8'][Math.floor(Math.random()*8)]; }
  _send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }

  getStatus() {
    return { running: this.running, port: this.port, clients: this.clients.size, urls: this._getURLs(), lanIPs: this._lanIPs || [], rooms: Array.from(this.rooms.values()).map(r => ({ id: r.id, name: r.name, members: r.members.size, messages: r.messages.length, hasKanban: !!(r.kanban?.cards?.length), hasCode: (r.code || '').length > 50 })) };
  }
  getRooms() { return Array.from(this.rooms.values()).map(r => ({ id: r.id, name: r.name, members: r.members.size })); }

  _buildConnectPage() {
    const urls = this._getURLs();
    const primary = urls.find(u => !u.includes('localhost')) || urls[0] || `http://localhost:${this.port}`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Johnny AI – Verbinden</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d0d0d;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{background:#111;border:1px solid #333;border-radius:20px;padding:40px;max-width:500px;width:90%;text-align:center}
h1{color:#3dd6ac;font-size:28px;margin-bottom:8px}
.sub{color:#888;font-size:14px;margin-bottom:30px}
.qr{background:#fff;border-radius:12px;padding:20px;display:inline-block;margin:20px 0}
.url{background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:12px 16px;margin:8px 0;font-family:monospace;font-size:14px;cursor:pointer;transition:border-color .2s}
.url:hover{border-color:#3dd6ac}
.label{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-top:16px;margin-bottom:6px}
.tip{color:#888;font-size:12px;margin-top:20px;line-height:1.6}
.btn{background:#3dd6ac;color:#000;border:none;border-radius:8px;padding:10px 24px;font-weight:700;font-size:14px;cursor:pointer;margin-top:16px;text-decoration:none;display:inline-block}
.btn:hover{background:#45e8be}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
</head><body>
<div class="box">
<h1>🤖 Johnny Collaboration</h1>
<div class="sub">Scanne den QR-Code oder öffne einen Link auf deinem Gerät</div>
<div class="qr" id="qr"></div>
<div class="label">Verbindungs-URLs</div>
${urls.map(u => `<div class="url" onclick="navigator.clipboard.writeText('${u}').then(()=>this.style.borderColor='#3dd6ac')">${u}</div>`).join('')}
<div class="tip">💡 Klicke auf eine URL zum Kopieren. Alle Geräte im gleichen Netzwerk können beitreten.<br>
Für Zugriff von außerhalb: Nutze einen Cloudflare-Tunnel in Johnny.</div>
<a href="/" class="btn">→ Direkt zum Client</a>
</div>
<script>
new QRCode(document.getElementById('qr'), { text: '${primary}', width: 200, height: 200, colorDark: '#000', colorLight: '#fff' });
</script>
</body></html>`;
  }

  _buildWebClient() {
    // HTML wird aus externer Datei geladen — wartungsfreundlicher als inline string
    const htmlPath = require('path').join(__dirname, '..', '..', 'public', 'collab-client.html');
    try {
      return require('fs').readFileSync(htmlPath, 'utf-8');
    } catch (e) {
      console.warn('[Collab] collab-client.html nicht gefunden, nutze Fallback');
      return '<!DOCTYPE html><html><body><h1>Collaboration Client nicht verfügbar</h1><p>Datei fehlt: ' + htmlPath + '</p></body></html>';
    }
  }
}
module.exports = CollaborationService;
