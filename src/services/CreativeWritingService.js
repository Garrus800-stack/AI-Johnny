/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CREATIVE WRITING SERVICE v1.0                                      ║
 * ║                                                                      ║
 * ║  Fortgeschrittene kreative Text-Engine für Johnny:                  ║
 * ║  - Multi-Genre Support (Fiction, Lyrik, Drehbuch, Journalismus)    ║
 * ║  - Charakter-Entwicklung & Konsistenz-Tracker                      ║
 * ║  - Plot-Strukturen (Heldenreise, 3-Akt, Kishōtenketsu)           ║
 * ║  - Stilanalyse & Adaption (Autor-Imitation)                        ║
 * ║  - Collaborative Storytelling (interaktiv)                          ║
 * ║  - Automatisches Feedback & Revision-Vorschläge                    ║
 * ║  - Thema-zu-Metapher Engine                                        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs').promises;
const path = require('path');

// ── Genre-Definitionen ────────────────────────────────────────────────
const GENRES = {
  fiction:     { label: 'Fiction',     subgenres: ['sci-fi','fantasy','thriller','romance','horror','literary','historical','mystery','adventure'] },
  poetry:     { label: 'Lyrik',       subgenres: ['sonnet','haiku','free-verse','limerick','ballad','elegy','ode','prose-poetry'] },
  screenplay: { label: 'Drehbuch',    subgenres: ['film','tv-series','short','documentary','animation'] },
  journalism: { label: 'Journalismus',subgenres: ['report','feature','column','interview','investigative','editorial'] },
  essay:      { label: 'Essay',       subgenres: ['academic','personal','persuasive','narrative','descriptive','analytical'] },
  copywriting:{ label: 'Copywriting', subgenres: ['ad','landing-page','email','social','slogan','brand-story'] },
  technical:  { label: 'Technisch',   subgenres: ['docs','tutorial','readme','api-reference','blog-post','whitepaper'] },
  dialogue:   { label: 'Dialog',      subgenres: ['conversation','debate','interview','monologue','voiceover'] },
};

// ── Plot-Strukturen ──────────────────────────────────────────────────
const PLOT_STRUCTURES = {
  threeAct: {
    name: 'Drei-Akt-Struktur',
    acts: [
      { name: 'Setup', beats: ['Hook','Normalzustand','Inciting Incident','Erste Entscheidung'] },
      { name: 'Confrontation', beats: ['Rising Action','Midpoint-Twist','Krise','Zweiter Wendepunkt'] },
      { name: 'Resolution', beats: ['Climax','Falling Action','Denouement','Neue Normalität'] },
    ],
  },
  heroJourney: {
    name: 'Heldenreise (Campbell)',
    stages: ['Gewöhnliche Welt','Ruf des Abenteuers','Verweigerung','Begegnung mit Mentor',
      'Überschreitung der Schwelle','Prüfungen & Verbündete','Annäherung','Entscheidungskampf',
      'Belohnung','Rückweg','Auferstehung','Rückkehr mit dem Elixir'],
  },
  kishotenketsu: {
    name: 'Kishōtenketsu (japanisch)',
    parts: [
      { name: 'Ki (起)', desc: 'Einführung — Welt & Charakter vorstellen' },
      { name: 'Shō (承)', desc: 'Entwicklung — Vertiefen ohne Konflikt' },
      { name: 'Ten (転)', desc: 'Twist — Unerwarteter Perspektivwechsel' },
      { name: 'Ketsu (結)', desc: 'Schluss — Verbindung & neue Erkenntnis' },
    ],
  },
  fiveAct: {
    name: 'Fünf-Akt (Shakespeare)',
    acts: ['Exposition','Rising Action','Climax','Falling Action','Catastrophe/Resolution'],
  },
  saveTheCat: {
    name: 'Save the Cat! (Snyder)',
    beats: ['Opening Image','Theme Stated','Set-Up','Catalyst','Debate','Break into Two',
      'B-Story','Fun and Games','Midpoint','Bad Guys Close In','All Is Lost',
      'Dark Night of the Soul','Break into Three','Finale','Final Image'],
  },
};

// ── Stilelemente ─────────────────────────────────────────────────────
const STYLE_ELEMENTS = {
  narrative_pov: ['first-person','second-person','third-limited','third-omniscient','unreliable-narrator','epistolary','stream-of-consciousness'],
  tone: ['lyrical','sparse','satirical','noir','whimsical','melancholic','urgent','meditative','darkly-comic','epic'],
  pacing: ['staccato','flowing','building','alternating','slow-burn','breakneck'],
  literary_devices: ['metaphor','simile','personification','foreshadowing','irony','symbolism','allegory','anaphora','chiasmus','synesthesia','juxtaposition','unreliable-narration'],
};

// ── Charakter-Archetypes ─────────────────────────────────────────────
const CHARACTER_ARCHETYPES = {
  hero:       { traits: ['mutig','selbstlos','wachsend'], flaw: 'Hybris oder Naivität', arc: 'Überwindung innerer Schwäche' },
  mentor:     { traits: ['weise','erfahren','mysteriös'], flaw: 'Vergangenheit die einholt', arc: 'Loslassen und Vertrauen in Schüler' },
  trickster:  { traits: ['clever','chaotisch','charming'], flaw: 'Unverlässlich', arc: 'Loyalität entdecken' },
  shadow:     { traits: ['gespiegelt','dunkel','faszinierend'], flaw: 'Besessenheit', arc: 'Zerfall oder Erlösung' },
  rebel:      { traits: ['unkonventionell','leidenschaftlich','riskant'], flaw: 'Selbstzerstörerisch', arc: 'Sinn finden jenseits von Rebellion' },
  caregiver:  { traits: ['empathisch','opferbereit','stark'], flaw: 'Vernachlässigt sich selbst', arc: 'Eigene Bedürfnisse akzeptieren' },
  explorer:   { traits: ['neugierig','unabhängig','rastlos'], flaw: 'Bindungsangst', arc: 'Heimat in sich selbst finden' },
};

class CreativeWritingService {
  constructor(config = {}) {
    this.agentManager = config.agentManager;
    this.dataDir      = config.dataDir || path.join(require('os').homedir(), '.johnny', 'creative');
    this._projects    = new Map();
    this._characters  = new Map();
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    await this._loadProjects();
    console.log('[CreativeWriting] Initialized — projects: ' + this._projects.size);
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ TEXT-GENERIERUNG ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Generiert kreativen Text mit fortgeschrittenen Parametern
   */
  async generate(params = {}) {
    const {
      genre = 'fiction', subgenre, prompt, style = {},
      plotStructure, characters = [], length = 'medium',
      language = 'de', projectId, chapterNumber,
      temperature = 0.85, continuePrevious = false,
    } = params;

    // System-Prompt zusammenbauen
    let systemPrompt = this._buildWritingSystemPrompt(genre, subgenre, style, language);

    // Plot-Kontext
    if (plotStructure && PLOT_STRUCTURES[plotStructure]) {
      systemPrompt += '\n\n[PLOT-STRUKTUR]\n' + JSON.stringify(PLOT_STRUCTURES[plotStructure], null, 2);
    }

    // Charakter-Kontext
    if (characters.length > 0) {
      systemPrompt += '\n\n[CHARAKTERE]\n';
      for (const ch of characters) {
        const resolved = this._characters.get(ch.id) || ch;
        systemPrompt += `- ${resolved.name}: ${resolved.description || ''} | Archetype: ${resolved.archetype || 'custom'} | Flaw: ${resolved.flaw || '?'}\n`;
      }
    }

    // Projekt-Kontext (vorherige Kapitel)
    if (projectId && continuePrevious) {
      const project = this._projects.get(projectId);
      if (project && project.chapters.length > 0) {
        const lastChapter = project.chapters[project.chapters.length - 1];
        systemPrompt += `\n\n[VORHERIGES KAPITEL — Zusammenfassung]\n${lastChapter.summary || lastChapter.text.slice(0, 500)}`;
      }
    }

    // Längen-Map
    const lengthTokens = { short: 300, medium: 800, long: 1500, epic: 3000 };
    const maxTokens = lengthTokens[length] || 800;

    if (!this.agentManager) throw new Error('AgentManager not available');

    const response = await this.agentManager.sendToModel(prompt, {
      systemPrompt,
      temperature,
      maxTokens,
    });

    // Ergebnis speichern wenn Projekt
    if (projectId) {
      this._saveToProject(projectId, { text: response, prompt, genre, chapter: chapterNumber, createdAt: Date.now() });
    }

    return {
      text: response,
      meta: { genre, subgenre, length, plotStructure, characterCount: characters.length, tokens: maxTokens },
    };
  }

  /**
   * Baut den Schreib-System-Prompt
   */
  _buildWritingSystemPrompt(genre, subgenre, style, language) {
    const genreInfo = GENRES[genre] || GENRES.fiction;
    const lang = language === 'de' ? 'Deutsch' : 'English';

    let prompt = `Du bist ein preisgekrönter Autor mit Meisterschaft in ${genreInfo.label}`;
    if (subgenre) prompt += ` (Subgenre: ${subgenre})`;
    prompt += `. Schreibe in ${lang}.\n\n`;

    prompt += `QUALITÄTSREGELN:\n`;
    prompt += `- Show, don't tell — zeige durch Handlung, Dialog und Sinneswahrnehmungen\n`;
    prompt += `- Jeder Dialog muss die Handlung vorantreiben oder Charakter offenbaren\n`;
    prompt += `- Vermeide Klischees und generische Beschreibungen\n`;
    prompt += `- Nutze spezifische, sensorische Details statt abstrakter Aussagen\n`;
    prompt += `- Variiere Satzlänge und -rhythmus bewusst\n`;
    prompt += `- Jeder Absatz hat einen Zweck\n`;

    if (style.pov) prompt += `\nErzählperspektive: ${style.pov}\n`;
    if (style.tone) prompt += `Ton: ${style.tone}\n`;
    if (style.pacing) prompt += `Tempo: ${style.pacing}\n`;
    if (style.devices && style.devices.length > 0) {
      prompt += `Verwende diese Stilmittel: ${style.devices.join(', ')}\n`;
    }
    if (style.influences) prompt += `Stilistischer Einfluss: ${style.influences}\n`;

    // Genre-spezifische Anweisungen
    if (genre === 'poetry') {
      prompt += `\nLYRIK-REGELN:\n- Jedes Wort trägt Gewicht — kein Füllmaterial\n- Klang und Rhythmus bewusst einsetzen\n- Bildsprache über Erklärung\n`;
    } else if (genre === 'screenplay') {
      prompt += `\nDREHBUCH-FORMAT:\n- Szenenüberschriften (INT./EXT.)\n- Action-Zeilen im Präsens\n- Dialoge zentriert mit Charaktername\n- Regieanweisungen sparsam\n`;
    } else if (genre === 'dialogue') {
      prompt += `\nDIALOG-REGELN:\n- Jeder Charakter hat eigene Stimme und Sprachmuster\n- Subtext > explizite Aussagen\n- Unterbrechungen und Pausen nutzen\n`;
    }

    return prompt;
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ CHARAKTER-MANAGEMENT ██
  // ════════════════════════════════════════════════════════════════════

  createCharacter(params = {}) {
    const id = 'char_' + Date.now().toString(36);
    const archetype = CHARACTER_ARCHETYPES[params.archetype];
    const character = {
      id, name: params.name || 'Unnamed',
      archetype: params.archetype || 'custom',
      description: params.description || '',
      traits: params.traits || (archetype ? archetype.traits : []),
      flaw: params.flaw || (archetype ? archetype.flaw : ''),
      arc: params.arc || (archetype ? archetype.arc : ''),
      backstory: params.backstory || '',
      voice: params.voice || '',  // Sprachmuster
      relationships: params.relationships || [],
      notes: [],
      createdAt: Date.now(),
    };
    this._characters.set(id, character);
    this._saveCharacters();
    return character;
  }

  getCharacter(id) { return this._characters.get(id) || null; }
  listCharacters() { return Array.from(this._characters.values()); }
  deleteCharacter(id) { this._characters.delete(id); this._saveCharacters(); }

  updateCharacter(id, updates) {
    const ch = this._characters.get(id);
    if (!ch) return null;
    Object.assign(ch, updates, { updatedAt: Date.now() });
    this._saveCharacters();
    return ch;
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ PROJEKT-MANAGEMENT ██
  // ════════════════════════════════════════════════════════════════════

  createProject(params = {}) {
    const id = 'proj_' + Date.now().toString(36);
    const project = {
      id, title: params.title || 'Neues Projekt',
      genre: params.genre || 'fiction',
      plotStructure: params.plotStructure || null,
      characters: params.characters || [],
      chapters: [],
      outline: params.outline || '',
      worldBuilding: params.worldBuilding || '',
      notes: [],
      createdAt: Date.now(),
    };
    this._projects.set(id, project);
    this._saveProjects();
    return project;
  }

  getProject(id) { return this._projects.get(id) || null; }
  listProjects() { return Array.from(this._projects.values()).map(p => ({ id: p.id, title: p.title, genre: p.genre, chapters: p.chapters.length, createdAt: p.createdAt })); }
  deleteProject(id) { this._projects.delete(id); this._saveProjects(); }

  _saveToProject(projectId, chapter) {
    const project = this._projects.get(projectId);
    if (project) {
      project.chapters.push(chapter);
      this._saveProjects();
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ ANALYSE & FEEDBACK ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Analysiert einen Text auf stilistische Qualität
   */
  async analyzeWriting(text, options = {}) {
    if (!this.agentManager) return { error: 'AgentManager not available' };

    const prompt = `Analysiere diesen Text als erfahrener Lektor. Gib eine strukturierte Bewertung:

1. STÄRKEN (was funktioniert gut?)
2. SCHWÄCHEN (was kann verbessert werden?)
3. STILANALYSE (Ton, Tempo, Wortwahl, Satzstruktur)
4. SHOW-DON'T-TELL Score (1-10)
5. DIALOG-QUALITÄT (wenn vorhanden, 1-10)
6. KONKRETE VERBESSERUNGSVORSCHLÄGE (3-5 spezifische Vorschläge)

Antworte als JSON:
{"strengths":[],"weaknesses":[],"style":{"tone":"","pacing":"","vocabulary":"","sentence_variety":""},"scores":{"show_dont_tell":0,"dialogue":0,"overall":0},"suggestions":[]}

Text:
${text.slice(0, 3000)}`;

    try {
      const res = await this.agentManager.sendToModel(prompt, { temperature: 0.3, maxTokens: 1000 });
      const json = (res || '').match(/\{[\s\S]*\}/);
      if (json) return JSON.parse(json[0]);
      return { raw: res };
    } catch (e) {
      return { error: e.message };
    }
  }

  /**
   * Generiert Varianten eines Textabschnitts
   */
  async generateVariants(text, count = 3, style = {}) {
    if (!this.agentManager) return [];

    const prompt = `Schreibe ${count} verschiedene Varianten des folgenden Textabschnitts.
Jede Variante soll einen anderen Ansatz verfolgen (z.B. Ton, Perspektive, Tempo).
Markiere jede Variante mit [VARIANTE 1], [VARIANTE 2] etc.
${style.tone ? 'Mögliche Töne: ' + style.tone : ''}

Originaltext:
${text.slice(0, 1000)}`;

    const res = await this.agentManager.sendToModel(prompt, { temperature: 0.9, maxTokens: 2000 });
    const variants = (res || '').split(/\[VARIANTE \d+\]/i).filter(v => v.trim());
    return variants.map((v, i) => ({ index: i + 1, text: v.trim() }));
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ INFOS FÜR UI ██
  // ════════════════════════════════════════════════════════════════════

  getGenres() { return GENRES; }
  getPlotStructures() { return PLOT_STRUCTURES; }
  getStyleElements() { return STYLE_ELEMENTS; }
  getArchetypes() { return CHARACTER_ARCHETYPES; }

  getStatus() {
    return {
      projects: this._projects.size,
      characters: this._characters.size,
      genres: Object.keys(GENRES),
      plotStructures: Object.keys(PLOT_STRUCTURES),
    };
  }

  // ── Persistence ────────────────────────────────────────────────────
  async _saveProjects() {
    try {
      const data = {};
      for (const [id, p] of this._projects) data[id] = p;
      await fs.writeFile(path.join(this.dataDir, 'projects.json'), JSON.stringify(data, null, 2));
    } catch (e) { console.warn('[CreativeWriting] Save projects error:', e.message); }
  }
  async _loadProjects() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'projects.json'), 'utf-8');
      for (const [id, p] of Object.entries(JSON.parse(raw))) this._projects.set(id, p);
    } catch { /* first run */ }
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'characters.json'), 'utf-8');
      for (const [id, c] of Object.entries(JSON.parse(raw))) this._characters.set(id, c);
    } catch { /* first run */ }
  }
  async _saveCharacters() {
    try {
      const data = {};
      for (const [id, c] of this._characters) data[id] = c;
      await fs.writeFile(path.join(this.dataDir, 'characters.json'), JSON.stringify(data, null, 2));
    } catch (e) { console.warn('[CreativeWriting] Save characters error:', e.message); }
  }
}

module.exports = CreativeWritingService;
