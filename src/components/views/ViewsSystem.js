'use strict';
function createSystemViews(ctx, h, UI) {
  var e = React.createElement;
  var S = { input: { width:'100%', background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:'8px', padding:'9px 12px', color:'var(--text-primary)', fontSize:'14px', fontFamily:'inherit', outline:'none', boxSizing:'border-box' } };

function viewCommunication(){
    var messengers = ctx.get('messengers');
    return e('div',null,
      e('h2',{style:{marginBottom:'20px'}},'Communication'),
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}},
        e('h3',{style:{margin:0}},'Messengers'),
        e('button',{className:'btn btn-primary',onClick:function(){h.openMessenger('telegram');}},'+ Connect')
      ),
      // WhatsApp QR Code (fix: shown inline in UI, not just console)
      ctx.get('whatsappQR') && e('div',{style:{background:'rgba(37,211,102,0.1)',border:'1px solid rgba(37,211,102,0.4)',borderRadius:'12px',padding:'20px',marginBottom:'16px',textAlign:'center'}},
        e('div',{style:{fontWeight:'700',marginBottom:'8px',color:'#25D366'}},'WhatsApp — Scan QR Code'),
        e('div',{style:{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'12px'}},'Open WhatsApp on your phone → Linked Devices → Link a Device'),
        e('pre',{style:{display:'inline-block',background:'#fff',color:'#000',padding:'16px',borderRadius:'8px',fontFamily:'monospace',fontSize:'10px',lineHeight:'1.2',letterSpacing:'0'}},ctx.get('whatsappQR')),
        e('div',{style:{marginTop:'10px',fontSize:'12px',color:'var(--text-secondary)'}},'QR code expires in 60 seconds')
      ),
      ctx.get('whatsappReady') && e('div',{style:{background:'rgba(37,211,102,0.1)',border:'1px solid #25D366',borderRadius:'8px',padding:'10px 16px',marginBottom:'16px',color:'#25D366',fontWeight:'600'}},
        'WhatsApp connected!'),
      e('div',{className:'stats-grid',style:{marginBottom:'28px'}},
        ['telegram','whatsapp','discord','signal','slack','matrix'].map(function(name){
          var connected = Array.isArray(messengers) && messengers.some(function(m){return m.messenger===name||m.type===name;});
          var isWA = name==='whatsapp';
          var showQR = isWA && !connected && !ctx.get('whatsappReady');
          return e('div',{key:name,className:'stat-card'},
            e('div',{className:'stat-label'},name.toUpperCase()),
            e('div',{style:{marginTop:'8px',fontSize:'14px',fontWeight:'600',color:connected||ctx.get('whatsappReady')&&isWA?'var(--success)':'var(--text-secondary)'}},
              (connected||(isWA&&ctx.get('whatsappReady')))?'● Connected':'○ Not connected'),
            isWA && ctx.get('whatsappQR') && e('div',{style:{fontSize:'11px',color:'#25D366',marginTop:'4px'}},'QR ready — scan now'),
            e('div',{style:{marginTop:'12px'}},
              (connected||(isWA&&ctx.get('whatsappReady')))
                ? e('button',{className:'btn',style:{padding:'6px 14px',fontSize:'12px',borderColor:'#e74c3c',color:'#e74c3c'},onClick:function(){h.disconnectMessenger(name);}},'Disconnect')
                : e('button',{className:'btn',style:{padding:'6px 14px',fontSize:'12px'},onClick:function(){h.openMessenger(name);}},
                    isWA&&ctx.get('whatsappQR')?'Reconnect':'Configure')
            )
          );
        })
      ),
      e('h3',{style:{marginBottom:'14px'}},'Cloudflare Tunnel'),
      e('div',{className:'agent-card',style:{marginBottom:'28px'}},
        e('div',{style:{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'14px'}},'Create a public HTTPS URL — no Cloudflare account needed.'),
        e('div',{style:{display:'flex',gap:'10px',alignItems:'flex-end',flexWrap:'wrap'}},
          e('div',null,
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginBottom:'5px',textTransform:'uppercase'}},'Port'),
            e('input',{type:'text',value:ctx.get('tunnelPort'),onChange:function(ev){ctx.set('tunnelPort')(ev.target.value);},
              style:Object.assign({},S.input,{width:'90px'})})
          ),
          e('div',{style:{display:'flex',gap:'8px'}},
            !ctx.get('tunnelRunning')
              ? e('button',{className:'btn btn-primary',onClick:h.startTunnel,style:{padding:'9px 18px'}},'Start Tunnel')
              : e('button',{className:'btn',onClick:h.stopTunnel,style:{padding:'9px 18px',borderColor:'#e74c3c',color:'#e74c3c'}},'Stop Tunnel'),
            e('button',{className:'btn',onClick:h.installCloudflared,style:{padding:'9px 14px',fontSize:'12px'}},'Install cloudflared')
          )
        ),
        ctx.get('tunnelMsg') && e('div',{style:{marginTop:'10px',fontSize:'13px',color:ctx.get('tunnelMsg').indexOf('Error')>=0?'#e74c3c':'var(--success)'}},ctx.get('tunnelMsg')),
        ctx.get('tunnelUrl') && e('div',{style:{marginTop:'10px',padding:'10px 14px',background:'var(--bg-primary)',borderRadius:'8px',display:'flex',alignItems:'center',gap:'12px'}},
          e('span',{style:{fontFamily:'JetBrains Mono, monospace',fontSize:'13px',color:'var(--accent-primary)',flex:1}},ctx.get('tunnelUrl')),
          e('button',{className:'btn',style:{padding:'5px 12px',fontSize:'12px'},onClick:function(){ctx.inv('set-clipboard-text',ctx.get('tunnelUrl'));}},'Copy')
        ),
        e('div',{style:{marginTop:'8px',fontSize:'11px',color:'var(--text-secondary)'}},'Needs cloudflared installed. Get it at developers.cloudflare.com')
      ),
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}},
        e('h3',{style:{margin:0}},'Email Accounts ('+ctx.get('emails').length+')'),
        e('button',{className:'btn btn-primary',onClick:h.openEmail},'+ Add Email')
      ),
      ctx.get('emails').length===0
        ? e('p',{style:{color:'var(--text-secondary)'}},'No email accounts configured.')
        : ctx.get('emails').map(function(a){ return e('div',{key:a.id,className:'agent-card'},e('div',{className:'agent-name'},a.displayName),e('div',{className:'agent-role'},a.email)); }),
    );
  }

function viewMonitoring(){
    function refreshFull(){
      ctx.inv('get-system-stats').then(function(v){ if(v) ctx.set('sysstats')(v); });
    }
    var stats = ctx.get('sysstats');
    var cpu   = stats ? (stats.cpu||{usage:0,cores:0}) : {usage:0,cores:0};
    var mem   = stats ? (stats.memory||{percentage:0,used:0,total:0}) : {percentage:0,used:0,total:0};
    var disk  = stats ? (stats.disk||[]) : [];
    var net   = stats ? (stats.network||[]) : [];
    var procs = stats ? (stats.processes||{all:0,running:0,list:[]}) : {all:0,running:0,list:[]};
    var johnnyProcs = (procs.list||[]).filter(function(p){
      var n = (p.name||'').toLowerCase();
      return n.indexOf('electron')>=0 || n.indexOf('johnny')>=0 || n.indexOf('node')>=0 ||
        n.indexOf('ollama')>=0 || n.indexOf('chromadb')>=0 || n.indexOf('chroma')>=0 ||
        n.indexOf('python')>=0 || n.indexOf('whisper')>=0 || n.indexOf('ffmpeg')>=0 ||
        n.indexOf('puppeteer')>=0 || n.indexOf('chrome')>=0 || n.indexOf('cloudflared')>=0 ||
        n.indexOf('docker')>=0 || n.indexOf('signal-cli')>=0;
    });
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',{style:{margin:0}},'📊 System Monitoring'),
        e(UI.DBtn,{label:'↻ Aktualisieren',small:true,onClick:refreshFull})
      ),
      !stats && e('div',{style:{textAlign:'center',padding:'40px',color:'var(--text-secondary)'}},
        e('div',{className:'loading'}),
        e('div',{style:{marginTop:'12px'}},'Lade System-Daten...')
      ),
      stats && e('div',null,
        // CPU + Memory + Processes
        e('div',{className:'stats-grid',style:{marginBottom:'24px'}},
          e('div',{className:'stat-card'},
            e('div',{className:'stat-label'},'CPU'),
            e('div',{className:'stat-value'},cpu.usage.toFixed(1),e('span',{className:'stat-suffix'},'%')),
            e('div',{style:{marginTop:'8px',height:'6px',borderRadius:'3px',background:'var(--bg-primary)',overflow:'hidden'}},
              e('div',{style:{width:cpu.usage.toFixed(0)+'%',height:'100%',background:cpu.usage>80?'#e74c3c':cpu.usage>50?'var(--warning)':'var(--success)',transition:'width 0.5s'}})),
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},cpu.cores+' Kerne')
          ),
          e('div',{className:'stat-card'},
            e('div',{className:'stat-label'},'Memory'),
            e('div',{className:'stat-value'},mem.percentage.toFixed(1),e('span',{className:'stat-suffix'},'%')),
            e('div',{style:{marginTop:'8px',height:'6px',borderRadius:'3px',background:'var(--bg-primary)',overflow:'hidden'}},
              e('div',{style:{width:mem.percentage.toFixed(0)+'%',height:'100%',background:mem.percentage>85?'#e74c3c':mem.percentage>60?'var(--warning)':'var(--success)',transition:'width 0.5s'}})),
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},(mem.used/1073741824).toFixed(1)+'/'+(mem.total/1073741824).toFixed(1)+' GB')
          ),
          e('div',{className:'stat-card'},
            e('div',{className:'stat-label'},'Prozesse'),
            e('div',{className:'stat-value'},procs.all||0),
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'6px'}},(procs.running||0)+' aktiv')
          ),
          e('div',{className:'stat-card'},
            e('div',{className:'stat-label'},'Agents / Skills'),
            e('div',{className:'stat-value',style:{fontSize:'28px'}},ctx.get('agents').length,e('span',{className:'stat-suffix'},' / '+ctx.get('skills').length))
          )
        ),

        // Disk
        disk.length>0 && e('div',{style:{marginBottom:'20px'}},
          e('h3',{style:{marginBottom:'12px',fontSize:'14px'}},'💾 Festplatten'),
          e('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:'8px'}},
            disk.map(function(d,i){
              var pct = d.percentage||0;
              return e('div',{key:i,style:{background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'8px',padding:'12px'}},
                e('div',{style:{display:'flex',justifyContent:'space-between',marginBottom:'6px',fontSize:'13px'}},
                  e('span',{style:{fontFamily:'JetBrains Mono, monospace',fontWeight:'600'}},d.mount),
                  e('span',{style:{color:'var(--text-secondary)'}},(pct).toFixed(0)+'% belegt')
                ),
                e('div',{style:{height:'6px',borderRadius:'3px',background:'var(--bg-primary)',overflow:'hidden',marginBottom:'6px'}},
                  e('div',{style:{width:pct+'%',height:'100%',background:pct>90?'#e74c3c':pct>70?'var(--warning)':'var(--accent-primary)'}})),
                e('div',{style:{fontSize:'11px',color:'var(--text-secondary)'}},
                  ((d.used||0)/1073741824).toFixed(1)+' / '+((d.total||0)/1073741824).toFixed(1)+' GB')
              );
            })
          )
        ),

        // Network
        net.filter(function(n){return n.rx>0||n.tx>0;}).length>0 && e('div',{style:{marginBottom:'20px'}},
          e('h3',{style:{marginBottom:'12px',fontSize:'14px'}},'🌐 Netzwerk'),
          e('div',{style:{display:'flex',gap:'8px',flexWrap:'wrap'}},
            net.filter(function(n){return n.rx>0||n.tx>0;}).map(function(n,i){
              return e('div',{key:i,style:{background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'8px',padding:'10px 14px'}},
                e('div',{style:{fontWeight:'600',fontSize:'12px',marginBottom:'4px',fontFamily:'JetBrains Mono, monospace'}},n.interface||n.iface),
                e('div',{style:{fontSize:'12px',color:'var(--text-secondary)'}},
                  '↓ '+((n.rx||0)/1024).toFixed(1)+' KB/s  ↑ '+((n.tx||0)/1024).toFixed(1)+' KB/s')
              );
            })
          )
        ),

        // Johnny-Prozesse
        e('div',null,
          e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}},
            e('h3',{style:{fontSize:'14px',margin:0}},'🔧 Johnny-Prozesse ('+johnnyProcs.length+')'),
            johnnyProcs.length===0 && e('span',{style:{fontSize:'12px',color:'var(--text-secondary)'}},
              'Keine johnny-spezifischen Prozesse — klicke Aktualisieren')
          ),
          johnnyProcs.length>0 && e('div',{style:{background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'12px',overflow:'hidden'}},
            e('div',{style:{display:'grid',gridTemplateColumns:'1fr 80px 80px 80px',padding:'10px 16px',background:'var(--bg-tertiary)',fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace',textTransform:'uppercase'}},
              e('span',null,'Process'),e('span',{style:{textAlign:'right'}},'PID'),e('span',{style:{textAlign:'right'}},'CPU'),e('span',{style:{textAlign:'right'}},'MEM')),
            johnnyProcs.map(function(p){
              return e('div',{key:p.pid,style:{display:'grid',gridTemplateColumns:'1fr 80px 80px 80px',padding:'9px 16px',borderBottom:'1px solid var(--border-color)',alignItems:'center'}},
                e('div',null,
                  e('div',{style:{fontWeight:'600',fontSize:'13px'}},p.name),
                  p.path&&e('div',{style:{fontSize:'10px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'300px'}},p.path)
                ),
                e('div',{style:{textAlign:'right',fontFamily:'JetBrains Mono, monospace',fontSize:'12px',color:'var(--text-secondary)'}},p.pid),
                e('div',{style:{textAlign:'right',fontFamily:'JetBrains Mono, monospace',fontSize:'13px',color:p.cpu>50?'#e74c3c':p.cpu>20?'var(--warning)':'var(--text-primary)'}},(p.cpu||0).toFixed(1)+'%'),
                e('div',{style:{textAlign:'right',fontFamily:'JetBrains Mono, monospace',fontSize:'13px',color:'var(--text-secondary)'}},(p.mem||0).toFixed(1)+'%')
              );
            })
          )
        )
      )
    );
  }

function viewCollaboration(){
    var port = ctx.get('collabPort')||9090;

    function startCollab(){
      ctx.set('collabMsg')('Startet...');
      ctx.inv('start-collaboration').then(function(r){
        if(r&&r.success){ ctx.set('collabRunning')(true); ctx.set('collabPort')(r.port||9090); ctx.set('collabMsg')(''); }
        else ctx.set('collabMsg')('Fehler: '+(r&&r.error||'unbekannt'));
      });
    }
    function stopCollab(){
      ctx.inv('stop-collaboration').then(function(){
        ctx.set('collabRunning')(false);
        ctx.set('collabMsg')('Gestoppt');
        setTimeout(function(){ctx.set('collabMsg')('');},2000);
      });
    }
    function refreshRooms(){
      ctx.inv('get-collaboration-rooms').then(function(v){ if(v) ctx.set('collabRooms')(v); });
      ctx.inv('get-collaboration-status').then(function(v){
        if(v){ ctx.set('collabRunning')(v.running); ctx.set('collabClients')(v.clients||0); ctx.set('collabRooms')(v.rooms||[]); if(v.port) ctx.set('collabPort')(v.port); }
      });
    }
    function startTunnel(){
      ctx.set('collabMsg')('Tunnel startet...');
      ctx.inv('start-cloudflare-tunnel',{port:port,protocol:'http'}).then(function(r){
        if(r&&r.url){ ctx.set('collabTunnelUrl')(r.url); ctx.set('collabMsg')('✓ Öffentlich erreichbar'); }
        else ctx.set('collabMsg')('Tunnel fehlgeschlagen — cloudflared installiert?');
      });
    }
    function copyText(text, label){
      ctx.inv('set-clipboard-text',text).then(function(){
        ctx.set('collabMsg')(label+' kopiert!'); setTimeout(function(){ctx.set('collabMsg')('');},2000);
      });
    }
    function createRoom(){
      var name = ctx.get('collabNewRoom');
      if(!name||!name.trim()) return;
      var pw = ctx.get('collabNewRoomPw')||'';
      ctx.inv('send-message',{
        agentName:ctx.get('activeAgent'),
        message:'Erstelle einen Kollaborationsraum namens "'+name.trim()+'"'+(pw?' mit Passwort "'+pw+'"':''),
        conversationId:null,
      }).then(function(){ ctx.set('collabNewRoom')(''); ctx.set('collabNewRoomPw')(''); refreshRooms(); });
    }

    var rooms   = ctx.get('collabRooms')||[];
    var clients = ctx.get('collabClients')||0;
    var tunnel  = ctx.get('collabTunnelUrl')||'';
    var collabTab = ctx.get('collabTab')||'status';

    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}},
        e('h2',{style:{margin:0}},'👥 Real-time Collaboration'),
        e('div',{style:{display:'flex',gap:'8px'}},
          e(UI.DBtn,{label:'↻ Aktualisieren',small:true,onClick:refreshRooms}),
          !ctx.get('collabRunning')
            ? e('button',{className:'btn btn-primary',onClick:startCollab},'▶ Server starten')
            : e('button',{className:'btn',onClick:stopCollab,style:{borderColor:'#e74c3c',color:'#e74c3c'}},'⏹ Stoppen')
        )
      ),

      // Status-Banner
      e('div',{className:'agent-card',style:{marginBottom:'16px',borderLeft:'4px solid '+(ctx.get('collabRunning')?'var(--success)':'var(--border-color)')}},
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'12px'}},
          e('div',null,
            e('div',{style:{display:'flex',alignItems:'center',gap:'10px',marginBottom:'6px'}},
              e('div',{style:{width:'10px',height:'10px',borderRadius:'50%',background:ctx.get('collabRunning')?'var(--success)':'#e74c3c'}}),
              e('span',{style:{fontWeight:'700',fontSize:'15px'}},ctx.get('collabRunning')?'Server Online':'Server Offline'),
              ctx.get('collabMsg') && e('span',{style:{fontSize:'13px',color:'var(--accent-primary)',marginLeft:'8px'}},ctx.get('collabMsg'))
            ),
            ctx.get('collabRunning') && e('div',{style:{fontFamily:'JetBrains Mono, monospace',fontSize:'12px',color:'var(--text-secondary)'}},
              'Lokal: http://localhost:'+port+'/client',
              tunnel && e('span',null,' · Öffentlich: ',e('span',{style:{color:'var(--accent-primary)'}},tunnel+'/client'))
            )
          ),
          ctx.get('collabRunning') && e('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap'}},
            e(UI.DBtn,{label:'🌐 Client öffnen',primary:true,onClick:function(){ctx.inv('open-url','http://localhost:'+port+'/client');}}),
            e(UI.DBtn,{label:'📋 Link',small:true,onClick:function(){copyText('http://localhost:'+port+'/client','Link');}}),
            e(UI.DBtn,{label:'⚡ WS-URL',small:true,onClick:function(){copyText('ws://localhost:'+port,'WS-URL');}}),
            !tunnel && e(UI.DBtn,{label:'🌍 Tunnel',small:true,onClick:startTunnel}),
            tunnel && e(UI.DBtn,{label:'📋 Tunnel-URL',small:true,onClick:function(){copyText(tunnel+'/client','Tunnel-URL');}})
          )
        )
      ),

      // Stats
      e('div',{style:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'16px'}},
        e('div',{style:{textAlign:'center',padding:'14px',background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'10px'}},
          e('div',{style:{fontSize:'28px',fontWeight:'800',color:'var(--accent-primary)'}},clients),
          e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},'Verbundene User')),
        e('div',{style:{textAlign:'center',padding:'14px',background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'10px'}},
          e('div',{style:{fontSize:'28px',fontWeight:'800',color:'var(--accent-primary)'}},rooms.length),
          e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},'Aktive Räume')),
        e('div',{style:{textAlign:'center',padding:'14px',background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'10px'}},
          e('div',{style:{fontSize:'28px',fontWeight:'800',color:'var(--accent-primary)'}},
            rooms.reduce(function(a,r){return a+(r.messages||0);},0)),
          e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},'Nachrichten gesamt'))
      ),

      // Tabs
      e('div',{style:{display:'flex',gap:'6px',marginBottom:'16px'}},
        [{k:'status',l:'📊 Räume'},{k:'create',l:'➕ Raum erstellen'},{k:'features',l:'✨ Features'},{k:'api',l:'🔌 API'}].map(function(t){
          return e('button',{key:t.k,onClick:function(){ctx.set('collabTab')(t.k);},
            style:{padding:'6px 14px',borderRadius:'20px',cursor:'pointer',fontSize:'12px',
              background:collabTab===t.k?'var(--accent-primary)':'var(--bg-tertiary)',
              color:collabTab===t.k?'#000':'var(--text-primary)',
              border:'1px solid '+(collabTab===t.k?'var(--accent-primary)':'var(--border-color)')}
          },t.l);
        })
      ),

      // Räume-Tab
      collabTab==='status' && e('div',null,
        rooms.length===0 && e('div',{style:{textAlign:'center',padding:'30px',color:'var(--text-secondary)'}},
          ctx.get('collabRunning')
            ? e('div',null,e('div',{style:{fontSize:'24px',marginBottom:'8px'}},'💬'),e('div',null,'Noch keine Räume. Web-Client öffnen um Räume zu erstellen.'))
            : e('div',null,e('div',{style:{fontSize:'24px',marginBottom:'8px'}},'⏸'),e('div',null,'Server starten um Räume zu sehen.'))
        ),
        rooms.length>0 && e('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:'10px'}},
          rooms.map(function(room){
            return e('div',{key:room.id,className:'agent-card',style:{padding:'14px'}},
              e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}},
                e('div',null,
                  e('div',{style:{fontWeight:'700',fontSize:'14px'}},room.name||room.id),
                  e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace',marginTop:'2px'}},room.id)
                ),
                e('div',{style:{display:'flex',gap:'4px'}},
                  room.hasKanban && e('span',{style:{fontSize:'11px',padding:'2px 6px',background:'rgba(0,255,136,0.1)',borderRadius:'6px',color:'var(--accent-primary)'}},'📋'),
                  room.hasCode   && e('span',{style:{fontSize:'11px',padding:'2px 6px',background:'rgba(0,255,136,0.1)',borderRadius:'6px',color:'var(--accent-primary)'}},'💻'),
                  room.password  && e('span',{style:{fontSize:'11px',padding:'2px 6px',background:'rgba(255,170,0,0.1)',borderRadius:'6px',color:'var(--warning)'}},'🔒')
                )
              ),
              e('div',{style:{display:'flex',justifyContent:'space-between',fontSize:'12px',color:'var(--text-secondary)',marginBottom:'8px'}},
                e('span',null,'👤 '+(room.members||0)+' User'),
                e('span',null,'💬 '+(room.messages||0)+' Msgs')
              ),
              e(UI.DBtn,{label:'→ Öffnen',small:true,primary:true,onClick:function(){
                ctx.inv('open-url','http://localhost:'+port+'/client?room='+encodeURIComponent(room.id));
              }})
            );
          })
        )
      ),

      // Raum erstellen
      collabTab==='create' && e('div',{className:'agent-card'},
        e('h3',{style:{margin:'0 0 14px'}},'Neuen Raum erstellen'),
        e(UI.DField,{label:'Raumname'},e(UI.DInput,{value:ctx.get('collabNewRoom')||'',onChange:ctx.set('collabNewRoom'),placeholder:'Projekt-Alpha, Team-Meeting, ...'})),
        e(UI.DField,{label:'Passwort (optional)',hint:'Leer lassen für öffentlichen Raum'},e(UI.DInput,{type:'password',value:ctx.get('collabNewRoomPw')||'',onChange:ctx.set('collabNewRoomPw'),placeholder:'Passwort...'})),
        e(UI.DBtn,{label:'Raum erstellen',primary:true,disabled:!ctx.get('collabRunning')||!(ctx.get('collabNewRoom')||'').trim(),onClick:createRoom}),
        !ctx.get('collabRunning') && e('div',{style:{marginTop:'8px',fontSize:'12px',color:'var(--warning)'}},'⚠ Server muss laufen um Räume zu erstellen')
      ),

      // Features
      collabTab==='features' && e('div',{style:{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'12px'}},
        [
          {icon:'💬',title:'Multi-Room Chat',desc:'Mehrere Räume, Reaktionen, Typing-Indicator, @Johnny für AI-Fragen, Nachrichtenhistorie'},
          {icon:'📝',title:'Geteilte Notizen',desc:'Markdown-Notizen live teilen und bearbeiten — alle sehen Änderungen sofort'},
          {icon:'💻',title:'Code Editor',desc:'Kollaborativer Editor — gleichzeitig coden, 7 Sprachen, Syntax-Highlighting'},
          {icon:'📋',title:'Kanban Board',desc:'Tasks anlegen, Drag&Drop zwischen Spalten, Kommentare, Fälligkeitsdaten'},
          {icon:'📊',title:'Polls & Abstimmungen',desc:'Echtzeit-Umfragen erstellen, Ergebnisse sofort für alle sichtbar'},
          {icon:'📎',title:'Datei-Sharing',desc:'Dateien per Drag&Drop teilen, direkt im Browser herunterladen'},
          {icon:'🔒',title:'Passwort-Schutz',desc:'Einzelne Räume mit Passwort absichern'},
          {icon:'💾',title:'Persistenz',desc:'Chat, Notizen und Kanban werden gespeichert — auch nach Neustart'},
          {icon:'🤖',title:'Johnny Integration',desc:'@Johnny im Chat ansprechen — er antwortet und hilft im Raum'},
          {icon:'🌍',title:'Cloudflare Tunnel',desc:'Öffentlich erreichbar machen ohne Port-Forwarding — 1-Klick Tunnel'},
        ].map(function(f){
          return e('div',{key:f.title,style:{background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'10px',padding:'12px 14px'}},
            e('div',{style:{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px'}},
              e('span',{style:{fontSize:'18px'}},f.icon),
              e('span',{style:{fontWeight:'700',fontSize:'13px'}},f.title)
            ),
            e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',lineHeight:'1.5'}},f.desc)
          );
        })
      ),

      // API
      collabTab==='api' && e('div',null,
        e('div',{className:'agent-card',style:{marginBottom:'12px'}},
          e('h3',{style:{margin:'0 0 10px',fontSize:'14px'}},'WebSocket Client'),
          e('pre',{style:{background:'var(--bg-primary)',borderRadius:'8px',padding:'14px',fontFamily:'JetBrains Mono, monospace',fontSize:'12px',color:'var(--accent-primary)',margin:0,lineHeight:'1.7',overflow:'auto'}},
            'const ws = new WebSocket("ws://localhost:'+port+'");\n\n// Raum betreten\nws.onopen = () => ws.send(JSON.stringify({\n  type: "join", room: "general", user: "MeinBot"\n}));\n\n// Nachrichten empfangen\nws.onmessage = (ev) => {\n  const msg = JSON.parse(ev.data);\n  if (msg.type === "message") {\n    console.log(msg.user + ": " + msg.content);\n  }\n};\n\n// Nachricht senden\nws.send(JSON.stringify({\n  type: "message", room: "general",\n  content: "Hallo von meinem Bot!"\n}));')
        ),
        e('div',{className:'agent-card'},
          e('h3',{style:{margin:'0 0 10px',fontSize:'14px'}},'Events'),
          [
            {t:'join',d:'Raum betreten'},
            {t:'leave',d:'Raum verlassen'},
            {t:'message',d:'Nachricht senden'},
            {t:'kanban-move',d:'Kanban-Karte verschieben'},
            {t:'note-update',d:'Notiz aktualisieren'},
            {t:'@johnny',d:'Johnny im Chat ansprechen'},
          ].map(function(ev){
            return e('div',{key:ev.t,style:{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--border-color)',fontSize:'13px'}},
              e('code',{style:{color:'var(--accent-primary)',fontFamily:'JetBrains Mono, monospace'}},ev.t),
              e('span',{style:{color:'var(--text-secondary)'}},ev.d)
            );
          })
        )
      )
    );
  }

function viewDocker(){
    function loadCompose(){
      ctx.inv('get-docker-compose').then(function(r){ if(r&&r.content) ctx.set('dockerCompose')(r.content); });
    }
    function refreshStatus(){
      ctx.inv('check-whisper').then(function(v){ if(v) ctx.set('whisperAvail')(v); });
      ctx.inv('check-docker').then(function(v){ if(v) ctx.set('dockerAvail')(v); });
      ctx.inv('check-audio-tools').then(function(v){ if(v) ctx.set('audioTools')(v); });
      ctx.inv('get-service-status').then(function(v){ if(v) ctx.set('svcStatus')(v); });
    }
    // Auto-Refresh beim ersten Öffnen
    if(!ctx.get('_dockerChecked')){ctx.set('_dockerChecked')(true);refreshStatus();loadCompose();}
    var wa = ctx.get('whisperAvail');
    var da = ctx.get('dockerAvail');
    var at = ctx.get('audioTools') || {};
    var ss = ctx.get('svcStatus') || {};
    var whisperInstalled = wa !== null && wa !== undefined && wa.available;
    var whisperChecking  = wa === null;
    var whisperProviders = wa && wa.providers ? wa.providers.join(', ') : '';
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',{style:{margin:0}},'System & Deployment'),
        e(UI.DBtn,{label:'↻ Alles aktualisieren',small:true,onClick:refreshStatus})
      ),

      // ── Status-Grid ──────────────────────────────────────────────
      e('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px',marginBottom:'20px'}},

        // Docker
        e('div',{className:'stat-card'},
          e('div',{className:'stat-label'},'Docker'),
          e('div',{style:{fontSize:'20px',fontWeight:'700',color:da&&da.available?'var(--success)':'var(--warning)',marginTop:'6px'}},
            da===null?'Prüfe...':(da&&da.available?'✓ Verfügbar':'✗ Nicht gefunden')),
          da&&da.available&&da.version && e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',marginTop:'4px'}},'v'+da.version),
          da&&!da.available && e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',marginTop:'6px'}},
            e('a',{href:'#',style:{color:'var(--accent-primary)'},onClick:function(ev){ev.preventDefault();ctx.inv('open-url','https://docs.docker.com/get-docker/');}},'Docker installieren →'))
        ),

        // Whisper / STT
        e('div',{className:'stat-card'},
          e('div',{className:'stat-label'},'Spracherkennung (STT)'),
          e('div',{style:{fontSize:'20px',fontWeight:'700',color:whisperInstalled?'var(--success)':'var(--warning)',marginTop:'6px'}},
            whisperChecking?'Prüfe...':(whisperInstalled?'✓ Verfügbar':'✗ Nicht installiert')),
          whisperInstalled && whisperProviders && e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},'Provider: '+whisperProviders),
          wa && wa.recommended && e('div',{style:{fontSize:'11px',color:'var(--accent-primary)',marginTop:'2px'}},'Empfohlen: '+wa.recommended),
          wa!==null&&!whisperInstalled && e('div',{style:{marginTop:'8px'}},
            e('button',{className:'btn',style:{padding:'5px 12px',fontSize:'12px'},
              onClick:function(){
                ctx.set('savedMsg')('Installiere Whisper...');
                ctx.inv('install-whisper').then(function(r){
                  ctx.set('savedMsg')(r&&r.success?'Whisper installiert!':'Fehler: '+(r&&r.error||'?'));
                  setTimeout(function(){ctx.set('savedMsg')('');},4000);
                  refreshStatus();
                });
              }
            },'Whisper installieren')
          )
        ),

        // ffmpeg
        e('div',{className:'stat-card'},
          e('div',{className:'stat-label'},'FFmpeg (Audio/Video)'),
          e('div',{style:{fontSize:'20px',fontWeight:'700',color:at.ffmpeg&&at.ffmpeg.available?'var(--success)':'var(--warning)',marginTop:'6px'}},
            !at.ffmpeg?'Prüfe...':(at.ffmpeg.available?'✓ Installiert':'✗ Nicht gefunden')),
          at.ffmpeg&&at.ffmpeg.available&&at.ffmpeg.version && e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},'v'+at.ffmpeg.version),
          at.ffmpeg&&!at.ffmpeg.available&&at.ffmpeg.hint && e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'6px'}},at.ffmpeg.hint)
        )
      ),

      // ── Audio/TTS Tools ──────────────────────────────────────────
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('h3',{style:{marginBottom:'14px'}},'Audio & Sprach-Tools'),
        e('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'12px'}},
          ['ffmpeg','sox','edgeTTS','coquiTTS'].map(function(tool){
            var info = at[tool];
            var label = {ffmpeg:'FFmpeg',sox:'Sox',edgeTTS:'Edge-TTS',coquiTTS:'Coqui-TTS'}[tool];
            return e('div',{key:tool,style:{padding:'10px',background:'var(--bg-primary)',borderRadius:'8px',textAlign:'center'}},
              e('div',{style:{fontSize:'18px',marginBottom:'4px'}},info&&info.available?'✓':'✗'),
              e('div',{style:{fontSize:'12px',fontWeight:'600'}},label),
              info&&!info.available&&info.hint && e('div',{style:{fontSize:'10px',color:'var(--text-secondary)',marginTop:'4px'}},info.hint)
            );
          })
        )
      ),

      // ── Services Übersicht ───────────────────────────────────────
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('h3',{style:{marginBottom:'14px'}},'Johnny Services'),
        e('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'8px'}},
          [
            ['Ollama','ollama'],['RAG','rag'],['Browser','browser'],['Vision','vision'],
            ['Suche','search'],['Sandbox','sandbox'],['Bilder','imageGen'],['Video','video'],
            ['NLP','nlp'],['Sensoren','sensor'],['Web-Autonomie','webAutonomy'],['Sprache','speech'],
            ['Kreativität','creativity'],['Smart Home','smartHome'],['Telegram','telegram'],['MCP','mcp']
          ].map(function(pair){
            var label=pair[0],key=pair[1];
            var ok = ss[key] === true || (ss.registry && ss.registry[key] === 'ok');
            return e('div',{key:key,style:{padding:'8px',background:'var(--bg-primary)',borderRadius:'6px',textAlign:'center',border:'1px solid '+(ok?'var(--success)':'var(--border-color)'),opacity:ok?1:0.6}},
              e('div',{style:{fontSize:'14px'}},ok?'✓':'○'),
              e('div',{style:{fontSize:'11px'}},label)
            );
          })
        )
      ),

      // ── Docker-Compose ───────────────────────────────────────────
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}},
          e('h3',{style:{margin:0}},'docker-compose.yml'),
          e('div',{style:{display:'flex',gap:'8px'}},
            e('button',{className:'btn',onClick:loadCompose,style:{padding:'5px 12px',fontSize:'12px'}},'Refresh'),
            e('button',{className:'btn',onClick:function(){ctx.inv('set-clipboard-text',ctx.get('dockerCompose'));},style:{padding:'5px 12px',fontSize:'12px'}},'Copy')
          )
        ),
        e('pre',{style:{background:'var(--bg-primary)',border:'1px solid var(--border-color)',borderRadius:'8px',padding:'16px',
          fontFamily:'JetBrains Mono, monospace',fontSize:'12px',color:'var(--text-primary)',overflowX:'auto',
          lineHeight:'1.6',margin:0,whiteSpace:'pre-wrap'}},ctx.get('dockerCompose')||'Loading...')
      ),
      e('div',{className:'agent-card'},
        e('h3',{style:{marginBottom:'12px'}},'Quick Start'),
        e('pre',{style:{background:'var(--bg-primary)',borderRadius:'8px',padding:'14px',fontFamily:'JetBrains Mono, monospace',fontSize:'12px',color:'var(--accent-primary)',lineHeight:'1.8',margin:0}},
          '# 1. docker-compose.yml in deinen Projektordner speichern\n# 2. .env Datei mit API-Keys anlegen\n# 3. Starten:\ndocker compose up -d\n\n# Ollama Modell im Container laden:\ndocker exec johnny-ollama ollama pull gemma2:9b\n\n# Logs anzeigen:\ndocker compose logs -f johnny'
        )
      )
    );
  }

function viewSwarm() {
    function startSwarm(){
      if(!ctx.get('swGoal').trim()) return;
      ctx.set('swRunning')(true); ctx.set('swResult')(null); ctx.set('swError')('');
      ctx.inv('run-swarm',{goal:ctx.get('swGoal'),type:ctx.get('swType')}).then(function(r){
        if(r&&r.error){ ctx.set('swError')(r.error); }
        else if(r){ ctx.set('swResult')(r); }
        ctx.inv('get-swarms').then(function(v){ if(v) ctx.set('swSwarms')(v); });
      }).catch(function(e){ ctx.set('swError')(e.message||'Swarm-Fehler'); })
        .finally(function(){ ctx.set('swRunning')(false); });
    }
    function refreshSwarms(){ ctx.inv('get-swarms').then(function(v){ if(v) ctx.set('swSwarms')(v); }); }
    var result = ctx.get('swResult');
    var synthesis = result && (result.synthesis || result.result || result.output || (typeof result === 'string' ? result : JSON.stringify(result, null, 2)));
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',{style:{margin:0}},'🐝 Agent Swarms'),
        e(UI.DBtn,{label:'↻ Verlauf',small:true,onClick:refreshSwarms})
      ),
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e(UI.DField,{label:'Swarm-Ziel'},
          e('textarea',{value:ctx.get('swGoal'),onChange:function(ev){ctx.set('swGoal')(ev.target.value);},rows:3,
            placeholder:'z.B. "Recherchiere die 5 besten Open-Source AI-Frameworks 2026 und vergleiche sie..."',
            style:{width:'100%',background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',borderRadius:'8px',padding:'10px',color:'var(--text-primary)',fontSize:'14px',resize:'vertical',boxSizing:'border-box',outline:'none'}})
        ),
        e('div',{style:{display:'flex',gap:'8px',alignItems:'flex-end',flexWrap:'wrap'}},
          e('div',{style:{flex:1,minWidth:'200px'}},
            e(UI.DField,{label:'Swarm-Typ'},
              e(UI.DSelect,{value:ctx.get('swType'),onChange:ctx.set('swType'),options:[
                {value:'research',label:'🔍 Research — Mehrere Agents recherchieren parallel'},
                {value:'brainstorm',label:'💡 Brainstorm — Ideen generieren und bewerten'},
                {value:'pipeline',label:'⛓ Pipeline — Tasks sequenziell abarbeiten'},
                {value:'custom',label:'⚙ Custom — Freie Konfiguration'},
              ]})
            )
          ),
          e(UI.DBtn,{
            label:ctx.get('swRunning')?'🐝 Swarm läuft...':'▶ Swarm starten',
            primary:true,disabled:ctx.get('swRunning')||!ctx.get('swGoal').trim(),
            onClick:startSwarm,style:{marginBottom:'14px'}
          })
        )
      ),

      // Loading
      ctx.get('swRunning') && e('div',{style:{textAlign:'center',padding:'30px',color:'var(--text-secondary)'}},
        e('div',{className:'loading',style:{marginBottom:'12px'}}),
        e('div',{style:{fontSize:'15px'}},'Swarm arbeitet...'),
        e('div',{style:{fontSize:'12px',marginTop:'8px'}},'Mehrere Agents analysieren das Ziel parallel')
      ),

      // Fehler
      ctx.get('swError') && e('div',{style:{padding:'14px',background:'rgba(231,76,60,0.1)',border:'1px solid #e74c3c',borderRadius:'8px',color:'#e74c3c',marginBottom:'16px'}},
        e('div',{style:{fontWeight:'700',marginBottom:'4px'}},'⚠ Swarm-Fehler'),
        e('div',{style:{fontSize:'13px'}},ctx.get('swError'))
      ),

      // Ergebnis
      result && !ctx.get('swRunning') && e('div',{className:'agent-card',style:{marginBottom:'16px'}},
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}},
          e('h3',{style:{margin:0,color:'var(--accent-primary)'}},'🎯 Swarm-Ergebnis'),
          e('div',{style:{display:'flex',gap:'8px'}},
            e(UI.DBtn,{label:'📋 Kopieren',small:true,onClick:function(){ctx.inv('set-clipboard-text',synthesis||'');}}),
            e(UI.DBtn,{label:'💾 Speichern',small:true,onClick:function(){
              ctx.inv('write-output-file',{filename:'swarm-'+Date.now()+'.md',content:synthesis||''})
                .then(function(r){if(r&&r.success){ctx.set('savedMsg')('Gespeichert!');setTimeout(function(){ctx.set('savedMsg')('');},3000);}});
            }})
          )
        ),
        e('div',{style:{whiteSpace:'pre-wrap',fontSize:'14px',lineHeight:'1.7',maxHeight:'500px',overflowY:'auto'}},synthesis||'(kein Text-Ergebnis)'),
        result.tasks && e('div',{style:{marginTop:'12px',padding:'8px 12px',background:'var(--bg-primary)',borderRadius:'8px',fontSize:'12px',color:'var(--text-secondary)',display:'flex',gap:'16px'}},
          e('span',null,'📋 '+result.tasks.length+' Tasks'),
          result.duration && e('span',null,'⏱ '+Math.round(result.duration/1000)+'s'),
          result.completedTasks!=null && e('span',null,'✓ '+result.completedTasks+' abgeschlossen')
        )
      ),

      // Verlauf
      ctx.get('swSwarms').length>0 && e('div',null,
        e('h3',{style:{fontSize:'14px',marginBottom:'10px'}},'Swarm-Verlauf'),
        e('div',{style:{display:'flex',flexDirection:'column',gap:'6px'}},
          ctx.get('swSwarms').map(function(sw){ return e('div',{key:sw.id,className:'agent-card',style:{padding:'10px 14px'}},
            e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
              e('div',null,
                e('div',{style:{fontWeight:'600',fontSize:'13px'}},(sw.goal||'').slice(0,70)+(sw.goal&&sw.goal.length>70?'...':'')),
                e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'2px'}},sw.type||'research')
              ),
              e('div',{style:{display:'flex',gap:'8px',alignItems:'center'}},
                e('span',{style:{fontSize:'11px',color:sw.status==='completed'?'var(--success)':sw.status==='running'?'var(--warning)':'#e74c3c',fontFamily:'JetBrains Mono, monospace'}},sw.status),
                sw.taskCount && e('span',{style:{fontSize:'11px',color:'var(--text-secondary)'}},
                  (sw.completedTasks||0)+'/'+sw.taskCount+' Tasks'),
                e(UI.DBtn,{label:'✕',small:true,danger:true,onClick:function(){ ctx.inv('cancel-swarm',sw.id).then(refreshSwarms); }})
              )
            )
          ); })
        )
      ),

      // Leerstate
      ctx.get('swSwarms').length===0 && !result && !ctx.get('swRunning') && e('div',{style:{textAlign:'center',padding:'40px',color:'var(--text-secondary)'}},
        e('div',{style:{fontSize:'48px',marginBottom:'16px'}},'🐝'),
        e('div',{style:{fontSize:'16px',marginBottom:'8px'}},'Agent Swarms — Schwarmintelligenz'),
        e('div',{style:{fontSize:'13px',lineHeight:'1.8',maxWidth:'400px',margin:'0 auto'}},
          'Mehrere Agents arbeiten parallel an einem Ziel.\nResearch: Informationen sammeln und synthetisieren\nBrainstorm: Ideen aus verschiedenen Perspektiven\nPipeline: Schritt-für-Schritt Verarbeitung')
      )
    );
  }

function viewGateway() {
    function refreshGW(){ ctx.inv('get-gateway-status').then(function(v){ if(v) ctx.set('gwStatus')(v); }); }
    var gw = ctx.get('gwStatus');
    var isLoaded = gw !== null && gw !== undefined;
    var isRunning = isLoaded && gw.running;
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',{style:{margin:0}},'Gateway Event-Bus'),
        e(UI.DBtn,{label:'↻ Aktualisieren',small:true,onClick:refreshGW})
      ),
      !isLoaded && e('div',{style:{textAlign:'center',padding:'40px',color:'var(--text-secondary)'}},
        e('div',{style:{fontSize:'48px',marginBottom:'16px'}},'🔌'),
        e('div',{style:{fontSize:'16px',marginBottom:'16px'}},'Gateway-Status wird geladen...'),
        e(UI.DBtn,{label:'Laden',onClick:refreshGW})
      ),
      isLoaded && e('div',null,
        // Status-Banner
        e('div',{className:'agent-card',style:{marginBottom:'16px',borderLeft:'4px solid '+(isRunning?'var(--success)':'var(--border-color)')}},
          e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
            e('div',null,
              e('div',{style:{display:'flex',alignItems:'center',gap:'10px',marginBottom:'6px'}},
                e('div',{style:{width:'10px',height:'10px',borderRadius:'50%',background:isRunning?'var(--success)':'#e74c3c'}}),
                e('span',{style:{fontWeight:'700',fontSize:'15px'}},isRunning?'Gateway Online':'Gateway Offline')
              ),
              isRunning && e('div',{style:{fontFamily:'JetBrains Mono, monospace',fontSize:'12px',color:'var(--text-secondary)'}},
                'ws://localhost:'+(gw.port||18789)+' · Dashboard: http://localhost:'+(gw.port||18789))
            ),
            e('div',{style:{display:'flex',gap:'8px'}},
              !isRunning && e(UI.DBtn,{label:'▶ Gateway starten',primary:true,onClick:function(){ ctx.inv('start-gateway').then(function(){ setTimeout(refreshGW,1000); }); }}),
              isRunning && e(UI.DBtn,{label:'🌐 Dashboard',onClick:function(){ ctx.inv('open-url','http://localhost:'+(gw.port||18789)); }}),
              isRunning && e(UI.DBtn,{label:'⏹ Stoppen',danger:true,onClick:function(){ ctx.inv('stop-gateway').then(refreshGW); }})
            )
          )
        ),
        // Stats
        e('div',{style:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px',marginBottom:'16px'}},
          e('div',{className:'stat-card'},e('div',{className:'stat-label'},'Status'),e('div',{className:'stat-value',style:{fontSize:'18px',color:isRunning?'var(--success)':'var(--text-secondary)'}},isRunning?'Online':'Offline')),
          e('div',{className:'stat-card'},e('div',{className:'stat-label'},'Port'),e('div',{className:'stat-value'},gw.port||'–')),
          e('div',{className:'stat-card'},e('div',{className:'stat-label'},'Clients'),e('div',{className:'stat-value'},gw.clients||0)),
          e('div',{className:'stat-card'},e('div',{className:'stat-label'},'Events'),e('div',{className:'stat-value'},gw.eventCount||0))
        ),
        // Client-Liste
        gw.clientList&&gw.clientList.length>0 && e('div',{className:'agent-card',style:{marginBottom:'16px'}},
          e('h3',{style:{margin:'0 0 10px',fontSize:'14px'}},'Verbundene Clients ('+gw.clientList.length+')'),
          gw.clientList.map(function(c){ return e('div',{key:c.socketId,style:{
            display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid var(--border-color)',fontSize:'13px'
          }},
            e('div',null,
              e('span',{style:{fontWeight:'600'}},c.name||'Client'),
              e('span',{style:{fontSize:'11px',color:'var(--text-secondary)',marginLeft:'8px'}},c.ip||'')
            ),
            c.subscriptions&&c.subscriptions.length>0 && e('span',{style:{fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace'}},c.subscriptions.join(', '))
          ); })
        ),
        // Code-Beispiel
        e('div',{className:'agent-card'},
          e('h3',{style:{margin:'0 0 10px',fontSize:'14px'}},'WebSocket-Verbindung'),
          e('pre',{style:{background:'var(--bg-primary)',padding:'14px',borderRadius:'8px',fontSize:'12px',
            overflow:'auto',color:'var(--accent-primary)',margin:0,lineHeight:'1.7'}},
            'const ws = new WebSocket("ws://localhost:'+(gw.port||18789)+'");\n'+
            'ws.onopen = () => {\n'+
            '  ws.send(JSON.stringify({type:"subscribe",channels:["agent.*","tool.*"]}));\n'+
            '};\n'+
            'ws.onmessage = (e) => {\n'+
            '  const msg = JSON.parse(e.data);\n'+
            '  console.log("["+msg.channel+"]", msg.data);\n'+
            '};'
          ),
          e('div',{style:{marginTop:'10px',fontSize:'12px',color:'var(--text-secondary)'}},'Verfügbare Channels: agent.*, tool.*, task.*, heartbeat, error.*')
        )
      )
    );
  }

  return {
    communication: viewCommunication, monitoring: viewMonitoring,
    collab: viewCollaboration, docker: viewDocker,
    swarm: viewSwarm, gateway: viewGateway,
  };
}
module.exports = { createSystemViews };
