const TelegramBot = require('node-telegram-bot-api');
const logger = require('../core/Logger');

/**
 * TelegramService v1.1
 *
 * NEU: User-Authentifizierung via Whitelist.
 * Nur Telegram-User-IDs die in settings.telegramAllowedUsers eingetragen
 * sind, dürfen Johnny steuern. Alle anderen erhalten eine Ablehnung.
 *
 * Konfiguration (electron-store):
 *   settings.telegramAllowedUsers = [123456789, 987654321]  ← Telegram user IDs
 *   settings.telegramAllowAll     = false                    ← auf true = keine Auth (Dev-Modus)
 */
class TelegramService {
  constructor(config) {
    this.token        = config.token;
    this.agentManager = config.agentManager;
    this.primaryAgent = config.primaryAgent || 'Johnny';
    this.store        = config.store || null;
    this.bot          = null;
    this.userSessions = new Map();  // chatId → { currentAgent, conversationId }
    this._msgQueue    = new Map();  // chatId → Promise (Concurrency-Lock pro User)
  }

  // ── Auth-Check ────────────────────────────────────────────────────────────

  _isAllowed(msg) {
    // Dev-Modus: alle erlaubt
    if (this.store && this.store.get('settings.telegramAllowAll')) return true;

    const allowedIds = this.store
      ? (this.store.get('settings.telegramAllowedUsers') || [])
      : [];

    // Keine Whitelist konfiguriert → nur Besitzer-Warnung, kein Zugriff
    if (allowedIds.length === 0) {
      logger.warn('Telegram', `Kein Telegram-Whitelist konfiguriert. Nachricht von User ${msg.from?.id} ignoriert.`);
      return false;
    }

    return allowedIds.includes(msg.from?.id) || allowedIds.includes(String(msg.from?.id));
  }

  _denyMessage(chatId) {
    return this.bot.sendMessage(chatId,
      '🔒 Zugriff verweigert.\n\nDieser Bot ist privat konfiguriert.\n' +
      'Deine Telegram-ID: ' + chatId + '\n\n' +
      'Trage sie in den Johnny-Einstellungen unter Messenger → Telegram Whitelist ein.'
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async initialize() {
    if (!this.token) {
      logger.info('Telegram', 'Kein Token, Service übersprungen');
      return;
    }

    this.bot = new TelegramBot(this.token, { polling: true });

    // Alle Commands prüfen Auth
    this.bot.onText(/\/start/, (msg)           => this._guarded(msg, () => this.handleStart(msg)));
    this.bot.onText(/\/help/,  (msg)           => this._guarded(msg, () => this.handleHelp(msg)));
    this.bot.onText(/\/agents/,(msg)           => this._guarded(msg, () => this.handleAgents(msg)));
    this.bot.onText(/\/switch (.+)/, (msg, m)  => this._guarded(msg, () => this.handleSwitch(msg, m)));
    this.bot.onText(/\/status/, (msg)          => this._guarded(msg, () => this.handleStatus(msg)));
    this.bot.onText(/\/clear/,  (msg)          => this._guarded(msg, () => this.handleClear(msg)));

    this.bot.on('message', (msg) => {
      if (msg.text && !msg.text.startsWith('/')) {
        this._guarded(msg, () => this.handleMessage(msg));
      }
    });

    logger.info('Telegram', 'Bot bereit');
    const allowed = this.store?.get('settings.telegramAllowedUsers') || [];
    if (allowed.length === 0) {
      logger.warn('Telegram', '⚠️  Kein telegramAllowedUsers konfiguriert — alle Nachrichten werden abgewiesen!');
    } else {
      logger.info('Telegram', `Whitelist: ${allowed.length} autorisierte User`);
    }
  }

  // ── Auth-Wrapper + serialisierte Verarbeitung pro User ───────────────────

  _guarded(msg, fn) {
    if (!this._isAllowed(msg)) {
      this._denyMessage(msg.chat.id).catch(() => {});
      logger.warn('Telegram', `Unauth Zugriff: User ${msg.from?.id} (${msg.from?.username || '?'})`);
      return;
    }
    // Serialisierter Queue pro chatId — verhindert Race Conditions
    const chatId = msg.chat.id;
    const prev   = this._msgQueue.get(chatId) || Promise.resolve();
    const next   = prev.then(() => fn()).catch(e =>
      logger.error('Telegram', `Fehler in Handler: ${e.message}`)
    );
    this._msgQueue.set(chatId, next);
    // Queue aufräumen
    next.finally(() => {
      if (this._msgQueue.get(chatId) === next) this._msgQueue.delete(chatId);
    });
  }

  // ── Handler ───────────────────────────────────────────────────────────────

  async handleStart(msg) {
    const chatId = msg.chat.id;
    this.userSessions.set(chatId, { currentAgent: this.primaryAgent, conversationId: null });
    await this.bot.sendMessage(chatId,
      `🤖 Hallo ${msg.from?.first_name || 'User'}! Ich bin *${this.primaryAgent}*.\n\n` +
      `Schreib einfach drauflos — ich helfe dir rund um die Uhr.\n\n` +
      `/help — alle Befehle`,
      { parse_mode: 'Markdown' }
    );
  }

  async handleHelp(msg) {
    await this.bot.sendMessage(msg.chat.id,
      `📚 *Befehle*\n\n` +
      `/start — Neue Session starten\n` +
      `/agents — Alle Agenten anzeigen\n` +
      `/switch <Name> — Agenten wechseln\n` +
      `/status — Aktuellen Status anzeigen\n` +
      `/clear — Konversation zurücksetzen\n` +
      `/help — Diese Hilfe`,
      { parse_mode: 'Markdown' }
    );
  }

  async handleAgents(msg) {
    const agents = await this.agentManager.getAgents();
    const session = this.userSessions.get(msg.chat.id);
    const list = agents.map(a =>
      `${a.name === session?.currentAgent ? '✅' : '•'} *${a.name}* — ${a.role}`
    ).join('\n');
    await this.bot.sendMessage(msg.chat.id,
      `🤖 *Agenten*\n\n${list}\n\nWechseln: /switch Name`,
      { parse_mode: 'Markdown' }
    );
  }

  async handleSwitch(msg, match) {
    const chatId    = msg.chat.id;
    const agentName = match[1].trim();
    const agents    = await this.agentManager.getAgents();
    const agent     = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
    if (agent) {
      const session = this.userSessions.get(chatId) || {};
      session.currentAgent   = agent.name;
      session.conversationId = null;
      this.userSessions.set(chatId, session);
      await this.bot.sendMessage(chatId, `✅ Gewechselt zu *${agent.name}*`, { parse_mode: 'Markdown' });
    } else {
      await this.bot.sendMessage(chatId, `❌ Agent "${agentName}" nicht gefunden. Nutze /agents.`);
    }
  }

  async handleStatus(msg) {
    const session = this.userSessions.get(msg.chat.id);
    const agent   = session?.currentAgent || this.primaryAgent;
    const convId  = session?.conversationId ? session.conversationId.slice(0, 8) + '...' : 'neu';
    await this.bot.sendMessage(msg.chat.id,
      `📊 *Status*\n\nAgent: *${agent}*\nKonversation: \`${convId}\``,
      { parse_mode: 'Markdown' }
    );
  }

  async handleClear(msg) {
    const chatId = msg.chat.id;
    const session = this.userSessions.get(chatId) || {};
    session.conversationId = null;
    this.userSessions.set(chatId, session);
    await this.bot.sendMessage(chatId, '🗑️ Konversation zurückgesetzt. Frischer Start!');
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const text   = msg.text;

    let session = this.userSessions.get(chatId);
    if (!session) {
      session = { currentAgent: this.primaryAgent, conversationId: null };
      this.userSessions.set(chatId, session);
    }

    try {
      await this.bot.sendChatAction(chatId, 'typing');

      // Injection-Scan auf eingehende Nachrichten
      const agentMgr = this.agentManager;
      let safeText = text;
      if (agentMgr.security) {
        const scan = agentMgr.security.scanForInjection(text, 'telegram');
        if (!scan.safe) {
          logger.warn('Telegram', `Injection-Versuch von User ${msg.from?.id}: ${scan.threats.length} Pattern`);
          safeText = scan.sanitized;
        }
      }

      const response = await agentMgr.sendMessage(
        session.currentAgent,
        safeText,
        session.conversationId,
        { userId: String(msg.from?.id || chatId) }
      );

      session.conversationId = response.conversationId;

      // Telegram-Limit: 4096 Zeichen pro Nachricht
      const text_out = response.response || '(keine Antwort)';
      if (text_out.length <= 4000) {
        await this.bot.sendMessage(chatId, text_out, { parse_mode: 'Markdown' })
          .catch(() => this.bot.sendMessage(chatId, text_out)); // Fallback ohne Markdown
      } else {
        // Aufteilen in Chunks
        for (let i = 0; i < text_out.length; i += 4000) {
          await this.bot.sendMessage(chatId, text_out.slice(i, i + 4000));
        }
      }

    } catch (error) {
      logger.error('Telegram', `Fehler bei Nachricht: ${error.message}`);
      await this.bot.sendMessage(chatId, `❌ Fehler: ${error.message}`);
    }
  }

  async stop() {
    if (this.bot) {
      await this.bot.stopPolling();
      logger.info('Telegram', 'Bot gestoppt');
    }
  }
}

module.exports = TelegramService;
