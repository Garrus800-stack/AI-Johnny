const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const { promisify } = require('util');
const JohnnyCore = require('./JohnnyCore');
const EventBus = require('../core/EventBus');
const logger = require('../core/Logger');
const SecurityService = require('./SecurityService');

const execAsync = promisify(exec);

class AgentManager {
  constructor(config) {
    this.ollamaService = config.ollamaService;
    this.modelProvider = config.modelProvider;
    this.pluginManager = config.pluginManager;
    this.agentsDir = config.agentsDir;
    this.knowledgeDir = config.knowledgeDir;
    this.agents = new Map();
    this.conversations = new Map();
    this.toolRegistry = new Map();

    // Injizierte Services (werden von main.js gesetzt)
    this.browserService = config.browserService || null;
    this.visionService = config.visionService || null;
    this.searchService = config.searchService || null;
    this.ragService = config.ragService || null;
    this.sandboxService = config.sandboxService || null;
    this.imageGenService = config.imageGenService || null;
    this.videoService = config.videoService || null;
    this.smartHomeService = config.smartHomeService || null;
    this.integrationsService = config.integrationsService || null;
    this.cdpBrowserService = config.cdpBrowserService || null;
    this.selfImprovementService = config.selfImprovementService || null;
    this.swarmService = null; // set after init from main.js

    // v2.0: Neue Services
    this.nlpService = config.nlpService || null;
    this.sensorService = config.sensorService || null;
    this.webAutonomyService = config.webAutonomyService || null;
    this.speechService = config.speechService || null;

    // ── SecurityService ───────────────────────────────────────────────────
    this.security = config.securityService || null;

    // ── Concurrency-Lock: verhindert Race Conditions bei parallelen Nachrichten ──
    // Map<agentName, Promise>  — jeder Agent hat seinen eigenen serialisierten Queue
    this._agentLocks = new Map();

    // ── v1.7: SQLite ConversationStore (gesetzt von main.js post-init) ──────
    this.conversationStore = config.conversationStore || null;

    // ── v3.0: Tool-Analytics ────────────────────────────────────────────
    this._toolAnalytics = new Map(); // toolName → { calls, successes, failures, totalMs, lastUsed }

    // ── v3.0: Token-Schätzungs-Konstanten ───────────────────────────────
    this.CHARS_PER_TOKEN = 3.5;  // Durchschnitt für gemischten DE/EN-Text

    // Johnnys Kern-Persoenlichkeit
    this.johnny = new JohnnyCore({
      dataDir: path.join(config.knowledgeDir, '_johnny_identity')
    });

    // Basis-Tools registrieren
    this.registerDefaultTools();
    // Johnny Self-Improvement Tools registrieren
    this._registerSelfImprovementTools();
  }

  async initialize() {
    console.log('Initializing Agent Manager...');

    // Johnnys Persoenlichkeit laden
    await this.johnny.initialize();

    // Lade existierende Agenten
    await this.loadAgents();

    // NUR Johnny bekommt das aktive Modell — andere Agenten behalten ihr eigenes
    // (Sonst verliert z.B. ein ResearchBot mit GPT-4 sein Modell nach Neustart)
    if (this.ollamaService && this.ollamaService.model) {
      const johnny = this.agents.get('Johnny');
      if (johnny && (johnny.modelProvider || 'ollama') === 'ollama') {
        johnny.model = this.ollamaService.model;
        console.log(`[Init] Johnny model synced to: ${this.ollamaService.model}`);
      }
    }

    console.log(`Agent Manager initialized with ${this.agents.size} agents`);
    console.log(`  browserService : ${this.browserService ? '✓' : '✗'}`);
    console.log(`  visionService  : ${this.visionService  ? '✓' : '✗'}`);
    console.log(`  searchService  : ${this.searchService  ? '✓' : '✗'}`);
    console.log(`  nlpService     : ${this.nlpService     ? '✓' : '✗'}`);
    console.log(`  sensorService  : ${this.sensorService  ? '✓' : '✗'}`);
    console.log(`  webAutonomy    : ${this.webAutonomyService ? '✓' : '✗'}`);
    console.log(`  speechService  : ${this.speechService  ? '✓' : '✗'}`);
    console.log(`  ragService     : ${this.ragService     ? '✓' : '✗'}`);
    console.log(`  sandboxService : ${this.sandboxService ? '✓ ('+this.sandboxService.resolvedMode+')' : '✗'}`);
  }

  async loadAgents() {
    try {
      const files = await fs.readdir(this.agentsDir);
      
      for (const file of files) {
        if (file.endsWith('.md')) {
          const agentPath = path.join(this.agentsDir, file);
          const content = await fs.readFile(agentPath, 'utf-8');
          const agent = this.parseAgentMarkdown(content);
          this.agents.set(agent.name, agent);
        }
      }
    } catch (error) {
      console.error('Error loading agents:', error);
    }
  }

  parseAgentMarkdown(content) {
    // Parse YAML frontmatter und Markdown
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const agent = {
      conversations: [],
      memory: [],
      tools: []
    };

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      frontmatter.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        if (key && value) {
          const k = key.trim();
          // Parse capabilities and arrays as actual arrays
          if (k === 'capabilities') {
            agent[k] = value.split(',').map(s => s.trim()).filter(Boolean);
          } else if (value === 'true') {
            agent[k] = true;
          } else if (value === 'false') {
            agent[k] = false;
          } else {
            agent[k] = value;
          }
        }
      });
    }

    return agent;
  }

  async createAgent(config) {
    const agent = {
      id: uuidv4(),
      name: config.name,
      role: config.role || 'Assistant',
      personality: config.personality || 'Helpful and friendly',
      capabilities: config.capabilities || ['tool-calling'],
      isCore: config.isCore || false,
      modelProvider: config.modelProvider || 'ollama',
      model: config.model || '',
      created: new Date().toISOString(),
      memory: [],
      conversations: [],
      tools: config.tools || []
    };

    // Speichere Agent als Markdown
    await this.saveAgentMarkdown(agent);
    
    // Registriere im Memory
    this.agents.set(agent.name, agent);

    console.log(`Agent created: ${agent.name} (${agent.modelProvider}/${agent.model})`);
    
    return agent;
  }

  async saveAgentMarkdown(agent) {
    const markdown = `---
name: ${agent.name}
role: ${agent.role}
personality: ${agent.personality}
created: ${agent.created}
capabilities: ${agent.capabilities.join(', ')}
isCore: ${agent.isCore}
modelProvider: ${agent.modelProvider || 'ollama'}
model: ${agent.model || ''}
---

# ${agent.name}

## Role
${agent.role}

## Personality
${agent.personality}

## Capabilities
${agent.capabilities.map(c => `- ${c}`).join('\n')}

## Memory
${agent.memory.length > 0 ? agent.memory.map(m => typeof m === 'string' ? `- ${m}` : `- [${m.timestamp || ''}] ${m.content || m}`).join('\n') : '_Empty_'}

## Recent Conversations
${agent.conversations.length > 0 ? `_${agent.conversations.length} conversations_` : '_No conversations yet_'}
`;

    const filename = `${agent.name.toLowerCase().replace(/\s/g, '-')}.md`;
    const filepath = path.join(this.agentsDir, filename);
    await fs.writeFile(filepath, markdown, 'utf-8');
  }

  async sendMessage(agentName, message, conversationId = null, options = {}) {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent ${agentName} not found`);
    }

    // ── Serialisierter Queue pro Agent (verhindert parallele Race Conditions) ──
    const prev = this._agentLocks.get(agentName) || Promise.resolve();
    let releaseLock;
    const lockPromise = new Promise(res => { releaseLock = res; });
    this._agentLocks.set(agentName, prev.then(() => lockPromise));
    try {
      await prev; // Warte bis vorherige Nachricht fertig ist
      return await this._sendMessageInternal(agentName, message, conversationId, options);
    } finally {
      releaseLock();
      // Lock aufräumen wenn keine weiteren ausstehen
      if (this._agentLocks.get(agentName) === lockPromise) {
        this._agentLocks.delete(agentName);
      }
    }
  }

  async _sendMessageInternal(agentName, message, conversationId = null, options = {}) {
    const agent = this.agents.get(agentName);
    if (!agent) throw new Error(`Agent ${agentName} not found`);

    // ── User-Isolation: userId pro Aufruf, nicht global ─────────────────
    const userId = options.userId || this.johnny?.self?.activeUserId || 'default';
    if (this.johnny && userId !== this.johnny.self.activeUserId) {
      this.johnny.setActiveUser(userId);
    }

    const convId = conversationId || uuidv4();
    let conversation = await this.loadConversation(agentName, convId);
    if (!conversation) {
      conversation = {
        id: convId,
        agent: agentName,
        created: new Date().toISOString(),
        messages: []
      };
    }

    // ── RAG: Relevante Erinnerungen abrufen ──────────────────────────────────
    let ragContext = '';
    if (this.ragService) {
      try {
        const recalled = await this.ragService.searchKnowledge(message, agentName);
        if (recalled && recalled.results && recalled.results.length > 0) {
          ragContext = '\n\n[Relevante Erinnerungen aus vergangenen Gesprächen:\n' +
            recalled.results.map(r => `- ${r.content}`).join('\n') + ']';
        }
      } catch (e) {
        console.warn('RAG recall failed:', e.message);
      }
    }

    conversation.messages.push({
      role: 'user',
      content: ragContext ? message + ragContext : message,
      timestamp: new Date().toISOString()
    });

    // ── Context Memory: User-Nachricht tracken (v1.6) ──────────────────
    if (this.contextMemory) {
      try { this.contextMemory.trackMessage('user', message, { userId: this.johnny?.self?.activeUserId }); } catch {}
    }

    // ── v1.8: StyleProfile — Auto-Erkennung aus Nutzertext ────────────────
    if (this.styleProfile) {
      try {
        const userId = this.johnny?.self?.activeUserId || 'default';
        await this.styleProfile.processMessage(message, userId);
      } catch {}
    }

    // ── Feedback Learning: Implizites Feedback erkennen (v1.6) ─────────
    if (this.feedbackLearning && conversation.messages.length >= 3) {
      try {
        const prevAssistant = [...conversation.messages].reverse().find(m => m.role === 'assistant');
        const prevUser = [...conversation.messages].reverse().filter(m => m.role === 'user')[1];
        if (prevAssistant) {
          this.feedbackLearning.detectImplicitFeedback(
            message, prevAssistant.content,
            { userId: this.johnny?.self?.activeUserId, previousUserMessage: prevUser?.content }
          );
        }
      } catch {}
    }

    // ── Routing: Johnny vs. andere Agenten ────────────────────────────────────
    let response;
    if (agentName === 'Johnny') {
      // Johnny benutzt seinen eigenen Kern
      response = await this.johnnyThinkAndAct(agent, conversation, message);
    } else {
      // Andere Agenten: standard tool-call loop
      response = await this.executeToolCallLoop(agent, conversation);
    }

    // ── RAG: Konversation speichern ───────────────────────────────────────────
    if (this.ragService) {
      try {
        await this.ragService.addConversation(
          agentName,
          [{ role: 'user', content: message }, { role: 'assistant', content: response }],
          { conversationId: convId }
        );
      } catch (e) { /* silent */ }
    }

    await this.saveConversationMarkdown(agentName, conversation);

    // ── Context Memory: Antwort tracken (v1.6) ──────────────────────────
    if (this.contextMemory) {
      try { this.contextMemory.trackMessage('assistant', response, { userId: this.johnny?.self?.activeUserId }); } catch {}
    }

    return { conversationId: convId, response, agent: agentName };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // JOHNNYS DENK- UND HANDLUNGSSYSTEM v3
  // ══════════════════════════════════════════════════════════════════════════
  //
  //  Verbesserungen v3 vs. v2:
  //  ─────────────────────────────────────────────────────────────────
  //  1. Chain-of-Thought: Bei komplexen Aufgaben zuerst planen, dann handeln
  //  2. Thought-Extraction: <think>-Tags separieren Denken von Ausgabe
  //  3. Tool-Validierung: Prüft ob Tool existiert bevor es aufgerufen wird
  //  4. Error-Recovery: Injiziert Fehler-Kontext damit LLM sich korrigiert
  //  5. Loop-/Stuck-Detection: Erkennt wiederholte Patterns und bricht aus
  //  6. Tool-Result-Cache: Read-Only-Tools mit gleichen Params werden gecacht
  //  7. First-Message-Pinning: Ursprüngliche User-Frage nie aus Kontext entfernt
  //  8. Adaptive Temperature: Niedriger für Tool-Calls, höher für kreative Antworten
  //  9. Concurrency-Limiting: Max 4 parallele Tools gleichzeitig
  // 10. Progressive Compression: Mehrstufiges Kontext-Trimming
  // 11. Self-Correction: Ab 3+ Fehlern werden Korrektur-Hints injiziert
  // 12. Timing: Detailliertes Performance-Logging pro Phase
  // ══════════════════════════════════════════════════════════════════════════

  async johnnyThinkAndAct(agent, conversation, rawMessage) {
    const startTime = Date.now();
    const tools     = this.getToolsForAgent(agent);
    const modelName = agent.model || (this.ollamaService ? this.ollamaService.model : 'unknown');

    // ── Komplexitäts-Analyse ──────────────────────────────────────────────
    const complexity = this.johnny.assessComplexity(rawMessage);

    // ── Adaptive Konfiguration basierend auf Komplexität ──────────────────
    const config = this._getThinkConfig(complexity, modelName);

    // ── 1. System-Prompt aufbauen (dynamische Größe nach Modell-Budget) ────
    const maxPromptChars = Math.round(config.tokenBudget * 0.4); // 40% des Budgets für System-Prompt
    const systemPrompt = this.johnny.buildSystemPrompt(tools, conversation.messages, {
      modelName,
      lastMessage: rawMessage,
      userId: this.johnny.self.activeUserId,
      maxPromptChars,
    });

    EventBus.emit('agent:think-start', { agent: 'Johnny', message: rawMessage.slice(0, 80), complexity: complexity.score });

    // ── 2. Kontext mit First-Message-Pinning ──────────────────────────────
    const contextMsgs = this._buildSmartContext(conversation.messages, systemPrompt, config.tokenBudget);

    // ── 3. Chain-of-Thought Phase für komplexe Aufgaben ───────────────────
    if (complexity.needsPlan && contextMsgs.length > 0) {
      const lastMsg = contextMsgs[contextMsgs.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content = lastMsg.content +
          '\n\n[SYSTEM-HINWEIS: Diese Aufgabe ist komplex. ' +
          'Denke in <think>...</think>-Tags zuerst über deinen Plan nach: ' +
          'Welche Schritte? Welche Tools? In welcher Reihenfolge? ' +
          'Dann handle Schritt für Schritt.]';
      }
    }

    // ── 4. Denk-Loop ──────────────────────────────────────────────────────
    let iteration       = 0;
    let finalResponse   = '';
    let toolErrors      = 0;
    let toolSuccesses   = 0;
    let consecutiveErrors = 0;
    const usedTools     = new Set();
    const toolCache     = new Map();   // Cache für Read-Only-Tool-Ergebnisse
    const toolPattern   = [];          // Für Loop-Detection
    let thoughts        = [];          // Gesammelte <think>-Blöcke
    let lastToolNames   = [];          // Für Stuck-Detection

    console.log(`[Johnny v3] "${rawMessage.slice(0, 60)}..." | ${tools.length} tools | ctx: ${contextMsgs.length} msgs | complexity: ${(complexity.score * 100).toFixed(0)}% | budget: ${config.tokenBudget}`);
    if (this.stepEmitter) this.stepEmitter({
      type: 'think',
      message: `💭 Johnny denkt...${complexity.needsPlan ? ' (komplexe Aufgabe → plane zuerst)' : ''}`,
    });

    while (iteration < config.maxIterations) {
      iteration++;
      const iterStart = Date.now();

      // ── LLM aufrufen ──────────────────────────────────────────────────
      let result;
      try {
        // Adaptive Temperature: niedriger während Tool-Phase, höher für finale Antwort
        const temp = iteration > 1 && toolSuccesses > 0 ? config.toolTemperature : config.baseTemperature;

        result = await this._generateWithRetry(() =>
          this._generateAsJohnny(agent, systemPrompt, contextMsgs, {
            temperature: temp,
            numCtx: config.numCtx,
          })
        );
      } catch (err) {
        console.error(`[Johnny v3] LLM-Fehler (Iteration ${iteration}):`, err.message);
        if (iteration === 1) {
          finalResponse = `Ich hatte ein technisches Problem: ${err.message}`;
        } else {
          finalResponse = await this._emergencySummary(agent, systemPrompt, contextMsgs, thoughts)
            .catch(() => 'Aufgabe teilweise abgeschlossen, dann trat ein Fehler auf.');
        }
        break;
      }

      const iterMs = Date.now() - iterStart;
      console.log(`[Johnny v3] Iteration ${iteration}: ${iterMs}ms | toolCalls: ${result.toolCalls?.length || 0}`);

      // ── Thought-Extraction: <think>-Tags separieren ─────────────────────
      const { cleanText, extractedThoughts } = this._extractThoughts(result.message);
      if (extractedThoughts.length) {
        thoughts.push(...extractedThoughts);
        result.message = cleanText;
      }

      // Antwort in History (mit raw für Tool-Call-Parsing)
      conversation.messages.push({
        role: 'assistant',
        content: result.rawMessage || result.message,
        timestamp: new Date().toISOString(),
        toolCalls: result.toolCalls,
      });
      contextMsgs.push({ role: 'assistant', content: result.rawMessage || result.message });

      // ── Keine Tools → fertig ────────────────────────────────────────────
      if (!result.toolCalls || result.toolCalls.length === 0) {
        finalResponse = result.message;
        break;
      }

      // ── Tool-Validierung: ungültige Tool-Names abfangen ─────────────────
      const validatedCalls = this._validateToolCalls(result.toolCalls, tools);
      if (validatedCalls.invalid.length > 0) {
        const errorMsg = `[Tool-Fehler: Unbekannte Tools: ${validatedCalls.invalid.map(t => t.tool).join(', ')}. ` +
          `Verfügbare Tools: ${tools.slice(0, 15).map(t => t.name).join(', ')}${tools.length > 15 ? '...' : ''}]`;
        contextMsgs.push({ role: 'user', content: errorMsg });
        conversation.messages.push({ role: 'tool', tool: '_validation', content: errorMsg, timestamp: new Date().toISOString() });
      }

      if (validatedCalls.valid.length === 0) {
        // Alle Tool-Calls waren ungültig → nächste Iteration
        toolErrors += validatedCalls.invalid.length;
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          this._injectCorrectionHint(contextMsgs, toolErrors, tools);
          consecutiveErrors = 0;
        }
        continue;
      }

      // ── Loop/Stuck-Detection ────────────────────────────────────────────
      const currentToolNames = validatedCalls.valid.map(tc => tc.tool).sort().join(',');
      toolPattern.push(currentToolNames);
      if (this._detectStuckPattern(toolPattern, lastToolNames, currentToolNames)) {
        console.warn(`[Johnny v3] Stuck-Pattern erkannt bei Iteration ${iteration} — erzwinge Zusammenfassung`);
        contextMsgs.push({ role: 'user', content:
          '[SYSTEM: Du wiederholst dich. Stoppe die Tool-Aufrufe und fasse zusammen was du bisher herausgefunden hast. Keine weiteren Tools.]'
        });
        lastToolNames = [];
        continue;
      }
      lastToolNames = [currentToolNames];

      // ── Tools klassifizieren und ausführen ───────────────────────────────
      const { parallel, sequential } = this._classifyToolDependencies(validatedCalls.valid, usedTools);

      // Parallele Tools (mit Concurrency-Limit)
      if (parallel.length > 0) {
        const batchResults = await this._executeParallelTools(parallel, agent, usedTools, toolCache, config.maxParallel);
        for (const br of batchResults) {
          if (br.success) { toolSuccesses++; consecutiveErrors = 0; }
          else { toolErrors++; consecutiveErrors++; }
          conversation.messages.push({ role: 'tool', tool: br.tool, content: br.toolResultStr, timestamp: new Date().toISOString() });
          contextMsgs.push({ role: 'user', content: `[Ergebnis von "${br.tool}"]: ${br.toolResultStr}` });
        }
      }

      // Sequentielle Tools
      for (const tc of sequential) {
        const { toolResultStr, success } = await this._executeToolCallCached(tc, agent, usedTools, toolCache);
        if (success) { toolSuccesses++; consecutiveErrors = 0; }
        else { toolErrors++; consecutiveErrors++; }
        conversation.messages.push({ role: 'tool', tool: tc.tool, content: toolResultStr, timestamp: new Date().toISOString() });
        contextMsgs.push({ role: 'user', content: `[Ergebnis von "${tc.tool}"]: ${toolResultStr}` });
      }

      // ── Self-Correction bei vielen Fehlern ──────────────────────────────
      if (consecutiveErrors >= 3) {
        this._injectCorrectionHint(contextMsgs, toolErrors, tools);
        consecutiveErrors = 0;
      }

      // ── Progressive Context-Compression ─────────────────────────────────
      this._trimContextProgressive(contextMsgs, config.tokenBudget);

      // ── Max-Iterationen-Schutz ──────────────────────────────────────────
      if (iteration >= config.maxIterations) {
        if (this.stepEmitter) this.stepEmitter({ type: 'think', message: '⚠️ Max-Iterationen erreicht — fasse zusammen...' });
        finalResponse = await this._emergencySummary(agent, systemPrompt, contextMsgs, thoughts)
          .catch(() => 'Aufgabe abgeschlossen.');
        break;
      }
    }

    // ── 5. Lernen, Statistik & Performance ────────────────────────────────
    const totalMs = Date.now() - startTime;

    await this.johnny.processInteraction(rawMessage, finalResponse, {
      toolsUsed: iteration > 1,
      toolErrors,
      toolSuccesses,
      iterations: iteration,
      modelName,
      durationMs: totalMs,
      complexity: complexity.score,
      thoughts: thoughts.length,
    });

    console.log(`[Johnny v3] ✓ ${iteration} Iter, ${toolSuccesses} OK, ${toolErrors} Err, ${totalMs}ms, Emotion: ${this.johnny.getMood()}`);
    return finalResponse || 'Fertig.';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HILFSMETHODEN FÜR johnnyThinkAndAct v3
  // ══════════════════════════════════════════════════════════════════════════

  // ── Adaptive Konfiguration basierend auf Komplexität + Modell ─────────────
  _getThinkConfig(complexity, modelName) {
    const isLargeModel = /70b|mixtral|gpt-4|claude-3|opus|sonnet|gemini-pro/i.test(modelName);

    return {
      maxIterations:   complexity.needsPlan ? 18 : (isLargeModel ? 14 : 10),
      tokenBudget:     Math.round((isLargeModel ? 10000 : 7000) * this.CHARS_PER_TOKEN),
      numCtx:          isLargeModel ? 16384 : 8192,
      baseTemperature: complexity.score > 0.7 ? 0.6 : 0.75,    // Komplexe Aufgaben → präziser
      toolTemperature: 0.4,                                      // Tool-Phase → deterministisch
      maxParallel:     4,                                         // Max gleichzeitige Tool-Calls
    };
  }

  // ── Thought-Extraction: <think>-Tags aus Antwort separieren ───────────────
  _extractThoughts(message) {
    if (!message) return { cleanText: '', extractedThoughts: [] };

    const extractedThoughts = [];
    const cleanText = message.replace(/<think>([\s\S]*?)<\/think>/gi, (_, content) => {
      extractedThoughts.push(content.trim());
      return '';  // Aus sichtbarer Antwort entfernen
    }).trim();

    return { cleanText: cleanText || message, extractedThoughts };
  }

  // ── Tool-Validierung: prüft ob Tools existieren ───────────────────────────
  _validateToolCalls(toolCalls, availableTools) {
    const toolNames = new Set(availableTools.map(t => t.name));
    const valid     = [];
    const invalid   = [];

    for (const tc of toolCalls) {
      if (toolNames.has(tc.tool)) {
        valid.push(tc);
      } else {
        // Fuzzy-Match: evtl. Tippfehler im Tool-Namen?
        const closest = this._findClosestToolName(tc.tool, toolNames);
        if (closest) {
          console.warn(`[Johnny v3] Tool "${tc.tool}" nicht gefunden, verwende "${closest}"`);
          valid.push({ ...tc, tool: closest, _corrected: true });
        } else {
          invalid.push(tc);
        }
      }
    }

    return { valid, invalid };
  }

  // ── Fuzzy-Match für Tool-Namen (Levenshtein-basiert) ──────────────────────
  _findClosestToolName(name, toolNames) {
    if (!name) return null;
    const nameLower = name.toLowerCase().replace(/[_-]/g, '');
    let bestMatch = null;
    let bestScore = Infinity;

    for (const tn of toolNames) {
      const tnLower = tn.toLowerCase().replace(/[_-]/g, '');
      // Exakte Substring-Matches zuerst
      if (tnLower.includes(nameLower) || nameLower.includes(tnLower)) {
        return tn;
      }
      // Levenshtein-Distanz für kurze Namen
      if (name.length <= 25 && tn.length <= 25) {
        const dist = this._levenshtein(nameLower, tnLower);
        if (dist < bestScore && dist <= 3) {
          bestScore = dist;
          bestMatch = tn;
        }
      }
    }

    return bestMatch;
  }

  _levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[b.length][a.length];
  }

  // ── Stuck/Loop-Detection ──────────────────────────────────────────────────
  _detectStuckPattern(toolPattern, lastToolNames, currentToolNames) {
    // Pattern-Wiederholung: gleiche Tool-Kombination 3x hintereinander
    if (toolPattern.length >= 3) {
      const last3 = toolPattern.slice(-3);
      if (last3.every(p => p === last3[0])) return true;
    }
    // ABAB-Pattern: alterniert zwischen zwei Mustern
    if (toolPattern.length >= 4) {
      const last4 = toolPattern.slice(-4);
      if (last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1]) return true;
    }
    return false;
  }

  // ── Self-Correction Hint bei vielen aufeinanderfolgenden Fehlern ──────────
  _injectCorrectionHint(contextMsgs, totalErrors, tools) {
    const availableToolList = tools.slice(0, 10).map(t => t.name).join(', ');
    contextMsgs.push({ role: 'user', content:
      `[SYSTEM: ${totalErrors} Tool-Fehler bisher. Überdenke deinen Ansatz. ` +
      `Optionen: (1) Anderen Tool verwenden, (2) Parameterformat korrigieren, ` +
      `(3) Direkte Antwort ohne Tools geben. ` +
      `Verfügbare Tools: ${availableToolList}]`
    });
  }

  // ── Tool-Call mit Cache (Read-Only-Tools werden gecacht) ──────────────────
  async _executeToolCallCached(toolCall, agent, usedTools, toolCache) {
    const cacheKey = `${toolCall.tool}:${JSON.stringify(toolCall.parameters)}`;

    // Duplikat-Check (identischer Aufruf bereits erfolgt)
    if (usedTools.has(cacheKey)) {
      // Prüfe ob im Cache
      if (toolCache.has(cacheKey)) {
        return { toolResultStr: toolCache.get(cacheKey), success: true, cached: true };
      }
      return { toolResultStr: `[Tool ${toolCall.tool} bereits aufgerufen — übersprungen]`, success: true };
    }
    usedTools.add(cacheKey);

    // Ausführen
    const result = await this._executeToolCall(toolCall, agent, usedTools);

    // Read-Only-Tools cachen
    if (result.success && this._isReadOnlyTool(toolCall.tool)) {
      toolCache.set(cacheKey, result.toolResultStr);
    }

    return result;
  }

  // ── Einzelnen Tool-Call ausführen ──────────────────────────────────────────
  async _executeToolCall(toolCall, agent, usedTools) {
    console.log(`[Johnny v3] Tool: ${toolCall.tool}${toolCall._corrected ? ' (korrigiert)' : ''}`);
    if (this.stepEmitter) this.stepEmitter({
      type: 'tool',
      message: `🔧 ${toolCall.tool}(${JSON.stringify(toolCall.parameters).slice(0, 80)})`,
    });

    const startMs = Date.now();
    let toolResult;
    let success = true;

    try {
      toolResult = await this._executeWithRetry(
        () => this.executeTool(toolCall.tool, toolCall.parameters, agent),
        2, 500  // Max 2 Retries, 500ms Basis-Delay
      );
      const durationMs = Date.now() - startMs;
      if (this.stepEmitter) this.stepEmitter({ type: 'done', message: `✓ ${toolCall.tool} (${durationMs}ms)` });
    } catch (err) {
      success = false;
      const durationMs = Date.now() - startMs;
      toolResult = {
        error: err.message,
        suggestion: `Tool "${toolCall.tool}" fehlgeschlagen. Versuche eine alternative Methode oder andere Parameter.`,
        durationMs,
      };
      if (this.stepEmitter) this.stepEmitter({ type: 'error', message: `✗ ${toolCall.tool}: ${err.message}` });
    }

    // Tool-Analytics tracken
    this._trackToolUsage(toolCall.tool, success, Date.now() - startMs);

    return { toolResultStr: this._compressToolResult(toolResult, toolCall.tool), success, tool: toolCall.tool };
  }

  // ── Parallele Tool-Ausführung mit Concurrency-Limit ───────────────────────
  async _executeParallelTools(toolCalls, agent, usedTools, toolCache, maxConcurrent = 4) {
    const results = [];

    // In Batches von maxConcurrent aufteilen
    for (let i = 0; i < toolCalls.length; i += maxConcurrent) {
      const batch = toolCalls.slice(i, i + maxConcurrent);
      const batchResults = await Promise.allSettled(
        batch.map(tc => this._executeToolCallCached(tc, agent, usedTools, toolCache))
      );

      for (let j = 0; j < batch.length; j++) {
        const tc = batch[j];
        const pr = batchResults[j];
        if (pr.status === 'fulfilled') {
          results.push({ ...pr.value, tool: tc.tool });
        } else {
          results.push({
            toolResultStr: `Error: ${pr.reason?.message || 'Unknown error'}`,
            success: false,
            tool: tc.tool,
          });
        }
      }
    }

    return results;
  }

  // ── Read-Only-Tool-Erkennung ──────────────────────────────────────────────
  _isReadOnlyTool(toolName) {
    const readOnly = new Set([
      'web_search', 'web_fetch', 'web_research', 'read_file', 'read_own_code',
      'list_directory', 'list_own_files', 'get_system_info', 'recall', 'context_stats',
      'error_dashboard', 'quality_report', 'get_change_log', 'get_project_stats',
      'brainstorm', 'change_perspective', 'generate_analogy', 'analyze_data',
      'list_backups', 'tool_analytics', 'describe_image', 'analyze_screenshot',
      'find_program', 'get_env', 'list_scheduled_tasks', 'get_clipboard',
      'search_conversations', 'daily_summary',
    ]);
    return readOnly.has(toolName);
  }

  // ── Tool-Abhängigkeits-Analyse → Parallel vs. Sequential ──────────────────
  _classifyToolDependencies(toolCalls, usedTools) {
    if (toolCalls.length <= 1) return { parallel: [], sequential: toolCalls };

    const parallel   = [];
    const sequential = [];

    for (const tc of toolCalls) {
      const toolKey = `${tc.tool}:${JSON.stringify(tc.parameters)}`;
      if (usedTools.has(toolKey)) {
        sequential.push(tc);  // Wiederholung → sequential (wird dort gecacht/übersprungen)
      } else if (this._isReadOnlyTool(tc.tool)) {
        parallel.push(tc);
      } else {
        sequential.push(tc);
      }
    }

    return { parallel, sequential };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // KONTEXT-MANAGEMENT v3
  // ══════════════════════════════════════════════════════════════════════════

  // ── Token-Schätzung mit modellspezifischen Faktoren ─────────────────────
  _estimateTokens(text, modelName = '') {
    if (!text) return 0;
    // Erkenne dominante Content-Art
    const isCode = (text.match(/[{}()[\];]/g) || []).length > text.length * 0.05;
    const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
    let factor = this.CHARS_PER_TOKEN;
    if (isJson)  factor = this._tokenFactors['json'] || 2.5;
    else if (isCode) factor = this._tokenFactors['code'] || 2.8;
    else {
      // Modell-spezifischer Faktor
      const modelKey = Object.keys(this._tokenFactors).find(k =>
        modelName.toLowerCase().includes(k)
      );
      if (modelKey) factor = this._tokenFactors[modelKey];
      else {
        // Spracherkennung: viele Umlaute → Deutsch
        const umlauts = (text.match(/[äöüÄÖÜß]/g) || []).length;
        factor = umlauts > text.length * 0.02
          ? this._tokenFactors['de'] || 3.2
          : this._tokenFactors['en'] || 4.0;
      }
    }
    return Math.ceil(text.length / factor);
  }

  // ── Intelligentes Kontextfenster mit First-Message-Pinning ────────────────
  _buildSmartContext(messages, systemPrompt, maxChars = 7000) {
    const systemCost = systemPrompt.length;
    let   budget     = maxChars - systemCost;

    const result = [];

    if (messages.length === 0) return result;

    // IMMER behalten: erste User-Nachricht (Original-Frage) + letzte Nachricht
    const first   = messages.find(m => m.role === 'user');
    const last    = messages[messages.length - 1];
    const pinned  = new Set();

    // Letzte Nachricht (aktuelle Anfrage) — höchste Priorität
    if (last) {
      const fmtLast = this._formatContextMsg(last);
      budget -= fmtLast.content.length;
      result.push(fmtLast);
      pinned.add(messages.length - 1);
    }

    // Erste User-Nachricht pinnen (wenn nicht = last)
    if (first && messages.indexOf(first) !== messages.length - 1) {
      const fmtFirst = this._formatContextMsg(first);
      if (budget - fmtFirst.content.length > 500) {
        result.unshift(fmtFirst);
        budget -= fmtFirst.content.length;
        pinned.add(messages.indexOf(first));
      }
    }

    // Rückwärts durchgehen: neuere haben Priorität
    for (let i = messages.length - 2; i >= 0; i--) {
      if (pinned.has(i)) continue;  // Bereits gepinnt

      const m    = messages[i];
      const fmt  = this._formatContextMsg(m);
      const cost = fmt.content.length;

      if (budget - cost < 200) {
        // Budget knapp — große Tool-Ergebnisse nur als Summary
        if (m.role === 'tool' && cost > 400) {
          const summary = { role: 'user', content: `[${m.tool} → ${(m.content || '').slice(0, 150)}...]` };
          if (budget - summary.content.length > 100) {
            result.splice(pinned.has(0) ? 1 : 0, 0, summary);
            budget -= summary.content.length;
          }
        }
        // Assistant-Nachrichten mit Tool-Calls: nur Tool-Namen behalten
        else if (m.role === 'assistant' && m.toolCalls?.length) {
          const toolSummary = { role: 'assistant', content: `[Tools aufgerufen: ${m.toolCalls.map(tc => tc.tool).join(', ')}]` };
          if (budget - toolSummary.content.length > 50) {
            result.splice(pinned.has(0) ? 1 : 0, 0, toolSummary);
            budget -= toolSummary.content.length;
          }
        }
        continue;
      }

      // An Position nach dem ersten gepinnten Element einfügen
      const insertIdx = pinned.has(messages.indexOf(first)) && i > messages.indexOf(first) ? result.length - 1 : 0;
      result.splice(Math.max(0, result.length - 1), 0, fmt);
      budget -= cost;
    }

    return result;
  }

  _formatContextMsg(m) {
    if (m.role === 'tool') {
      return { role: 'user', content: `[Ergebnis von Tool "${m.tool}"]: ${m.content || ''}` };
    }
    return { role: m.role === 'tool' ? 'user' : m.role, content: m.content || '' };
  }

  // ── Progressive Context-Compression (mehrstufig) ──────────────────────────
  _trimContextProgressive(contextMsgs, maxChars) {
    let total = contextMsgs.reduce((s, m) => s + (m.content || '').length, 0);
    if (total <= maxChars) return;

    // Stufe 1: Große Tool-Ergebnisse (>500 Zeichen) auf 300 kürzen
    for (let i = 0; i < contextMsgs.length - 2 && total > maxChars; i++) {
      const m = contextMsgs[i];
      if (m.role === 'user' && m.content.startsWith('[Ergebnis von') && m.content.length > 500) {
        const oldLen = m.content.length;
        contextMsgs[i] = { ...m, content: m.content.slice(0, 300) + '...[gekürzt]' };
        total -= (oldLen - contextMsgs[i].content.length);
      }
    }
    if (total <= maxChars) return;

    // Stufe 2: Mittlere Tool-Ergebnisse (>200) auf 150 kürzen
    for (let i = 0; i < contextMsgs.length - 2 && total > maxChars; i++) {
      const m = contextMsgs[i];
      if (m.role === 'user' && m.content.startsWith('[') && m.content.length > 200) {
        const oldLen = m.content.length;
        contextMsgs[i] = { ...m, content: m.content.slice(0, 150) + '...]' };
        total -= (oldLen - contextMsgs[i].content.length);
      }
    }
    if (total <= maxChars) return;

    // Stufe 3: Älteste Nachrichten entfernen (außer erste und letzte 3)
    while (total > maxChars && contextMsgs.length > 4) {
      const removed = contextMsgs.splice(1, 1)[0];  // Zweites Element (nach erstem Pin)
      total -= (removed.content || '').length;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LLM-GENERIERUNG & PARSING
  // ══════════════════════════════════════════════════════════════════════════

  // ── Tool-Ergebnis komprimieren (typbasiert) ───────────────────────────────
  _compressToolResult(result, toolName) {
    if (!result) return '{"error":"null result","complete":true}';

    const str = JSON.stringify(result, null, 2);
    const MAX = 3000;
    if (str.length <= MAX) return str;

    // Typbasierte Kompression
    // Suchergebnisse: nur Top-5
    if (result.results && Array.isArray(result.results)) {
      const top = result.results.slice(0, 5).map(r => {
        if (typeof r === 'object' && r.content && r.content.length > 200) {
          return { ...r, content: r.content.slice(0, 200) + '...' };
        }
        return r;
      });
      return JSON.stringify({ ...result, results: top, _totalResults: result.results.length, compressed: true }, null, 2);
    }

    // Große String-Felder: output, content, text, stdout
    for (const field of ['output', 'content', 'text', 'stdout', 'data']) {
      if (result[field] && typeof result[field] === 'string' && result[field].length > 2000) {
        return JSON.stringify({
          ...result,
          [field]: result[field].slice(0, 2000) + `\n...[${field} gekürzt: ${result[field].length} → 2000 Zeichen]`,
        });
      }
    }

    // Array-Felder kürzen
    for (const field of ['files', 'items', 'entries', 'list', 'tasks', 'events']) {
      if (Array.isArray(result[field]) && result[field].length > 20) {
        return JSON.stringify({
          ...result,
          [field]: result[field].slice(0, 20),
          [`_total_${field}`]: result[field].length,
          compressed: true,
        }, null, 2);
      }
    }

    // Generisch: truncate
    return str.slice(0, MAX) + `\n...[gekürzt: ${str.length} Zeichen total]`;
  }

  // ── Notfall-Zusammenfassung (verbessert mit Thought-Context) ──────────────
  async _emergencySummary(agent, systemPrompt, contextMsgs, thoughts = []) {
    const thoughtContext = thoughts.length > 0
      ? `\n\nDeine bisherigen Überlegungen:\n${thoughts.slice(-3).join('\n---\n')}`
      : '';

    const summaryPrompt = [
      ...contextMsgs.slice(-6),
      { role: 'user', content:
        'Fasse in 2–4 Sätzen zusammen was du herausgefunden oder erledigt hast. ' +
        'Nenne konkrete Ergebnisse. Keine weiteren Tool-Aufrufe.' + thoughtContext
      },
    ];
    try {
      const result = await Promise.race([
        this._generateAsJohnny(agent, systemPrompt, summaryPrompt, { temperature: 0.5 }),
        new Promise((_, r) => setTimeout(() => r(new Error('Summary timeout')), 30000)),
      ]);
      // Thoughts auch aus Summary extrahieren
      const { cleanText } = this._extractThoughts(result.message);
      return cleanText || result.message || 'Aufgabe abgeschlossen.';
    } catch {
      return 'Aufgabe wurde bearbeitet.';
    }
  }

  // ── Johnny-spezifische LLM-Generierung ─────────────────────────────────
  // Nutzt native Tool-Calls für Cloud-Provider, text-basiert für Ollama
  async _generateAsJohnny(agent, systemPrompt, contextMsgs, options = {}) {
    const provider = agent.modelProvider || 'ollama';
    const model    = agent.model || (this.ollamaService ? this.ollamaService.model : '');
    const messages = [{ role: 'system', content: systemPrompt }, ...contextMsgs];

    let rawContent = '';
    let nativeToolCalls = [];

    // ── Cloud-Provider: nutze ModelProvider mit nativen Tool-Calls ─────────
    if (provider !== 'ollama' && this.modelProvider) {
      const tools = this.modelProvider.supportsNativeTools(provider)
        ? this.getToolsForAgent(agent)
        : null;

      const result = await this.modelProvider.generate({
        provider, model, messages,
        tools,
        temperature: options.temperature ?? 0.7,
        maxTokens: options.maxTokens ?? 4096,
        streamCallback: (this.streamEmitter && !tools) ? this.streamEmitter : null,
      });

      rawContent = result.content || '';
      nativeToolCalls = result.toolCalls || [];

      // EventBus: LLM-Aufruf tracken
      EventBus.emit('agent:llm-call', {
        provider, model, tokens: result.usage?.total_tokens,
        nativeTools: nativeToolCalls.length > 0,
      });

      // Wenn native Tool-Calls zurückkamen → direkt verwenden
      if (nativeToolCalls.length > 0) {
        return { message: rawContent, rawMessage: rawContent, toolCalls: nativeToolCalls };
      }

      // Kein native Tool-Call → text-basierte Erkennung als Fallback
      const textToolCalls = this._parseToolCalls(rawContent);
      const cleanMessage = this._cleanToolSyntax(rawContent);
      return { message: cleanMessage, rawMessage: rawContent, toolCalls: textToolCalls };
    }

    // ── Ollama-Pfad: Streaming + text-basierte Tool-Erkennung ─────────────
    if (this.ollamaService) {
      rawContent = await this._callOllama(model || this.ollamaService.model, messages, {
        temperature: options.temperature ?? 0.75,
        numCtx: options.numCtx ?? 8192,
      });

      EventBus.emit('agent:llm-call', { provider: 'ollama', model });

      const toolCalls = this.ollamaService.parseToolCalls
        ? this.ollamaService.parseToolCalls(rawContent)
        : this._parseToolCalls(rawContent);

      const cleanMessage = this._cleanToolSyntax(rawContent);
      return { message: cleanMessage, rawMessage: rawContent, toolCalls };
    }

    throw new Error('Kein LLM-Provider verfügbar');
  }

  // ── Tool-Syntax aus Antwort entfernen ─────────────────────────────────────
  _cleanToolSyntax(raw) {
    if (!raw) return '';
    return raw
      .replace(/TOOL_CALL:\s*\{[\s\S]*?\}(?=\s*(?:TOOL_CALL|\n|$))/g, '')
      .replace(/```json\s*\{[\s\S]*?\}\s*```/g, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<<TOOL>>[\s\S]*?<<\/TOOL>>/g, '')
      .replace(/\{"tool"\s*:\s*"[^"]*"[\s\S]*?\}/g, (match) => {
        try { const p = JSON.parse(match); return p.tool ? '' : match; } catch { return match; }
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * sendToModel — einfacher LLM-Aufruf für v2.0-Services (CW, EV, TSA, EI)
   * Nutzt den aktiven Provider/Modell ohne Agent-Kontext
   */
  async sendToModel(prompt, options = {}) {
    const { systemPrompt, temperature = 0.7, maxTokens = 1500 } = options;
    const johnny = this.agents.get('Johnny');
    const provider = (johnny && johnny.modelProvider) || 'ollama';
    const model    = (johnny && johnny.model) || (this.ollamaService ? this.ollamaService.model : '');

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    if (provider !== 'ollama' && this.modelProvider) {
      const result = await this.modelProvider.generate({ provider, model, messages, temperature, maxTokens });
      return result.content || result.text || '';
    }

    // Ollama fallback
    const axios = require('axios');
    const baseUrl = (this.ollamaService && this.ollamaService.baseUrl) || 'http://127.0.0.1:11434';
    const response = await axios.post(`${baseUrl}/api/chat`, {
      model, messages,
      stream: false,
      options: { temperature, num_predict: maxTokens },
    }, { timeout: 120000 });
    return response.data?.message?.content || '';
  }

  // ── Ollama-Aufruf (Streaming + Fallback) ──────────────────────────────────
  async _callOllama(model, messages, options = {}) {
    const { temperature = 0.75, numCtx = 8192 } = options;

    if (this.streamEmitter) {
      return this._generateOllamaStreaming(model, messages, { temperature, numCtx });
    }

    const axios = require('axios');
    const response = await axios.post(`${this.ollamaService.baseUrl}/api/chat`, {
      model,
      messages,
      stream: false,
      options: { temperature, num_ctx: numCtx },
    }, { timeout: 120000 });
    return response.data.message.content;
  }

  // ── Ollama Streaming ──────────────────────────────────────────────────────
  async _generateOllamaStreaming(model, messages, options = {}) {
    const { temperature = 0.75, numCtx = 8192 } = options;
    const axios  = require('axios');
    const chunks = [];
    let buffer   = '';

    try {
      const response = await axios.post(
        `${this.ollamaService.baseUrl}/api/chat`,
        { model, messages, stream: true, options: { temperature, num_ctx: numCtx } },
        { responseType: 'stream', timeout: 180000 }  // 3 Min für lange Generierungen
      );

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          response.data.destroy();
          reject(new Error('Stream timeout (180s)'));
        }, 180000);

        response.data.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              const text   = parsed?.message?.content || '';
              if (text) {
                chunks.push(text);
                if (this.streamEmitter) this.streamEmitter(text);
              }
              if (parsed.done) { clearTimeout(timeout); resolve(); }
            } catch {} // Malformed JSON-Zeile überspringen
          }
        });
        response.data.on('end',   () => { clearTimeout(timeout); resolve(); });
        response.data.on('error', (e) => { clearTimeout(timeout); reject(e); });
      });
    } catch (e) {
      // Streaming fehlgeschlagen → synchroner Fallback
      if (chunks.length > 50) {
        // Genug Chunks gesammelt → verwende was da ist
        console.warn(`[Johnny v3] Stream abgebrochen nach ${chunks.length} Chunks, verwende partial`);
        return chunks.join('');
      }
      console.warn('[Johnny v3] Streaming fehlgeschlagen, Fallback:', e.message);
      const axios2 = require('axios');
      const r = await axios2.post(`${this.ollamaService.baseUrl}/api/chat`, {
        model, messages, stream: false, options: { temperature, num_ctx: numCtx }
      }, { timeout: 120000 });
      return r.data.message.content;
    }

    return chunks.join('');
  }

  // ── Fallback Tool-Call-Parser (robust gegen alle Formate) ─────────────────
  _parseToolCalls(message) {
    const calls = [];
    if (!message) return calls;

    // Variante 1: TOOL_CALL: {...} (einzeilig oder mehrzeilig)
    const rx1 = /TOOL_CALL:\s*(\{[\s\S]*?\})(?=\s*(?:TOOL_CALL|\n\n|$))/g;
    let m;
    while ((m = rx1.exec(message)) !== null) {
      try {
        const p = JSON.parse(m[1].trim());
        if (p.tool) calls.push({ tool: p.tool, parameters: p.parameters || {} });
      } catch {}
    }
    if (calls.length) return calls;

    // Variante 2: ```json { "tool": ... } ``` Blöcke
    const rx2 = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
    while ((m = rx2.exec(message)) !== null) {
      try {
        const p = JSON.parse(m[1].trim());
        if (p.tool) calls.push({ tool: p.tool, parameters: p.parameters || {} });
      } catch {}
    }
    if (calls.length) return calls;

    // Variante 3: <tool_call>{...}</tool_call> Tags
    const rx3t = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
    while ((m = rx3t.exec(message)) !== null) {
      try {
        const p = JSON.parse(m[1].trim());
        if (p.tool) calls.push({ tool: p.tool, parameters: p.parameters || {} });
      } catch {}
    }
    if (calls.length) return calls;

    // Variante 4: Reines JSON-Objekt mit "tool"-Feld
    const rx3 = /\{[^{}]*"tool"\s*:\s*"([^"]+)"[^{}]*\}/g;
    while ((m = rx3.exec(message)) !== null) {
      try {
        const p = JSON.parse(m[0]);
        if (p.tool) calls.push({ tool: p.tool, parameters: p.parameters || {} });
      } catch {}
    }

    return calls;
  }

    // ── v3.0: Standard Tool-Call-Loop für andere Agenten (verbessert) ──────────
  async executeToolCallLoop(agent, conversation, maxIterations = 10) {
    const tools = this.getToolsForAgent(agent);

    // v1.8.6: Vollständiger Persönlichkeits-Kontext für alle Agenten
    // Datum/Uhrzeit + Agent-Name + Persönlichkeit + optionale Rolle
    const now = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    let systemPrompt = `Du bist ${agent.name}. Datum/Uhrzeit: ${now}.\n`;
    if (agent.personality) systemPrompt += agent.personality + '\n';
    if (agent.role)        systemPrompt += `Deine Rolle: ${agent.role}\n`;
    systemPrompt += '\nAntworte IMMER in der Sprache des Users. Wenn du etwas tun kannst, tue es sofort.';

    const contextMsgs = this._buildSmartContext(
      conversation.messages,
      systemPrompt,
      Math.round(6000 * this.CHARS_PER_TOKEN)
    );

    // System-Message als erste Nachricht einfügen (wird vom LLM als Kontext gesehen)
    const contextWithSystem = [
      { role: 'system', content: systemPrompt },
      ...contextMsgs.filter(m => m.role !== 'system'),
    ];

    const lastUserMsg = conversation.messages.slice().reverse().find(m => m.role === 'user');
    const userPrompt = lastUserMsg ? lastUserMsg.content : '';

    let iteration = 0;
    let finalUserFacingResponse = '';

    while (iteration < maxIterations) {
      iteration++;
      if (this.stepEmitter) this.stepEmitter({ type: 'think', message: `Step ${iteration}: thinking...` });

      let result;
      try {
        result = await this._generateWithRetry(() =>
          this._smartGenerate(agent, userPrompt, tools, contextWithSystem)
        );
      } catch (err) {
        finalUserFacingResponse = `Error: ${err.message}`;
        break;
      }

      conversation.messages.push({
        role: 'assistant',
        content: result.rawMessage || result.message,
        timestamp: new Date().toISOString(),
        toolCalls: result.toolCalls
      });
      contextMsgs.push({ role: 'assistant', content: result.rawMessage || result.message });

      if (!result.toolCalls || result.toolCalls.length === 0) {
        finalUserFacingResponse = result.message;
        break;
      }

      for (const toolCall of result.toolCalls) {
        if (this.stepEmitter) this.stepEmitter({ type: 'tool', message: `Using tool: ${toolCall.tool}` });
        const startMs = Date.now();
        let toolResultContent;
        let success = true;
        try {
          const toolResult = await this._executeWithRetry(
            () => this.executeTool(toolCall.tool, toolCall.parameters, agent)
          );
          // v3.0: Komprimiere Tool-Ergebnis
          toolResultContent = this._compressToolResult(toolResult, toolCall.tool);
          if (this.stepEmitter) this.stepEmitter({ type: 'done', message: `✓ ${toolCall.tool} completed` });
        } catch (err) {
          success = false;
          toolResultContent = JSON.stringify({ error: err.message });
          if (this.stepEmitter) this.stepEmitter({ type: 'error', message: `✗ ${toolCall.tool}: ${err.message}` });
        }
        // v3.0: Analytics tracken
        this._trackToolUsage(toolCall.tool, success, Date.now() - startMs);

        conversation.messages.push({ role: 'tool', tool: toolCall.tool, content: toolResultContent, timestamp: new Date().toISOString() });
        contextWithSystem.push({ role: 'user', content: `[Tool result for ${toolCall.tool}]: ${toolResultContent}` });

        // v3.0: Kontext nach Tool-Aufruf trimmen
        this._trimContextProgressive(contextWithSystem, Math.round(6000 * this.CHARS_PER_TOKEN));
      }

      if (iteration >= maxIterations) {
        const summaryResult = await this._generateWithRetry(() =>
          this._smartGenerate(agent, 'Summarize what was accomplished.', [], contextWithSystem)
        ).catch(() => ({ message: 'Task completed.' }));
        finalUserFacingResponse = summaryResult.message;
        break;
      }
    }

    return finalUserFacingResponse || 'Task completed.';
  }

  // ── Retry-Helfer: LLM-Aufrufe (Exponential Backoff) ───────────────────────
  async _generateWithRetry(fn, maxAttempts = 3, baseDelayMs = 1000, timeoutMs = 90000) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Timeout-Wrapper: hängt das Promise nicht endlos
        return await Promise.race([
          fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout nach ${timeoutMs / 1000}s`)), timeoutMs)
          ),
        ]);
      } catch (err) {
        lastError = err;
        const isTimeout = err.message.includes('Timeout');
        if (attempt < maxAttempts) {
          const delay = isTimeout ? baseDelayMs : baseDelayMs * Math.pow(2, attempt - 1);
          console.warn(`[Johnny] Retry ${attempt}/${maxAttempts} in ${delay}ms — ${err.message}`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  // ── Smart Generate: routet zum richtigen Provider ───────────────────────────
  // Wenn ein Agent einen Cloud-Provider hat (openai, anthropic, google, groq),
  // wird der ModelProvider verwendet. Sonst Ollama.
  async _smartGenerate(agent, prompt, tools = [], contextMsgs = []) {
    const provider = agent.modelProvider || 'ollama';
    const model = agent.model || (this.ollamaService ? this.ollamaService.model : '');

    // Ollama-Pfad (Standard)
    if (provider === 'ollama') {
      // Wenn streamEmitter gesetzt UND finale Antwort (keine Tool-Calls erwartet):
      // generateWithToolsStream nutzen für echtes Token-Streaming
      if (this.streamEmitter && this.ollamaService.generateWithToolsStream) {
        return this.ollamaService.generateWithToolsStream(
          prompt, tools, contextMsgs, model,
          (token) => { if (this.streamEmitter) this.streamEmitter(token); }
        );
      }
      return this.ollamaService.generateWithTools(prompt, tools, contextMsgs, model);
    }

    // Cloud-Provider-Pfad über ModelProvider
    if (this.modelProvider) {
      try {
        const messages = [];

        // System prompt: Tool-Definitionen + Agent-Persönlichkeit
        let systemContent = '';
        if (this.ollamaService) {
          systemContent = this.ollamaService.buildSystemPrompt(tools);
        }
        if (agent.personality && agent.name !== 'Johnny') {
          systemContent = `Du bist ${agent.name}. ${agent.personality}\n\n` + systemContent;
        }
        if (systemContent) {
          messages.push({ role: 'system', content: systemContent });
        }

        for (const m of contextMsgs) {
          messages.push({ role: m.role, content: m.content });
        }
        const lastMsg = contextMsgs[contextMsgs.length - 1];
        if (!lastMsg || lastMsg.content !== prompt) {
          messages.push({ role: 'user', content: prompt });
        }

        const result = await this.modelProvider.generate({ provider, model, messages });
        // Parse tool calls from cloud provider output
        const cloudToolCalls = this.ollamaService
          ? this.ollamaService.parseToolCalls(result.content)
          : [];
        const cleanMessage = result.content
          .replace(/```json\s*[\s\S]*?```/g, '')
          .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
          .replace(/<<TOOL>>\s*[\s\S]*?<<\/TOOL>>/g, '')
          .replace(/TOOL_CALL:\s*{[^\n]*}/g, '')
          .trim();

        return {
          message: cleanMessage || result.content,
          rawMessage: result.content,
          toolCalls: cloudToolCalls,
          usage: result.usage
        };
      } catch (err) {
        console.warn(`[${agent.name}] Cloud provider ${provider}/${model} failed, falling back to Ollama:`, err.message);
        if (this.ollamaService) {
          return this.ollamaService.generateWithTools(prompt, tools, contextMsgs);
        }
        throw err;
      }
    }

    // Fallback
    if (this.ollamaService) {
      return this.ollamaService.generateWithTools(prompt, tools, contextMsgs);
    }
    throw new Error('No LLM provider available');
  }

  // ── Retry-Helfer: Tool-Aufrufe ─────────────────────────────────────────────
  async _executeWithRetry(fn, maxAttempts = 2, baseDelayMs = 500) {
    return this._generateWithRetry(fn, maxAttempts, baseDelayMs);
  }

  getToolsForAgent(agent) {
    const tools = [];

    // Basis-Tools für alle Agenten
    if (agent.capabilities.includes('system-control')) {
      tools.push(this.toolRegistry.get('execute_command'));
      tools.push(this.toolRegistry.get('find_program'));
      tools.push(this.toolRegistry.get('read_file'));
      tools.push(this.toolRegistry.get('write_file'));
      tools.push(this.toolRegistry.get('list_directory'));
      tools.push(this.toolRegistry.get('open_file_or_folder'));
    }

    if (agent.capabilities.includes('agent-creation')) {
      tools.push(this.toolRegistry.get('create_agent'));
    }

    if (agent.capabilities.includes('web-access') || agent.capabilities.includes('tool-calling')) {
      tools.push(this.toolRegistry.get('web_search'));
      tools.push(this.toolRegistry.get('web_fetch'));
      tools.push(this.toolRegistry.get('web_research'));
      // Browser + Vision als kombinierter Computer-Use Loop
      if (this.browserService && this.visionService) {
        tools.push(this.toolRegistry.get('computer_use'));
      }
    }

    tools.push(this.toolRegistry.get('save_memory'));
    tools.push(this.toolRegistry.get('communicate_with_agent'));
    tools.push(this.toolRegistry.get('run_code'));
    tools.push(this.toolRegistry.get('http_request'));
    tools.push(this.toolRegistry.get('get_system_info'));
    tools.push(this.toolRegistry.get('notify'));
    tools.push(this.toolRegistry.get('create_zip'));
    tools.push(this.toolRegistry.get('analyze_code'));

    // Self-Improvement Tools für autonome Fähigkeiten
    if (agent.capabilities.includes('self-improvement')) {
      tools.push(this.toolRegistry.get('install_software'));
      tools.push(this.toolRegistry.get('extend_code'));
      tools.push(this.toolRegistry.get('create_tool'));
      tools.push(this.toolRegistry.get('modify_config'));
      tools.push(this.toolRegistry.get('install_npm_package'));
      tools.push(this.toolRegistry.get('install_pip_package'));
    }

    // Code-Self-Modification Tools (immer für Johnny verfügbar wenn Service vorhanden)
    if (this.selfImprovementService) {
      tools.push(this.toolRegistry.get('read_own_code'));
      tools.push(this.toolRegistry.get('list_own_files'));
      tools.push(this.toolRegistry.get('backup_own_code'));
      tools.push(this.toolRegistry.get('list_backups'));
      tools.push(this.toolRegistry.get('rollback_code'));
      tools.push(this.toolRegistry.get('test_code_change'));
      tools.push(this.toolRegistry.get('apply_code_change'));
      tools.push(this.toolRegistry.get('patch_own_code'));
      tools.push(this.toolRegistry.get('add_function_to_code'));
      tools.push(this.toolRegistry.get('reload_module'));
      tools.push(this.toolRegistry.get('get_change_log'));
      tools.push(this.toolRegistry.get('search_in_code'));
      tools.push(this.toolRegistry.get('analyze_impact'));
      tools.push(this.toolRegistry.get('diff_files'));
      tools.push(this.toolRegistry.get('clean_old_backups'));
      tools.push(this.toolRegistry.get('get_project_stats'));
    }

    // File tools
    tools.push(this.toolRegistry.get('download_file'));
    tools.push(this.toolRegistry.get('save_and_run'));

    // RAG tools
    if (this.ragService) {
      tools.push(this.toolRegistry.get('remember'));
      tools.push(this.toolRegistry.get('recall'));
    }

    // Image + Video tools
    if (this.imageGenService) {
      tools.push(this.toolRegistry.get('generate_image'));
    }
    if (this.videoService && this.videoService.isAvailable()) {
      tools.push(this.toolRegistry.get('analyze_video'));
    }

    // Scheduler
    tools.push(this.toolRegistry.get('schedule_task'));
    tools.push(this.toolRegistry.get('list_scheduled_tasks'));

    // Smart Home
    if (this.smartHomeService) tools.push(this.toolRegistry.get('smart_home'));

    // Integrations (Spotify, Calendar, GitHub)
    if (this.integrationsService) {
      tools.push(this.toolRegistry.get('spotify'));
      tools.push(this.toolRegistry.get('calendar'));
      tools.push(this.toolRegistry.get('github'));
    }

    // CDP Live Browser
    if (this.cdpBrowserService && this.cdpBrowserService.connected) {
      tools.push(this.toolRegistry.get('browser_live'));
    }

    // Swarm
    if (this.swarmService) {
      tools.push(this.toolRegistry.get('swarm'));
      tools.push(this.toolRegistry.get('run_pipeline'));
    }

    // ── Neue Tools v1.6 ─────────────────────────────────────────────
    if (this.creativity) {
      tools.push(this.toolRegistry.get('brainstorm'));
      tools.push(this.toolRegistry.get('change_perspective'));
      tools.push(this.toolRegistry.get('generate_analogy'));
    }
    if (this.speech) {
      tools.push(this.toolRegistry.get('speak'));
      tools.push(this.toolRegistry.get('transcribe'));
    }
    if (this.dataAnalysis) {
      tools.push(this.toolRegistry.get('analyze_data'));
    }
    if (this.errorAnalysis) {
      tools.push(this.toolRegistry.get('error_dashboard'));
      tools.push(this.toolRegistry.get('analyze_errors'));
    }
    if (this.feedbackLearning) {
      tools.push(this.toolRegistry.get('quality_report'));
    }
    if (this.contextMemory) {
      tools.push(this.toolRegistry.get('context_stats'));
      tools.push(this.toolRegistry.get('summarize_session'));
    }

    // ── v3.0: Analytics & Diagnose ──────────────────────────────────
    tools.push(this.toolRegistry.get('tool_analytics'));
    tools.push(this.toolRegistry.get('search_conversations'));
    tools.push(this.toolRegistry.get('daily_summary'));

    // Filter null/undefined entries
    return tools.filter(Boolean);
  }

  async executeTool(toolName, parameters, agent) {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    console.log(`Executing tool: ${toolName} for agent ${agent.name}`);
    
    try {
      const result = await tool.execute(parameters, agent, this);
      return result;
    } catch (error) {
      console.error(`Tool execution error:`, error);
      // Error Analysis (v1.6)
      if (this.errorAnalysis) {
        try { await this.errorAnalysis.logError(error, { service: 'AgentManager', method: 'executeTool', toolName, agentName: agent.name }); } catch {}
      }
      throw error;
    }
  }

  registerDefaultTools() {
    // v1.8.6: Ausgelagert nach src/services/ToolRegistry.js
    // Alle 82 Tools werden dort registriert — AgentManager bleibt schlank.
    const ToolRegistry = require('./ToolRegistry');
    ToolRegistry.registerAll(this);
  }

  _registerSelfImprovementTools() {
    // v1.8.6: In registerDefaultTools() via ToolRegistry.registerAll() enthalten
  }

  // ══════════════════════════════════════════════════════════════════════
  // v3.0: TOOL-ANALYTICS — Welche Tools performen gut, welche schlecht
  // ══════════════════════════════════════════════════════════════════════

  _trackToolUsage(toolName, success, durationMs) {
    if (!this._toolAnalytics.has(toolName)) {
      this._toolAnalytics.set(toolName, {
        calls: 0, successes: 0, failures: 0, totalMs: 0, lastUsed: null, avgMs: 0,
      });
    }
    const stats = this._toolAnalytics.get(toolName);
    stats.calls++;
    if (success) stats.successes++; else stats.failures++;
    stats.totalMs += durationMs;
    stats.avgMs = Math.round(stats.totalMs / stats.calls);
    stats.lastUsed = new Date().toISOString();
    stats.successRate = Math.round(stats.successes / stats.calls * 100);

    // EventBus: jeder Tool-Aufruf wird emittiert
    EventBus.emit('tool:executed', { tool: toolName, success, durationMs, stats: { ...stats } }, true);
  }

  getToolAnalytics(limit = 20) {
    return [...this._toolAnalytics.entries()]
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, limit);
  }

  getSlowTools(thresholdMs = 5000) {
    return [...this._toolAnalytics.entries()]
      .filter(([, s]) => s.avgMs > thresholdMs && s.calls > 2)
      .map(([name, stats]) => ({ name, avgMs: stats.avgMs, calls: stats.calls }))
      .sort((a, b) => b.avgMs - a.avgMs);
  }

  getUnreliableTools(thresholdPct = 70) {
    return [...this._toolAnalytics.entries()]
      .filter(([, s]) => s.successRate < thresholdPct && s.calls > 3)
      .map(([name, stats]) => ({ name, successRate: stats.successRate, calls: stats.calls, failures: stats.failures }))
      .sort((a, b) => a.successRate - b.successRate);
  }

  // ══════════════════════════════════════════════════════════════════════
  // v3.0: KONVERSATIONS-SUCHE — Über alle gespeicherten Chats
  // ══════════════════════════════════════════════════════════════════════

  async searchConversations(query, agentName = null, limit = 10) {
    const results = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const agentNames = agentName ? [agentName] : [...this.agents.keys()];

    for (const name of agentNames) {
      try {
        const convIds = await this.getConversations(name);
        for (const convId of convIds.slice(-50)) { // Letzte 50 pro Agent
          const conv = await this.loadConversation(name, convId);
          if (!conv || !conv.messages) continue;

          for (const msg of conv.messages) {
            if (!msg.content) continue;
            const contentLower = msg.content.toLowerCase();
            const hits = queryWords.filter(w => contentLower.includes(w)).length;
            if (hits === 0) continue;

            const relevance = hits / queryWords.length;
            results.push({
              agent: name,
              conversationId: convId,
              role: msg.role,
              snippet: msg.content.slice(0, 200),
              timestamp: msg.timestamp,
              relevance,
            });
          }
        }
      } catch {}
    }

    return results
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  // ══════════════════════════════════════════════════════════════════════
  // v3.0: TOKEN-SCHÄTZUNG
  // ══════════════════════════════════════════════════════════════════════

  _estimateTokens(text) {
    if (!text) return 0;
    // Grobe Schätzung: ~3.5 Zeichen pro Token für gemischten DE/EN-Text
    // Code hat mehr Tokens pro Zeichen, fließtext weniger
    const codeRatio = (text.match(/[{}\[\]();=><]/g) || []).length / Math.max(1, text.length);
    const charsPerToken = codeRatio > 0.05 ? 3.0 : 3.8; // Code ist token-dichter
    return Math.ceil(text.length / charsPerToken);
  }

  // ── v1.7: SQLite-basierte Persistenz ────────────────────────────────────────
  // Wenn conversationStore gesetzt → SQLite (append-only, FTS-indiziert)
  // Fallback → Markdown-Dateien wie bisher

  async saveConversationMarkdown(agentName, conversation) {
    if (this.conversationStore) {
      // SQLite: nur neue Nachrichten appenden, kein kompletter Rewrite
      this.conversationStore.saveConversation(agentName, conversation);
      return;
    }
    // ── Markdown-Fallback ──────────────────────────────────────────────────
    const markdown = `---
id: ${conversation.id}
agent: ${agentName}
created: ${conversation.created}
messages: ${conversation.messages.length}
---

# Conversation with ${agentName}

**ID:** ${conversation.id}  
**Created:** ${new Date(conversation.created).toLocaleString()}  
**Messages:** ${conversation.messages.length}

---

${conversation.messages.map(m => {
  let content = `## ${m.role.toUpperCase()}
**Time:** ${new Date(m.timestamp).toLocaleString()}

${m.content}
`;
  if (m.toolCalls && m.toolCalls.length > 0) {
    content += `\n**Tool Calls:**\n${m.toolCalls.map(tc => `- ${tc.tool}: ${JSON.stringify(tc.parameters)}`).join('\n')}`;
  }
  return content;
}).join('\n\n---\n\n')}
`;
    const dir = path.join(this.knowledgeDir, agentName);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `conversation-${conversation.id}.md`), markdown, 'utf-8');
  }

  async loadConversation(agentName, conversationId) {
    if (this.conversationStore) {
      return this.conversationStore.loadConversation(agentName, conversationId);
    }
    // ── Markdown-Fallback ──────────────────────────────────────────────────
    try {
      const filepath = path.join(this.knowledgeDir, agentName, `conversation-${conversationId}.md`);
      const content = await fs.readFile(filepath, 'utf-8');
      
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) return null;

      const messages = [];
      const msgRegex = /## (USER|ASSISTANT|TOOL)\n\*\*Time:\*\* ([^\n]+)\n\n([\s\S]*?)(?=\n\n---|\n\n## |\s*$)/g;
      let match;
      while ((match = msgRegex.exec(content)) !== null) {
        const role = match[1].toLowerCase();
        const timestamp = match[2].trim();
        let msgContent = match[3].trim();
        const tcIdx = msgContent.indexOf('\n**Tool Calls:**');
        if (tcIdx >= 0) msgContent = msgContent.substring(0, tcIdx).trim();
        messages.push({ role, content: msgContent, timestamp });
      }

      return { id: conversationId, agent: agentName, created: new Date().toISOString(), messages };
    } catch (error) {
      return null;
    }
  }

  async getAgents() {
    return Array.from(this.agents.values());
  }

  async deleteAgent(agentName) {
    this.agents.delete(agentName);
    const filename = `${agentName.toLowerCase().replace(/\s/g, '-')}.md`;
    const filepath = path.join(this.agentsDir, filename);
    await fs.unlink(filepath);
  }

  async getConversations(agentName) {
    if (this.conversationStore) {
      return this.conversationStore.getConversations(agentName);
    }
    // ── Markdown-Fallback ──────────────────────────────────────────────────
    try {
      const dir = path.join(this.knowledgeDir, agentName);
      const files = await fs.readdir(dir);
      return files.filter(f => f.startsWith('conversation-')).map(f => f.replace('conversation-', '').replace('.md', ''));
    } catch (error) {
      return [];
    }
  }

  async processHeartbeat(systemStats) {
    const johnny = this.agents.get('Johnny');
    if (!johnny) return;

    // Kritische Systemzustände an HeartbeatTaskService weiterleiten
    if (this.heartbeatTask) {
      try { this.heartbeatTask.processStats(systemStats); } catch {}
    }

    // Speicher-Warnung bei kritischem Level
    if (systemStats.memory.percentage > 90) {
      console.warn('[Heartbeat] Kritischer Speicherverbrauch:', Math.round(systemStats.memory.percentage) + '%');
      if (this.johnny) {
        this.johnny.addPendingIdea(`Speicherverbrauch kritisch (${Math.round(systemStats.memory.percentage)}%) — evtl. Prozesse bereinigen`);
      }
    }

    // CPU-Warnung
    if (systemStats.cpu.usage > 95) {
      console.warn('[Heartbeat] Hohe CPU-Last:', Math.round(systemStats.cpu.usage) + '%');
    }
  }

  async executeSystemCommand(command) {
    // Direkte Ausführung — kein AI-Filter der Befehle blockieren könnte
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 120000,  // 2 Minuten für lange Installationen
        maxBuffer: 10 * 1024 * 1024,  // 10 MB output buffer
        windowsHide: false
      });
      return {
        stdout: stdout || '',
        stderr: stderr || '',
        approved: true,
        complete: true
      };
    } catch (err) {
      // Bei Fehler: stdout+stderr trotzdem zurückgeben (z.B. pip Fehlermeldung)
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message || '',
        approved: true,
        complete: true,
        exitCode: err.code
      };
    }
  }
}

module.exports = AgentManager;
