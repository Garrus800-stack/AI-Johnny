'use strict';
function createAutomationViews(ctx, h, UI) {
  var e = React.createElement;

function viewHeartbeat() {
    function loadHB(){ ctx.inv('get-heartbeat-tasks').then(function(v){ if(v) ctx.set('hbTasks')(v); }); }
    if(!ctx.get('_hbChecked')){ctx.set('_hbChecked')(true);loadHB();}
    function createTask(){
      ctx.set('hbCreating')(true);
      ctx.inv('create-heartbeat-task',{name:ctx.get('hbName'),schedule:ctx.get('hbSchedule'),prompt:ctx.get('hbPrompt'),type:'agent',scheduleType:'cron',agent:'Johnny'})
        .then(function(){ ctx.set('hbName')(''); ctx.set('hbPrompt')(''); loadHB(); })
        .catch(function(e){ ctx.actions.log('Heartbeat error: '+e.message); })
        .finally(function(){ ctx.set('hbCreating')(false); });
    }
    function runAndShow(taskId){
      ctx.inv('run-heartbeat-task-now',taskId).then(function(r){
        loadHB();
        if(r&&r.result) ctx.set('hbLastResult')(r.result);
      });
    }
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',{style:{margin:0}},'Heartbeat Tasks'),
        e(UI.DBtn,{label:'↻ Aktualisieren',small:true,onClick:loadHB})
      ),

      // Quick-Create Vorlagen
      e('div',{className:'agent-card',style:{marginBottom:'16px'}},
        e('h3',{style:{margin:'0 0 10px',fontSize:'14px'}},'Schnell-Vorlagen'),
        e('div',{style:{display:'flex',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}},
          e(UI.DBtn,{label:'🌅 Morning Briefing',onClick:function(){ ctx.inv('create-morning-briefing',{}).then(loadHB); }}),
          e(UI.DBtn,{label:'💻 System Health Check',onClick:function(){ ctx.inv('create-system-health-check',{}).then(loadHB); }}),
          e(UI.DBtn,{label:'📊 Tägliche Reflexion',onClick:function(){ ctx.inv('create-daily-reflection',{}).then(loadHB); }}),
          e(UI.DBtn,{label:'🔍 Service Watchdog',onClick:function(){ ctx.inv('create-service-watchdog',{}).then(loadHB); }}),
          e(UI.DBtn,{label:'🧹 Cleanup Task',onClick:function(){ ctx.inv('create-cleanup-task',{}).then(loadHB); }})
        ),

        // Web Monitor — inline Form statt prompt()
        e('div',{style:{display:'flex',gap:'8px',alignItems:'flex-end'}},
          e('div',{style:{flex:1}},
            e('div',{style:{fontSize:'12px',fontWeight:'600',marginBottom:'4px'}},'🌐 Web Monitor'),
            e(UI.DInput,{value:ctx.get('hbUrl')||'',onChange:ctx.set('hbUrl'),placeholder:'https://example.com — URL zum Überwachen'})
          ),
          e(UI.DBtn,{label:'Erstellen',primary:true,disabled:!(ctx.get('hbUrl')||'').trim(),
            onClick:function(){
              ctx.inv('create-web-monitor',{url:ctx.get('hbUrl')}).then(function(){
                ctx.set('hbUrl')(''); loadHB();
              });
            }
          })
        )
      ),

      // Custom Task
      e('div',{className:'agent-card',style:{marginBottom:'16px'}},
        e('h3',{style:{fontSize:'14px',margin:'0 0 10px'}},'Eigener Task'),
        e('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'8px'}},
          e(UI.DField,{label:'Name'},e(UI.DInput,{value:ctx.get('hbName'),onChange:ctx.set('hbName'),placeholder:'Mein Task'})),
          e(UI.DField,{label:'Cron Schedule',hint:'*/30 * * * * = alle 30 Min | 0 8 * * * = tägl. 8 Uhr'},e(UI.DInput,{value:ctx.get('hbSchedule'),onChange:ctx.set('hbSchedule'),placeholder:'0 8 * * *'}))
        ),
        e(UI.DField,{label:'Prompt / Aufgabe für Johnny'},e(UI.DInput,{value:ctx.get('hbPrompt'),onChange:ctx.set('hbPrompt'),placeholder:'z.B. Fasse die aktuellen Nachrichten zusammen...'})),
        e(UI.DBtn,{label:ctx.get('hbCreating')?'...':'Task erstellen',primary:true,disabled:!ctx.get('hbName')||!ctx.get('hbPrompt'),onClick:createTask})
      ),

      // Last Result
      ctx.get('hbLastResult') && e('div',{className:'agent-card',style:{marginBottom:'16px',background:'rgba(0,255,136,0.03)',border:'1px solid rgba(0,255,136,0.2)'}},
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}},
          e('h3',{style:{margin:0,fontSize:'13px',color:'var(--accent-primary)'}},'Letztes Ergebnis'),
          e('button',{onClick:function(){ctx.set('hbLastResult')(null);},style:{background:'none',border:'none',color:'var(--text-secondary)',cursor:'pointer'}},'✕')
        ),
        e('div',{style:{fontSize:'13px',whiteSpace:'pre-wrap',maxHeight:'200px',overflowY:'auto'}},ctx.get('hbLastResult'))
      ),

      // Task-Liste
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}},
        e('h3',{style:{fontSize:'14px',margin:0}},'Aktive Tasks ('+ctx.get('hbTasks').length+')'),
        e(UI.DBtn,{label:'↻',small:true,onClick:loadHB})
      ),
      ctx.get('hbTasks').length===0 && e('p',{style:{color:'var(--text-secondary)'}},'Keine Tasks. Nutze die Vorlagen oben oder erstelle einen eigenen.'),
      ctx.get('hbTasks').map(function(t){ return e('div',{key:t.id,className:'agent-card',style:{padding:'10px 14px',marginBottom:'6px'}},
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
          e('div',null,
            e('span',{style:{fontWeight:'600'}},t.name), ' ',
            e('span',{style:{fontSize:'11px',padding:'2px 8px',borderRadius:'10px',background:t.enabled?'rgba(61,214,172,0.2)':'rgba(255,255,255,0.1)',color:t.enabled?'var(--success)':'var(--text-secondary)'}},t.enabled?'Aktiv':'Pausiert'),
            e('span',{style:{fontSize:'11px',color:'var(--text-secondary)',marginLeft:'8px',fontFamily:'JetBrains Mono, monospace'}},t.schedule),
            t.type && e('span',{style:{fontSize:'10px',padding:'1px 6px',borderRadius:'6px',background:'var(--bg-tertiary)',color:'var(--text-secondary)',marginLeft:'6px'}},t.type)
          ),
          e('div',{style:{display:'flex',gap:'6px'}},
            e(UI.DBtn,{label:'▶ Jetzt',small:true,onClick:function(){ runAndShow(t.id); }}),
            e(UI.DBtn,{label:t.enabled?'⏸':'▶',small:true,onClick:function(){ ctx.inv('toggle-heartbeat-task',t.id).then(loadHB); }}),
            e(UI.DBtn,{label:'✕',small:true,danger:true,onClick:function(){ ctx.inv('delete-heartbeat-task',t.id).then(loadHB); }})
          )
        ),
        t.lastRun && e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},
          'Letzter Lauf: '+new Date(t.lastRun).toLocaleString('de')+(t.runCount?' ('+t.runCount+'x)':'')),
        t.lastResult && e('div',{style:{fontSize:'12px',color:'var(--text-primary)',marginTop:'4px',padding:'6px 8px',background:'var(--bg-primary)',borderRadius:'6px',maxHeight:'80px',overflow:'hidden',whiteSpace:'pre-wrap'}},t.lastResult)
      ); })
    );
  }

function viewSmartHome() {
    function syncDevices(){ ctx.inv('smarthome-sync').then(function(v){ if(v) ctx.set('shDevices')(v); }); }
    return e('div',null,
      e('h2',{style:{marginBottom:'20px'}},'Smart Home'),
      e('div',{style:{display:'flex',gap:'8px',marginBottom:'16px'}},
        e(UI.DBtn,{label:'Sync',onClick:syncDevices}),
        e(UI.DBtn,{label:'Hue Pairing',onClick:function(){ ctx.inv('smarthome-hue-pair').then(function(r){ alert(r.success?'Hue verbunden! Username: '+r.username:'Fehler: '+(r.error||'Drücke zuerst den Bridge-Button')); }); }})
      ),
      ctx.get('shStatus') && e('div',{style:{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'12px',padding:'10px 14px',background:'var(--bg-secondary)',borderRadius:'8px',border:'1px solid var(--border-color)'}},
        'Home Assistant: '+(ctx.get('shStatus').homeAssistant?'✓ Verbunden':'✗ Nicht verbunden')+
        ' | Hue: '+(ctx.get('shStatus').philipsHue?'✓ Verbunden':'✗ Nicht verbunden')+
        ' | MQTT: '+(ctx.get('shStatus').mqtt?'✓ Verbunden':'✗ Nicht verbunden')+
        ' | Geräte: '+(ctx.get('shStatus').deviceCount||0)),
      ctx.get('shDevices').length===0 && e('div',{style:{textAlign:'center',padding:'40px',color:'var(--text-secondary)'}},
        e('div',{style:{fontSize:'48px',marginBottom:'16px'}},'🏡'),
        e('div',{style:{fontSize:'16px',marginBottom:'8px'}},'Keine Geräte gefunden'),
        e('div',{style:{fontSize:'13px',marginBottom:'16px'}},'Home Assistant URL und Token in den Settings konfigurieren'),
        e(UI.DBtn,{label:'→ Zu den Settings',primary:true,onClick:function(){ctx.set('view')('settings');}}),
        e('div',{style:{fontSize:'12px',marginTop:'16px',color:'var(--accent-primary)'}},'Danach "Sync" klicken um Geräte zu laden')
      ),
      ctx.get('shDevices').map(function(d){ return e('div',{key:d.id,className:'agent-card',style:{padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}},
        e('div',null,
          e('span',{style:{fontWeight:'600'}},d.name||d.id),
          e('span',{style:{fontSize:'11px',color:'var(--text-secondary)',marginLeft:'8px'}},d.domain),
          e('div',{style:{fontSize:'12px',color:d.state==='on'?'var(--success)':'var(--text-secondary)'}},d.state)
        ),
        (d.domain==='light'||d.domain==='switch') ? e('div',{style:{display:'flex',gap:'6px'}},
          e(UI.DBtn,{label:'An',small:true,primary:d.state!=='on',onClick:function(){ ctx.inv('smarthome-control',{action:'turn_on',entityId:d.id}).then(syncDevices); }}),
          e(UI.DBtn,{label:'Aus',small:true,danger:d.state==='on',onClick:function(){ ctx.inv('smarthome-control',{action:'turn_off',entityId:d.id}).then(syncDevices); }})
        ) : null
      ); })
    );
  }

function viewIntegrations() {
    return e('div',null,
      e('h2',{style:{marginBottom:'20px'}},'Integrations'),
      ctx.get('intStatus') && e('div',{style:{display:'flex',gap:'12px',marginBottom:'20px',flexWrap:'wrap'}},
        e('div',{className:'stat-card',style:{flex:1,minWidth:'140px'}},
          e('div',{className:'stat-label'},'Spotify'),
          e('div',{style:{fontSize:'14px',fontWeight:'600',marginTop:'6px',color:ctx.get('intStatus').spotify?'var(--success)':'var(--text-secondary)'}},
            ctx.get('intStatus').spotify?'✓ Verbunden':'✗ API Keys fehlen')),
        e('div',{className:'stat-card',style:{flex:1,minWidth:'140px'}},
          e('div',{className:'stat-label'},'Google Calendar'),
          e('div',{style:{fontSize:'14px',fontWeight:'600',marginTop:'6px',color:ctx.get('intStatus').googleCalendar?'var(--success)':'var(--text-secondary)'}},
            ctx.get('intStatus').googleCalendar?'✓ Token vorhanden':'✗ Token fehlt')),
        e('div',{className:'stat-card',style:{flex:1,minWidth:'140px'}},
          e('div',{className:'stat-label'},'GitHub'),
          e('div',{style:{fontSize:'14px',fontWeight:'600',marginTop:'6px',color:ctx.get('intStatus').github?'var(--success)':'var(--text-secondary)'}},
            ctx.get('intStatus').github?'✓ Token vorhanden':'✗ Token fehlt'))
      ),
      !ctx.get('intStatus') && e('div',{style:{padding:'16px',background:'var(--bg-secondary)',borderRadius:'8px',marginBottom:'16px',color:'var(--text-secondary)'}},'Lade Integration-Status...'),
      e('h3',{style:{fontSize:'14px',marginBottom:'8px'}},'GitHub Repos'),
      e('div',{style:{marginBottom:'16px'}},
        e(UI.DBtn,{label:'Repos laden',small:true,onClick:function(){ ctx.inv('github-repos').then(function(v){ if(v&&!v.error) ctx.set('intGhRepos')(v); else ctx.actions.log('GitHub: '+((v&&v.error)||'Fehler')); }); }}),
        ctx.get('intGhRepos').length>0 && e('div',{style:{marginTop:'8px',background:'var(--bg-secondary)',borderRadius:'8px',border:'1px solid var(--border-color)',overflow:'hidden'}},
          ctx.get('intGhRepos').map(function(r){ return e('div',{key:r.name,style:{padding:'8px 14px',borderBottom:'1px solid var(--border-color)',display:'flex',justifyContent:'space-between',alignItems:'center'}},
            e('div',null,
              e('span',{style:{fontWeight:'600'}},r.name),
              e('span',{style:{color:'var(--text-secondary)',fontSize:'12px',marginLeft:'8px'}},r.language||'')
            ),
            e('span',{style:{fontSize:'12px',color:'var(--accent-primary)'}},(r.stars||0)+' Stars')
          ); })
        )
      ),
      e('h3',{style:{fontSize:'14px',margin:'16px 0 8px'}},'Google Calendar'),
      e('div',{style:{marginBottom:'16px'}},
        e(UI.DBtn,{label:'Termine laden (7 Tage)',small:true,onClick:function(){ ctx.inv('calendar-events',{days:7}).then(function(v){ if(v&&!v.error) ctx.set('intCalEvents')(v); else ctx.actions.log('Calendar: '+((v&&v.error)||'Fehler')); }); }}),
        ctx.get('intCalEvents').length>0 && e('div',{style:{marginTop:'8px',background:'var(--bg-secondary)',borderRadius:'8px',border:'1px solid var(--border-color)',overflow:'hidden'}},
          ctx.get('intCalEvents').map(function(ev,i){ return e('div',{key:ev.id||ev.start||i,style:{padding:'8px 14px',borderBottom:'1px solid var(--border-color)',display:'flex',justifyContent:'space-between'}},
            e('span',{style:{fontWeight:'600'}},ev.title||ev.summary||'(kein Titel)'),
            e('span',{style:{color:'var(--text-secondary)',fontSize:'12px'}},ev.start)
          ); })
        )
      ),
      e('div',{style:{marginTop:'20px',padding:'12px 16px',background:'var(--bg-secondary)',borderRadius:'8px',fontSize:'13px',color:'var(--text-secondary)',border:'1px solid var(--border-color)'}},
        e('div',{style:{fontWeight:'600',marginBottom:'6px',color:'var(--text-primary)'}},'API-Keys konfigurieren'),
        e('div',{style:{marginBottom:'8px'}},'Spotify Client ID/Secret und GitHub Token findest du in den Settings.'),
        e(UI.DBtn,{label:'→ Zu den Settings',onClick:function(){ctx.set('view')('settings');}}),
        e('div',{style:{marginTop:'10px',color:'var(--accent-primary)'}},'Sage Johnny: "Zeige meine GitHub Repos" oder "Was steht morgen im Kalender?"')
      )
    );
  }

  return {
    heartbeat: viewHeartbeat, smarthome: viewSmartHome,
    integrations: viewIntegrations,
  };
}
module.exports = { createAutomationViews };
