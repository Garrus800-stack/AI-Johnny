/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SWARM SERVICE v2.0                                                  ║
 * ║                                                                      ║
 * ║  Erweitertes Multi-Agenten-System:                                  ║
 * ║  - Spezialisierte Agenten-Rollen (Researcher, Critic, Coder, ...)   ║
 * ║  - Inter-Agent-Kommunikation während der Ausführung                 ║
 * ║  - Multi-Phase-Pipelines (Sequential + Parallel)                    ║
 * ║  - Dynamisches Task-Rebalancing                                     ║
 * ║  - Voting & Consensus-Mechanismen                                   ║
 * ║  - Swarm-Gedächtnis über Sessions hinweg                            ║
 * ║  - Erweiterte Swarm-Typen                                           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const fs   = require('fs').promises;
const path = require('path');
const os   = require('os');

// ── Spezialisierte Rollen ──────────────────────────────────────────────
const AGENT_ROLES = {
  researcher: {
    name: 'Researcher',
    systemPrompt: `Du bist ein gründlicher Researcher. Deine Aufgabe:
- Sammle Fakten und Informationen systematisch
- Prüfe Quellen auf Glaubwürdigkeit
- Strukturiere Ergebnisse klar und übersichtlich
- Markiere Unsicherheiten und offene Fragen`,
    strengths: ['Recherche', 'Faktenprüfung', 'Quellenanalyse'],
  },
  critic: {
    name: 'Critic',
    systemPrompt: `Du bist ein konstruktiver Kritiker. Deine Aufgabe:
- Hinterfrage Annahmen und Schlussfolgerungen
- Identifiziere Schwachstellen und Risiken
- Bewerte die Qualität von Argumenten
- Schlage Verbesserungen vor`,
    strengths: ['Kritisches Denken', 'Risiko-Analyse', 'Qualitätssicherung'],
  },
  coder: {
    name: 'Coder',
    systemPrompt: `Du bist ein erfahrener Software-Entwickler. Deine Aufgabe:
- Schreibe sauberen, getesteten Code
- Folge Best Practices und Design Patterns
- Dokumentiere deine Entscheidungen
- Denke an Edge Cases und Fehlerbehandlung`,
    strengths: ['Programmierung', 'Architektur', 'Code-Review'],
  },
  creative: {
    name: 'Creative',
    systemPrompt: `Du bist ein kreativer Denker. Deine Aufgabe:
- Finde ungewöhnliche Lösungsansätze
- Denke quer und verbinde verschiedene Domänen
- Generiere viele Ideen, auch wilde
- Inspiriere durch Analogien und Metaphern`,
    strengths: ['Kreativität', 'Innovation', 'Querdenken'],
  },
  planner: {
    name: 'Planner',
    systemPrompt: `Du bist ein strategischer Planer. Deine Aufgabe:
- Erstelle strukturierte Pläne mit klaren Schritten
- Definiere Meilensteine und Abhängigkeiten
- Schätze Aufwand und Risiken
- Priorisiere nach Impact und Machbarkeit`,
    strengths: ['Planung', 'Strategie', 'Priorisierung'],
  },
  analyst: {
    name: 'Analyst',
    systemPrompt: `Du bist ein Daten-Analyst. Deine Aufgabe:
- Analysiere Daten und erkenne Muster
- Ziehe datenbasierte Schlussfolgerungen
- Visualisiere Erkenntnisse verständlich
- Quantifiziere wo möglich`,
    strengths: ['Datenanalyse', 'Mustererkennung', 'Statistik'],
  },
  writer: {
    name: 'Writer',
    systemPrompt: `Du bist ein professioneller Texter. Deine Aufgabe:
- Schreibe klar, verständlich und überzeugend
- Passe Ton und Stil an die Zielgruppe an
- Strukturiere Texte logisch
- Achte auf Grammatik und Stilistik`,
    strengths: ['Textproduktion', 'Kommunikation', 'Storytelling'],
  },
  devil_advocate: {
    name: 'Devil\'s Advocate',
    systemPrompt: `Du bist ein Advocatus Diaboli. Deine Aufgabe:
- Vertrete bewusst die Gegenposition
- Finde die stärksten Gegenargumente
- Decke blinde Flecken auf
- Stelle unbequeme Fragen`,
    strengths: ['Gegenargumente', 'Perspektivwechsel', 'Stresstest'],
  },
};

// ── Pipeline-Templates ─────────────────────────────────────────────────
const PIPELINE_TEMPLATES = {
  'deep-research': {
    name: 'Tiefenrecherche',
    phases: [
      { name: 'Recherche', type: 'parallel', roles: ['researcher', 'researcher', 'researcher'] },
      { name: 'Analyse', type: 'parallel', roles: ['analyst', 'critic'] },
      { name: 'Synthese', type: 'sequential', roles: ['writer'] },
    ],
  },
  'code-project': {
    name: 'Code-Projekt',
    phases: [
      { name: 'Planung', type: 'sequential', roles: ['planner'] },
      { name: 'Implementation', type: 'parallel', roles: ['coder', 'coder'] },
      { name: 'Review', type: 'parallel', roles: ['critic', 'coder'] },
      { name: 'Dokumentation', type: 'sequential', roles: ['writer'] },
    ],
  },
  'decision-making': {
    name: 'Entscheidungsfindung',
    phases: [
      { name: 'Optionen sammeln', type: 'parallel', roles: ['researcher', 'creative'] },
      { name: 'Pro & Contra', type: 'parallel', roles: ['analyst', 'devil_advocate'] },
      { name: 'Empfehlung', type: 'voting', roles: ['planner', 'critic', 'analyst'] },
    ],
  },
  'brainstorm-refine': {
    name: 'Brainstorm → Refine',
    phases: [
      { name: 'Ideation', type: 'parallel', roles: ['creative', 'creative', 'creative'] },
      { name: 'Bewertung', type: 'parallel', roles: ['critic', 'analyst'] },
      { name: 'Verfeinerung', type: 'sequential', roles: ['planner'] },
    ],
  },
  'content-creation': {
    name: 'Content-Erstellung',
    phases: [
      { name: 'Recherche', type: 'parallel', roles: ['researcher'] },
      { name: 'Outline', type: 'sequential', roles: ['planner'] },
      { name: 'Entwurf', type: 'sequential', roles: ['writer'] },
      { name: 'Review', type: 'parallel', roles: ['critic', 'devil_advocate'] },
      { name: 'Final', type: 'sequential', roles: ['writer'] },
    ],
  },
};

class SwarmServiceV2 extends EventEmitter {
  constructor(config = {}) {
    super();
    this.agentManager = config.agentManager;
    this.gateway      = config.gateway;
    this.maxParallel  = config.maxParallel || 5;
    this.dataDir      = config.dataDir || path.join(os.homedir(), '.johnny', 'swarms');

    this.activeSwarms = new Map();
    this.swarmHistory = [];
    this.sharedMemory = new Map();  // Geteiltes Gedächtnis zwischen Agenten
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this._loadHistory();
    console.log(`[SwarmV2] Initialisiert, ${this.swarmHistory.length} vergangene Swarms`);
  }

  // ════════════════════════════════════════════════════════════════════
  // SWARM STARTEN
  // ════════════════════════════════════════════════════════════════════

  /**
   * Startet einen einfachen parallelen Swarm (Kompatibilität mit v1)
   */
  async runSwarm(config) {
    const {
      goal,
      type = 'research',
      tasks = [],
      agents = [],
      coordinator = 'Johnny',
      timeout = 120000,
    } = config;

    // Wenn ein Pipeline-Template existiert, nutze die Pipeline
    if (PIPELINE_TEMPLATES[type]) {
      return this.runPipeline(goal, type, { timeout });
    }

    // Ansonsten: einfacher paralleler Swarm (v1-Kompatibilität)
    return this._runSimpleSwarm({ goal, type, tasks, agents, coordinator, timeout });
  }

  /**
   * Startet eine Multi-Phase Pipeline
   */
  async runPipeline(goal, templateName, options = {}) {
    const template = PIPELINE_TEMPLATES[templateName];
    if (!template) throw new Error(`Pipeline-Template "${templateName}" nicht gefunden. Verfügbar: ${Object.keys(PIPELINE_TEMPLATES).join(', ')}`);

    const { timeout = 180000, context = {} } = options;
    const pipelineId = uuidv4().slice(0, 8);

    console.log(`[SwarmV2:${pipelineId}] Starting pipeline "${template.name}" for: "${goal}"`);

    const pipeline = {
      id: pipelineId,
      goal,
      template: templateName,
      status: 'running',
      phases: [],
      startedAt: Date.now(),
      finishedAt: null,
      sharedContext: { goal, ...context },
    };

    this.activeSwarms.set(pipelineId, pipeline);
    this.sharedMemory.set(pipelineId, new Map());
    this._emit('pipeline.started', { pipelineId, goal, template: templateName, phases: template.phases.length });

    try {
      let previousPhaseResults = null;

      for (let i = 0; i < template.phases.length; i++) {
        const phase = template.phases[i];
        const phaseId = `${pipelineId}-phase-${i}`;

        this._emit('phase.started', { pipelineId, phaseId, name: phase.name, type: phase.type, index: i });

        const phaseResult = await this._executePhase(
          pipelineId, phaseId, phase, goal, previousPhaseResults, timeout
        );

        pipeline.phases.push({
          name: phase.name,
          type: phase.type,
          roles: phase.roles,
          result: phaseResult,
          completedAt: new Date().toISOString(),
        });

        // Ergebnis als Kontext für nächste Phase
        previousPhaseResults = phaseResult;

        // Shared Memory aktualisieren
        const mem = this.sharedMemory.get(pipelineId);
        if (mem) mem.set(`phase_${i}`, phaseResult);

        this._emit('phase.completed', { pipelineId, phaseId, name: phase.name, index: i });
      }

      // Finale Synthese
      const synthesis = await this._finalSynthesis(pipelineId, pipeline, goal);

      pipeline.status = 'completed';
      pipeline.finishedAt = Date.now();
      pipeline.synthesis = synthesis;

      this._emit('pipeline.completed', {
        pipelineId, goal, duration: pipeline.finishedAt - pipeline.startedAt,
        phases: pipeline.phases.length,
      });

      // Historie speichern
      this.swarmHistory.push({
        id: pipelineId, goal, template: templateName,
        phaseCount: pipeline.phases.length,
        duration: pipeline.finishedAt - pipeline.startedAt,
        ts: new Date().toISOString(),
      });
      this._saveHistory();

      return {
        pipelineId,
        goal,
        template: templateName,
        phases: pipeline.phases.map(p => ({
          name: p.name,
          type: p.type,
          roles: p.roles,
          resultPreview: typeof p.result === 'string' ? p.result.slice(0, 300) : JSON.stringify(p.result).slice(0, 300),
        })),
        synthesis,
        duration: pipeline.finishedAt - pipeline.startedAt,
      };
    } catch (e) {
      pipeline.status = 'error';
      pipeline.error = e.message;
      this._emit('pipeline.error', { pipelineId, error: e.message });
      throw e;
    } finally {
      this.sharedMemory.delete(pipelineId);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // PHASE-AUSFÜHRUNG
  // ════════════════════════════════════════════════════════════════════

  async _executePhase(pipelineId, phaseId, phase, goal, previousResults, timeout) {
    const contextStr = previousResults
      ? (typeof previousResults === 'string' ? previousResults : JSON.stringify(previousResults)).slice(0, 3000)
      : '';

    switch (phase.type) {
      case 'parallel':
        return this._executeParallelPhase(phase, goal, contextStr, timeout);
      case 'sequential':
        return this._executeSequentialPhase(phase, goal, contextStr, timeout);
      case 'voting':
        return this._executeVotingPhase(phase, goal, contextStr, timeout);
      default:
        return this._executeParallelPhase(phase, goal, contextStr, timeout);
    }
  }

  async _executeParallelPhase(phase, goal, context, timeout) {
    const promises = phase.roles.map(async (roleName) => {
      const role = AGENT_ROLES[roleName] || AGENT_ROLES.researcher;
      const prompt = this._buildRolePrompt(role, goal, context, phase.name);

      try {
        const result = await Promise.race([
          this.agentManager.sendMessage('Johnny', prompt),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), timeout)),
        ]);
        return { role: roleName, result: result.response, status: 'completed' };
      } catch (e) {
        return { role: roleName, error: e.message, status: 'error' };
      }
    });

    const results = await Promise.allSettled(promises);
    return results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message, status: 'error' });
  }

  async _executeSequentialPhase(phase, goal, context, timeout) {
    let currentContext = context;

    for (const roleName of phase.roles) {
      const role = AGENT_ROLES[roleName] || AGENT_ROLES.researcher;
      const prompt = this._buildRolePrompt(role, goal, currentContext, phase.name);

      try {
        const result = await Promise.race([
          this.agentManager.sendMessage('Johnny', prompt),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), timeout)),
        ]);
        currentContext = result.response;
      } catch (e) {
        currentContext += `\n[${roleName} Fehler: ${e.message}]`;
      }
    }

    return currentContext;
  }

  async _executeVotingPhase(phase, goal, context, timeout) {
    // Jeder Agent gibt seine Empfehlung ab
    const votes = await this._executeParallelPhase(phase, goal, context, timeout);

    // Voting-Synthese
    const voteSummary = votes
      .filter(v => v.status === 'completed')
      .map(v => `${v.role}: ${v.result.slice(0, 500)}`)
      .join('\n\n');

    const votePrompt = `Mehrere Experten haben ihre Empfehlungen abgegeben zum Thema: "${goal}"

${voteSummary}

Analysiere die Übereinstimmungen und Unterschiede.
Erstelle einen Konsens oder dokumentiere die Meinungsverschiedenheiten.
Gib eine finale Empfehlung mit Begründung.`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', votePrompt);
      return {
        votes: votes.map(v => ({ role: v.role, vote: v.result?.slice(0, 200) })),
        consensus: result.response,
      };
    } catch (e) {
      return { votes, consensus: `Konsens-Findung fehlgeschlagen: ${e.message}`, error: true };
    }
  }

  _buildRolePrompt(role, goal, context, phaseName) {
    return `${role.systemPrompt}

AUFGABE (Phase: ${phaseName}):
${goal}

${context ? `KONTEXT AUS VORHERIGER PHASE:\n${context}\n` : ''}
Stärken die du einsetzen sollst: ${role.strengths.join(', ')}

Antworte auf Deutsch, strukturiert und prägnant.`;
  }

  // ════════════════════════════════════════════════════════════════════
  // SYNTHESE
  // ════════════════════════════════════════════════════════════════════

  async _finalSynthesis(pipelineId, pipeline, goal) {
    const phasesSummary = pipeline.phases.map((p, i) => {
      const resultStr = typeof p.result === 'string'
        ? p.result.slice(0, 800)
        : JSON.stringify(p.result).slice(0, 800);
      return `PHASE ${i + 1} - ${p.name} (${p.type}, Rollen: ${p.roles.join(', ')}):\n${resultStr}`;
    }).join('\n\n---\n\n');

    const prompt = `Du bist der Koordinator einer Multi-Phasen-Pipeline.
Ziel: "${goal}"

Ergebnisse aller Phasen:
${phasesSummary}

Erstelle eine umfassende Synthese:
1. Zusammenfassung der wichtigsten Erkenntnisse
2. Konkrete Ergebnisse und Empfehlungen
3. Offene Punkte und nächste Schritte

Antworte auf Deutsch, klar strukturiert.`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      return result.response;
    } catch (e) {
      return `Synthese fehlgeschlagen: ${e.message}\n\nRohdaten der Phasen:\n${phasesSummary}`;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // EINFACHER SWARM (v1-Kompatibilität)
  // ════════════════════════════════════════════════════════════════════

  async _runSimpleSwarm({ goal, type, tasks, agents, coordinator, timeout }) {
    const swarmId = uuidv4().slice(0, 8);
    console.log(`[SwarmV2:${swarmId}] Simple swarm: "${goal}"`);

    const swarm = {
      id: swarmId, goal, type, coordinator, status: 'running',
      tasks: [], results: [], startedAt: Date.now(), finishedAt: null,
    };
    this.activeSwarms.set(swarmId, swarm);
    this._emit('swarm.started', { swarmId, goal, type });

    try {
      let taskList = tasks.length > 0
        ? tasks
        : await this._autoSplitTasks(goal, type, agents);

      swarm.tasks = taskList.map((t, i) => ({
        id: `${swarmId}-${i}`, agent: t.agent || coordinator,
        prompt: t.prompt, status: 'pending', result: null,
      }));

      // Parallel ausführen
      const promises = swarm.tasks.map(async (task) => {
        task.status = 'running';
        try {
          const result = await Promise.race([
            this.agentManager.sendMessage(task.agent, task.prompt),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), timeout)),
          ]);
          task.status = 'completed';
          task.result = result.response;
          return { taskId: task.id, result: result.response };
        } catch (e) {
          task.status = 'error';
          task.result = `Error: ${e.message}`;
          return { taskId: task.id, error: e.message };
        }
      });

      swarm.results = await Promise.allSettled(promises);

      const synthesis = await this._synthesize(swarm, coordinator);
      swarm.status = 'completed';
      swarm.finishedAt = Date.now();
      swarm.synthesis = synthesis;

      this._emit('swarm.completed', { swarmId, goal, duration: swarm.finishedAt - swarm.startedAt });
      return { swarmId, goal, synthesis, duration: swarm.finishedAt - swarm.startedAt };
    } catch (e) {
      swarm.status = 'error';
      throw e;
    }
  }

  async _autoSplitTasks(goal, type, agents) {
    if (!this.agentManager) throw new Error('AgentManager benötigt');

    const prompt = `Zerlege dieses Ziel in ${this.maxParallel} unabhängige Teilaufgaben:
Ziel: "${goal}"
Typ: ${type}
Antworte als JSON: [{"prompt":"..."}]`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      const json = result.response.match(/\[[\s\S]*\]/);
      if (json) {
        const parsed = JSON.parse(json[0]);
        const available = agents.length > 0 ? agents : ['Johnny'];
        return parsed.map((t, i) => ({ ...t, agent: available[i % available.length] }));
      }
    } catch {}

    return [
      { prompt: `Recherchiere Hintergrund: ${goal}`, agent: 'Johnny' },
      { prompt: `Finde Beispiele für: ${goal}`, agent: 'Johnny' },
      { prompt: `Identifiziere Risiken bei: ${goal}`, agent: 'Johnny' },
      { prompt: `Schlage Maßnahmen vor für: ${goal}`, agent: 'Johnny' },
    ];
  }

  async _synthesize(swarm, coordinator) {
    const summaries = swarm.tasks
      .map((t, i) => `Task ${i + 1} (${t.agent}): ${(t.result || '').slice(0, 800)}`)
      .join('\n\n');

    const prompt = `Fasse die Ergebnisse von ${swarm.tasks.length} Agenten zusammen.
Ziel: "${swarm.goal}"

Ergebnisse:\n${summaries}

Erstelle eine klare, umsetzbare Zusammenfassung. Antworte auf Deutsch.`;

    try {
      const result = await this.agentManager.sendMessage(coordinator, prompt);
      return result.response;
    } catch (e) {
      return `Synthese fehlgeschlagen: ${e.message}\n\nRohdaten:\n${summaries}`;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // STATUS & MANAGEMENT
  // ════════════════════════════════════════════════════════════════════

  getActiveSwarms() {
    return [...this.activeSwarms.values()].map(s => ({
      id: s.id, goal: s.goal, status: s.status,
      template: s.template || null,
      phases: s.phases?.length || 0,
      duration: (s.finishedAt || Date.now()) - s.startedAt,
    }));
  }

  getSwarm(swarmId) {
    return this.activeSwarms.get(swarmId);
  }

  getAvailableRoles() {
    return Object.entries(AGENT_ROLES).map(([key, role]) => ({
      id: key, name: role.name, strengths: role.strengths,
    }));
  }

  getAvailablePipelines() {
    return Object.entries(PIPELINE_TEMPLATES).map(([key, tpl]) => ({
      id: key,
      name: tpl.name,
      phases: tpl.phases.map(p => ({ name: p.name, type: p.type, roles: p.roles })),
    }));
  }

  getHistory(limit = 20) {
    return this.swarmHistory.slice(-limit).reverse();
  }

  async cancelSwarm(swarmId) {
    const swarm = this.activeSwarms.get(swarmId);
    if (swarm) {
      swarm.status = 'cancelled';
      swarm.finishedAt = Date.now();
      this._emit('swarm.cancelled', { swarmId });
    }
  }

  // ── Events & Persistenz ──────────────────────────────────────────────

  _emit(channel, data) {
    this.emit(channel, data);
    if (this.gateway) this.gateway.publish(channel, data);
  }

  async _loadHistory() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'history.json'), 'utf-8');
      this.swarmHistory = JSON.parse(raw);
    } catch { this.swarmHistory = []; }
  }

  async _saveHistory() {
    try {
      const tmp = path.join(this.dataDir, 'history.json.tmp');
      const fin = path.join(this.dataDir, 'history.json');
      await fs.writeFile(tmp, JSON.stringify(this.swarmHistory.slice(-200)));
      await fs.rename(tmp, fin);
    } catch (e) {
      console.error('[SwarmV2] History-Speicherung fehlgeschlagen:', e.message);
    }
  }
}

module.exports = SwarmServiceV2;
