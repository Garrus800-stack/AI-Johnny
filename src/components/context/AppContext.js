/**
 * AppContext — Zentrales State-Management für Johnny UI
 *
 * Ersetzt die 60+ useState-Hooks im monolithischen App.
 * Jede View-Komponente nutzt: var ctx = useApp();
 *   ctx.get('messages')       — State lesen
 *   ctx.set('messages')(val)  — State setzen
 *   ctx.inv('channel', data)  — IPC invoke
 *   ctx.actions.sendMessage() — Action aufrufen
 */
'use strict';

var AppCtx = React.createContext(null);

// ── Default State ─────────────────────────────────────────────────────────
var DEFAULT_STATE = {
  view:'chat', messages:[], input:'', loading:false, convId:null,
  streamText:'', toasts:[], ollamaDown:false, conversations:[], convSearch:'', showConvSidebar:false, chatImage:null,
  showSetup:false, activeAgent:'Johnny', agents:[], sysstats:null,
  skills:[], plugins:[], providers:[], emails:[], messengers:[],
  models:[], activeModel:'', activeProvider:'ollama',
  ollamaUrl:'http://127.0.0.1:11434', tgToken:'', savedMsg:'',
  modal:null, form:{}, pullName:'', pullStatus:'', pulling:false,
  tunnelPort:'8765', tunnelUrl:'', tunnelRunning:false, tunnelMsg:'',
  toolSteps:[], debugLog:[], showDebug:false,
  recording:false, voiceStatus:'', ttsActive:false,
  sandboxMode:'auto', sandboxStatus:null, sandboxCode:'print("Hello from Johnny!")',
  sandboxLang:'python', sandboxOutput:'', sandboxRunning:false, sandboxTab:'editor',
  sbChatHistory:[], sbChatInput:'', sbChatSending:false, sbConvId:null,
  sbZipFiles:[], sbZipActive:null, sbZipName:'', sbZipLoading:false,
  sbReviewing:false, sbReviewResult:null,
  tasks:[], taskFilter:'all', ragStatus:null,
  imgPrompt:'', imgProvider:'openai', imgSize:'1024x1024', imgStyle:'vivid', imgQuality:'standard',
  imgGenerating:false, imgResults:[], imgError:'', imgProviders:[],
  videoPath:'', videoPrompt:'Was passiert in diesem Video?',
  videoProvider:'auto', videoMaxFrames:8, videoIncludeAudio:true,
  videoAnalyzing:false, videoResult:null, videoError:'', videoFFmpeg:false,
  videoFFmpegPath:null, videoInstallHint:null,
  ragItems:[], ragQuery:'', ragResults:[], ragSearching:false, ragTab:'search',
  ragKnowledge:'', ragTopic:'', ragSaving:false,
  collabRunning:false, collabPort:9090, collabClients:0, collabRooms:[], collabMsg:'',
  collabTunnelUrl:'', collabTab:'status', collabNewRoom:'', collabNewRoomPw:'',
  skillEditorSkill:null, skillEditorCode:'', skillEditorSaving:false,
  whatsappQR:'', whatsappReady:false, whisperAvail:null,
  dockerAvail:null, dockerCompose:'',
  audioTools:null, svcStatus:null, _dockerChecked:false,
  _eiChecked:false, _cwChecked:false, _evChecked:false, _videoChecked:false,
  mkSearchQ:'', mkResults:[], mkInstalled:[], mkLoading:false,
  mkRegistries:[], mkCategories:{}, mkActiveCategory:null,
  swGoal:'', swType:'research', swSwarms:[], swRunning:false, swResult:null, swError:'',
  hbTasks:[], hbName:'', hbSchedule:'0 8 * * *', hbPrompt:'', hbCreating:false,
  hbUrl:'', hbLastResult:null, _hbChecked:false, _ragChecked:false,
  shDevices:[], shStatus:null, intStatus:null, intGhRepos:[], intCalEvents:[],
  voiceLang:'de', ttsProvider:'browser', openaiTtsVoice:'nova', elevenlabsKey:'',
  gwStatus:null,
  // v1.8.5: Messenger Auth
  tgWhitelist:[], tgAllowAll:false,
  messengerAllowAll:false,
  messengerWl_discord:[], messengerWl_whatsapp:[],
  messengerWl_slack:[], messengerWl_matrix:[], messengerWl_signal:[],
  // Token-Budget
  tokenBudget_openai:0, tokenBudget_anthropic:0, tokenBudget_google:0,
  tokenBudget_groq:0, tokenBudget_mistral:0,
  // v2.0: Emotional Intelligence
  eiStatus:null, eiResult:null, eiProfile:null, eiInput:'', eiAnalyzing:false,
  cwStatus:null, evStatus:null,
  // v2.0: Creative Writing Studio
  cwGenres:null, cwPrompt:'', cwGenre:'fiction', cwLength:'medium', cwResult:null, cwGenerating:false, cwStyle:'', cwError:'',
  // v2.0: Enhanced Vision
  evModes:[], evMode:'describe', evPath:'', evResult:null, evAnalyzing:false,
  // v2.0: Time Series Analysis
  tsaDatasets:[], tsaResult:null, tsaActive:null,
  // Project Manager
  pmProjects:[], pmActive:null, pmTab:'board', pmCreating:false, pmNewName:'',
  pmNewTask:'', pmGoal:'', pmConstraints:'', pmPlanning:false, pmPlanResult:null,
  // Self Reflection
  srTab:'dashboard', srReflecting:false, srReport:null, srAnalytics:null,
  srLogs:[], srQuestion:'', srConsciousness:null, srLoadingConsciousness:false,
  haUrl:'', haToken:'', spotifyClientId:'', spotifyClientSecret:'', githubToken:'',
  hubConns:[], hubTemplates:[], hubWorkflows:[], hubConnecting:null, hubConnForm:{},
};

// ── Provider Component ────────────────────────────────────────────────────
function AppProvider(props) {
  // ═══ STATE MANAGEMENT v2 ═══════════════════════════════════════════════
  // Problem: 60+ useState → jedes set() triggert Re-Render ALLER Views
  // Lösung: Rendering-State (useState) vs. Silent-State (useRef)
  //
  // Silent-State: interne Flags, Check-Status, Formulardaten
  // → Änderungen triggern KEINEN Re-Render
  // Rendering-State: alles was die UI direkt anzeigt
  // → Änderungen triggern Re-Render (gewollt)

  // Keys die KEINEN Re-Render brauchen (interne Flags)
  var SILENT_KEYS = [
    '_dockerChecked','_eiChecked','_cwChecked','_evChecked','_videoChecked',
    '_hbChecked','_ragChecked','debugLog','showDebug','form',
  ];
  var silentRef = React.useRef({});
  for (var si = 0; si < SILENT_KEYS.length; si++) {
    silentRef.current[SILENT_KEYS[si]] = DEFAULT_STATE[SILENT_KEYS[si]];
  }

  // Rendering-State: alles andere
  var stateEntries = {};
  var keys = Object.keys(DEFAULT_STATE);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (SILENT_KEYS.indexOf(k) === -1) {
      stateEntries[k] = React.useState(DEFAULT_STATE[k]);
    }
  }

  function get(k) {
    // Silent-State: direkt aus Ref lesen (kein Re-Render)
    if (SILENT_KEYS.indexOf(k) >= 0) return silentRef.current[k];
    return stateEntries[k] ? stateEntries[k][0] : undefined;
  }

  function set(k) {
    // Silent-State: direkt in Ref schreiben (kein Re-Render)
    if (SILENT_KEYS.indexOf(k) >= 0) {
      return function(v) {
        silentRef.current[k] = typeof v === 'function' ? v(silentRef.current[k]) : v;
      };
    }
    return stateEntries[k] ? stateEntries[k][1] : function(){};
  }

  function log(msg) {
    set('debugLog')(function(p){ return p.slice(-29).concat([new Date().toLocaleTimeString()+' '+msg]); });
  }

  function inv(ch, data) {
    var api = (typeof window !== 'undefined' && window.johnny) ? window.johnny : window.ipcRenderer;
    return api.invoke(ch, data).catch(function(err){
      log(ch+' ERR:'+err.message);
      return null;
    });
  }

  // ── IPC Event Listeners ─────────────────────────────────────────────────
  React.useEffect(function() {
    var _api = (typeof window !== 'undefined' && window.johnny) ? window.johnny : window.ipcRenderer;
    var unmounted = false;      // Fix: verhindert setState auf unmounted component
    var setupTimeoutRef = null; // Fix: setTimeout-Referenz für sauberes Cleanup
    _api.send('renderer-ready');
    // Fix: services-initialized lädt NICHT nochmal — loadAll() läuft bereits beim Mount
    // Verhindert 30+ doppelte IPC-Calls kurz nach dem Start
    // FIX: preload.js strips the IPC event object — callbacks receive (data) directly, NOT (event, data)
    _api.on('services-initialized', function(){
      set('showSetup')(false);
      inv('get-providers').then(function(v){ if(v&&v.length) set('providers')(v); });
      inv('get-service-status').then(function(v){ if(v) set('svcStatus')(v); });
      inv('get-image-providers').then(function(v){ if(v) set('imgProviders')(v); });
      inv('ei-status').then(function(v){ if(v) set('eiStatus')(v); });
      inv('cw-status').then(function(v){ if(v) set('cwStatus')(v); });
      inv('ev-status').then(function(v){ if(v) set('evStatus')(v); });
      inv('list-conversations').then(function(v){ if(v) set('conversations')(v); });
      loadModels();
    });
    _api.on('heartbeat', function(d){
      if(d) set('sysstats')(d);
      // Auto-Reconnect: Wenn Ollama down → bei jedem Heartbeat prüfen
      if(stateEntries['ollamaDown'] && stateEntries['ollamaDown'][0]) {
        inv('list-ollama-models').then(function(v){
          if(v && v.length > 0) {
            set('ollamaDown')(false);
            set('models')(v);
            // Toast: Ollama wieder da
            var id = Date.now();
            set('toasts')(function(prev){ return (prev||[]).concat([{id:id,type:'success',message:'Ollama wieder verbunden — '+v.length+' Modelle verfügbar'}]).slice(-5); });
            setTimeout(function(){ set('toasts')(function(prev){ return (prev||[]).filter(function(t){return t.id!==id;}); }); }, 5000);
          }
        }).catch(function(){});
      }
    });
    _api.on('setup-status', function(d){
      if(!d) return;
      if(d.step==='welcome') set('showSetup')(true);
      if(['complete','model-skipped','ollama-failed'].indexOf(d.step)>=0){
        // Fix: setTimeout-ID merken damit er beim Unmount gecancelt werden kann
        setupTimeoutRef = setTimeout(function(){
          if (!unmounted) { set('showSetup')(false); loadAll(); }
        }, 1200);
      }
    });
    _api.on('model-pull-progress', function(d){
      if(!d) return;
      set('pullStatus')((d.status||'')+(d.percent!=null?' '+d.percent+'%':''));
    });
    _api.on('tool-step', function(d){ if(d) set('toolSteps')(function(p){ return p.slice(-19).concat([d]); }); });
    _api.on('tunnel-status', function(d){
      if(!d) return;
      if(d.url){ set('tunnelUrl')(d.url); set('tunnelRunning')(true); set('tunnelMsg')('Active'); }
      else if(d.error){ set('tunnelMsg')('Error: '+d.error); set('tunnelRunning')(false); }
      else if(d.status) set('tunnelMsg')(d.status.slice(0,80));
    });
    _api.on('task-update', function(d){
      if(d && d.task) set('tasks')(function(prev){
        var found = prev.findIndex(function(t){return t.id===d.task.id;});
        if(found>=0){ var next=prev.slice(); next[found]=d.task; return next; }
        return [d.task].concat(prev);
      });
    });
    _api.on('whatsapp-qr', function(d){ if(d) set('whatsappQR')(d.qr||''); set('whatsappReady')(false); });
    _api.on('whatsapp-ready', function(){ set('whatsappReady')(true); set('whatsappQR')(''); });
    _api.on('collab-update', function(d){ if(d && d.clients!=null) set('collabClients')(d.clients); });
    _api.on('model-switched', function(d){
      if(d&&d.model){ set('activeModel')(d.model); set('activeProvider')(d.provider||'ollama'); }
    });
    loadAll();
    return function(){
      unmounted = true; // Fix: markiere als unmounted
      if (setupTimeoutRef) clearTimeout(setupTimeoutRef); // Fix: Timer canceln
      ['services-initialized','heartbeat','setup-status','model-pull-progress','tool-step',
       'tunnel-status','task-update','whatsapp-qr','whatsapp-ready','collab-update','model-switched']
        .forEach(function(ev){ _api.removeAllListeners(ev); });
    };
  }, []);

  // ── Data Loading ────────────────────────────────────────────────────────
  function loadAll() {
    // ── ZUERST: Settings laden (Modell, Provider) — dann loadModels ──────
    inv('get-settings').then(function(cfg){
      if(!cfg) return;
      if(cfg['settings.model'])          set('activeModel')(cfg['settings.model']);
      if(cfg['settings.defaultProvider'])set('activeProvider')(cfg['settings.defaultProvider']);
      if(cfg['settings.ollamaUrl'])      set('ollamaUrl')(cfg['settings.ollamaUrl']);
      if(cfg['settings.telegramToken'])  set('tgToken')(cfg['settings.telegramToken']);
      if(cfg['settings.sandboxMode'])    set('sandboxMode')(cfg['settings.sandboxMode']);
      if(cfg['settings.voiceLanguage'])  set('voiceLang')(cfg['settings.voiceLanguage']);
      if(cfg['settings.ttsProvider'])    set('ttsProvider')(cfg['settings.ttsProvider']);
      if(cfg['settings.openaiTtsVoice'])set('openaiTtsVoice')(cfg['settings.openaiTtsVoice']);
      if(cfg['apiKeys.elevenlabs'])      set('elevenlabsKey')(cfg['apiKeys.elevenlabs']);
      if(cfg['settings.haUrl'])           set('haUrl')(cfg['settings.haUrl']);
      if(cfg['settings.haToken'])         set('haToken')(cfg['settings.haToken']);
      if(cfg['apiKeys.spotifyClientId'])  set('spotifyClientId')(cfg['apiKeys.spotifyClientId']);
      if(cfg['apiKeys.spotifyClientSecret']) set('spotifyClientSecret')(cfg['apiKeys.spotifyClientSecret']);
      if(cfg['apiKeys.github'])           set('githubToken')(cfg['apiKeys.github']);
      // Nach Settings-Load: Modelle laden (respektiert jetzt gespeicherten Provider)
      loadModels();
    });
    inv('get-agents').then(function(v){
      if(!v) return;
      set('agents')(v);
      // Johnny-Modell nur als Fallback wenn noch nichts aus Settings geladen
      var johnny = v.find(function(a){ return a.name === 'Johnny'; });
      if(johnny && johnny.model) {
        set('activeModel')(function(prev){ return prev||johnny.model; });
        set('activeProvider')(function(prev){ return prev||johnny.modelProvider||'ollama'; });
      }
    });
    inv('get-system-stats').then(function(v){ if(v) set('sysstats')(v); });
    inv('list-skills').then(function(v){ if(v) set('skills')(v); });
    inv('list-plugins').then(function(v){ if(v) set('plugins')(v); });
    inv('get-providers').then(function(v){ if(v) set('providers')(v); });
    inv('list-email-accounts').then(function(v){ if(v) set('emails')(v); });
    inv('get-messenger-status').then(function(v){ if(v) set('messengers')(v); });
    inv('get-tasks').then(function(v){ if(v) set('tasks')(v); });
    inv('sandbox-status').then(function(v){ if(v) set('sandboxStatus')(v); });
    inv('telegram:get-whitelist').then(function(v){ if(Array.isArray(v)) set('tgWhitelist')(v); });
    inv('messenger:get-allow-all').then(function(v){ set('messengerAllowAll')(!!v); });
    inv('token-budget:get').then(function(v){
      if(!v) return;
      ['openai','anthropic','google','groq','mistral'].forEach(function(p){
        if(v[p]!==undefined) set('tokenBudget_'+p)(v[p]);
      });
    });
    inv('messenger:get-all-whitelists').then(function(v){
      if(!v) return;
      ['discord','whatsapp','slack','matrix','signal'].forEach(function(ms){
        if(Array.isArray(v[ms])) set('messengerWl_'+ms)(v[ms]);
      });
    });
    inv('get-image-providers').then(function(v){ if(v) set('imgProviders')(v); });
    inv('get-collaboration-status').then(function(v){
      if(v){ set('collabRunning')(v.running); set('collabClients')(v.clients||0); set('collabRooms')(v.rooms||[]); if(v.port) set('collabPort')(v.port); }
    });
    inv('rag-status').then(function(v){ if(v) set('ragStatus')(v); });
    inv('check-whisper').then(function(v){ if(v!==null&&v!==undefined) set('whisperAvail')(v); else set('whisperAvail')({available:false}); });
    inv('check-docker').then(function(v){ if(v!==null&&v!==undefined) set('dockerAvail')(v); else set('dockerAvail')({available:false}); });
    inv('check-audio-tools').then(function(v){ if(v) set('audioTools')(v); });
    inv('get-service-status').then(function(v){ if(v) set('svcStatus')(v); });
    inv('get-docker-compose').then(function(r){ if(r&&r.content) set('dockerCompose')(r.content); });
    inv('video-service-status').then(function(v){
      if(v){
        set('videoFFmpeg')(v.available||v.ffmpeg||false);
        set('videoFFmpegPath')(v.ffmpegPath||null);
        set('videoInstallHint')(v.installHint||null);
      }
    });
    inv('marketplace-installed').then(function(v){ if(v) set('mkInstalled')(v); });
    inv('marketplace-search',{query:''}).then(function(v){ if(v&&!v.error) set('mkResults')(v); });
    inv('marketplace-registries').then(function(v){ if(v) set('mkRegistries')(v); });
    inv('marketplace-categories').then(function(v){ if(v) set('mkCategories')(v); });
    inv('get-swarms').then(function(v){ if(v) set('swSwarms')(v); });
    inv('get-heartbeat-tasks').then(function(v){ if(v) set('hbTasks')(v); });
    inv('smarthome-status').then(function(v){ if(v) set('shStatus')(v); });
    inv('smarthome-devices').then(function(v){ if(v) set('shDevices')(v); });
    inv('integrations-status').then(function(v){ if(v) set('intStatus')(v); });
    inv('get-gateway-status').then(function(v){ if(v) set('gwStatus')(v); });
    inv('ei-status').then(function(v){ if(v) set('eiStatus')(v); });
    inv('cw-status').then(function(v){ if(v) set('cwStatus')(v); });
    inv('ev-status').then(function(v){ if(v) set('evStatus')(v); });
    inv('cw-get-genres').then(function(v){ if(v) set('cwGenres')(v); });
    inv('ev-modes').then(function(v){ if(v) set('evModes')(v); });
    inv('tsa-list').then(function(v){ if(v) set('tsaDatasets')(v); });
    inv('hub-connections').then(function(v){ if(v) set('hubConns')(v); });
    inv('hub-templates').then(function(v){ if(v) set('hubTemplates')(v); });
    inv('hub-list-workflows').then(function(v){ if(v) set('hubWorkflows')(v); });
  }

  function loadModels() {
    inv('list-ollama-models').then(function(v){
      var list = v||[];
      set('models')(list);
      // PRIO 2: Ollama health — wenn keine Modelle → Ollama wahrscheinlich down
      if(list.length === 0) {
        set('ollamaDown')(true);
      } else {
        set('ollamaDown')(false);
        set('activeModel')(function(prev){
          var prov = stateEntries['activeProvider'] ? stateEntries['activeProvider'][0] : 'ollama';
          if(prov !== 'ollama') return prev;
          if(prev && list.some(function(m){return m.name===prev;})) return prev;
          return list[0].name;
        });
      }
    }).catch(function(){ set('ollamaDown')(true); });
  }

  // PRIO 5: Conversations laden
  function loadConversations() {
    inv('list-conversations').then(function(v){ if(v) set('conversations')(v); })
      .catch(function(){});
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  var actions = {
    loadAll: loadAll,
    loadModels: loadModels,
    loadConversations: loadConversations,
    log: log,

    selectModel: function(name, provider) {
      var prov = provider||'ollama';
      set('activeModel')(name);
      set('activeProvider')(prov);
      set('savedMsg')('Wechsle zu '+name+'...');
      inv('set-active-provider-model',{provider:prov,model:name}).then(function(r){
        if(r&&r.success){
          // Sofort persistent speichern
          inv('save-settings',{model:name,defaultProvider:prov});
          set('savedMsg')('✓ '+name+' aktiv');
          setTimeout(function(){set('savedMsg')('');},3000);
        } else {
          set('savedMsg')('Fehler: '+(r&&r.error||'unbekannt'));
          setTimeout(function(){set('savedMsg')('');},5000);
        }
      });
    },

    selectCloudModel: function(providerId, modelName) {
      var prov = get('providers').find(function(p){return p.id===providerId;});
      if(prov && !prov.hasKey){
        alert('Please set an API key for '+prov.name+' first.');
        return;
      }
      actions.selectModel(modelName, providerId);
    },

    saveSettings: function() {
      inv('save-settings',{model:get('activeModel'),ollamaUrl:get('ollamaUrl'),telegramToken:get('tgToken'),defaultProvider:get('activeProvider')})
        .then(function(){ set('savedMsg')('Saved!'); setTimeout(function(){set('savedMsg')('');},3000); });
    },

    doPull: function() {
      if(!get('pullName').trim()||get('pulling')) return;
      set('pulling')(true); set('pullStatus')('Starting...');
      inv('pull-ollama-model',get('pullName').trim())
        .then(function(){ set('pullStatus')('✓ Done!'); loadModels(); set('pullName')(''); })
        .catch(function(e){ set('pullStatus')('Error: '+e.message); })
        .finally(function(){ set('pulling')(false); });
    },

    allCaps: ['tool-calling','autonomous-decision','web-search','code-execution','file-management','email','agent-creation','self-improvement','image-analysis','voice','scheduling'],

    toggleCap: function(cap) {
      set('form')(function(f){
        var caps = f.capabilities||[];
        return Object.assign({},f,{capabilities: caps.indexOf(cap)>=0 ? caps.filter(function(c){return c!==cap;}) : caps.concat([cap])});
      });
    },

    modelOptions: function() {
      var p = get('form').modelProvider||'ollama';
      if(p==='ollama') return get('models').map(function(m){return{value:m.name,label:m.name};});
      var prov = get('providers').find(function(x){return x.id===p;});
      return ((prov&&prov.models)||[]).map(function(m){return{value:m,label:m};});
    },
  };

  var ctx = { get: get, set: set, inv: inv, actions: actions };

  return React.createElement(AppCtx.Provider, { value: ctx }, props.children);
}

function useApp() {
  return React.useContext(AppCtx);
}

module.exports = { AppProvider: AppProvider, useApp: useApp, AppCtx: AppCtx };
