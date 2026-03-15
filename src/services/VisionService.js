const axios = require('axios');
const fs    = require('fs').promises;

// ── Unterstützte lokale Vision-Modelle (Ollama) ────────────────────────────
const OLLAMA_VISION_MODELS = [
  'llama3.2-vision',   // Beste Qualität (Meta)
  'llama3.2-vision:11b',
  'llava:latest',
  'llava:13b',
  'llava:7b',
  'llava-llama3',
  'moondream',         // Sehr klein, schnell
  'bakllava',
];

/**
 * VisionService v1.8 — Lokale Bildanalyse via Ollama (primär) + Cloud-Fallback
 *
 * NEU in v1.8:
 * - Auto-Detection des besten verfügbaren Vision-Modells
 * - Buffer-Input: Bilder direkt als Buffer/Base64 übergeben (kein Dateipfad nötig)
 * - Drag & Drop Analyse aus dem Chat
 * - Strukturierte Analyse-Modi: describe / ocr / compare / ui / code / general
 * - Lokale Modelle haben Vorrang (kein API-Key nötig)
 */
class VisionService {
  constructor(config) {
    this.modelProvider  = config.modelProvider;
    this.apiKeys        = config.apiKeys || {};
    this.ollamaUrl      = config.ollamaUrl || 'http://127.0.0.1:11434';
    this._visionModel   = null;   // gecachtes Ollama Vision-Modell
    this._modelChecked  = false;
  }

  async initialize() {
    this._visionModel = await this._detectOllamaVisionModel();
    if (this._visionModel) {
      console.log(`[VisionService] Lokales Vision-Modell: ${this._visionModel} ✓`);
    } else {
      console.warn('[VisionService] Kein lokales Vision-Modell gefunden.');
      console.warn('[VisionService] Installieren: ollama pull llama3.2-vision  oder  ollama pull llava');
    }
    this._modelChecked = true;
  }

  // ── Haupt-Analyse-API ──────────────────────────────────────────────────────

  /**
   * Analysiert ein Bild.
   * @param {string|Buffer} imageInput  Dateipfad, Buffer oder Base64-String
   * @param {string} prompt             Was analysiert werden soll
   * @param {object} options            { provider, model, mode, ... }
   */
  async analyzeImage(imageInput, prompt, options = {}) {
    const imageData = await this.loadImage(imageInput);

    // Provider bestimmen: lokal zuerst
    const provider = options.provider || this._pickProvider();
    console.log(`[VisionService] Analysiere Bild mit: ${provider}`);

    switch (provider) {
      case 'ollama':    return await this.analyzeWithOllama(imageData, prompt, options);
      case 'openai':    return await this.analyzeWithOpenAI(imageData, prompt, options);
      case 'anthropic': return await this.analyzeWithAnthropic(imageData, prompt, options);
      case 'google':    return await this.analyzeWithGoogle(imageData, prompt, options);
      default:          throw new Error(`Unbekannter Vision-Provider: ${provider}`);
    }
  }

  /**
   * Analysiert mit einem bestimmten Modus:
   * 'describe' | 'ocr' | 'ui' | 'code' | 'compare' | 'general'
   */
  async analyzeMode(imageInput, mode = 'general', options = {}) {
    const prompts = {
      describe: 'Beschreibe dieses Bild detailliert. Was siehst du? Farben, Objekte, Personen, Atmosphäre, Kontext.',
      ocr:      'Extrahiere allen Text aus diesem Bild exakt wie er erscheint. Formatiere ihn strukturiert.',
      ui:       'Analysiere diese Benutzeroberfläche. Welche UI-Elemente sind vorhanden? Buttons, Formulare, Navigation? Was ist der Zweck der Seite?',
      code:     'Analysiere diesen Code-Screenshot. Welche Programmiersprache? Gibt es Fehler, Warnungen oder Probleme?',
      general:  'Was ist auf diesem Bild zu sehen? Beschreibe es kurz und präzise.',
      compare:  'Analysiere dieses Bild und beschreibe alle Unterschiede, Besonderheiten oder Auffälligkeiten.',
    };
    return this.analyzeImage(imageInput, prompts[mode] || prompts.general, options);
  }

  // ── Bild laden (Pfad, Buffer, Base64, URL) ────────────────────────────────

  async loadImage(imageInput) {
    // Buffer direkt
    if (Buffer.isBuffer(imageInput)) {
      return { base64: imageInput.toString('base64'), mimeType: 'image/png', source: 'buffer' };
    }

    // Base64-String (data URL oder rein)
    if (typeof imageInput === 'string' && imageInput.startsWith('data:')) {
      const [header, data] = imageInput.split(',');
      const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/png';
      return { base64: data, mimeType, source: 'dataurl' };
    }
    if (typeof imageInput === 'string' && imageInput.length > 200 && !imageInput.includes('/') && !imageInput.includes('\\')) {
      return { base64: imageInput, mimeType: 'image/png', source: 'base64' };
    }

    // Dateipfad
    const buffer    = await fs.readFile(imageInput);
    const base64    = buffer.toString('base64');
    const ext       = imageInput.split('.').pop().toLowerCase();
    const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                        webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
    return { base64, mimeType: mimeTypes[ext] || 'image/png', source: 'file', path: imageInput };
  }

  // ── Ollama (lokal, kein API-Key) ───────────────────────────────────────────

  async analyzeWithOllama(imageData, prompt, options = {}) {
    const model = options.model || this._visionModel || 'llava';

    // /api/chat Format (neuer, unterstützt llama3.2-vision besser)
    try {
      const response = await axios.post(
        `${this.ollamaUrl}/api/chat`,
        {
          model,
          messages: [{
            role: 'user',
            content: prompt,
            images: [imageData.base64],
          }],
          stream: false,
          options: { temperature: options.temperature ?? 0.3 },
        },
        { timeout: 60000 }
      );
      return {
        success:  true,
        analysis: response.data.message?.content || response.data.response,
        provider: 'ollama',
        model,
        local:    true,
      };
    } catch (chatErr) {
      // Fallback auf /api/generate (ältere Ollama-Versionen / llava)
      try {
        const response = await axios.post(
          `${this.ollamaUrl}/api/generate`,
          { model, prompt, images: [imageData.base64], stream: false },
          { timeout: 60000 }
        );
        return {
          success: true, analysis: response.data.response,
          provider: 'ollama', model, local: true,
        };
      } catch (genErr) {
        throw new Error(`Ollama Vision fehlgeschlagen: ${genErr.message}`);
      }
    }
  }

  // ── Auto-Detect bestes lokales Vision-Modell ───────────────────────────────

  async _detectOllamaVisionModel() {
    try {
      const res    = await axios.get(`${this.ollamaUrl}/api/tags`, { timeout: 3000 });
      const models = (res.data.models || []).map(m => m.name);
      // In Prioritäts-Reihenfolge suchen
      for (const preferred of OLLAMA_VISION_MODELS) {
        if (models.some(m => m.startsWith(preferred.split(':')[0]))) return preferred.split(':')[0];
      }
      // Generische Vision-Erkennung: alle Modelle mit "vision" im Namen
      const visionModel = models.find(m => m.toLowerCase().includes('vision') || m.includes('llava'));
      return visionModel || null;
    } catch {
      return null;
    }
  }

  _pickProvider() {
    if (this._visionModel) return 'ollama';
    if (this.apiKeys.openai) return 'openai';
    if (this.apiKeys.anthropic) return 'anthropic';
    if (this.apiKeys.google) return 'google';
    return 'ollama'; // versucht es trotzdem lokal
  }

  getAvailableModel() { return this._visionModel; }
  isLocalAvailable()  { return !!this._visionModel; }


  async analyzeWithOpenAI(imageData, prompt, options = {}) {
    const apiKey = this.apiKeys.openai || options.apiKey;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: options.model || 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${imageData.mimeType};base64,${imageData.base64}`,
                    detail: options.detail || 'high'
                  }
                }
              ]
            }
          ],
          max_tokens: options.maxTokens || 1000
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        analysis: response.data.choices[0].message.content,
        provider: 'openai',
        model: options.model || 'gpt-4-vision-preview',
        usage: response.data.usage
      };
    } catch (error) {
      console.error('OpenAI Vision error:', error.response?.data || error.message);
      throw error;
    }
  }

  async analyzeWithAnthropic(imageData, prompt, options = {}) {
    const apiKey = this.apiKeys.anthropic || options.apiKey;
    if (!apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: options.model || 'claude-3-5-sonnet-20241022',
          max_tokens: options.maxTokens || 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: imageData.mimeType,
                    data: imageData.base64
                  }
                },
                {
                  type: 'text',
                  text: prompt
                }
              ]
            }
          ]
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        analysis: response.data.content[0].text,
        provider: 'anthropic',
        model: options.model || 'claude-3-5-sonnet-20241022',
        usage: response.data.usage
      };
    } catch (error) {
      console.error('Anthropic Vision error:', error.response?.data || error.message);
      throw error;
    }
  }

  async analyzeWithGoogle(imageData, prompt, options = {}) {
    const apiKey = this.apiKeys.google || options.apiKey;
    if (!apiKey) {
      throw new Error('Google API key not configured');
    }

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/${options.model || 'gemini-1.5-pro'}:generateContent?key=${apiKey}`,
        {
          contents: [{
            parts: [
              {
                text: prompt
              },
              {
                inline_data: {
                  mime_type: imageData.mimeType,
                  data: imageData.base64
                }
              }
            ]
          }]
        }
      );

      return {
        success: true,
        analysis: response.data.candidates[0].content.parts[0].text,
        provider: 'google',
        model: options.model || 'gemini-pro-vision',
        usage: response.data.usageMetadata
      };
    } catch (error) {
      console.error('Google Vision error:', error.response?.data || error.message);
      throw error;
    }
  }

  // Spezielle Analyse-Funktionen

  async describeScreenshot(screenshotPath, options = {}) {
    return await this.analyzeImage(
      screenshotPath,
      'Describe in detail what you see in this screenshot. Include: UI elements, text content, layout, colors, and any notable features.',
      options
    );
  }

  async findClickableElements(screenshotPath, options = {}) {
    return await this.analyzeImage(
      screenshotPath,
      'List all clickable elements you can identify in this screenshot. For each element, provide: type (button, link, etc.), visible text, and approximate position.',
      options
    );
  }

  async extractText(screenshotPath, options = {}) {
    return await this.analyzeImage(
      screenshotPath,
      'Extract ALL visible text from this screenshot. Maintain the structure and formatting as much as possible.',
      options
    );
  }

  async compareScreenshots(beforePath, afterPath, options = {}) {
    const beforeData = await this.loadImage(beforePath);
    const afterData = await this.loadImage(afterPath);
    
    // Für OpenAI (kann 2 Bilder verarbeiten)
    if ((options.provider || this.modelProvider.defaultProvider) === 'openai') {
      const apiKey = this.apiKeys.openai;
      
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Compare these two screenshots and describe what changed between them.' },
                { type: 'image_url', image_url: { url: `data:${beforeData.mimeType};base64,${beforeData.base64}` } },
                { type: 'image_url', image_url: { url: `data:${afterData.mimeType};base64,${afterData.base64}` } }
              ]
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        comparison: response.data.choices[0].message.content,
        provider: 'openai'
      };
    }
    
    // Fallback: Analysiere einzeln
    const before = await this.describeScreenshot(beforePath, options);
    const after = await this.describeScreenshot(afterPath, options);
    
    return {
      success: true,
      before: before.analysis,
      after: after.analysis,
      comparison: 'Manual comparison needed - analyze the before and after descriptions.'
    };
  }

  async identifyUIElement(screenshotPath, description, options = {}) {
    return await this.analyzeImage(
      screenshotPath,
      `Find the UI element matching this description: "${description}". Provide its exact position (coordinates or descriptive location) and suggest a CSS selector or XPath if possible.`,
      options
    );
  }

  async detectErrors(screenshotPath, options = {}) {
    return await this.analyzeImage(
      screenshotPath,
      'Analyze this screenshot for any error messages, warnings, or issues. List all problems you can identify.',
      options
    );
  }
}

module.exports = VisionService;
