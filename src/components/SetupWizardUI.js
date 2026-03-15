// ═══════════════════════════════════════════════════════════════════════════
// JOHNNY SETUP WIZARD — Interaktive Provider/Modell-Auswahl
// Läuft als reines React.createElement (kein JSX/Babel nötig)
// IPC: setup-status (main→renderer), setup-choice (renderer→main)
// ═══════════════════════════════════════════════════════════════════════════

function SetupWizard({ onComplete }) {
  var e = React.createElement;

  // ── State ────────────────────────────────────────────────────────────────
  var _step     = React.useState('loading');
  var _prog     = React.useState(0);
  var _msg      = React.useState('Johnny wird gestartet...');
  var _ui       = React.useState(null);
  var _apiKey   = React.useState('');
  var _customUrl= React.useState('http://localhost:1234/v1');
  var _selModel = React.useState('');
  var _dlModel  = React.useState('');
  var _showKey  = React.useState(false);
  var _provInfo = React.useState(null); // selected provider info

  var step      = _step[0],      setStep      = _step[1];
  var prog      = _prog[0],      setProg      = _prog[1];
  var msg       = _msg[0],       setMsg       = _msg[1];
  var ui        = _ui[0],        setUi        = _ui[1];
  var apiKey    = _apiKey[0],    setApiKey    = _apiKey[1];
  var customUrl = _customUrl[0], setCustomUrl = _customUrl[1];
  var selModel  = _selModel[0],  setSelModel  = _selModel[1];
  var dlModel   = _dlModel[0],   setDlModel   = _dlModel[1];
  var showKey   = _showKey[0],   setShowKey   = _showKey[1];
  var provInfo  = _provInfo[0],  setProvInfo  = _provInfo[1];

  // ── IPC Listener ─────────────────────────────────────────────────────────
  React.useEffect(function() {
    // FIX: preload.js strips event object — callback receives (data) directly
    function handler(d) {
      if (!d) return;
      setStep(d.step || 'loading');
      setMsg(d.message || '');
      setProg(d.progress || 0);
      if (d.ui) setUi(d.ui);
      if (['complete','model-skipped','ollama-failed'].indexOf(d.step) >= 0) {
        setTimeout(function() { if (onComplete) onComplete(); }, 1400);
      }
    }
    (window.johnny || window.ipcRenderer).on('setup-status', handler);
    return function() { (window.johnny || window.ipcRenderer).removeAllListeners('setup-status'); };
  }, []);

  // ── Antwort senden ───────────────────────────────────────────────────────
  function sendChoice(data) {
    (window.johnny || window.ipcRenderer).send('setup-choice', data);
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  var colors = { bg:'#0d0d0d', card:'#141414', border:'#1e1e1e', accent:'#00ff88',
    accentDim:'rgba(0,255,136,0.12)', text:'#e8e8e8', sub:'#888', danger:'#e74c3c',
    warn:'#f39c12', blue:'#3498db' };

  var sOverlay = { position:'fixed',top:0,left:0,width:'100vw',height:'100vh',
    background:colors.bg, display:'flex',alignItems:'center',justifyContent:'center',
    zIndex:10000, fontFamily:"'JetBrains Mono', 'Consolas', monospace" };

  var sCard = { background:colors.card, border:'1px solid '+colors.border,
    borderRadius:'16px', padding:'36px 40px', width:'560px', maxWidth:'92vw',
    maxHeight:'88vh', overflowY:'auto' };

  var sInput = { width:'100%', background:'#1a1a1a', border:'1px solid #2a2a2a',
    borderRadius:'8px', padding:'10px 14px', color:colors.text, fontSize:'14px',
    fontFamily:'inherit', outline:'none', boxSizing:'border-box', marginTop:'6px' };

  var sBtnPrimary = { background:colors.accent, color:'#000', border:'none',
    borderRadius:'8px', padding:'12px 28px', fontSize:'14px', fontWeight:'700',
    cursor:'pointer', width:'100%', marginTop:'8px' };

  var sBtnSecondary = { background:'transparent', color:colors.sub, border:'1px solid #2a2a2a',
    borderRadius:'8px', padding:'10px 20px', fontSize:'13px', cursor:'pointer',
    width:'100%', marginTop:'6px' };

  // ── Progress Bar ─────────────────────────────────────────────────────────
  function ProgressBar() {
    return e('div', { style:{marginBottom:'24px'} },
      e('div', { style:{background:'#1a1a1a', borderRadius:'99px', height:'5px', overflow:'hidden'} },
        e('div', { style:{width:prog+'%', height:'100%',
          background:'linear-gradient(90deg,'+colors.accent+',#00ccff)',
          transition:'width 0.5s ease', borderRadius:'99px'} })
      ),
      e('div', { style:{display:'flex',justifyContent:'space-between',marginTop:'6px',
        fontSize:'11px',color:colors.sub} },
        e('span', null, msg),
        e('span', null, prog+'%')
      )
    );
  }

  // ── Header ───────────────────────────────────────────────────────────────
  function Header({ subtitle }) {
    return e('div', { style:{textAlign:'center',marginBottom:'28px'} },
      e('div', { style:{fontSize:'52px',marginBottom:'12px'} }, '🤖'),
      e('h1', { style:{color:colors.text,margin:'0 0 4px',fontSize:'26px',letterSpacing:'2px'} }, 'JOHNNY AI'),
      subtitle && e('div', { style:{color:colors.sub,fontSize:'12px',letterSpacing:'1px'} }, subtitle)
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHRITT: LADE-SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if (step === 'loading' || step === 'welcome') {
    return e('div', { style:sOverlay },
      e('div', { style:Object.assign({},sCard,{textAlign:'center'}) },
        Header({ subtitle:'ERSTSTART — EINRICHTUNG' }),
        ProgressBar(),
        e('div', { style:{color:colors.sub, fontSize:'13px'} }, 'Initialisiere...')
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHRITT: PROVIDER AUSWÄHLEN
  // ══════════════════════════════════════════════════════════════════════════
  if (step === 'choose-provider' && ui && ui.type === 'provider-select') {
    var providers = ui.providers || [];

    function selectProvider(prov) {
      setProvInfo(prov);
      setApiKey('');
      setCustomUrl('http://localhost:1234/v1');
    }

    function confirm() {
      if (!provInfo) return;
      var data = { provider: provInfo.id };
      if (provInfo.needsKey && apiKey.trim()) data.apiKey = apiKey.trim();
      if (provInfo.needsUrl) data.customUrl = customUrl.trim();
      sendChoice(data);
      setUi(null);
    }

    return e('div', { style:sOverlay },
      e('div', { style:sCard },
        Header({ subtitle:'SCHRITT 1 VON 2 — PROVIDER' }),
        ProgressBar(),
        e('h2', { style:{color:colors.text,margin:'0 0 6px',fontSize:'16px'} }, 'Welchen AI-Provider möchtest du verwenden?'),
        e('p', { style:{color:colors.sub,fontSize:'12px',margin:'0 0 20px'} }, 'Du kannst dies jederzeit in den Einstellungen ändern.'),

        // Provider Grid
        e('div', { style:{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'20px'} },
          providers.map(function(prov) {
            var isSelected = provInfo && provInfo.id === prov.id;
            return e('div', {
              key: prov.id,
              onClick: function() { selectProvider(prov); },
              style: {
                background: isSelected ? colors.accentDim : '#1a1a1a',
                border: '1px solid ' + (isSelected ? colors.accent : '#2a2a2a'),
                borderRadius: '10px', padding: '12px 14px', cursor: 'pointer',
                transition: 'all 0.15s'
              }
            },
              e('div', { style:{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px'} },
                e('span', { style:{fontSize:'20px'} }, prov.icon),
                e('span', { style:{color:colors.text,fontSize:'13px',fontWeight:'600'} }, prov.name)
              ),
              e('div', { style:{color:colors.sub,fontSize:'11px',lineHeight:'1.4'} }, prov.desc),
              prov.recommended && e('div', { style:{color:colors.accent,fontSize:'10px',marginTop:'4px',fontWeight:'700'} }, '⭐ EMPFOHLEN')
            );
          })
        ),

        // API Key Input (wenn nötig)
        provInfo && provInfo.needsKey && e('div', { style:{marginBottom:'16px'} },
          e('label', { style:{color:colors.sub,fontSize:'12px',letterSpacing:'0.5px'} }, 'API-KEY'),
          e('div', { style:{position:'relative'} },
            e('input', {
              type: showKey ? 'text' : 'password',
              value: apiKey,
              onChange: function(ev) { setApiKey(ev.target.value); },
              placeholder: provInfo.placeholder || 'Dein API-Key...',
              style: Object.assign({}, sInput, {paddingRight:'80px'})
            }),
            e('button', {
              onClick: function() { setShowKey(!showKey); },
              style:{position:'absolute',right:'8px',top:'50%',transform:'translateY(-50%)',
                background:'none',border:'none',color:colors.sub,cursor:'pointer',fontSize:'11px'}
            }, showKey ? '🙈 verbergen' : '👁 zeigen')
          ),
          e('div', { style:{color:colors.sub,fontSize:'11px',marginTop:'4px'} },
            provInfo.id === 'openai' ? '→ platform.openai.com/api-keys' :
            provInfo.id === 'anthropic' ? '→ console.anthropic.com/keys' :
            provInfo.id === 'google' ? '→ aistudio.google.com/app/apikey' :
            provInfo.id === 'groq' ? '→ console.groq.com (kostenloser Tier!)' :
            provInfo.id === 'mistral' ? '→ console.mistral.ai/api-keys' : ''
          )
        ),

        // Custom URL Input
        provInfo && provInfo.needsUrl && e('div', { style:{marginBottom:'16px'} },
          e('label', { style:{color:colors.sub,fontSize:'12px',letterSpacing:'0.5px'} }, 'API-URL (OpenAI-kompatibel)'),
          e('input', {
            type:'text', value:customUrl,
            onChange: function(ev) { setCustomUrl(ev.target.value); },
            placeholder:'http://localhost:1234/v1',
            style:sInput
          }),
          e('div', { style:{color:colors.sub,fontSize:'11px',marginTop:'4px'} }, 'z.B. LM Studio: http://localhost:1234/v1 | Oobabooga: http://localhost:5000/v1')
        ),

        // Ollama Info
        provInfo && provInfo.id === 'ollama' && e('div', {
          style:{background:'rgba(0,255,136,0.07)',border:'1px solid rgba(0,255,136,0.2)',
            borderRadius:'8px',padding:'12px',marginBottom:'16px',fontSize:'12px',color:colors.sub}
        },
          e('div', { style:{color:colors.accent,fontWeight:'700',marginBottom:'4px'} }, '✓ Kein API-Key nötig!'),
          'Ollama läuft lokal auf deinem PC. Falls noch nicht installiert: ollama.com'
        ),

        // Confirm Button
        e('button', {
          onClick: confirm,
          disabled: !provInfo || (provInfo.needsKey && !apiKey.trim() && provInfo.id !== 'ollama'),
          style: Object.assign({}, sBtnPrimary, {
            opacity: (!provInfo || (provInfo.needsKey && !apiKey.trim())) ? 0.4 : 1,
            cursor: (!provInfo || (provInfo.needsKey && !apiKey.trim())) ? 'not-allowed' : 'pointer'
          })
        }, provInfo ? ('Weiter mit ' + provInfo.name + ' →') : 'Provider auswählen...')
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHRITT: MODELL AUSWÄHLEN (Ollama — vorhandene Modelle)
  // ══════════════════════════════════════════════════════════════════════════
  if (step === 'choose-model' && ui && ui.type === 'model-select') {
    var models = ui.models || [];
    var recommended = ui.recommended || models[0];
    var currentSel = selModel || recommended;

    function confirmModel() {
      sendChoice({ model: currentSel });
      setUi(null);
    }

    return e('div', { style:sOverlay },
      e('div', { style:sCard },
        Header({ subtitle:'SCHRITT 2 VON 2 — MODELL' }),
        ProgressBar(),
        e('h2', { style:{color:colors.text,margin:'0 0 6px',fontSize:'16px'} }, 'Welches Modell soll Johnny nutzen?'),
        e('div', { style:{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'20px',maxHeight:'300px',overflowY:'auto'} },
          models.map(function(m) {
            var isSel = (selModel||recommended) === m;
            var isRec = m === recommended;
            return e('div', {
              key:m, onClick: function(){ setSelModel(m); },
              style:{
                background: isSel ? colors.accentDim : '#1a1a1a',
                border:'1px solid '+(isSel?colors.accent:'#2a2a2a'),
                borderRadius:'8px', padding:'10px 14px', cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'space-between'
              }
            },
              e('span', { style:{color:colors.text,fontSize:'13px',fontFamily:'monospace'} }, m),
              isRec && e('span', { style:{color:colors.accent,fontSize:'10px',fontWeight:'700'} }, '⭐ EMPFOHLEN')
            );
          })
        ),
        e('button', { onClick:confirmModel, style:sBtnPrimary }, '✓ ' + (selModel||recommended) + ' verwenden')
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHRITT: CLOUD MODELL AUSWÄHLEN
  // ══════════════════════════════════════════════════════════════════════════
  if (step === 'choose-cloud-model' && ui && ui.type === 'model-select') {
    var cModels = ui.models || [];
    var cRec = ui.recommended || cModels[0];
    var cSel = selModel || cRec;

    return e('div', { style:sOverlay },
      e('div', { style:sCard },
        Header({ subtitle:'SCHRITT 2 VON 2 — MODELL' }),
        ProgressBar(),
        e('h2', { style:{color:colors.text,margin:'0 0 20px',fontSize:'16px'} }, 'Welches Modell verwenden?'),
        e('div', { style:{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'20px'} },
          cModels.map(function(m) {
            var isSel = cSel === m;
            var isRec = m === cRec;
            return e('div', {
              key:m, onClick: function(){ setSelModel(m); },
              style:{
                background:isSel?colors.accentDim:'#1a1a1a',
                border:'1px solid '+(isSel?colors.accent:'#2a2a2a'),
                borderRadius:'8px', padding:'10px 14px', cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'space-between'
              }
            },
              e('span', { style:{color:colors.text,fontSize:'13px',fontFamily:'monospace'} }, m),
              isRec && e('span', { style:{color:colors.accent,fontSize:'10px',fontWeight:'700'} }, '⭐ EMPFOHLEN')
            );
          })
        ),
        e('button', {
          onClick: function(){ sendChoice({model:cSel}); setUi(null); },
          style:sBtnPrimary
        }, '✓ ' + cSel + ' verwenden')
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHRITT: KEIN MODELL GEFUNDEN — HERUNTERLADEN
  // ══════════════════════════════════════════════════════════════════════════
  if (step === 'no-models' && ui && ui.type === 'download-model') {
    var suggestions = ui.suggestions || [];
    var selDl = dlModel || suggestions[1] && suggestions[1].id; // default: 2nd = gemma2:9b

    return e('div', { style:sOverlay },
      e('div', { style:sCard },
        Header({ subtitle:'OLLAMA — KEIN MODELL GEFUNDEN' }),
        ProgressBar(),
        e('div', { style:{background:'rgba(243,156,18,0.1)',border:'1px solid rgba(243,156,18,0.3)',
          borderRadius:'8px',padding:'12px',marginBottom:'20px',fontSize:'12px',color:colors.warn} },
          '⚠ Keine Modelle in Ollama gefunden. Lade jetzt eines herunter oder überspringe.'
        ),
        e('h3', { style:{color:colors.text,margin:'0 0 12px',fontSize:'14px'} }, 'Modell herunterladen:'),
        e('div', { style:{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'20px'} },
          suggestions.map(function(s) {
            if (s.id === 'skip') return null;
            var isSel = (dlModel||suggestions[1].id) === s.id;
            return e('div', {
              key:s.id, onClick:function(){setDlModel(s.id);},
              style:{
                background:isSel?colors.accentDim:'#1a1a1a',
                border:'1px solid '+(isSel?colors.accent:'#2a2a2a'),
                borderRadius:'8px',padding:'12px 14px',cursor:'pointer'
              }
            },
              e('div', { style:{display:'flex',justifyContent:'space-between',alignItems:'center'} },
                e('span', { style:{color:colors.text,fontSize:'13px',fontFamily:'monospace'} }, s.id),
                e('span', { style:{color:colors.sub,fontSize:'11px'} }, s.size)
              ),
              e('div', { style:{color:colors.sub,fontSize:'11px',marginTop:'3px'} }, s.desc)
            );
          })
        ),
        e('button', {
          onClick:function(){sendChoice({model: dlModel||suggestions[1].id}); setUi(null);},
          style:sBtnPrimary
        }, '⬇ ' + (dlModel||suggestions[1] && suggestions[1].id) + ' herunterladen'),
        e('button', {
          onClick:function(){sendChoice({model:'skip'}); setUi(null);},
          style:sBtnSecondary
        }, 'Überspringen — später im Models-Tab installieren')
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHRITT: DOWNLOAD LÄUFT
  // ══════════════════════════════════════════════════════════════════════════
  if (step === 'downloading') {
    return e('div', { style:sOverlay },
      e('div', { style:Object.assign({},sCard,{textAlign:'center'}) },
        Header({ subtitle:'MODELL WIRD GELADEN' }),
        ProgressBar(),
        e('div', { style:{fontSize:'36px',marginBottom:'12px'} }, '⬇'),
        e('div', { style:{color:colors.sub,fontSize:'12px'} }, 'Bitte warten — Download läuft...')
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHRITT: FERTIG
  // ══════════════════════════════════════════════════════════════════════════
  if (step === 'complete' || step === 'finalizing') {
    var doneInfo = ui || {};
    return e('div', { style:sOverlay },
      e('div', { style:Object.assign({},sCard,{textAlign:'center'}) },
        Header({ subtitle:'EINRICHTUNG ABGESCHLOSSEN' }),
        ProgressBar(),
        e('div', { style:{fontSize:'48px',marginBottom:'16px'} }, '✅'),
        e('h2', { style:{color:colors.accent,marginBottom:'8px'} }, 'Johnny ist bereit!'),
        doneInfo.provider && e('div', { style:{color:colors.sub,fontSize:'13px'} },
          'Provider: ' + doneInfo.provider + ' | Modell: ' + doneInfo.model
        )
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHRITT: PRÜFE OLLAMA
  // ══════════════════════════════════════════════════════════════════════════
  // Fallback: generischer Ladescreen
  return e('div', { style:sOverlay },
    e('div', { style:Object.assign({},sCard,{textAlign:'center'}) },
      Header({ subtitle:step.toUpperCase() }),
      ProgressBar(),
      e('div', { style:{color:colors.sub,fontSize:'13px'} }, msg)
    )
  );
}
