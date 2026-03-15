# Johnny AI Assistant v2.1 🤖

> **Autonomer KI-Desktop-Assistent** — 33.000+ Zeilen Code, 125 Tools, 42 Services.
> Electron + Node.js + React. Läuft lokal, denkt autonom, lernt dazu.

⚠️ **EXPERIMENTELLES PROJEKT** — Johnny kann Code ausführen, Dateien ändern, das Web durchsuchen
und autonom Nachrichten senden. Nutzung auf eigene Verantwortung.

---

## Was ist Johnny?

Johnny ist eine Electron-Desktop-App — kein Chatbot, kein Wrapper. Er hat eine eigene
Persönlichkeit mit Emotionen, Trait-Drift und Tagebuch. Das Sprachmodell (Ollama lokal oder
Cloud-Provider) ist sein "Denkorgan", aber Johnny ist die Anwendung drumherum:
Gedächtnis, Werkzeuge, Sensoren, autonomes Handeln.

## Schnellstart

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Ollama starten (in separatem Terminal)
ollama serve
ollama pull gemma2:9b

# 3. Johnny starten
npm start
```

→ Detaillierte Anleitung: [INSTALL.md](INSTALL.md)

---

## Architektur

```
johnny-ai-assistant/
├── main.js                        ← Boot, ServiceRegistry v2, IPC
├── preload.js                     ← IPC-Whitelist (auto aus channels.js)
├── src/
│   ├── core/ServiceRegistry.js    ← Zwei-Phasen-Init + deklaratives Wiring
│   ├── ipc/
│   │   ├── channels.js            ← Single Source of Truth (IPC-Channels)
│   │   └── handlers.js            ← 190+ Handler
│   ├── services/                  ← 42 Services
│   │   ├── AgentManager.js        ← Multi-Agent + Tool-Orchestrierung
│   │   ├── JohnnyCore.js          ← Persönlichkeit, Emotionen, Reflexion
│   │   ├── ModelProvider.js       ← Ollama + OpenAI + Anthropic + Google + Groq
│   │   ├── ToolRegistry.js        ← 85 Kern-Tools
│   │   ├── ToolRegistryExtensions ← 40 Erweiterungs-Tools
│   │   └── ... (37 weitere)
│   └── components/
│       ├── views/                 ← 6 View-Module
│       │   ├── ViewRegistry.js    ← Router (34 Zeilen)
│       │   ├── ViewsCore.js       ← Chat, Dashboard, Agents, Models, Settings
│       │   ├── ViewsTools.js      ← Sandbox, ImageGen, Video, RAG, Skills
│       │   ├── ViewsSystem.js     ← Docker, Monitoring, Collaboration, Swarm
│       │   ├── ViewsAdvanced.js   ← EmotionAI, CreativeWriting, EnhancedVision
│       │   └── ViewsAutomation.js ← Heartbeat, SmartHome, Integrations
│       └── context/AppContext.js  ← React State + IPC
├── tests/run.js                   ← 35 Tests
└── public/index.html              ← Frontend
```

## Features

### Chat
- **Streaming**: Token-für-Token Antworten (live)
- **Markdown-Rendering**: Code-Blöcke, Tabellen, Listen, Links
- **Conversation-Sidebar**: Suchen, Exportieren, Löschen
- **Sprachsteuerung**: Push-to-Talk + Sprachausgabe
- **Bild-Drag&Drop**: Bilder in den Chat ziehen
- **Code-Aktionen**: Speichern, ZIP, in Sandbox öffnen

### Services (42)
| Kategorie | Services |
|---|---|
| Denken | Ollama, ModelProvider, AgentManager, JohnnyCore |
| Gedächtnis | SQLite ConversationStore, ChromaDB RAG, ContextMemory |
| Sprechen | SpeechService (Faster-Whisper/Whisper.cpp/OpenAI), NLPService |
| Sehen | VisionService, EnhancedVision |
| Web | WebSearch, WebAutonomy, BrowserAutomation, CDPBrowser |
| Kreativ | ImageGeneration (DALL-E/SD/ComfyUI), Creativity, CreativeWriting |
| Sensoren | CPU/RAM/Netzwerk/Webcam/Wetter/Serial |
| Automation | HeartbeatTasks, SwarmService, SelfImprovement |
| Smart Home | Home Assistant, Philips Hue, MQTT |
| Messenger | Telegram, Discord, WhatsApp, Slack, Matrix, Email |
| Infrastruktur | Gateway, MCP, Collaboration, Marketplace, Cloudflare |
| Analyse | EmotionalIntelligence, DataAnalysis, TimeSeries |

### Heartbeat-Tasks (autonom im Hintergrund)
- 🌅 Morning Briefing — Tägliche Zusammenfassung
- 💻 System Health — CPU/RAM/Disk Überwachung
- 📊 Selbstreflexion — Performance-Muster erkennen
- 🔍 Service Watchdog — Ollama/ChromaDB prüfen
- 🌐 Web Monitor — Websites überwachen
- 🧹 Cleanup — Temp-Dateien bereinigen

---

## API-Keys (optional — Ollama allein reicht)

| Key | Für | Wo |
|---|---|---|
| OpenAI | GPT-4, DALL-E 3, Whisper, TTS | Models → Cloud Providers |
| Anthropic | Claude | Models → Cloud Providers |
| ElevenLabs | Premium TTS | Settings → Voice |
| Serper | Google Search | Settings |

---

## Tests & Build

```bash
npm test                       # 35 Tests
npm run build                  # Windows EXE
```

## Plugins

→ [PLUGIN_DEV.md](PLUGIN_DEV.md)

## Lizenz

MIT — Nutzung auf eigene Verantwortung.
