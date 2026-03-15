const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

/**
 * CDPBrowserService – Chrome DevTools Protocol Browser-Kontrolle
 *
 * Alternative/Ergänzung zu Puppeteer-basiertem BrowserAutomationService:
 *  - Verbindet sich mit laufendem Chrome via CDP (kein extra Browser nötig)
 *  - Leichtgewichtiger (kein Puppeteer/Chromium Download)
 *  - Live-Browser-Kontrolle (nicht headless)
 *  - Screenshot, Navigation, JS-Ausführung, DOM-Manipulation
 *  - Tab-Management
 *
 * Voraussetzung: Chrome muss mit --remote-debugging-port=9222 gestartet sein
 */
class CDPBrowserService {
  constructor(config = {}) {
    this.cdpHost        = config.cdpHost || '127.0.0.1';
    this.cdpPort        = config.cdpPort || 9222;
    this.screenshotsDir = config.screenshotsDir || path.join(os.tmpdir(), 'johnny-cdp');
    this.chromeProcess  = null;
    this.connected      = false;
  }

  async initialize() {
    await fs.mkdir(this.screenshotsDir, { recursive: true });

    // Teste ob Chrome mit CDP erreichbar ist
    try {
      const tabs = await this._cdpGet('/json');
      this.connected = true;
      console.log(`[CDP] Connected to Chrome: ${tabs.length} tabs`);
    } catch (e) {
      console.log('[CDP] Chrome nicht erreichbar. Starte mit: chrome --remote-debugging-port=9222');
      this.connected = false;
    }
  }

  // ── Chrome starten ────────────────────────────────────────────────
  async launchChrome(url = 'about:blank') {
    const platform = os.platform();
    let chromePath;

    if (platform === 'win32') {
      const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      ];
      for (const p of paths) {
        try { await fs.access(p); chromePath = p; break; } catch (_) {}
      }
      if (!chromePath) chromePath = 'chrome'; // Hoffe es ist im PATH
    } else if (platform === 'darwin') {
      chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else {
      chromePath = 'google-chrome';
    }

    const args = [
      `--remote-debugging-port=${this.cdpPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${path.join(os.tmpdir(), 'johnny-chrome-profile')}`,
      url
    ];

    this.chromeProcess = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
    this.chromeProcess.unref();

    // Warte bis CDP erreichbar
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        await this._cdpGet('/json');
        this.connected = true;
        console.log('[CDP] Chrome started with CDP');
        return { success: true, port: this.cdpPort };
      } catch (_) {}
    }

    throw new Error('Chrome konnte nicht gestartet werden');
  }

  // ── CDP HTTP API ──────────────────────────────────────────────────
  async _cdpGet(endpoint) {
    const axios = require('axios');
    const res = await axios.get(`http://${this.cdpHost}:${this.cdpPort}${endpoint}`, { timeout: 5000 });
    return res.data;
  }

  async _cdpSend(targetId, method, params = {}) {
    const WebSocket = require('ws');
    const targets = await this._cdpGet('/json');
    const target = targetId
      ? targets.find(t => t.id === targetId)
      : targets.find(t => t.type === 'page');

    if (!target) throw new Error('No CDP target found');

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      const id = Date.now();

      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('CDP timeout'));
      }, 30000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ id, method, params }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timer);
          ws.close();
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // ── High-Level API ────────────────────────────────────────────────
  async getTabs() {
    const targets = await this._cdpGet('/json');
    return targets.filter(t => t.type === 'page').map(t => ({
      id: t.id, title: t.title, url: t.url
    }));
  }

  async newTab(url = 'about:blank') {
    const target = await this._cdpGet(`/json/new?${url}`);
    return { id: target.id, title: target.title, url: target.url };
  }

  async closeTab(targetId) {
    await this._cdpGet(`/json/close/${targetId}`);
    return { success: true };
  }

  async navigate(url, targetId = null) {
    const result = await this._cdpSend(targetId, 'Page.navigate', { url });
    // Warte auf Load
    await new Promise(r => setTimeout(r, 2000));
    return result;
  }

  async screenshot(targetId = null) {
    const result = await this._cdpSend(targetId, 'Page.captureScreenshot', { format: 'png' });
    const filename = `cdp-screenshot-${Date.now()}.png`;
    const filepath = path.join(this.screenshotsDir, filename);
    await fs.writeFile(filepath, Buffer.from(result.data, 'base64'));
    return { path: filepath, filename };
  }

  async getPageContent(targetId = null) {
    // Evaluiere DOM
    const result = await this._cdpSend(targetId, 'Runtime.evaluate', {
      expression: 'document.title + "\\n\\n" + document.body.innerText',
      returnByValue: true
    });
    return { text: result.result?.value || '' };
  }

  async evaluateJS(expression, targetId = null) {
    const result = await this._cdpSend(targetId, 'Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    return result.result?.value;
  }

  async click(selector, targetId = null) {
    // Finde Element und klicke
    const script = `
      (function() {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { error: 'Element not found' };
        el.click();
        return { clicked: true, text: el.textContent?.slice(0, 100) };
      })()
    `;
    return this.evaluateJS(script, targetId);
  }

  async type(selector, text, targetId = null) {
    const script = `
      (function() {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { error: 'Element not found' };
        el.focus();
        el.value = '${text.replace(/'/g, "\\'")}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { typed: true };
      })()
    `;
    return this.evaluateJS(script, targetId);
  }

  async getPageInfo(targetId = null) {
    const result = await this._cdpSend(targetId, 'Runtime.evaluate', {
      expression: `JSON.stringify({ title: document.title, url: location.href, links: Array.from(document.querySelectorAll('a')).slice(0,20).map(a=>({text:a.textContent.trim().slice(0,60),href:a.href})), forms: document.forms.length, inputs: document.querySelectorAll('input,textarea,select').length })`,
      returnByValue: true
    });
    try { return JSON.parse(result.result?.value || '{}'); } catch { return {}; }
  }

  async generatePDF(targetId = null) {
    const result = await this._cdpSend(targetId, 'Page.printToPDF', { landscape: false, printBackground: true });
    const filename = `cdp-pdf-${Date.now()}.pdf`;
    const filepath = path.join(this.screenshotsDir, filename);
    await fs.writeFile(filepath, Buffer.from(result.data, 'base64'));
    return { path: filepath, filename };
  }

  // ── Cleanup ───────────────────────────────────────────────────────
  async close() {
    if (this.chromeProcess) {
      this.chromeProcess.kill();
      this.chromeProcess = null;
    }
    this.connected = false;
  }

  getStatus() {
    return { connected: this.connected, host: this.cdpHost, port: this.cdpPort, hasChrome: !!this.chromeProcess };
  }
}

module.exports = CDPBrowserService;
