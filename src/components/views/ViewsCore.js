'use strict';
function createCoreViews(ctx, h, UI) {
  var e = React.createElement;
  var S = { input: { width:'100%', background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:'8px', padding:'9px 12px', color:'var(--text-primary)', fontSize:'14px', fontFamily:'inherit', outline:'none', boxSizing:'border-box' } };

function viewChat(){
    // ── Markdown Renderer (nutzt markdown-it) ──────────────────────────
    var md = null;
    try { md = require('markdown-it')({ html: false, linkify: true, breaks: true }); } catch(e) {}

    function renderMarkdown(text) {
      if (!md || !text) return e('div',{style:{whiteSpace:'pre-wrap'}}, text);
      try {
        var html = md.render(text);
        return e('div',{className:'markdown-body',dangerouslySetInnerHTML:{__html:html}});
      } catch(_) { return e('div',{style:{whiteSpace:'pre-wrap'}}, text); }
    }

    function extractCodeBlocks(text) {
      var blocks = [];
      var re = /```(\w+)?\n([\s\S]*?)```/g;
      var m;
      var idx = 0;
      while ((m = re.exec(text)) !== null) {
        idx++;
        var lang = m[1] || 'txt';
        var extMap = {javascript:'js',js:'js',typescript:'ts',ts:'ts',python:'py',
          py:'py',bash:'sh',shell:'sh',html:'html',css:'css',json:'json',
          cpp:'cpp',c:'c',rust:'rs',go:'go',java:'java',php:'php',ruby:'rb',sql:'sql'};
        var ext = extMap[lang.toLowerCase()] || lang;
        blocks.push({lang: lang, content: m[2], filename: 'code_'+idx+'.'+ext});
      }
      return blocks;
    }

    function saveCodeAsZip(msg) {
      var blocks = extractCodeBlocks(msg.content);
      if (blocks.length === 0) return;
      var files = blocks.map(function(b){ return {name: b.filename, content: b.content}; });
      var ts = new Date().toISOString().slice(0,10);
      ctx.inv('create-output-zip', {files: files, zipName: 'johnny-code-'+ts})
        .then(function(r){
          if (r && r.success) {
            ctx.set('savedMsg')('📦 ZIP gespeichert: '+r.path);
            setTimeout(function(){ ctx.set('savedMsg')(''); }, 5000);
            ctx.inv('open-output-folder');
          }
        });
    }

    function saveCodeFile(filename, content) {
      ctx.inv('write-output-file', {filename: filename, content: content})
        .then(function(r){
          if (r && r.success) {
            ctx.set('savedMsg')('💾 Gespeichert: '+r.path);
            setTimeout(function(){ ctx.set('savedMsg')(''); }, 4000);
          }
        });
    }

    function renderMessage(msg, i) {
      var blocks = msg.role === 'assistant' ? extractCodeBlocks(msg.content) : [];
      var hasCode = blocks.length > 0;
      return e('div',{key:i, className:'message '+msg.role},
        e('div',{className:'message-header'},
          e('div',{className:'message-avatar'}, msg.role==='user'?'U':(msg.agent||'J')[0]),
          e('span',null, msg.role==='user'?'You':(msg.agent||'Johnny')),
          e('span',{style:{marginLeft:'auto',fontSize:'11px',color:'var(--text-secondary)'}},
            new Date(msg.ts).toLocaleTimeString())
        ),
        e('div',{className:'message-content'},
          msg.role === 'assistant' ? renderMarkdown(msg.content) : e('div',{style:{whiteSpace:'pre-wrap'}}, msg.content)),
        // Copy button
        e('div',{style:{display:'flex',gap:'6px',marginTop:'4px'}},
          e('button',{style:{background:'none',border:'none',color:'var(--text-secondary)',cursor:'pointer',fontSize:'11px',padding:'2px 6px'},
            onClick:function(){ ctx.inv('set-clipboard-text',msg.content); h.notify('success','Kopiert!'); }}, '📋 Kopieren')
        ),
        // Code-Aktionen wenn Codeblöcke vorhanden
        hasCode && e('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'8px',paddingTop:'8px',borderTop:'1px solid rgba(255,255,255,0.08)'}},
          blocks.length === 1
            ? e('button',{
                style:{background:'rgba(0,255,136,0.1)',border:'1px solid rgba(0,255,136,0.3)',borderRadius:'6px',
                  padding:'4px 12px',cursor:'pointer',color:'var(--accent-primary)',fontSize:'12px',
                  fontFamily:'JetBrains Mono, monospace'},
                onClick:function(){ saveCodeFile(blocks[0].filename, blocks[0].content); }
              }, '💾 '+blocks[0].filename+' speichern')
            : null,
          e('button',{
            style:{background:'rgba(0,255,136,0.1)',border:'1px solid rgba(0,255,136,0.3)',borderRadius:'6px',
              padding:'4px 12px',cursor:'pointer',color:'var(--accent-primary)',fontSize:'12px',
              fontFamily:'JetBrains Mono, monospace'},
            onClick:function(){ saveCodeAsZip(msg); }
          }, '📦 Als ZIP speichern ('+(blocks.length)+' Datei'+(blocks.length>1?'en':'')+')'),
          e('button',{
            style:{background:'rgba(0,255,136,0.1)',border:'1px solid rgba(0,255,136,0.3)',borderRadius:'6px',
              padding:'4px 12px',cursor:'pointer',color:'var(--accent-primary)',fontSize:'12px',
              fontFamily:'JetBrains Mono, monospace'},
            onClick:function(){
              ctx.set('sandboxCode')(blocks[0].content);
              ctx.set('sandboxLang')(blocks[0].lang==='python'?'python':'javascript');
              ctx.set('view')('sandbox');
            }
          }, '⚗️ In Sandbox öffnen')
        )
      );
    }

    return e('div',{className:'chat-container',style:{display:'flex',gap:'0'}},
      // PRIO 5: Conversation Sidebar (collapsible)
      ctx.get('showConvSidebar') && e('div',{style:{width:'260px',borderRight:'1px solid var(--border-color)',display:'flex',flexDirection:'column',flexShrink:0,background:'var(--bg-secondary)'}},
        e('div',{style:{padding:'10px 12px',borderBottom:'1px solid var(--border-color)',display:'flex',gap:'6px',alignItems:'center'}},
          e('input',{value:ctx.get('convSearch')||'',onChange:function(ev){ctx.set('convSearch')(ev.target.value);},
            placeholder:'Suchen...',style:{flex:1,padding:'6px 10px',borderRadius:'6px',border:'1px solid var(--border-color)',background:'var(--bg-tertiary)',color:'var(--text-primary)',fontSize:'12px',outline:'none'}}),
          e('button',{onClick:function(){ctx.set('messages')([]);ctx.set('convId')(null);ctx.set('streamText')('');},
            style:{padding:'4px 8px',borderRadius:'6px',background:'var(--accent-primary)',border:'none',color:'#000',cursor:'pointer',fontSize:'11px',fontWeight:'700'}},'+ Neu')
        ),
        e('div',{style:{flex:1,overflowY:'auto',padding:'4px'}},
          (ctx.get('conversations')||[]).filter(function(c){
            var q = (ctx.get('convSearch')||'').toLowerCase();
            return !q || (c.title||c.id||'').toLowerCase().indexOf(q)>=0;
          }).slice(0,50).map(function(c){
            var isActive = ctx.get('convId')===c.id;
            return e('div',{key:c.id,style:{padding:'8px 10px',borderRadius:'6px',cursor:'pointer',marginBottom:'2px',
                background:isActive?'var(--accent-primary)':'transparent',
                color:isActive?'#000':'var(--text-primary)',position:'relative'}},
              e('div',{onClick:function(){
                  ctx.set('convId')(c.id);
                  ctx.inv('load-conversation',{conversationId:c.id,agentName:ctx.get('activeAgent')}).then(function(r){
                    if(r&&r.messages) ctx.set('messages')(r.messages.map(function(m){return{role:m.role,content:m.content,ts:m.timestamp||Date.now()};}));
                  });
                }},
                e('div',{style:{fontSize:'12px',fontWeight:isActive?'700':'400',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:'40px'}},
                  c.title||(c.preview||'').slice(0,40)||c.id),
                c.updatedAt && e('div',{style:{fontSize:'10px',color:isActive?'rgba(0,0,0,0.6)':'var(--text-secondary)',marginTop:'2px'}},
                  new Date(c.updatedAt).toLocaleDateString('de'))
              ),
              // Context actions
              e('div',{style:{position:'absolute',right:'6px',top:'8px',display:'flex',gap:'2px'}},
                e('button',{title:'Exportieren',onClick:function(ev){ev.stopPropagation();
                  ctx.inv('export-conversation',{conversationId:c.id,agentName:ctx.get('activeAgent')}).then(function(r){
                    if(r) h.notify('success','Exportiert');
                  });
                },style:{background:'none',border:'none',cursor:'pointer',fontSize:'10px',color:isActive?'rgba(0,0,0,0.5)':'var(--text-secondary)',padding:'2px'}},'📤'),
                e('button',{title:'Löschen',onClick:function(ev){ev.stopPropagation();
                  ctx.inv('delete-conversation',{conversationId:c.id,agentName:ctx.get('activeAgent')}).then(function(){
                    ctx.set('conversations')(function(prev){return (prev||[]).filter(function(x){return x.id!==c.id;});});
                    if(ctx.get('convId')===c.id){ctx.set('convId')(null);ctx.set('messages')([]);}
                    h.notify('info','Gespräch gelöscht');
                  });
                },style:{background:'none',border:'none',cursor:'pointer',fontSize:'10px',color:isActive?'rgba(0,0,0,0.5)':'var(--text-secondary)',padding:'2px'}},'✕')
              )
            );
          }),
          (ctx.get('conversations')||[]).length===0 && e('div',{style:{textAlign:'center',padding:'20px',color:'var(--text-secondary)',fontSize:'12px'}},'Keine Gespräche')
        )
      ),
      e('div',{style:{flex:1,display:'flex',flexDirection:'column'}},
      // Sidebar Toggle + Ollama Health Banner
      e('div',{style:{display:'flex',gap:'8px',alignItems:'center',padding:'4px 8px'}},
        e('button',{onClick:function(){ctx.set('showConvSidebar')(function(v){return !v;});if(!ctx.get('showConvSidebar'))ctx.actions.loadConversations();},
          style:{background:'none',border:'1px solid var(--border-color)',borderRadius:'6px',padding:'4px 8px',cursor:'pointer',color:'var(--text-secondary)',fontSize:'12px'}},
          ctx.get('showConvSidebar')?'◀ Sidebar':'☰ Gespräche'),
        ctx.get('convId') && e('span',{style:{fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace'}},ctx.get('convId').slice(0,8)+'...')
      ),
      // PRIO 2: Ollama Health Banner
      ctx.get('ollamaDown') && e('div',{style:{padding:'10px 16px',background:'rgba(231,76,60,0.1)',border:'1px solid rgba(231,76,60,0.3)',borderRadius:'8px',marginBottom:'8px',display:'flex',justifyContent:'space-between',alignItems:'center'}},
        e('span',{style:{fontSize:'13px',color:'#e74c3c'}},'⚠ Ollama nicht erreichbar — lokale Modelle nicht verfügbar'),
        e('div',{style:{display:'flex',gap:'8px'}},
          e('button',{style:{padding:'4px 12px',borderRadius:'6px',background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',color:'var(--text-primary)',cursor:'pointer',fontSize:'12px'},
            onClick:function(){ ctx.inv('list-ollama-models').then(function(v){ if(v&&v.length) ctx.set('ollamaDown')(false); }); }},'↻ Erneut prüfen'),
          ctx.get('providers').filter(function(p){return p.type==='api'&&p.hasKey;}).length>0 &&
            e('button',{style:{padding:'4px 12px',borderRadius:'6px',background:'var(--accent-primary)',border:'none',color:'#000',cursor:'pointer',fontSize:'12px',fontWeight:'600'},
              onClick:function(){ var cloud=ctx.get('providers').find(function(p){return p.type==='api'&&p.hasKey;}); if(cloud) ctx.actions.selectModel(cloud.models[0],cloud.id); }},'→ Cloud-Provider nutzen')
        )
      ),
      e('div',{className:'messages-area'},
        ctx.get('messages').length===0 && e('div',{style:{textAlign:'center',color:'var(--text-secondary)',marginTop:'80px'}},
          e('div',{style:{fontSize:'52px',marginBottom:'16px'}},'🤖'),
          e('div',{style:{fontSize:'20px',fontWeight:'700',color:'var(--text-primary)'}},'Johnny is ready'),
          e('div',{style:{marginTop:'8px',fontSize:'14px'}},
            'Talking to: ',e('span',{style:{color:'var(--accent-primary)',fontWeight:'600'}},ctx.get('activeAgent'))
          )
        ),
        ctx.get('messages').map(renderMessage),
        // Streaming-Antwort (live, wächst mit jedem Chunk)
        ctx.get('streamText') && e('div',{className:'message assistant'},
          e('div',{className:'message-header'},
            e('div',{className:'message-avatar'},ctx.get('activeAgent')[0]),
            e('span',null,ctx.get('activeAgent')),
            e('span',{style:{marginLeft:'8px',fontSize:'11px',color:'var(--accent-primary)',fontFamily:'JetBrains Mono, monospace'}},'● streaming')
          ),
          e('div',{className:'message-content'},renderMarkdown(ctx.get('streamText')))
        ),
        // Loading ohne Stream-Text
        ctx.get('loading') && !ctx.get('streamText') && e('div',{className:'message assistant'},
          e('div',{className:'message-header'},
            e('div',{className:'message-avatar'},ctx.get('activeAgent')[0]),
            e('span',null,ctx.get('activeAgent'))
          ),
          e('div',{className:'message-content'},
            ctx.get('toolSteps').length===0
              ? e('div',{className:'loading'})
              : e('div',null,
                  ctx.get('toolSteps').map(function(step,i){
                    return e('div',{key:i,style:{fontSize:'12px',fontFamily:'JetBrains Mono, monospace',
                      color:step.type==='error'?'#e74c3c':step.type==='tool'?'var(--accent-primary)':'var(--text-secondary)',
                      padding:'2px 0'}},
                      (step.type==='tool'?'⚙ ':step.type==='error'?'✗ ':step.type==='done'?'✓ ':'→ ')+step.message
                    );
                  }),
                  e('div',{className:'loading',style:{marginTop:'8px'}})
                )
          )
        ),
        e('div',{ref:h.messagesEndRef})
      ),
      ctx.get('agents').length>1 && e('div',{style:{marginBottom:'8px',display:'flex',gap:'6px',flexWrap:'wrap'}},
        ctx.get('agents').map(function(a){
          return e(UI.DChip,{key:a.name,label:a.name,active:ctx.get('activeAgent')===a.name,
            onClick:function(){ctx.set('activeAgent')(a.name);}});
        })
      ),
      // Image attachment preview
      ctx.get('chatImage') && e('div',{style:{padding:'6px 14px',background:'var(--bg-secondary)',borderRadius:'8px 8px 0 0',marginBottom:'-2px',display:'flex',alignItems:'center',gap:'8px',marginLeft:'44px'}},
        e('span',{style:{fontSize:'12px',color:'var(--accent-primary)'}},'📎 '+ctx.get('chatImage').name),
        e('button',{onClick:function(){ctx.set('chatImage')(null);},style:{background:'none',border:'none',color:'var(--text-secondary)',cursor:'pointer',fontSize:'14px'}},'✕')
      ),
      e('div',{className:'input-area',
        onDragOver:function(ev){ev.preventDefault();ev.currentTarget.style.borderColor='var(--accent-primary)';},
        onDragLeave:function(ev){ev.currentTarget.style.borderColor='';},
        onDrop:function(ev){
          ev.preventDefault();ev.currentTarget.style.borderColor='';
          var f=ev.dataTransfer.files[0];
          if(f && f.type.startsWith('image/')){
            ctx.set('chatImage')({name:f.name,path:f.path,type:f.type});
            h.notify('info','Bild angehängt: '+f.name);
          } else if(f) {
            ctx.set('input')(function(prev){return prev+'\n[Datei: '+f.path+']';});
          }
        }
      },
        e('textarea',{className:'message-input',value:ctx.get('input'),
          onChange:function(ev){ctx.set('input')(ev.target.value);},
          onKeyDown:h.handleKey,
          placeholder:'Message '+ctx.get('activeAgent')+'...',rows:'1'}),
        e('button',{
          onMouseDown:function(ev){ev.preventDefault(); if(!ctx.get('recording')) h.startRecording();},
          onMouseUp:function(ev){ev.preventDefault(); if(ctx.get('recording')) h.stopRecording();},
          onMouseLeave:function(ev){ev.preventDefault(); if(ctx.get('recording')) h.stopRecording();},
          onTouchStart:function(ev){ev.preventDefault(); if(!ctx.get('recording')) h.startRecording();},
          onTouchEnd:function(ev){ev.preventDefault(); if(ctx.get('recording')) h.stopRecording();},
          title: ctx.get('recording') ? 'Loslassen zum Senden' : 'Gedrückt halten zum Sprechen',
          style:{
            background: ctx.get('recording') ? '#e74c3c' : 'var(--bg-tertiary)',
            border:'2px solid '+(ctx.get('recording')?'#e74c3c':'var(--border-color)'),
            borderRadius:'8px', padding:'0 16px', cursor:'pointer',
            color: ctx.get('recording') ? '#fff' : 'var(--text-primary)',
            fontSize:'20px', flexShrink:0, minWidth:'48px',
            animation: ctx.get('recording') ? 'pulse 1s infinite' : 'none',
            userSelect:'none', WebkitUserSelect:'none'
          }
        }, ctx.get('recording') ? '⏹' : '🎤'),
        e('button',{
          onClick:function(){ ctx.set('ttsActive')(function(v){return !v;}); h.stopSpeaking(); },
          title: ctx.get('ttsActive') ? 'Sprachausgabe AN — Klicken zum Deaktivieren' : 'Sprachausgabe AUS — Klicken zum Aktivieren',
          style:{
            background: ctx.get('ttsActive') ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
            border:'2px solid '+(ctx.get('ttsActive')?'var(--accent-primary)':'var(--border-color)'),
            borderRadius:'8px', padding:'0 12px', cursor:'pointer',
            color: ctx.get('ttsActive') ? '#fff' : 'var(--text-secondary)',
            fontSize:'18px', flexShrink:0, minWidth:'44px',
            userSelect:'none', WebkitUserSelect:'none'
          }
        }, ctx.get('ttsActive') ? '🔊' : '🔇'),
        e('button',{className:'send-button',onClick:h.sendMessage,disabled:ctx.get('loading')},'SEND')
      ),
      ctx.get('voiceStatus') && e('div',{style:{
        fontSize:'13px', fontWeight:'600',
        color: ctx.get('voiceStatus').indexOf('❌')>=0 ? '#e74c3c' :
               ctx.get('voiceStatus').indexOf('✅')>=0 ? 'var(--success)' :
               ctx.get('voiceStatus').indexOf('🔴')>=0 ? '#e74c3c' : 'var(--accent-primary)',
        padding:'6px 14px', fontFamily:'JetBrains Mono, monospace',
        background:'var(--bg-secondary)', borderRadius:'0 0 8px 8px',
        marginTop:'-2px'
      }}, ctx.get('voiceStatus'))
    ) // close flex content div
    ); // close chat-container
  }

function viewAgents(){
    return e('div',null,
      /* header */
      e('div',{style:{marginBottom:'20px',display:'flex',justifyContent:'space-between',alignItems:'center'}},
        e('h2',null,'Agents ('+ctx.get('agents').length+')'),
        e('button',{className:'btn btn-primary',onClick:h.openCreateAgent},'+ Create Agent')
      ),
      /* empty state */
      ctx.get('agents').length===0 && e('p',{style:{color:'var(--text-secondary)'}},'No agents yet. Create one above.'),
      /* agent cards */
      ctx.get('agents').map(function(agent){
        return e('div',{key:agent.name,className:'agent-card',style:{
          border:ctx.get('activeAgent')===agent.name?'1px solid var(--accent-primary)':'1px solid var(--border-color)',
          marginBottom:'12px'
        }},
          e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px'}},
            e('div',{style:{flex:1}},
              e('div',{className:'agent-name'},agent.name),
              e('div',{className:'agent-role'},agent.role||'AI Assistant'),
              e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',marginTop:'6px',fontFamily:'JetBrains Mono, monospace'}},
                (agent.modelProvider||'ollama')
              ),
              e('div',{style:{marginTop:'6px',display:'flex',alignItems:'center',gap:'8px'}},
                e('span',{style:{fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace'}},'Modell:'),
                e('select',{
                    value:(agent.model||ctx.get('activeModel')),
                    onChange:function(ev){
                      var val=ev.target.value;
                      var parts=val.split('::');
                      var nm=parts[0], prov=parts[1]||agent.modelProvider||'ollama';
                      ctx.inv('update-agent-model',{agentName:agent.name,model:nm,modelProvider:prov})
                        .then(function(r){
                          if(r&&r.success) ctx.set('agents')(function(prev){return prev.map(function(a){return a.name===agent.name?Object.assign({},a,{model:nm,modelProvider:prov}):a;});});
                          else alert('Fehler: '+(r&&r.error));
                        }).catch(function(e){ alert('Fehler: '+e.message); });
                    },
                    style:{background:'var(--bg-tertiary)',border:'1px solid var(--accent-primary)',borderRadius:'6px',
                      padding:'2px 8px',color:'var(--accent-primary)',fontSize:'11px',fontFamily:'JetBrains Mono, monospace',cursor:'pointer'}
                  },
                  // Ollama models
                  ctx.get('models').length>0 && e('optgroup',{label:'Ollama (lokal)'},
                    ctx.get('models').map(function(m){return e('option',{key:'ol:'+m.name,value:m.name+'::ollama'},m.name);})),
                  // Cloud provider models — show ALL providers, mark those without keys
                  ctx.get('providers').filter(function(p){return p.type==='api';}).map(function(p){
                    return e('optgroup',{key:p.id,label:p.name+(p.hasKey?'':' ⚠ Kein Key')},
                      (p.models||[]).map(function(m){return e('option',{key:p.id+':'+m,value:m+'::'+p.id,disabled:!p.hasKey},m+(p.hasKey?'':' (Key fehlt)'));})
                    );
                  })
                )
              ),
              e('div',{style:{marginTop:'8px',display:'flex',flexWrap:'wrap',gap:'4px'}},
                (Array.isArray(agent.capabilities)?agent.capabilities:[]).map(function(cap){
                  return e('span',{key:cap,className:'agent-badge'},cap);
                }),
                agent.isCore && e('span',{className:'agent-badge',style:{borderColor:'var(--accent-primary)',color:'var(--accent-primary)'}},'CORE')
              )
            ),
            e('div',{style:{display:'flex',flexDirection:'column',gap:'8px',flexShrink:0}},
              e('button',{className:'btn btn-primary',
                style:{padding:'7px 14px',fontSize:'13px'},
                onClick:function(){ctx.set('activeAgent')(agent.name);ctx.set('view')('chat');}
              },'💬 Chat'),
              !agent.isCore && e('button',{className:'btn',
                style:{padding:'7px 14px',fontSize:'13px',borderColor:'#e74c3c',color:'#e74c3c'},
                onClick:function(){h.deleteAgent(agent.name);}
              },'Delete')
            )
          )
        );
      }),
    );
  }

function viewModels(){
    return e('div',null,
      // Aktives Modell Banner
      e('div',{style:{
        background:'linear-gradient(135deg,var(--accent-primary) 0%,var(--accent-hover,#45d4b8) 100%)',
        borderRadius:'12px',padding:'20px 24px',marginBottom:'20px',
        display:'flex',justifyContent:'space-between',alignItems:'center'
      }},
        e('div',null,
          e('div',{style:{fontSize:'11px',fontWeight:'700',textTransform:'uppercase',letterSpacing:'1px',color:'rgba(0,0,0,0.6)',marginBottom:'4px'}},'Aktives Modell — klicke unten zum Wechseln'),
          e('div',{style:{fontSize:'22px',fontWeight:'800',color:'#000',fontFamily:'JetBrains Mono, monospace'}},ctx.get('activeModel')||'(kein Modell)'),
          e('div',{style:{fontSize:'12px',color:'rgba(0,0,0,0.5)',marginTop:'2px'}},
            'Provider: '+(ctx.get('activeProvider')||'ollama').toUpperCase())
        ),
        e('div',{style:{fontSize:'36px'}},'🧠')
      ),
      e('div',{className:'agent-card',style:{marginBottom:'24px'}},
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}},
          e('h3',{style:{margin:0}},'Installierte Ollama Modelle ('+ctx.get('models').length+')'),
          e('button',{className:'btn',onClick:ctx.actions.loadModels,style:{padding:'6px 14px',fontSize:'13px'}},'↻ Refresh')
        ),
        ctx.get('models').length===0
          ? e('p',{style:{color:'var(--warning)'}},'⚠ No models found. Make sure Ollama is running, then Refresh.')
          : ctx.get('models').map(function(m){
              var isActive = ctx.get('activeModel')===m.name && ctx.get('activeProvider')==='ollama';
              return e('div',{key:m.name,style:{
                display:'flex',justifyContent:'space-between',alignItems:'center',
                padding:'12px 16px',background: isActive ? 'rgba(var(--accent-rgb,52,211,153),0.12)' : 'var(--bg-tertiary)',
                borderRadius:'8px',marginBottom:'6px',
                border: isActive ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)'
              }},
                e('div',{style:{display:'flex',alignItems:'center',gap:'12px'}},
                  e('div',{style:{
                    width:'10px',height:'10px',borderRadius:'50%',flexShrink:0,
                    background: isActive ? 'var(--accent-primary)' : 'var(--border-color)'
                  }}),
                  e('span',{style:{fontFamily:'JetBrains Mono, monospace',fontSize:'14px',fontWeight: isActive?'700':'400',
                    color:isActive?'var(--accent-primary)':'var(--text-primary)'}},m.name)
                ),
                e('div',{style:{display:'flex',gap:'10px',alignItems:'center'}},
                  e('span',{style:{fontSize:'12px',color:'var(--text-secondary)'}},m.size?(m.size/1073741824).toFixed(1)+' GB':''),
                  isActive
                    ? e('span',{style:{fontSize:'12px',color:'var(--accent-primary)',fontWeight:'700',
                        padding:'3px 10px',border:'1px solid var(--accent-primary)',borderRadius:'20px'}},'✓ AKTIV')
                    : e('button',{
                        className:'btn btn-primary',
                        onClick:function(){ctx.actions.selectModel(m.name,'ollama');},
                        style:{padding:'4px 14px',fontSize:'12px'}
                      },'Aktivieren')
                )
              );
            }),
        e('div',{style:{marginTop:'16px',borderTop:'1px solid var(--border-color)',paddingTop:'16px'}},
          e('div',{style:{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'8px',fontWeight:'600'}},'Pull new model:'),
          e('div',{style:{display:'flex',gap:'8px'}},
            e('input',{type:'text',value:ctx.get('pullName'),onChange:function(ev){ctx.set('pullName')(ev.target.value);},
              placeholder:'e.g. llama3:8b, mistral:7b',
              onKeyDown:function(ev){if(ev.key==='Enter')ctx.actions.doPull();},
              style:Object.assign({},S.input,{flex:1,fontFamily:'JetBrains Mono, monospace'})}),
            e('button',{className:'btn btn-primary',onClick:ctx.actions.doPull,disabled:ctx.get('pulling')||!ctx.get('pullName').trim(),style:{padding:'9px 18px'}},
              ctx.get('pulling')?'...':'Pull')
          ),
          ctx.get('pullStatus') && e('div',{style:{marginTop:'8px',fontSize:'13px',padding:'7px 12px',background:'var(--bg-primary)',
            borderRadius:'6px',fontFamily:'JetBrains Mono, monospace',
            color:ctx.get('pullStatus').indexOf('Error')>=0?'#e74c3c':'var(--success)'}},ctx.get('pullStatus')),
          e('div',{style:{marginTop:'6px',fontSize:'11px',color:'var(--text-secondary)'}},'Popular: gemma2:2b · llama3:8b · mistral:7b · codellama:7b · deepseek-r1:8b')
        )
      ),
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}},
        e('h3',{style:{margin:0}},'Cloud Providers'),
        e(UI.DBtn,{label:'↻ Provider neu laden',small:true,onClick:function(){
          ctx.inv('get-providers').then(function(v){ if(v) ctx.set('providers')(v); });
        }})
      ),
      ctx.get('providers').filter(function(p){return p.type==='api';}).length===0
        ? e('p',{style:{color:'var(--text-secondary)'}},'Loading...')
        : ctx.get('providers').filter(function(p){return p.type==='api';}).map(function(p){
            var isProviderActive = ctx.get('activeProvider')===p.id;
            return e('div',{key:p.id,className:'agent-card',style:{
              marginBottom:'12px',
              border: isProviderActive ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)'
            }},
              e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}},
                e('div',null,
                  e('div',{style:{fontWeight:'700',fontSize:'15px'}},p.name),
                  e('div',{style:{fontSize:'12px',color: p.hasKey ? 'var(--success)' : 'var(--warning)', marginTop:'4px'}},
                    p.hasKey ? 'API Key configured' : 'No API key — set key to use')
                ),
                e('button',{className:'btn',onClick:function(){h.openApiKey(p);},style:{padding:'5px 12px',fontSize:'12px'}},
                  p.hasKey ? 'Update Key' : 'Set API Key')
              ),
              e('div',{style:{display:'flex',flexWrap:'wrap',gap:'6px'}},
                (p.models||[]).map(function(m){
                  var isActive = ctx.get('activeModel')===m && isProviderActive;
                  return e('button',{
                    key:m,
                    onClick:function(){ctx.actions.selectCloudModel(p.id, m);},
                    disabled:!p.hasKey,
                    style:{
                      background: isActive ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                      color: isActive ? '#000' : (p.hasKey ? 'var(--text-primary)' : 'var(--text-secondary)'),
                      border: '1px solid ' + (isActive ? 'var(--accent-primary)' : 'var(--border-color)'),
                      borderRadius:'6px', padding:'4px 12px', cursor: p.hasKey ? 'pointer' : 'not-allowed',
                      fontSize:'12px', fontFamily:'JetBrains Mono, monospace',
                      fontWeight: isActive ? '700' : '400', opacity: p.hasKey ? 1 : 0.5
                    }
                  }, isActive ? '[ACTIVE] '+m : m);
                })
              )
            );
          }),
    );
  }

function viewDashboard(){
    var stats = ctx.get('sysstats');
    var agents = ctx.get('agents');
    var tasks = ctx.get('tasks');
    var doneTasks = tasks.filter(function(t){return t.status==='done';}).length;
    var activeTasks = tasks.filter(function(t){return t.status==='running';}).length;
    var sbStatus = ctx.get('sandboxStatus');
    return e('div',null,
      e('h2',{style:{marginBottom:'20px'}},'Dashboard'),
      // Status Banner
      e('div',{style:{background:'var(--bg-secondary)',border:'1px solid var(--accent-primary)',borderRadius:'12px',
        padding:'16px 20px',marginBottom:'20px',display:'flex',gap:'24px',flexWrap:'wrap',alignItems:'center'}},
        e('div',null,
          e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',textTransform:'uppercase'}},'Active Model'),
          e('div',{style:{fontFamily:'JetBrains Mono, monospace',fontWeight:'700',color:'var(--accent-primary)',fontSize:'14px'}},
            (ctx.get('activeProvider')!=='ollama'?ctx.get('activeProvider').toUpperCase()+'/':'')+ctx.get('activeModel')
          )
        ),
        e('div',{style:{width:'1px',background:'var(--border-color)',alignSelf:'stretch'}}),
        e('div',null,
          e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',textTransform:'uppercase'}},'Agents'),
          e('div',{style:{fontFamily:'JetBrains Mono, monospace',fontWeight:'700',fontSize:'20px'}},agents.length)
        ),
        e('div',null,
          e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',textTransform:'uppercase'}},'Tasks done'),
          e('div',{style:{fontFamily:'JetBrains Mono, monospace',fontWeight:'700',fontSize:'20px',color:'var(--success)'}},doneTasks)
        ),
        e('div',null,
          e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',textTransform:'uppercase'}},'Running'),
          e('div',{style:{fontFamily:'JetBrains Mono, monospace',fontWeight:'700',fontSize:'20px',
            color:activeTasks>0?'var(--warning)':'var(--text-secondary)'}},activeTasks)
        ),
        stats && stats.cpu && stats.memory && e('div',null,
          e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',textTransform:'uppercase'}},'System'),
          e('div',{style:{fontFamily:'JetBrains Mono, monospace',fontSize:'13px'}},
            'CPU '+stats.cpu.usage.toFixed(0)+'%  MEM '+stats.memory.percentage.toFixed(0)+'%')
        )
      ),
      // Agents quick view
      e('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'12px',marginBottom:'20px'}},
        agents.map(function(a){
          return e('div',{key:a.name,className:'agent-card',style:{cursor:'pointer'},
            onClick:function(){ ctx.set('activeAgent')(a.name); ctx.set('view')('chat'); }},
            e('div',{style:{fontWeight:'700',fontSize:'14px',marginBottom:'4px'}},a.name),
            e('div',{style:{fontSize:'12px',color:'var(--text-secondary)'}},a.role||'AI Assistant'),
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace',marginTop:'6px'}},
              (a.modelProvider||'ollama')+'/'+(a.model||ctx.get('activeModel'))),
            e('div',{style:{marginTop:'8px',display:'flex',flexWrap:'wrap',gap:'4px'}},
              (a.capabilities||[]).slice(0,3).map(function(c){
                return e('span',{key:c,className:'agent-badge',style:{fontSize:'10px'}},c);
              }),
              (a.capabilities||[]).length>3 && e('span',{className:'agent-badge',style:{fontSize:'10px'}},
                '+'+(a.capabilities.length-3)+' more')
            )
          );
        })
      ),
      // Recent Tasks
      e('h3',{style:{marginBottom:'12px'}},'Recent Tasks'),
      tasks.length===0
        ? e('p',{style:{color:'var(--text-secondary)'}},'No tasks yet. Chat with Johnny to create tasks!')
        : e('div',null,
            tasks.slice(0,5).map(function(t){
              var col = t.status==='done'?'var(--success)':t.status==='error'?'#e74c3c':'var(--warning)';
              return e('div',{key:t.id,style:{
                padding:'10px 14px',background:'var(--bg-secondary)',borderRadius:'8px',
                marginBottom:'6px',borderLeft:'3px solid '+col
              }},
                e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
                  e('span',{style:{fontWeight:'600',fontSize:'13px'}},'['+t.agent+'] '+(t.message||'').slice(0,60)),
                  e('span',{style:{fontSize:'11px',color:col,fontFamily:'JetBrains Mono, monospace'}},t.status)
                ),
                t.steps && t.steps.length>0 && e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},
                  t.steps.length+' step'+(t.steps.length!==1?'s':''))
              );
            }),
            tasks.length>5 && e('div',{style:{textAlign:'center',marginTop:'8px'}},
              e('button',{className:'btn',onClick:function(){ctx.set('view')('tasks');},style:{fontSize:'12px',padding:'5px 14px'}},
                'View all '+tasks.length+' tasks')
            )
          ),
      // Sandbox Status
      e('h3',{style:{marginBottom:'12px',marginTop:'20px'}},'Code Sandbox'),
      e('div',{className:'agent-card',style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
        e('div',null,
          e('div',{style:{fontWeight:'600'}},
            'Mode: '+(sbStatus?sbStatus.resolvedMode||sbStatus.mode||ctx.get('sandboxMode'):ctx.get('sandboxMode'))),
          e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',marginTop:'4px'}},
            sbStatus && sbStatus.dockerAvailable ? 'Docker available' : 'Docker not available — using process/direct mode')
        ),
        e('button',{className:'btn btn-primary',onClick:function(){ctx.set('view')('sandbox');},style:{padding:'7px 16px',fontSize:'13px'}},
          'Open Sandbox')
      )
    );
  }

function viewTasks(){
    var all = ctx.get('tasks');
    var filter = ctx.get('taskFilter');
    var filtered = filter==='all' ? all : all.filter(function(t){return t.status===filter;});
    var counts = {all:all.length,running:0,done:0,error:0};
    all.forEach(function(t){ if(counts[t.status]!==undefined) counts[t.status]++; });
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',{style:{margin:0}},'Tasks & Workflow'),
        e('div',{style:{display:'flex',gap:'8px'}},
          e('button',{className:'btn',onClick:h.refreshTasks,style:{padding:'6px 14px',fontSize:'13px'}},'Refresh'),
          e('button',{className:'btn',onClick:h.clearTasks,
            style:{padding:'6px 14px',fontSize:'13px',borderColor:'#e74c3c',color:'#e74c3c'}},'Clear All')
        )
      ),
      // Filter tabs
      e('div',{style:{display:'flex',gap:'6px',marginBottom:'16px'}},
        [{k:'all',l:'All ('+counts.all+')'},{k:'running',l:'Running ('+counts.running+')'},
         {k:'done',l:'Done ('+counts.done+')'},{k:'error',l:'Errors ('+counts.error+')'}].map(function(f){
          return e('button',{key:f.k,
            style:{padding:'6px 16px',borderRadius:'20px',cursor:'pointer',fontSize:'12px',fontFamily:'JetBrains Mono, monospace',
              background: filter===f.k?'var(--accent-primary)':'var(--bg-tertiary)',
              color: filter===f.k?'#000':'var(--text-primary)',
              border:'1px solid '+(filter===f.k?'var(--accent-primary)':'var(--border-color)')
            },
            onClick:function(){ctx.set('taskFilter')(f.k);}
          },f.l);
        })
      ),
      filtered.length===0
        ? e('p',{style:{color:'var(--text-secondary)'}},'No tasks.')
        : filtered.map(function(t){
            var statusCol = t.status==='done'?'var(--success)':t.status==='error'?'#e74c3c':'var(--warning)';
            return e('div',{key:t.id,className:'agent-card',style:{marginBottom:'10px',borderLeft:'3px solid '+statusCol}},
              e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'8px'}},
                e('div',{style:{flex:1}},
                  e('div',{style:{fontWeight:'700',fontSize:'14px',marginBottom:'2px'}},'['+t.agent+'] '+(t.message||'').slice(0,80)),
                  t.created && e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace'}},
                    new Date(t.created).toLocaleTimeString())
                ),
                e('span',{style:{fontSize:'12px',fontWeight:'700',color:statusCol,fontFamily:'JetBrains Mono, monospace',
                  background:'var(--bg-tertiary)',padding:'3px 10px',borderRadius:'12px',flexShrink:0}},t.status)
              ),
              t.steps && t.steps.length>0 && e('div',{style:{background:'var(--bg-primary)',borderRadius:'6px',padding:'8px 12px'}},
                t.steps.map(function(step,i){
                  var icon = step.type==='done'?'[ok]':step.type==='error'?'[!]':step.type==='tool'?'[t]':'[~]';
                  return e('div',{key:i,style:{
                    fontSize:'12px',fontFamily:'JetBrains Mono, monospace',
                    color:step.type==='error'?'#e74c3c':step.type==='done'?'var(--success)':'var(--text-secondary)',
                    padding:'2px 0'
                  }},icon+' '+(step.message||'').slice(0,100));
                })
              )
            );
          })
    );
  }

function viewSettings(){
    return e('div',null,
      e('h2',{style:{marginBottom:'24px'}},'Settings'),
      e('div',{className:'agent-card',style:{marginBottom:'16px'}},
        e('h3',{style:{marginBottom:'18px'}},'Ollama'),
        e(UI.DField,{label:'Server URL'},e(UI.DInput,{value:ctx.get('ollamaUrl'),onChange:ctx.set('ollamaUrl'),placeholder:'http://127.0.0.1:11434'})),
        e(UI.DField,{label:'Default Model'},e(UI.DInput,{value:ctx.get('activeModel'),onChange:ctx.set('activeModel'),placeholder:'llama3:latest'})),
        ctx.get('models').length>0 && e('div',{style:{display:'flex',flexWrap:'wrap',gap:'6px',marginTop:'6px'}},
          ctx.get('models').map(function(m){ return e(UI.DChip,{key:m.name,label:m.name,active:ctx.get('activeModel')===m.name&&ctx.get('activeProvider')==='ollama',onClick:function(){ctx.actions.selectModel(m.name,'ollama');}}); })
        )
      ),
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('h3',{style:{marginBottom:'18px'}},'Telegram Bot'),
        e(UI.DField,{label:'Bot Token',hint:'Get from @BotFather'},e(UI.DInput,{type:'password',value:ctx.get('tgToken'),onChange:ctx.set('tgToken'),placeholder:'123456:ABCdef...'})),
        e(UI.DField,{label:'Whitelist (Telegram-User-IDs)',hint:'Komma-getrennt. Leer = alle abgewiesen. Eigene ID: /start schicken.'},
          e(UI.DInput,{value:(ctx.get('tgWhitelist')||[]).join(','),
            onChange:function(v){
              var ids=(v||'').split(',').map(function(s){return parseInt(s.trim(),10);}).filter(Boolean);
              ctx.set('tgWhitelist')(ids);
              ctx.inv('telegram:set-whitelist',ids);
            },placeholder:'123456789,987654321'})),
        e(UI.DField,{label:'Dev-Modus (alle erlauben)'},
          e('label',{style:{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}},
            e('input',{type:'checkbox',checked:!!ctx.get('tgAllowAll'),onChange:function(ev){
              ctx.set('tgAllowAll')(ev.target.checked);
              ctx.inv('telegram:set-allow-all',ev.target.checked);
            }}),
            e('span',{style:{fontSize:'13px',color:'var(--warning)'}},'⚠ Alle Telegram-User dürfen Johnny steuern (nur für Tests!)')
          )
        )
      ),
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('h3',{style:{marginBottom:'14px'}},'🔒 Messenger Zugangskontrolle'),
        e('div',{style:{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'12px',lineHeight:'1.6'}},
          'Whiteliste Sender-IDs für Discord, WhatsApp, Slack, Matrix und Signal. ',
          'Leere Whitelist = alle Nachrichten werden abgewiesen. ',
          e('br'),
          'Dev-Bypass: Alle erlauben (alle Messenger)'
        ),
        e(UI.DField,{label:'Dev-Modus: Alle Messenger ohne Auth'},
          e('label',{style:{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}},
            e('input',{type:'checkbox',checked:!!ctx.get('messengerAllowAll'),onChange:function(ev){
              ctx.set('messengerAllowAll')(ev.target.checked);
              ctx.inv('messenger:set-allow-all',ev.target.checked);
            }}),
            e('span',{style:{fontSize:'13px',color:'var(--warning)'}},'⚠ Nur für lokale Tests!')
          )
        ),
        ['discord','whatsapp','slack','matrix','signal'].map(function(ms){
          var key='messengerWl_'+ms;
          return e(UI.DField,{key:ms,label:ms.charAt(0).toUpperCase()+ms.slice(1)+' Whitelist',hint:'Sender-IDs komma-getrennt. Leer = alle abgewiesen.'},
            e(UI.DInput,{value:(ctx.get(key)||[]).join(','),
              onChange:function(v){
                var ids=(v||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
                ctx.set(key)(ids);
                ctx.inv('messenger:set-whitelist',{messenger:ms,ids:ids});
              },placeholder:'User-ID-1, User-ID-2...'})
          );
        })
      ),
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('h3',{style:{marginBottom:'14px'}},'Code Sandbox'),
        e('div',{style:{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'12px'}},'Controls how Johnny executes code. Docker = most secure.'),
        e('div',{style:{display:'flex',gap:'8px',flexWrap:'wrap'}},
          [{v:'auto',l:'Auto'},{v:'docker',l:'Docker'},{v:'process',l:'Process'},{v:'direct',l:'Direct'}].map(function(opt){
            return e('button',{key:opt.v,
              className:ctx.get('sandboxMode')===opt.v?'btn btn-primary':'btn',
              onClick:function(){h.setSandboxMode(opt.v);},
              style:{padding:'6px 16px',fontSize:'13px'}},opt.l);
          })
        ),
        e('div',{style:{marginTop:'8px',fontSize:'12px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace'}},
          'Current: '+(ctx.get('sandboxStatus')?ctx.get('sandboxStatus').resolvedMode||ctx.get('sandboxStatus').mode:ctx.get('sandboxMode')))
      ),
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('h3',{style:{marginBottom:'14px'}},'Sprache / Voice'),
        e('div',{style:{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'12px'}},
          'Spracheingabe per Mikrofon-Button (gedrückt halten). Johnny antwortet auf Deutsch und Englisch.'),
        e(UI.DField,{label:'Sprache für Whisper-Transkription'},
          e(UI.DSelect,{value:ctx.get('voiceLang'),onChange:function(v){ ctx.set('voiceLang')(v); ctx.inv('save-settings',{voiceLanguage:v}); },options:[
            {value:'de',label:'Deutsch'},{value:'en',label:'English'},{value:'auto',label:'Auto-Detect'}
          ]})
        ),
        e(UI.DField,{label:'TTS Antwort-Stimme'},
          e(UI.DSelect,{value:ctx.get('ttsProvider'),onChange:function(v){ ctx.set('ttsProvider')(v); ctx.inv('save-settings',{ttsProvider:v}); },options:[
            {value:'browser',label:'Browser TTS (kostenlos)'},
            {value:'openai-tts',label:'OpenAI TTS (natürlich, benötigt API-Key)'},
            {value:'elevenlabs',label:'ElevenLabs (Premium, benötigt API-Key)'},
            {value:'off',label:'Keine Sprachausgabe'}
          ]})
        ),
        ctx.get('ttsProvider')==='openai-tts' && e(UI.DField,{label:'OpenAI TTS Stimme'},
          e(UI.DSelect,{value:ctx.get('openaiTtsVoice')||'nova',onChange:function(v){ ctx.set('openaiTtsVoice')(v); ctx.inv('save-settings',{openaiTtsVoice:v}); },options:[
            {value:'nova',label:'Nova (freundlich, weiblich)'},
            {value:'alloy',label:'Alloy (neutral)'},
            {value:'echo',label:'Echo (männlich)'},
            {value:'fable',label:'Fable (britisch)'},
            {value:'onyx',label:'Onyx (tief, männlich)'},
            {value:'shimmer',label:'Shimmer (warm, weiblich)'}
          ]})
        ),
        ctx.get('ttsProvider')==='elevenlabs' && e(UI.DField,{label:'ElevenLabs API-Key'},
          e('input',{type:'password',className:'form-input',
            placeholder:'sk-... ElevenLabs API Key',
            defaultValue:ctx.get('elevenlabsKey')||'',
            onBlur:function(ev){ ctx.inv('save-settings',{elevenlabsKey:ev.target.value}); }})
        ),
        e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',marginTop:'8px',lineHeight:'1.6'}},
          e('div',{style:{fontWeight:'600',marginBottom:'4px'}},'Whisper Installation (Open Source):'),
          e('div',null,'pip install openai-whisper — oder sage Johnny: "installiere Whisper"'),
          e('div',{style:{marginTop:'6px',fontWeight:'600'}},'Natürliche Stimmen (kostenpflichtig):'),
          e('div',null,'OpenAI TTS: $15/1M Zeichen | ElevenLabs: ab $5/Monat')
        )
      ),
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('h3',{style:{marginBottom:'14px'}},'💰 Token-Budget'),
        e('div',{style:{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'12px',lineHeight:'1.6'}},
          'Tages-Token-Limit pro Cloud-Provider. 0 = kein Limit. Warnung bei 80%, Stopp bei 100%.'),
        e('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}},
          ['openai','anthropic','google','groq','mistral'].map(function(p){
            return e(UI.DField,{key:p,label:p.charAt(0).toUpperCase()+p.slice(1)+' (Tokens/Tag)'},
              e(UI.DInput,{type:'text',value:String(ctx.get('tokenBudget_'+p)||0),
                onChange:function(v){
                  var n=parseInt(v,10)||0;
                  ctx.set('tokenBudget_'+p)(n);
                },
                onBlur:function(){
                  var limits={};
                  ['openai','anthropic','google','groq','mistral'].forEach(function(pp){
                    var val=ctx.get('tokenBudget_'+pp);
                    if(val&&val>0) limits[pp]=val;
                  });
                  ctx.inv('token-budget:set',limits);
                },
                placeholder:'0 = kein Limit'})
            );
          })
        ),
        e('div',{style:{marginTop:'10px'}},
          e(UI.DBtn,{label:'Heutiger Verbrauch',small:true,onClick:function(){
            ctx.inv('token-budget:usage').then(function(v){
              if(v&&v.today){
                var parts=Object.entries(v.today).map(function(e){return e[0]+': '+JSON.stringify(e[1]);});
                alert('Token-Verbrauch heute:\n'+(parts.length?parts.join('\n'):'(noch nichts)'));
              }
            });
          }})
        )
      ),
      e('div',{style:{display:'flex',alignItems:'center',gap:'16px',marginBottom:'32px'}},
        e('button',{className:'btn btn-primary',onClick:ctx.actions.saveSettings},'Save Settings'),
        ctx.get('savedMsg') && e('span',{style:{color:ctx.get('savedMsg').indexOf('Error')>=0?'#e74c3c':'var(--success)',fontSize:'14px',fontWeight:'600'}},ctx.get('savedMsg'))
      ),
      // Integration Keys
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('h3',{style:{marginBottom:'14px'}},'🏡 Smart Home — Home Assistant'),
        e(UI.DField,{label:'HA URL'},e(UI.DInput,{value:ctx.get('haUrl')||'',onChange:function(v){ctx.set('haUrl')(v);},placeholder:'http://192.168.1.x:8123'})),
        e(UI.DField,{label:'Long-Lived Access Token'},e(UI.DInput,{type:'password',value:ctx.get('haToken')||'',onChange:function(v){ctx.set('haToken')(v);},placeholder:'eyJ...'})),
        e(UI.DBtn,{label:'Speichern',primary:true,onClick:function(){
          ctx.inv('save-settings',{'settings.haUrl':ctx.get('haUrl'),'settings.haToken':ctx.get('haToken')})
            .then(function(){ ctx.set('savedMsg')('HA-Config gespeichert!'); setTimeout(function(){ctx.set('savedMsg')('');},2500); });
        }})
      ),
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('h3',{style:{marginBottom:'14px'}},'🎵 Spotify Integration'),
        e(UI.DField,{label:'Client ID'},e(UI.DInput,{value:ctx.get('spotifyClientId')||'',onChange:function(v){ctx.set('spotifyClientId')(v);},placeholder:'Spotify Developer Dashboard → App → Client ID'})),
        e(UI.DField,{label:'Client Secret'},e(UI.DInput,{type:'password',value:ctx.get('spotifyClientSecret')||'',onChange:function(v){ctx.set('spotifyClientSecret')(v);},placeholder:'Client Secret'})),
        e(UI.DBtn,{label:'Speichern',primary:true,onClick:function(){
          ctx.inv('save-settings',{'apiKeys.spotifyClientId':ctx.get('spotifyClientId'),'apiKeys.spotifyClientSecret':ctx.get('spotifyClientSecret')})
            .then(function(){ ctx.set('savedMsg')('Spotify-Config gespeichert!'); setTimeout(function(){ctx.set('savedMsg')('');},2500); });
        }})
      ),
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('h3',{style:{marginBottom:'14px'}},'🐙 GitHub Integration'),
        e(UI.DField,{label:'Personal Access Token',hint:'Settings → Developer settings → Personal access tokens → Fine-grained'},
          e(UI.DInput,{type:'password',value:ctx.get('githubToken')||'',onChange:function(v){ctx.set('githubToken')(v);},placeholder:'ghp_...'})
        ),
        e(UI.DBtn,{label:'Speichern',primary:true,onClick:function(){
          ctx.inv('save-settings',{'apiKeys.github':ctx.get('githubToken')})
            .then(function(){ ctx.set('savedMsg')('GitHub-Token gespeichert!'); setTimeout(function(){ctx.set('savedMsg')('');},2500); });
        }})
      ),
      e('button',{onClick:function(){ctx.set('showDebug')(function(d){return !d;});},
        style:{background:'none',border:'1px solid var(--border-color)',borderRadius:'8px',color:'var(--text-secondary)',padding:'6px 14px',cursor:'pointer',fontSize:'12px'}},
        ctx.get('showDebug')?'▾ Hide Debug Log':'▸ Show Debug Log'),
      ctx.get('showDebug') && e('div',{style:{marginTop:'12px',background:'var(--bg-primary)',borderRadius:'8px',padding:'12px',
        fontFamily:'JetBrains Mono, monospace',fontSize:'11px',color:'var(--text-secondary)',maxHeight:'250px',overflowY:'auto',lineHeight:1.8}},
        ctx.get('debugLog').length===0?'No log entries':ctx.get('debugLog').map(function(l,i){return e('div',{key:i},l);})
      )
    );
  }

  return {
    chat: viewChat, dashboard: viewDashboard, agents: viewAgents,
    models: viewModels, tasks: viewTasks, settings: viewSettings,
  };
}
module.exports = { createCoreViews };
