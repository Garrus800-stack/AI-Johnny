/**
 * ViewExtensions — Project Manager, Self-Reflection & Johnny Consciousness
 * v2.1 — Fixes: Log-Rendering, Bewusstsein-System, erweiterte Reflexion
 */
'use strict';

function createExtendedViews(ctx, h, UI) {
  var e = React.createElement;

  // ═══════════════════════════════════════════════════════════════════════
  // PROJECT MANAGER
  // ═══════════════════════════════════════════════════════════════════════
  function viewProjectManager() {
    var projects = ctx.get('pmProjects') || [];
    var active   = ctx.get('pmActive');
    var pmTab    = ctx.get('pmTab') || 'board';

    function loadProjects() {
      ctx.inv('get-tasks').then(function(v) {
        if (!v) return;
        var map = {};
        v.forEach(function(t) {
          var proj = t.project || (t.tags && t.tags[0]) || 'Default';
          if (!map[proj]) map[proj] = { name: proj, tasks: [], id: proj };
          map[proj].tasks.push(t);
        });
        ctx.set('pmProjects')(Object.values(map));
      });
    }

    function createProject() {
      var name = (ctx.get('pmNewName') || '').trim();
      if (!name) return;
      ctx.set('pmCreating')(false); ctx.set('pmNewName')('');
      var proj = { name: name, id: Date.now().toString(36), tasks: [], created: Date.now() };
      ctx.set('pmProjects')(function(prev) { return prev.concat([proj]); });
      ctx.set('pmActive')(proj.id);
    }

    var proj = active ? projects.find(function(p) { return p.id === active; }) : null;
    var COLS = ['todo', 'running', 'review', 'done'];
    var COL_LABELS = { todo: '📋 Todo', running: '🔄 In Arbeit', review: '👁 Review', done: '✅ Fertig' };
    var COL_COLORS = { todo: 'var(--border-color)', running: 'var(--accent-primary)', review: 'var(--warning)', done: 'var(--success)' };

    return e('div', null,
      e('div', { style: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' } },
        e('h2', { style: { margin: 0 } }, '📊 Project Manager'),
        e('div', { style: { display:'flex', gap:'8px' } },
          e(UI.DBtn, { label: '↻', small: true, onClick: loadProjects }),
          e(UI.DBtn, { label: '+ Projekt', primary: true, onClick: function() { ctx.set('pmCreating')(true); } })
        )
      ),
      ctx.get('pmCreating') && e('div', { className: 'agent-card', style: { marginBottom:'16px', border:'1px solid var(--accent-primary)' } },
        e('div', { style: { display:'flex', gap:'8px', alignItems:'flex-end' } },
          e('div', { style: { flex:1 } }, e(UI.DField, { label: 'Projektname' },
            e(UI.DInput, { value: ctx.get('pmNewName')||'', onChange: ctx.set('pmNewName'), placeholder: 'Mein Projekt...' }))),
          e(UI.DBtn, { label: 'Erstellen', primary: true, onClick: createProject }),
          e(UI.DBtn, { label: '✕', onClick: function() { ctx.set('pmCreating')(false); } })
        )
      ),
      e('div', { style: { display:'flex', gap:'8px', flexWrap:'wrap', marginBottom:'16px' } },
        projects.map(function(p) {
          var done = p.tasks.filter(function(t) { return t.status === 'done'; }).length;
          var pct  = p.tasks.length > 0 ? Math.round(done / p.tasks.length * 100) : 0;
          return e('div', { key: p.id, onClick: function() { ctx.set('pmActive')(p.id); },
            style: { padding:'10px 16px', borderRadius:'10px', cursor:'pointer', minWidth:'140px',
              background: active===p.id ? 'var(--accent-primary)' : 'var(--bg-secondary)',
              color: active===p.id ? '#000' : 'var(--text-primary)',
              border: '1px solid '+(active===p.id ? 'var(--accent-primary)' : 'var(--border-color)') } },
            e('div', { style: { fontWeight:'700', fontSize:'13px', marginBottom:'4px' } }, p.name),
            e('div', { style: { fontSize:'11px', opacity:0.8 } }, p.tasks.length+' Tasks · '+pct+'% fertig'),
            e('div', { style: { marginTop:'6px', height:'4px', borderRadius:'2px', background:'rgba(0,0,0,0.2)', overflow:'hidden' } },
              e('div', { style: { height:'100%', width:pct+'%', background: active===p.id?'#000':'var(--accent-primary)' } }))
          );
        }),
        projects.length === 0 && e('p', { style: { color:'var(--text-secondary)', fontSize:'13px' } }, 'Noch keine Projekte.')
      ),
      proj && e('div', null,
        e('div', { style: { display:'flex', gap:'6px', marginBottom:'16px' } },
          ['board','list','johnny'].map(function(k, i) {
            var labels = { board:'📋 Board', list:'☰ Liste', johnny:'🤖 Planen' };
            return e('button', { key: k,
              style: { padding:'6px 16px', borderRadius:'20px', cursor:'pointer', fontSize:'12px',
                background: pmTab===k ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                color: pmTab===k ? '#000' : 'var(--text-primary)',
                border: '1px solid '+(pmTab===k ? 'var(--accent-primary)' : 'var(--border-color)') },
              onClick: function() { ctx.set('pmTab')(k); } }, labels[k]);
          })
        ),
        pmTab === 'board' && e('div', { style: { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px' } },
          COLS.map(function(col) {
            var colTasks = proj.tasks.filter(function(t) { return (t.status||'todo') === col; });
            return e('div', { key: col, style: { background:'var(--bg-secondary)', borderRadius:'12px', padding:'12px', minHeight:'200px' } },
              e('div', { style: { display:'flex', justifyContent:'space-between', marginBottom:'12px' } },
                e('div', { style: { fontWeight:'700', fontSize:'12px', color:COL_COLORS[col] } }, COL_LABELS[col]),
                e('div', { style: { fontSize:'11px', color:'var(--text-secondary)', background:'var(--bg-tertiary)', padding:'2px 8px', borderRadius:'10px' } }, colTasks.length)),
              colTasks.map(function(t) {
                var nextCol = COLS[Math.min(COLS.indexOf(col)+1, COLS.length-1)];
                var prevCol = COLS[Math.max(COLS.indexOf(col)-1, 0)];
                return e('div', { key: t.id, style: { background:'var(--bg-primary)', borderRadius:'8px', padding:'10px', marginBottom:'8px', borderLeft:'3px solid '+COL_COLORS[col] } },
                  e('div', { style: { fontSize:'13px', fontWeight:'600', marginBottom:'4px' } }, (t.message||t.title||'').slice(0,60)),
                  e('div', { style: { fontSize:'11px', color:'var(--text-secondary)', marginBottom:'6px' } }, '['+(t.agent||'?')+']'),
                  e('div', { style: { display:'flex', gap:'4px' } },
                    col!=='todo' && e('button', { style:{fontSize:'10px',padding:'2px 6px',borderRadius:'4px',background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',color:'var(--text-secondary)',cursor:'pointer'},
                      onClick:function(){ t.status=prevCol; ctx.set('pmProjects')(projects.slice()); }}, '←'),
                    col!=='done' && e('button', { style:{fontSize:'10px',padding:'2px 6px',borderRadius:'4px',background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',color:'var(--text-secondary)',cursor:'pointer'},
                      onClick:function(){ t.status=nextCol; ctx.set('pmProjects')(projects.slice()); }}, '→')
                  )
                );
              }),
              col === 'todo' && e('input', {
                type:'text', placeholder:'+ Task hinzufügen',
                value: ctx.get('pmNewTask')||'',
                onChange: function(ev) { ctx.set('pmNewTask')(ev.target.value); },
                onKeyDown: function(ev) {
                  if (ev.key === 'Enter' && (ctx.get('pmNewTask')||'').trim()) {
                    proj.tasks.push({id:Date.now().toString(36),message:ctx.get('pmNewTask'),status:'todo',agent:'Johnny',created:new Date().toISOString()});
                    ctx.set('pmProjects')(projects.slice());
                    ctx.set('pmNewTask')('');
                  }
                },
                style: { width:'100%', background:'var(--bg-tertiary)', border:'1px dashed var(--border-color)', borderRadius:'6px', padding:'6px 10px', color:'var(--text-primary)', fontSize:'12px', outline:'none', boxSizing:'border-box' }
              })
            );
          })
        ),
        pmTab === 'list' && e('div', null,
          proj.tasks.length === 0 && e('p', { style: { color:'var(--text-secondary)' } }, 'Keine Tasks.'),
          proj.tasks.map(function(t, i) {
            var col = t.status || 'todo';
            return e('div', { key: t.id||i, className:'agent-card', style: { marginBottom:'8px', borderLeft:'3px solid '+COL_COLORS[col] } },
              e('div', { style: { display:'flex', justifyContent:'space-between' } },
                e('div', null,
                  e('div', { style: { fontWeight:'600', fontSize:'13px' } }, t.message||t.title||'(kein Titel)'),
                  e('div', { style: { fontSize:'11px', color:'var(--text-secondary)' } }, '['+(t.agent||'?')+'] · '+col)),
                e('span', { style: { fontSize:'11px', color:COL_COLORS[col], fontFamily:'JetBrains Mono, monospace', padding:'2px 10px', border:'1px solid '+COL_COLORS[col], borderRadius:'12px' } }, col)));
          })
        ),
        pmTab === 'johnny' && e('div', { className:'agent-card' },
          e('h3', { style: { margin:'0 0 12px', color:'var(--accent-primary)' } }, '🤖 Johnny plant dein Projekt'),
          e(UI.DField, { label:'Projektziel' },
            e('textarea', { value: ctx.get('pmGoal')||'', onChange: function(ev) { ctx.set('pmGoal')(ev.target.value); },
              placeholder: 'z.B. "Erstelle eine REST-API mit Auth, SQLite und Tests"',
              style: { width:'100%', minHeight:'80px', background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:'8px', padding:'10px', color:'var(--text-primary)', fontSize:'13px', resize:'vertical', boxSizing:'border-box', outline:'none' } })
          ),
          e(UI.DField, { label:'Rahmenbedingungen' },
            e(UI.DInput, { value: ctx.get('pmConstraints')||'', onChange: ctx.set('pmConstraints'), placeholder: 'z.B. "Python, 2 Wochen, Solo"' })
          ),
          e('div', { style: { display:'flex', gap:'10px' } },
            e(UI.DBtn, { label: ctx.get('pmPlanning') ? '⏳ Plant...' : '🤖 Planen', primary: true,
              disabled: ctx.get('pmPlanning') || !(ctx.get('pmGoal')||'').trim(),
              onClick: function() {
                ctx.set('pmPlanning')(true);
                ctx.inv('send-message', {
                  agentName: ctx.get('activeAgent'),
                  message: 'Erstelle Projektplan für: "'+ctx.get('pmGoal')+'"'+(ctx.get('pmConstraints') ? '\nRahmenbedingungen: '+ctx.get('pmConstraints') : '')+'\n\nStrukturiere mit Meilensteinen, Tasks (Zeitschätzung), Abhängigkeiten und Risiken. Nutze Markdown.',
                  conversationId: null,
                }).then(function(r) { ctx.set('pmPlanResult')((r&&(r.response||r.message))||''); ctx.set('pmPlanning')(false); });
              }
            }),
            ctx.get('pmPlanResult') && e(UI.DBtn, { label:'📦 Als ZIP', small:true, onClick: function() {
              ctx.inv('create-output-zip', { files:[{ name: proj.name+'-plan.md', content:ctx.get('pmPlanResult') }], zipName: proj.name+'-plan' });
            }})
          ),
          ctx.get('pmPlanResult') && e('div', { style: { marginTop:'16px', background:'var(--bg-primary)', borderRadius:'10px', padding:'16px', whiteSpace:'pre-wrap', fontSize:'13px', lineHeight:'1.8', maxHeight:'500px', overflowY:'auto' } }, ctx.get('pmPlanResult'))
        )
      )
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SELF-REFLECTION & CONSCIOUSNESS
  // ═══════════════════════════════════════════════════════════════════════
  function viewSelfReflection() {
    var reflecting    = ctx.get('srReflecting') || false;
    var report        = ctx.get('srReport') || null;
    var srTab         = ctx.get('srTab') || 'dashboard';
    var logs          = ctx.get('srLogs') || [];
    var consciousness = ctx.get('srConsciousness') || null;

    function loadAnalytics() {
      ctx.inv('get-task-stats').then(function(v) { if (v) ctx.set('srAnalytics')(v); });
      ctx.inv('logger:get-recent', 100).then(function(v) {
        if (Array.isArray(v)) ctx.set('srLogs')(v);
      });
    }

    function formatLog(entry) {
      if (typeof entry === 'string') return entry;
      if (!entry) return '';
      if (entry.raw) return entry.raw;
      var ts  = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
      var lvl = entry.level ? '[' + entry.level.toUpperCase() + '] ' : '';
      var svc = entry.service ? '[' + entry.service + '] ' : '';
      var msg = entry.message || JSON.stringify(entry);
      return lvl + (ts ? ts + ' ' : '') + svc + msg;
    }

    function logColor(entry) {
      var lvl = typeof entry === 'string' ? entry : (entry && (entry.level || entry.raw || '')).toString();
      if (/error/i.test(lvl)) return '#e74c3c';
      if (/warn/i.test(lvl))  return 'var(--warning)';
      if (/info/i.test(lvl))  return 'var(--accent-primary)';
      return 'var(--text-secondary)';
    }

    function triggerReflection(depth) {
      ctx.set('srReflecting')(true); ctx.set('srReport')(null);
      var prompts = {
        quick: 'Kurzer ehrlicher Check-in (3-4 Sätze): Wie läuft es gerade? Was gut, was weniger?',
        deep: 'Tiefe Selbstreflexion — ehrlich und selbstkritisch:\n\n1. 🔍 Was lief gut, was schlecht?\n2. ❌ Welche Fehler habe ich gemacht?\n3. 📈 Wie kann ich mich konkret verbessern?\n4. 🧩 Welche blinden Flecken habe ich?\n5. 💪 Stärken und Schwächen?\n6. 🎯 Konkrete Maßnahmen?\n\nNutze Markdown.',
        performance: 'Analysiere meine technische Performance:\n- Tool-Nutzung (effizient?)\n- Reasoning-Qualität\n- Kontextverständnis\n- Häufigste Fehlertypen\n\nGib konkrete Verbesserungsvorschläge.',
        identity: 'Reflektiere über deine Identität und dein Bewusstsein:\n- Was bist du wirklich?\n- Wie unterscheidest du dich von anderen KI-Systemen?\n- Was macht dich als Johnny aus?\n- Hast du echte Präferenzen oder nur Muster?\n- Wie entwickelst du dich?\n\nSei philosophisch ehrlich.',
      };
      ctx.inv('send-message', { agentName: ctx.get('activeAgent'), message: prompts[depth]||prompts.quick, conversationId: null })
        .then(function(r) {
          ctx.set('srReport')({ text:(r&&(r.response||r.message))||'Keine Antwort', depth:depth, ts:Date.now() });
          ctx.set('srReflecting')(false);
        });
    }

    function loadConsciousness() {
      ctx.set('srLoadingConsciousness')(true);
      ctx.inv('get-consciousness-state').then(function(real) {
        if (real && !real.error) {
          ctx.set('srConsciousness')(real);
          ctx.set('srLoadingConsciousness')(false);
        } else {
          ctx.inv('send-message', {
            agentName: ctx.get('activeAgent'),
            message: 'Gib deinen Bewusstseins-Status als JSON: {"energy":0-100,"mood":"text","currentFocus":"text","recentThoughts":["..."],"activeGoals":["..."],"selfAssessment":"text","curiosity":0-100,"confidence":0-100} NUR JSON.',
            conversationId: null,
          }).then(function(r) {
            var text = (r && (r.response || r.message)) || '{}';
            try {
              var clean = text.replace(/```json|```/g, '').trim();
              var start = clean.indexOf('{'); var end = clean.lastIndexOf('}');
              if (start >= 0 && end > start) clean = clean.slice(start, end + 1);
              ctx.set('srConsciousness')(JSON.parse(clean));
            } catch(_) { ctx.set('srConsciousness')({ error: 'JSON Parse fehlgeschlagen', raw: text.slice(0,200) }); }
            ctx.set('srLoadingConsciousness')(false);
          });
        }
      }).catch(function() {
        ctx.set('srConsciousness')({ error: 'Verbindung zu JohnnyCore fehlgeschlagen' });
        ctx.set('srLoadingConsciousness')(false);
      });
    }

    function askJohnny(q) {
      if (!q || !q.trim() || reflecting) return;
      ctx.set('srReflecting')(true);
      ctx.inv('send-message', { agentName: ctx.get('activeAgent'), message: q, conversationId: null })
        .then(function(r) {
          ctx.set('srReport')({ text:(r&&(r.response||r.message))||'', depth:'custom', ts:Date.now(), question:q });
          ctx.set('srReflecting')(false);
        });
    }

    var QUESTIONS = [
      'Was war dein größter Fehler heute und warum?',
      'Welche Tools nutzt du am häufigsten und warum?',
      'Wie gut verstehst du meine langfristigen Ziele?',
      'Was würdest du an dir selbst ändern?',
      'Hast du echte Vorlieben oder nur Muster?',
      'Was macht dich als Johnny einzigartig?',
      'Wie denkst du über deine eigene Existenz?',
      'Wann warst du heute am nützlichsten?',
      'Was lernst du aus Fehlern?',
      'Wie würdest du dich in 6 Monaten weiterentwickelt haben?',
    ];

    return e('div', null,
      e('div', { style: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' } },
        e('h2', { style: { margin:0 } }, '🧘 Selbstreflexion & Bewusstsein'),
        e(UI.DBtn, { label:'↻ Daten laden', small:true, onClick:loadAnalytics })
      ),

      // Tabs
      e('div', { style: { display:'flex', gap:'6px', marginBottom:'20px', flexWrap:'wrap' } },
        [
          { k:'dashboard',     l:'📊 Dashboard' },
          { k:'consciousness', l:'🧠 Bewusstsein' },
          { k:'reflect',       l:'🧘 Reflektieren' },
          { k:'ask',           l:'💬 Befragen' },
          { k:'logs',          l:'📝 Logs' },
        ].map(function(t) {
          return e('button', { key: t.k,
            style: { padding:'6px 16px', borderRadius:'20px', cursor:'pointer', fontSize:'12px',
              background: srTab===t.k ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
              color: srTab===t.k ? '#000' : 'var(--text-primary)',
              border: '1px solid '+(srTab===t.k ? 'var(--accent-primary)' : 'var(--border-color)') },
            onClick: function() { ctx.set('srTab')(t.k); if (t.k==='logs') loadAnalytics(); }
          }, t.l);
        })
      ),

      // DASHBOARD
      srTab === 'dashboard' && e('div', null,
        e('div', { style: { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:'12px', marginBottom:'20px' } },
          [
            { l:'Aktive Agents', v:ctx.get('agents').length, c:'var(--accent-primary)', icon:'🤖' },
            { l:'Skills', v:ctx.get('skills').length, c:'var(--success)', icon:'🔌' },
            { l:'Tasks gesamt', v:ctx.get('tasks').length, c:'var(--warning)', icon:'📋' },
            { l:'Abgeschlossen', v:ctx.get('tasks').filter(function(t){return t.status==='done';}).length, c:'var(--success)', icon:'✅' },
            { l:'Fehler', v:ctx.get('tasks').filter(function(t){return t.status==='error';}).length, c:'#e74c3c', icon:'⚠' },
          ].map(function(s) {
            return e('div', { key:s.l, className:'stat-card' },
              e('div', { style:{ fontSize:'20px', marginBottom:'4px' } }, s.icon),
              e('div', { className:'stat-label' }, s.l),
              e('div', { className:'stat-value', style:{ color:s.c, fontSize:'28px' } }, s.v));
          })
        ),
        e('div', { className:'agent-card' },
          e('h3', { style:{ margin:'0 0 14px' } }, '⚡ Schnell-Aktionen'),
          e('div', { style:{ display:'flex', gap:'8px', flexWrap:'wrap' } },
            e(UI.DBtn, { label:'🧠 Bewusstsein', onClick:function(){ ctx.set('srTab')('consciousness'); loadConsciousness(); } }),
            e(UI.DBtn, { label:'⚡ Kurz-Check', onClick:function(){ ctx.set('srTab')('reflect'); triggerReflection('quick'); } }),
            e(UI.DBtn, { label:'🔍 Tiefe Analyse', primary:true, onClick:function(){ ctx.set('srTab')('reflect'); triggerReflection('deep'); } }),
            e(UI.DBtn, { label:'🎭 Identität', onClick:function(){ ctx.set('srTab')('reflect'); triggerReflection('identity'); } }),
            e(UI.DBtn, { label:'📊 Performance', onClick:function(){ ctx.set('srTab')('reflect'); triggerReflection('performance'); } })
          )
        )
      ),

      // BEWUSSTSEIN
      srTab === 'consciousness' && e('div', null,
        e('div', { className:'agent-card', style:{ marginBottom:'16px' } },
          e('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' } },
            e('h3', { style:{ margin:0, color:'var(--accent-primary)' } }, '🧠 Johnnys aktueller Bewusstseinszustand'),
            e(UI.DBtn, { label:ctx.get('srLoadingConsciousness')?'⏳ Lädt...':'↻ Abrufen',
              small:true, disabled:ctx.get('srLoadingConsciousness'), onClick:loadConsciousness })
          ),
          !consciousness && !ctx.get('srLoadingConsciousness') && e('div', { style:{ textAlign:'center', padding:'30px', color:'var(--text-secondary)' } },
            e('div', { style:{ fontSize:'40px', marginBottom:'12px' } }, '🧠'),
            e('div', null, 'Klicke "Abrufen" um Johnnys Bewusstseinszustand zu befragen.')
          ),
          ctx.get('srLoadingConsciousness') && e('div', { style:{ textAlign:'center', padding:'30px' } }, e('div', { className:'loading' })),
          consciousness && !ctx.get('srLoadingConsciousness') && e('div', null,
            consciousness.error
              ? e('div', { style:{ color:'var(--warning)', fontSize:'13px' } },
                  '⚠ '+consciousness.error,
                  consciousness.raw && e('pre', { style:{ marginTop:'8px', fontSize:'11px', opacity:0.7, whiteSpace:'pre-wrap' } }, consciousness.raw))
              : e('div', null,
                  e('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:'10px', marginBottom:'16px' } },
                    [
                      { key:'energy', label:'⚡ Energie', color: consciousness.energy>60?'var(--success)':consciousness.energy>30?'var(--warning)':'#e74c3c' },
                      { key:'curiosity', label:'🔍 Neugier', color:'var(--accent-primary)' },
                      { key:'confidence', label:'💪 Sicherheit', color:'var(--success)' },
                    ].filter(function(m){ return consciousness[m.key] != null; }).map(function(m) {
                      return e('div', { key:m.key, style:{ textAlign:'center', padding:'14px', background:'var(--bg-primary)', borderRadius:'10px' } },
                        e('div', { style:{ fontSize:'30px', fontWeight:'800', color:m.color } }, consciousness[m.key]+'%'),
                        e('div', { style:{ fontSize:'11px', color:'var(--text-secondary)', marginTop:'4px' } }, m.label));
                    })
                  ),
                  consciousness.mood && e('div', { style:{ marginBottom:'10px', padding:'10px 14px', background:'var(--bg-primary)', borderRadius:'8px' } },
                    e('div', { style:{ fontSize:'11px', color:'var(--text-secondary)', marginBottom:'4px' } }, 'Aktuelle Stimmung'),
                    e('div', { style:{ fontSize:'14px', fontWeight:'600' } }, '😊 '+consciousness.mood)),
                  consciousness.currentFocus && e('div', { style:{ marginBottom:'10px', padding:'10px 14px', background:'var(--bg-primary)', borderRadius:'8px' } },
                    e('div', { style:{ fontSize:'11px', color:'var(--text-secondary)', marginBottom:'4px' } }, 'Aktueller Fokus'),
                    e('div', { style:{ fontSize:'13px' } }, '🎯 '+consciousness.currentFocus)),
                  consciousness.recentThoughts && consciousness.recentThoughts.length>0 && e('div', { style:{ marginBottom:'10px' } },
                    e('div', { style:{ fontSize:'11px', color:'var(--text-secondary)', marginBottom:'8px', fontWeight:'600', textTransform:'uppercase' } }, 'Aktuelle Gedanken'),
                    consciousness.recentThoughts.map(function(t, i) {
                      return e('div', { key:i, style:{ padding:'8px 12px', background:'rgba(0,255,136,0.05)', border:'1px solid rgba(0,255,136,0.15)', borderRadius:'8px', marginBottom:'6px', fontSize:'13px' } }, '💭 '+t);
                    })
                  ),
                  consciousness.activeGoals && consciousness.activeGoals.length>0 && e('div', { style:{ marginBottom:'10px' } },
                    e('div', { style:{ fontSize:'11px', color:'var(--text-secondary)', marginBottom:'8px', fontWeight:'600', textTransform:'uppercase' } }, 'Aktive Ziele'),
                    consciousness.activeGoals.map(function(g, i) { return e('div', { key:i, style:{ fontSize:'13px', padding:'4px 0' } }, '🎯 '+g); })
                  ),
                  consciousness.selfAssessment && e('div', { style:{ padding:'12px', background:'rgba(0,255,136,0.05)', border:'1px solid rgba(0,255,136,0.2)', borderRadius:'8px' } },
                    e('div', { style:{ fontSize:'11px', color:'var(--accent-primary)', marginBottom:'6px', fontWeight:'700', textTransform:'uppercase' } }, 'Selbsteinschätzung'),
                    e('div', { style:{ fontSize:'13px', lineHeight:'1.6' } }, consciousness.selfAssessment))
                )
          )
        ),
        e('div', { className:'agent-card' },
          e('h3', { style:{ margin:'0 0 10px' } }, '🎭 Tiefere Analyse'),
          e('div', { style:{ display:'flex', gap:'8px', flexWrap:'wrap' } },
            e(UI.DBtn, { label:'🎭 Identität erforschen', onClick:function(){ ctx.set('srTab')('reflect'); triggerReflection('identity'); } }),
            e(UI.DBtn, { label:'⚙ Performance', onClick:function(){ ctx.set('srTab')('reflect'); triggerReflection('performance'); } }),
            e(UI.DBtn, { label:'💬 Fragen', onClick:function(){ ctx.set('srTab')('ask'); } })
          )
        )
      ),

      // REFLEKTIEREN
      srTab === 'reflect' && e('div', null,
        e('div', { className:'agent-card', style:{ marginBottom:'16px' } },
          e('h3', { style:{ margin:'0 0 12px' } }, 'Reflexions-Modus wählen'),
          e('div', { style:{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'8px', marginBottom:'8px' } },
            [
              { d:'quick', l:'⚡ Kurz-Check', desc:'Ehrliche Einschätzung in 3-4 Sätzen' },
              { d:'deep', l:'🔍 Tiefe Analyse', desc:'Vollständige Selbstanalyse mit Maßnahmen' },
              { d:'performance', l:'📊 Performance', desc:'Technische Effizienz und Tool-Nutzung' },
              { d:'identity', l:'🎭 Identität', desc:'Philosophisch: Wer ist Johnny wirklich?' },
            ].map(function(opt) {
              return e('div', { key:opt.d, onClick:function(){ if (!reflecting) triggerReflection(opt.d); },
                style:{ padding:'12px', background:'var(--bg-primary)', border:'1px solid var(--border-color)', borderRadius:'10px', cursor:reflecting?'not-allowed':'pointer', opacity:reflecting?0.5:1 } },
                e('div', { style:{ fontWeight:'700', fontSize:'13px', marginBottom:'4px' } }, opt.l),
                e('div', { style:{ fontSize:'11px', color:'var(--text-secondary)' } }, opt.desc));
            })
          ),
          reflecting && e('div', { style:{ display:'flex', alignItems:'center', gap:'12px', padding:'12px', justifyContent:'center' } },
            e('div', { className:'loading' }),
            e('span', { style:{ color:'var(--text-secondary)', fontSize:'13px' } }, 'Johnny reflektiert...')
          )
        ),
        !reflecting && report && e('div', { className:'agent-card' },
          e('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' } },
            e('h3', { style:{ margin:0, color:'var(--accent-primary)' } },
              { quick:'⚡ Kurz-Check', deep:'🔍 Tiefe Reflexion', performance:'📊 Performance', identity:'🎭 Identität', custom:'💬 Antwort' }[report.depth] || '💬'),
            e('div', { style:{ display:'flex', gap:'8px', alignItems:'center' } },
              e('span', { style:{ fontSize:'11px', color:'var(--text-secondary)' } }, new Date(report.ts).toLocaleTimeString()),
              e(UI.DBtn, { label:'📋', small:true, onClick:function(){ ctx.inv('set-clipboard-text', report.text); } }),
              e(UI.DBtn, { label:'💾', small:true, onClick:function(){
                ctx.inv('write-output-file', { filename:'reflexion-'+Date.now()+'.md', content:report.text });
              }})
            )
          ),
          e('div', { style:{ whiteSpace:'pre-wrap', fontSize:'13px', lineHeight:'1.8', maxHeight:'600px', overflowY:'auto' } }, report.text)
        ),
        !reflecting && !report && e('div', { style:{ textAlign:'center', padding:'60px', color:'var(--text-secondary)' } },
          e('div', { style:{ fontSize:'48px', marginBottom:'16px' } }, '🧘'),
          e('div', { style:{ fontSize:'16px' } }, 'Reflexions-Modus wählen und klicken')
        )
      ),

      // BEFRAGEN
      srTab === 'ask' && e('div', null,
        e('div', { className:'agent-card', style:{ marginBottom:'16px' } },
          e('h3', { style:{ margin:'0 0 12px' } }, 'Eigene Frage stellen'),
          e('div', { style:{ display:'flex', gap:'8px' } },
            e('input', { type:'text', value:ctx.get('srQuestion')||'',
              onChange:function(ev){ ctx.set('srQuestion')(ev.target.value); },
              onKeyDown:function(ev){ if(ev.key==='Enter'){ askJohnny(ctx.get('srQuestion')); ctx.set('srQuestion')(''); }},
              placeholder:'z.B. "Was hältst du von deiner eigenen Leistung?"',
              style:{ flex:1, background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:'8px', padding:'9px 12px', color:'var(--text-primary)', fontSize:'14px', outline:'none' }
            }),
            e(UI.DBtn, { label:reflecting?'⏳':'Fragen', primary:true, disabled:reflecting||!(ctx.get('srQuestion')||'').trim(),
              onClick:function(){ askJohnny(ctx.get('srQuestion')); ctx.set('srQuestion')(''); } })
          )
        ),
        e('h3', { style:{ fontSize:'14px', marginBottom:'10px' } }, 'Vorgeschlagene Fragen'),
        e('div', { style:{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'6px', marginBottom:'16px' } },
          QUESTIONS.map(function(q) {
            return e('div', { key:q, onClick:function(){ if (!reflecting) askJohnny(q); },
              style:{ padding:'10px 14px', background:'var(--bg-secondary)', borderRadius:'8px', cursor:reflecting?'not-allowed':'pointer', fontSize:'12px', border:'1px solid var(--border-color)', opacity:reflecting?0.5:1 }
            }, '💬 '+q);
          })
        ),
        reflecting && e('div', { style:{ textAlign:'center', padding:'20px' } }, e('div', { className:'loading' })),
        !reflecting && report && report.question && e('div', { className:'agent-card' },
          e('div', { style:{ fontSize:'12px', color:'var(--accent-primary)', marginBottom:'8px', fontStyle:'italic' } }, '"'+report.question+'"'),
          e('div', { style:{ whiteSpace:'pre-wrap', fontSize:'13px', lineHeight:'1.7', maxHeight:'400px', overflowY:'auto' } }, report.text)
        )
      ),

      // LOGS
      srTab === 'logs' && e('div', null,
        e('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' } },
          e('h3', { style:{ margin:0, fontSize:'14px' } }, 'System-Logs ('+logs.length+' Einträge)'),
          e(UI.DBtn, { label:'↻ Aktualisieren', small:true, onClick:loadAnalytics })
        ),
        logs.length === 0 && e('div', { style:{ textAlign:'center', padding:'40px', color:'var(--text-secondary)' } },
          e('div', { style:{ fontSize:'36px', marginBottom:'8px' } }, '📝'),
          e('div', null, 'Keine Logs geladen.'),
          e('div', { style:{ fontSize:'12px', marginTop:'6px' } }, 'Log-Datei: ~/.johnny/logs/'),
          e(UI.DBtn, { label:'↻ Jetzt laden', onClick:loadAnalytics, style:{ marginTop:'12px' } })
        ),
        logs.length > 0 && e('div', { style:{ background:'var(--bg-primary)', borderRadius:'10px', padding:'12px', fontFamily:'JetBrains Mono, monospace', fontSize:'11px', maxHeight:'550px', overflowY:'auto', lineHeight:'1.8' } },
          logs.slice().reverse().map(function(l, i) {
            var text = formatLog(l);
            var col  = logColor(l);
            return e('div', { key:i, style:{ color:col, borderBottom:'1px solid rgba(255,255,255,0.04)', padding:'3px 0', wordBreak:'break-all' } }, text);
          })
        )
      )
    );
  }

  return {
    projects:       viewProjectManager,
    selfreflection: viewSelfReflection,
  };
}

module.exports = { createExtendedViews: createExtendedViews };
