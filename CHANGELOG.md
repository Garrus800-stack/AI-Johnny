# Changelog — Johnny AI Assistant

---

## v2.1.0 — Architektur-Refactoring + UX-Upgrade

### Architektur
- **ServiceRegistry v2** — Zwei-Phasen-Init: Phase 1 (Init) + Phase 2 (Wiring)
  - `wireDeps` und `wireMap` für deklaratives Service-Wiring
  - `registerWiring()` für explizite Verdrahtung
  - `getHealth()` für vollständigen Service-Report
  - 20 Services mit wireDeps statt hartem `['agentManager']` Init-Dep
  - Kein Service fällt mehr aus wenn Ollama kurz offline ist
- **IPC Channel Contract** (`src/ipc/channels.js`) — Single Source of Truth
  - preload.js liest Whitelist automatisch aus channels.js
  - Neuer Channel? → In channels.js eintragen, fertig
- **View-Splitting** — ViewRegistry.js: 3.068 → 34 Zeilen (nur Router)
  - ViewsCore.js, ViewsTools.js, ViewsSystem.js, ViewsAdvanced.js, ViewsAutomation.js
- **Boot-Reihenfolge** — IPC-Handler vor createWindow (behebt alle "No handler" Fehler)
- **Test-Suite** — 35 Tests (ServiceRegistry, IPC-Sync, Views, Features)

### Chat-UX
- **Streaming-Antworten** — Token-für-Token mit Live-Bubble + "● streaming" Indikator
- **Markdown-Rendering** — markdown-it für Code, Tabellen, Listen, Blockquotes, Links
- **Conversation-Sidebar** — Collapsible Panel: Suchen, Exportieren, Löschen
- **Bild-Drag&Drop** — Bilder in Chat-Input ziehen → Preview + Anhang
- **Copy-Button** — 📋 Kopieren an jeder Nachricht
- **Error-Toast-System** — Animated Notifications bei Fehlern/Erfolgen

### Ollama
- **Health-Banner** — Erkennt wenn Ollama nicht erreichbar → Banner mit Cloud-Fallback-Button
- **Auto-Reconnect** — Heartbeat prüft Ollama alle 10s, Toast bei Wiederverbindung
- **Modell-Persistenz** — `:latest` Suffix-Matching, Cloud-Provider im Dropdown sichtbar

### Neue Services
- **NLPService** — Named Entities, Sentiment, Keywords, Summarization, Text-Vergleich
- **SensorService** — CPU/RAM/Temperatur/Disk/Batterie/Netzwerk/Serial/Webcam/Wetter
- **WebAutonomyService** — Autonomes Browsing, Deep Research, RSS, Page Monitoring
- **AutoUpdater** — electron-updater Integration für automatische Updates

### Erweiterte Services
- **SpeechService v2** — Faster-Whisper, Whisper.cpp, OpenAI Whisper, Streaming, VAD
- **ImageGenerationService v2** — 12 Stil-Presets, ComfyUI, Img2Img, AI Upscaling
- **HeartbeatTaskService** — 6 Task-Typen: health, reflection, watchdog, cleanup, agent, command
- **JohnnyCore Selbstreflexion** — Tool-Muster, Interaktions-Patterns, Tiefe Reflexion

### 40 neue Tools (ToolRegistryExtensions)
- NLP: `nlp_full_analysis`, `nlp_extract_entities`, `nlp_sentiment`, `nlp_summarize`, `nlp_compare_texts`, `nlp_keywords`, `nlp_complexity`
- Sensor: `sensor_system_info`, `sensor_ping`, `sensor_port_check`, `sensor_network`, `sensor_wifi_scan`, `sensor_weather`, `sensor_serial_*`, `sensor_webcam`, `sensor_watch_folder`, `sensor_time`, `sensor_process_check`
- Web: `web_analyze_page`, `web_autonomous_task`, `web_deep_research`, `web_rss_feed`, `web_monitor_page`
- Image: `generate_image_styled`, `image_to_image`, `image_upscale`
- Speech: `speech_start_listening`, `speech_stop_listening`, `speech_detect_language`, `speech_capabilities`
- Self: `self_reflect`, `get_diary`, `get_my_traits`, `get_my_architecture`
- Heartbeat: `create_health_check`, `create_daily_reflection`, `create_service_watchdog`

### Bug-Fixes
- `mgr.imageService` → `mgr.imageGenService` (3 Image-Tools waren kaputt)
- Sandbox Output: `r.output || r.stdout` (Property-Name-Mismatch)
- Enhanced Vision: falscher Status-Key `eiStatus` → `evStatus`
- preload.js: 10+ fehlende Channels (check-docker, open-file-path, etc.)
- Cloud Provider: services-initialized lädt Provider nach
- ffmpeg-Erkennung: Cross-Platform (Windows/Mac/Linux Pfade)
- transcribe-audio: OpenAI API zuerst (akzeptiert webm direkt)

### Dokumentation
- README.md — Komplett neu, Architektur + Features
- INSTALL.md — Schritt-für-Schritt Windows/Linux/Mac mit Terminal-Befehlen
- PLUGIN_DEV.md — Plugin-Entwicklung mit Beispielen
- 8 veraltete Docs entfernt (MIGRATION, UPGRADE, INTEGRATION_GUIDE, etc.)

---

## v2.0.0 — Advanced Services

### Neue Services
- EmotionalIntelligenceService — Multi-dimensionales Sentiment, Empathie, Krisenkennung
- CreativeWritingService — Multi-Genre, Plot-Strukturen, Charakter-Tracker
- EnhancedVisionService — Multi-Pass Analyse, OCR, Code-Screenshots
- TimeSeriesAnalysisService — Trends, Anomalien, Forecasting
- ExternalIntegrationHub — Webhook-Workflows, Multi-Service Verbindungen
- CollaborationService — Echtzeit-Zusammenarbeit über WebSocket

### Verbesserungen
- ConversationStore (SQLite) — Ersetzt Markdown-basierte Persistenz
- EmbeddingService — Semantische Memory-Suche via Ollama
- StyleProfileService — Passt Antwort-Stil an User an
- FeedbackLearningService — Lernt aus Daumen-hoch/runter

---

## v1.8.x — Foundation

- ServiceRegistry — Dependency-basierte Service-Initialisierung
- preload.js — IPC-Whitelist für Sicherheit
- Multi-Provider (Ollama + OpenAI + Anthropic + Google + Groq)
- Agent-System mit Tool-Calling
- Telegram, Discord, WhatsApp, Slack, Matrix Messenger
- Smart Home (Home Assistant, Philips Hue)
- Sandbox (Docker + Process)
- RAG mit ChromaDB
- Skill-Marketplace
