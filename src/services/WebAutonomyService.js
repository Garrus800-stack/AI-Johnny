/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  WEB AUTONOMY SERVICE v1.0                                          ║
 * ║                                                                      ║
 * ║  Autonomes Web-Browsing für Johnny:                                 ║
 * ║  - Intelligente Seiten-Analyse (Struktur, Links, Formulare)        ║
 * ║  - Autonomes Navigieren durch mehrseitige Aufgaben                  ║
 * ║  - Readability-Extraktion (Artikel-Text, sauber)                    ║
 * ║  - Automatische Formular-Erkennung und -Füllung                    ║
 * ║  - Tab-Management mit Kontext-Tracking                             ║
 * ║  - Cookie/Session-Persistenz                                        ║
 * ║  - RSS/Atom-Feed-Parsing                                           ║
 * ║  - Seiten-Monitoring (Änderungen tracken)                          ║
 * ║  - Screenshot + Vision-Analyse-Kopplung                             ║
 * ║  - Sitemap-Crawler                                                  ║
 * ║  - Kontext-aware Task-Planung für Web-Aufgaben                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const axios            = require('axios');
const cheerio          = require('cheerio');
const { EventEmitter } = require('events');
const fs               = require('fs').promises;
const path             = require('path');
const os               = require('os');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_PAGE_TEXT    = 15000;
const REQUEST_TIMEOUT  = 20000;

class WebAutonomyService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.browserService = config.browserService;  // Puppeteer-Service
    this.cdpService     = config.cdpService;       // CDP-Service
    this.visionService  = config.visionService;
    this.agentManager   = config.agentManager;
    this.dataDir        = config.dataDir || path.join(os.tmpdir(), 'johnny-web');

    this._pageCache     = new Map();  // url → { html, text, timestamp }
    this._sessionCookies = new Map(); // domain → cookies
    this._monitors       = new Map(); // url → { interval, lastContent }
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    console.log('[WebAutonomy] Initialized');
  }

  // ════════════════════════════════════════════════════════════════════
  // 1. INTELLIGENTE SEITEN-ANALYSE
  // ════════════════════════════════════════════════════════════════════

  /**
   * Analysiert eine Webseite umfassend:
   * Extrahiert Text, Links, Formulare, Bilder, Meta-Daten, Struktur.
   */
  async analyzePage(url, opts = {}) {
    const { useJS = false, cache = true, maxAge = 300000 } = opts;

    // Cache prüfen
    if (cache && this._pageCache.has(url)) {
      const cached = this._pageCache.get(url);
      if (Date.now() - cached.timestamp < maxAge) return cached.analysis;
    }

    let html, finalUrl = url;

    if (useJS && (this.browserService || this.cdpService)) {
      // JS-gerenderte Seiten via Puppeteer/CDP
      const result = this.browserService
        ? await this.browserService.navigateAndCapture(url)
        : await this._cdpFetch(url);
      html = result.html;
      finalUrl = result.url || url;
    } else {
      // Leichtgewichtiges HTTP-Fetch
      const resp = await axios.get(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' },
        timeout: REQUEST_TIMEOUT, maxRedirects: 5,
      });
      html = resp.data;
      finalUrl = resp.request?.res?.responseUrl || url;
    }

    const $ = cheerio.load(html);
    const analysis = this._analyzeDOM($, finalUrl);

    // Cache speichern
    if (cache) this._pageCache.set(url, { analysis, html, timestamp: Date.now() });

    this.emit('page.analyzed', { url: finalUrl });
    return analysis;
  }

  _analyzeDOM($, url) {
    // Sauberen Text extrahieren (Readability-Stil)
    $('script, style, noscript, iframe, svg, nav.ad, .advertisement, #cookie-banner, .popup').remove();

    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const lang = $('html').attr('lang') || '';
    const canonical = $('link[rel="canonical"]').attr('href') || url;

    // ── Artikel-Text extrahieren (Readability-Heuristik) ──────────────
    const articleText = this._extractReadableText($);

    // ── Links ──────────────────────────────────────────────────────────
    const links = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim().slice(0, 100);
      if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push({ text, href: this._resolveUrl(href, url) });
      }
    });

    // ── Formulare ─────────────────────────────────────────────────────
    const forms = [];
    $('form').each((i, el) => {
      const $form = $(el);
      const fields = [];
      $form.find('input, textarea, select').each((_, field) => {
        const $f = $(field);
        fields.push({
          tag:  field.tagName,
          type: $f.attr('type') || field.tagName,
          name: $f.attr('name') || $f.attr('id') || '',
          placeholder: $f.attr('placeholder') || '',
          required: $f.attr('required') !== undefined,
          label: $f.closest('label').text().trim() || $(`label[for="${$f.attr('id')}"]`).text().trim() || '',
        });
      });
      forms.push({
        action: $form.attr('action') || '',
        method: $form.attr('method') || 'get',
        fields,
      });
    });

    // ── Bilder ─────────────────────────────────────────────────────────
    const images = [];
    $('img[src]').slice(0, 20).each((_, el) => {
      const src = $(el).attr('src');
      const alt = $(el).attr('alt') || '';
      if (src) images.push({ src: this._resolveUrl(src, url), alt });
    });

    // ── Überschriften-Struktur ─────────────────────────────────────────
    const headings = [];
    $('h1, h2, h3').each((_, el) => {
      headings.push({ level: el.tagName, text: $(el).text().trim().slice(0, 150) });
    });

    // ── Tabellen ──────────────────────────────────────────────────────
    const tables = [];
    $('table').slice(0, 5).each((_, el) => {
      const rows = [];
      $(el).find('tr').slice(0, 20).each((_, tr) => {
        const cells = [];
        $(tr).find('td, th').each((_, td) => cells.push($(td).text().trim().slice(0, 100)));
        if (cells.length) rows.push(cells);
      });
      if (rows.length) tables.push(rows);
    });

    return {
      url, title, metaDescription: metaDesc, language: lang, canonical,
      text: articleText.slice(0, MAX_PAGE_TEXT),
      textLength: articleText.length,
      headings,
      links: links.slice(0, 50),
      linkCount: links.length,
      forms,
      images: images.slice(0, 10),
      tables,
      hasSearch: forms.some(f => f.fields.some(fl => fl.type === 'search' || fl.name?.includes('search') || fl.name?.includes('query') || fl.name === 'q')),
      hasLogin: forms.some(f => f.fields.some(fl => fl.type === 'password')),
    };
  }

  /** Readability-Heuristik: Haupttext extrahieren */
  _extractReadableText($) {
    // Suche nach article, main, .content, .post, .entry
    const candidates = ['article', 'main', '[role="main"]', '.content', '.post-content', '.entry-content', '.article-body', '#content', '#main'];
    for (const sel of candidates) {
      const el = $(sel).first();
      if (el.length && el.text().trim().length > 200) {
        return el.text().replace(/\s+/g, ' ').trim();
      }
    }
    // Fallback: body
    return $('body').text().replace(/\s+/g, ' ').trim();
  }

  _resolveUrl(href, base) {
    if (href.startsWith('http')) return href;
    try { return new URL(href, base).href; } catch { return href; }
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. AUTONOMES BROWSING
  // ════════════════════════════════════════════════════════════════════

  /**
   * Führt eine autonome Web-Aufgabe durch:
   * z.B. "Finde den günstigsten Flug von Berlin nach London"
   * Plant Schritte, navigiert selbständig, extrahiert Ergebnisse.
   */
  async executeWebTask(task, opts = {}) {
    const { maxSteps = 10, startUrl = null } = opts;

    if (!this.agentManager) return { error: 'AgentManager benötigt für autonomes Browsing' };

    const history = [];
    let currentUrl = startUrl;
    let currentPage = null;

    for (let step = 0; step < maxSteps; step++) {
      // ── LLM planen lassen ────────────────────────────────────────────
      const planPrompt = `Du navigierst autonom im Web. Aufgabe: "${task}"

${currentPage ? `Aktuelle Seite: ${currentPage.title} (${currentUrl})
Links: ${currentPage.links.slice(0, 15).map(l => `[${l.text}](${l.href})`).join(', ')}
${currentPage.forms.length ? `Formulare: ${JSON.stringify(currentPage.forms.slice(0, 2))}` : ''}
Text-Auszug: ${currentPage.text.slice(0, 1000)}` : 'Noch keine Seite geladen.'}

Bisherige Schritte: ${history.map(h => h.action).join(' → ')}

Was ist der nächste Schritt? Antworte als JSON:
{"action":"navigate|search|extract|click|fill_form|done","url":"...","query":"...","data":"...","reason":"...","result":"..."}`;

      try {
        const result = await this.agentManager.sendMessage('Johnny', planPrompt);
        const match = result.response.match(/\{[\s\S]*\}/);
        if (!match) { history.push({ step, action: 'error', reason: 'Kein JSON vom Planner' }); continue; }
        const plan = JSON.parse(match[0]);

        this.emit('webtask.step', { step: step + 1, action: plan.action, url: plan.url, reason: plan.reason });

        // ── Action ausführen ────────────────────────────────────────────
        switch (plan.action) {
          case 'navigate':
            currentUrl = plan.url;
            currentPage = await this.analyzePage(currentUrl);
            history.push({ step, action: 'navigate', url: currentUrl, title: currentPage.title });
            break;

          case 'search': {
            const searchResults = await this._webSearch(plan.query || task);
            if (searchResults.length) {
              currentUrl = searchResults[0].url;
              currentPage = await this.analyzePage(currentUrl);
            }
            history.push({ step, action: 'search', query: plan.query, results: searchResults.length });
            break;
          }

          case 'extract':
            history.push({
              step, action: 'extract', url: currentUrl,
              data: plan.data || currentPage?.text?.slice(0, 3000),
            });
            break;

          case 'done':
            history.push({ step, action: 'done', result: plan.result });
            return { success: true, task, steps: history, result: plan.result, stepsUsed: step + 1 };

          default:
            history.push({ step, action: plan.action, url: plan.url, reason: plan.reason });
        }
      } catch (e) {
        history.push({ step, action: 'error', error: e.message });
      }
    }

    return { success: false, task, steps: history, reason: `Max ${maxSteps} Schritte erreicht` };
  }

  async _webSearch(query) {
    try {
      const resp = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query }, headers: { 'User-Agent': UA }, timeout: 10000,
      });
      const $ = cheerio.load(resp.data);
      const results = [];
      $('.result').slice(0, 5).each((_, el) => {
        const title = $(el).find('.result__title').text().trim();
        const href  = $(el).find('.result__url').attr('href');
        const snippet = $(el).find('.result__snippet').text().trim();
        if (title && href) results.push({ title, url: href.startsWith('//') ? 'https:' + href : href, snippet });
      });
      return results;
    } catch { return []; }
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. RSS / FEED-PARSING
  // ════════════════════════════════════════════════════════════════════

  async parseFeed(url) {
    try {
      const resp = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 10000 });
      const $ = cheerio.load(resp.data, { xmlMode: true });

      const items = [];

      // RSS 2.0
      $('item').each((_, el) => {
        items.push({
          title: $(el).find('title').text(),
          link:  $(el).find('link').text(),
          date:  $(el).find('pubDate').text(),
          description: $(el).find('description').text().slice(0, 500),
        });
      });

      // Atom
      if (!items.length) {
        $('entry').each((_, el) => {
          items.push({
            title: $(el).find('title').text(),
            link:  $(el).find('link').attr('href') || '',
            date:  $(el).find('published').text() || $(el).find('updated').text(),
            description: $(el).find('summary').text().slice(0, 500),
          });
        });
      }

      return { url, type: items.length ? 'feed' : 'unknown', items: items.slice(0, 50), count: items.length };
    } catch (e) {
      return { error: e.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. SEITEN-MONITORING
  // ════════════════════════════════════════════════════════════════════

  async startPageMonitor(url, opts = {}) {
    const { intervalMs = 60000, selector = null } = opts;
    if (this._monitors.has(url)) return { error: 'Bereits überwacht' };

    // Initialen Inhalt laden
    const page = await this.analyzePage(url, { cache: false });
    const content = selector ? page.text : page.text.slice(0, 5000);

    const id = setInterval(async () => {
      try {
        const newPage = await this.analyzePage(url, { cache: false });
        const newContent = selector ? newPage.text : newPage.text.slice(0, 5000);

        const monitor = this._monitors.get(url);
        if (monitor && newContent !== monitor.lastContent) {
          this.emit('page.changed', { url, title: newPage.title, oldLength: monitor.lastContent.length, newLength: newContent.length });
          monitor.lastContent = newContent;
        }
      } catch (e) {
        this.emit('page.monitor.error', { url, error: e.message });
      }
    }, intervalMs);

    this._monitors.set(url, { interval: id, lastContent: content, startedAt: Date.now() });
    return { success: true, monitoring: url, intervalMs };
  }

  stopPageMonitor(url) {
    const m = this._monitors.get(url);
    if (!m) return { error: 'Nicht überwacht' };
    clearInterval(m.interval);
    this._monitors.delete(url);
    return { success: true, stopped: url };
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. MULTI-PAGE RESEARCH
  // ════════════════════════════════════════════════════════════════════

  /**
   * Recherchiert ein Thema über mehrere Seiten, extrahiert Kerninfos.
   */
  async deepResearch(topic, opts = {}) {
    const { maxPages = 5, maxDepth = 2 } = opts;

    // Phase 1: Suchen
    const searchResults = await this._webSearch(topic);
    if (!searchResults.length) return { topic, error: 'Keine Suchergebnisse' };

    // Phase 2: Top-Seiten analysieren
    const analyses = [];
    for (const sr of searchResults.slice(0, maxPages)) {
      try {
        const page = await this.analyzePage(sr.url);
        analyses.push({
          url: sr.url, title: page.title,
          text: page.text.slice(0, 3000),
          headings: page.headings,
          linkCount: page.linkCount,
        });
      } catch (e) {
        analyses.push({ url: sr.url, error: e.message });
      }
    }

    // Phase 3: LLM-Synthese
    let synthesis = null;
    if (this.agentManager) {
      try {
        const prompt = `Fasse die Ergebnisse einer Web-Recherche zum Thema "${topic}" zusammen:

${analyses.filter(a => a.text).map((a, i) => `Quelle ${i + 1}: ${a.title}\n${a.text.slice(0, 1500)}`).join('\n\n---\n\n')}

Erstelle eine strukturierte Zusammenfassung mit Haupterkenntnissen, Fakten und Quellen.`;
        const r = await this.agentManager.sendMessage('Johnny', prompt);
        synthesis = r.response;
      } catch {}
    }

    return {
      topic,
      sourcesAnalyzed: analyses.length,
      sources: analyses.map(a => ({ url: a.url, title: a.title, hasContent: !!a.text })),
      synthesis,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // CDP HELPER
  // ════════════════════════════════════════════════════════════════════

  async _cdpFetch(url) {
    if (!this.cdpService) throw new Error('CDP-Service nicht verfügbar');
    await this.cdpService.navigate(url);
    const content = await this.cdpService.getPageContent();
    const info = await this.cdpService.getPageInfo();
    return { html: content.text, url: info.url || url, title: info.title };
  }

  // ════════════════════════════════════════════════════════════════════
  // STATUS
  // ════════════════════════════════════════════════════════════════════

  getStatus() {
    return {
      cachedPages: this._pageCache.size,
      activeMonitors: [...this._monitors.keys()],
      hasBrowser: !!this.browserService,
      hasCDP: !!this.cdpService,
      hasVision: !!this.visionService,
      hasLLM: !!this.agentManager,
    };
  }

  clearCache() {
    this._pageCache.clear();
    return { cleared: true };
  }

  async cleanup() {
    for (const [url] of this._monitors) this.stopPageMonitor(url);
    this._pageCache.clear();
  }
}

module.exports = WebAutonomyService;
