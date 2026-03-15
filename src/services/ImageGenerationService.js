/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  IMAGE GENERATION SERVICE v2.0                                      ║
 * ║                                                                      ║
 * ║  Erweiterte Bildgenerierung für Johnny:                             ║
 * ║  - OpenAI DALL-E 3                                                  ║
 * ║  - Stable Diffusion (AUTOMATIC1111 + ComfyUI)                     ║
 * ║  - Replicate (SDXL, Flux, etc.)                                    ║
 * ║  - Prompt-Engineering & Enhancement                                 ║
 * ║  - Style-Transfer / Stil-Presets                                    ║
 * ║  - Image-to-Image (img2img)                                        ║
 * ║  - Upscaling                                                        ║
 * ║  - Batch-Generierung                                                ║
 * ║  - Automatische Prompt-Verbesserung via LLM                        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const fs    = require('fs').promises;
const path  = require('path');

// ── Stil-Presets ──────────────────────────────────────────────────────
const STYLE_PRESETS = {
  photorealistic: { prefix: 'photorealistic, 8k uhd, high detail, sharp focus', negPrompt: 'cartoon, painting, illustration, drawing, blurry' },
  anime:          { prefix: 'anime style, vibrant colors, cel shading', negPrompt: 'photorealistic, photo, 3d render' },
  oilPainting:    { prefix: 'oil painting, impressionist, canvas texture, brush strokes', negPrompt: 'digital, photo, 3d' },
  watercolor:     { prefix: 'watercolor painting, soft colors, flowing, artistic', negPrompt: 'digital, photo, sharp edges' },
  cyberpunk:      { prefix: 'cyberpunk, neon lights, futuristic, dark, sci-fi', negPrompt: 'nature, pastoral, bright' },
  fantasy:        { prefix: 'fantasy art, epic, magical, detailed environment', negPrompt: 'modern, urban, realistic' },
  minimalist:     { prefix: 'minimalist, clean, simple, modern design', negPrompt: 'complex, detailed, busy, cluttered' },
  comic:          { prefix: 'comic book style, bold outlines, halftone dots, vibrant', negPrompt: 'photorealistic, photo' },
  sketch:         { prefix: 'pencil sketch, black and white, detailed line art', negPrompt: 'color, painted, digital' },
  pixelart:       { prefix: 'pixel art, retro game, 16-bit, nostalgic', negPrompt: 'photorealistic, high resolution, smooth' },
  steampunk:      { prefix: 'steampunk, Victorian era, brass, gears, mechanical', negPrompt: 'modern, minimalist' },
  surreal:        { prefix: 'surrealist art, dreamlike, Salvador Dali inspired', negPrompt: 'realistic, mundane' },
};

class ImageGenerationService {
  constructor(config = {}) {
    this.apiKeys         = config.apiKeys || {};
    this.outputDir       = config.outputDir || './generated-images';
    this.defaultProvider = config.defaultProvider || 'openai';
    this.agentManager    = config.agentManager;

    // SD-API URLs
    this.sdUrl     = config.sdUrl     || this.apiKeys.sdUrl     || 'http://localhost:7860';
    this.comfyUrl  = config.comfyUrl  || this.apiKeys.comfyUrl  || 'http://localhost:8188';
  }

  async initialize() {
    await fs.mkdir(this.outputDir, { recursive: true });
    console.log('[ImageGen v2] initialized');
  }

  // ════════════════════════════════════════════════════════════════════
  // HAUPT-GENERIERUNG
  // ════════════════════════════════════════════════════════════════════

  async generate(opts) {
    const {
      prompt, provider, size = '1024x1024', n = 1,
      style = null, quality = 'standard',
      negativePrompt = '', enhancePrompt = false,
      seed = null,
    } = opts;

    const prov = provider || this.defaultProvider;

    // ── Prompt-Enhancement via LLM ────────────────────────────────────
    let finalPrompt = prompt;
    let finalNeg    = negativePrompt;
    if (enhancePrompt && this.agentManager) {
      const enhanced = await this._enhancePrompt(prompt, style);
      finalPrompt = enhanced.prompt || prompt;
      finalNeg    = enhanced.negativePrompt || negativePrompt;
    }

    // ── Style-Preset anwenden ─────────────────────────────────────────
    if (style && STYLE_PRESETS[style]) {
      const preset = STYLE_PRESETS[style];
      finalPrompt = `${preset.prefix}, ${finalPrompt}`;
      if (!finalNeg) finalNeg = preset.negPrompt;
    }

    switch (prov) {
      case 'openai':             return this._genOpenAI(finalPrompt, { size, n, style: opts.dalleStyle || 'vivid', quality });
      case 'replicate':          return this._genReplicate(finalPrompt, { size, negativePrompt: finalNeg });
      case 'stable-diffusion':   return this._genSD(finalPrompt, { size, negativePrompt: finalNeg, seed, n });
      case 'comfyui':            return this._genComfyUI(finalPrompt, { size, negativePrompt: finalNeg, seed });
      default: throw new Error(`Unbekannter Provider: ${prov}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // IMAGE-TO-IMAGE (Img2Img)
  // ════════════════════════════════════════════════════════════════════

  async img2img(opts) {
    const { inputPath, prompt, strength = 0.7, negativePrompt = '', size = null } = opts;

    // Stable Diffusion img2img
    const imageB64 = (await fs.readFile(inputPath)).toString('base64');

    try {
      const resp = await axios.post(`${this.sdUrl}/sdapi/v1/img2img`, {
        init_images: [imageB64],
        prompt,
        negative_prompt: negativePrompt,
        denoising_strength: strength,
        width:  size ? parseInt(size.split('x')[0]) : 512,
        height: size ? parseInt(size.split('x')[1]) : 512,
        steps: 25,
        cfg_scale: 7,
      }, { timeout: 120000 });

      const images = await this._saveImages(resp.data.images, 'img2img');
      return { provider: 'stable-diffusion', mode: 'img2img', images, strength };
    } catch (e) {
      throw new Error(`Img2Img Fehler: ${e.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // UPSCALING
  // ════════════════════════════════════════════════════════════════════

  async upscale(inputPath, opts = {}) {
    const { factor = 2, upscaler = 'ESRGAN_4x' } = opts;

    const imageB64 = (await fs.readFile(inputPath)).toString('base64');

    try {
      const resp = await axios.post(`${this.sdUrl}/sdapi/v1/extra-single-image`, {
        image: imageB64,
        upscaling_resize: factor,
        upscaler_1: upscaler,
      }, { timeout: 120000 });

      const filename = `upscale_${Date.now()}.png`;
      const filepath = path.join(this.outputDir, filename);
      await fs.writeFile(filepath, Buffer.from(resp.data.image, 'base64'));

      return { provider: 'stable-diffusion', mode: 'upscale', factor, path: filepath };
    } catch (e) {
      throw new Error(`Upscale Fehler: ${e.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // BATCH-GENERIERUNG
  // ════════════════════════════════════════════════════════════════════

  async generateBatch(prompts, opts = {}) {
    const { provider, style, parallel = 2 } = opts;
    const results = [];

    // In Batches parallel ausführen
    for (let i = 0; i < prompts.length; i += parallel) {
      const batch = prompts.slice(i, i + parallel);
      const batchResults = await Promise.allSettled(
        batch.map(p => this.generate({ prompt: p, provider, style }))
      );
      for (const r of batchResults) {
        results.push(r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
      }
    }

    return { total: prompts.length, successful: results.filter(r => !r.error).length, results };
  }

  // ════════════════════════════════════════════════════════════════════
  // PROMPT ENHANCEMENT
  // ════════════════════════════════════════════════════════════════════

  async _enhancePrompt(prompt, style) {
    if (!this.agentManager) return { prompt };

    const styleHint = style ? `im Stil "${style}"` : '';
    const p = `Du bist ein Experte für KI-Bildgenerierungs-Prompts. Verbessere diesen Prompt für fotorealistische oder künstlerische Bildgenerierung ${styleHint}:

"${prompt}"

Antworte als JSON: {"prompt":"verbesserter prompt auf Englisch","negativePrompt":"was vermieden werden soll"}`;

    try {
      const r = await this.agentManager.sendMessage('Johnny', p);
      const m = r.response.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : { prompt };
    } catch {
      return { prompt };
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // PROVIDER-IMPLEMENTIERUNGEN
  // ════════════════════════════════════════════════════════════════════

  async _genOpenAI(prompt, opts) {
    const apiKey = this.apiKeys.openai;
    if (!apiKey) throw new Error('OpenAI API key benötigt');

    const resp = await axios.post('https://api.openai.com/v1/images/generations', {
      model: 'dall-e-3', prompt, n: opts.n || 1,
      size: opts.size || '1024x1024', style: opts.style || 'vivid',
      quality: opts.quality || 'standard', response_format: 'url',
    }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });

    const saved = await Promise.all(resp.data.data.map(async (img, i) => {
      const filename = `dalle_${Date.now()}_${i}.png`;
      const filepath = path.join(this.outputDir, filename);
      const dl = await axios.get(img.url, { responseType: 'arraybuffer' });
      await fs.writeFile(filepath, dl.data);
      return { url: img.url, revisedPrompt: img.revised_prompt, localPath: filepath, filename };
    }));

    return { provider: 'openai', model: 'dall-e-3', images: saved };
  }

  async _genReplicate(prompt, opts) {
    const apiKey = this.apiKeys.replicate;
    if (!apiKey) throw new Error('Replicate API key benötigt');

    const start = await axios.post('https://api.replicate.com/v1/predictions', {
      version: 'ac732df83cea7fff18b8472768c88ad041fa750ff7682a21affe81863cbe77e4',
      input: { prompt, negative_prompt: opts.negativePrompt || '', width: 1024, height: 1024, num_outputs: 1 },
    }, { headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' } });

    let pred = start.data;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await axios.get(`https://api.replicate.com/v1/predictions/${pred.id}`, { headers: { 'Authorization': `Token ${apiKey}` } });
      pred = poll.data;
      if (pred.status === 'succeeded') break;
      if (pred.status === 'failed') throw new Error('Replicate fehlgeschlagen: ' + pred.error);
    }

    return { provider: 'replicate', model: 'sdxl', images: (pred.output || []).map(url => ({ url })) };
  }

  async _genSD(prompt, opts) {
    const [w, h] = (opts.size || '512x512').split('x').map(Number);
    const body = {
      prompt, negative_prompt: opts.negativePrompt || '',
      width: w, height: h, steps: 25, cfg_scale: 7,
      batch_size: opts.n || 1,
    };
    if (opts.seed) body.seed = opts.seed;

    const resp = await axios.post(`${this.sdUrl}/sdapi/v1/txt2img`, body, { timeout: 180000 });
    const images = await this._saveImages(resp.data.images, 'sd');
    return { provider: 'stable-diffusion', images };
  }

  async _genComfyUI(prompt, opts) {
    // ComfyUI Workflow via API
    const [w, h] = (opts.size || '1024x1024').split('x').map(Number);

    // Einfacher SDXL-Workflow
    const workflow = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: opts.negativePrompt || '', clip: ['1', 1] } },
      '4': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
      '5': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed: opts.seed || Math.floor(Math.random() * 1e10), steps: 25, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
      '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'johnny' } },
    };

    try {
      const resp = await axios.post(`${this.comfyUrl}/prompt`, { prompt: workflow }, { timeout: 180000 });
      return { provider: 'comfyui', promptId: resp.data.prompt_id, status: 'submitted' };
    } catch (e) {
      throw new Error(`ComfyUI Fehler: ${e.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // HILFSMETHODEN
  // ════════════════════════════════════════════════════════════════════

  async _saveImages(base64Images, prefix) {
    return Promise.all((base64Images || []).map(async (b64, i) => {
      const filename = `${prefix}_${Date.now()}_${i}.png`;
      const filepath = path.join(this.outputDir, filename);
      await fs.writeFile(filepath, Buffer.from(b64, 'base64'));
      return { localPath: filepath, filename };
    }));
  }

  getProviders() {
    return [
      { id: 'openai', name: 'DALL-E 3', hasKey: !!this.apiKeys.openai, sizes: ['1024x1024', '1792x1024', '1024x1792'] },
      { id: 'replicate', name: 'SDXL (Replicate)', hasKey: !!this.apiKeys.replicate, sizes: ['1024x1024'] },
      { id: 'stable-diffusion', name: 'Stable Diffusion (Lokal)', hasKey: true, sizes: ['512x512', '768x768', '1024x1024'] },
      { id: 'comfyui', name: 'ComfyUI (Lokal)', hasKey: true, sizes: ['512x512', '1024x1024'] },
    ];
  }

  getStyles() {
    return Object.entries(STYLE_PRESETS).map(([id, s]) => ({ id, prefix: s.prefix.slice(0, 50) }));
  }
}

module.exports = ImageGenerationService;
