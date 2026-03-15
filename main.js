// ══════════════════════════════════════════════════════════════════════════════
// POLYFILL — muss als ALLERERSTES laufen
// ══════════════════════════════════════════════════════════════════════════════
(function setupPolyfill() {
  if (typeof globalThis.File !== 'undefined') return;
  try {
    const { Blob } = require('buffer');
    class FileShim extends Blob {
      constructor(parts, name, opts = {}) {
        super(parts, opts);
        this.name         = name || 'file';
        this.lastModified = opts.lastModified || Date.now();
      }
    }
    globalThis.File = FileShim;
    if (typeof globalThis.fetch === 'undefined') {
      try {
        const mod = require('node-fetch');
        if (typeof mod === 'function') {
          globalThis.fetch = mod;
        } else if (mod.default) {
          globalThis.fetch    = mod.default;
          globalThis.Headers  = mod.Headers;
          globalThis.Request  = mod.Request;
          globalThis.Response = mod.Response;
        }
      } catch (_nf) {
        // node-fetch not available, some features may be limited
      }
    }
    if (typeof globalThis.FormData === 'undefined') {
      globalThis.FormData = class FormData {
        constructor() { this._data = new Map(); }
        append(k, v) {
          if (this._data.has(k)) {
            const existing = this._data.get(k);
            this._data.set(k, Array.isArray(existing) ? [...existing, v] : [existing, v]);
          } else {
            this._data.set(k, v);
          }
        }
        get(k)       { const v = this._data.get(k); return Array.isArray(v) ? v[0] : v; }
        getAll(k)    { const v = this._data.get(k); return Array.isArray(v) ? v : v !== undefined ? [v] : []; }
        has(k)       { return this._data.has(k); }
        delete(k)    { this._data.delete(k); }
        set(k, v)    { this._data.set(k, v); }
        keys()       { return this._data.keys(); }
        values()     { return this._data.values(); }
        entries()    { return this._data.entries(); }
        forEach(cb)  { this._data.forEach((v, k) => cb(v, k, this)); }
        [Symbol.iterator]() { return this._data.entries(); }
      };
    }
  } catch (e) {
    console.warn('[Polyfill] Could not set File shim:', e.message);
  }
})();
// ══════════════════════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain } = require('electron');

process.env.NODE_PATH = __dirname + require('path').sep + 'node_modules';
require('module').Module._initPaths();

const path  = require('path');
const Store = require('electron-store');

const ServiceRegistry   = require('./src/core/ServiceRegistry');
const EventBus          = require('./src/core/EventBus');
const ConversationStore = require('./src/core/ConversationStore');
const ipcHandlers       = require('./src/ipc/handlers');  // ← neues Modul

// ── v1.8: Neue Services ───────────────────────────────────────────────────────
const EmbeddingService    = require('./src/services/EmbeddingService');
const StyleProfileService = require('./src/services/StyleProfileService');

// ── v1.8.3: Security + Logger ─────────────────────────────────────────────────
const SecurityService     = require('./src/services/SecurityService');
const logger              = require('./src/core/Logger');

const store = new Store();
let   mainWindow;
let   heartbeatInterval;

// ── Pfade ─────────────────────────────────────────────────────────────────────
const AGENTS_DIR   = path.join(app.getPath('userData'), 'agents');
const KNOWLEDGE_DIR = path.join(app.getPath('userData'), 'knowledge');
const DATA_DIR      = path.join(app.getPath('userData'), 'data');

// ── Registry ──────────────────────────────────────────────────────────────────
const registry = new ServiceRegistry();

// ════════════════════════════════════════════════════════════════════
// SERVICE REGISTRIERUNGEN
// (Reihenfolge wird durch deps automatisch aufgelöst)
// ════════════════════════════════════════════════════════════════════

function registerAllServices() {

  // ── Extern-Instanzen ──────────────────────────────────────────────
  registry.registerInstance('store', store);
  registry.registerInstance('eventBus', EventBus);

  // ── ConversationStore (SQLite) ────────────────────────────────────
  registry.register('conversationStore', ConversationStore, {
    dataDir: DATA_DIR,
  }, [], { optional: false }); // required — ohne DB kein Memory

  // ── Model Provider ────────────────────────────────────────────────
  const ModelProvider = require('./src/services/ModelProvider');
  registry.register('modelProvider', ModelProvider, {
    defaultProvider: store.get('settings.defaultProvider', 'ollama'),
    apiKeys: {
      openai:    store.get('apiKeys.openai'),
      anthropic: store.get('apiKeys.anthropic'),
      google:    store.get('apiKeys.google'),
      groq:      store.get('apiKeys.groq'),
    },
  });

  // ── Ollama ────────────────────────────────────────────────────────
  const OllamaService = require('./src/services/OllamaService');
  registry.register('ollama', OllamaService, {
    model:        store.get('settings.model', 'gemma2:9b'),
    baseUrl:      store.get('settings.ollamaUrl', 'http://127.0.0.1:11434'),
    autoDownload: true,
    autoStart:    true,
  });

  // ── Plugin Manager ────────────────────────────────────────────────
  const PluginManager = require('./src/services/PluginManager');
  registry.register('pluginManager', PluginManager, {
    pluginsDir: path.join(app.getPath('userData'), 'plugins'),
    skillsDir:  path.join(app.getPath('userData'), 'skills'),
    agentManager: null, // wird später gesetzt
  });

  // ── RAG Service (lazy — chromadb kann crashen) ─────────────────────
  registry.register('rag', () => {
    const RAGService = require('./src/services/RAGService');
    return new RAGService({
      chromaUrl:         store.get('settings.chromaUrl', 'http://localhost:8000'),
      embeddingProvider: store.get('settings.embeddingProvider', 'ollama'), // v1.8.6: ollama ist default
      ollamaBaseUrl:     store.get('settings.ollamaUrl', 'http://127.0.0.1:11434'),
      ollamaEmbedModel:  store.get('settings.ollamaEmbedModel', 'nomic-embed-text'),
      apiKeys:           { openai: store.get('apiKeys.openai') },
    });
  }, {}, [], { optional: true, lazy: false });

  // ── Browser Automation ────────────────────────────────────────────
  const BrowserAutomationService = require('./src/services/BrowserAutomationService');
  registry.register('browser', BrowserAutomationService, {
    screenshotsDir: path.join(app.getPath('userData'), 'screenshots'),
  }, [], { optional: true });

  // ── Vision ────────────────────────────────────────────────────────
  const VisionService = require('./src/services/VisionService');
  registry.register('vision', VisionService, {
    modelProvider: { $ref: 'modelProvider' },
    ollamaUrl: store.get('settings.ollamaUrl', 'http://127.0.0.1:11434'),
    apiKeys: {
      openai:    store.get('apiKeys.openai'),
      anthropic: store.get('apiKeys.anthropic'),
      google:    store.get('apiKeys.google'),
    },
  }, ['modelProvider'], { optional: true });

  // ── Embedding Service (v1.8) ──────────────────────────────────────
  registry.register('embedding', EmbeddingService, {
    ollamaUrl:      store.get('settings.ollamaUrl', 'http://127.0.0.1:11434'),
    embeddingModel: store.get('settings.embeddingModel', 'nomic-embed-text'),
  }, [], { optional: true });

  // ── Style Profile Service (v1.8) ──────────────────────────────────
  // johnnyCore lebt in agentManager.johnny — wird in wireServicesPostInit gesetzt
  registry.register('styleProfile', StyleProfileService, {
    conversationStore: { $ref: 'conversationStore' },
    johnnyCore:        null,   // wird post-init via agentManager.johnny gesetzt
  }, ['conversationStore'], { optional: true });

  // ── Web Search ────────────────────────────────────────────────────
  const WebSearchService = require('./src/services/WebSearchService');
  registry.register('search', WebSearchService, {
    defaultEngine: store.get('settings.searchEngine', 'duckduckgo'),
    apiKeys: {
      googleSearch:   store.get('apiKeys.googleSearch'),
      googleSearchCx: store.get('apiKeys.googleSearchCx'),
      bing:           store.get('apiKeys.bing'),
      serper:         store.get('apiKeys.serper'),
    },
  }, [], { optional: true });

  // ── Sandbox ───────────────────────────────────────────────────────
  const SandboxService = require('./src/services/SandboxService');
  registry.register('sandbox', SandboxService, {
    sandboxMode: store.get('settings.sandboxMode', 'auto'),
    timeout:     store.get('settings.sandboxTimeout', 30000),
    memLimit:    store.get('settings.sandboxMemLimit', '256m'),
  }, [], { optional: true });

  // ── Self-Improvement ──────────────────────────────────────────────
  const SelfImprovementService = require('./src/services/SelfImprovementService');
  registry.register('selfImprovement', SelfImprovementService, {
    projectRoot: __dirname,
    backupDir:   path.join(app.getPath('userData'), 'johnny-backups'),
    sandboxDir:  path.join(app.getPath('userData'), 'johnny-sandbox'),
  }, [], { optional: true });

  // ── Image Generation ──────────────────────────────────────────────
  const ImageGenerationService = require('./src/services/ImageGenerationService');
  registry.register('imageGen', ImageGenerationService, {
    apiKeys: {
      openai:    store.get('apiKeys.openai'),
      replicate: store.get('apiKeys.replicate'),
      sdUrl:     store.get('settings.sdUrl', 'http://localhost:7860'),
    },
    outputDir:       path.join(app.getPath('userData'), 'generated-images'),
    defaultProvider: store.get('settings.imageProvider', 'openai'),
    comfyUrl:        store.get('settings.comfyUrl', 'http://localhost:8188'),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Video Analysis ────────────────────────────────────────────────
  const VideoAnalysisService = require('./src/services/VideoAnalysisService');
  registry.register('video', VideoAnalysisService, {
    visionService: { $ref: 'vision' },
    modelProvider: { $ref: 'modelProvider' },
    apiKeys: {
      openai:    store.get('apiKeys.openai'),
      anthropic: store.get('apiKeys.anthropic'),
    },
    tempDir: path.join(app.getPath('userData'), 'video-temp'),
  }, ['vision', 'modelProvider'], { optional: true });

  // ── Smart Home ────────────────────────────────────────────────────
  const SmartHomeService = require('./src/services/SmartHomeService');
  registry.register('smartHome', SmartHomeService, {
    homeAssistant: { url: store.get('settings.haUrl', ''), token: store.get('apiKeys.homeAssistant', '') },
    philipsHue:    { bridgeIp: store.get('settings.hueBridgeIp', ''), username: store.get('settings.hueUsername', '') },
  }, [], { optional: true });

  // ── Integrations ──────────────────────────────────────────────────
  const IntegrationsService = require('./src/services/IntegrationsService');
  registry.register('integrations', IntegrationsService, {
    apiKeys: {
      spotifyClientId:     store.get('apiKeys.spotifyClientId', ''),
      spotifyClientSecret: store.get('apiKeys.spotifyClientSecret', ''),
      googleCalendarToken: store.get('apiKeys.googleCalendar', ''),
      github:              store.get('apiKeys.github', ''),
    },
    dataDir: path.join(app.getPath('userData'), 'integrations'),
  }, [], { optional: true });

  // ── CDP Browser ───────────────────────────────────────────────────
  const CDPBrowserService = require('./src/services/CDPBrowserService');
  registry.register('cdpBrowser', CDPBrowserService, {
    cdpPort:        store.get('settings.cdpPort', 9222),
    screenshotsDir: path.join(app.getPath('userData'), 'cdp-screenshots'),
  }, [], { optional: true });

  // ── Gateway ───────────────────────────────────────────────────────
  const GatewayService = require('./src/services/GatewayService');
  registry.register('gateway', GatewayService, {
    port:        store.get('settings.gatewayPort', 18789),
    authToken:   store.get('settings.gatewayToken') || null,
    agentManager: null,
  }, [], { optional: true });

  // ── Agent Manager ─────────────────────────────────────────────────
  // Ist der Kern — hängt von vielen Services ab
  const AgentManager = require('./src/services/AgentManager');
  registry.register('agentManager', AgentManager, {
    ollamaService:        { $ref: 'ollama' },
    modelProvider:        { $ref: 'modelProvider' },
    pluginManager:        { $ref: 'pluginManager' },
    agentsDir:            AGENTS_DIR,
    knowledgeDir:         KNOWLEDGE_DIR,
    conversationStore:    { $ref: 'conversationStore' },  // ← NEU: SQLite statt Markdown
    ragService:           { $ref: 'rag' },
    browserService:       { $ref: 'browser' },
    visionService:        { $ref: 'vision' },
    searchService:        { $ref: 'search' },
    sandboxService:       { $ref: 'sandbox' },
    imageGenService:      { $ref: 'imageGen' },
    videoService:         { $ref: 'video' },
    smartHomeService:     { $ref: 'smartHome' },
    integrationsService:  { $ref: 'integrations' },
    cdpBrowserService:    { $ref: 'cdpBrowser' },
    selfImprovementService: { $ref: 'selfImprovement' },
    // v2.0: Neue Services
    nlpService:           { $ref: 'nlp' },
    sensorService:        { $ref: 'sensor' },
    webAutonomyService:   { $ref: 'webAutonomy' },
    speechService:        { $ref: 'speech' },
  }, ['ollama', 'modelProvider', 'pluginManager', 'conversationStore']);

  // ── Swarm V2 ──────────────────────────────────────────────────────
  const SwarmServiceV2 = require('./src/services/SwarmServiceV2');
  registry.register('swarm', SwarmServiceV2, {
    gateway:      { $ref: 'gateway' },
    maxParallel:  5,
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Error Analysis ────────────────────────────────────────────────
  const ErrorAnalysisService = require('./src/services/ErrorAnalysisService');
  registry.register('errorAnalysis', ErrorAnalysisService, {
    selfImprovement: { $ref: 'selfImprovement' },
    gateway:         { $ref: 'gateway' },
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Context Memory ────────────────────────────────────────────────
  const ContextMemoryService = require('./src/services/ContextMemoryService');
  registry.register('contextMemory', ContextMemoryService, {
    dataDir:      path.join(app.getPath('userData'), 'context'),
    ragService:   { $ref: 'rag' },
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Feedback Learning ─────────────────────────────────────────────
  const FeedbackLearningService = require('./src/services/FeedbackLearningService');
  registry.register('feedbackLearning', FeedbackLearningService, {
    johnnyCore:   null,
    gateway:      { $ref: 'gateway' },
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Creativity ────────────────────────────────────────────────────
  const CreativityService = require('./src/services/CreativityService');
  registry.register('creativity', CreativityService, {
    webSearchService: { $ref: 'search' },
    ollamaService:    { $ref: 'ollama' },
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Speech ────────────────────────────────────────────────────────
  const SpeechService = require('./src/services/SpeechService');
  registry.register('speech', SpeechService, {
    openaiApiKey:    store.get('apiKeys.openai'),
    elevenlabsApiKey: store.get('apiKeys.elevenlabs'),
    ttsProvider:     store.get('settings.ttsProvider', 'auto'),
    language:        'de',
  }, [], { optional: true });

  // ── NLP (NEU v2.0) ─────────────────────────────────────────────────
  const NLPService = require('./src/services/NLPService');
  registry.register('nlp', NLPService, {
    language:     'de',
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Sensor (NEU v2.0) ──────────────────────────────────────────────
  const SensorService = require('./src/services/SensorService');
  registry.register('sensor', SensorService, {
    weatherApiKey: store.get('apiKeys.openweather'),
    dataDir:       path.join(app.getPath('userData'), 'sensors'),
  }, [], { optional: true });

  // ── Web Autonomy (NEU v2.0) ────────────────────────────────────────
  const WebAutonomyService = require('./src/services/WebAutonomyService');
  registry.register('webAutonomy', WebAutonomyService, {
    browserService: { $ref: 'browser' },
    cdpService:     { $ref: 'cdpBrowser' },
    visionService:  { $ref: 'vision' },
    dataDir:        path.join(app.getPath('userData'), 'web-autonomy'),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Data Analysis ─────────────────────────────────────────────────
  const DataAnalysisService = require('./src/services/DataAnalysisService');
  registry.register('dataAnalysis', DataAnalysisService, {
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Skill Marketplace ─────────────────────────────────────────────
  const SkillMarketplace = require('./src/services/SkillMarketplace');
  registry.register('skillMarketplace', SkillMarketplace, {
    pluginManager: { $ref: 'pluginManager' },
    dataDir:       path.join(app.getPath('userData'), 'marketplace'),
  }, ['pluginManager'], { optional: true });

  // ── Heartbeat Task ────────────────────────────────────────────────
  const HeartbeatTaskService = require('./src/services/HeartbeatTaskService');
  registry.register('heartbeatTask', HeartbeatTaskService, {
    messengerService:{ $ref: 'messenger' },
    gateway:         { $ref: 'gateway' },
    store,
    dataDir:      path.join(app.getPath('userData'), 'heartbeat'),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Email ─────────────────────────────────────────────────────────
  const EmailService = require('./src/services/EmailService');
  registry.register('email', EmailService, {
    accountsDir: path.join(app.getPath('userData'), 'email-accounts'),
  }, [], { optional: true });

  // ── Messenger ─────────────────────────────────────────────────────
  const MessengerService = require('./src/services/MessengerService');
  registry.register('messenger', MessengerService, {
    dataDir:      path.join(app.getPath('userData'), 'messengers'),
    store,
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── MCP Server ────────────────────────────────────────────────────
  const MCPServer = require('./src/services/MCPServer');
  registry.register('mcp', MCPServer, {
    port:         store.get('settings.mcpPort', 8765),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Telegram ──────────────────────────────────────────────────────
  const telegramToken = store.get('settings.telegramToken');
  if (telegramToken) {
    const TelegramService = require('./src/services/TelegramService');
    registry.register('telegram', TelegramService, {
      token:        telegramToken,
      primaryAgent: 'Johnny',
      store,
    }, [], { optional: true, wireDeps: ['agentManager'] });
  }

  // ── Cloudflare ────────────────────────────────────────────────────
  const CloudflareService = require('./src/services/CloudflareService');
  registry.register('cloudflare', CloudflareService, {
    mainWindow:   null,
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Collaboration ─────────────────────────────────────────────────
  const CollaborationService = require('./src/services/CollaborationService');
  registry.register('collaboration', CollaborationService, {
    port:         store.get('settings.collabPort', 9090),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ════════════════════════════════════════════════════════════════════
  // v2.0 ADVANCED SERVICES
  // ════════════════════════════════════════════════════════════════════

  // ── Emotional Intelligence ────────────────────────────────────────
  const EmotionalIntelligenceService = require('./src/services/EmotionalIntelligenceService');
  registry.register('emotionalIntelligence', EmotionalIntelligenceService, {
    dataDir:      path.join(app.getPath('userData'), 'emotional'),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Creative Writing ──────────────────────────────────────────────
  const CreativeWritingService = require('./src/services/CreativeWritingService');
  registry.register('creativeWriting', CreativeWritingService, {
    dataDir:      path.join(app.getPath('userData'), 'creative'),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Enhanced Vision ───────────────────────────────────────────────
  const EnhancedVisionService = require('./src/services/EnhancedVisionService');
  registry.register('enhancedVision', EnhancedVisionService, {
    visionService: { $ref: 'vision' },
    dataDir:       path.join(app.getPath('userData'), 'vision'),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Time Series Analysis ──────────────────────────────────────────
  const TimeSeriesAnalysisService = require('./src/services/TimeSeriesAnalysisService');
  registry.register('timeSeriesAnalysis', TimeSeriesAnalysisService, {
    dataDir:      path.join(app.getPath('userData'), 'timeseries'),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── External Integration Hub ──────────────────────────────────────
  const ExternalIntegrationHub = require('./src/services/ExternalIntegrationHub');
  registry.register('integrationHub', ExternalIntegrationHub, {
    store,
    dataDir:      path.join(app.getPath('userData'), 'integration-hub'),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Autonomy (NEU v2.1) — Proaktives Handeln ──────────────────
  const AutonomyService = require('./src/services/AutonomyService');
  registry.register('autonomy', AutonomyService, {
    dataDir:      path.join(app.getPath('userData'), 'autonomy'),
    enabled:      store.get('settings.autonomyEnabled') !== false,
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Biographical Memory (NEU v2.1) — Lebensgeschichte ─────────
  const BiographicalMemory = require('./src/services/BiographicalMemory');
  registry.register('biography', BiographicalMemory, {
    dataDir:      path.join(app.getPath('userData'), 'biography'),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ── Hardware Bridge (NEU v2.1) — GPU, Serial, Prozesse ────────
  const HardwareBridgeService = require('./src/services/HardwareBridgeService');
  registry.register('hardware', HardwareBridgeService, {
    dataDir:      path.join(app.getPath('userData'), 'hardware'),
  }, [], { optional: true });

  // ── Visual Reasoning (NEU v2.1) — Strukturiertes Sehen ────────
  const VisualReasoningService = require('./src/services/VisualReasoningService');
  registry.register('visualReasoning', VisualReasoningService, {
    dataDir:      path.join(app.getPath('userData'), 'visual'),
  }, [], { optional: true, wireDeps: ['agentManager'] });

  // ══════════════════════════════════════════════════════════════════
  // DEKLARATIVE WIRINGS — agentManager ← → Services
  // ServiceRegistry v2 führt diese automatisch in Phase 2 aus
  // ══════════════════════════════════════════════════════════════════

  // agentManager bekommt Referenzen auf alle Services (reverse mapping)
  const AM_WIRINGS = {
    swarmService:            'swarm',
    errorAnalysis:           'errorAnalysis',
    contextMemory:           'contextMemory',
    feedbackLearning:        'feedbackLearning',
    creativity:              'creativity',
    speech:                  'speech',
    dataAnalysis:            'dataAnalysis',
    nlpService:              'nlp',
    sensorService:           'sensor',
    webAutonomyService:      'webAutonomy',
    speechService:           'speech',
    embeddingService:        'embedding',
    styleProfile:            'styleProfile',
    emotionalIntelligence:   'emotionalIntelligence',
    creativeWriting:         'creativeWriting',
    enhancedVision:          'enhancedVision',
    timeSeriesAnalysis:      'timeSeriesAnalysis',
    integrationHub:          'integrationHub',
    heartbeatTask:           'heartbeatTask',
    autonomy:                'autonomy',
    biography:               'biography',
    hardware:                'hardware',
    visualReasoning:         'visualReasoning',
  };
  for (const [prop, svcName] of Object.entries(AM_WIRINGS)) {
    registry.registerWiring('agentManager', svcName, prop);
  }

  // pluginManager.agentManager
  registry.registerWiring('pluginManager', 'agentManager', 'agentManager');
  // gateway.agentManager
  registry.registerWiring('gateway', 'agentManager', 'agentManager');
  // heartbeatTask.store (special)
  registry.registerWiring('heartbeatTask', 'agentManager', 'agentManager');
}

// ════════════════════════════════════════════════════════════════════
// POST-INIT: Nur noch Custom-Logic (nicht per Wiring lösbar)
// ════════════════════════════════════════════════════════════════════

async function wireServicesPostInit() {
  const agentManager      = registry.get('agentManager');
  const conversationStore = registry.get('conversationStore');
  const embedding         = registry.get('embedding');
  const styleProfile      = registry.get('styleProfile');
  const feedbackLearning  = registry.get('feedbackLearning');
  const contextMemory     = registry.get('contextMemory');
  const heartbeatTask     = registry.get('heartbeatTask');
  const gateway           = registry.get('gateway');
  const cloudflare        = registry.get('cloudflare');

  if (!agentManager) return;

  // ── SQLite-Patch (kann nicht deklarativ gelöst werden) ─────────────
  if (conversationStore) {
    const SQLitePatch = require('./src/patches/AgentManagerSQLitePatch');
    SQLitePatch.apply(agentManager);
    const migrationDoneKey = 'internal.sqliteMigrationDone';
    if (!store.get(migrationDoneKey)) {
      const n = await conversationStore.migrateFromMarkdown(KNOWLEDGE_DIR);
      if (n >= 0) store.set(migrationDoneKey, true);
    }
  }

  // ── JohnnyCore-spezifische Injektionen ────────────────────────────
  const johnny = agentManager.johnny;
  if (johnny) {
    if (contextMemory)     johnny.contextMemory        = contextMemory;
    if (feedbackLearning)  { johnny.feedbackLearning = feedbackLearning; feedbackLearning.johnnyCore = johnny; }
    if (embedding)         johnny.embeddingService      = embedding;
    if (styleProfile)      { johnny.styleProfile = styleProfile; styleProfile.johnnyCore = johnny; }
    const ei = registry.get('emotionalIntelligence');
    if (ei)                johnny.emotionalIntelligence = ei;
  }

  // ── Embedding → ConversationStore ─────────────────────────────────
  if (embedding && conversationStore) {
    conversationStore.embeddingService = embedding;
  }

  // ── FeedbackLearning ↔ StyleProfile (Callback-Brücke) ────────────
  if (feedbackLearning && styleProfile) {
    styleProfile.onStyleDetected = (userId, styleData) => {
      try { feedbackLearning.incorporateStyleSignal(userId, styleData); } catch (_) {}
    };
    feedbackLearning.styleProfile = styleProfile;
  }

  // ── HeartbeatTask.store (kein Service, kein $ref möglich) ─────────
  if (heartbeatTask) heartbeatTask.store = store;

  // ── AutonomyService ← → Events verdrahten ────────────────────────
  const autonomy = registry.get('autonomy');
  if (autonomy) {
    // Autonomy-Notifications → UI Toast oder System-Notification
    autonomy.on('notification', (data) => {
      sendToRenderer('autonomy-notification', data);
    });
    autonomy.on('ask-permission', (data) => {
      sendToRenderer('autonomy-ask', {
        message: data.evaluation.message || data.evaluation.reasoning,
        action: data.evaluation.proposedAction,
        eventId: data.event.id,
      });
    });
    // Heartbeat-Events als Sensor-Input für Autonomy
    autonomy.on('action-executed', (data) => {
      logger.info('Autonomy', `Aktion ausgeführt: ${data.evaluation.proposedAction}`);
    });
    logger.info('Main', '[v2.1] AutonomyService verdrahtet ✓');
  }

  // ── BiographicalMemory → JohnnyCore ───────────────────────────────
  const biography = registry.get('biography');
  if (biography && agentManager.johnny) {
    agentManager.johnny.biography = biography;
    logger.info('Main', '[v2.1] BiographicalMemory verdrahtet ✓');
  }

  // ── Gateway starten ───────────────────────────────────────────────
  if (gateway) await gateway.start().catch(e => console.warn('[Gateway]', e.message));

  // ── Cloudflare mainWindow-Referenz ────────────────────────────────
  if (cloudflare) cloudflare.mainWindow = mainWindow;

  // Johnny-Agent anlegen/synchronisieren
  await ensureJohnnyAgent(agentManager);

  console.log('[main] Service wiring complete');
  sendToRenderer('services-initialized', { status: 'success' });
}

// ════════════════════════════════════════════════════════════════════
// JOHNNY AGENT BOOTSTRAP
// ════════════════════════════════════════════════════════════════════

async function ensureJohnnyAgent(agentManager) {
  try {
    const axios          = require('axios');
    const ollamaService  = registry.get('ollama');
    const rawSavedModel  = store.get('settings.model', '');
    let   savedModel     = rawSavedModel?.trim() || '';
    const savedProvider  = store.get('settings.defaultProvider', 'ollama') || 'ollama';

    if (ollamaService && savedProvider === 'ollama') {
      try {
        const res       = await axios.get('http://127.0.0.1:11434/api/tags', { timeout: 3000 });
        const available = (res.data.models || []).map(m => m.name);
        if (available.length > 0) {
          // Match with or without :latest suffix
          const storedOk = savedModel && (available.includes(savedModel) || available.includes(savedModel + ':latest') || available.some(m => m.split(':')[0] === savedModel.split(':')[0]));
          if (!storedOk) {
            savedModel = available.find(m => m.includes('gemma2')) || available[0];
          } else if (!available.includes(savedModel) && available.includes(savedModel + ':latest')) {
            // Normalize to full name
            savedModel = savedModel + ':latest';
          }
        } else if (!savedModel) {
          savedModel = 'gemma2:9b';
        }
      } catch {
        if (!savedModel) savedModel = 'gemma2:9b';
      }
    }
    if (!savedModel) savedModel = 'gemma2:9b';

    store.set('settings.model', savedModel);
    store.set('settings.defaultProvider', savedProvider);
    if (ollamaService) ollamaService.model = savedModel;

    const existingAgents = await agentManager.getAgents();
    const johnnyExists   = existingAgents.some(a => a.name === 'Johnny');

    if (!johnnyExists) {
      await agentManager.createAgent({
        name: 'Johnny', role: 'Master AI Assistant',
        personality: 'Autonomous intelligent assistant with decision-making and self-improvement capabilities',
        capabilities: ['tool-calling','autonomous-decision','agent-creation','system-control','self-improvement'],
        modelProvider: savedProvider, model: savedModel, isCore: true,
      });
      console.log(`[main] Johnny created: ${savedProvider}/${savedModel}`);
    } else {
      const johnny = agentManager.agents.get('Johnny');
      if (johnny) {
        johnny.modelProvider = savedProvider;
        johnny.model         = savedModel;
        await agentManager.saveAgentMarkdown(johnny).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[main] Could not create/sync Johnny agent:', e.message);
  }
}

// ════════════════════════════════════════════════════════════════════
// ELECTRON WINDOW
// ════════════════════════════════════════════════════════════════════

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    show: false, // ← Fix schwarzes Fenster: erst anzeigen wenn Inhalt bereit
    webPreferences: {
      // nodeIntegration=true wird benötigt damit index.html React/Komponenten
      // per require() laden kann (kein Bundler/Webpack in diesem Projekt).
      // Sicherheit wird über preload.js contextBridge + IPC-Whitelist gewährleistet.
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  true,   // benötigt für require() in index.html / App.jsx
      contextIsolation: false,  // muss false sein wenn nodeIntegration=true
      additionalArguments: ['--app-root=' + __dirname],
    },
    frame: true,
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'public/icon.png'),
  });

  // Fenster erst anzeigen wenn Inhalt gerendert ist → kein schwarzes Flackern
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadFile('public/index.html');

  // ── Security: CSP Headers ──────────────────────────────────────────────
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline'",
          "connect-src 'self' http://127.0.0.1:* http://localhost:* https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://api.groq.com https://*.replicate.com",
          "img-src 'self' data: https: http:",
        ].join('; '),
      },
    });
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('renderer-ready', {});
  });

  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });

  // Heartbeat auf idle wenn Fenster minimiert
  mainWindow.on('minimize', () => { heartbeatMode = 'idle'; });
  mainWindow.on('restore',  () => { heartbeatMode = 'normal'; });
  mainWindow.on('focus',    () => { if (heartbeatMode === 'idle') heartbeatMode = 'normal'; });
}

// ════════════════════════════════════════════════════════════════════
// RENDERER-KOMMUNIKATION
// ════════════════════════════════════════════════════════════════════

let rendererReady    = false;
const pendingMessages = [];

function sendToRenderer(channel, data) {
  if (!mainWindow?.webContents) return;
  if (rendererReady) {
    mainWindow.webContents.send(channel, data);
  } else {
    pendingMessages.push({ channel, data });
  }
}

ipcMain.on('renderer-ready', () => {
  rendererReady = true;
  for (const msg of pendingMessages) {
    mainWindow?.webContents?.send(msg.channel, msg.data);
  }
  pendingMessages.length = 0;
});

// ════════════════════════════════════════════════════════════════════
// HEARTBEAT (Adaptiv — passt Frequenz und Tiefe an)
// ════════════════════════════════════════════════════════════════════

let heartbeatMode = 'normal';  // 'full' | 'normal' | 'idle'

function startHeartbeat() {
  const si = require('systeminformation');

  // IPC: Frontend kann Heartbeat-Modus ändern
  // ipcMain.on statt ipcMain.handle — guard gegen Doppelregistrierung bei Hot-Reload
  ipcMain.removeAllListeners('set-heartbeat-mode');
  ipcMain.on('set-heartbeat-mode', (_, mode) => {
    if (!['full', 'normal', 'idle'].includes(mode)) return;
    const prev = heartbeatMode;
    heartbeatMode = mode;
    // Fix: Intervall neu starten wenn Modus-Frequenz sich ändert
    if ((prev === 'full') !== (mode === 'full')) {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      scheduleHeartbeat(si);
    }
  });

  scheduleHeartbeat(si);
}

function scheduleHeartbeat(si) {
  const intervalMs = heartbeatMode === 'full' ? 5000 : 10000;
  heartbeatInterval = setInterval(async () => {
    if (heartbeatMode === 'idle' || !mainWindow?.webContents) return;

    try {
      // Normal-Modus: nur CPU + Memory (leichtgewichtig)
      if (heartbeatMode === 'normal') {
        const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()]);
        const stats = {
          timestamp: Date.now(),
          cpu:    { usage: cpu.currentLoad, cores: cpu.cpus.length },
          memory: { total: mem.total, used: mem.used, free: mem.free, percentage: (mem.used / mem.total) * 100 },
        };
        const agentManager = registry.get('agentManager');
        if (agentManager) await agentManager.processHeartbeat(stats);
        sendToRenderer('heartbeat', stats);
        return;
      }

      // Full-Modus: alle Infos (nur wenn System-Dashboard offen)
      const [cpu, mem, disk, network, processes] = await Promise.all([
        si.currentLoad(), si.mem(), si.fsSize(), si.networkStats(), si.processes(),
      ]);
      const stats = {
        timestamp: Date.now(),
        cpu:     { usage: cpu.currentLoad, cores: cpu.cpus.length },
        memory:  { total: mem.total, used: mem.used, free: mem.free, percentage: (mem.used / mem.total) * 100 },
        disk:    disk.map(d => ({ mount: d.mount, total: d.size, used: d.used, percentage: d.use })),
        network: network.map(n => ({ interface: n.iface, rx: n.rx_sec, tx: n.tx_sec })),
        processes: {
          all: processes.all, running: processes.running,
          list: processes.list.slice(0, 50).map(p => ({ pid: p.pid, name: p.name, cpu: p.cpu, mem: p.mem })),
        },
      };
      const agentManager = registry.get('agentManager');
      if (agentManager) await agentManager.processHeartbeat(stats);
      sendToRenderer('heartbeat', stats);
    } catch (e) {
      console.error('[heartbeat]', e.message);
    }
  }, intervalMs);
}

// ════════════════════════════════════════════════════════════════════
// APP BOOTSTRAP
// ════════════════════════════════════════════════════════════════════

app.whenReady().then(async () => {
  const fs = require('fs').promises;

  // ── Logger starten (als Erstes) ──────────────────────────────────────────
  logger.initialize({ level: 'info', consoleLevel: 'info' });
  logger.info('Main', 'Johnny AI Assistant v1.8.3 startet...');

  // Verzeichnisse anlegen
  await fs.mkdir(AGENTS_DIR,    { recursive: true });
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR,      { recursive: true });

  // ── SecurityService initialisieren ──────────────────────────────────────
  const security = new SecurityService({ store });
  security.initialize();
  // Confirmation-Antworten vom Frontend empfangen
  ipcMain.on('security:confirm-response', (event, { confirmId, approved }) => {
    security.handleConfirmResponse(confirmId, approved);
  });
  // Security-Einstellungen per IPC anpassen
  ipcMain.handle('security:get-settings', () => security.getSettings());
  ipcMain.handle('security:update-settings', (_, settings) => { security.updateSettings(settings); return security.getSettings(); });
  ipcMain.handle('security:get-stats',   () => security.getStats());
  ipcMain.handle('security:reset-stats', () => security.resetStats());
  ipcMain.handle('logger:get-recent', (_, n) => logger.getRecentLines(n || 100));
  ipcMain.handle('logger:get-files',  () => logger.getLogFiles());

  // ── Telegram Whitelist verwalten ──────────────────────────────────────────
  ipcMain.handle('telegram:get-whitelist', () => store.get('settings.telegramAllowedUsers') || []);
  ipcMain.handle('telegram:set-whitelist', (_, ids) => {
    const clean = (Array.isArray(ids) ? ids : []).map(id => Number(id)).filter(Boolean);
    store.set('settings.telegramAllowedUsers', clean);
    logger.info('Main', `Telegram Whitelist aktualisiert: ${clean.length} User`);
    return clean;
  });
  ipcMain.handle('telegram:set-allow-all', (_, val) => {
    store.set('settings.telegramAllowAll', !!val);
    return !!val;
  });

  // ── Messenger Whitelist (universal — Discord, WhatsApp, Slack, Matrix, Signal) ─
  // Alle Messenger nutzen dasselbe Schema: settings.messengerAllowedUsers.<n> = [id, ...]
  ipcMain.handle('messenger:get-whitelist', (_, messenger) => {
    if (!messenger) return {};
    return store.get(`settings.messengerAllowedUsers.${messenger}`) || [];
  });
  ipcMain.handle('messenger:set-whitelist', (_, { messenger, ids }) => {
    if (!messenger) return { error: 'messenger erforderlich' };
    const clean = (Array.isArray(ids) ? ids : []).map(id => String(id)).filter(Boolean);
    store.set(`settings.messengerAllowedUsers.${messenger}`, clean);
    logger.info('Main', `${messenger} Whitelist: ${clean.length} User gesetzt`);
    return clean;
  });
  ipcMain.handle('messenger:get-all-whitelists', () => {
    return store.get('settings.messengerAllowedUsers') || {};
  });
  ipcMain.handle('messenger:set-allow-all', (_, val) => {
    store.set('settings.messengerAllowAll', !!val);
    logger.info('Main', `messengerAllowAll = ${!!val}`);
    return !!val;
  });
  ipcMain.handle('messenger:get-allow-all', () => {
    return !!store.get('settings.messengerAllowAll');
  });

  // ── Token-Budget-Limits konfigurieren ────────────────────────────────────
  ipcMain.handle('token-budget:get', () => store.get('settings.tokenBudgetLimits') || {});
  ipcMain.handle('token-budget:set', (_, limits) => {
    store.set('settings.tokenBudgetLimits', limits);
    const mp = registry.get('modelProvider');
    if (mp) mp.setTokenBudgetLimits(limits);
    logger.info('Main', 'Token-Budget-Limits aktualisiert', limits);
    return limits;
  });
  ipcMain.handle('token-budget:usage', () => {
    const mp = registry.get('modelProvider');
    return mp ? mp.getUsageStats() : {};
  });

  // ── Services registrieren (noch nicht initialisiert) ──────────────
  registerAllServices();

  // ── IPC-Handler SOFORT registrieren (BEVOR Fenster lädt!) ─────────
  // Renderer sendet Requests sobald index.html geladen ist.
  // Handler müssen VORHER existieren, sonst: "No handler registered"
  // Services sind noch null → Handler geben graceful leere Antworten.
  ipcHandlers.register(ipcMain, registry, { sendToRenderer, mainWindow: () => mainWindow, store });
  logger.info('Main', 'IPC-Handler registriert ✓');

  // Fenster (Renderer kann jetzt sicher inv() aufrufen)
  await createWindow();
  security.mainWindow = mainWindow;

  // Setup Wizard (beim ersten Start)
  const SetupWizard = require('./src/services/SetupWizard');
  const setupWizard = new SetupWizard({ mainWindow });
  const choiceHandler = (event, data) => setupWizard.handleChoice(data);
  ipcMain.on('setup-choice', choiceHandler);
  try { await setupWizard.run(); } catch (e) { logger.warn('Main', 'Setup-Wizard Fehler: ' + e.message); }
  ipcMain.removeListener('setup-choice', choiceHandler);

  // ── Services initialisieren (Phase 1 + Phase 2 Wiring) ───────────
  await registry.initializeAll();

  // SecurityService + Token-Budgets
  const agentManager = registry.get('agentManager');
  if (agentManager) agentManager.security = security;

  const mp = registry.get('modelProvider');
  if (mp) {
    const savedLimits = store.get('settings.tokenBudgetLimits');
    if (savedLimits) mp.setTokenBudgetLimits(savedLimits);
  }

  // Custom-Wirings (JohnnyCore, SQLite-Patch, Callbacks)
  await wireServicesPostInit();

  // Heartbeat starten
  startHeartbeat();

  // Auto-Updater (optional — benötigt electron-updater)
  const AutoUpdater = require('./src/services/AutoUpdater');
  const updater = new AutoUpdater({ mainWindow, logger, store });
  updater.initialize();
  ipcMain.handle('update-check',    async () => updater.checkForUpdates());
  ipcMain.handle('update-download', async () => updater.downloadUpdate());
  ipcMain.handle('update-install',  async () => { updater.installUpdate(); });
  ipcMain.handle('update-status',   async () => updater.getStatus());

  // ── BackgroundDaemon — Johnny lebt weiter wenn das Fenster schließt ────
  const BackgroundDaemon = require('./src/services/BackgroundDaemon');
  const daemon = new BackgroundDaemon({
    app, createWindow, mainWindowGetter: () => mainWindow, store, registry, logger,
  });
  daemon.initialize();

  // AutonomyService → BackgroundDaemon Notifications verbinden
  const autonomy = registry.get('autonomy');
  if (autonomy) {
    autonomy.on('notification', (data) => daemon.notifyUser(data.message, data.priority));

    // Heartbeat-Events an Autonomy weiterleiten
    registry.on('service:ready', (name) => {
      autonomy.pushEvent({ type: 'service-ready', source: name, priority: 'low' });
    });
  }

  // ── Autonomy + Biography IPC-Handler ───────────────────────────────────
  ipcMain.handle('autonomy-status',  async () => registry.get('autonomy')?.getStatus() || { enabled: false });
  ipcMain.handle('autonomy-toggle',  async (_, enabled) => {
    const a = registry.get('autonomy');
    if (!a) return { error: 'AutonomyService nicht verfügbar' };
    a.enabled = enabled; enabled ? a.start() : a.stop();
    store.set('settings.autonomyEnabled', enabled);
    return a.getStatus();
  });
  ipcMain.handle('autonomy-bounds', async (_, bounds) => {
    const a = registry.get('autonomy');
    if (!a) return { error: 'AutonomyService nicht verfügbar' };
    if (bounds) a.updateBounds(bounds);
    return a.bounds;
  });
  ipcMain.handle('autonomy-push-event', async (_, event) => {
    const a = registry.get('autonomy');
    if (a) a.pushEvent(event);
    return { queued: true };
  });
  ipcMain.handle('biography-status', async () => {
    const b = registry.get('biography');
    if (!b) return { error: 'BiographicalMemory nicht verfügbar' };
    return {
      narrative: b.getNarrative(),
      facts: b._facts,
      episodeCount: b._episodes.length,
      interactionCount: b._interactionCount,
    };
  });
  ipcMain.handle('biography-learn', async (_, { category, key, value }) => {
    const b = registry.get('biography');
    if (b) { b.learnFact(category, key, value); return { success: true }; }
    return { error: 'BiographicalMemory nicht verfügbar' };
  });

  logger.info('Main', 'Alle Services bereit ✓');
});

app.on('window-all-closed', async () => {
  // Background-Modus: Johnny lebt weiter im Tray
  const backgroundEnabled = store.get('settings.backgroundMode') !== false;
  if (backgroundEnabled && process.platform !== 'darwin') {
    // Heartbeat auf idle setzen, aber NICHT stoppen
    heartbeatMode = 'idle';
    logger.info('Main', 'Fenster geschlossen → Background Mode (Tray)');

    // JohnnyCore zwischenspeichern (nicht beenden)
    const agentManager = registry.get('agentManager');
    if (agentManager?.johnny) {
      try { await agentManager.johnny.flushSave(); } catch {}
    }
    return; // NICHT quiten!
  }

  // Normaler Shutdown (Background-Modus deaktiviert)
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  const agentManager = registry.get('agentManager');
  if (agentManager?.johnny) {
    try { await agentManager.johnny.flushSave(); } catch (e) { console.warn('[shutdown] Johnny save failed:', e.message); }
  }
  const cs = registry.get('conversationStore');
  if (cs) cs.close();
  const autonomy = registry.get('autonomy');
  if (autonomy) autonomy.stop();
  if (process.platform !== 'darwin') app.quit();
});

// Globaler Error-Handler — verhindert dass ein Service-Crash die App tötet
process.on('uncaughtException', (err) => {
  logger.error('Main', 'uncaughtException: ' + err.message, { stack: err.stack?.split('\n').slice(0,4) });
  // Nicht process.exit() — App läuft weiter
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.warn('Main', 'unhandledRejection: ' + msg);
});


