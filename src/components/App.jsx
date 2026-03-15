/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  App.jsx — Johnny UI Shell                                          ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  Refaktoriert von 2400 Zeilen Monolith → Modulares Architecture:   ║
 * ║                                                                      ║
 * ║  src/components/                                                     ║
 * ║  ├── App.jsx              ← DU BIST HIER (Shell + Routing)         ║
 * ║  ├── ui/UIKit.js          ← Shared UI Components                   ║
 * ║  ├── context/AppContext.js ← State Management + IPC Bridge          ║
 * ║  └── views/                                                         ║
 * ║      ├── ViewHelpers.js   ← Action Functions (Chat, Voice, etc.)   ║
 * ║      └── ViewRegistry.js  ← Alle 21 View-Funktionen               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */
'use strict';

var path = require('path');
var appRoot = path.join(__dirname, '..');

// ── Module laden ────────────────────────────────────────────────────────────
var UI             = require(path.join(appRoot, 'components', 'ui', 'UIKit.js'));
var AppContextMod  = require(path.join(appRoot, 'components', 'context', 'AppContext.js'));
var ViewHelpersMod = require(path.join(appRoot, 'components', 'views', 'ViewHelpers.js'));
var ViewRegistry   = require(path.join(appRoot, 'components', 'views', 'ViewRegistry.js'));
var ViewExtensions = require(path.join(appRoot, 'components', 'views', 'ViewExtensions.js'));

var AppProvider = AppContextMod.AppProvider;
var useApp      = AppContextMod.useApp;
var createHelpers = ViewHelpersMod.createHelpers;
var createViews   = ViewRegistry.createViews;
var createExtendedViews = ViewExtensions.createExtendedViews;

// ── Navigation ──────────────────────────────────────────────────────────────
var NAV_ITEMS = [
  {id:'dashboard',icon:'🏠',label:'Dashboard'},
  {id:'chat',icon:'💬',label:'Chat'},
  {id:'agents',icon:'🤖',label:'Agents'},
  {id:'projects',icon:'📊',label:'Projects'},
  {id:'tasks',icon:'📋',label:'Tasks'},
  {id:'selfreflection',icon:'🧘',label:'Selbstreflexion'},
  {id:'sandbox',icon:'⚗️',label:'Sandbox'},
  {id:'skills',icon:'🔌',label:'Skill Editor'},
  {id:'marketplace',icon:'🛒',label:'Marketplace'},
  {id:'imagegen',icon:'🎨',label:'Image Gen'},
  {id:'video',icon:'🎬',label:'Video Analysis'},
  {id:'rag',icon:'🗄️',label:'Knowledge (RAG)'},
  {id:'collab',icon:'👥',label:'Collaboration'},
  {id:'swarm',icon:'🐝',label:'Agent Swarms'},
  {id:'heartbeat',icon:'⏰',label:'Heartbeat Tasks'},
  {id:'smarthome',icon:'🏡',label:'Smart Home'},
  {id:'integrations',icon:'🔗',label:'Integrations'},
  {id:'gateway',icon:'🔌',label:'Gateway'},
  {id:'models',icon:'🧠',label:'Models'},
  {id:'communication',icon:'📧',label:'Communication'},
  {id:'docker',icon:'🐳',label:'Docker'},
  {id:'monitoring',icon:'📊',label:'System'},
  {id:'emotionai',icon:'🧠',label:'Emotional AI'},
  {id:'creativewriting',icon:'✍️',label:'Creative Writing'},
  {id:'enhancedvision',icon:'👁️',label:'Enhanced Vision'},
  {id:'timeseries',icon:'📈',label:'Time Series'},
  {id:'integrationhub',icon:'🔗',label:'Integration Hub'},
  {id:'settings',icon:'⚙️',label:'Settings'},
];

var TITLES = {
  dashboard:'🏠 Dashboard', chat:'💬 Chat', agents:'🤖 Agents',
  projects:'📊 Project Manager', tasks:'📋 Tasks & Workflow',
  selfreflection:'🧘 Selbstreflexion', sandbox:'⚗️ Code Sandbox',
  skills:'🔌 Skill Editor', marketplace:'🛒 Skill Marketplace',
  imagegen:'🎨 Image Generation', video:'🎬 Video Analysis',
  rag:'🗄️ Knowledge Base (RAG)', collab:'👥 Real-time Collaboration',
  swarm:'🐝 Agent Swarms', heartbeat:'⏰ Heartbeat Tasks',
  smarthome:'🏡 Smart Home', integrations:'🔗 Integrations',
  gateway:'🔌 Gateway Event-Bus', models:'🧠 Models',
  communication:'📧 Communication', docker:'🐳 Docker & Deployment',
  monitoring:'📊 System', settings:'⚙️ Settings',
  emotionai:'🧠 Emotional AI', creativewriting:'✍️ Creative Writing',
  enhancedvision:'👁️ Enhanced Vision', timeseries:'📈 Time Series Analysis',
  integrationhub:'🔗 Integration Hub',
};

// ── Inner App Component ─────────────────────────────────────────────────────
function AppInner() {
  var e   = React.createElement;
  var ctx = useApp();
  var h   = createHelpers(ctx);
  var views = Object.assign({}, createViews(ctx, h, UI), createExtendedViews(ctx, h, UI));

  // Scroll to bottom on new messages
  React.useEffect(function(){
    if(h.messagesEndRef.current) h.messagesEndRef.current.scrollIntoView({behavior:'smooth'});
  }, [ctx.get('messages')]);

  // Heartbeat-Modus: 'full' wenn Monitoring-View aktiv, sonst 'normal'
  React.useEffect(function(){
    var mode = ctx.get('view') === 'monitoring' ? 'full' : 'normal';
    if(window.johnny) window.johnny.send('set-heartbeat-mode', mode);
  }, [ctx.get('view')]);

  // Dynamic title for chat view
  var title = ctx.get('view') === 'chat'
    ? '💬 ' + ctx.get('activeAgent')
    : (TITLES[ctx.get('view')] || '');

  // Current view renderer
  var currentView = views[ctx.get('view')] || views.chat;

  return e('div', null,
    // Setup Wizard
    ctx.get('showSetup') && e(SetupWizard, {onComplete: function(){ ctx.set('showSetup')(false); }}),

    // Security Confirmation Dialog (global, immer aktiv)
    typeof ConfirmationDialog !== 'undefined' && e(ConfirmationDialog, null),

    // Modal overlays
    ctx.get('modal') && renderModal(e, ctx, h, UI),

    // Main Layout
    e('div', {className:'app-container'},

      // ── Sidebar ──────────────────────────────────────────────────────
      e('div', {className:'sidebar'},
        e('div', {className:'sidebar-header'},
          e('div', {className:'logo'}, 'JOHNNY'),
          e('div', {className:'status-indicator'},
            e('div', {className:'status-dot'}),
            e('span', null, 'ONLINE · 24/7')
          )
        ),
        e('div', {className:'nav-section'},
          NAV_ITEMS.map(function(n){
            return e('div', {
              key: n.id,
              className: 'nav-item' + (ctx.get('view') === n.id ? ' active' : ''),
              onClick: function(){ ctx.set('view')(n.id); }
            }, n.icon + ' ' + n.label);
          })
        )
      ),

      // ── Main Content ─────────────────────────────────────────────────
      e('div', {className:'main-content'},
        // Header Bar
        e('div', {className:'header'},
          e('div', {className:'header-title'}, title),
          e('div', {style:{display:'flex',gap:'12px',alignItems:'center',fontSize:'12px',
            fontFamily:'JetBrains Mono, monospace',color:'var(--text-secondary)'}},
            ctx.get('savedMsg') && e('span', {style:{
              color: ctx.get('savedMsg').indexOf('Error')>=0 ? '#e74c3c' :
                     ctx.get('savedMsg').indexOf('active:')>=0 ? 'var(--success)' : 'var(--accent-primary)',
              fontWeight:'600',padding:'2px 10px',background:'var(--bg-tertiary)',borderRadius:'6px',fontSize:'12px'
            }}, ctx.get('savedMsg')),
            ctx.get('sysstats') && ctx.get('sysstats').cpu && e('span', null, 'CPU: '+ctx.get('sysstats').cpu.usage.toFixed(0)+'%'),
            ctx.get('sysstats') && ctx.get('sysstats').memory && e('span', null, 'MEM: '+ctx.get('sysstats').memory.percentage.toFixed(0)+'%'),
            e('span', {style:{color:'var(--accent-primary)',fontWeight:'700'}},
              'MODEL: ' + (ctx.get('activeProvider')!=='ollama' ? ctx.get('activeProvider').toUpperCase()+'/' : '') + ctx.get('activeModel'))
          )
        ),

        // Content Area (renders current view)
        e('div', {className:'content-area'}, currentView())
      ),

      // ── Toast Notifications (PRIO 3) ─────────────────────────────────
      (ctx.get('toasts')||[]).length > 0 && e('div', {style:{
        position:'fixed', bottom:'20px', right:'20px', zIndex:9999,
        display:'flex', flexDirection:'column', gap:'8px', maxWidth:'400px'
      }},
        (ctx.get('toasts')||[]).map(function(t) {
          var colors = {error:'#e74c3c',warning:'#f39c12',success:'var(--success)',info:'var(--accent-primary)'};
          var bgColors = {error:'rgba(231,76,60,0.15)',warning:'rgba(243,156,18,0.15)',success:'rgba(0,255,136,0.1)',info:'rgba(0,255,136,0.05)'};
          return e('div', {key:t.id, style:{
            padding:'10px 16px', borderRadius:'8px', fontSize:'13px',
            background: bgColors[t.type] || bgColors.info,
            border: '1px solid ' + (colors[t.type] || colors.info),
            color: colors[t.type] || colors.info,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            animation: 'slideIn 0.3s ease',
            display:'flex', justifyContent:'space-between', alignItems:'center', gap:'12px'
          }},
            e('span', null, (t.type==='error'?'✗ ':t.type==='success'?'✓ ':t.type==='warning'?'⚠ ':'ℹ ') + t.message),
            e('button', {onClick:function(){
              ctx.set('toasts')(function(prev){return (prev||[]).filter(function(x){return x.id!==t.id;});});
            }, style:{background:'none',border:'none',color:'inherit',cursor:'pointer',fontSize:'16px',flexShrink:0}}, '✕')
          );
        })
      )
    )
  );
}

// ── Modal Renderer ──────────────────────────────────────────────────────────
function renderModal(e, ctx, h, UI) {
  var modal = ctx.get('modal');
  var form  = ctx.get('form');
  var setForm = function(k,v){ ctx.set('form')(function(f){ var n=Object.assign({},f); n[k]=v; return n; }); };

  if (modal === 'agent') {
    return e(UI.DModal, {title:'Create Agent',onClose:function(){ctx.set('modal')(null);}},
      e(UI.DField, {label:'Name'}, e(UI.DInput, {value:form.name, onChange:function(v){setForm('name',v);}})),
      e(UI.DField, {label:'Role'}, e(UI.DInput, {value:form.role, onChange:function(v){setForm('role',v);}})),
      e(UI.DField, {label:'Personality'}, e(UI.DInput, {value:form.personality, onChange:function(v){setForm('personality',v);}})),
      e(UI.DField, {label:'Provider'}, e(UI.DSelect, {value:form.modelProvider, onChange:function(v){setForm('modelProvider',v);},
        options:[{value:'ollama',label:'Ollama'},{value:'openai',label:'OpenAI'},{value:'anthropic',label:'Anthropic'},{value:'google',label:'Google'},{value:'groq',label:'Groq'}]})),
      e(UI.DField, {label:'Model'}, e(UI.DSelect, {value:form.model, onChange:function(v){setForm('model',v);}, options:ctx.actions.modelOptions()})),
      e(UI.DField, {label:'Capabilities'},
        e('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap'}},
          ctx.actions.allCaps.map(function(c){ return e(UI.DChip,{key:c,label:c,active:(form.capabilities||[]).indexOf(c)>=0,onClick:function(){ctx.actions.toggleCap(c);}}); })
        )
      ),
      e(UI.DBtn, {label:'Create Agent',primary:true,onClick:h.submitAgent})
    );
  }
  if (modal === 'apikey') {
    return e(UI.DModal, {title:'API Key: '+form.providerName,onClose:function(){ctx.set('modal')(null);}},
      e(UI.DField, {label:'API Key'}, e(UI.DInput, {value:form.key, onChange:function(v){setForm('key',v);}, type:'password'})),
      e(UI.DBtn, {label:'Save Key',primary:true,onClick:h.submitApiKey})
    );
  }
  if (modal === 'skill') {
    return e(UI.DModal, {title:'Create Skill',onClose:function(){ctx.set('modal')(null);}},
      e(UI.DField, {label:'Name'}, e(UI.DInput, {value:form.name, onChange:function(v){setForm('name',v);}})),
      e(UI.DField, {label:'Description'}, e(UI.DInput, {value:form.description, onChange:function(v){setForm('description',v);}})),
      e(UI.DField, {label:'Language'}, e(UI.DSelect, {value:form.language, onChange:function(v){setForm('language',v);}, options:[{value:'javascript',label:'JavaScript'},{value:'python',label:'Python'}]})),
      e(UI.DBtn, {label:'Create',primary:true,onClick:h.submitSkill})
    );
  }
  if (modal === 'email') {
    return e(UI.DModal, {title:'Add Email Account',onClose:function(){ctx.set('modal')(null);}},
      e(UI.DField, {label:'Display Name'}, e(UI.DInput, {value:form.displayName, onChange:function(v){setForm('displayName',v);}})),
      e(UI.DField, {label:'Email'}, e(UI.DInput, {value:form.email, onChange:function(v){setForm('email',v);}})),
      e(UI.DField, {label:'Password'}, e(UI.DInput, {value:form.password, onChange:function(v){setForm('password',v);}, type:'password'})),
      e(UI.DField, {label:'IMAP Host'}, e(UI.DInput, {value:form.imapHost, onChange:function(v){setForm('imapHost',v);}})),
      e(UI.DField, {label:'SMTP Host'}, e(UI.DInput, {value:form.smtpHost, onChange:function(v){setForm('smtpHost',v);}})),
      e(UI.DBtn, {label:'Add Account',primary:true,onClick:h.submitEmail})
    );
  }
  if (modal === 'messenger') {
    return e(UI.DModal, {title:'Connect '+form.type,onClose:function(){ctx.set('modal')(null);},width:'550px'},
      form.type==='telegram' && e(UI.DField,{label:'Bot Token'},e(UI.DInput,{value:form.token,onChange:function(v){setForm('token',v);}})),
      form.type==='discord'  && e(UI.DField,{label:'Bot Token'},e(UI.DInput,{value:form.token,onChange:function(v){setForm('token',v);}})),
      form.type==='whatsapp' && e(UI.DField,{label:'Session Name'},e(UI.DInput,{value:form.sessionName||'johnny-whatsapp',onChange:function(v){setForm('sessionName',v);}})),
      form.type==='signal'   && e(UI.DField,{label:'Phone Number'},e(UI.DInput,{value:form.phoneNumber,onChange:function(v){setForm('phoneNumber',v);}})),
      form.type==='slack'    && e('div',null,
        e(UI.DField,{label:'Bot Token'},e(UI.DInput,{value:form.botToken,onChange:function(v){setForm('botToken',v);}})),
        e(UI.DField,{label:'App Token'},e(UI.DInput,{value:form.appToken,onChange:function(v){setForm('appToken',v);}}))),
      form.type==='matrix'   && e('div',null,
        e(UI.DField,{label:'Homeserver'},e(UI.DInput,{value:form.homeserver,onChange:function(v){setForm('homeserver',v);}})),
        e(UI.DField,{label:'User ID'},e(UI.DInput,{value:form.userId,onChange:function(v){setForm('userId',v);}})),
        e(UI.DField,{label:'Password'},e(UI.DInput,{value:form.password,onChange:function(v){setForm('password',v);},type:'password'}))),
      e(UI.DBtn, {label:'Connect',primary:true,onClick:h.submitMessenger})
    );
  }
  return null;
}

// ── Root Component (wraps AppInner with Provider) ───────────────────────────
function App() {
  return React.createElement(AppProvider, null, React.createElement(AppInner, null));
}

// ── Mount ───────────────────────────────────────────────────────────────────
(function() {
  try {
    var rootEl = document.getElementById('root');
    var createRoot = window.ReactDOM.createRoot;
    var reactRoot = createRoot(rootEl);
    reactRoot.render(React.createElement(App, null));
    console.log('[Johnny] App mounted (modular architecture)');
    // Splash ausblenden sobald App gerendert ist
    var splash = document.getElementById('splash');
    if (splash) {
      splash.style.transition = 'opacity 0.4s ease';
      splash.style.opacity = '0';
      setTimeout(function() { splash.remove(); }, 450);
    }
  } catch(err) {
    // Splash entfernen damit der Fehler sichtbar wird
    var splash = document.getElementById('splash');
    if (splash) splash.remove();
    document.getElementById('root').innerHTML =
      '<div style="padding:40px;font-family:monospace;color:#fff;background:#0a0a0a">' +
      '<h2 style="color:#e74c3c">Mount Error</h2>' +
      '<pre style="color:#aaa;font-size:12px">' + err.message + '\n' + err.stack + '</pre></div>';
  }
})();
