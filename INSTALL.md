# Installationsanleitung — Johnny AI Assistant v2.1

Vollständige Schritt-für-Schritt-Anleitung für **Windows**, **Linux** und **macOS**.

---

## Inhaltsverzeichnis

- [Systemvoraussetzungen](#systemvoraussetzungen)
- [Installation — Windows](#installation--windows)
- [Installation — Linux (Ubuntu/Debian)](#installation--linux-ubuntudebian)
- [Installation — macOS](#installation--macos)
- [Installations-Stufen](#installations-stufen)
- [Optionale Abhängigkeiten](#optionale-abhängigkeiten)
- [Erster Start & Setup-Wizard](#erster-start--setup-wizard)
- [Konfiguration](#konfiguration)
- [Update auf neue Versionen](#update-auf-neue-versionen)
- [Deinstallation](#deinstallation)
- [Fehlerbehebung (Troubleshooting)](#fehlerbehebung-troubleshooting)
- [Port-Referenz](#port-referenz)
- [Hilfe & Support](#hilfe--support)

---

## Systemvoraussetzungen

### Mindestanforderungen

| Komponente | Minimum | Empfohlen |
|---|---|---|
| **Betriebssystem** | Windows 10, Ubuntu 20.04, macOS 12 | Windows 11, Ubuntu 22.04+, macOS 13+ |
| **RAM** | 8 GB | 16 GB |
| **Freier Speicher** | 10 GB (inkl. Modell) | 20 GB+ |
| **CPU** | 4 Kerne | 8+ Kerne |
| **GPU** (optional) | — | NVIDIA (CUDA), AMD (ROCm) oder Intel (IPEX) |

### Erforderliche Software

| Software | Version | Zweck | Download |
|---|---|---|---|
| **Node.js** | 18+ (empfohlen: 20 LTS) | Anwendungs-Runtime | [nodejs.org](https://nodejs.org/) |
| **npm** | 9+ (wird mit Node.js installiert) | Paketmanager | — |
| **Ollama** | 0.3+ | Lokales LLM | [ollama.com](https://ollama.com/download) |
| **Git** | beliebig (optional) | Repository klonen | [git-scm.com](https://git-scm.com/) |

### Empfohlene LLM-Modelle

| Modell | Größe | RAM-Bedarf | Beschreibung |
|---|---|---|---|
| `gemma2:9b` | ~5 GB | 8 GB | **Standard** — Gute Qualität, moderate Geschwindigkeit |
| `gemma2:2b` | ~1.5 GB | 4 GB | Kleines Modell — Schnell, gut für schwächere Hardware |
| `llama3.1:8b` | ~4.7 GB | 8 GB | Meta Llama 3.1 — Starke Allround-Performance |
| `mistral:7b` | ~4.1 GB | 8 GB | Mistral 7B — Schnell und effizient |

---

## Installation — Windows

### Schritt 1: Node.js installieren

Öffne **PowerShell** oder **Windows Terminal** als Administrator:

```powershell
# Option A: Installation über winget (empfohlen)
winget install OpenJS.NodeJS.LTS

# Option B: Manuell
# → https://nodejs.org → LTS-Version herunterladen und installieren

# Installation prüfen:
node --version    # Erwartete Ausgabe: v18.x.x oder höher
npm --version     # Erwartete Ausgabe: v9.x.x oder höher
```

> ⚠️ **Wichtig:** Nach der Installation ein neues Terminal-Fenster öffnen, damit `node` und `npm` im PATH verfügbar sind.

### Schritt 2: Ollama installieren

```powershell
# Option A: Installation über winget
winget install Ollama.Ollama

# Option B: Manuell
# → https://ollama.com/download → Windows-Installer herunterladen

# Ollama starten (läuft als Hintergrunddienst oder manuell):
ollama serve
```

Modell in einem **neuen Terminal** herunterladen:

```powershell
# Standard-Modell (empfohlen):
ollama pull gemma2:9b

# Alternativen je nach Hardware:
# ollama pull gemma2:2b         # Für schwächere Hardware (1.5 GB)
# ollama pull llama3.1:8b       # Meta Llama 3.1
# ollama pull mistral:7b        # Mistral 7B
```

### Schritt 3: Johnny AI installieren

```powershell
# Repository klonen:
git clone https://github.com/Garrus800-stack/AI-Johnny.git
cd AI-Johnny

# Abhängigkeiten installieren:
npm install
```

> 💡 **Ohne Git?** Lade das Repository als ZIP von [GitHub](https://github.com/Garrus800-stack/AI-Johnny/archive/refs/heads/main.zip) herunter und entpacke es.

### Schritt 4: Starten

```powershell
# Standard-Start:
npm start

# Entwickler-Modus (mit DevTools):
npm run dev

# Alternative: Batch-Datei verwenden:
.\start-johnny.bat
```

Johnny öffnet sich als Desktop-Fenster. Beim ersten Start erscheint der **Setup-Wizard**.

---

## Installation — Linux (Ubuntu/Debian)

### Schritt 1: Node.js installieren

```bash
# NodeSource-Repository hinzufügen und Node.js 20 LTS installieren:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Installation prüfen:
node --version    # v20.x.x
npm --version     # v10.x.x
```

### Schritt 2: Ollama installieren

```bash
# Ollama-Installer ausführen:
curl -fsSL https://ollama.com/install.sh | sh

# Ollama im Hintergrund starten:
ollama serve &

# Modell herunterladen:
ollama pull gemma2:9b
```

### Schritt 3: Johnny AI installieren

```bash
# Repository klonen:
git clone https://github.com/Garrus800-stack/AI-Johnny.git
cd AI-Johnny

# Abhängigkeiten installieren:
npm install
```

### Schritt 4: Electron-Abhängigkeiten (bei Bedarf)

Falls Electron beim Start Fehler wegen fehlender Libraries wirft:

```bash
sudo apt install -y libgtk-3-0 libnotify4 libnss3 libxss1 \
  libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0
```

### Schritt 5: Starten

```bash
npm start

# Entwickler-Modus:
npm run dev

# Falls Sandbox-Fehler auftreten:
npx electron . --no-sandbox
```

---

## Installation — macOS

### Schritt 1: Homebrew installieren (falls nicht vorhanden)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Schritt 2: Node.js & Ollama installieren

```bash
# Node.js:
brew install node

# Ollama:
brew install ollama
ollama serve &
ollama pull gemma2:9b
```

### Schritt 3: Johnny AI installieren & starten

```bash
git clone https://github.com/Garrus800-stack/AI-Johnny.git
cd AI-Johnny
npm install
npm start
```

---

## Installations-Stufen

Je nach gewünschtem Funktionsumfang gibt es drei Installationsstufen:

### 🟢 Minimal — Nur Chat

Alles was du brauchst, um mit Johnny zu chatten:

```bash
git clone https://github.com/Garrus800-stack/AI-Johnny.git
cd AI-Johnny
ollama pull gemma2:9b
npm install
npm start
```

### 🟡 Empfohlen — Chat + Sprache + Bilder

Zusätzlich Spracherkennung und Sprachausgabe:

```bash
git clone https://github.com/Garrus800-stack/AI-Johnny.git
cd AI-Johnny
ollama pull gemma2:9b
npm install

# Spracherkennung & Sprachausgabe:
pip install faster-whisper edge-tts --break-system-packages  # Linux/macOS
# pip install faster-whisper edge-tts                        # Windows

npm start
```

### 🔴 Vollständig — Alle Features

Alle Services, Modelle und Tools:

```bash
git clone https://github.com/Garrus800-stack/AI-Johnny.git
cd AI-Johnny

# Modelle herunterladen:
ollama pull gemma2:9b
ollama pull llama3.2-vision       # Vision / Bildanalyse
ollama pull nomic-embed-text      # Embeddings / Semantische Suche

# System-Tools:
sudo apt install -y ffmpeg sox    # Linux
# winget install ffmpeg           # Windows
# brew install ffmpeg sox         # macOS

# Python-Tools:
pip3 install faster-whisper edge-tts openai-whisper TTS --break-system-packages

# ChromaDB für RAG (benötigt Docker):
docker run -d -p 8000:8000 chromadb/chroma

# Johnny installieren + optionale Hardware-Pakete:
npm install
npm install serialport @serialport/parser-readline  # Für Arduino/ESP32

npm start
```

---

## Optionale Abhängigkeiten

Die folgenden Abhängigkeiten sind **nicht zwingend erforderlich**, erweitern aber Johnnys Funktionsumfang:

### Sprache (STT / TTS)

| Paket | Funktion | Installation |
|---|---|---|
| `faster-whisper` | Lokale Spracherkennung (schnell) | `pip install faster-whisper` |
| `edge-tts` | Kostenlose Sprachausgabe (Microsoft) | `pip install edge-tts` |
| `openai-whisper` | Original OpenAI Whisper | `pip install openai-whisper` |
| `TTS` | Coqui TTS (Open Source) | `pip install TTS` |

### Vision & Medien

| Paket | Funktion | Installation |
|---|---|---|
| `llama3.2-vision` | Lokale Bildanalyse | `ollama pull llama3.2-vision` |
| `ffmpeg` | Video-/Audio-Konvertierung | System-Paketmanager |
| `sox` | Audio-Verarbeitung | System-Paketmanager |

### Wissens-Datenbank (RAG)

| Paket | Funktion | Installation |
|---|---|---|
| `chromadb` | Vektor-Datenbank für RAG | `docker run -d -p 8000:8000 chromadb/chroma` |
| `nomic-embed-text` | Embedding-Modell | `ollama pull nomic-embed-text` |

### Hardware / IoT

| Paket | Funktion | Installation |
|---|---|---|
| `serialport` | Arduino/ESP32-Kommunikation | `npm install serialport @serialport/parser-readline` |

---

## Erster Start & Setup-Wizard

Beim ersten Start von Johnny erscheint ein **Setup-Wizard**, der durch die Grundkonfiguration führt:

1. **Ollama-Verbindung prüfen** — Johnny testet, ob Ollama unter `http://127.0.0.1:11434` erreichbar ist.
2. **Modell auswählen** — Wähle ein installiertes Ollama-Modell als Standard-Modell.
3. **Persönlichkeit konfigurieren** — Name, Sprache und grundlegende Persönlichkeitsmerkmale.
4. **Optionale Services** — Aktiviere zusätzliche Features (Sprache, Vision, Smart Home etc.).

Nach dem Setup befindet sich Johnny auf dem **Dashboard** mit der Chat-Ansicht.

---

## Konfiguration

Johnny speichert seine Konfiguration in einer `electron-store`-Datei:

| Plattform | Konfigurationspfad |
|---|---|
| **Windows** | `%APPDATA%\johnny-ai-assistant\config.json` |
| **Linux** | `~/.config/johnny-ai-assistant/config.json` |
| **macOS** | `~/Library/Application Support/johnny-ai-assistant/config.json` |

Die meisten Einstellungen können auch direkt in der **Settings-Ansicht** innerhalb von Johnny angepasst werden.

---

## Update auf neue Versionen

```bash
cd AI-Johnny

# Neueste Version holen:
git pull origin main

# Abhängigkeiten aktualisieren:
npm install

# Starten:
npm start
```

> 💡 Johnny unterstützt auch **automatische Updates** über `electron-updater`, wenn ein Build als Release veröffentlicht wird. Details: [BUILD.md](BUILD.md)

---

## Deinstallation

```bash
# 1. Johnny-Ordner löschen:
rm -rf AI-Johnny                                   # Linux/macOS
# rmdir /s /q AI-Johnny                            # Windows

# 2. Konfiguration löschen (optional):
rm -rf ~/.config/johnny-ai-assistant               # Linux
# rm -rf ~/Library/Application\ Support/johnny-ai-assistant  # macOS
# Unter Windows: %APPDATA%\johnny-ai-assistant löschen

# 3. Ollama-Modelle entfernen (optional):
ollama rm gemma2:9b
ollama rm llama3.2-vision
ollama rm nomic-embed-text
```

---

## Fehlerbehebung (Troubleshooting)

### „Ollama nicht erreichbar"

```bash
# Prüfen ob Ollama läuft:
curl http://127.0.0.1:11434/api/tags

# Falls nicht erreichbar:
ollama serve

# Falls Port belegt:
# Prüfe ob ein anderer Prozess Port 11434 nutzt:
netstat -tlnp | grep 11434           # Linux
netstat -ano | findstr 11434          # Windows
```

### „No models found"

```bash
# Installierte Modelle anzeigen:
ollama list

# Falls leer — Modell installieren:
ollama pull gemma2:9b
```

### „FFmpeg nicht gefunden"

```bash
# Test:
ffmpeg -version

# Installation:
sudo apt install -y ffmpeg            # Linux (Ubuntu/Debian)
winget install ffmpeg                  # Windows
brew install ffmpeg                    # macOS

# Nach der Installation Johnny neu starten.
```

### Electron startet nicht (Linux)

```bash
# Fehlende System-Libraries installieren:
sudo apt install -y libgtk-3-0 libnotify4 libnss3 libxss1 \
  libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0

# Alternativ ohne Sandbox starten:
npx electron . --no-sandbox
```

### GPU-Erkennung schlägt fehl (Windows 11)

Windows 11 hat `wmic` als deprecated markiert. Johnny v2.1 nutzt stattdessen `Get-CimInstance` über PowerShell. Falls die GPU-Erkennung dennoch fehlschlägt:

```powershell
# Manuell testen:
powershell -Command "Get-CimInstance -ClassName Win32_VideoController | Select-Object Name"
```

### `electron-store` Fehler (ESM)

Johnny v2.1 verwendet `electron-store` v8+, das ESM erfordert. Falls Fehler auftreten:

```bash
# In package.json sicherstellen, dass die korrekte Version installiert ist:
npm ls electron-store
# Falls veraltet:
npm install electron-store@latest
```

### npm install Fehler mit `serialport`

`serialport` ist eine optionale Abhängigkeit und wird für Arduino/ESP32 benötigt. Falls die Installation fehlschlägt (kein C++-Compiler vorhanden), ist das kein Problem — Johnny startet auch ohne:

```bash
# Serialport explizit ohne Build installieren:
npm install --ignore-scripts

# Oder nur Serialport separat installieren:
npm install serialport @serialport/parser-readline
```

---

## Port-Referenz

Johnny und seine optionalen Dienste nutzen die folgenden Ports (alle konfigurierbar):

| Port | Dienst | Erforderlich |
|---|---|---|
| `11434` | Ollama API | ✅ Ja |
| `8000` | ChromaDB (RAG) | ❌ Optional |
| `7860` | Stable Diffusion (AUTOMATIC1111) | ❌ Optional |
| `8188` | ComfyUI | ❌ Optional |
| `9222` | Chrome CDP (Browser-Automation) | ❌ Optional |
| `18789` | Johnny Gateway | ❌ Optional |
| `9090` | Collaboration-Server | ❌ Optional |

---

## Hilfe & Support

- **Issues melden:** [github.com/Garrus800-stack/AI-Johnny/issues](https://github.com/Garrus800-stack/AI-Johnny/issues)
- **Discussions:** [github.com/Garrus800-stack/AI-Johnny/discussions](https://github.com/Garrus800-stack/AI-Johnny/discussions)
- **Plugin-Entwicklung:** [PLUGIN_DEV.md](PLUGIN_DEV.md)
- **Build-Anleitung:** [BUILD.md](BUILD.md)
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)
