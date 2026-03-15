const Store = require('electron-store');

class SetupWizard {
  constructor(config) {
    this.store = new Store();
    this.mainWindow = config.mainWindow;
    this._resolveChoice = null;
  }

  async sendToRenderer(channel, data) {
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send(channel, data);
    }
    await new Promise(r => setTimeout(r, 80));
  }

  waitForChoice() {
    return new Promise((resolve) => { this._resolveChoice = resolve; });
  }

  handleChoice(data) {
    if (this._resolveChoice) {
      const fn = this._resolveChoice;
      this._resolveChoice = null;
      fn(data);
    }
  }

  async run() {
    if (this.store.get('setup.completed')) {
      return { skipped: true, config: this.store.get('setup.config') };
    }
    console.log('[Setup] Starting interactive wizard...');

    await this.sendToRenderer('setup-status', { step:'welcome', message:'Willkommen bei Johnny AI!', progress:5, ui:{type:'info'} });
    await new Promise(r => setTimeout(r, 1200));

    // Provider wählen
    await this.sendToRenderer('setup-status', {
      step:'choose-provider', message:'Welchen AI-Provider möchtest du verwenden?', progress:15,
      ui:{
        type:'provider-select',
        providers:[
          { id:'ollama',    name:'Ollama (Lokal)',              icon:'🖥️', desc:'Kostenlos, kein API-Key, läuft offline auf deinem PC.', needsKey:false, recommended:true },
          { id:'openai',    name:'OpenAI — GPT-4o',             icon:'🤖', desc:'Leistungsstark, benötigt API-Key von platform.openai.com', needsKey:true, placeholder:'sk-...' },
          { id:'anthropic', name:'Anthropic — Claude',          icon:'🧠', desc:'Claude 3.5 Sonnet. API-Key von console.anthropic.com', needsKey:true, placeholder:'sk-ant-...' },
          { id:'google',    name:'Google — Gemini',             icon:'✨', desc:'Gemini 1.5 Pro/Flash. API-Key von aistudio.google.com', needsKey:true, placeholder:'AIza...' },
          { id:'groq',      name:'Groq — Llama3 (Schnell)',     icon:'⚡', desc:'Kostenloser Tier verfügbar! API-Key von console.groq.com', needsKey:true, placeholder:'gsk_...' },
          { id:'mistral',   name:'Mistral AI',                  icon:'🌊', desc:'Europäischer Anbieter. API-Key von console.mistral.ai', needsKey:true, placeholder:'...' },
          { id:'custom',    name:'Custom / LM Studio / lokal',  icon:'🔧', desc:'Jede OpenAI-kompatible API (LM Studio, Text Generation WebUI...)', needsKey:false, needsUrl:true, placeholder:'http://localhost:1234/v1' }
        ]
      }
    });

    const providerChoice = await this.waitForChoice();
    const providerId = providerChoice.provider || 'ollama';
    const apiKey     = providerChoice.apiKey || '';
    const customUrl  = providerChoice.customUrl || '';

    if (apiKey)     this.store.set('apiKeys.' + providerId, apiKey);
    if (customUrl)  this.store.set('settings.customProviderUrl', customUrl);
    console.log('[Setup] Provider:', providerId);

    // Modell wählen
    let selectedModel = '';

    if (providerId === 'ollama') {
      await this.sendToRenderer('setup-status', { step:'ollama-check', message:'Prüfe Ollama...', progress:30, ui:{type:'info'} });
      let ollamaModels = [];
      try {
        const axios = require('axios');
        const res = await axios.get('http://127.0.0.1:11434/api/tags', { timeout:4000 });
        ollamaModels = (res.data.models||[]).map(m=>m.name);
      } catch(_) {}

      if (ollamaModels.length > 0) {
        await this.sendToRenderer('setup-status', {
          step:'choose-model', message:'Welches Modell soll Johnny nutzen?', progress:45,
          ui:{ type:'model-select', models:ollamaModels, recommended: ollamaModels.find(m=>m.includes('gemma2')) || ollamaModels[0] }
        });
        const mc = await this.waitForChoice();
        selectedModel = mc.model || ollamaModels[0];
      } else {
        await this.sendToRenderer('setup-status', {
          step:'no-models', message:'Keine Modelle gefunden. Soll ich eines herunterladen?', progress:40,
          ui:{
            type:'download-model',
            suggestions:[
              { id:'gemma2:2b',   size:'1.6 GB', desc:'Sehr schnell, gut für einfache Aufgaben' },
              { id:'gemma2:9b',   size:'5.5 GB', desc:'⭐ Empfohlen — bestes Gleichgewicht' },
              { id:'llama3.2:3b', size:'2.0 GB', desc:'Meta Llama, gut mehrsprachig' },
              { id:'mistral:7b',  size:'4.1 GB', desc:'Sehr gut für Deutsch & Code' },
              { id:'skip',        size:'',       desc:'Später im Models-Tab installieren' }
            ]
          }
        });
        const dc = await this.waitForChoice();
        if (dc.model && dc.model !== 'skip') {
          selectedModel = dc.model;
          await this.sendToRenderer('setup-status', { step:'downloading', message:'Lade ' + selectedModel + ' herunter...', progress:55, ui:{type:'progress'} });
          try {
            const axios = require('axios');
            const resp = await axios.post('http://127.0.0.1:11434/api/pull', { name:selectedModel }, { responseType:'stream', timeout:0 });
            await new Promise((resolve, reject) => {
              resp.data.on('data', chunk => {
                try {
                  chunk.toString().split('\n').filter(Boolean).forEach(line => {
                    const d = JSON.parse(line);
                    const pct = d.completed && d.total ? Math.round((d.completed/d.total)*35)+55 : 65;
                    this.sendToRenderer('setup-status', { step:'downloading', message: selectedModel + ': ' + (d.status||'') + (d.completed ? ' '+Math.round(d.completed/1024/1024)+'MB':''), progress:pct, ui:{type:'progress'} });
                  });
                } catch(_) {}
              });
              resp.data.on('end', resolve);
              resp.data.on('error', reject);
            });
          } catch(e) { console.warn('[Setup] Pull failed:', e.message); }
        } else {
          selectedModel = 'gemma2:9b';
        }
      }
    } else {
      const cloudModels = {
        openai:    ['gpt-4.1','gpt-4.1-mini','gpt-4o','gpt-4o-mini','o3-mini'],
        anthropic: ['claude-sonnet-4-6','claude-sonnet-4-5','claude-haiku-4-5','claude-3-5-sonnet-20241022'],
        google:    ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.0-flash','gemini-1.5-pro'],
        groq:      ['llama-3.3-70b-versatile','llama-3.1-8b-instant','mixtral-8x7b-32768'],
        mistral:   ['mistral-large-latest','mistral-medium','mistral-small'],
        custom:    ['custom-model']
      };
      const models = cloudModels[providerId] || ['default'];
      await this.sendToRenderer('setup-status', {
        step:'choose-cloud-model', message:'Welches ' + providerId + ' Modell?', progress:50,
        ui:{ type:'model-select', models:models, recommended:models[0] }
      });
      const mc = await this.waitForChoice();
      selectedModel = mc.model || models[0];
    }

    await this.sendToRenderer('setup-status', { step:'finalizing', message:'Fertigstellung...', progress:92, ui:{type:'info'} });

    const config = { ollamaUrl:'http://127.0.0.1:11434', defaultProvider:providerId, defaultModel:selectedModel, setupDate:new Date().toISOString() };
    this.store.set('setup.completed', true);
    this.store.set('setup.config', config);
    this.store.set('settings.model', selectedModel);
    this.store.set('settings.defaultProvider', providerId);

    await this.sendToRenderer('setup-status', { step:'complete', message:'Johnny ist bereit! (' + providerId + '/' + selectedModel + ')', progress:100, ui:{type:'done', provider:providerId, model:selectedModel} });
    await new Promise(r => setTimeout(r, 1000));
    return { success:true, config };
  }
}

module.exports = SetupWizard;
