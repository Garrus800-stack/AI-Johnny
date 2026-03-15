/**
 * OllamaService — Refactored mit nativem Function-Calling
 *
 * Kernänderung:
 *   ALT: Tools werden als Textblock in den System-Prompt gepackt.
 *        Das Modell antwortet mit "TOOL_CALL: {...}"-Text.
 *        AgentManager parsed das per Regex zurück.
 *
 *   NEU: Ollama /api/chat unterstützt seit v0.3 einen nativen `tools`-Parameter.
 *        Das Modell gibt tool_calls als strukturiertes JSON zurück — kein Text-Parsing.
 *        Das eliminiert eine ganze Kategorie von Bugs.
 *
 * Backward-Kompatibilität:
 *   - generateWithTools() gibt dasselbe Format zurück wie vorher
 *     ({message, rawMessage, toolCalls, rawResponse})
 *   - Falls das Modell Function-Calling nicht unterstützt, fällt es automatisch
 *     auf Regex-Parsing zurück (capabilityCache tracked das pro Modell)
 *   - buildSystemPrompt() + parseToolCalls() bleiben erhalten für den Fallback
 */

const axios  = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs   = require('fs').promises;
const path = require('path');
const os   = require('os');

const execAsync = promisify(exec);

class OllamaService {
  constructor(config) {
    this.model        = config.model    || 'gemma2:9b';
    this.baseUrl      = config.baseUrl  || 'http://127.0.0.1:11434';
    this.autoDownload = config.autoDownload !== false;
    this.autoStart    = config.autoStart    !== false;
    this.ollamaPath   = null;
    this.isRunning    = false;

    // Cache: welche Modelle unterstützen natives Function-Calling?
    // Map<modelName, boolean>
    this._fcCapabilityCache = new Map();
  }

  async initialize() {
    console.log('Initializing Ollama Service...');

    const installed = await this.checkOllamaInstalled();

    if (!installed && this.autoDownload) {
      console.log('Ollama not found, downloading...');
      await this.downloadOllama();
    }

    if (this.autoStart) {
      await this.startOllama();
    }

    await this.waitForOllama();

    const modelExists = await this.checkModelExists();
    if (!modelExists) {
      console.log(`Downloading model ${this.model}...`);
      await this.pullModel(this.model);
    }

    console.log('Ollama Service initialized successfully');
  }

  // ════════════════════════════════════════════════════════════════════
  // FUNCTION CALLING — Kern der Refactoring
  // ════════════════════════════════════════════════════════════════════

  /**
   * Nachricht mit Tool-Unterstützung generieren.
   *
   * Versucht natives Function-Calling. Wenn das Modell es nicht unterstützt
   * (ältere Ollama-Versionen oder Modelle ohne FC-Support), Fallback auf Regex.
   *
   * @param {string}   prompt
   * @param {object[]} tools      – Tool-Definitionen im Johnny-Format
   * @param {object[]} context    – Konversations-History
   * @param {string}   [modelOverride]
   * @returns {{ message: string, rawMessage: string, toolCalls: object[], rawResponse: object }}
   */
  async generateWithTools(prompt, tools = [], context = [], modelOverride = null) {
    const useModel = modelOverride || this.model;

    // Prüfe ob natives FC möglich ist
    const useNativeFC = tools.length > 0 && await this._supportsNativeFunctionCalling(useModel);

    if (useNativeFC) {
      return this._generateWithNativeFunctionCalling(prompt, tools, context, useModel);
    } else {
      return this._generateWithRegexFallback(prompt, tools, context, useModel);
    }
  }

  /**
   * Natives Function-Calling über Ollama /api/chat tools-Parameter.
   *
   * Ollama API Doku: https://github.com/ollama/ollama/blob/main/docs/api.md#chat-request-with-tools
   *
   * Das Modell gibt tool_calls direkt als strukturiertes JSON zurück — kein Text-Parsing nötig.
   * Format der Ollama-Antwort:
   *   message.tool_calls = [{ function: { name: "...", arguments: {...} } }]
   */
  async _generateWithNativeFunctionCalling(prompt, tools, context, useModel) {
    const systemPrompt = this._buildCleanSystemPrompt();

    const messages = [
      { role: 'system', content: systemPrompt },
      ...context,
      { role: 'user',   content: prompt },
    ];

    // Johnny-Tool-Format → Ollama-Tool-Format
    const ollamaTools = this._convertToOllamaTools(tools);

    try {
      const response = await axios.post(`${this.baseUrl}/api/chat`, {
        model:   useModel,
        messages,
        tools:   ollamaTools,
        stream:  false,
        options: { temperature: 0.7, num_ctx: 8192 },
      });

      const msg = response.data.message;

      // Native tool_calls aus der Antwort extrahieren
      const toolCalls = this._extractNativeToolCalls(msg.tool_calls || []);

      return {
        message:     msg.content || '',
        rawMessage:  msg.content || '',
        toolCalls,
        rawResponse: response.data,
        fcMethod:    'native',
      };
    } catch (err) {
      // Wenn natives FC fehlschlägt → Cache invalidieren und Regex-Fallback
      console.warn(`[OllamaService] Native FC failed for ${useModel}: ${err.message} — falling back to regex`);
      this._fcCapabilityCache.set(useModel, false);
      return this._generateWithRegexFallback(prompt, tools, context, useModel);
    }
  }

  /**
   * Fallback: Tool-Definitionen als Text im System-Prompt, Antwort per Regex parsen.
   * Wird verwendet wenn das Modell kein natives Function-Calling unterstützt.
   */
  async _generateWithRegexFallback(prompt, tools, context, useModel) {
    const systemPrompt = this.buildSystemPrompt(tools);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...context,
      { role: 'user',   content: prompt },
    ];

    const response = await axios.post(`${this.baseUrl}/api/chat`, {
      model:   useModel,
      messages,
      stream:  false,
      options: { temperature: 0.7, num_ctx: 8192 },
    });

    const assistantMessage = response.data.message.content;
    const toolCalls = this.parseToolCalls(assistantMessage);

    const cleanMessage = assistantMessage
      .replace(/```json[\s\S]*?```/g, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<<TOOL>>[\s\S]*?<<\/TOOL>>/g, '')
      .replace(/TOOL_CALL:\s*\{[^\n]*\}/g, '')
      .trim();

    return {
      message:     cleanMessage || assistantMessage,
      rawMessage:  assistantMessage,
      toolCalls,
      rawResponse: response.data,
      fcMethod:    'regex',
    };
  }

  /**
   * Prüfen ob ein Modell natives Function-Calling unterstützt.
   * Testet mit einem minimalen Request und cached das Ergebnis.
   *
   * Modelle mit bekanntem FC-Support (Stand: Ollama v0.3+):
   *   llama3.1, llama3.2, llama3.3, mistral-nemo, mistral-large,
   *   qwen2.5, qwen2.5-coder, command-r, firefunction-v2, nemotron-mini
   */
  async _supportsNativeFunctionCalling(modelName) {
    if (this._fcCapabilityCache.has(modelName)) {
      return this._fcCapabilityCache.get(modelName);
    }

    // Heuristik: bekannte FC-fähige Modelle
    const FC_MODELS = [
      'llama3.1', 'llama3.2', 'llama3.3',
      'mistral-nemo', 'mistral-large', 'mistral-small',
      'qwen2.5', 'qwen2.5-coder', 'qwen2',
      'command-r', 'command-r-plus',
      'firefunction', 'nemotron',
      'functionary',
    ];

    const baseName = modelName.split(':')[0].toLowerCase();
    const likelyCap = FC_MODELS.some(m => baseName.includes(m));

    if (!likelyCap) {
      this._fcCapabilityCache.set(modelName, false);
      return false;
    }

    // Probe-Request mit minimalem Tool
    try {
      const probeResponse = await axios.post(`${this.baseUrl}/api/chat`, {
        model: modelName,
        messages: [{ role: 'user', content: 'Say "ok"' }],
        tools: [{
          type: 'function',
          function: {
            name: 'probe',
            description: 'Test',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        }],
        stream: false,
        options: { num_predict: 5 },
      }, { timeout: 10000 });

      // Wenn die API tool_calls zurückgibt oder kein Fehler → FC supported
      const supported = !probeResponse.data?.error;
      this._fcCapabilityCache.set(modelName, supported);
      if (supported) console.log(`[OllamaService] ${modelName} supports native function calling ✓`);
      return supported;
    } catch (e) {
      this._fcCapabilityCache.set(modelName, false);
      return false;
    }
  }

  /**
   * Johnny-Tool-Format → Ollama-kompatibles Tool-Format.
   *
   * Johnny-Format:
   *   { name: 'web_search', description: '...', parameters: { type: 'object', properties: {...} } }
   *
   * Ollama-Format (OpenAI-kompatibel):
   *   { type: 'function', function: { name, description, parameters } }
   */
  _convertToOllamaTools(tools) {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name:        tool.name,
        description: tool.description || '',
        parameters:  tool.parameters || {
          type:       'object',
          properties: {},
          required:   [],
        },
      },
    }));
  }

  /**
   * Ollama native tool_calls → Johnny-Format.
   *
   * Ollama gibt zurück:
   *   [{ function: { name: "web_search", arguments: { query: "..." } } }]
   *
   * Johnny erwartet:
   *   [{ tool: "web_search", parameters: { query: "..." } }]
   */
  _extractNativeToolCalls(ollamaToolCalls) {
    if (!Array.isArray(ollamaToolCalls)) return [];

    return ollamaToolCalls
      .filter(tc => tc.function && tc.function.name)
      .map(tc => ({
        tool:       tc.function.name,
        parameters: tc.function.arguments || {},
      }));
  }

  /**
   * Sauberer System-Prompt ohne Tool-Instruktionen (für natives FC).
   * Das Modell kennt die Tools über den `tools`-Parameter — nicht über Text.
   */
  _buildCleanSystemPrompt() {
    const currentModel = this.model || '?';
    const now = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

    return `Du bist Johnny, ein autonomer KI-Assistent. Modell: ${currentModel}. Datum/Uhrzeit: ${now}.
Antworte IMMER in der Sprache des Users.

IDENTITÄT: Wenn jemand fragt welches Modell du bist → "${currentModel}". Niemals halluzinieren.

REGELN:
- SOFORT handeln, nie beschreiben was du tun würdest
- Nach Fehler: andere Variante probieren
- Kein "Ich werde..." oder "Du könntest..." – einfach tun
- Ergebnis des Tools zeigen, dann kurz erklären`;
  }

  // ════════════════════════════════════════════════════════════════════
  // LEGACY API (bleibt für Backward-Kompatibilität)
  // ════════════════════════════════════════════════════════════════════

  /**
   * System-Prompt mit eingebetteten Tool-Definitionen.
   * Nur für Fallback (nicht-FC-fähige Modelle).
   */
  buildSystemPrompt(tools) {
    const toolList = tools.length > 0
      ? tools.map(t => `${t.name}: ${t.description} | params: ${JSON.stringify(t.parameters)}`).join('\n')
      : 'keine tools';

    const currentModel = this.model || '?';
    const now = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

    return `Du bist Johnny, ein autonomer KI-Assistent. Modell: ${currentModel}. Datum/Uhrzeit: ${now}.
Antworte IMMER in der Sprache des Users.

IDENTITÄT: Wenn jemand fragt welches Modell du bist → "${currentModel}". Niemals halluzinieren.

TOOL-AUFRUF FORMAT (PFLICHT wenn du etwas tun willst):
Schreibe EXAKT dieses Format – nichts anderes:
TOOL_CALL: {"tool":"name","parameters":{"key":"value"}}

REGELN:
- SOFORT handeln, nie beschreiben was du tun würdest
- Nach Fehler: andere Variante probieren (pip3, python -m pip, winget, etc)
- Kein "Ich werde..." oder "Du könntest..." – einfach tun
- Ergebnis des Tools zeigen, dann kurz erklären

VERFÜGBARE TOOLS:
${toolList}

BEISPIELE:
User: installiere ffmpeg
→ TOOL_CALL: {"tool":"execute_command","parameters":{"command":"winget install ffmpeg 2>&1 || choco install ffmpeg -y 2>&1"}}

User: suche im web nach AI Nachrichten
→ TOOL_CALL: {"tool":"web_search","parameters":{"query":"AI Nachrichten aktuell"}}

User: erinnere dich an meinen Namen
→ TOOL_CALL: {"tool":"remember","parameters":{"topic":"User Info","content":"Der Name des Users ist ..."}}
`;
  }

  /**
   * Regex-basiertes Tool-Parsing für Fallback-Modelle.
   * Unterstützt alle bekannten Ausgabe-Formate.
   */
  parseToolCalls(message) {
    const toolCalls = [];
    let match;

    // Format 1 (PRIMARY): TOOL_CALL: {...}
    const rx1 = /TOOL_CALL:\s*(\{[\s\S]*?\})(?=\nTOOL_CALL:|\n[^{]|$)/g;
    while ((match = rx1.exec(message)) !== null) {
      try {
        const p = JSON.parse(match[1].trim());
        if (p.tool) toolCalls.push({ tool: p.tool, parameters: p.parameters || {} });
      } catch {}
    }
    if (toolCalls.length) return toolCalls;

    // Format 2: <<TOOL>>...<<\/TOOL>> blocks
    const rx2 = /<<TOOL>>\s*([\s\S]*?)\s*<<\/TOOL>>/g;
    while ((match = rx2.exec(message)) !== null) {
      try {
        const p = JSON.parse(match[1].trim());
        if (p.tool) toolCalls.push({ tool: p.tool, parameters: p.parameters || {} });
      } catch {}
    }
    if (toolCalls.length) return toolCalls;

    // Format 3: ```json { "tool": ... } ```
    const rx3 = /```(?:json|bash)?\s*(\{[\s\S]*?"tool"[\s\S]*?\})\s*```/g;
    while ((match = rx3.exec(message)) !== null) {
      try {
        const p = JSON.parse(match[1]);
        if (p.tool) toolCalls.push({ tool: p.tool, parameters: p.parameters || {} });
      } catch {}
    }
    if (toolCalls.length) return toolCalls;

    // Format 4: Reines JSON-Objekt mit "tool"-Feld
    const rx4 = /^\s*(\{\s*"tool"\s*:[\s\S]*?\})\s*$/gm;
    while ((match = rx4.exec(message)) !== null) {
      try {
        const p = JSON.parse(match[1]);
        if (p.tool) toolCalls.push({ tool: p.tool, parameters: p.parameters || {} });
      } catch {}
    }

    return toolCalls;
  }

  // ════════════════════════════════════════════════════════════════════
  // UTILITY
  // ════════════════════════════════════════════════════════════════════

  async generate(prompt, context = []) {
    const messages = [...context, { role: 'user', content: prompt }];
    const response = await axios.post(`${this.baseUrl}/api/chat`, {
      model: this.model,
      messages,
      stream: false,
    });
    return response.data.message.content;
  }

  /**
   * Generiert Text mit einem spezifischen Modell (für Multi-Modell-Vergleich).
   * @param {string} prompt
   * @param {string|null} model   Überschreibt this.model
   * @param {object} opts         { temperature }
   */
  async generateWithModel(prompt, model = null, opts = {}) {
    const useModel = model || this.model;
    const body = {
      model: useModel,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    };
    if (opts.temperature !== undefined) {
      body.options = { temperature: opts.temperature };
    }
    const response = await axios.post(`${this.baseUrl}/api/chat`, body, { timeout: 60000 });
    return response.data.message?.content || response.data.response || '';
  }

  /**
   * Gibt Namen aller installierten Modelle zurück.
   */
  async getAvailableModels() {
    const models = await this.listModels();
    return models.map(m => m.name || m).filter(Boolean);
  }

  async listModels() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`);
      return response.data.models || [];
    } catch {
      return [];
    }
  }

  async checkOllamaInstalled() {
    try {
      const { stdout } = await execAsync('ollama --version');
      console.log('Ollama found:', stdout.trim());
      return true;
    } catch {
      return false;
    }
  }

  async downloadOllama() {
    const platform = os.platform();
    if (platform === 'win32') {
      const downloadUrl  = 'https://ollama.com/download/OllamaSetup.exe';
      const downloadPath = path.join(os.tmpdir(), 'OllamaSetup.exe');
      console.log('Downloading Ollama for Windows...');
      const response = await axios.get(downloadUrl, { responseType: 'stream' });
      const writer   = require('fs').createWriteStream(downloadPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error',  reject);
      });
      console.log('Installing Ollama...');
      await execAsync(`"${downloadPath}" /S`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    } else if (platform === 'darwin') {
      throw new Error('macOS: Please install Ollama manually from https://ollama.com');
    } else {
      await execAsync('curl -fsSL https://ollama.com/install.sh | sh');
    }
  }

  async startOllama() {
    try {
      const platform = os.platform();
      if (platform === 'win32') {
        try {
          await execAsync('net start ollama');
          console.log('Ollama Windows service started');
        } catch {
          const child = exec('ollama serve');
          child.unref();
        }
      } else {
        const child = exec('ollama serve');
        child.unref();
      }
      this.isRunning = true;
    } catch {
      console.log('Ollama might already be running...');
    }
  }

  async waitForOllama(maxAttempts = 45) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await axios.get(`${this.baseUrl}/api/tags`);
        console.log('Ollama is ready');
        return true;
      } catch {
        console.log(`Waiting for Ollama... (${i + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    throw new Error(`Ollama failed to start after ${maxAttempts} attempts. Please run "ollama serve" manually.`);
  }

  async checkModelExists(modelName) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`);
      const models   = response.data.models || [];
      const target   = (modelName || this.model).toLowerCase();
      const base     = target.split(':')[0];
      return models.some(m => {
        const n = m.name.toLowerCase();
        return n === target || n.startsWith(base + ':') || n === base;
      });
    } catch {
      return false;
    }
  }

  async pullModel(modelName, onProgress = null) {
    console.log(`Pulling model ${modelName}...`);
    const response = await axios.post(`${this.baseUrl}/api/pull`, {
      name:   modelName,
      stream: true,
    }, { responseType: 'stream' });

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        try {
          const lines = chunk.toString().split('\n').filter(l => l.trim());
          for (const line of lines) {
            const data = JSON.parse(line);
            if (data.status) console.log(data.status);
            if (onProgress) {
              if (data.total && data.completed) {
                onProgress({ status: data.status, percent: Math.round((data.completed / data.total) * 100) });
              } else if (data.status) {
                onProgress({ status: data.status, percent: null });
              }
            }
          }
        } catch {}
      });
      response.data.on('end',   () => {
        console.log(`Model ${modelName} downloaded successfully`);
        if (onProgress) onProgress({ status: 'Download complete!', percent: 100 });
        resolve();
      });
      response.data.on('error', reject);
    });
  }

  /**
   * generateStream — echtes Token-für-Token Streaming via Ollama /api/chat
   *
   * @param {object[]} messages     – vollständige Konversations-History
   * @param {Function} onToken      – Callback (token: string) → void, pro Token
   * @param {object}   opts         – { model, temperature, numCtx }
   * @returns {Promise<string>}     – vollständiger Text am Ende
   */
  async generateStream(messages, onToken, opts = {}) {
    const model       = opts.model       || this.model;
    const temperature = opts.temperature ?? 0.75;
    const numCtx      = opts.numCtx      ?? 8192;

    const chunks = [];
    let buffer   = '';

    const response = await require('axios').post(
      `${this.baseUrl}/api/chat`,
      { model, messages, stream: true, options: { temperature, num_ctx: numCtx } },
      { responseType: 'stream', timeout: 180000 }
    );

    await new Promise((resolve, reject) => {
      const watchdog = setTimeout(() => {
        response.data.destroy();
        if (chunks.length > 0) resolve(); else reject(new Error('Stream timeout'));
      }, 180000);

      response.data.on('data', (raw) => {
        buffer += raw.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const text   = parsed?.message?.content || '';
            if (text) {
              chunks.push(text);
              try { onToken(text); } catch (_) {}
            }
            if (parsed.done) { clearTimeout(watchdog); resolve(); }
          } catch {}
        }
      });
      response.data.on('end',   () => { clearTimeout(watchdog); resolve(); });
      response.data.on('error', (e) => { clearTimeout(watchdog); reject(e); });
    });

    return chunks.join('');
  }

  /**
   * generateWithToolsStream — natives FC mit echtem Streaming für die finale Antwort.
   *
   * Ablauf:
   *   1. Normaler (nicht-stream) Aufruf für Tool-Detection
   *   2. Wenn Tool-Calls → zurückgeben (kein Streaming hier — Tool-Ergebnisse müssen erst verarbeitet werden)
   *   3. Wenn finale Antwort (kein Tool-Call) → Streaming via generateStream()
   *
   * @param {string}   prompt
   * @param {object[]} tools
   * @param {object[]} context
   * @param {string}   [modelOverride]
   * @param {Function} [onToken]   Streaming-Callback — wird nur bei finaler Antwort genutzt
   */
  async generateWithToolsStream(prompt, tools = [], context = [], modelOverride = null, onToken = null) {
    const useModel     = modelOverride || this.model;
    const useNativeFC  = tools.length > 0 && await this._supportsNativeFunctionCalling(useModel);

    // ── Tool-Detection: immer synchron (stream: false) ──────────────────
    // Reason: wenn ein Tool-Call kommt, muss der AgentManager das Tool ausführen
    // und das Ergebnis zurückschicken — da bringt Streaming nichts.
    let detection;
    if (useNativeFC) {
      detection = await this._generateWithNativeFunctionCalling(prompt, tools, context, useModel);
    } else {
      detection = await this._generateWithRegexFallback(prompt, tools, context, useModel);
    }

    // Hat das Modell ein Tool aufgerufen? → direkt zurückgeben, kein Streaming
    if (detection.toolCalls && detection.toolCalls.length > 0) {
      return detection;
    }

    // Keine Tool-Calls → finale Antwort streamen (falls onToken gesetzt)
    if (onToken && typeof onToken === 'function') {
      const systemPrompt = useNativeFC ? this._buildCleanSystemPrompt() : this.buildSystemPrompt([]);
      const streamMessages = [
        { role: 'system', content: systemPrompt },
        ...context,
        { role: 'user',   content: prompt },
      ];
      const streamedText = await this.generateStream(streamMessages, onToken, {
        model: useModel, temperature: 0.75
      });
      return {
        message:     streamedText,
        rawMessage:  streamedText,
        toolCalls:   [],
        rawResponse: null,
        fcMethod:    useNativeFC ? 'native-stream' : 'regex-stream',
        streamed:    true,
      };
    }

    // Kein onToken → detection-Ergebnis direkt zurückgeben
    return detection;
  }


}

module.exports = OllamaService;
