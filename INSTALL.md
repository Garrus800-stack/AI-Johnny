# Installation — Johnny AI Assistant v2.1

## Voraussetzungen

| Software | Version | Zweck |
|---|---|---|
| **Node.js** | 18+ (empf. 20 LTS) | Johnny-Kern |
| **npm** | 9+ | Paketmanager |
| **Ollama** | 0.3+ | Lokales LLM |
| **Git** | (optional) | Repo klonen |

---

## Windows

### Terminal öffnen: PowerShell oder Windows Terminal

```powershell
# ── 1. Node.js installieren ──────────────────────────────────────
winget install OpenJS.NodeJS.LTS
# ODER: https://nodejs.org → LTS herunterladen

# Prüfen:
node --version    # sollte v18+ zeigen
npm --version     # sollte v9+ zeigen

# ── 2. Ollama installieren ───────────────────────────────────────
winget install Ollama.Ollama
# ODER: https://ollama.com/download

# Ollama starten (läuft als Dienst oder manuell):
ollama serve

# Modell herunterladen (in neuem Terminal):
ollama pull gemma2:9b           # Standard-Modell (5GB)
# Alternativen:
# ollama pull llama3.1:8b       # Meta Llama 3.1
# ollama pull mistral:7b        # Mistral 7B
# ollama pull gemma2:2b         # Kleines Modell (1.5GB, schneller)

# ── 3. Johnny installieren ──────────────────────────────────────
# ZIP entpacken oder Git Clone:
git clone https://github.com/user/johnny-ai-assistant.git
cd johnny-ai-assistant

npm install

# ── 4. Starten ──────────────────────────────────────────────────
npm start

# Dev-Modus (mit DevTools):
npm run dev
```

### Optionale Abhängigkeiten (Windows)

```powershell
# FFmpeg (für Video-Analyse + Audio-Konvertierung)
winget install ffmpeg
# ODER: https://www.gyan.dev/ffmpeg/builds/ → "essentials" ZIP → in PATH

# Python + Whisper (für lokale Spracherkennung ohne API-Key)
winget install Python.Python.3.12
pip install faster-whisper
pip install edge-tts            # Kostenlose Sprachausgabe

# Für Vision (Bildanalyse mit lokalem Modell):
ollama pull llama3.2-vision

# Für RAG (persistente Wissensdatenbank):
# Docker Desktop installieren, dann:
docker run -d -p 8000:8000 chromadb/chroma

# Für Embedding (semantische Suche):
ollama pull nomic-embed-text
```

---

## Linux (Ubuntu/Debian)

```bash
# ── 1. Node.js installieren ──────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Prüfen:
node --version
npm --version

# ── 2. Ollama installieren ───────────────────────────────────────
curl -fsSL https://ollama.com/install.sh | sh

# Ollama starten:
ollama serve &

# Modell herunterladen:
ollama pull gemma2:9b

# ── 3. Johnny installieren ──────────────────────────────────────
git clone https://github.com/user/johnny-ai-assistant.git
cd johnny-ai-assistant

npm install

# ── 4. Starten ──────────────────────────────────────────────────
npm start
```

### Optionale Abhängigkeiten (Linux)

```bash
# FFmpeg
sudo apt install -y ffmpeg

# Python + Whisper
sudo apt install -y python3 python3-pip
pip3 install faster-whisper --break-system-packages
pip3 install edge-tts --break-system-packages

# Sox (Audio-Verarbeitung)
sudo apt install -y sox

# Vision-Modell
ollama pull llama3.2-vision

# ChromaDB (für RAG)
sudo apt install -y docker.io
sudo docker run -d -p 8000:8000 chromadb/chroma

# Embedding
ollama pull nomic-embed-text

# Electron-Abhängigkeiten (falls Fehler beim Start)
sudo apt install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0
```

---

## macOS

```bash
# Node.js
brew install node

# Ollama
brew install ollama
ollama serve &
ollama pull gemma2:9b

# Johnny
git clone https://github.com/user/johnny-ai-assistant.git
cd johnny-ai-assistant
npm install
npm start
```

### Optionale Abhängigkeiten (macOS)

```bash
brew install ffmpeg sox
pip3 install faster-whisper edge-tts
ollama pull llama3.2-vision nomic-embed-text
```

---

## Installations-Stufen

### Minimal (nur Chat)
```bash
ollama pull gemma2:9b && npm install && npm start
```

### Empfohlen (Chat + Sprache + Bilder)
```bash
ollama pull gemma2:9b
npm install
pip install faster-whisper edge-tts --break-system-packages  # Linux
# pip install faster-whisper edge-tts                        # Windows
npm start
```

### Voll (alle Features)
```bash
# Modelle
ollama pull gemma2:9b llama3.2-vision nomic-embed-text

# System-Tools
sudo apt install -y ffmpeg sox         # Linux
# winget install ffmpeg                # Windows

# Python-Tools
pip3 install faster-whisper openai-whisper edge-tts TTS --break-system-packages

# ChromaDB (für RAG)
docker run -d -p 8000:8000 chromadb/chroma

# Johnny
npm install
npm install serialport @serialport/parser-readline  # Für Arduino/ESP32
npm start
```

---

## Fehlerbehebung

### "Ollama nicht erreichbar"
```bash
# Läuft Ollama?
curl http://127.0.0.1:11434/api/tags
# Wenn nicht:
ollama serve
```

### "No models found"
```bash
ollama list                    # Zeigt installierte Modelle
ollama pull gemma2:9b          # Modell installieren
```

### "FFmpeg nicht gefunden"
```bash
ffmpeg -version                # Test
# Windows: winget install ffmpeg
# Linux:   sudo apt install ffmpeg
# Mac:     brew install ffmpeg
# Dann Johnny neu starten
```

### Electron startet nicht (Linux)
```bash
# Fehlende Libs installieren:
sudo apt install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6
# Oder mit --no-sandbox:
npx electron . --no-sandbox
```

### Port-Konflikte
Johnny nutzt diese Ports (konfigurierbar in Settings):
- `11434` — Ollama
- `8000` — ChromaDB
- `7860` — Stable Diffusion (AUTOMATIC1111)
- `8188` — ComfyUI
- `9222` — Chrome CDP
- `18789` — Johnny Gateway
- `9090` — Collaboration
