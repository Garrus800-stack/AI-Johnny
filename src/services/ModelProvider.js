/**
 * ModelProvider v2.0 — Multi-Provider LLM Gateway
 *
 * v2.0: Streaming für ALLE Provider + Native Tool/Function Calling
 */

const axios = require('axios');

class ModelProvider {
  constructor(config) {
    this.providers = new Map();
    this.defaultProvider = config.defaultProvider || 'ollama';
    this.apiKeys = config.apiKeys || {};
    this._totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    this.initializeProviders();
  }

  initializeProviders() {
    this.registerProvider('ollama', {
      name: 'Ollama', type: 'local',
      // Basis-Fallback-Liste — wird beim ersten Aufruf von getOllamaModels() live überschrieben
      models: ['gemma2:2b','gemma2:9b','gemma2:27b','llama3:8b','llama3:70b',
               'mistral:7b','mixtral:8x7b','codellama:7b','codellama:13b',
               'phi3:mini','phi3:medium','qwen2.5:7b','deepseek-r1:8b'],
      generate: this._genOllama.bind(this),
      supportsNativeTools: false, supportsStreaming: true,
    });
    this.registerProvider('openai', {
      name: 'OpenAI', type: 'api', requiresKey: true,
      models: ['gpt-4.1','gpt-4.1-mini','gpt-4.1-nano','gpt-4o','gpt-4o-mini',
               'gpt-4-turbo','gpt-3.5-turbo','o3','o3-mini','o4-mini'],
      generate: this._genOpenAI.bind(this),
      supportsNativeTools: true, supportsStreaming: true,
    });
    this.registerProvider('anthropic', {
      name: 'Anthropic', type: 'api', requiresKey: true,
      models: ['claude-opus-4-6','claude-sonnet-4-6','claude-opus-4-5','claude-sonnet-4-5',
               'claude-haiku-4-5','claude-3-7-sonnet-20250219','claude-3-5-sonnet-20241022',
               'claude-3-5-haiku-20241022','claude-3-opus-20240229'],
      generate: this._genAnthropic.bind(this),
      supportsNativeTools: true, supportsStreaming: true,
    });
    this.registerProvider('google', {
      name: 'Google Gemini', type: 'api', requiresKey: true,
      models: ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.0-flash',
               'gemini-2.0-flash-lite','gemini-1.5-pro','gemini-1.5-flash'],
      generate: this._genGoogle.bind(this),
      supportsNativeTools: true, supportsStreaming: true,
    });
    this.registerProvider('groq', {
      name: 'Groq', type: 'api', requiresKey: true,
      models: ['llama-3.3-70b-versatile','llama-3.1-8b-instant','llama3-70b-8192',
               'llama3-8b-8192','mixtral-8x7b-32768','gemma2-9b-it'],
      generate: this._genGroq.bind(this),
      supportsNativeTools: true, supportsStreaming: true,
    });
    this.registerProvider('custom', {
      name: 'Custom API', type: 'api', requiresKey: false, models: [],
      generate: this._genCustom.bind(this),
      supportsNativeTools: false, supportsStreaming: false,
    });
  }

  registerProvider(id, config) { this.providers.set(id, config); }

  // ══════════════════════════════════════════════════════════════════
  // HAUPT-API — generate({ provider, model, messages, tools?, streamCallback?, ... })
  // ══════════════════════════════════════════════════════════════════

  async generate(config) {
    const { provider = this.defaultProvider, model, messages, tools,
            temperature, maxTokens, streamCallback, options = {} } = config;
    const pc = this.providers.get(provider);
    if (!pc) throw new Error(`Unknown provider: ${provider}`);
    if (pc.requiresKey && !this.apiKeys[provider] && !options.apiKey)
      throw new Error(`API key required for: ${provider}`);

    const nativeTools = (tools && pc.supportsNativeTools) ? this._convertTools(tools, provider) : null;
    const result = await pc.generate(model, messages, {
      ...options,
      temperature: temperature ?? options.temperature ?? 0.7,
      maxTokens:   maxTokens ?? options.maxTokens ?? 4096,
      tools: nativeTools,
      streamCallback: (pc.supportsStreaming && streamCallback) ? streamCallback : null,
    });

    if (result.usage) {
      this._totalUsage.promptTokens     += result.usage.prompt_tokens || result.usage.input_tokens || 0;
      this._totalUsage.completionTokens += result.usage.completion_tokens || result.usage.output_tokens || 0;
      this._totalUsage.totalTokens      += result.usage.total_tokens || 0;
      // ── Tägliches Budget-Tracking ──────────────────────────────────────
      const tokensUsed = (result.usage.total_tokens) ||
        (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0) ||
        (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0);
      if (tokensUsed > 0) this._trackTokenUsage(config.provider || this.defaultProvider, tokensUsed);
    }
    return result;
  }

  // ══════════════════════════════════════════════════════════════════
  // TOOL-FORMAT-KONVERTIERUNG (Johnny → Provider-nativ)
  // ══════════════════════════════════════════════════════════════════

  _convertTools(tools, provider) {
    if (!tools?.length) return null;
    const converted = tools.filter(Boolean).map(tool => {
      const properties = {}; const required = [];
      if (tool.parameters) {
        for (const [key, desc] of Object.entries(tool.parameters)) {
          const d = String(desc);
          const isOpt = /optional/i.test(d);
          let type = 'string';
          if (/number|integer/i.test(d)) type = 'number';
          if (/boolean/i.test(d))        type = 'boolean';
          if (/array/i.test(d))          type = 'array';
          if (/object/i.test(d))         type = 'object';
          properties[key] = { type, description: d.replace(/^(?:string|number|boolean|array|object)\s*[-–—]\s*/i,'').trim() };
          if (!isOpt) required.push(key);
        }
      }
      const schema = { type: 'object', properties, ...(required.length ? { required } : {}) };

      if (provider === 'openai' || provider === 'groq')
        return { type: 'function', function: { name: tool.name, description: (tool.description||'').slice(0,500), parameters: schema } };
      if (provider === 'anthropic')
        return { name: tool.name, description: (tool.description||'').slice(0,500), input_schema: schema };
      if (provider === 'google')
        return { name: tool.name, description: (tool.description||'').slice(0,500), parameters: schema };
      return null;
    }).filter(Boolean);

    return provider === 'google' ? [{ functionDeclarations: converted }] : converted;
  }

  // Native Tool-Call Responses → Johnny-Format [{ tool, parameters }]
  parseNativeToolCalls(data, provider) {
    const calls = [];
    if (provider === 'openai' || provider === 'groq') {
      for (const tc of (data.choices?.[0]?.message?.tool_calls || [])) {
        if (tc.type === 'function') {
          let args = {}; try { args = JSON.parse(tc.function.arguments||'{}'); } catch {}
          calls.push({ tool: tc.function.name, parameters: args, _id: tc.id });
        }
      }
    } else if (provider === 'anthropic') {
      for (const b of (data.content || [])) {
        if (b.type === 'tool_use') calls.push({ tool: b.name, parameters: b.input||{}, _id: b.id });
      }
    } else if (provider === 'google') {
      for (const p of (data.candidates?.[0]?.content?.parts || [])) {
        if (p.functionCall) calls.push({ tool: p.functionCall.name, parameters: p.functionCall.args||{} });
      }
    }
    return calls;
  }

  supportsNativeTools(provider) { return this.providers.get(provider)?.supportsNativeTools || false; }

  // ══════════════════════════════════════════════════════════════════
  // PROVIDER-IMPLEMENTIERUNGEN (Streaming + Native Tools)
  // ══════════════════════════════════════════════════════════════════

  async _genOllama(model, messages, opts = {}) {
    const baseUrl = opts.ollamaUrl || 'http://127.0.0.1:11434';
    if (opts.streamCallback) return this._streamSSE(baseUrl + '/api/chat',
      { model, messages, stream: true, options: { temperature: opts.temperature, num_ctx: opts.numCtx || 8192 } },
      {}, 'ollama', model, opts, 'ollama');
    const r = await axios.post(`${baseUrl}/api/chat`,
      { model, messages, stream: false, options: { temperature: opts.temperature, num_ctx: opts.numCtx || 8192 } },
      { timeout: 120000 });
    return { content: r.data.message.content, toolCalls: [], model, provider: 'ollama', usage: r.data.usage || {} };
  }

  async _genOpenAI(model, messages, opts = {}) {
    const apiKey = this.apiKeys.openai || opts.apiKey;
    if (!apiKey) throw new Error('OpenAI API key not configured');
    const body = { model, messages, temperature: opts.temperature, max_tokens: opts.maxTokens };
    if (opts.tools) body.tools = opts.tools;
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (opts.streamCallback && !opts.tools)
      return this._streamSSE('https://api.openai.com/v1/chat/completions', { ...body, stream: true }, headers, 'openai', model, opts, 'openai');
    const r = await axios.post('https://api.openai.com/v1/chat/completions', body, { headers, timeout: 120000 });
    return { content: r.data.choices[0].message.content || '', toolCalls: this.parseNativeToolCalls(r.data, 'openai'), model, provider: 'openai', usage: r.data.usage || {} };
  }

  async _genAnthropic(model, messages, opts = {}) {
    const apiKey = this.apiKeys.anthropic || opts.apiKey;
    if (!apiKey) throw new Error('Anthropic API key not configured');
    const anthropicMsgs = messages.filter(m => m.role !== 'system');
    const sysMsg = messages.find(m => m.role === 'system')?.content;
    const body = { model, messages: anthropicMsgs, max_tokens: opts.maxTokens || 4096, temperature: opts.temperature };
    if (sysMsg) body.system = sysMsg;
    if (opts.tools) body.tools = opts.tools;
    const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
    if (opts.streamCallback && !opts.tools)
      return this._streamSSE('https://api.anthropic.com/v1/messages', { ...body, stream: true }, headers, 'anthropic', model, opts, 'anthropic');
    const r = await axios.post('https://api.anthropic.com/v1/messages', body, { headers, timeout: 120000 });
    let content = ''; for (const b of (r.data.content||[])) { if (b.type === 'text') content += b.text; }
    return { content, toolCalls: this.parseNativeToolCalls(r.data, 'anthropic'), model, provider: 'anthropic', usage: r.data.usage || {} };
  }

  async _genGoogle(model, messages, opts = {}) {
    const apiKey = this.apiKeys.google || opts.apiKey;
    if (!apiKey) throw new Error('Google API key not configured');
    const sysMsg = messages.find(m => m.role === 'system');
    const contents = []; for (const m of messages.filter(m => m.role !== 'system')) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      const last = contents[contents.length-1];
      if (last && last.role === role) last.parts.push({ text: m.content });
      else contents.push({ role, parts: [{ text: m.content }] });
    }
    const body = { contents, generationConfig: { temperature: opts.temperature, maxOutputTokens: opts.maxTokens || 4096 } };
    if (sysMsg) body.systemInstruction = { parts: [{ text: sysMsg.content }] };
    if (opts.tools) body.tools = opts.tools;
    if (opts.streamCallback && !opts.tools)
      return this._streamSSE(`https://generativelanguage.googleapis.com/v1/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
        body, {}, 'google', model, opts, 'google');
    const r = await axios.post(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`, body, { timeout: 120000 });
    let content = ''; for (const p of (r.data.candidates?.[0]?.content?.parts||[])) { if (p.text) content += p.text; }
    return { content, toolCalls: this.parseNativeToolCalls(r.data, 'google'), model, provider: 'google', usage: r.data.usageMetadata || {} };
  }

  async _genGroq(model, messages, opts = {}) {
    const apiKey = this.apiKeys.groq || opts.apiKey;
    if (!apiKey) throw new Error('Groq API key not configured');
    const body = { model, messages, temperature: opts.temperature, max_tokens: opts.maxTokens };
    if (opts.tools) body.tools = opts.tools;
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (opts.streamCallback && !opts.tools)
      return this._streamSSE('https://api.groq.com/openai/v1/chat/completions', { ...body, stream: true }, headers, 'groq', model, opts, 'openai');
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', body, { headers, timeout: 60000 });
    return { content: r.data.choices[0].message.content||'', toolCalls: this.parseNativeToolCalls(r.data, 'groq'), model, provider: 'groq', usage: r.data.usage||{} };
  }

  async _genCustom(model, messages, opts = {}) {
    if (!opts.customUrl) throw new Error('Custom API URL not provided');
    const headers = { 'Content-Type': 'application/json' };
    if (opts.customApiKey) headers['Authorization'] = `Bearer ${opts.customApiKey}`;
    const r = await axios.post(opts.customUrl, { model, messages, ...opts.customBody }, { headers, timeout: 120000 });
    return { content: r.data.choices?.[0]?.message?.content || r.data.content || '', toolCalls: [], model, provider: 'custom', usage: r.data.usage || {} };
  }

  // ══════════════════════════════════════════════════════════════════
  // UNIVERSELLER SSE-STREAMER (alle Provider)
  // ══════════════════════════════════════════════════════════════════

  async _streamSSE(url, body, headers, provider, model, opts, parseFormat) {
    const chunks = [];
    const r = await axios.post(url, body, { headers, responseType: 'stream', timeout: 180000 });

    await new Promise((resolve, reject) => {
      let buf = '';
      const timeout = setTimeout(() => { r.data.destroy(); reject(new Error('Stream timeout')); }, 180000);
      r.data.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          // Ollama: raw JSON lines
          if (parseFormat === 'ollama') {
            if (!line.trim()) continue;
            try {
              const d = JSON.parse(line);
              const t = d?.message?.content || '';
              if (t) { chunks.push(t); if (opts.streamCallback) opts.streamCallback(t); }
              if (d.done) { clearTimeout(timeout); resolve(); }
            } catch {}
            continue;
          }
          // SSE: data: ... lines
          if (line.trim() === 'data: [DONE]') { clearTimeout(timeout); resolve(); return; }
          if (!line.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            let text = '';
            if (parseFormat === 'openai')     text = d.choices?.[0]?.delta?.content || '';
            else if (parseFormat === 'anthropic') {
              if (d.type === 'content_block_delta') text = d.delta?.text || '';
              if (d.type === 'message_stop') { clearTimeout(timeout); resolve(); return; }
            }
            else if (parseFormat === 'google')    text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) { chunks.push(text); if (opts.streamCallback) opts.streamCallback(text); }
          } catch {}
        }
      });
      r.data.on('end', () => { clearTimeout(timeout); resolve(); });
      r.data.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
    return { content: chunks.join(''), toolCalls: [], model, provider, usage: {} };
  }

  // ══════════════════════════════════════════════════════════════════
  // MANAGEMENT
  // ══════════════════════════════════════════════════════════════════

  setApiKey(p, k)   { this.apiKeys[p] = k; }

  // ── Token-Budget-Tracking ───────────────────────────────────────────────────
  // Verfolgt tägliche Token-Nutzung pro Provider und warnt bei konfigurierbarem Limit.

  _trackTokenUsage(provider, tokens) {
    if (!tokens || tokens <= 0) return;
    const today = new Date().toISOString().slice(0, 10);

    if (!this._dailyUsage) this._dailyUsage = {};
    if (!this._dailyUsage[today]) this._dailyUsage[today] = {};
    if (!this._dailyUsage[today][provider]) this._dailyUsage[today][provider] = 0;
    this._dailyUsage[today][provider] += tokens;

    // Alte Tage aufräumen (nur letzten 7 Tage behalten)
    for (const date of Object.keys(this._dailyUsage)) {
      if (date < new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)) {
        delete this._dailyUsage[date];
      }
    }

    // Budget-Warnung (konfigurierbar via this._tokenBudgetLimits)
    const limits = this._tokenBudgetLimits || {};
    const providerLimit = limits[provider] || limits['*'] || null;
    if (providerLimit) {
      const todayUsage = this._dailyUsage[today][provider];
      const pct = todayUsage / providerLimit;
      if (pct >= 1.0) {
        console.error(`[ModelProvider] 🚨 Token-Tageslimit ÜBERSCHRITTEN: ${provider} (${todayUsage.toLocaleString()} / ${providerLimit.toLocaleString()})`);
        const { EventBus } = (() => { try { return require('../core/EventBus'); } catch { return {}; } })();
        if (EventBus && EventBus.emit) EventBus.emit('token-budget:exceeded', { provider, used: todayUsage, limit: providerLimit });
      } else if (pct >= 0.8) {
        console.warn(`[ModelProvider] ⚠️  Token-Budget: ${provider} bei ${Math.round(pct * 100)}% (${todayUsage.toLocaleString()} / ${providerLimit.toLocaleString()})`);
      }
    }
  }

  setTokenBudgetLimits(limits) {
    // limits: { openai: 100000, anthropic: 50000, '*': 200000 }
    this._tokenBudgetLimits = limits;
    console.log('[ModelProvider] Token-Budget-Limits gesetzt:', limits);
  }

  getDailyUsage(date = null) {
    const d = date || new Date().toISOString().slice(0, 10);
    return this._dailyUsage?.[d] || {};
  }

  getUsageStats()   { return { ...this._totalUsage, daily: this.getDailyUsage() }; }
  getModels(p)      { return this.providers.get(p)?.models || []; }

  /**
   * Holt live installierte Ollama-Modelle und aktualisiert die Provider-Liste.
   * Fällt auf die statische Fallback-Liste zurück falls Ollama nicht erreichbar.
   */
  async getOllamaModels(ollamaUrl = 'http://127.0.0.1:11434') {
    try {
      const res = await axios.get(`${ollamaUrl}/api/tags`, { timeout: 4000 });
      const liveModels = (res.data.models || []).map(m => m.name).filter(Boolean);
      if (liveModels.length > 0) {
        const pc = this.providers.get('ollama');
        if (pc) pc.models = liveModels;
        return liveModels;
      }
    } catch (_) {
      // Ollama nicht erreichbar — statische Liste zurückgeben
    }
    return this.providers.get('ollama')?.models || [];
  }
  getProviders()    {
    return Array.from(this.providers.entries()).map(([id, c]) => ({
      id, name: c.name, type: c.type, requiresKey: c.requiresKey||false,
      hasKey: !!this.apiKeys[id], models: c.models,
      supportsNativeTools: c.supportsNativeTools||false, supportsStreaming: c.supportsStreaming||false,
    }));
  }
  async testProvider(provider, model) {
    try { const r = await this.generate({ provider, model, messages: [{ role:'user', content:'Hi. Reply OK.' }] }); return { success: true, response: r.content?.slice(0,100) }; }
    catch (e) { return { success: false, error: e.message }; }
  }
  async generateWithFallback(config) {
    const providers = config.providers || [this.defaultProvider, 'ollama', 'groq'];
    let lastErr; for (const p of providers) { try { return await this.generate({ ...config, provider: p }); } catch(e) { lastErr = e; } }
    throw lastErr || new Error('All providers failed');
  }
}

module.exports = ModelProvider;
