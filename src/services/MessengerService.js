const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * MessengerService – Vollständige Integration aller Messenger-Dienste
 *
 * Unterstützte Messenger:
 *  - WhatsApp   (whatsapp-web.js, QR-Code an UI)
 *  - Signal     (signal-cli JSON-RPC Daemon)
 *  - Discord    (discord.js v14)
 *  - Slack      (@slack/bolt, Socket Mode)
 *  - Matrix     (matrix-js-sdk)
 *  - Telegram   (separat in TelegramService.js)
 */
class MessengerService {
  constructor(config) {
    this.agentManager = config.agentManager;
    this.dataDir      = config.dataDir;
    this.store        = config.store || null;   // electron-store für Auth-Whitelist
    this.messengers   = new Map();   // name → client
    this.connections  = new Map();   // name → saved config
    this._statusCache = new Map();   // name → { status, info, error, ts }
    this._userQueues  = new Map();   // convId → Promise — serialisiert Nachrichten pro User
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ UNIVERSAL AUTH ██
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Prüft ob ein Sender Zugriff hat.
   * Whitelist-Key pro Messenger: settings.messengerAllowedUsers.<messenger> = [id, id, ...]
   * Global-Bypass:               settings.messengerAllowAll = true  (Dev-Modus)
   *
   * @param {string} messenger   z.B. 'discord', 'whatsapp', 'slack'
   * @param {string} senderId    plattform-spezifische ID (userId, Nummer, etc.)
   * @returns {boolean}
   */
  _isAllowed(messenger, senderId) {
    if (!this.store) return true; // Kein Store → kein Auth (abwärtskompatibel)

    // Dev-Bypass: alle erlaubt
    if (this.store.get('settings.messengerAllowAll')) return true;

    const key     = `settings.messengerAllowedUsers.${messenger}`;
    const allowed = this.store.get(key) || [];

    // Keine Whitelist → Log + ablehnen
    if (allowed.length === 0) {
      console.warn(`[MessengerService] ${messenger}: Keine Whitelist konfiguriert. Sender ${senderId} abgewiesen.`);
      return false;
    }

    return allowed.includes(senderId) || allowed.includes(String(senderId));
  }

  /**
   * Baut eine Ablehnung-Nachricht zusammen (mit Sender-ID zum einfachen Whitelisten).
   */
  _denyText(messenger, senderId) {
    return `🔒 Zugriff verweigert.\n` +
      `Dieser Johnny-Bot ist privat.\n` +
      `Deine ${messenger}-ID: ${senderId}\n\n` +
      `Trage sie in Johnny-Settings → Messenger → ${messenger} Whitelist ein.`;
  }

  async initialize() {
    console.log('Initializing Messenger Service...');
    await fs.mkdir(this.dataDir, { recursive: true });
    await this.loadConnections();
    console.log('Messenger Service initialized');
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ WHATSAPP ██
  // ══════════════════════════════════════════════════════════════════════
  async connectWhatsApp(config = {}) {
    const { sessionName = 'johnny-whatsapp', agentName = 'Johnny' } = config;
    console.log('[WhatsApp] Connecting...');
    this._setStatus('whatsapp', 'connecting', 'QR-Code wird generiert...');

    let Client, LocalAuth;
    try {
      const ww = require('whatsapp-web.js');
      Client = ww.Client;
      LocalAuth = ww.LocalAuth;
    } catch (e) {
      const err = 'whatsapp-web.js nicht installiert. Bitte: npm install whatsapp-web.js';
      this._setStatus('whatsapp', 'error', err);
      throw new Error(err);
    }

    const sessDir = path.join(this.dataDir, 'whatsapp-sessions');
    await fs.mkdir(sessDir, { recursive: true });

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionName, dataPath: sessDir }),
      puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
    });

    // QR Code → UI als Base64-String (für <img> oder QR-Renderer)
    client.on('qr', (qr) => {
      console.log('[WhatsApp] QR Code received');
      // Sende QR-String an UI → dort als QR-Code-Image rendern
      this.sendToUI('whatsapp-qr', { qr, sessionName });
      this._setStatus('whatsapp', 'qr', 'Scanne den QR-Code mit WhatsApp');
      // Auch Terminal-Ausgabe als Fallback
      try { const qrt = require('qrcode-terminal'); qrt.generate(qr, { small: true }); } catch (_) {}
    });

    client.on('authenticated', () => {
      console.log('[WhatsApp] Authenticated');
      this._setStatus('whatsapp', 'authenticated', 'Authentifiziert, verbinde...');
      this.sendToUI('whatsapp-authenticated', { sessionName });
    });

    client.on('auth_failure', (msg) => {
      console.error('[WhatsApp] Auth failure:', msg);
      this._setStatus('whatsapp', 'error', 'Authentifizierung fehlgeschlagen: ' + msg);
      this.sendToUI('whatsapp-error', { error: 'Auth failure: ' + msg });
    });

    client.on('ready', () => {
      const info = client.info || {};
      console.log('[WhatsApp] Ready! Number:', info.wid?.user || '?');
      this._setStatus('whatsapp', 'connected', info.wid?.user || 'Verbunden');
      this.sendToUI('whatsapp-ready', { sessionName, phone: info.wid?.user });
    });

    client.on('disconnected', (reason) => {
      console.log('[WhatsApp] Disconnected:', reason);
      this._setStatus('whatsapp', 'disconnected', reason);
      this.messengers.delete('whatsapp');
      this.sendToUI('whatsapp-disconnected', { reason });
    });

    client.on('message', async (msg) => {
      if (msg.fromMe) return;
      if (!msg.body || !msg.body.trim()) return;
      const senderId = msg.from; // Format: '491701234567@c.us'
      if (!this._isAllowed('whatsapp', senderId)) {
        await msg.reply(this._denyText('whatsapp', senderId)).catch(() => {});
        return;
      }
      await this._handleIncoming('whatsapp', senderId, msg.body, agentName, async (reply) => {
        await msg.reply(reply);
      });
    });

    try {
      await client.initialize();
    } catch (e) {
      this._setStatus('whatsapp', 'error', e.message);
      throw e;
    }

    this.messengers.set('whatsapp', client);
    await this.saveConnection('whatsapp', { sessionName, agentName });
    return { messenger: 'whatsapp', status: 'initializing', sessionName };
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ SIGNAL ██
  // ══════════════════════════════════════════════════════════════════════
  async connectSignal(config = {}) {
    const { phoneNumber, agentName = 'Johnny' } = config;
    if (!phoneNumber) throw new Error('Signal: Telefonnummer erforderlich (z.B. +491701234567)');
    console.log('[Signal] Connecting with', phoneNumber);
    this._setStatus('signal', 'connecting', 'Verbinde mit signal-cli...');

    // Prüfe signal-cli
    try {
      const { stdout } = await execAsync('signal-cli --version', { timeout: 5000 });
      console.log('[Signal] signal-cli found:', stdout.trim());
    } catch (e) {
      const err = 'signal-cli nicht gefunden. Installation: https://github.com/AsamK/signal-cli/releases';
      this._setStatus('signal', 'error', err);
      throw new Error(err);
    }

    // Prüfe ob Nummer registriert ist
    try {
      await execAsync(`signal-cli -a ${phoneNumber} listContacts`, { timeout: 10000 });
      console.log('[Signal] Account verified');
    } catch (e) {
      // Könnte unregistriert sein — Hinweis geben
      console.warn('[Signal] Account check failed (may need registration):', e.message);
      this._setStatus('signal', 'warning',
        'Account möglicherweise nicht registriert. Erst: signal-cli -a ' + phoneNumber + ' register → verify');
    }

    // JSON-RPC Daemon starten
    const daemon = spawn('signal-cli', ['-a', phoneNumber, 'jsonRpc'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let buffer = '';
    daemon.stdout.on('data', (data) => {
      buffer += data.toString();
      // JSON-RPC liefert zeilenweise JSON
      const lines = buffer.split('\n');
      buffer = lines.pop(); // letztes unvollständiges Fragment behalten
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this._handleSignalJsonRpc(msg, phoneNumber, agentName);
        } catch (e) {
          // Nicht-JSON output (z.B. Logs) → ignorieren
        }
      }
    });

    daemon.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) console.log('[Signal stderr]', text.slice(0, 200));
      // Linked-Device QR könnte hier erscheinen
      if (text.includes('sgnl://linkdevice')) {
        this.sendToUI('signal-link', { linkUri: text.match(/sgnl:\/\/[^\s]+/)?.[0] || text });
      }
    });

    daemon.on('error', (err) => {
      console.error('[Signal] Daemon error:', err.message);
      this._setStatus('signal', 'error', err.message);
    });

    daemon.on('exit', (code) => {
      console.log('[Signal] Daemon exited with code', code);
      this._setStatus('signal', 'disconnected', 'Daemon beendet (Code ' + code + ')');
      this.messengers.delete('signal');
    });

    this.messengers.set('signal', { daemon, phoneNumber, agentName });
    this._setStatus('signal', 'connected', phoneNumber);
    await this.saveConnection('signal', { phoneNumber, agentName });
    return { messenger: 'signal', status: 'connected', phoneNumber };
  }

  _handleSignalJsonRpc(msg, phoneNumber, agentName) {
    // JSON-RPC Notification: method = "receive"
    if (msg.method === 'receive' && msg.params) {
      const env = msg.params.envelope;
      if (!env) return;
      const dataMsg = env.dataMessage;
      if (!dataMsg || !dataMsg.message) return;
      const sender = env.source || env.sourceNumber;
      if (!sender || sender === phoneNumber) return;

      if (!this._isAllowed('signal', sender)) {
        // Signal antworten ist async per CLI - ignorieren für unauth sender
        console.warn('[Signal] Unauth sender:', sender);
        return;
      }
      this._handleIncoming('signal', sender, dataMsg.message, agentName, async (reply) => {
        // Sende via signal-cli send
        const escaped = reply.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        try {
          await execAsync(
            `signal-cli -a "${phoneNumber}" send -m "${escaped}" "${sender}"`,
            { timeout: 30000 }
          );
        } catch (e) {
          console.error('[Signal] Send failed:', e.message);
        }
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ DISCORD ██
  // ══════════════════════════════════════════════════════════════════════
  async connectDiscord(config = {}) {
    const { token, agentName = 'Johnny' } = config;
    if (!token) throw new Error('Discord: Bot-Token erforderlich (von discord.com/developers)');
    console.log('[Discord] Connecting...');
    this._setStatus('discord', 'connecting', 'Verbinde...');

    let DiscordClient, GatewayIntentBits, ChannelType, Partials;
    try {
      const djs = require('discord.js');
      DiscordClient = djs.Client;
      GatewayIntentBits = djs.GatewayIntentBits;
      ChannelType = djs.ChannelType;
      Partials = djs.Partials;
    } catch (e) {
      const err = 'discord.js nicht installiert. Bitte: npm install discord.js';
      this._setStatus('discord', 'error', err);
      throw new Error(err);
    }

    const client = new DiscordClient({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ],
      partials: [Partials.Channel] // nötig damit DMs ohne Cache funktionieren
    });

    client.on('ready', () => {
      console.log(`[Discord] Connected as ${client.user.tag}`);
      this._setStatus('discord', 'connected', client.user.tag);
      this.sendToUI('discord-ready', { username: client.user.tag, id: client.user.id });
    });

    client.on('error', (err) => {
      console.error('[Discord] Error:', err.message);
      this._setStatus('discord', 'error', err.message);
    });

    client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      // Reagiere nur auf DMs oder wenn Bot erwähnt wird
      const isDM = message.channel.type === ChannelType.DM;
      const isMentioned = message.mentions?.has(message.client.user);
      if (!isDM && !isMentioned) return;

      const text = message.content.replace(/<@!?\d+>/g, '').trim();
      if (!text) return;

      await message.channel.sendTyping();
      if (!this._isAllowed('discord', message.author.id)) {
        await message.reply(this._denyText('discord', message.author.id)).catch(() => {});
        return;
      }
      await this._handleIncoming('discord', message.author.id, text, agentName, async (reply) => {
        // Discord max 2000 chars
        if (reply.length <= 2000) {
          await message.reply(reply);
        } else {
          const chunks = reply.match(/.{1,1990}/gs) || [reply];
          for (const chunk of chunks) await message.channel.send(chunk);
        }
      });
    });

    try {
      await client.login(token);
    } catch (e) {
      this._setStatus('discord', 'error', 'Login fehlgeschlagen: ' + e.message);
      throw e;
    }

    this.messengers.set('discord', client);
    await this.saveConnection('discord', { token: token.slice(0, 8) + '...', agentName }); // Token nicht voll speichern
    return { messenger: 'discord', status: 'connected', username: client.user?.tag };
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ SLACK ██
  // ══════════════════════════════════════════════════════════════════════
  async connectSlack(config = {}) {
    const { botToken, appToken, agentName = 'Johnny', channelFilter } = config;
    if (!botToken) throw new Error('Slack: Bot-Token erforderlich (xoxb-...)');
    if (!appToken) throw new Error('Slack: App-Level-Token erforderlich (xapp-...) für Socket Mode');
    console.log('[Slack] Connecting...');
    this._setStatus('slack', 'connecting', 'Verbinde via Socket Mode...');

    let App;
    try {
      App = require('@slack/bolt').App;
    } catch (e) {
      const err = '@slack/bolt nicht installiert. Bitte: npm install @slack/bolt';
      this._setStatus('slack', 'error', err);
      throw new Error(err);
    }

    const app = new App({
      token: botToken,
      appToken: appToken,
      socketMode: true,
      logLevel: 'warn'
    });

    // Auf Nachrichten reagieren (DMs und Erwähnungen)
    app.message(async ({ message, say, client: slackClient }) => {
      if (message.bot_id || message.subtype) return;
      const text = message.text;
      if (!text || !text.trim()) return;

      // Channel-Filter: nur bestimmte Channels (optional)
      if (channelFilter && !channelFilter.includes(message.channel)) return;

      if (!this._isAllowed('slack', message.user)) {
        await say({ text: this._denyText('slack', message.user) });
        return;
      }
      await this._handleIncoming('slack', message.user, text, agentName, async (reply) => {
        await say({ text: reply, thread_ts: message.thread_ts || message.ts });
      });
    });

    // App-Mentions (@Johnny in Channels)
    app.event('app_mention', async ({ event, say }) => {
      const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!text) return;
      if (!this._isAllowed('slack', event.user)) {
        await say({ text: this._denyText('slack', event.user) });
        return;
      }
      await this._handleIncoming('slack', event.user, text, agentName, async (reply) => {
        await say({ text: reply, thread_ts: event.thread_ts || event.ts });
      });
    });

    try {
      await app.start();
      console.log('[Slack] Connected via Socket Mode');
      // Bot-Info holen
      let botName = 'Slack Bot';
      try {
        const authRes = await app.client.auth.test({ token: botToken });
        botName = authRes.user || authRes.bot_id || 'Slack Bot';
        console.log('[Slack] Bot:', botName);
      } catch (_) {}
      this._setStatus('slack', 'connected', botName);
      this.sendToUI('slack-ready', { botName });
    } catch (e) {
      this._setStatus('slack', 'error', e.message);
      throw e;
    }

    this.messengers.set('slack', app);
    await this.saveConnection('slack', { botToken: botToken.slice(0, 10) + '...', agentName });
    return { messenger: 'slack', status: 'connected' };
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ MATRIX ██
  // ══════════════════════════════════════════════════════════════════════
  async connectMatrix(config = {}) {
    const { homeserver, userId, accessToken, password, agentName = 'Johnny', autoJoin = true } = config;
    if (!homeserver) throw new Error('Matrix: Homeserver-URL erforderlich (z.B. https://matrix.org)');
    console.log('[Matrix] Connecting to', homeserver);
    this._setStatus('matrix', 'connecting', homeserver);

    let sdk;
    try {
      sdk = require('matrix-js-sdk');
    } catch (e) {
      const err = 'matrix-js-sdk nicht installiert. Bitte: npm install matrix-js-sdk';
      this._setStatus('matrix', 'error', err);
      throw new Error(err);
    }

    let matrixClient;
    let myUserId = userId;

    if (accessToken && userId) {
      // Direkt mit Access-Token verbinden
      matrixClient = sdk.createClient({
        baseUrl: homeserver,
        accessToken: accessToken,
        userId: userId
      });
    } else if (userId && password) {
      // Login mit Username+Passwort
      const tempClient = sdk.createClient({ baseUrl: homeserver });
      try {
        const loginRes = await tempClient.login('m.login.password', {
          user: userId,
          password: password
        });
        myUserId = loginRes.user_id;
        matrixClient = sdk.createClient({
          baseUrl: homeserver,
          accessToken: loginRes.access_token,
          userId: myUserId
        });
        console.log('[Matrix] Logged in as', myUserId);
        // Access-Token für späteres Reconnect speichern
        config._accessToken = loginRes.access_token;
      } catch (e) {
        this._setStatus('matrix', 'error', 'Login fehlgeschlagen: ' + e.message);
        throw e;
      }
    } else {
      throw new Error('Matrix: Entweder accessToken+userId oder userId+password erforderlich');
    }

    // Auto-Join bei Einladungen
    if (autoJoin) {
      matrixClient.on('RoomMember.membership', (event, member) => {
        if (member.membership === 'invite' && member.userId === myUserId) {
          matrixClient.joinRoom(member.roomId).then(() => {
            console.log('[Matrix] Auto-joined room:', member.roomId);
          }).catch(e => console.warn('[Matrix] Auto-join failed:', e.message));
        }
      });
    }

    // Nachrichten empfangen
    matrixClient.on('Room.timeline', async (event, room, toStartOfTimeline) => {
      if (toStartOfTimeline) return; // Alte Nachrichten ignorieren
      if (event.getType() !== 'm.room.message') return;
      if (event.getSender() === myUserId) return;

      const content = event.getContent();
      const text = content.body;
      if (!text || content.msgtype !== 'm.text') return;

      const sender = event.getSender();
      const roomId = room.roomId;

      if (!this._isAllowed('matrix', sender)) {
        await matrixClient.sendTextMessage(roomId, this._denyText('matrix', sender)).catch(() => {});
        return;
      }

      await this._handleIncoming('matrix', sender, text, agentName, async (reply) => {
        try {
          await matrixClient.sendTextMessage(roomId, reply);
        } catch (e) {
          console.error('[Matrix] Send failed:', e.message);
        }
      });
    });

    matrixClient.on('sync', (state) => {
      if (state === 'PREPARED') {
        console.log('[Matrix] Synced and ready');
        this._setStatus('matrix', 'connected', myUserId);
        this.sendToUI('matrix-ready', { userId: myUserId, homeserver });
      } else if (state === 'ERROR') {
        this._setStatus('matrix', 'error', 'Sync-Fehler');
      }
    });

    try {
      await matrixClient.startClient({ initialSyncLimit: 0 });
    } catch (e) {
      this._setStatus('matrix', 'error', e.message);
      throw e;
    }

    this.messengers.set('matrix', { client: matrixClient, userId: myUserId });
    await this.saveConnection('matrix', { homeserver, userId: myUserId, agentName });
    return { messenger: 'matrix', status: 'connected', userId: myUserId };
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ GENERISCHE NACHRICHTENBEHANDLUNG ██
  // ══════════════════════════════════════════════════════════════════════
  async _handleIncoming(messenger, senderId, text, agentName, replyFn) {
    // v1.8.6: Stabile convId pro User-Plattform-Kombination.
    // Format: "<messenger>-<senderId>" — eindeutig, persistent, keine Kollisionen.
    const convId = `${messenger}-${senderId}`;
    console.log(`[${messenger}] ← ${senderId}: ${text.slice(0, 80)}`);

    // Serialisierter Queue pro convId — verhindert Race-Conditions bei
    // simultanen Nachrichten desselben Users (z.B. schnelles Tippen auf WhatsApp)
    const prev = this._userQueues.get(convId) || Promise.resolve();
    const next = prev.then(async () => {
      try {
        const response = await this.agentManager.sendMessage(
          agentName, text, convId,
          { userId: senderId }   // userId für JohnnyCore-Kontext
        );
        const reply = response.response || 'Entschuldigung, ich konnte nicht antworten.';
        await replyFn(reply);
      } catch (error) {
        console.error(`[${messenger}] Error handling message from ${senderId}:`, error);
        try {
          await replyFn('⚠️ Entschuldigung, es gab einen Fehler: ' + (error.message || 'Unbekannt'));
        } catch (_) {}
      }
    });

    // Queue aufräumen wenn idle (verhindert Memory-Leak bei langer Laufzeit)
    this._userQueues.set(convId, next.finally(() => {
      if (this._userQueues.get(convId) === next) {
        this._userQueues.delete(convId);
      }
    }));

    return next;
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ SEND MESSAGE (aktiv an Messenger senden) ██
  // ══════════════════════════════════════════════════════════════════════
  async sendMessage(messenger, recipient, message) {
    const client = this.messengers.get(messenger);
    if (!client) throw new Error(`${messenger} nicht verbunden`);

    switch (messenger) {
      case 'whatsapp': {
        const chatId = recipient.includes('@c.us') ? recipient : `${recipient}@c.us`;
        await client.sendMessage(chatId, message);
        break;
      }
      case 'signal': {
        const escaped = message.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        await execAsync(`signal-cli -a "${client.phoneNumber}" send -m "${escaped}" "${recipient}"`, { timeout: 30000 });
        break;
      }
      case 'discord': {
        const user = await client.users.fetch(recipient);
        const dm = await user.createDM();
        await dm.send(message);
        break;
      }
      case 'slack': {
        await client.client.chat.postMessage({ channel: recipient, text: message });
        break;
      }
      case 'matrix': {
        await client.client.sendTextMessage(recipient, message);
        break;
      }
      default:
        throw new Error(`Send nicht unterstützt für: ${messenger}`);
    }
    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ CONNECTION MANAGEMENT ██
  // ══════════════════════════════════════════════════════════════════════
  async disconnect(messenger) {
    const client = this.messengers.get(messenger);
    if (!client) return;

    console.log(`[${messenger}] Disconnecting...`);
    try {
      switch (messenger) {
        case 'whatsapp':
          await client.destroy();
          break;
        case 'signal':
          if (client.daemon) { client.daemon.kill('SIGTERM'); }
          break;
        case 'discord':
          await client.destroy();
          break;
        case 'slack':
          await client.stop();
          break;
        case 'matrix':
          if (client.client) client.client.stopClient();
          break;
      }
    } catch (e) {
      console.warn(`[${messenger}] Disconnect error:`, e.message);
    }

    this.messengers.delete(messenger);
    this._setStatus(messenger, 'disconnected', '');
    console.log(`[${messenger}] Disconnected`);
  }

  async saveConnection(messenger, config) {
    try {
      const connections = await this._loadConnectionsFile();
      connections[messenger] = { ...config, connected: new Date().toISOString() };
      await fs.writeFile(
        path.join(this.dataDir, 'connections.json'),
        JSON.stringify(connections, null, 2), 'utf-8'
      );
    } catch (e) {
      console.warn('[Messenger] Save connection error:', e.message);
    }
  }

  async loadConnections() {
    const connections = await this._loadConnectionsFile();
    for (const [name, config] of Object.entries(connections)) {
      this.connections.set(name, config);
    }
  }

  async _loadConnectionsFile() {
    try {
      const data = await fs.readFile(path.join(this.dataDir, 'connections.json'), 'utf-8');
      return JSON.parse(data);
    } catch (_) { return {}; }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ STATUS ██
  // ══════════════════════════════════════════════════════════════════════
  _setStatus(messenger, status, info) {
    this._statusCache.set(messenger, { status, info, ts: Date.now() });
  }

  getStatus() {
    const result = [];
    // Verbundene Messenger
    for (const [name] of this.messengers) {
      const cached = this._statusCache.get(name) || {};
      result.push({
        messenger: name,
        connected: true,
        status: cached.status || 'connected',
        info: cached.info || '',
        ts: cached.ts
      });
    }
    // Nicht verbundene aber bekannte
    for (const [name] of this._statusCache) {
      if (!this.messengers.has(name)) {
        const cached = this._statusCache.get(name);
        result.push({
          messenger: name,
          connected: false,
          status: cached.status || 'disconnected',
          info: cached.info || '',
          ts: cached.ts
        });
      }
    }
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██ BROADCAST ██
  // ══════════════════════════════════════════════════════════════════════
  async broadcastMessage(message, targets = null) {
    const messengers = targets || Array.from(this.messengers.keys());
    const results = [];
    for (const name of messengers) {
      if (!this.messengers.has(name)) {
        results.push({ messenger: name, success: false, error: 'nicht verbunden' });
        continue;
      }
      // Broadcast-Logik hängt vom Messenger ab
      results.push({ messenger: name, success: true, note: 'Broadcast nicht für alle Messenger implementiert' });
    }
    return results;
  }

  sendToUI(event, data) {
    if (typeof global._messengerUICallback === 'function') {
      global._messengerUICallback(event, data);
    }
  }
}

module.exports = MessengerService;
