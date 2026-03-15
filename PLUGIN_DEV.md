# Johnny Plugin & Skill Entwicklung

## Schnellstart: Hello World Plugin

### 1. Datei erstellen

Erstelle `skills/hello-world.js` im Johnny userData-Ordner:

```javascript
/**
 * Hello World Skill für Johnny
 * 
 * Johnny lädt alle .js Dateien aus dem skills/ Ordner automatisch.
 * Jedes Skill exportiert ein Objekt mit name, description und execute.
 */
module.exports = {
  name: 'hello_world',
  description: 'Sagt Hallo und zeigt die aktuelle Zeit an.',
  parameters: {
    name: 'string (optional) — Name zum Grüßen',
  },
  
  // execute wird von AgentManager aufgerufen wenn das LLM dieses Tool wählt
  async execute(params, agent, manager) {
    const name = params.name || 'Welt';
    const time = new Date().toLocaleTimeString('de');
    return {
      message: `Hallo ${name}! Es ist ${time}.`,
      timestamp: Date.now(),
    };
  }
};
```

### 2. Testen

Sage Johnny: **"Nutze hello_world um mich zu grüßen"**

Johnny erkennt das Tool automatisch und ruft es auf.

---

## Skill-Struktur

Jedes Skill ist eine `.js` Datei die ein Objekt exportiert:

```javascript
module.exports = {
  // Pflicht
  name: 'mein_tool',           // Tool-Name (snake_case, eindeutig)
  description: 'Was das Tool macht',  // LLM liest das um zu entscheiden ob es passt
  
  // Optional
  parameters: {                // Parameter-Beschreibung für das LLM
    query: 'string — Suchbegriff',
    limit: 'number (optional, default 10)',
  },
  
  // Pflicht
  async execute(params, agent, manager) {
    // params    — vom LLM extrahierte Parameter
    // agent     — der aufrufende Agent (name, model, etc.)
    // manager   — AgentManager mit Zugriff auf alle Services
    
    // Zugriff auf Services:
    // manager.searchService    — Web-Suche
    // manager.browserService   — Browser-Automation
    // manager.visionService    — Bildanalyse
    // manager.sandboxService   — Code ausführen
    // manager.nlpService       — Text-Analyse
    // manager.sensorService    — System-Sensoren
    // manager.imageGenService  — Bildgenerierung
    // manager.speechService    — Sprache
    // manager.ragService       — Wissensdatenbank
    // manager.ollamaService    — LLM direkt
    // manager.modelProvider    — Multi-Provider LLM
    
    return { result: 'Ergebnis hier' };
  }
};
```

---

## Beispiele

### Web-Suche Skill

```javascript
module.exports = {
  name: 'search_news',
  description: 'Sucht aktuelle Nachrichten zu einem Thema',
  parameters: { topic: 'string — Suchthema' },
  
  async execute(params, agent, manager) {
    if (!manager.searchService) return { error: 'Suchservice nicht verfügbar' };
    const results = await manager.searchService.search(params.topic, { maxResults: 5 });
    return { results: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) };
  }
};
```

### System-Info Skill

```javascript
module.exports = {
  name: 'system_check',
  description: 'Zeigt CPU, RAM und Festplatten-Nutzung',
  parameters: {},
  
  async execute(params, agent, manager) {
    const si = require('systeminformation');
    const [cpu, mem, disk] = await Promise.all([
      si.currentLoad(), si.mem(), si.fsSize()
    ]);
    return {
      cpu: Math.round(cpu.currentLoad) + '%',
      ram: Math.round(mem.used / mem.total * 100) + '%',
      disk: disk.map(d => ({ mount: d.mount, used: Math.round(d.use) + '%' })),
    };
  }
};
```

### Code-Ausführung Skill

```javascript
module.exports = {
  name: 'run_python',
  description: 'Führt Python-Code in der Sandbox aus',
  parameters: { code: 'string — Python-Code' },
  
  async execute(params, agent, manager) {
    if (!manager.sandboxService) return { error: 'Sandbox nicht verfügbar' };
    const result = await manager.sandboxService.runCode('python', params.code);
    return { output: result.output || result.stdout, errors: result.errors || result.stderr };
  }
};
```

### LLM-als-Tool Skill (Johnny fragt ein anderes Modell)

```javascript
module.exports = {
  name: 'ask_expert',
  description: 'Fragt ein spezialisiertes Modell eine Fachfrage',
  parameters: { 
    question: 'string — Die Frage',
    model: 'string (optional) — z.B. codellama:7b für Code-Fragen'
  },
  
  async execute(params, agent, manager) {
    const model = params.model || 'gemma2:9b';
    const result = await manager.ollamaService.generate(params.question, { model });
    return { answer: result, model };
  }
};
```

---

## Marketplace-Plugin (erweitert)

Für den Skill-Marketplace kann ein Skill auch Metadaten haben:

```javascript
module.exports = {
  // Basis
  name: 'weather_forecast',
  description: 'Wettervorhersage für eine Stadt',
  parameters: { city: 'string' },
  
  // Marketplace-Metadaten
  meta: {
    version: '1.0.0',
    author: 'Dein Name',
    category: 'utilities',
    tags: ['wetter', 'api', 'openweather'],
    requires: ['apiKeys.openweather'],  // Welche API-Keys werden benötigt
  },
  
  async execute(params, agent, manager) {
    const sensor = manager.sensorService;
    if (!sensor) return { error: 'SensorService nicht verfügbar' };
    return await sensor.getWeather(params.city);
  }
};
```

---

## Tipps

- **Skill-Ordner:** `%APPDATA%/johnny-ai-assistant/skills/` (Windows) oder `~/.config/johnny-ai-assistant/skills/` (Linux/Mac)
- **Hot-Reload:** Johnny lädt Skills beim Start. Für Änderungen: App neu starten oder sage "Lade Skills neu"
- **Debugging:** Nutze `console.log()` — Ausgabe erscheint in der Electron DevTools Console (F12)
- **Fehler:** Wenn `execute()` einen Error wirft, zeigt Johnny dem User "Tool fehlgeschlagen" und versucht es anders
- **Parameter-Extraktion:** Das LLM extrahiert Parameter aus der User-Nachricht basierend auf der `description` und `parameters` Beschreibung. Je klarer die Beschreibung, desto besser.

---

## Service-Referenz (manager.*)

| Service | Property | Beschreibung |
|---|---|---|
| Ollama | `manager.ollamaService` | Lokales LLM |
| Multi-Provider | `manager.modelProvider` | OpenAI/Anthropic/Google/Groq |
| Suche | `manager.searchService` | Web-Suche |
| Browser | `manager.browserService` | Puppeteer-Automation |
| Vision | `manager.visionService` | Bildanalyse |
| Sandbox | `manager.sandboxService` | Code ausführen |
| NLP | `manager.nlpService` | Text-Analyse |
| Sensoren | `manager.sensorService` | System/Netzwerk/Wetter |
| Bilder | `manager.imageGenService` | DALL-E/SD/ComfyUI |
| Sprache | `manager.speechService` | STT/TTS |
| RAG | `manager.ragService` | Wissensdatenbank |
| Smart Home | `manager.smartHomeService` | Home Assistant/Hue |
| Web Autonomy | `manager.webAutonomyService` | Autonomes Browsing |
