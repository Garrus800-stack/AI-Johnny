'use strict';
function createToolViews(ctx, h, UI) {
  var e = React.createElement;

function viewSandbox(){
    var langOptions = [
      {value:'python',label:'Python'},{value:'javascript',label:'JavaScript (Node)'},
      {value:'bash',label:'Bash'},{value:'cpp',label:'C++'},
      {value:'typescript',label:'TypeScript'},{value:'rust',label:'Rust'},
    ];
    var modeOptions = [
      {value:'auto',label:'Auto'},{value:'docker',label:'Docker'},
      {value:'process',label:'Process'},{value:'direct',label:'Direct'}
    ];
    var sandboxTab = ctx.get('sandboxTab')||'editor';
    var zipFiles   = ctx.get('sbZipFiles')||[];
    var zipActive  = ctx.get('sbZipActive')||null;
    var reviewing  = ctx.get('sbReviewing')||false;
    var reviewResult = ctx.get('sbReviewResult')||null;

    function loadZip(event){
      var file = event.target.files&&event.target.files[0];
      if(!file) return;
      ctx.set('sbZipLoading')(true);
      var reader = new FileReader();
      reader.onload = function(ev){
        // Write temp file then read via IPC
        var arr = ev.target.result;
        // Use a data URL approach — pass base64 to main process
        var b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(arr)));
        ctx.inv('read-zip-contents-b64',{data:b64,name:file.name}).then(function(r){
          if(r&&r.files){
            ctx.set('sbZipFiles')(r.files);
            ctx.set('sbZipName')(file.name);
            ctx.set('sbZipActive')(null);
            ctx.set('sbZipLoading')(false);
            ctx.set('sandboxTab')('zipbrowser');
          }
        }).catch(function(){ ctx.set('sbZipLoading')(false); });
      };
      reader.readAsArrayBuffer(file);
    }

    function openZipFile(f){
      if(!f.isText||!f.content) return;
      ctx.set('sbZipActive')(f);
      ctx.set('sandboxCode')(f.content);
      var ext = f.name.split('.').pop().toLowerCase();
      var langMap = {py:'python',js:'javascript',ts:'javascript',sh:'bash',cpp:'cpp',c:'cpp',rs:'bash'};
      ctx.set('sandboxLang')(langMap[ext]||'javascript');
      ctx.set('sandboxTab')('editor');
    }

    function reviewCurrentCode(){
      var code = ctx.get('sandboxCode');
      if(!code.trim()) return;
      ctx.set('sbReviewing')(true);
      ctx.set('sbReviewResult')(null);
      var fname = (zipActive&&zipActive.name)||('code.'+ctx.get('sandboxLang'));
      ctx.inv('send-message',{
        agentName: ctx.get('activeAgent'),
        message: 'Analysiere diesen Code aus "'+fname+'" auf Bugs, Sicherheitsprobleme und Verbesserungen:\n\n```\n'+code.slice(0,8000)+'\n```',
        conversationId: null,
      }).then(function(r){
        ctx.set('sbReviewResult')((r&&(r.response||r.message))||'Keine Antwort');
        ctx.set('sbReviewing')(false);
      }).catch(function(e){ ctx.set('sbReviewResult')('Fehler: '+e.message); ctx.set('sbReviewing')(false); });
    }

    function reviewAllFiles(){
      if(!zipFiles.length) return;
      ctx.set('sbReviewing')(true); ctx.set('sbReviewResult')(null);
      var textFiles = zipFiles.filter(function(f){return f.isText&&f.content;}).slice(0,10);
      var summary = textFiles.map(function(f){
        return '### '+f.name+'\n```\n'+f.content.slice(0,2000)+(f.content.length>2000?'\n...(gekürzt)':'')+'\n```';
      }).join('\n\n');
      ctx.inv('send-message',{
        agentName:ctx.get('activeAgent'),
        message:'Führe eine vollständige Code-Review des folgenden Projekts durch. Suche Bugs, Sicherheitsprobleme, Architektur-Schwächen und schlage konkrete Verbesserungen vor:\n\n'+summary,
        conversationId:null,
      }).then(function(r){
        ctx.set('sbReviewResult')((r&&(r.response||r.message))||'Keine Antwort');
        ctx.set('sbReviewing')(false);
      }).catch(function(e){ ctx.set('sbReviewResult')('Fehler: '+e.message); ctx.set('sbReviewing')(false); });
    }

    function downloadOutput(){
      var code = ctx.get('sandboxCode');
      var fname = (zipActive&&zipActive.name)||('output.'+ctx.get('sandboxLang'));
      ctx.inv('write-output-file',{filename:fname,content:code}).then(function(r){
        if(r&&r.success){ ctx.set('savedMsg')('📁 Gespeichert: '+r.path); setTimeout(function(){ctx.set('savedMsg')('');},4000); }
      });
    }

    function sbChatSend(){
      var input = (ctx.get('sbChatInput')||'').trim();
      if(!input||ctx.get('sbChatSending')) return;
      var code = ctx.get('sandboxCode')||'';
      var lang = ctx.get('sandboxLang')||'javascript';
      var history = ctx.get('sbChatHistory')||[];
      var newHistory = history.concat([{role:'user',content:input}]);
      ctx.set('sbChatHistory')(newHistory);
      ctx.set('sbChatInput')('');
      ctx.set('sbChatSending')(true);

      var prompt = code.trim()
        ? 'Hier ist mein Code ('+lang+'):\n```'+lang+'\n'+code.slice(0,6000)+'\n```\n\n'+input
        : input;

      ctx.inv('send-message',{agentName:ctx.get('activeAgent'),message:prompt,conversationId:ctx.get('sbConvId')||null})
        .then(function(r){
          var resp = (r&&(r.response||r.message))||'Keine Antwort';
          if(r&&r.conversationId) ctx.set('sbConvId')(r.conversationId);
          // Check if response contains code — auto-update editor
          var codeMatch = resp.match(/```[\w]*\n([\s\S]*?)```/);
          if(codeMatch&&codeMatch[1]&&codeMatch[1].trim().length>50){
            ctx.set('sandboxCode')(codeMatch[1].trim());
          }
          ctx.set('sbChatHistory')(newHistory.concat([{role:'assistant',content:resp}]));
        })
        .catch(function(e){ ctx.set('sbChatHistory')(newHistory.concat([{role:'assistant',content:'❌ Fehler: '+e.message}])); })
        .finally(function(){ ctx.set('sbChatSending')(false); });
    }

    return e('div',null,
      e('h2',{style:{marginBottom:'12px'}},'Code Sandbox'),

      // Tab-Bar
      e('div',{style:{display:'flex',gap:'6px',marginBottom:'16px',flexWrap:'wrap'}},
        [{k:'editor',l:'⌨️ Editor'},{k:'chat',l:'💬 Chat mit Johnny'},{k:'zipbrowser',l:'📁 ZIP Browser'+(zipFiles.length>0?' ('+zipFiles.length+')':'')},{k:'review',l:'🔍 Code Review'}].map(function(t){
          return e('button',{key:t.k,
            style:{padding:'6px 16px',borderRadius:'20px',cursor:'pointer',fontSize:'12px',
              background:sandboxTab===t.k?'var(--accent-primary)':'var(--bg-tertiary)',
              color:sandboxTab===t.k?'#000':'var(--text-primary)',
              border:'1px solid '+(sandboxTab===t.k?'var(--accent-primary)':'var(--border-color)')},
            onClick:function(){ctx.set('sandboxTab')(t.k);}
          },t.l);
        }),
        // Sandbox Mode
        e('div',{style:{marginLeft:'auto',display:'flex',gap:'6px'}},
          modeOptions.map(function(opt){
            return e('button',{key:opt.value,
              className:ctx.get('sandboxMode')===opt.value?'btn btn-primary':'btn',
              onClick:function(){h.setSandboxMode(opt.value);},
              style:{padding:'4px 10px',fontSize:'11px'}},opt.label);
          })
        )
      ),

      // ── EDITOR TAB ──────────────────────────────────────────────────────
      sandboxTab==='editor' && e('div',null,
        zipActive && e('div',{style:{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px',padding:'6px 12px',
          background:'rgba(0,255,136,0.05)',border:'1px solid rgba(0,255,136,0.2)',borderRadius:'8px',fontSize:'12px'}},
          e('span',{style:{color:'var(--accent-primary)',fontFamily:'JetBrains Mono, monospace'}},zipActive.name),
          e('button',{style:{marginLeft:'auto',background:'none',border:'none',color:'var(--text-secondary)',cursor:'pointer'},
            onClick:function(){ctx.set('sbZipActive')(null);}}, '✕ Schließen')
        ),
        e('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}},
          e('div',null,
            e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}},
              e('div',{style:{fontWeight:'600'}},'Code'),
              e('div',{style:{display:'flex',gap:'6px',alignItems:'center'}},
                e(UI.DSelect,{value:ctx.get('sandboxLang'),onChange:ctx.set('sandboxLang'),options:langOptions}),
                e('button',{className:'btn btn-primary',onClick:h.runSandbox,
                  disabled:ctx.get('sandboxRunning')||!ctx.get('sandboxCode').trim(),
                  style:{padding:'6px 14px',whiteSpace:'nowrap'}},
                  ctx.get('sandboxRunning')?'Läuft...':'▶ Run'),
                e('button',{className:'btn',onClick:downloadOutput,title:'Als Datei speichern',style:{padding:'6px 10px'}},'💾')
              )
            ),
            e('textarea',{
              value:ctx.get('sandboxCode'),
              onChange:function(ev){ctx.set('sandboxCode')(ev.target.value);},
              style:{width:'100%',minHeight:'380px',background:'var(--bg-primary)',border:'1px solid var(--border-color)',
                borderRadius:'8px',padding:'14px',color:'var(--text-primary)',fontFamily:'JetBrains Mono, monospace',
                fontSize:'13px',lineHeight:'1.6',resize:'vertical',boxSizing:'border-box',outline:'none'}
            })
          ),
          e('div',null,
            e('div',{style:{fontWeight:'600',marginBottom:'8px'}},'Output'),
            e('div',{style:{minHeight:'418px',background:'var(--bg-primary)',border:'1px solid var(--border-color)',
              borderRadius:'8px',padding:'14px',fontFamily:'JetBrains Mono, monospace',fontSize:'13px',
              color:'var(--text-primary)',whiteSpace:'pre-wrap',overflowY:'auto',lineHeight:'1.6'}},
              ctx.get('sandboxOutput') || e('span',{style:{color:'var(--text-secondary)'}},'Output erscheint hier...')
            )
          )
        )
      ),

      // ── CHAT TAB — Talk to Johnny about your code ───────────────────────
      sandboxTab==='chat' && e('div',null,
        e('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}},
          // Left: Code context
          e('div',null,
            e('div',{style:{fontWeight:'600',marginBottom:'8px'}},'Code-Kontext (wird an Johnny gesendet)'),
            e('textarea',{
              value:ctx.get('sandboxCode'),
              onChange:function(ev){ctx.set('sandboxCode')(ev.target.value);},
              style:{width:'100%',minHeight:'300px',background:'var(--bg-primary)',border:'1px solid var(--border-color)',
                borderRadius:'8px',padding:'14px',color:'var(--text-primary)',fontFamily:'JetBrains Mono, monospace',
                fontSize:'12px',lineHeight:'1.5',resize:'vertical',boxSizing:'border-box',outline:'none'}
            }),
            e('div',{style:{marginTop:'8px',fontSize:'11px',color:'var(--text-secondary)'}},
              '💡 Johnny kann: Code erklären, Bugs finden, Code erweitern, in andere Sprachen übersetzen, Tests schreiben')
          ),
          // Right: Chat
          e('div',null,
            e('div',{style:{fontWeight:'600',marginBottom:'8px'}},'Chat mit Johnny'),
            e('div',{style:{minHeight:'250px',maxHeight:'300px',overflowY:'auto',background:'var(--bg-primary)',border:'1px solid var(--border-color)',
              borderRadius:'8px',padding:'12px',marginBottom:'8px'}},
              (ctx.get('sbChatHistory')||[]).length===0
                ? e('div',{style:{color:'var(--text-secondary)',fontSize:'13px',textAlign:'center',paddingTop:'40px'}},
                    'Frag Johnny etwas über deinen Code...',
                    e('div',{style:{marginTop:'12px',fontSize:'12px'}},
                      e('div',null,'💬 "Erkläre diesen Code"'),
                      e('div',null,'💬 "Finde Bugs und fixe sie"'),
                      e('div',null,'💬 "Schreibe Tests dafür"'),
                      e('div',null,'💬 "Portiere das nach Python/Rust"')
                    )
                  )
                : (ctx.get('sbChatHistory')||[]).map(function(msg,i){
                    var isUser = msg.role==='user';
                    return e('div',{key:i,style:{marginBottom:'8px',display:'flex',flexDirection:isUser?'row-reverse':'row'}},
                      e('div',{style:{maxWidth:'85%',padding:'8px 12px',borderRadius:'12px',fontSize:'13px',lineHeight:'1.5',
                        background:isUser?'var(--accent-primary)':'var(--bg-tertiary)',
                        color:isUser?'#000':'var(--text-primary)',
                        whiteSpace:'pre-wrap'}},msg.content)
                    );
                  })
            ),
            e('div',{style:{display:'flex',gap:'8px'}},
              e('input',{value:ctx.get('sbChatInput')||'',
                onChange:function(ev){ctx.set('sbChatInput')(ev.target.value);},
                onKeyDown:function(ev){if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();sbChatSend();}},
                placeholder:'Frag Johnny über den Code...',
                style:{flex:1,padding:'10px 14px',borderRadius:'8px',border:'1px solid var(--border-color)',
                  background:'var(--bg-tertiary)',color:'var(--text-primary)',fontSize:'13px',outline:'none'}
              }),
              e('button',{className:'btn btn-primary',onClick:sbChatSend,
                disabled:ctx.get('sbChatSending')||!(ctx.get('sbChatInput')||'').trim(),
                style:{padding:'10px 18px',whiteSpace:'nowrap'}},
                ctx.get('sbChatSending')?'⏳':'➤ Senden')
            )
          )
        ),
        // Quick-Action Buttons
        e('div',{style:{display:'flex',gap:'8px',marginTop:'14px',flexWrap:'wrap'}},
          ['Erkläre den Code','Finde Bugs','Optimiere Performance','Schreibe Unit-Tests','Portiere nach Python','Portiere nach Rust','Füge Error-Handling hinzu','Dokumentiere den Code'].map(function(action){
            return e('button',{key:action,className:'btn',
              style:{padding:'5px 12px',fontSize:'11px'},
              onClick:function(){
                ctx.set('sbChatInput')(action);
                setTimeout(sbChatSend,50);
              }},action);
          })
        ),
        // Language expansion info
        e('div',{style:{marginTop:'16px',padding:'12px',background:'var(--bg-secondary)',borderRadius:'8px',border:'1px solid var(--border-color)'}},
          e('div',{style:{fontWeight:'600',fontSize:'13px',marginBottom:'6px'}},'🔧 Unterstützte Sprachen & Erweiterung'),
          e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',lineHeight:'1.8'}},
            e('div',null,'✓ Python, JavaScript/Node, Bash, C++, TypeScript, Rust'),
            e('div',null,'+ Johnny kann Code in jeder Sprache erklären und analysieren'),
            e('div',null,'+ Neue Sprachen via SandboxService.runCode() erweiterbar'),
            e('div',null,'+ Docker-Mode: beliebige Sprachen durch Container-Images'),
            e('div',{style:{marginTop:'4px',color:'var(--accent-primary)'}},'💡 Sage Johnny: "Füge Go/Java/Ruby zur Sandbox hinzu" — er kann seinen eigenen Code erweitern')
          )
        )
      ),

      // ── ZIP BROWSER TAB ─────────────────────────────────────────────────
      sandboxTab==='zipbrowser' && e('div',null,
        e('div',{style:{display:'flex',gap:'10px',alignItems:'center',marginBottom:'16px'}},
          e('label',{style:{
              display:'inline-flex',alignItems:'center',gap:'8px',padding:'8px 16px',
              background:'var(--accent-primary)',color:'#000',borderRadius:'8px',cursor:'pointer',fontWeight:'600',fontSize:'13px'
            }},
            '📂 ZIP / Projektordner öffnen',
            e('input',{type:'file',accept:'.zip',style:{display:'none'},
              onChange:loadZip})
          ),
          ctx.get('sbZipLoading') && e('span',{style:{color:'var(--text-secondary)',fontSize:'13px'}},'⏳ Lade...'),
          ctx.get('sbZipName') && e('span',{style:{fontSize:'12px',color:'var(--accent-primary)',fontFamily:'JetBrains Mono, monospace'}},
            ctx.get('sbZipName')),
          zipFiles.length>0 && e('div',{style:{marginLeft:'auto',display:'flex',gap:'8px'}},
            e(UI.DBtn,{label:'🔍 Alle analysieren',primary:true,onClick:reviewAllFiles,disabled:reviewing}),
            e(UI.DBtn,{label:'→ Review Tab',small:true,onClick:function(){ctx.set('sandboxTab')('review');}})
          )
        ),
        zipFiles.length===0 && e('div',{style:{textAlign:'center',padding:'60px',color:'var(--text-secondary)'}},
          e('div',{style:{fontSize:'48px',marginBottom:'16px'}},'📦'),
          e('div',{style:{fontSize:'16px',marginBottom:'8px'}},'ZIP-Datei hochladen'),
          e('div',{style:{fontSize:'13px'}},'Lade ein Projekt als ZIP — Johnny liest alle Dateien und kann Code-Review machen')
        ),
        zipFiles.length>0 && e('div',{style:{display:'grid',gridTemplateColumns:'280px 1fr',gap:'12px'}},
          // Dateiliste
          e('div',{style:{background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'10px',
            padding:'10px',overflowY:'auto',maxHeight:'500px'}},
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',textTransform:'uppercase',marginBottom:'8px',fontFamily:'JetBrains Mono, monospace'}},
              zipFiles.length+' Dateien'),
            zipFiles.map(function(f,i){
              var isActive = zipActive&&zipActive.name===f.name;
              var ext = f.name.split('.').pop();
              var extColor = {js:'#f7df1e',py:'#3776ab',ts:'#3178c6',json:'#ff6b6b',md:'#66d9e8',css:'#264de4',html:'#e34f26'}[ext]||'var(--text-secondary)';
              return e('div',{key:i,onClick:function(){openZipFile(f);},style:{
                padding:'6px 10px',borderRadius:'6px',cursor:f.isText?'pointer':'default',
                marginBottom:'2px',opacity:f.isText?1:0.4,
                background:isActive?'var(--accent-primary)':'transparent',
                color:isActive?'#000':'var(--text-primary)',
                display:'flex',alignItems:'center',gap:'6px'
              }},
                e('span',{style:{fontSize:'10px',fontFamily:'JetBrains Mono, monospace',
                  color:isActive?'#000':extColor,fontWeight:'700',minWidth:'30px'}},'.'+ext),
                e('span',{style:{fontSize:'12px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},
                  f.name.split('/').pop()),
                e('span',{style:{marginLeft:'auto',fontSize:'10px',opacity:0.6}},
                  f.size>1024?Math.round(f.size/1024)+'k':f.size+'b')
              );
            })
          ),
          // Datei-Vorschau
          zipActive && zipActive.content
            ? e('div',{style:{background:'var(--bg-primary)',border:'1px solid var(--border-color)',borderRadius:'10px',overflow:'hidden'}},
                e('div',{style:{padding:'10px 14px',borderBottom:'1px solid var(--border-color)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'var(--bg-secondary)'}},
                  e('span',{style:{fontFamily:'JetBrains Mono, monospace',fontSize:'12px',color:'var(--accent-primary)'}},zipActive.name),
                  e('div',{style:{display:'flex',gap:'8px'}},
                    e(UI.DBtn,{label:'▶ In Editor öffnen',small:true,primary:true,onClick:function(){
                      ctx.set('sandboxCode')(zipActive.content);
                      ctx.set('sandboxTab')('editor');
                    }}),
                    e(UI.DBtn,{label:'🔍 Analysieren',small:true,onClick:function(){
                      ctx.set('sandboxCode')(zipActive.content);
                      ctx.set('sandboxTab')('review');
                      reviewCurrentCode();
                    }})
                  )
                ),
                e('pre',{style:{padding:'14px',fontFamily:'JetBrains Mono, monospace',fontSize:'12px',
                  color:'var(--text-primary)',lineHeight:'1.6',overflowY:'auto',maxHeight:'450px',margin:0}},
                  zipActive.content.slice(0,5000)+(zipActive.content.length>5000?'\n\n...('+Math.round(zipActive.content.length/1000)+'k Zeichen, In Editor öffnen für vollständige Ansicht)':''))
              )
            : e('div',{style:{display:'flex',alignItems:'center',justifyContent:'center',height:'200px',color:'var(--text-secondary)',fontSize:'13px'}},
                zipFiles.length>0?'Datei aus der Liste wählen (nur Textdateien öffenbar)':'')
        )
      ),

      // ── CODE REVIEW TAB ─────────────────────────────────────────────────
      sandboxTab==='review' && e('div',null,
        e('div',{style:{marginBottom:'16px',display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'center'}},
          e(UI.DBtn,{label:'🔍 Aktuellen Code analysieren',primary:true,
            disabled:reviewing||!ctx.get('sandboxCode').trim(),onClick:reviewCurrentCode}),
          zipFiles.length>0 && e(UI.DBtn,{label:'📦 Ganzes ZIP analysieren',
            disabled:reviewing,onClick:reviewAllFiles}),
          e(UI.DBtn,{label:'✕ Ergebnis löschen',disabled:!reviewResult,onClick:function(){ctx.set('sbReviewResult')(null);}}),
          ctx.get('savedMsg') && e('span',{style:{color:'var(--success)',fontSize:'13px'}},ctx.get('savedMsg'))
        ),
        reviewing && e('div',{style:{padding:'30px',textAlign:'center',color:'var(--text-secondary)'}},
          e('div',{className:'loading',style:{marginBottom:'12px'}}),
          e('div',null,'Johnny analysiert den Code...')
        ),
        !reviewing && !reviewResult && e('div',{style:{textAlign:'center',padding:'60px',color:'var(--text-secondary)'}},
          e('div',{style:{fontSize:'48px',marginBottom:'16px'}},'🔍'),
          e('div',{style:{fontSize:'16px',marginBottom:'8px'}},'Code-Review'),
          e('div',{style:{fontSize:'13px',lineHeight:'1.8'}},
            '• Code im Editor eingeben oder ZIP hochladen\n• "Aktuellen Code analysieren" klicken\n• Johnny findet Bugs, Sicherheitsprobleme und schlägt Verbesserungen vor')
        ),
        !reviewing && reviewResult && e('div',null,
          e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}},
            e('h3',{style:{margin:0,color:'var(--accent-primary)'}},'Review-Ergebnis'),
            e(UI.DBtn,{label:'📋 Kopieren',small:true,onClick:function(){
              ctx.inv('set-clipboard-text',reviewResult).then(function(){
                ctx.set('savedMsg')('Kopiert!'); setTimeout(function(){ctx.set('savedMsg')('');},2000);
              });
            }})
          ),
          e('div',{style:{background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'10px',
            padding:'20px',whiteSpace:'pre-wrap',fontSize:'13px',lineHeight:'1.8',maxHeight:'600px',overflowY:'auto',
            fontFamily:'inherit'}},reviewResult),
          e('div',{style:{marginTop:'12px',padding:'10px 14px',background:'rgba(0,255,136,0.05)',borderRadius:'8px',fontSize:'12px',color:'var(--text-secondary)'}},
            '💡 Sag Johnny im Chat "Behebe alle gefundenen Bugs in diesem Code" um automatische Fixes zu erhalten')
        )
      )
    );
  }

function viewImageGen(){
    function doGenerate(){
      if(!ctx.get('imgPrompt').trim()||ctx.get('imgGenerating')) return;
      ctx.set('imgGenerating')(true); ctx.set('imgError')(''); ctx.set('imgResults')([]);
      ctx.inv('generate-image',{prompt:ctx.get('imgPrompt'),provider:ctx.get('imgProvider'),size:ctx.get('imgSize'),style:ctx.get('imgStyle'),quality:ctx.get('imgQuality')||'standard',n:1})
        .then(function(r){
          if(r&&r.error){ ctx.set('imgError')(r.error); }
          else if(r&&r.images){ ctx.set('imgResults')(r.images); }
          else { ctx.set('imgError')('Kein Ergebnis erhalten — Service nicht verfügbar?'); }
        })
        .catch(function(e){ ctx.set('imgError')(e.message||'Unbekannter Fehler'); })
        .finally(function(){ ctx.set('imgGenerating')(false); });
    }
    var providers = ctx.get('imgProviders');
    var provOpts = providers.length>0
      ? providers.map(function(p){return{value:p.id,label:(p.hasKey?'✓ ':p.requiresKey?'⚠ ':'')+p.name};})
      : [{value:'openai',label:'⚠ DALL-E 3 (OpenAI)'},{value:'replicate',label:'⚠ SDXL (Replicate)'},{value:'stable-diffusion',label:'Stable Diffusion (Lokal)'}];
    var activeProvInfo = providers.find(function(p){return p.id===ctx.get('imgProvider');});
    var sizeOpts = (activeProvInfo&&activeProvInfo.sizes||['1024x1024','1792x1024','1024x1792']).map(function(s){return{value:s,label:s};});
    var needsKey = activeProvInfo && activeProvInfo.requiresKey && !activeProvInfo.hasKey;
    return e('div',null,
      e('h2',{style:{marginBottom:'16px'}},'🎨 Image Generation'),
      needsKey && e('div',{style:{padding:'10px 14px',background:'rgba(255,170,0,0.1)',border:'1px solid var(--warning)',borderRadius:'8px',marginBottom:'12px',display:'flex',justifyContent:'space-between',alignItems:'center'}},
        e('span',{style:{fontSize:'13px',color:'var(--warning)'}},'⚠ '+activeProvInfo.name+' benötigt einen API-Key'),
        e(UI.DBtn,{label:'→ Settings',small:true,onClick:function(){ctx.set('view')('settings');}})
      ),
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'14px'}},
          e(UI.DField,{label:'Provider'},e(UI.DSelect,{value:ctx.get('imgProvider'),onChange:ctx.set('imgProvider'),options:provOpts})),
          e(UI.DField,{label:'Größe'},e(UI.DSelect,{value:ctx.get('imgSize'),onChange:ctx.set('imgSize'),options:sizeOpts})),
          e(UI.DField,{label:'Stil'},e(UI.DSelect,{value:ctx.get('imgStyle'),onChange:ctx.set('imgStyle'),
            options:ctx.get('imgProvider')==='stable-diffusion'||ctx.get('imgProvider')==='comfyui'
              ? [{value:'',label:'— Kein Preset —'},{value:'photorealistic',label:'📷 Photorealistic'},{value:'anime',label:'🎌 Anime'},
                 {value:'oilPainting',label:'🖼 Ölgemälde'},{value:'watercolor',label:'🎨 Aquarell'},{value:'cyberpunk',label:'🌃 Cyberpunk'},
                 {value:'fantasy',label:'🏰 Fantasy'},{value:'minimalist',label:'◻ Minimalist'},{value:'comic',label:'💥 Comic'},
                 {value:'sketch',label:'✏ Sketch'},{value:'pixelart',label:'👾 Pixel Art'},{value:'steampunk',label:'⚙ Steampunk'},
                 {value:'surreal',label:'🌀 Surreal'}]
              : [{value:'vivid',label:'Vivid'},{value:'natural',label:'Natural'}]
          })),
          e(UI.DField,{label:'Qualität'},e(UI.DSelect,{value:ctx.get('imgQuality')||'standard',onChange:ctx.set('imgQuality'),options:[{value:'standard',label:'Standard'},{value:'hd',label:'HD'}]}))
        ),
        e(UI.DField,{label:'Prompt'},
          e('textarea',{value:ctx.get('imgPrompt'),onChange:function(ev){ctx.set('imgPrompt')(ev.target.value);},
            placeholder:'A futuristic city at night with neon lights...',
            style:{width:'100%',minHeight:'80px',background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',
              borderRadius:'8px',padding:'10px',color:'var(--text-primary)',fontSize:'14px',resize:'vertical',boxSizing:'border-box',outline:'none'}})
        ),
        e('div',{style:{display:'flex',gap:'10px',alignItems:'center'}},
          e('button',{className:'btn btn-primary',onClick:doGenerate,
            disabled:ctx.get('imgGenerating')||!ctx.get('imgPrompt').trim()||needsKey,
            style:{padding:'10px 28px'}},
            ctx.get('imgGenerating')?'⏳ Generiere...':'🎨 Generate'),
          needsKey && e('span',{style:{fontSize:'12px',color:'var(--warning)'}},
            '⚠ API-Key für '+activeProvInfo.requiresKey+' erforderlich')
        ),
        ctx.get('imgError') && e('div',{style:{marginTop:'12px',padding:'10px 14px',background:'rgba(231,76,60,0.1)',border:'1px solid rgba(231,76,60,0.3)',borderRadius:'8px',color:'#e74c3c',fontSize:'13px'}},
          e('div',{style:{fontWeight:'600',marginBottom:'4px'}},'Fehler bei der Bildgenerierung'),
          e('div',null,ctx.get('imgError')),
          ctx.get('imgError').indexOf('ECONNREFUSED')>=0 && e('div',{style:{marginTop:'6px',color:'var(--text-secondary)'}},
            'Stable Diffusion (AUTOMATIC1111) ist nicht erreichbar. Starte es mit: python launch.py --api --listen'),
          ctx.get('imgError').indexOf('API key')>=0 && e('div',{style:{marginTop:'6px',color:'var(--text-secondary)'}},
            'API-Key fehlt. Gehe zu Models → Cloud Providers und trage den Key ein.'),
          ctx.get('imgError').indexOf('not available')>=0 && e('div',{style:{marginTop:'6px',color:'var(--text-secondary)'}},
            'Image Generation Service konnte nicht initialisiert werden. Prüfe die Logs.')
        )
      ),
      ctx.get('imgResults').length>0 && e('div',null,
        e('h3',{style:{marginBottom:'14px'}},'Results'),
        e('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:'16px'}},
          ctx.get('imgResults').map(function(img,i){
            // For local files, convert path to file:// URL for display
            var displayUrl = img.url || (img.localPath ? ('file:///' + img.localPath.replace(/\\/g,'/')) : null);
            return e('div',{key:i,style:{background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'12px',overflow:'hidden'}},
              displayUrl && e('img',{src:displayUrl,style:{width:'100%',display:'block'},onError:function(ev){ev.target.style.display='none';}}),
              img.localPath && e('div',{style:{padding:'10px',fontFamily:'JetBrains Mono, monospace',fontSize:'11px',color:'var(--text-secondary)'}},
                '📁 '+img.localPath),
              img.revisedPrompt && e('div',{style:{padding:'10px',fontSize:'11px',color:'var(--text-secondary)'}},img.revisedPrompt),
              e('div',{style:{padding:'10px',display:'flex',gap:'8px'}},
                img.url && e('button',{className:'btn',style:{padding:'5px 12px',fontSize:'12px'},onClick:function(){ctx.inv('set-clipboard-text',img.url).then(function(){ctx.actions.log('URL kopiert');});}},'Copy URL'),
                img.localPath && e('button',{className:'btn',style:{padding:'5px 12px',fontSize:'12px'},onClick:function(){ctx.inv('open-file-path', img.localPath);}},'Open File'),
                displayUrl && e('button',{className:'btn',style:{padding:'5px 12px',fontSize:'12px'},onClick:function(){ctx.inv('open-url',displayUrl);}},'Open in Browser')
              )
            );
          })
        )
      ),
      ctx.get('imgResults').length===0 && !ctx.get('imgGenerating') && e('div',null,
        e('div',{style:{background:'rgba(255,170,0,0.1)',border:'1px solid rgba(255,170,0,0.3)',borderRadius:'10px',padding:'16px',marginBottom:'16px'}},
          e('div',{style:{fontWeight:'700',color:'var(--warning)',marginBottom:'8px'}},'⚠ Voraussetzungen'),
          e('div',{style:{fontSize:'13px',color:'var(--text-secondary)',lineHeight:'1.8'}},
            e('div',null,'• DALL-E 3: OpenAI API-Key in Models → Cloud Providers eintragen'),
            e('div',null,'• SDXL: Replicate API-Key eintragen'),
            e('div',null,'• Stable Diffusion lokal: AUTOMATIC1111 auf Port 7860 starten'),
            e('div',{style:{marginTop:'8px',color:'var(--text-primary)'}},
              '💡 Tipp: Sage Johnny "generiere ein Bild von X" — er nutzt dann direkt die API')
          )
        ),
        e('div',{style:{textAlign:'center',padding:'40px 20px',color:'var(--text-secondary)'}},
          e('div',{style:{fontSize:'48px',marginBottom:'16px'}},'🎨'),
          e('div',{style:{fontSize:'16px',marginBottom:'8px'}},'Prompt eingeben und Generate klicken')
        )
      )
    );
  }

function viewVideoAnalysis(){
    function refreshVideo(){
      ctx.inv('video-service-status').then(function(v){
        if(v){ ctx.set('videoFFmpeg')(v.available||v.ffmpeg||false); ctx.set('videoFFmpegPath')(v.ffmpegPath||null); ctx.set('videoInstallHint')(v.installHint||null); }
      });
    }
    if(!ctx.get('_videoChecked')){ctx.set('_videoChecked')(true);refreshVideo();}
    function doAnalyze(){
      if(!ctx.get('videoPath').trim()||ctx.get('videoAnalyzing')) return;
      ctx.set('videoAnalyzing')(true); ctx.set('videoError')(''); ctx.set('videoResult')(null);
      ctx.inv('analyze-video',{
        videoPath:ctx.get('videoPath'),
        prompt:ctx.get('videoPrompt'),
        provider:ctx.get('videoProvider')||'auto',
        maxFrames:ctx.get('videoMaxFrames')||8,
        includeAudio:ctx.get('videoIncludeAudio')!==false
      })
        .then(function(r){
          if(r&&r.error) ctx.set('videoError')(r.error);
          else ctx.set('videoResult')(r);
        })
        .catch(function(e){ ctx.set('videoError')(e.message); })
        .finally(function(){ ctx.set('videoAnalyzing')(false); });
    }
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',{style:{margin:0}},'Video Analysis'),
        e(UI.DBtn,{label:'↻ FFmpeg erneut prüfen',small:true,onClick:refreshVideo})
      ),
      !ctx.get('videoFFmpeg') && e('div',{style:{background:'rgba(231,76,60,0.1)',border:'1px solid #e74c3c',borderRadius:'8px',padding:'12px 16px',marginBottom:'16px'}},
        e('div',{style:{fontWeight:'700',color:'#e74c3c',marginBottom:'6px'}},'⚠ FFmpeg nicht gefunden — Frame-Extraktion nicht verfügbar'),
        e('div',{style:{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'8px'}},
          ctx.get('videoInstallHint')||'FFmpeg installieren um Videos frame-weise analysieren zu können.'),
        e('div',{style:{display:'flex',gap:'8px',flexWrap:'wrap'}},
          e('button',{className:'btn',style:{fontSize:'12px',padding:'5px 12px'},onClick:function(){ctx.inv('open-url','https://ffmpeg.org/download.html');}},'📥 ffmpeg.org'),
          e('button',{className:'btn',style:{fontSize:'12px',padding:'5px 12px'},onClick:function(){ctx.inv('open-url','https://www.gyan.dev/ffmpeg/builds/');}}, '🪟 Windows Build')
        ),
        e('div',{style:{marginTop:'8px',fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace'}},
          'winget install ffmpeg  |  brew install ffmpeg  |  apt install ffmpeg — dann App neu starten')
      ),
      ctx.get('videoFFmpeg') && e('div',{style:{marginBottom:'12px',padding:'6px 12px',background:'rgba(0,255,136,0.05)',border:'1px solid rgba(0,255,136,0.2)',borderRadius:'6px',fontSize:'12px',color:'var(--success)',fontFamily:'JetBrains Mono, monospace'}},
        '✓ FFmpeg verfügbar'+(ctx.get('videoFFmpegPath')&&ctx.get('videoFFmpegPath')!=='ffmpeg'?' — '+ctx.get('videoFFmpegPath'):'')
      ),
      e('div',{className:'agent-card',style:{marginBottom:'20px'}},
        e(UI.DField,{label:'Video-Pfad (drag & drop oder einfügen)'},
          e('div',{
            style:{position:'relative'},
            onDragOver:function(ev){ev.preventDefault();},
            onDrop:function(ev){
              ev.preventDefault();
              var f=ev.dataTransfer.files[0];
              if(f) ctx.set('videoPath')(f.path||f.name);
            }
          },
            e(UI.DInput,{value:ctx.get('videoPath'),onChange:ctx.set('videoPath'),placeholder:'z.B. D:\\Videos\\mein_video.mp4 oder https://...'})
          )
        ),
        e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'-8px',marginBottom:'12px'}},
          '💡 Lokaler Pfad, Drag & Drop oder URL einfügen'),
        e('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}},
          e(UI.DField,{label:'Provider'},
            e(UI.DSelect,{value:ctx.get('videoProvider')||'auto',onChange:ctx.set('videoProvider'),options:[
              {value:'auto',label:'Auto (beste Verfügbare)'},
              {value:'ollama',label:'Ollama (lokal)'},
              {value:'openai',label:'OpenAI GPT-4o'},
              {value:'anthropic',label:'Anthropic Claude'},
              {value:'google',label:'Google Gemini'},
            ]})
          ),
          e(UI.DField,{label:'Max Frames'},
            e(UI.DSelect,{value:String(ctx.get('videoMaxFrames')||8),onChange:function(v){ctx.set('videoMaxFrames')(parseInt(v));},options:[
              {value:'4',label:'4 Frames (schnell)'},{value:'8',label:'8 Frames (standard)'},
              {value:'16',label:'16 Frames (genau)'},{value:'32',label:'32 Frames (sehr genau)'}
            ]})
          ),
          e(UI.DField,{label:'Audio-Transkript'},
            e('div',{style:{display:'flex',alignItems:'center',gap:'8px',marginTop:'6px'}},
              e('input',{type:'checkbox',id:'videoAudio',checked:ctx.get('videoIncludeAudio')!==false,
                onChange:function(ev){ctx.set('videoIncludeAudio')(ev.target.checked);},style:{width:'16px',height:'16px',cursor:'pointer'}}),
              e('label',{htmlFor:'videoAudio',style:{fontSize:'13px',cursor:'pointer'}},'Whisper aktivieren')
            )
          )
        ),
        e(UI.DField,{label:'Frage / Prompt'},
          e('textarea',{value:ctx.get('videoPrompt'),onChange:function(ev){ctx.set('videoPrompt')(ev.target.value);},
            style:{width:'100%',minHeight:'60px',background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',
              borderRadius:'8px',padding:'10px',color:'var(--text-primary)',fontSize:'14px',resize:'vertical',boxSizing:'border-box',outline:'none'}})
        ),
        e('div',{style:{display:'flex',gap:'10px',alignItems:'center'}},
          e('button',{className:'btn btn-primary',onClick:doAnalyze,disabled:ctx.get('videoAnalyzing')||!ctx.get('videoPath').trim(),style:{padding:'10px 28px'}},
            ctx.get('videoAnalyzing')?'Analysiere...':'Video analysieren'),
          ctx.get('videoError') && e('span',{style:{color:'#e74c3c',fontSize:'13px'}},ctx.get('videoError'))
        )
      ),
      ctx.get('videoResult') && e('div',null,
        ctx.get('videoResult').frameDescriptions&&ctx.get('videoResult').frameDescriptions.length>0 && e('div',{className:'agent-card',style:{marginBottom:'16px'}},
          e('h3',{style:{marginBottom:'12px'}},'Frame-Analyse ('+ctx.get('videoResult').frameDescriptions.length+' Frames)'),
          ctx.get('videoResult').frameDescriptions.map(function(desc,i){
            return e('div',{key:i,style:{padding:'8px 0',borderBottom:'1px solid var(--border-color)',fontSize:'13px'}},
              e('span',{style:{color:'var(--accent-primary)',fontWeight:'600',fontFamily:'JetBrains Mono, monospace'}},'Frame '+(i+1)+': '),desc);
          })
        ),
        ctx.get('videoResult').audioTranscript && e('div',{className:'agent-card',style:{marginBottom:'16px'}},
          e('h3',{style:{marginBottom:'8px'}},'Audio-Transkript'),
          e('div',{style:{fontSize:'13px',lineHeight:'1.6'}},ctx.get('videoResult').audioTranscript)
        ),
        e('div',{className:'agent-card'},
          e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}},
            e('h3',{style:{margin:0}},'Zusammenfassung'),
            e('button',{className:'btn',style:{padding:'4px 12px',fontSize:'12px'},
              onClick:function(){ctx.inv('set-clipboard-text',ctx.get('videoResult').summary).then(function(){ctx.actions.log('Kopiert');});}},'Kopieren')
          ),
          e('div',{style:{fontSize:'14px',lineHeight:'1.7',whiteSpace:'pre-wrap'}},ctx.get('videoResult').summary)
        )
      )
    );
  }

function viewRAG(){
    function doSearch(){
      if(!ctx.get('ragQuery').trim()||ctx.get('ragSearching')) return;
      ctx.set('ragSearching')(true);
      ctx.inv('rag-search',{query:ctx.get('ragQuery'),agentName:ctx.get('activeAgent')})
        .then(function(r){ ctx.set('ragResults')((r&&r.results)||[]); })
        .catch(function(e){ ctx.actions.log('RAG search error: '+e.message); })
        .finally(function(){ ctx.set('ragSearching')(false); });
    }
    function doSave(){
      if(!ctx.get('ragTopic').trim()||!ctx.get('ragKnowledge').trim()||ctx.get('ragSaving')) return;
      ctx.set('ragSaving')(true);
      ctx.inv('rag-add-knowledge',{topic:ctx.get('ragTopic'),content:ctx.get('ragKnowledge')})
        .then(function(){
          ctx.set('ragTopic')(''); ctx.set('ragKnowledge')('');
          ctx.set('savedMsg')('Wissen gespeichert!');
          setTimeout(function(){ctx.set('savedMsg')('');},2500);
          // Refresh list
          ctx.inv('rag-list-knowledge',{agentName:ctx.get('activeAgent')}).then(function(v){ if(v) ctx.set('ragItems')(v); });
        })
        .finally(function(){ ctx.set('ragSaving')(false); });
    }
    function loadKnowledge(){
      ctx.inv('rag-list-knowledge',{agentName:ctx.get('activeAgent')}).then(function(v){ if(v) ctx.set('ragItems')(v); });
    }
    function refreshRAG(){ ctx.inv('rag-status').then(function(v){ if(v) ctx.set('ragStatus')(v); }); }
    if(!ctx.get('_ragChecked')){ctx.set('_ragChecked')(true);refreshRAG();}
    var mode = ctx.get('ragStatus')&&ctx.get('ragStatus').mode;
    var available = ctx.get('ragStatus')&&ctx.get('ragStatus').available;
    var ragTab = ctx.get('ragTab')||'search';
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}},
        e('h2',{style:{margin:0}},'Knowledge Base (RAG)'),
        e(UI.DBtn,{label:'↻ Status prüfen',small:true,onClick:refreshRAG})
      ),
      e('div',{style:{background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'10px',padding:'10px 16px',marginBottom:'16px'}},
        e('div',{style:{display:'flex',gap:'20px',fontSize:'13px',alignItems:'center',marginBottom: available?0:'8px'}},
          e('span',null,'Status: ',e('strong',{style:{color:available?'var(--success)':'var(--warning)'}},available?'Aktiv':'Nicht aktiv')),
          e('span',null,'Mode: ',e('strong',null,mode==='chromadb'?'ChromaDB (persistent)':mode==='in-memory'?'In-Memory (session only)':'—'))
        ),
        !available && e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',lineHeight:'1.6'}},
          e('div',null,'RAG funktioniert auch ohne ChromaDB — Wissen wird dann im Arbeitsspeicher gehalten (geht bei Neustart verloren).'),
          e('div',{style:{marginTop:'4px'}},'Für persistentes Wissen:'),
          e('div',{style:{fontFamily:'JetBrains Mono, monospace',fontSize:'11px',marginTop:'2px',color:'var(--accent-primary)'}},
            'docker run -d -p 8000:8000 chromadb/chroma'),
          e('div',{style:{marginTop:'4px'}},'Oder: Embedding via Ollama (kein externer Server nötig):'),
          e('div',{style:{fontFamily:'JetBrains Mono, monospace',fontSize:'11px',marginTop:'2px',color:'var(--accent-primary)'}},
            'ollama pull nomic-embed-text')
        )
      ),
      // Tabs
      e('div',{style:{display:'flex',gap:'6px',marginBottom:'16px'}},
        [{k:'search',l:'🔍 Suchen'},{k:'add',l:'➕ Hinzufügen'},{k:'list',l:'📋 Alle anzeigen'}].map(function(t){
          return e('button',{key:t.k,onClick:function(){
              ctx.set('ragTab')(t.k);
              if(t.k==='list') loadKnowledge();
            },
            style:{padding:'6px 18px',borderRadius:'20px',cursor:'pointer',fontSize:'13px',
              background:ragTab===t.k?'var(--accent-primary)':'var(--bg-tertiary)',
              color:ragTab===t.k?'#000':'var(--text-primary)',
              border:'1px solid '+(ragTab===t.k?'var(--accent-primary)':'var(--border-color)')}
          },t.l);
        })
      ),
      // Search Tab
      ragTab==='search' && e('div',{className:'agent-card'},
        e(UI.DField,{label:'Suche'},e(UI.DInput,{value:ctx.get('ragQuery'),onChange:ctx.set('ragQuery'),placeholder:'Was weißt du über...'})),
        e('button',{className:'btn btn-primary',onClick:doSearch,disabled:ctx.get('ragSearching')||!ctx.get('ragQuery').trim()},
          ctx.get('ragSearching')?'Suche...':'Suchen'),
        ctx.get('ragResults').length>0 && e('div',{style:{marginTop:'16px'}},
          e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',marginBottom:'8px'}},ctx.get('ragResults').length+' Ergebnisse:'),
          ctx.get('ragResults').map(function(r,i){
            return e('div',{key:i,style:{padding:'10px',background:'var(--bg-primary)',borderRadius:'6px',marginBottom:'6px',fontSize:'13px',lineHeight:'1.5'}},
              e('div',{style:{fontWeight:'600',color:'var(--accent-primary)',marginBottom:'4px',fontSize:'12px'}},'Score: '+(r.score||r.distance||'n/a')),
              r.content
            );
          })
        ),
        ctx.get('ragResults').length===0 && !ctx.get('ragSearching') && e('div',{style:{marginTop:'16px',color:'var(--text-secondary)',fontSize:'13px'}},'Suchbegriff eingeben und Suchen klicken.')
      ),
      // Add Tab
      ragTab==='add' && e('div',{className:'agent-card'},
        e(UI.DField,{label:'Thema'},e(UI.DInput,{value:ctx.get('ragTopic'),onChange:ctx.set('ragTopic'),placeholder:'z.B. Projektdokumentation'})),
        e(UI.DField,{label:'Inhalt'},
          e('textarea',{value:ctx.get('ragKnowledge'),onChange:function(ev){ctx.set('ragKnowledge')(ev.target.value);},
            placeholder:'Text, Notizen oder Dokumentation einfügen...',
            style:{width:'100%',minHeight:'160px',background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',
              borderRadius:'8px',padding:'10px',color:'var(--text-primary)',fontSize:'13px',resize:'vertical',boxSizing:'border-box',outline:'none'}})
        ),
        e('button',{className:'btn btn-primary',onClick:doSave,disabled:ctx.get('ragSaving')||!ctx.get('ragTopic').trim()||!ctx.get('ragKnowledge').trim()},
          ctx.get('ragSaving')?'Speichere...':'In Wissensdatenbank speichern')
      ),
      // List Tab
      ragTab==='list' && e('div',null,
        ctx.get('ragItems').length===0
          ? e('div',{style:{textAlign:'center',padding:'40px',color:'var(--text-secondary)'}},
              e('div',{style:{fontSize:'36px',marginBottom:'12px'}},'🗄️'),
              e('div',null,'Noch kein Wissen gespeichert')
            )
          : ctx.get('ragItems').map(function(item,i){
              return e('div',{key:item.id||i,className:'agent-card',style:{marginBottom:'8px'}},
                e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}},
                  e('div',{style:{fontWeight:'700',fontSize:'13px'}},item.topic||item.title||'(kein Titel)'),
                  e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace'}},
                    item.created?new Date(item.created).toLocaleDateString():'')
                ),
                e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',lineHeight:'1.5'}},
                  (item.content||'').slice(0,200)+(item.content&&item.content.length>200?'...':''))
              );
            })
      )
    );
  }

function viewSkillEditor(){
    function openSkillForEdit(sk){
      ctx.set('skillEditorSkill')(sk);
      ctx.set('skillEditorCode')(sk.code||'// No code available\n');
    }
    function saveSkill(){
      if(!ctx.get('skillEditorSkill')||ctx.get('skillEditorSaving')) return;
      ctx.set('skillEditorSaving')(true);
      var updated = Object.assign({},ctx.get('skillEditorSkill'),{code:ctx.get('skillEditorCode')});
      // update-skill wenn ID vorhanden, sonst create
      var channel = updated.id ? 'update-skill' : 'create-skill';
      ctx.inv(channel, updated)
        .then(function(r){
          if(r&&r.error){ alert('Fehler: '+r.error); return; }
          ctx.actions.loadAll();
          ctx.set('savedMsg')('Skill gespeichert!');
          setTimeout(function(){ ctx.set('savedMsg')(''); }, 2500);
        })
        .catch(function(e){ alert('Fehler: '+e.message); })
        .finally(function(){ ctx.set('skillEditorSaving')(false); });
    }
    function deleteSkill(id){
      if(!confirm('Delete this skill?')) return;
      ctx.inv('delete-skill',id).then(function(){ ctx.actions.loadAll(); ctx.set('skillEditorSkill')(null); });
    }
    function installFromUrl(){
      var url = prompt('Plugin URL:\n\nGitHub: https://github.com/user/repo/blob/main/plugin.js\nRaw:    https://raw.githubusercontent.com/user/repo/main/plugin.js\nnpm:    package-name');
      if(!url||!url.trim()) return;
      ctx.set('savedMsg')('⏳ Lade Plugin...');
      ctx.inv('install-plugin',url.trim()).then(function(r){
        if(r&&r.success){
          ctx.set('savedMsg')('✓ Plugin installiert: '+(r.filename||url));
          ctx.actions.loadAll();
        } else {
          ctx.set('savedMsg')('⚠ Fehler: '+((r&&r.error)||'Installation fehlgeschlagen'));
        }
        setTimeout(function(){ ctx.set('savedMsg')(''); }, 5000);
      }).catch(function(e){
        ctx.set('savedMsg')('⚠ '+e.message);
        setTimeout(function(){ ctx.set('savedMsg')(''); }, 5000);
      });
    }
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',null,'Skill Editor'),
        e('div',{style:{display:'flex',gap:'10px'}},
          e('button',{className:'btn',onClick:installFromUrl},'+ Install Plugin (URL)'),
          e('button',{className:'btn btn-primary',onClick:h.openCreateSkill},'+ New Skill')
        )
      ),
      e('div',{style:{display:'grid',gridTemplateColumns:'280px 1fr',gap:'16px',minHeight:'500px'}},
        // Sidebar: skill list
        e('div',{style:{background:'var(--bg-secondary)',border:'1px solid var(--border-color)',borderRadius:'12px',padding:'12px',overflowY:'auto'}},
          e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:'10px'}},'Skills ('+ctx.get('skills').length+')'),
          ctx.get('skills').length===0 && e('p',{style:{color:'var(--text-secondary)',fontSize:'13px'}},'No skills yet'),
          ctx.get('skills').map(function(sk){
            var active = ctx.get('skillEditorSkill')&&ctx.get('skillEditorSkill').id===sk.id;
            return e('div',{key:sk.id,onClick:function(){openSkillForEdit(sk);},style:{
              padding:'9px 12px',borderRadius:'8px',cursor:'pointer',marginBottom:'4px',
              background: active?'var(--accent-primary)':'transparent',
              color: active?'#000':'var(--text-primary)'
            }},
              e('div',{style:{fontWeight:'600',fontSize:'13px'}},sk.name),
              e('div',{style:{fontSize:'11px',opacity:0.7}},sk.language)
            );
          }),
          ctx.get('plugins').length>0 && e('div',null,
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',textTransform:'uppercase',letterSpacing:'0.5px',marginTop:'16px',marginBottom:'10px'}},'Plugins ('+ctx.get('plugins').length+')'),
            ctx.get('plugins').map(function(pl){
              return e('div',{key:pl.name,style:{padding:'9px 12px',borderRadius:'8px',marginBottom:'4px',opacity:0.7}},
                e('div',{style:{fontWeight:'600',fontSize:'13px'}},pl.name)
              );
            })
          )
        ),
        // Editor panel
        ctx.get('skillEditorSkill')
          ? e('div',{style:{display:'flex',flexDirection:'column',gap:'12px'}},
              e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
                e('div',null,
                  e('div',{style:{fontWeight:'700',fontSize:'16px'}},ctx.get('skillEditorSkill').name),
                  e('div',{style:{fontSize:'12px',color:'var(--text-secondary)'}},'Language: '+ctx.get('skillEditorSkill').language)
                ),
                e('div',{style:{display:'flex',gap:'8px'}},
                  e('button',{className:'btn',style:{borderColor:'#e74c3c',color:'#e74c3c'},onClick:function(){deleteSkill(ctx.get('skillEditorSkill').id);}},'Delete'),
                  e('button',{className:'btn btn-primary',onClick:saveSkill,disabled:ctx.get('skillEditorSaving')},ctx.get('skillEditorSaving')?'Saving...':'Save')
                )
              ),
              e('textarea',{
                value:ctx.get('skillEditorCode'),
                onChange:function(ev){ctx.set('skillEditorCode')(ev.target.value);},
                style:{flex:1,minHeight:'420px',background:'var(--bg-primary)',border:'1px solid var(--border-color)',
                  borderRadius:'8px',padding:'14px',color:'var(--text-primary)',fontFamily:'JetBrains Mono, monospace',
                  fontSize:'13px',lineHeight:'1.6',resize:'vertical',boxSizing:'border-box',outline:'none'}
              })
            )
          : e('div',{style:{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--text-secondary)'}},
              e('div',{style:{textAlign:'center'}},
                e('div',{style:{fontSize:'40px',marginBottom:'12px'}},''),
                e('div',null,'Select a skill to edit its code')
              )
            )
      ),
    );
  }

function viewMarketplace() {
    function doSearch(q){ 
      ctx.set('mkLoading')(true);
      ctx.inv('marketplace-search',{query:q!==undefined?q:ctx.get('mkSearchQ')}).then(function(v){ 
        if(v&&!v.error) ctx.set('mkResults')(v); 
        ctx.set('mkLoading')(false); 
      }); 
    }
    function installSk(id,registryId){ 
      ctx.inv('marketplace-install',{skillId:id,registryId:registryId}).then(function(r){ 
        if(r&&!r.error){ 
          ctx.actions.log('Skill installiert: '+id); 
          ctx.inv('marketplace-installed').then(function(v){ if(v) ctx.set('mkInstalled')(v); }); 
          doSearch(); 
        } else { 
          ctx.actions.log('Install error: '+((r&&r.error)||'?')); 
          alert('Fehler: '+((r&&r.error)||'Installation fehlgeschlagen'));
        } 
      }); 
    }
    function addRegistry(){
      var url = prompt('Registry URL (JSON-Endpoint):');
      if(!url||!url.trim()) return;
      var name = prompt('Registry Name:');
      if(!name||!name.trim()) return;
      ctx.inv('marketplace-add-registry',{name:name.trim(),url:url.trim()}).then(function(){
        ctx.actions.log('Registry hinzugefügt: '+name);
        doSearch();
      });
    }
    function uninstallSk(id){
      if(!confirm('Skill "'+id+'" deinstallieren?')) return;
      ctx.inv('marketplace-uninstall',id).then(function(){ 
        ctx.inv('marketplace-installed').then(function(v){if(v)ctx.set('mkInstalled')(v);}); 
        doSearch();
      }); 
    }
    var registries = ctx.get('mkRegistries')||[];
    var categories = ctx.get('mkCategories')||{};
    var catKeys = Object.keys(categories);
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',{style:{margin:0}},'Skill Marketplace'),
        e(UI.DBtn,{label:'+ Registry hinzufügen',onClick:addRegistry})
      ),
      // Suche
      e('div',{style:{display:'flex',gap:'8px',marginBottom:'16px'}},
        e(UI.DInput,{value:ctx.get('mkSearchQ'),onChange:ctx.set('mkSearchQ'),placeholder:'Skills durchsuchen...',
          style:{flex:1},
          onKeyDown:function(ev){ if(ev&&ev.key==='Enter') doSearch(); }}),
        e(UI.DBtn,{label:ctx.get('mkLoading')?'...':'Suchen',primary:true,onClick:function(){doSearch();},disabled:ctx.get('mkLoading')})
      ),
      // Kategorie-Chips
      catKeys.length>0 && e('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap',marginBottom:'16px'}},
        e(UI.DChip,{label:'Alle',active:!ctx.get('mkActiveCategory'),onClick:function(){ctx.set('mkActiveCategory')(null);doSearch();}}),
        catKeys.map(function(cat){ return e(UI.DChip,{key:cat,label:cat+' ('+categories[cat]+')',
          active:ctx.get('mkActiveCategory')===cat,
          onClick:function(){ ctx.set('mkActiveCategory')(cat); ctx.inv('marketplace-search',{query:ctx.get('mkSearchQ'),category:cat}).then(function(v){if(v&&!v.error)ctx.set('mkResults')(v);}); }
        }); })
      ),
      // Installiert
      ctx.get('mkInstalled').length>0 && e('div',{style:{marginBottom:'24px'}},
        e('h3',{style:{margin:'0 0 8px',fontSize:'14px',color:'var(--accent-primary)'}},'✓ Installiert ('+ctx.get('mkInstalled').length+')'),
        e('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:'8px'}},
          ctx.get('mkInstalled').map(function(sk){ return e('div',{key:sk.id||sk.name,className:'agent-card',style:{padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}},
            e('div',null,
              e('div',{style:{fontWeight:'600',fontSize:'13px'}},sk.name),
              e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'2px'}},sk.description||sk.version||'')
            ),
            e(UI.DBtn,{label:'Entfernen',small:true,danger:true,onClick:function(){ uninstallSk(sk.id||sk.name); }})
          ); })
        )
      ),
      // Suchergebnisse
      e('div',null,
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}},
          e('h3',{style:{margin:0,fontSize:'14px'}},'Verfügbar ('+ctx.get('mkResults').length+')'),
          registries.length>0 && e('span',{style:{fontSize:'11px',color:'var(--text-secondary)'}},registries.length+' Registr'+((registries.length===1)?'y':'ies')+' verbunden')
        ),
        ctx.get('mkLoading') && e('div',{style:{textAlign:'center',padding:'30px',color:'var(--text-secondary)'}},'⏳ Lade Skills...'),
        !ctx.get('mkLoading') && ctx.get('mkResults').length===0 && e('div',{style:{textAlign:'center',padding:'40px',color:'var(--text-secondary)'}},
          e('div',{style:{fontSize:'36px',marginBottom:'12px'}},'🛒'),
          e('div',{style:{marginBottom:'8px'}},'Keine Skills gefunden'),
          e('div',{style:{fontSize:'12px'}},registries.length===0
            ? 'Füge zuerst eine Registry hinzu (z.B. https://raw.githubusercontent.com/...)'
            : 'Andere Suchbegriffe versuchen oder Kategorie wählen')
        ),
        !ctx.get('mkLoading') && e('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:'8px'}},
          ctx.get('mkResults').map(function(sk){ 
            var isInstalled = (ctx.get('mkInstalled')||[]).some(function(i){return (i.id||i.name)===(sk.id||sk.name);});
            return e('div',{key:sk.id||sk.name,className:'agent-card',style:{padding:'12px 14px'}},
              e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'6px'}},
                e('div',null,
                  e('span',{style:{fontWeight:'600',fontSize:'13px'}},sk.name),
                  sk.version && e('span',{style:{fontSize:'10px',color:'var(--text-secondary)',marginLeft:'6px'}},'v'+sk.version)
                ),
                isInstalled 
                  ? e('span',{style:{color:'var(--success)',fontSize:'12px',fontWeight:'600'}},'✓')
                  : e(UI.DBtn,{label:'Installieren',small:true,primary:true,onClick:function(){ installSk(sk.id||sk.name, sk.registryId); }})
              ),
              sk.description && e('div',{style:{fontSize:'12px',color:'var(--text-secondary)',lineHeight:'1.4',marginBottom:'4px'}},sk.description),
              e('div',{style:{display:'flex',gap:'8px',flexWrap:'wrap'}},
                sk.category && e('span',{style:{fontSize:'10px',background:'var(--bg-tertiary)',padding:'2px 8px',borderRadius:'10px',color:'var(--text-secondary)'}},sk.category),
                sk.author && e('span',{style:{fontSize:'10px',color:'var(--text-secondary)'}},'by '+sk.author),
                sk.registryName && e('span',{style:{fontSize:'10px',color:'var(--text-secondary)',opacity:0.6}},sk.registryName)
              )
            ); })
        )
      )
    );
  }

  return {
    sandbox: viewSandbox, imagegen: viewImageGen, video: viewVideoAnalysis,
    rag: viewRAG, skills: viewSkillEditor, marketplace: viewMarketplace,
  };
}
module.exports = { createToolViews };
