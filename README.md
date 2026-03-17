# Johnny AI Assistant v2.1 🤖

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-28-blueviolet.svg)](https://www.electronjs.org/)
[![Ollama](https://img.shields.io/badge/Ollama-Local%20LLM-orange.svg)](https://ollama.com/)

> **Autonomer KI-Desktop-Assistent** — 33.000+ Zeilen Code · 125 Tools · 53 Services · 35 Tests  
> Electron + Node.js + React · Läuft lokal · Denkt autonom · Lernt dazu

⚠️ **EXPERIMENTELLES PROJEKT** — Johnny kann Code ausführen, Dateien ändern, das Web durchsuchen
und autonom Nachrichten senden. Nutzung auf eigene Verantwortung.

---

## Inhaltsverzeichnis

- [Über Johnny](#über-johnny)
- [Schnellstart](#schnellstart)
- [Screenshots](#screenshots)
- [Architektur](#architektur)
- [Features im Detail](#features-im-detail)
- [Services (53)](#services-53)
- [Tool-System (125 Tools)](#tool-system-125-tools)
- [Unterstützte LLM-Provider](#unterstützte-llm-provider)
- [API-Keys (optional)](#api-keys-optional)
- [Heartbeat-Tasks](#heartbeat-tasks)
- [Plugin-System](#plugin-system)
- [Tests & Build](#tests--build)
- [Projektstruktur](#projektstruktur)
- [Mitwirken (Contributing)](#mitwirken-contributing)
- [Lizenz](#lizenz)

---

## Über Johnny

Johnny ist eine vollständige **Electron-Desktop-Anwendung** — kein Chatbot-Wrapper, kein Web-UI.
Er besitzt eine eigene Persönlichkeit mit Emotionen, Trait-Drift und Tagebuch. Das Sprachmodell
(Ollama lokal oder Cloud-Provider) dient als sein „Denkorgan", aber Johnny ist die Anwendung
drumherum: Gedächtnis, Werkzeuge, Sensoren, autonomes Handeln.

**Was Johnny von anderen KI-Assistenten unterscheidet:**

- **Vollständig lokal** — Kein Account, kein Server, keine Cloud nötig. Ollama + ein Modell reichen aus.
- **Autonomes Handeln** — Johnny kann eigenständig Tasks ausführen, Webseiten überwachen, Systeme prüfen und Nachrichten senden.
- **Persönlichkeit** — Emotionen, Charaktereigenschaften mit Trait-Drift, Selbstreflexion und ein eigenes Tagebuch.
- **53 Services** — Von Spracherkennung über Smart Home bis hin zu Multi-Agent-Schwärmen.
- **125 Tools** — 85 Kern-Tools + 40 Erweiterungs-Tools für NLP, Sensoren, Web, Bilder, Sprache und mehr.
- **Multi-Provider** — Ollama (lokal), OpenAI, Anthropic, Google, Groq — nahtlos wechselbar.
- **Erweiterbar** — Plugin-System, Skill-Marketplace und offene Architektur.

---

## Schnellstart

```bash
# 1. Repository klonen
git clone https://github.com/Garrus800-stack/AI-Johnny.git
cd AI-Johnny

# 2. Abhängigkeiten installieren
npm install

# 3. Ollama starten (in separatem Terminal)
ollama serve
ollama pull gemma2:9b

# 4. Johnny starten
npm start
```

> 📖 **Detaillierte Installationsanleitung** mit Schritt-für-Schritt-Befehlen für Windows, Linux und macOS: → [INSTALL.md](INSTALL.md)

---

## Screenshots

> *Screenshots folgen — Beiträge willkommen!*

---

## Architektur

Johnny basiert auf einer modularen Service-Architektur mit einem zentralen **ServiceRegistry v2**,
das alle 53 Services über ein Zwei-Phasen-Init-System verwaltet: Phase 1 (Initialisierung) und
Phase 2 (Wiring/Verdrahtung). Das IPC-Channel-System (`channels.js`) dient als Single Source of
Truth für die Kommunikation zwischen Main- und Renderer-Prozess.

```
AI-Johnny/
├── main.js                          ← Boot-Sequenz, ServiceRegistry v2, IPC-Setup
├── preload.js                       ← IPC-Whitelist (automatisch aus channels.js)
├── package.json                     ← Abhängigkeiten & Build-Konfiguration
│
├── src/
│   ├── core/
│   │   ├── ServiceRegistry.js       ← Zwei-Phasen-Init + deklaratives Wiring
│   │   ├── ConversationStore.js     ← SQLite-basierte Chat-Persistenz
│   │   ├── EventBus.js              ← Publish/Subscribe Event-System
│   │   └── Logger.js                ← Zentrales Logging
│   │
│   ├── ipc/
│   │   ├── channels.js              ← Single Source of Truth (alle IPC-Channels)
│   │   └── handlers.js              ← 190+ IPC-Handler
│   │
│   ├── services/                    ← 53 Services (siehe Liste unten)
│   │   ├── JohnnyCore.js            ← Persönlichkeit, Emotionen, Reflexion
│   │   ├── AgentManager.js          ← Multi-Agent + Tool-Orchestrierung
│   │   ├── ModelProvider.js         ← Ollama + OpenAI + Anthropic + Google + Groq
│   │   ├── ToolRegistry.js          ← 85 Kern-Tools
│   │   ├── ToolRegistryExtensions.js ← 40 Erweiterungs-Tools
│   │   └── ... (48 weitere)
│   │
│   ├── components/
│   │   ├── App.jsx                  ← Haupt-React-Komponente
│   │   ├── SetupWizard.jsx          ← Ersteinrichtungs-Assistent
│   │   ├── views/                   ← 6 View-Module (aufgeteilt aus Monolith)
│   │   │   ├── ViewRegistry.js      ← Router (34 Zeilen)
│   │   │   ├── ViewsCore.js         ← Chat, Dashboard, Agents, Models, Settings
│   │   │   ├── ViewsTools.js        ← Sandbox, ImageGen, Video, RAG, Skills
│   │   │   ├── ViewsSystem.js       ← Docker, Monitoring, Collaboration, Swarm
│   │   │   ├── ViewsAdvanced.js     ← EmotionAI, CreativeWriting, EnhancedVision
│   │   │   └── ViewsAutomation.js   ← Heartbeat, SmartHome, Integrations
│   │   ├── ui/                      ← UI-Komponenten (UIKit, Dialoge)
│   │   └── context/AppContext.js    ← React State + IPC Bridge
│   │
│   └── patches/                     ← Kompatibilitäts-Patches
│       └── AgentManagerSQLitePatch.js
│
├── public/
│   ├── index.html                   ← Frontend-Entry
│   └── collab-client.html           ← Collaboration-Client
│
├── scripts/
│   └── install-ollama.js            ← Ollama-Installer-Skript
│
├── tests/
│   └── run.js                       ← 35 Unit-Tests
│
├── build.js                         ← JSX-Transpilation (esbuild)
├── start-johnny.bat                 ← Windows-Starter (Batch)
│
├── INSTALL.md                       ← Installationsanleitung
├── PLUGIN_DEV.md                    ← Plugin-Entwicklung
├── BUILD.md                         ← Build-Anleitung
├── CHANGELOG.md                     ← Versionshistorie
└── LICENSE                          ← MIT-Lizenz
```

---

## Features im Detail

### 💬 Chat-System
- **Streaming-Antworten** — Token-für-Token mit Live-Bubble und Streaming-Indikator
- **Markdown-Rendering** — Code-Blöcke mit Syntax-Highlighting, Tabellen, Listen, Blockquotes, Links
- **Conversation-Sidebar** — Ausklappbares Panel mit Suche, Export und Lösch-Funktion
- **Sprachsteuerung** — Push-to-Talk + Sprachausgabe (TTS/STT)
- **Bild-Drag & Drop** — Bilder direkt in den Chat ziehen mit Vorschau
- **Code-Aktionen** — Speichern, als ZIP exportieren, in Sandbox öffnen
- **Copy-Button** — Ein-Klick-Kopieren an jeder Nachricht
- **Error-Toast-System** — Animierte Benachrichtigungen bei Fehlern und Erfolgen

### 🧠 Persönlichkeit & Gedächtnis
- **JohnnyCore** — Emotionen, Trait-Drift, Selbstreflexion, Tagebuch
- **BiographicalMemory** — Episodisches, semantisches und narratives Gedächtnis
- **ContextMemoryService** — Kontextbezogene Erinnerungen über Gespräche hinweg
- **ConversationStore** — SQLite-basierte Chat-Persistenz mit Volltextsuche
- **FeedbackLearning** — Lernt aus explizitem Nutzer-Feedback (Daumen hoch/runter)
- **StyleProfile** — Passt Antwort-Stil automatisch an den Nutzer an

### 🔍 Web & Autonomie
- **WebSearchService** — Websuche via Serper/Google
- **WebAutonomyService** — Autonomes Browsing, Deep Research, RSS, Page Monitoring
- **BrowserAutomationService** — Puppeteer-basierte Browser-Steuerung
- **CDPBrowserService** — Chrome DevTools Protocol Integration

### 🎨 Kreativ-Suite
- **ImageGeneration** — DALL-E 3, Stable Diffusion (AUTOMATIC1111), ComfyUI, 12 Stil-Presets, Img2Img, AI Upscaling
- **CreativeWritingService** — Multi-Genre, Plot-Strukturen, Charakter-Tracker
- **CreativityService** — Brainstorming, Ideengenerierung

### 🗣️ Sprache & Vision
- **SpeechService v2** — Faster-Whisper, Whisper.cpp, OpenAI Whisper, Streaming, VAD
- **VisionService** — Bildanalyse mit lokalen und Cloud-Modellen
- **EnhancedVisionService** — Multi-Pass-Analyse, OCR, Code-Screenshot-Erkennung
- **VisualReasoningService** — Drei-Pass-Bildanalyse mit Reasoning
- **VideoAnalysisService** — Video-Analyse und Frame-Extraktion

### 🏠 Smart Home & Hardware
- **SmartHomeService** — Home Assistant, Philips Hue, MQTT
- **HardwareBridgeService** — GPU-Info, Arduino/ESP32-Flashing, Serial-Kommunikation
- **SensorService** — CPU, RAM, Temperatur, Disk, Batterie, Netzwerk, Webcam, Wetter

### 📡 Messenger-Integration
- Telegram, Discord, WhatsApp, Slack, Matrix, E-Mail (SMTP/IMAP)

### 🤖 Multi-Agent & Schwarm
- **AgentManager** — Multi-Agent-Orchestrierung mit Tool-Calling
- **SwarmService / SwarmServiceV2** — Koordinierte Agent-Schwärme
- **AutonomyService** — OBSERVE → EVALUATE → ACT Pipeline

---

## Services (53)

| Kategorie | Services |
|---|---|
| **Kern** | JohnnyCore, OllamaService, ModelProvider, AgentManager |
| **Gedächtnis** | ConversationStore (SQLite), BiographicalMemory, ContextMemory, EmbeddingService, RAGService (ChromaDB) |
| **Sprache** | SpeechService (Faster-Whisper/Whisper.cpp/OpenAI), NLPService |
| **Vision** | VisionService, EnhancedVision, VisualReasoning, VideoAnalysis |
| **Web** | WebSearch, WebAutonomy, BrowserAutomation, CDPBrowser |
| **Kreativ** | ImageGeneration (DALL-E/SD/ComfyUI), Creativity, CreativeWriting |
| **Sensoren** | SensorService (CPU/RAM/Netzwerk/Webcam/Wetter/Serial) |
| **Automation** | HeartbeatTasks, AutonomyService, BackgroundDaemon, SelfImprovement |
| **Smart Home** | SmartHome (Home Assistant, Philips Hue, MQTT) |
| **Messenger** | Telegram, Discord, WhatsApp, Slack, Matrix, Email |
| **Infrastruktur** | Gateway, MCPServer, Collaboration, SkillMarketplace, Cloudflare, SecurityService |
| **Analyse** | EmotionalIntelligence, DataAnalysis, TimeSeries, ErrorAnalysis |
| **Integration** | ExternalIntegrationHub, IntegrationsService, PluginManager, HardwareBridge |
| **Lernen** | FeedbackLearning, StyleProfile |
| **System** | AutoUpdater, SetupWizard, SandboxService, ToolRegistry, ToolRegistryExtensions |

---

## Tool-System (125 Tools)

### 85 Kern-Tools (ToolRegistry)
File-System, Code-Ausführung, Web-Suche, Bildgenerierung, Agent-Steuerung, Conversation-Management, System-Info und mehr.

### 40 Erweiterungs-Tools (ToolRegistryExtensions)

| Bereich | Tools |
|---|---|
| **NLP** | `nlp_full_analysis`, `nlp_extract_entities`, `nlp_sentiment`, `nlp_summarize`, `nlp_compare_texts`, `nlp_keywords`, `nlp_complexity` |
| **Sensor** | `sensor_system_info`, `sensor_ping`, `sensor_port_check`, `sensor_network`, `sensor_wifi_scan`, `sensor_weather`, `sensor_serial_*`, `sensor_webcam`, `sensor_watch_folder`, `sensor_time`, `sensor_process_check` |
| **Web** | `web_analyze_page`, `web_autonomous_task`, `web_deep_research`, `web_rss_feed`, `web_monitor_page` |
| **Bild** | `generate_image_styled`, `image_to_image`, `image_upscale` |
| **Sprache** | `speech_start_listening`, `speech_stop_listening`, `speech_detect_language`, `speech_capabilities` |
| **Selbst** | `self_reflect`, `get_diary`, `get_my_traits`, `get_my_architecture` |
| **Heartbeat** | `create_health_check`, `create_daily_reflection`, `create_service_watchdog` |

---

## Unterstützte LLM-Provider

| Provider | Modelle (Beispiele) | Typ |
|---|---|---|
| **Ollama** (Standard) | gemma2:9b, llama3.1:8b, mistral:7b, gemma2:2b | Lokal |
| **OpenAI** | GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo | Cloud |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Opus | Cloud |
| **Google** | Gemini Pro, Gemini Ultra | Cloud |
| **Groq** | Llama 3, Mixtral (schnelle Inferenz) | Cloud |

> 💡 **Ollama allein reicht vollkommen aus.** Cloud-Provider sind optional und erfordern API-Keys.

---

## API-Keys (optional)

Johnny funktioniert vollständig lokal mit Ollama. Folgende API-Keys schalten zusätzliche Funktionen frei:

| Key | Funktion | Konfiguration |
|---|---|---|
| **OpenAI** | GPT-4, DALL-E 3, Whisper, TTS | Settings → Models → Cloud Providers |
| **Anthropic** | Claude-Modelle | Settings → Models → Cloud Providers |
| **Google** | Gemini-Modelle | Settings → Models → Cloud Providers |
| **Groq** | Schnelle Inferenz (Llama/Mixtral) | Settings → Models → Cloud Providers |
| **ElevenLabs** | Premium Text-to-Speech | Settings → Voice |
| **Serper** | Google Search API | Settings → Web Search |

---

## Heartbeat-Tasks

Johnny kann autonom im Hintergrund Tasks ausführen:

| Task | Beschreibung | Intervall |
|---|---|---|
| 🌅 Morning Briefing | Tägliche Zusammenfassung | Täglich |
| 💻 System Health | CPU/RAM/Disk-Überwachung | Alle 5 Min |
| 📊 Selbstreflexion | Performance-Muster erkennen | Täglich |
| 🔍 Service Watchdog | Ollama/ChromaDB prüfen | Alle 10 Min |
| 🌐 Web Monitor | Webseiten auf Änderungen überwachen | Konfigurierbar |
| 🧹 Cleanup | Temporäre Dateien bereinigen | Täglich |

---

## Plugin-System

Johnny unterstützt ein offenes Plugin-System. Plugins können neue Tools, Services und UI-Views hinzufügen.

→ Ausführliche Dokumentation: [PLUGIN_DEV.md](PLUGIN_DEV.md)

---

## Tests & Build

```bash
# Tests ausführen (35 Tests)
npm test

# Einzelnen Test filtern
npm run test:filter -- ServiceRegistry

# Windows EXE erstellen
npm run build

# JSX-Transpilation (optional, für neue Views mit JSX-Syntax)
npm run build:jsx
npm run build:jsx:watch
```

→ Ausführliche Build-Anleitung: [BUILD.md](BUILD.md)

---

## Projektstruktur

| Datei / Ordner | Beschreibung |
|---|---|
| `main.js` | Electron Main-Prozess, Boot-Sequenz, ServiceRegistry |
| `preload.js` | IPC-Whitelist (auto-generiert aus channels.js) |
| `src/core/` | ServiceRegistry, ConversationStore, EventBus, Logger |
| `src/ipc/` | IPC-Channels (Single Source of Truth) + 190 Handler |
| `src/services/` | 53 Services |
| `src/components/` | React-UI: Views, Context, UIKit |
| `public/` | Frontend-HTML, Icons |
| `scripts/` | Helper-Skripte (Ollama-Installer) |
| `tests/` | Test-Suite (35 Tests) |

---

## Mitwirken (Contributing)

Beiträge sind willkommen! So kannst du mitmachen:

1. **Fork** das Repository
2. **Branch** erstellen: `git checkout -b feature/mein-feature`
3. **Commit** mit aussagekräftiger Nachricht: `git commit -m "feat: Beschreibung"`
4. **Push** zum Branch: `git push origin feature/mein-feature`
5. **Pull Request** erstellen

Bitte halte dich an die bestehende Code-Struktur und ergänze Tests für neue Features.

### Coding-Konventionen
- Services erben von der ServiceRegistry-Architektur (`wireDeps` / `wireMap`)
- IPC-Channels werden ausschließlich in `src/ipc/channels.js` definiert
- Tools werden in `ToolRegistry.js` oder `ToolRegistryExtensions.js` registriert
- Neue Views gehören in das passende `Views*.js`-Modul

---

## Lizenz

Dieses Projekt ist unter der [MIT-Lizenz](LICENSE) lizenziert.

**Nutzung auf eigene Verantwortung.** Johnny kann autonom handeln — bitte prüfe die Konfiguration
vor produktivem Einsatz.

---

<p align="center">
  Made with ❤️ and too much coffee ☕
</p>
