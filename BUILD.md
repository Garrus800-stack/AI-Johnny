# Build — Johnny AI Assistant v2.1

## Windows EXE erstellen

```powershell
# Voraussetzungen
node --version   # 18+
npm --version    # 9+

# Build
npm run build

# Ergebnis: dist/Johnny AI Assistant Setup x.x.x.exe
```

## Linux AppImage/deb

```bash
npm run build
# Ergebnis: dist/johnny-ai-assistant-x.x.x.AppImage
# oder:     dist/johnny-ai-assistant-x.x.x.deb
```

## Konfiguration

Build-Einstellungen in `package.json` unter `"build"`:

```json
{
  "build": {
    "appId": "com.johnny.ai.assistant",
    "productName": "Johnny AI Assistant",
    "win": { "target": "nsis" },
    "linux": { "target": ["AppImage", "deb"] },
    "mac": { "target": "dmg" }
  }
}
```

## JSX-Transpilation (optional)

Johnny funktioniert ohne Build-Step (alles React.createElement).
Für neue Views mit JSX-Syntax:

```bash
npm install esbuild --save-dev   # Einmalig
npm run build:jsx                # Transpiliert JSX → JS
npm run build:jsx:watch          # Watch-Modus
```

## Auto-Update

Johnny unterstützt electron-updater für automatische Updates.
Für GitHub Releases in `package.json` hinzufügen:

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "dein-username",
      "repo": "johnny-ai-assistant"
    }
  }
}
```

Dann: `npm run build` → Release auf GitHub hochladen → Johnny aktualisiert sich automatisch.
