const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * SkillMarketplace – Skill-Registry & Download-Manager
 *
 * Funktionen:
 *  - Durchsuche Skills von Remote-Registries (ClawHub, GitHub, npm)
 *  - Installiere Skills mit einem Klick
 *  - Kompatibel mit OpenClaw/ClawHub-Skill-Format
 *  - Lokale Registry für eigene Skills
 *  - Auto-Update installierter Skills
 */
class SkillMarketplace {
  constructor(config = {}) {
    this.pluginManager = config.pluginManager;
    this.dataDir       = config.dataDir || './marketplace';
    this.registries    = config.registries || [
      // v1.8.6: Kein totes GitHub-Repo mehr.
      // "builtin" enthält mitgelieferte Beispiel-Skills (immer verfügbar).
      // "github-search" sucht echte Repos via GitHub Topics API.
      { id: 'builtin',        name: 'Eingebaut',        url: '',                                    type: 'builtin' },
      { id: 'github-search',  name: 'GitHub (johnny-skill)', url: 'https://api.github.com',        type: 'github-topics' },
    ];
    this.installedSkills = new Map();
    this.cache           = new Map();
    this._cacheExpiry    = 300000; // 5 min
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    await this._loadInstalled();
    console.log(`[Marketplace] Initialized with ${this.installedSkills.size} installed skills, ${this.registries.length} registries`);
  }

  // ── Registry durchsuchen ──────────────────────────────────────────
  async searchSkills(query = '', registryId = null) {
    const results = [];
    const targetRegistries = registryId
      ? this.registries.filter(r => r.id === registryId)
      : this.registries;

    for (const registry of targetRegistries) {
      try {
        const skills = await this._fetchRegistry(registry);
        const filtered = query
          ? skills.filter(s =>
              (s.name || '').toLowerCase().includes(query.toLowerCase()) ||
              (s.description || '').toLowerCase().includes(query.toLowerCase()) ||
              (s.tags || []).some(t => t.toLowerCase().includes(query.toLowerCase()))
            )
          : skills;

        results.push(...filtered.map(s => ({
          ...s,
          registry: registry.id,
          registryName: registry.name,
          installed: this.installedSkills.has(s.id || s.name)
        })));
      } catch (e) {
        console.warn(`[Marketplace] Registry ${registry.id} failed:`, e.message);
      }
    }

    return results;
  }

  async getCategories() {
    const allSkills = await this.searchSkills();
    const cats = new Map();
    for (const skill of allSkills) {
      const category = skill.category || 'Sonstige';
      if (!cats.has(category)) cats.set(category, []);
      cats.get(category).push(skill);
    }
    return Object.fromEntries(cats);
  }

  async getFeatured() {
    const all = await this.searchSkills();
    return all.filter(s => s.featured || s.stars > 10).slice(0, 20);
  }

  // ── Skill installieren ────────────────────────────────────────────
  async installSkill(skillId, registryId = null) {
    // Finde Skill in Registry
    const allSkills = await this.searchSkills('', registryId);
    const skill = allSkills.find(s => (s.id || s.name) === skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);

    console.log(`[Marketplace] Installing: ${skill.name} from ${skill.registryName}`);

    // Download Skill-Code
    const registry = this.registries.find(r => r.id === skill.registry);
    const code = await this._downloadSkill(skill, registry);

    // Speichere lokal
    const installDir = path.join(this.dataDir, 'installed', skillId);
    await fs.mkdir(installDir, { recursive: true });

    if (typeof code === 'string') {
      // Einzelne Datei
      const ext = skill.language === 'python' ? '.py' : '.js';
      await fs.writeFile(path.join(installDir, `skill${ext}`), code, 'utf-8');
    } else if (code.files) {
      // Mehrere Dateien
      for (const [filename, content] of Object.entries(code.files)) {
        await fs.writeFile(path.join(installDir, filename), content, 'utf-8');
      }
    }

    // Manifest speichern
    const manifest = {
      id: skillId,
      name: skill.name,
      description: skill.description,
      version: skill.version || '1.0.0',
      author: skill.author,
      registry: skill.registry,
      language: skill.language || 'javascript',
      installedAt: new Date().toISOString(),
      installDir,
      entryPoint: skill.entryPoint || (skill.language === 'python' ? 'skill.py' : 'skill.js'),
      // OpenClaw-Kompatibilität
      clawFormat: skill.clawFormat || false,
      tags: skill.tags || [],
      category: skill.category || 'general'
    };

    await fs.writeFile(path.join(installDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    this.installedSkills.set(skillId, manifest);

    // In PluginManager laden
    if (this.pluginManager) {
      try {
        await this.pluginManager.createSkill({
          name: skill.name,
          description: skill.description,
          language: manifest.language,
          code
        });
      } catch (e) {
        console.warn(`[Marketplace] Could not load skill into PluginManager:`, e.message);
      }
    }

    await this._saveInstalled();
    console.log(`[Marketplace] Installed: ${skill.name}`);
    return manifest;
  }

  async uninstallSkill(skillId) {
    const manifest = this.installedSkills.get(skillId);
    if (!manifest) throw new Error('Skill not installed: ' + skillId);

    try {
      await fs.rm(manifest.installDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('[Marketplace] Uninstall cleanup failed:', e.message);
    }

    this.installedSkills.delete(skillId);
    await this._saveInstalled();
    console.log(`[Marketplace] Uninstalled: ${skillId}`);
  }

  // ── Registry-Adapter ──────────────────────────────────────────────
  async _fetchRegistry(registry) {
    const cacheKey = registry.id;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this._cacheExpiry) return cached.data;

    let skills = [];

    try {
      switch (registry.type) {
        case 'builtin': {
          // Eingebaute Beispiel-Skills — immer verfügbar, kein Netzwerk nötig
          skills = this._getBuiltinSkills();
          break;
        }

        case 'github-topics': {
          // GitHub Topics API — sucht nach Repos mit Topic "johnny-skill"
          // https://docs.github.com/en/rest/search/search#search-repositories
          const res = await axios.get(
            `${registry.url}/search/repositories`,
            {
              params: { q: 'topic:johnny-skill', sort: 'stars', order: 'desc', per_page: 30 },
              headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
              timeout: 12000,
            }
          );
          const repos = res.data.items || [];
          skills = repos.map(repo => ({
            id:          repo.full_name.replace('/', '-'),
            name:        repo.name,
            description: repo.description || '',
            author:      repo.owner?.login || '',
            stars:       repo.stargazers_count || 0,
            tags:        repo.topics || [],
            category:    'GitHub',
            language:    (repo.language || 'javascript').toLowerCase(),
            version:     '1.0.0',
            sourceUrl:   repo.html_url,
            // Raw-Download-URL: wird beim Installieren aufgelöst
            rawBase:     `https://raw.githubusercontent.com/${repo.full_name}/refs/heads/main`,
            type:        'github-repo',
          }));
          break;
        }

        case 'github': {
          // Legacy: GitHub-basierte Registry mit skills.json
          const res = await axios.get(`${registry.url}/skills.json`, { timeout: 10000 });
          skills = res.data.skills || res.data || [];
          break;
        }
        case 'npm': {
          // npm-basierte Registry
          const res = await axios.get(`https://registry.npmjs.org/-/v1/search?text=johnny-skill&size=50`, { timeout: 10000 });
          skills = (res.data.objects || []).map(o => ({
            id: o.package.name,
            name: o.package.name.replace('johnny-skill-', ''),
            description: o.package.description,
            version: o.package.version,
            author: o.package.publisher?.username,
            tags: o.package.keywords || [],
            npmUrl: o.package.links?.npm
          }));
          break;
        }
        case 'url': {
          const res = await axios.get(registry.url, { timeout: 10000 });
          skills = res.data.skills || res.data || [];
          break;
        }
      }
    } catch (e) {
      console.warn(`[Marketplace] Fetch ${registry.id} failed:`, e.message);
      // Fallback: eingebaute Beispiel-Skills
      if (registry.id === 'clawhub') {
        skills = this._builtinClawHubSkills();
      }
    }

    this.cache.set(cacheKey, { data: skills, ts: Date.now() });
    return skills;
  }

  async _downloadSkill(skill, registry) {
    if (skill.code) return skill.code;
    if (skill.url) {
      const res = await axios.get(skill.url, { timeout: 15000 });
      return res.data;
    }
    if (registry?.type === 'github' && skill.path) {
      const res = await axios.get(`${registry.url}/${skill.path}`, { timeout: 15000 });
      return res.data;
    }
    throw new Error('Cannot download skill: no source URL');
  }

  // ── Eingebaute ClawHub-kompatible Skills ──────────────────────────
  _builtinClawHubSkills() {
    return [
      {
        id: 'weather', name: 'Weather', description: 'Wetter-Abfrage mit wttr.in', category: 'Productivity',
        tags: ['weather', 'utility'], language: 'javascript', featured: true, version: '1.0.0',
        code: `module.exports = { name: 'weather', description: 'Get weather for a city', parameters: { city: 'string' },
  async execute(params) { const axios = require('axios'); const r = await axios.get('https://wttr.in/'+encodeURIComponent(params.city)+'?format=j1', {timeout:8000}); const c = r.data.current_condition[0]; return { temp: c.temp_C+'°C', feels: c.FeelsLikeC+'°C', desc: c.weatherDesc[0].value, humidity: c.humidity+'%', wind: c.windspeedKmph+'km/h', complete:true }; }};`
      },
      {
        id: 'calculator', name: 'Calculator', description: 'Mathematische Berechnungen', category: 'Utility',
        tags: ['math', 'utility'], language: 'javascript', version: '1.0.0',
        code: `module.exports = { name: 'calculator', description: 'Evaluate math expression', parameters: { expression: 'string' },
  async execute(params) { try { const r = Function('"use strict"; return ('+params.expression+')')(); return { result: r, complete:true }; } catch(e) { return { error: e.message, complete:true }; } }};`
      },
      {
        id: 'translator', name: 'Translator', description: 'Übersetzung über LibreTranslate', category: 'Productivity',
        tags: ['translate', 'language'], language: 'javascript', version: '1.0.0',
        code: `module.exports = { name: 'translator', description: 'Translate text between languages', parameters: { text: 'string', from: 'string', to: 'string' },
  async execute(params) { const axios = require('axios'); const r = await axios.post('https://libretranslate.de/translate', { q: params.text, source: params.from||'auto', target: params.to||'en' }, {timeout:10000}); return { translation: r.data.translatedText, complete:true }; }};`
      },
      {
        id: 'qrcode-gen', name: 'QR Code Generator', description: 'QR-Code aus Text erstellen', category: 'Utility',
        tags: ['qrcode', 'utility'], language: 'javascript', version: '1.0.0',
        code: `module.exports = { name: 'qrcode_gen', description: 'Generate a QR code image URL from text', parameters: { text: 'string' },
  async execute(params) { return { url: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data='+encodeURIComponent(params.text), complete:true }; }};`
      }
    ];
  }

  // ── Custom Registry hinzufügen ────────────────────────────────────
  addRegistry(registry) {
    if (this.registries.find(r => r.id === registry.id)) return;
    this.registries.push(registry);
  }

  getRegistries() {
    return this.registries.map(r => ({ ...r, skillCount: this.cache.get(r.id)?.data?.length || '?' }));
  }

  getInstalled() {
    return Array.from(this.installedSkills.values());
  }

  // ── Persistenz ────────────────────────────────────────────────────
  async _saveInstalled() {
    const data = Object.fromEntries(this.installedSkills);
    await fs.writeFile(path.join(this.dataDir, 'installed.json'), JSON.stringify(data, null, 2));
  }

  async _loadInstalled() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'installed.json'), 'utf8');
      Object.entries(JSON.parse(raw)).forEach(([id, manifest]) => this.installedSkills.set(id, manifest));
    } catch (_) {}
  }

  // ── Eingebaute Demo-Skills ────────────────────────────────────────────
  _getBuiltinSkills() {
    return [
      {
        id: 'builtin-weather', name: 'Wetter-Abfrage', category: 'Utilities',
        description: 'Ruft aktuelles Wetter über wttr.in ab (kein API-Key nötig)',
        author: 'Johnny', language: 'javascript', version: '1.0.0',
        tags: ['wetter', 'weather', 'api'],
        code: `// Wetter-Skill — fragt wttr.in ab
async function execute(params) {
  const city = params.city || 'Berlin';
  const axios = require('axios');
  const res = await axios.get('https://wttr.in/' + encodeURIComponent(city) + '?format=j1');
  const w = res.data.current_condition[0];
  return city + ': ' + w.weatherDesc[0].value + ', ' + w.temp_C + '°C, Gefühlt ' + w.FeelsLikeC + '°C';
}`,
      },
      {
        id: 'builtin-timer', name: 'Erinnerungs-Timer', category: 'Utilities',
        description: 'Setzt einen einfachen Countdown-Timer',
        author: 'Johnny', language: 'javascript', version: '1.0.0',
        tags: ['timer', 'reminder', 'erinnerung'],
        code: `async function execute(params) {
  const ms = (params.minutes || 5) * 60 * 1000;
  const label = params.label || 'Timer';
  setTimeout(() => { console.log('[Timer] ' + label + ' abgelaufen!'); }, ms);
  return 'Timer gesetzt: ' + label + ' in ' + (params.minutes || 5) + ' Minuten';
}`,
      },
      {
        id: 'builtin-calc', name: 'Taschenrechner', category: 'Tools',
        description: 'Wertet mathematische Ausdrücke aus',
        author: 'Johnny', language: 'javascript', version: '1.0.0',
        tags: ['math', 'rechner', 'calculator'],
        code: `async function execute(params) {
  const expr = params.expression || params.expr || '';
  // Sicher: nur Zahlen und Operatoren
  if (!/^[\d\s+\-*/().^%]+$/.test(expr)) return { error: 'Ungültiger Ausdruck' };
  try { return { result: eval(expr), expression: expr }; }
  catch(e) { return { error: e.message }; }
}`,
      },
      {
        id: 'builtin-uuid', name: 'UUID Generator', category: 'Tools',
        description: 'Generiert UUIDs v4',
        author: 'Johnny', language: 'javascript', version: '1.0.0',
        tags: ['uuid', 'id', 'generator'],
        code: `async function execute(params) {
  const { v4: uuidv4 } = require('uuid');
  const n = Math.min(params.count || 1, 20);
  const ids = Array.from({ length: n }, uuidv4);
  return ids.length === 1 ? ids[0] : ids;
}`,
      },
      {
        id: 'builtin-json-format', name: 'JSON Formatter', category: 'Tools',
        description: 'Formatiert und validiert JSON',
        author: 'Johnny', language: 'javascript', version: '1.0.0',
        tags: ['json', 'format', 'validate'],
        code: `async function execute(params) {
  const raw = params.json || params.input || '';
  try {
    const parsed = JSON.parse(raw);
    return { valid: true, formatted: JSON.stringify(parsed, null, 2), keys: Object.keys(parsed).length };
  } catch(e) {
    return { valid: false, error: e.message };
  }
}`,
      },
    ];
  }
}

module.exports = SkillMarketplace;
