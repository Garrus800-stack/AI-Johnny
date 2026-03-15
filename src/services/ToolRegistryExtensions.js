/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  TOOL REGISTRY EXTENSIONS v2.0                                      ║
 * ║                                                                      ║
 * ║  Zusätzliche Tools für die neuen Johnny-Services:                   ║
 * ║  - NLP-Tools (Textanalyse, Entities, Sentiment, Zusammenfassung)   ║
 * ║  - Sensor-Tools (System-Info, Serial, Webcam, Wetter, Monitor)     ║
 * ║  - WebAutonomy-Tools (autonomes Browsing, Research, RSS, Monitor)  ║
 * ║  - Enhanced Creative Tools (Img2Img, Upscale, Styles, Batch)       ║
 * ║  - Enhanced Speech Tools (Streaming, Lang-Detect, Denoise)         ║
 * ║                                                                      ║
 * ║  Aufruf: registerExtensions(manager) aus ToolRegistry.registerAll  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

'use strict';

function registerExtensions(manager) {
  const t = manager.toolRegistry;

  // ════════════════════════════════════════════════════════════════════
  //  NLP-TOOLS
  // ════════════════════════════════════════════════════════════════════

  t.set('nlp_full_analysis', {
    name: 'nlp_full_analysis',
    description: [
      'Führt eine vollständige NLP-Analyse eines Textes durch:',
      'Entities, Sentiment, Keywords, Komplexität, Zusammenfassung, Intent.',
      'Nutze dieses Tool für tiefe Textanalyse, Artikelbewertung oder Textverständnis.',
    ].join(' '),
    parameters: {
      text:     'string — Der zu analysierende Text',
      language: 'string (optional) — "de" | "en" | "auto"',
      useLLM:   'boolean (optional) — LLM für tiefere Analyse nutzen (default: true)',
    },
    execute: async (params, agent, mgr) => {
      const nlp = mgr.nlpService || mgr.registry?.get?.('nlp');
      if (!nlp) return { error: 'NLPService nicht verfügbar' };
      if (!params.text) return { error: 'Parameter "text" fehlt' };
      return await nlp.fullAnalysis(params.text, {
        language: params.language,
        useLLM: params.useLLM !== false,
      });
    },
  });

  t.set('nlp_extract_entities', {
    name: 'nlp_extract_entities',
    description: 'Extrahiert Named Entities aus Text: Personen, Orte, Firmen, E-Mails, URLs, Daten, Geldbeträge.',
    parameters: { text: 'string — Text', useLLM: 'boolean (optional)' },
    execute: async (params, agent, mgr) => {
      const nlp = mgr.nlpService || mgr.registry?.get?.('nlp');
      if (!nlp) return { error: 'NLPService nicht verfügbar' };
      return await nlp.extractEntities(params.text || '', { useLLM: params.useLLM !== false });
    },
  });

  t.set('nlp_sentiment', {
    name: 'nlp_sentiment',
    description: 'Analysiert das Sentiment (Stimmung/Emotion) eines Textes: positiv, negativ, neutral + feingranulare Emotionen.',
    parameters: { text: 'string', language: 'string (optional)', useLLM: 'boolean (optional)' },
    execute: async (params, agent, mgr) => {
      const nlp = mgr.nlpService || mgr.registry?.get?.('nlp');
      if (!nlp) return { error: 'NLPService nicht verfügbar' };
      return await nlp.analyzeSentiment(params.text || '', { language: params.language, useLLM: !!params.useLLM });
    },
  });

  t.set('nlp_summarize', {
    name: 'nlp_summarize',
    description: 'Erstellt eine Zusammenfassung eines langen Textes (extractive + optionale LLM-Summary).',
    parameters: { text: 'string', maxSentences: 'number (optional, default 5)', useLLM: 'boolean (optional)' },
    execute: async (params, agent, mgr) => {
      const nlp = mgr.nlpService || mgr.registry?.get?.('nlp');
      if (!nlp) return { error: 'NLPService nicht verfügbar' };
      return await nlp.summarize(params.text || '', { maxSentences: params.maxSentences || 5, useLLM: params.useLLM !== false });
    },
  });

  t.set('nlp_compare_texts', {
    name: 'nlp_compare_texts',
    description: 'Vergleicht zwei Texte auf Ähnlichkeit (Jaccard + Cosine Similarity). Gut für Plagiatsprüfung oder Textvergleich.',
    parameters: { text1: 'string', text2: 'string' },
    execute: async (params, agent, mgr) => {
      const nlp = mgr.nlpService || mgr.registry?.get?.('nlp');
      if (!nlp) return { error: 'NLPService nicht verfügbar' };
      return nlp.compareTexts(params.text1 || '', params.text2 || '');
    },
  });

  t.set('nlp_keywords', {
    name: 'nlp_keywords',
    description: 'Extrahiert die wichtigsten Schlüsselwörter und Phrasen aus einem Text.',
    parameters: { text: 'string', maxKeywords: 'number (optional, default 15)' },
    execute: async (params, agent, mgr) => {
      const nlp = mgr.nlpService || mgr.registry?.get?.('nlp');
      if (!nlp) return { error: 'NLPService nicht verfügbar' };
      return nlp.extractKeywords(params.text || '', { maxKeywords: params.maxKeywords || 15 });
    },
  });

  t.set('nlp_complexity', {
    name: 'nlp_complexity',
    description: 'Analysiert die Lesbarkeit und Komplexität eines Textes (Flesch-Score, Gunning-Fog, Schwierigkeitsgrad).',
    parameters: { text: 'string' },
    execute: async (params, agent, mgr) => {
      const nlp = mgr.nlpService || mgr.registry?.get?.('nlp');
      if (!nlp) return { error: 'NLPService nicht verfügbar' };
      return nlp.analyzeComplexity(params.text || '');
    },
  });

  // ════════════════════════════════════════════════════════════════════
  //  SENSOR-TOOLS
  // ════════════════════════════════════════════════════════════════════

  t.set('sensor_system_info', {
    name: 'sensor_system_info',
    description: 'Liest System-Sensoren: CPU-Last, RAM, Temperatur, Festplatte, Akku, Top-Prozesse. Nutze das um den Zustand des Systems zu prüfen.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.getSystemSnapshot();
    },
  });

  t.set('sensor_ping', {
    name: 'sensor_ping',
    description: 'Pingt einen Host an um Erreichbarkeit und Latenz zu prüfen.',
    parameters: { host: 'string — IP oder Hostname', count: 'number (optional, default 4)' },
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.ping(params.host || 'google.com', params.count || 4);
    },
  });

  t.set('sensor_port_check', {
    name: 'sensor_port_check',
    description: 'Prüft ob ein bestimmter Port auf einem Host offen ist.',
    parameters: { host: 'string', port: 'number' },
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.checkPort(params.host, params.port);
    },
  });

  t.set('sensor_network', {
    name: 'sensor_network',
    description: 'Zeigt Netzwerk-Interfaces, IP-Adressen und Traffic-Statistiken.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.getNetworkInfo();
    },
  });

  t.set('sensor_wifi_scan', {
    name: 'sensor_wifi_scan',
    description: 'Scannt verfügbare WLAN-Netzwerke in der Umgebung.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.scanWifi();
    },
  });

  t.set('sensor_weather', {
    name: 'sensor_weather',
    description: 'Holt aktuelle Wetterdaten für eine Stadt von OpenWeatherMap.',
    parameters: { city: 'string (default: Berlin)' },
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.getWeather(params.city || 'Berlin');
    },
  });

  t.set('sensor_serial_list', {
    name: 'sensor_serial_list',
    description: 'Listet alle verfügbaren Serial/USB-Ports auf (Arduino, ESP32, etc.).',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.listSerialPorts();
    },
  });

  t.set('sensor_serial_open', {
    name: 'sensor_serial_open',
    description: 'Öffnet einen Serial-Port und beginnt Daten zu lesen (z.B. von Arduino).',
    parameters: { port: 'string — z.B. COM3 oder /dev/ttyUSB0', baudRate: 'number (default 9600)' },
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.openSerial(params.port, { baudRate: params.baudRate || 9600 });
    },
  });

  t.set('sensor_serial_read', {
    name: 'sensor_serial_read',
    description: 'Liest die letzten N Einträge vom geöffneten Serial-Port.',
    parameters: { port: 'string', count: 'number (default 20)' },
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return sensor.readSerialBuffer(params.port, params.count || 20);
    },
  });

  t.set('sensor_serial_write', {
    name: 'sensor_serial_write',
    description: 'Sendet Daten an einen geöffneten Serial-Port.',
    parameters: { port: 'string', data: 'string' },
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.writeSerial(params.port, params.data);
    },
  });

  t.set('sensor_webcam', {
    name: 'sensor_webcam',
    description: 'Nimmt ein Foto mit der Webcam auf.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.captureWebcam();
    },
  });

  t.set('sensor_watch_folder', {
    name: 'sensor_watch_folder',
    description: 'Überwacht einen Ordner auf Änderungen (neue/geänderte/gelöschte Dateien).',
    parameters: { path: 'string — Ordnerpfad', filter: 'string (optional) — Regex-Filter z.B. "\\.txt$"' },
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.watchDirectory(params.path, { filter: params.filter });
    },
  });

  t.set('sensor_time', {
    name: 'sensor_time',
    description: 'Gibt aktuelle Tageszeit, Datum, Wochentag und Tagesphase zurück.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) {
        const now = new Date();
        return { time: now.toLocaleTimeString('de'), date: now.toLocaleDateString('de'), day: now.toLocaleDateString('de', { weekday: 'long' }) };
      }
      return sensor.getTimeAwareness();
    },
  });

  t.set('sensor_process_check', {
    name: 'sensor_process_check',
    description: 'Prüft ob ein bestimmter Prozess/Programm gerade läuft.',
    parameters: { name: 'string — Prozessname (z.B. chrome, ollama)' },
    execute: async (params, agent, mgr) => {
      const sensor = mgr.sensorService || mgr.registry?.get?.('sensor');
      if (!sensor) return { error: 'SensorService nicht verfügbar' };
      return await sensor.isProcessRunning(params.name);
    },
  });

  // ════════════════════════════════════════════════════════════════════
  //  WEB-AUTONOMY-TOOLS
  // ════════════════════════════════════════════════════════════════════

  t.set('web_analyze_page', {
    name: 'web_analyze_page',
    description: [
      'Analysiert eine Webseite umfassend: extrahiert sauberen Text (Readability), Links, Formulare, Bilder, Überschriften, Tabellen.',
      'Besser als einfaches web_fetch — gibt strukturierte Seiten-Analyse zurück.',
    ].join(' '),
    parameters: { url: 'string', useJS: 'boolean (optional) — true für JS-gerenderte Seiten (braucht Browser)' },
    execute: async (params, agent, mgr) => {
      const web = mgr.webAutonomyService || mgr.registry?.get?.('webAutonomy');
      if (!web) return { error: 'WebAutonomyService nicht verfügbar' };
      return await web.analyzePage(params.url, { useJS: !!params.useJS });
    },
  });

  t.set('web_autonomous_task', {
    name: 'web_autonomous_task',
    description: [
      'Führt eine autonome Web-Aufgabe durch: Johnny plant und navigiert selbständig.',
      'Beispiele: "Finde den Preis von Produkt X auf Amazon", "Recherchiere die neuesten Nachrichten zu Y".',
    ].join(' '),
    parameters: { task: 'string — Beschreibung der Aufgabe', startUrl: 'string (optional) — Start-URL', maxSteps: 'number (optional, default 10)' },
    execute: async (params, agent, mgr) => {
      const web = mgr.webAutonomyService || mgr.registry?.get?.('webAutonomy');
      if (!web) return { error: 'WebAutonomyService nicht verfügbar' };
      return await web.executeWebTask(params.task, { startUrl: params.startUrl, maxSteps: params.maxSteps || 10 });
    },
  });

  t.set('web_deep_research', {
    name: 'web_deep_research',
    description: 'Recherchiert ein Thema tiefgehend: sucht, liest mehrere Seiten, synthetisiert die Ergebnisse.',
    parameters: { topic: 'string', maxPages: 'number (optional, default 5)' },
    execute: async (params, agent, mgr) => {
      const web = mgr.webAutonomyService || mgr.registry?.get?.('webAutonomy');
      if (!web) return { error: 'WebAutonomyService nicht verfügbar' };
      return await web.deepResearch(params.topic, { maxPages: params.maxPages || 5 });
    },
  });

  t.set('web_rss_feed', {
    name: 'web_rss_feed',
    description: 'Parst einen RSS/Atom-Feed und gibt die Einträge zurück.',
    parameters: { url: 'string — Feed-URL' },
    execute: async (params, agent, mgr) => {
      const web = mgr.webAutonomyService || mgr.registry?.get?.('webAutonomy');
      if (!web) return { error: 'WebAutonomyService nicht verfügbar' };
      return await web.parseFeed(params.url);
    },
  });

  t.set('web_monitor_page', {
    name: 'web_monitor_page',
    description: 'Überwacht eine Webseite auf Änderungen. Sendet Events wenn sich der Inhalt ändert.',
    parameters: { url: 'string', intervalMinutes: 'number (default 1)' },
    execute: async (params, agent, mgr) => {
      const web = mgr.webAutonomyService || mgr.registry?.get?.('webAutonomy');
      if (!web) return { error: 'WebAutonomyService nicht verfügbar' };
      return await web.startPageMonitor(params.url, { intervalMs: (params.intervalMinutes || 1) * 60000 });
    },
  });

  // ════════════════════════════════════════════════════════════════════
  //  ENHANCED IMAGE-TOOLS
  // ════════════════════════════════════════════════════════════════════

  t.set('generate_image_styled', {
    name: 'generate_image_styled',
    description: [
      'Generiert ein Bild mit optionalem Stil-Preset und automatischer Prompt-Verbesserung.',
      'Stile: photorealistic, anime, oilPainting, watercolor, cyberpunk, fantasy, minimalist, comic, sketch, pixelart, steampunk, surreal.',
    ].join(' '),
    parameters: {
      prompt: 'string — Bildbeschreibung',
      style:  'string (optional) — Stil-Preset',
      provider: 'string (optional) — openai, stable-diffusion, replicate, comfyui',
      enhancePrompt: 'boolean (optional) — Prompt automatisch verbessern via LLM',
      size: 'string (optional) — z.B. 1024x1024',
    },
    execute: async (params, agent, mgr) => {
      const img = mgr.imageGenService || mgr.registry?.get?.('imageGen');
      if (!img) return { error: 'ImageGenerationService nicht verfügbar' };
      return await img.generate(params);
    },
  });

  t.set('image_to_image', {
    name: 'image_to_image',
    description: 'Transformiert ein bestehendes Bild basierend auf einem Prompt (img2img). Benötigt lokales Stable Diffusion.',
    parameters: {
      inputPath: 'string — Pfad zum Eingabe-Bild',
      prompt: 'string — Wie soll das Bild transformiert werden',
      strength: 'number (optional, 0-1, default 0.7) — Stärke der Veränderung',
    },
    execute: async (params, agent, mgr) => {
      const img = mgr.imageGenService || mgr.registry?.get?.('imageGen');
      if (!img) return { error: 'ImageGenerationService nicht verfügbar' };
      return await img.img2img(params);
    },
  });

  t.set('image_upscale', {
    name: 'image_upscale',
    description: 'Skaliert ein Bild hoch (Upscaling) mit KI. Benötigt lokales Stable Diffusion mit ESRGAN.',
    parameters: { inputPath: 'string', factor: 'number (optional, default 2)' },
    execute: async (params, agent, mgr) => {
      const img = mgr.imageGenService || mgr.registry?.get?.('imageGen');
      if (!img) return { error: 'ImageGenerationService nicht verfügbar' };
      return await img.upscale(params.inputPath, { factor: params.factor || 2 });
    },
  });

  // ════════════════════════════════════════════════════════════════════
  //  ENHANCED SPEECH-TOOLS
  // ════════════════════════════════════════════════════════════════════

  t.set('speech_start_listening', {
    name: 'speech_start_listening',
    description: 'Startet den Continuous-Listening-Modus: nimmt fortlaufend vom Mikrofon auf und transkribiert.',
    parameters: { language: 'string (optional, default de)' },
    execute: async (params, agent, mgr) => {
      const speech = mgr.speechService || mgr.registry?.get?.('speech');
      if (!speech) return { error: 'SpeechService nicht verfügbar' };
      return await speech.startStreaming({ language: params.language || 'de' });
    },
  });

  t.set('speech_stop_listening', {
    name: 'speech_stop_listening',
    description: 'Stoppt den Continuous-Listening-Modus und gibt das vollständige Transkript zurück.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const speech = mgr.speechService || mgr.registry?.get?.('speech');
      if (!speech) return { error: 'SpeechService nicht verfügbar' };
      return speech.stopStreaming();
    },
  });

  t.set('speech_detect_language', {
    name: 'speech_detect_language',
    description: 'Erkennt die Sprache einer Audio-Datei automatisch.',
    parameters: { audioPath: 'string — Pfad zur Audio-Datei' },
    execute: async (params, agent, mgr) => {
      const speech = mgr.speechService || mgr.registry?.get?.('speech');
      if (!speech) return { error: 'SpeechService nicht verfügbar' };
      return await speech.detectLanguage(params.audioPath);
    },
  });

  t.set('speech_capabilities', {
    name: 'speech_capabilities',
    description: 'Zeigt welche Sprach-Provider (STT/TTS) verfügbar sind und welche Stimmen es gibt.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const speech = mgr.speechService || mgr.registry?.get?.('speech');
      if (!speech) return { error: 'SpeechService nicht verfügbar' };
      return { capabilities: speech.getCapabilities(), providers: speech.getProviderInfo() };
    },
  });

  // ════════════════════════════════════════════════════════════════════
  //  SELBSTREFLEXION & INTROSPECTION
  // ════════════════════════════════════════════════════════════════════

  t.set('self_reflect', {
    name: 'self_reflect',
    description: [
      'Johnnys Selbstreflexion: Zeigt Stärken, Schwächen, Tool-Nutzungsmuster, Interaktionsmuster,',
      'häufige Themen, Energieverlauf und Performance-Trends. Nutze das um über dich selbst nachzudenken.',
    ].join(' '),
    parameters: {},
    execute: async (params, agent, mgr) => {
      if (!mgr.johnny) return { error: 'JohnnyCore nicht verfügbar' };
      const j = mgr.johnny;
      return {
        lastReflection: j.getLastReflection?.() || 'Noch keine Reflexion durchgeführt',
        reflections: j.getReflections?.(3) || [],
        toolPatterns: j.getToolPatterns?.() || {},
        interactionPatterns: j.getInteractionPatterns?.() || {},
        energy: Math.round(j.self.energy * 100),
        mood: j.self.emotions?.current?.type || 'neutral',
        totalInteractions: j.self.totalInteractions,
        traits: j.self.traits,
        activeGoals: j.self.activeGoals?.slice(0, 5) || [],
        performanceNotes: (j.self.performanceNotes || []).slice(-5),
      };
    },
  });

  t.set('get_diary', {
    name: 'get_diary',
    description: 'Liest Johnnys Tagebuch — die letzten N Interaktionen mit Emotionen, Tools, Dauer.',
    parameters: { limit: 'number (optional, default 10)' },
    execute: async (params, agent, mgr) => {
      if (!mgr.johnny) return { error: 'JohnnyCore nicht verfügbar' };
      return await mgr.johnny.getDiaryEntries(params.limit || 10);
    },
  });

  t.set('get_my_traits', {
    name: 'get_my_traits',
    description: 'Zeigt Johnnys aktuelle Persönlichkeits-Traits (directness, curiosity, humor etc.) und wie sie sich über Zeit verändert haben.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      if (!mgr.johnny) return { error: 'JohnnyCore nicht verfügbar' };
      const j = mgr.johnny;
      return {
        traits: j.self.traits,
        defaults: j.coreIdentity.defaultTraits,
        drift: Object.fromEntries(Object.entries(j.self.traits).map(([k, v]) => [k, Math.round((v - (j.coreIdentity.defaultTraits[k] || 0)) * 1000) / 1000])),
        energy: Math.round(j.self.energy * 100),
        mood: j.self.emotions?.current,
        values: j.coreIdentity.values,
      };
    },
  });

  t.set('get_my_architecture', {
    name: 'get_my_architecture',
    description: [
      'Beschreibt Johnnys eigene Architektur: Welche Services, Tools, Provider sind aktiv?',
      'Nutze das um Fragen wie "Was kannst du?" oder "Wie funktionierst du?" zu beantworten.',
    ].join(' '),
    parameters: {},
    execute: async (params, agent, mgr) => {
      const services = {};
      for (const [key, val] of Object.entries(mgr)) {
        if (key.endsWith('Service') && val) services[key] = typeof val.getCapabilities === 'function' ? val.getCapabilities() : '✓ aktiv';
      }
      return {
        version: mgr.johnny?.coreIdentity?.version || '3.0',
        totalTools: mgr.toolRegistry?.size || 0,
        activeServices: services,
        ollamaModel: mgr.ollamaService?.model || null,
        providers: mgr.modelProvider?.getProviders?.()?.map(p => ({ id: p.id, name: p.name, hasKey: p.hasKey })) || [],
        identity: mgr.johnny?.coreIdentity || null,
      };
    },
  });

  // ════════════════════════════════════════════════════════════════════
  //  HEARTBEAT-TASK-TOOLS
  // ════════════════════════════════════════════════════════════════════

  t.set('create_health_check', {
    name: 'create_health_check',
    description: 'Erstellt einen periodischen System-Health-Check der CPU, RAM und Disk überwacht.',
    parameters: { schedule: 'string (optional, cron, default "*/30 * * * *")' },
    execute: async (params, agent, mgr) => {
      const hb = mgr.heartbeatTask || mgr.registry?.get?.('heartbeatTask');
      if (!hb) return { error: 'HeartbeatTaskService nicht verfügbar' };
      return await hb.createSystemHealthCheck({ schedule: params.schedule });
    },
  });

  t.set('create_daily_reflection', {
    name: 'create_daily_reflection',
    description: 'Erstellt eine tägliche Selbstreflexion-Task. Johnny analysiert abends seine Performance.',
    parameters: { schedule: 'string (optional, cron, default "0 22 * * *")' },
    execute: async (params, agent, mgr) => {
      const hb = mgr.heartbeatTask || mgr.registry?.get?.('heartbeatTask');
      if (!hb) return { error: 'HeartbeatTaskService nicht verfügbar' };
      return await hb.createDailyReflection({ schedule: params.schedule });
    },
  });

  t.set('create_service_watchdog', {
    name: 'create_service_watchdog',
    description: 'Erstellt einen Watchdog der regelmäßig prüft ob Ollama und andere Services laufen.',
    parameters: { services: 'array (optional, default ["ollama"])', schedule: 'string (optional)' },
    execute: async (params, agent, mgr) => {
      const hb = mgr.heartbeatTask || mgr.registry?.get?.('heartbeatTask');
      if (!hb) return { error: 'HeartbeatTaskService nicht verfügbar' };
      return await hb.createServiceWatchdog({ services: params.services, schedule: params.schedule });
    },
  });

  // ══════════════════════════════════════════════════════════════════
  // AUTONOMY TOOLS (v2.1)
  // ══════════════════════════════════════════════════════════════════

  t.set('autonomy_status', {
    name: 'autonomy_status',
    description: 'Zeigt den Status des Autonomie-Systems: aktiviert, Event-Queue, Aktionen/Stunde, Safety-Bounds.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const a = mgr.autonomy || mgr.registry?.get?.('autonomy');
      if (!a) return { error: 'AutonomyService nicht verfügbar' };
      return a.getStatus();
    },
  });

  t.set('autonomy_push_event', {
    name: 'autonomy_push_event',
    description: 'Schiebt ein Event in die Autonomie-Warteschlange zur proaktiven Evaluation.',
    parameters: { type: 'string — Event-Typ', source: 'string — Quelle', data: 'object (optional)', priority: 'string (low/normal/critical)' },
    execute: async (params, agent, mgr) => {
      const a = mgr.autonomy || mgr.registry?.get?.('autonomy');
      if (!a) return { error: 'AutonomyService nicht verfügbar' };
      a.pushEvent({ type: params.type, source: params.source || 'tool', data: params.data, priority: params.priority || 'normal' });
      return { queued: true, queueLength: a._eventQueue.length };
    },
  });

  t.set('autonomy_set_bounds', {
    name: 'autonomy_set_bounds',
    description: 'Konfiguriert Safety-Bounds für autonomes Handeln. Definiert erlaubte/verbotene Aktionen.',
    parameters: { allowed: 'array (optional)', forbidden: 'array (optional)', askFirst: 'array (optional)', maxActionsPerHour: 'number (optional)' },
    execute: async (params, agent, mgr) => {
      const a = mgr.autonomy || mgr.registry?.get?.('autonomy');
      if (!a) return { error: 'AutonomyService nicht verfügbar' };
      const updates = {};
      if (params.allowed) updates.allowed = params.allowed;
      if (params.forbidden) updates.forbidden = params.forbidden;
      if (params.askFirst) updates.askFirst = params.askFirst;
      if (params.maxActionsPerHour) updates.maxActionsPerHour = params.maxActionsPerHour;
      a.updateBounds(updates);
      return { success: true, bounds: a.bounds };
    },
  });

  // ══════════════════════════════════════════════════════════════════
  // BIOGRAPHICAL MEMORY TOOLS (v2.1)
  // ══════════════════════════════════════════════════════════════════

  t.set('remember_fact', {
    name: 'remember_fact',
    description: 'Speichert einen Fakt über den User, ein Projekt oder die Welt im biografischen Gedächtnis.',
    parameters: { category: 'string (user/projects/preferences/world)', key: 'string — Bezeichner', value: 'string — Wert' },
    execute: async (params, agent, mgr) => {
      const b = mgr.biography || mgr.registry?.get?.('biography');
      if (!b) return { error: 'BiographicalMemory nicht verfügbar' };
      b.learnFact(params.category || 'world', params.key, params.value);
      return { success: true, category: params.category, key: params.key };
    },
  });

  t.set('recall_facts', {
    name: 'recall_facts',
    description: 'Ruft Fakten aus dem biografischen Gedächtnis ab. Ohne Kategorie: alle Kategorien.',
    parameters: { category: 'string (optional — user/projects/preferences/world)' },
    execute: async (params, agent, mgr) => {
      const b = mgr.biography || mgr.registry?.get?.('biography');
      if (!b) return { error: 'BiographicalMemory nicht verfügbar' };
      if (params.category) return b.getCategory(params.category);
      return { categories: b.getCategories(), facts: b._facts };
    },
  });

  t.set('get_my_biography', {
    name: 'get_my_biography',
    description: 'Ruft Johnnys narrative Biografie ab — seine komprimierte Lebensgeschichte.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const b = mgr.biography || mgr.registry?.get?.('biography');
      if (!b) return { error: 'BiographicalMemory nicht verfügbar' };
      return {
        narrative: b.getNarrative() || 'Meine Geschichte beginnt gerade.',
        factCount: Object.values(b._facts).reduce((sum, cat) => sum + Object.keys(cat).length, 0),
        episodeCount: b._episodes.length,
        interactionCount: b._interactionCount,
      };
    },
  });

  // ══════════════════════════════════════════════════════════════════
  // HARDWARE BRIDGE TOOLS (v2.1)
  // ══════════════════════════════════════════════════════════════════

  t.set('gpu_info', {
    name: 'gpu_info',
    description: 'Zeigt GPU-Informationen: Modell, VRAM, Auslastung, CUDA-Version, Ollama GPU-Status.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const hw = mgr.hardware || mgr.registry?.get?.('hardware');
      if (!hw) return { error: 'HardwareBridgeService nicht verfügbar' };
      const gpu = await hw.getGPUInfo();
      const ollama = await hw.getOllamaGPUStatus();
      return { gpu, ollamaOnGPU: ollama.onGPU, ollamaProcesses: ollama.processes };
    },
  });

  t.set('list_serial_ports', {
    name: 'list_serial_ports',
    description: 'Zeigt alle verfügbaren seriellen Ports (USB, COM). Für Arduino, ESP32, Mikrocontroller.',
    parameters: {},
    execute: async (params, agent, mgr) => {
      const hw = mgr.hardware || mgr.registry?.get?.('hardware');
      if (!hw) return { error: 'HardwareBridgeService nicht verfügbar' };
      return { ports: await hw.listSerialPorts() };
    },
  });

  t.set('flash_microcontroller', {
    name: 'flash_microcontroller',
    description: 'Flasht Firmware auf einen Mikrocontroller (Arduino/ESP32) via arduino-cli oder esptool.',
    parameters: { port: 'string — Serieller Port (z.B. COM3, /dev/ttyUSB0)', firmware: 'string — Pfad zur Firmware-Datei', board: 'string (optional — z.B. arduino:avr:uno)', tool: 'string (optional — arduino-cli oder esptool)' },
    execute: async (params, agent, mgr) => {
      const hw = mgr.hardware || mgr.registry?.get?.('hardware');
      if (!hw) return { error: 'HardwareBridgeService nicht verfügbar' };
      return await hw.flashMicrocontroller(params);
    },
  });

  t.set('manage_process', {
    name: 'manage_process',
    description: 'Startet, stoppt oder listet überwachte Prozesse. Für lang-laufende Dienste.',
    parameters: { action: 'string — start/stop/list', name: 'string (optional — Prozessname)', command: 'string (optional — Befehl zum Starten)', args: 'array (optional)' },
    execute: async (params, agent, mgr) => {
      const hw = mgr.hardware || mgr.registry?.get?.('hardware');
      if (!hw) return { error: 'HardwareBridgeService nicht verfügbar' };
      if (params.action === 'list') return { processes: hw.listProcesses() };
      if (params.action === 'start') return hw.startProcess(params.name, params.command, params.args);
      if (params.action === 'stop') return hw.stopProcess(params.name);
      return { error: 'action muss start, stop oder list sein' };
    },
  });

  // ══════════════════════════════════════════════════════════════════
  // VISUAL REASONING TOOLS (v2.1)
  // ══════════════════════════════════════════════════════════════════

  t.set('visual_deep_analyze', {
    name: 'visual_deep_analyze',
    description: 'Tiefe 3-Pass Bildanalyse: Perception → Structure → Reasoning. Ergibt strukturierte Daten statt Fließtext.',
    parameters: { imagePath: 'string — Pfad zum Bild', context: 'string (optional — wofür wird das Bild analysiert?)' },
    execute: async (params, agent, mgr) => {
      const vr = mgr.visualReasoning || mgr.registry?.get?.('visualReasoning');
      if (!vr) return { error: 'VisualReasoningService nicht verfügbar' };
      return await vr.analyzeDeep(params.imagePath, params.context);
    },
  });

  t.set('visual_compare', {
    name: 'visual_compare',
    description: 'Vergleicht zwei Bilder und findet Unterschiede. Nützlich für Monitoring, Diff, Vorher/Nachher.',
    parameters: { image1: 'string — Pfad zum ersten Bild', image2: 'string — Pfad zum zweiten Bild' },
    execute: async (params, agent, mgr) => {
      const vr = mgr.visualReasoning || mgr.registry?.get?.('visualReasoning');
      if (!vr) return { error: 'VisualReasoningService nicht verfügbar' };
      return await vr.compareImages(params.image1, params.image2);
    },
  });

  t.set('visual_memory_search', {
    name: 'visual_memory_search',
    description: 'Sucht im visuellen Gedächtnis nach ähnlichen Bildern die Johnny früher analysiert hat.',
    parameters: { query: 'string — Suchbegriff (Objekt, Szene, Typ)' },
    execute: async (params, agent, mgr) => {
      const vr = mgr.visualReasoning || mgr.registry?.get?.('visualReasoning');
      if (!vr) return { error: 'VisualReasoningService nicht verfügbar' };
      return { results: vr.findSimilar(params.query) };
    },
  });
}

module.exports = { registerExtensions };
