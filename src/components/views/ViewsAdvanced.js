'use strict';
function createAdvancedViews(ctx, h, UI) {
  var e = React.createElement;

function viewEmotionAI(){
    function refreshEI(){ ctx.inv('ei-status').then(function(v){ if(v) ctx.set('eiStatus')(v); }); }
    if(!ctx.get('_eiChecked')){ctx.set('_eiChecked')(true);refreshEI();}
    function doAnalyze(){
      if(!ctx.get('eiInput').trim()||ctx.get('eiAnalyzing')) return;
      ctx.set('eiAnalyzing')(true); ctx.set('eiResult')(null);
      ctx.inv('ei-analyze',{text:ctx.get('eiInput'),options:{useLLM:true,userId:'default'}})
        .then(function(r){
          if(r&&r.error){ ctx.set('eiResult')({error:r.error}); }
          else { ctx.set('eiResult')(r); }
          ctx.set('eiAnalyzing')(false);
        })
        .catch(function(err){ ctx.set('eiResult')({error:err&&err.message||'Unbekannter Fehler'}); ctx.set('eiAnalyzing')(false); });
    }
    function loadProfile(){
      ctx.inv('ei-profile','default').then(function(v){ if(v&&!v.error) ctx.set('eiProfile')(v); });
    }
    var st  = ctx.get('eiStatus');
    var res = ctx.get('eiResult');
    var prof= ctx.get('eiProfile');
    var serviceOk = st && !st.error;
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}},
        e('h2',{style:{margin:0}},'🧠 Emotional Intelligence'),
        e(UI.DBtn,{label:'↻ Refresh',small:true,onClick:refreshEI})
      ),
      // Service-Status
      e('div',{style:{marginBottom:'16px',padding:'8px 14px',background:serviceOk?'rgba(0,255,136,0.05)':'rgba(255,170,0,0.08)',border:'1px solid '+(serviceOk?'rgba(0,255,136,0.2)':'rgba(255,170,0,0.3)'),borderRadius:'8px',fontSize:'12px',color:serviceOk?'var(--success)':'var(--warning)'}},
        serviceOk ? '✓ EmotionalIntelligence-Service aktiv — '+(st.profiles||0)+' Profile, '+(st.emotions||[]).length+' Emotionen'
          : '⚠ Service nicht verfügbar'+((st&&st.error)?' — '+st.error:' — wird beim nächsten Start initialisiert')
      ),
      e('div',{className:'agent-card',style:{marginBottom:'16px'}},
        e('h3',{style:{margin:'0 0 12px'}},'Sentiment-Analyse'),
        e(UI.DField,{label:'Text eingeben'},
          e('textarea',{value:ctx.get('eiInput'),onChange:function(ev){ctx.set('eiInput')(ev.target.value);},rows:4,
            placeholder:'Text eingeben um Stimmung, Emotion und Empathie-Strategie zu analysieren...',
            style:{width:'100%',background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',borderRadius:'8px',padding:'10px',color:'var(--text-primary)',fontSize:'14px',resize:'vertical',boxSizing:'border-box',outline:'none'}})
        ),
        e('div',{style:{display:'flex',gap:'8px'}},
          e(UI.DBtn,{label:ctx.get('eiAnalyzing')?'Analysiere...':'Analysieren',primary:true,
            disabled:ctx.get('eiAnalyzing')||!ctx.get('eiInput').trim(),onClick:doAnalyze}),
          e(UI.DBtn,{label:'Profil laden',small:true,onClick:loadProfile})
        )
      ),
      // Analyseergebnis
      res && res.error && e('div',{style:{padding:'12px',background:'rgba(231,76,60,0.1)',border:'1px solid #e74c3c',borderRadius:'8px',color:'#e74c3c',marginBottom:'16px'}},
        '⚠ '+res.error
      ),
      res && !res.error && e('div',{className:'agent-card',style:{marginBottom:'16px'}},
        e('h3',{style:{margin:'0 0 12px',color:'var(--accent-primary)'}},'Analyse-Ergebnis'),
        e('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:'10px',marginBottom:'14px'}},
          e('div',{style:{textAlign:'center',padding:'14px',background:'var(--bg-primary)',borderRadius:'8px'}},
            e('div',{style:{fontSize:'26px',fontWeight:'800',color:res.valence>0.2?'var(--success)':res.valence<-0.2?'#e74c3c':'var(--text-secondary)'}},
              res.valence!=null?(res.valence>0?'+':'')+res.valence.toFixed(2):'–'),
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},'Valenz')),
          e('div',{style:{textAlign:'center',padding:'14px',background:'var(--bg-primary)',borderRadius:'8px'}},
            e('div',{style:{fontSize:'26px',fontWeight:'800'}},res.arousal!=null?res.arousal.toFixed(2):'–'),
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},'Arousal')),
          e('div',{style:{textAlign:'center',padding:'14px',background:'var(--bg-primary)',borderRadius:'8px'}},
            e('div',{style:{fontSize:'20px',fontWeight:'800',color:'var(--accent-primary)'}},res.primaryEmotion||'?'),
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},'Emotion')),
          res.dominance!=null && e('div',{style:{textAlign:'center',padding:'14px',background:'var(--bg-primary)',borderRadius:'8px'}},
            e('div',{style:{fontSize:'26px',fontWeight:'800'}},res.dominance.toFixed(2)),
            e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',marginTop:'4px'}},'Dominanz'))
        ),
        res.secondaryEmotions&&res.secondaryEmotions.length>0 && e('div',{style:{marginBottom:'12px',display:'flex',gap:'6px',flexWrap:'wrap'}},
          e('span',{style:{fontSize:'12px',color:'var(--text-secondary)'}},'Weitere: '),
          res.secondaryEmotions.map(function(em,i){ return e('span',{key:i,style:{fontSize:'12px',padding:'2px 8px',background:'var(--bg-tertiary)',borderRadius:'12px'}},em); })
        ),
        res.empathyStrategy && e('div',{style:{padding:'12px',background:'rgba(0,255,136,0.05)',border:'1px solid rgba(0,255,136,0.2)',borderRadius:'8px',marginBottom:'10px'}},
          e('div',{style:{fontWeight:'700',marginBottom:'4px',color:'var(--accent-primary)'}},'💡 Empathie-Strategie: '+res.empathyStrategy.key),
          e('div',{style:{fontSize:'13px',color:'var(--text-secondary)'}},res.empathyStrategy.promptHint||res.empathyStrategy.description||'')
        ),
        res.crisis && res.crisis.detected && e('div',{style:{padding:'12px',background:'rgba(231,76,60,0.1)',border:'1px solid #e74c3c',borderRadius:'8px',color:'#e74c3c'}},
          e('div',{style:{fontWeight:'700'}},'⚠ Krisensignal (Schweregrad: '+res.crisis.severity+')'),
          e('div',{style:{fontSize:'13px',marginTop:'4px'}},res.crisis.recommendation)
        )
      ),
      // Emotionales Profil
      prof && e('div',{className:'agent-card'},
        e('h3',{style:{margin:'0 0 12px'}},'📈 Emotionales Langzeit-Profil'),
        e(UI.DInfoRow,{label:'Stimmungstrend',value:prof.moodTrend||'–'}),
        e(UI.DInfoRow,{label:'Ø Valenz',value:prof.averageValence!=null?prof.averageValence.toFixed(2):'–'}),
        e(UI.DInfoRow,{label:'Ø Arousal',value:prof.averageArousal!=null?prof.averageArousal.toFixed(2):'–'}),
        e(UI.DInfoRow,{label:'Interaktionen',value:prof.interactionCount||0}),
        prof.dominantEmotions&&prof.dominantEmotions.length>0 && e(UI.DInfoRow,{label:'Häufigste Emotion',value:prof.dominantEmotions[0]})
      )
    );
  }

function viewCreativeWriting(){
    function refreshCW(){ ctx.inv('cw-status').then(function(v){ if(v) ctx.set('cwStatus')(v); }); ctx.inv('cw-get-genres').then(function(v){ if(v) ctx.set('cwGenres')(v); }); }
    if(!ctx.get('_cwChecked')){ctx.set('_cwChecked')(true);refreshCW();}
    function doGenerate(){
      if(!ctx.get('cwPrompt').trim()||ctx.get('cwGenerating')) return;
      ctx.set('cwGenerating')(true); ctx.set('cwResult')(null); ctx.set('cwError')('');
      ctx.inv('cw-generate',{prompt:ctx.get('cwPrompt'),genre:ctx.get('cwGenre'),length:ctx.get('cwLength')})
        .then(function(r){
          if(r&&r.error){ ctx.set('cwError')(r.error); }
          else { ctx.set('cwResult')(r); }
          ctx.set('cwGenerating')(false);
        })
        .catch(function(err){ ctx.set('cwError')(err&&err.message||'Fehler'); ctx.set('cwGenerating')(false); });
    }
    var genres = ctx.get('cwGenres');
    var serviceOk = genres && genres.genres && Object.keys(genres.genres).length > 0;
    var genreOpts = serviceOk
      ? Object.entries(genres.genres).map(function(en){return{value:en[0],label:en[1].label||en[0]};})
      : [{value:'fiction',label:'Fiction'},{value:'scifi',label:'Sci-Fi'},{value:'fantasy',label:'Fantasy'},{value:'thriller',label:'Thriller'},{value:'romance',label:'Romanze'},{value:'horror',label:'Horror'}];
    var res = ctx.get('cwResult');
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}},
        e('h2',{style:{margin:0}},'✍️ Creative Writing Studio'),
        e(UI.DBtn,{label:'↻ Refresh',small:true,onClick:refreshCW})
      ),
      e('div',{style:{marginBottom:'12px',padding:'6px 12px',background:serviceOk?'rgba(0,255,136,0.05)':'rgba(255,170,0,0.08)',border:'1px solid '+(serviceOk?'rgba(0,255,136,0.2)':'rgba(255,170,0,0.3)'),borderRadius:'6px',fontSize:'12px',color:serviceOk?'var(--success)':'var(--warning)'}},
        serviceOk ? '✓ CreativeWritingService aktiv — '+Object.keys(genres.genres).length+' Genres verfügbar'
          : '⚠ Service nicht verfügbar — nutze Fallback-Genres. Service wird beim nächsten Start initialisiert.'
      ),
      e('div',{className:'agent-card',style:{marginBottom:'16px'}},
        e('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}},
          e(UI.DField,{label:'Genre'},e(UI.DSelect,{value:ctx.get('cwGenre'),onChange:ctx.set('cwGenre'),options:genreOpts})),
          e(UI.DField,{label:'Länge'},e(UI.DSelect,{value:ctx.get('cwLength'),onChange:ctx.set('cwLength'),options:[
            {value:'short',label:'Kurz (~300 Wörter)'},{value:'medium',label:'Mittel (~800)'},{value:'long',label:'Lang (~1500)'},{value:'epic',label:'Episch (~3000)'}
          ]})),
          e(UI.DField,{label:'Stil (optional)'},e(UI.DInput,{value:ctx.get('cwStyle')||'',onChange:ctx.set('cwStyle'),placeholder:'z.B. dunkel, poetisch...'}))
        ),
        e(UI.DField,{label:'Prompt / Idee'},
          e('textarea',{value:ctx.get('cwPrompt'),onChange:function(ev){ctx.set('cwPrompt')(ev.target.value);},rows:4,
            placeholder:'z.B. "Eine KI erwacht zum Bewusstsein in einem verlassenen Raumschiff..."',
            style:{width:'100%',background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',borderRadius:'8px',padding:'10px',color:'var(--text-primary)',fontSize:'14px',resize:'vertical',boxSizing:'border-box',outline:'none'}})
        ),
        e(UI.DBtn,{label:ctx.get('cwGenerating')?'⏳ Generiere...':'✍️ Generieren',primary:true,
          disabled:ctx.get('cwGenerating')||!ctx.get('cwPrompt').trim(),onClick:doGenerate})
      ),
      ctx.get('cwError') && e('div',{style:{padding:'12px',background:'rgba(231,76,60,0.1)',border:'1px solid #e74c3c',borderRadius:'8px',color:'#e74c3c',marginBottom:'16px'}},
        '⚠ '+ctx.get('cwError')
      ),
      res&&res.text && e('div',{className:'agent-card'},
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}},
          e('h3',{style:{margin:0,color:'var(--accent-primary)'}},'📖 Ergebnis'),
          e('div',{style:{display:'flex',gap:'8px'}},
            e(UI.DBtn,{label:'📋 Kopieren',small:true,onClick:function(){
              ctx.inv('set-clipboard-text',res.text).then(function(){ ctx.set('savedMsg')('Kopiert!'); setTimeout(function(){ctx.set('savedMsg')('');},2000); });
            }}),
            e(UI.DBtn,{label:'📦 Als .txt speichern',small:true,onClick:function(){
              ctx.inv('write-output-file',{filename:'creative-'+Date.now()+'.txt',content:res.text})
                .then(function(r){ if(r&&r.success){ ctx.set('savedMsg')('Gespeichert!'); setTimeout(function(){ctx.set('savedMsg')('');},3000); } });
            }}),
            e(UI.DBtn,{label:'🔄 Variante',small:true,disabled:ctx.get('cwGenerating'),onClick:function(){
              ctx.set('cwGenerating')(true);
              ctx.inv('cw-variants',{text:res.text,genre:ctx.get('cwGenre'),count:1})
                .then(function(r){ if(r&&r.variants&&r.variants[0]) ctx.set('cwResult')(Object.assign({},res,{text:r.variants[0]})); })
                .catch(function(){})
                .finally(function(){ ctx.set('cwGenerating')(false); });
            }})
          )
        ),
        e('div',{style:{whiteSpace:'pre-wrap',fontSize:'14px',lineHeight:'1.8',padding:'16px',background:'var(--bg-primary)',borderRadius:'8px',maxHeight:'600px',overflowY:'auto'}},res.text),
        res.meta && e('div',{style:{marginTop:'8px',fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace'}},
          'Genre: '+res.meta.genre+' | Länge: '+res.meta.length+(res.meta.tokens?' | ~'+res.meta.tokens+' Tokens':''))
      )
    );
  }

function viewEnhancedVision(){
    function refreshEV(){ ctx.inv('ev-status').then(function(v){ if(v) ctx.set('evStatus')(v); }); ctx.inv('ev-modes').then(function(v){ if(v) ctx.set('evModes')(v); }); }
    if(!ctx.get('_evChecked')){ctx.set('_evChecked')(true);refreshEV();}
    function doAnalyze(){
      if(!ctx.get('evPath').trim()||ctx.get('evAnalyzing')) return;
      ctx.set('evAnalyzing')(true); ctx.set('evResult')(null);
      ctx.inv('ev-analyze',{image:ctx.get('evPath'),mode:ctx.get('evMode')})
        .then(function(r){
          if(r&&r.error){ ctx.set('evResult')({error:r.error}); }
          else { ctx.set('evResult')(r); }
          ctx.set('evAnalyzing')(false);
        })
        .catch(function(err){ ctx.set('evResult')({error:(err&&err.message)||'Fehler bei der Analyse'}); ctx.set('evAnalyzing')(false); });
    }
    function doDeepAnalyze(){
      if(!ctx.get('evPath').trim()||ctx.get('evAnalyzing')) return;
      ctx.set('evAnalyzing')(true); ctx.set('evResult')(null);
      ctx.inv('ev-deep-analyze',{image:ctx.get('evPath')})
        .then(function(r){ ctx.set('evResult')(r); ctx.set('evAnalyzing')(false); })
        .catch(function(err){ ctx.set('evResult')({error:(err&&err.message)||'Fehler'}); ctx.set('evAnalyzing')(false); });
    }
    var modes = ctx.get('evModes');
    var evSt = ctx.get('evStatus');
    var serviceOk = (evSt && !evSt.error) || (modes && modes.length > 0);
    var modeOpts = serviceOk
      ? modes.map(function(m){return{value:m.id,label:m.name+(m.description?' — '+m.description.slice(0,30):'')};})
      : [{value:'describe',label:'Beschreibung'},{value:'ocr',label:'Text erkennen (OCR)'},{value:'objects',label:'Objekte erkennen'},{value:'faces',label:'Gesichter/Personen'},{value:'code',label:'Code lesen'}];
    var res = ctx.get('evResult');
    var resultText = res && !res.error
      ? (typeof res.analysis==='string'?res.analysis:JSON.stringify(res.analysis,null,2))+(res.synthesis?'\n\n'+res.synthesis:'')
      : '';
    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}},
        e('h2',{style:{margin:0}},'👁️ Enhanced Vision'),
        e(UI.DBtn,{label:'↻ Refresh',small:true,onClick:refreshEV})
      ),
      e('div',{style:{marginBottom:'12px',padding:'6px 12px',background:serviceOk?'rgba(0,255,136,0.05)':'rgba(255,170,0,0.08)',border:'1px solid '+(serviceOk?'rgba(0,255,136,0.2)':'rgba(255,170,0,0.3)'),borderRadius:'6px',fontSize:'12px',color:serviceOk?'var(--success)':'var(--warning)'}},
        serviceOk ? '✓ EnhancedVision aktiv — '+modes.length+' Modi verfügbar'
          : '⚠ Service nicht verfügbar — nutze Fallback-Modi. Benötigt: Vision-Modell (ollama pull llama3.2-vision)'
      ),
      e('div',{className:'agent-card',style:{marginBottom:'16px'}},
        e('div',{style:{display:'grid',gridTemplateColumns:'2fr 1fr',gap:'12px',marginBottom:'12px'}},
          e(UI.DField,{label:'Bildpfad oder URL'},
            e('div',{
              onDragOver:function(ev){ev.preventDefault();ev.target.style.borderColor='var(--accent-primary)';},
              onDragLeave:function(ev){ev.target.style.borderColor='';},
              onDrop:function(ev){
                ev.preventDefault();
                var f=ev.dataTransfer.files[0];
                if(f) ctx.set('evPath')(f.path||f.name);
              }
            },
              e(UI.DInput,{value:ctx.get('evPath'),onChange:ctx.set('evPath'),
                placeholder:'Bild hierher ziehen, Pfad oder https://... eingeben'})
            )
          ),
          e(UI.DField,{label:'Analyse-Modus'},e(UI.DSelect,{value:ctx.get('evMode'),onChange:ctx.set('evMode'),options:modeOpts}))
        ),
        e('div',{style:{display:'flex',gap:'8px',flexWrap:'wrap'}},
          e(UI.DBtn,{label:ctx.get('evAnalyzing')?'⏳ Analysiere...':'👁 Analysieren',primary:true,
            disabled:ctx.get('evAnalyzing')||!ctx.get('evPath').trim(),onClick:doAnalyze}),
          e(UI.DBtn,{label:'🔍 Tiefenanalyse',
            disabled:ctx.get('evAnalyzing')||!ctx.get('evPath').trim(),onClick:doDeepAnalyze})
        ),
        e('div',{style:{marginTop:'8px',fontSize:'11px',color:'var(--text-secondary)'}},'Benötigt Vision-Modell: ',
          e('code',{style:{fontFamily:'JetBrains Mono, monospace',color:'var(--accent-primary)'}},'ollama pull llama3.2-vision'))
      ),
      ctx.get('evAnalyzing') && e('div',{style:{textAlign:'center',padding:'30px',color:'var(--text-secondary)'}},
        e('div',{className:'loading',style:{marginBottom:'12px'}}),
        e('div',null,'Bild wird analysiert...')
      ),
      !ctx.get('evAnalyzing') && res && res.error && e('div',{style:{padding:'14px',background:'rgba(231,76,60,0.1)',border:'1px solid #e74c3c',borderRadius:'8px',color:'#e74c3c'}},
        e('div',{style:{fontWeight:'700',marginBottom:'4px'}},'⚠ Analyse fehlgeschlagen'),
        e('div',{style:{fontSize:'13px'}},res.error)
      ),
      !ctx.get('evAnalyzing') && res && !res.error && e('div',{className:'agent-card'},
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}},
          e('h3',{style:{margin:0,color:'var(--accent-primary)'}},'🔍 '+(res.modeName||res.mode||'Analyse-Ergebnis')),
          e('div',{style:{display:'flex',gap:'8px'}},
            e(UI.DBtn,{label:'📋 Kopieren',small:true,onClick:function(){ ctx.inv('set-clipboard-text',resultText); }})
          )
        ),
        res.analysis && e('div',{style:{whiteSpace:'pre-wrap',fontSize:'14px',lineHeight:'1.6',padding:'14px',background:'var(--bg-primary)',borderRadius:'8px',maxHeight:'400px',overflowY:'auto'}},
          typeof res.analysis==='string'?res.analysis:JSON.stringify(res.analysis,null,2)),
        res.synthesis && e('div',{style:{marginTop:'10px',padding:'12px',background:'rgba(0,255,136,0.05)',border:'1px solid rgba(0,255,136,0.2)',borderRadius:'8px'}},
          e('div',{style:{fontWeight:'700',marginBottom:'6px',color:'var(--accent-primary)'}},'Zusammenfassung'),
          e('div',{style:{fontSize:'13px',lineHeight:'1.6',whiteSpace:'pre-wrap'}},res.synthesis)
        ),
        res.objects && res.objects.length>0 && e('div',{style:{marginTop:'10px'}},
          e('div',{style:{fontWeight:'600',marginBottom:'6px',fontSize:'13px'}},'Erkannte Objekte:'),
          e('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap'}},
            res.objects.map(function(obj,i){
              return e('span',{key:i,style:{padding:'2px 10px',background:'var(--bg-tertiary)',borderRadius:'12px',fontSize:'12px'}},
                typeof obj==='string'?obj:(obj.name||JSON.stringify(obj)));
            })
          )
        )
      )
    );
  }

function viewTimeSeries(){
    function loadSample(){
      var data=[];var base=Date.now()-30*86400000;
      for(var i=0;i<30;i++) data.push({timestamp:base+i*86400000,value:Math.round((100+Math.sin(i*0.5)*20+Math.random()*10+(i>20?30:0))*10)/10});
      ctx.inv('tsa-load',{data:data,options:{name:'sample_30d'}}).then(function(meta){
        ctx.set('tsaActive')(meta&&meta.id||'sample_30d');
        ctx.inv('tsa-list').then(function(v){ if(v) ctx.set('tsaDatasets')(v); });
      });
    }
    function runFull(id){
      ctx.set('tsaActive')(id);
      Promise.all([ctx.inv('tsa-statistics',id),ctx.inv('tsa-trend',{datasetId:id}),ctx.inv('tsa-anomalies',{datasetId:id}),ctx.inv('tsa-forecast',{datasetId:id,periods:7})])
        .then(function(r){ ctx.set('tsaResult')({stats:r[0],trend:r[1],anomalies:r[2],forecast:r[3]}); });
    }
    var datasets = ctx.get('tsaDatasets');
    var res = ctx.get('tsaResult');
    return e('div',null,
      e('h2',{style:{marginBottom:'20px'}},'Time Series Analysis'),
      e('div',{style:{display:'flex',gap:'8px',marginBottom:'16px'}},
        e(UI.DBtn,{label:'Sample-Daten (30 Tage)',primary:true,onClick:loadSample}),
        ctx.get('tsaActive') && e(UI.DBtn,{label:'Vollanalyse',onClick:function(){ runFull(ctx.get('tsaActive')); }})
      ),
      datasets.length>0 && e('div',{className:'agent-card',style:{marginBottom:'16px'}},
        e('h3',{style:{margin:'0 0 8px'}},'Datasets'),
        datasets.map(function(ds){ return e('div',{key:ds.id,style:{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--border-color)'}},
          e('span',null,e('strong',null,ds.id),' · '+ds.count+' Punkte · '+ds.frequency),
          e(UI.DBtn,{label:'Analysieren',small:true,onClick:function(){ runFull(ds.id); }})
        ); })
      ),
      res && e('div',null,
        res.stats && e('div',{className:'agent-card',style:{marginBottom:'10px'}},
          e('h3',{style:{margin:'0 0 8px'}},'Statistik'),
          e(UI.DInfoRow,{label:'Mittelwert',value:res.stats.mean!=null?res.stats.mean.toFixed(2):'–'}),
          e(UI.DInfoRow,{label:'Std.Abw.',value:res.stats.stddev!=null?res.stats.stddev.toFixed(2):'–'}),
          e(UI.DInfoRow,{label:'Min / Max',value:(res.stats.min!=null?res.stats.min.toFixed(1):'?')+' / '+(res.stats.max!=null?res.stats.max.toFixed(1):'?')})
        ),
        res.trend && e('div',{className:'agent-card',style:{marginBottom:'10px'}},
          e('h3',{style:{margin:'0 0 8px'}},'Trend'),
          e('div',{style:{color:res.trend.direction==='rising'?'var(--success)':res.trend.direction==='falling'?'#e74c3c':'var(--text-secondary)',fontWeight:'600'}},res.trend.summary||res.trend.direction)
        ),
        res.anomalies && e('div',{className:'agent-card',style:{marginBottom:'10px'}},
          e('h3',{style:{margin:'0 0 8px'}},'Anomalien ('+res.anomalies.anomalies.length+')'),
          res.anomalies.anomalies.slice(0,5).map(function(a,i){ return e('div',{key:i,style:{fontSize:'13px',padding:'4px 0'}},a.type+' @ #'+a.index+': '+(a.value!=null?a.value.toFixed(1):'–')); })
        ),
        res.forecast && e('div',{className:'agent-card'},
          e('h3',{style:{margin:'0 0 8px'}},'Prognose ('+res.forecast.method+')'),
          res.forecast.predictions.slice(0,7).map(function(p,i){ return e('div',{key:i,style:{display:'flex',justifyContent:'space-between',fontSize:'13px',fontFamily:'JetBrains Mono, monospace',padding:'3px 0'}},
            e('span',null,'T+'+p.period),e('span',{style:{color:'var(--accent-primary)',fontWeight:'600'}},p.value),e('span',{style:{color:'var(--text-secondary)',fontSize:'11px'}},'['+p.lower+' – '+p.upper+']')
          ); })
        )
      )
    );
  }

function viewIntegrationHub(){
    function refresh(){
      ctx.inv('hub-connections').then(function(v){ if(v) ctx.set('hubConns')(v); });
      ctx.inv('hub-list-workflows').then(function(v){ if(v) ctx.set('hubWorkflows')(v); });
      ctx.inv('hub-templates').then(function(v){ if(v) ctx.set('hubTemplates')(v); });
    }

    // Template-spezifische Felder
    var TEMPLATE_FIELDS = {
      notion:    [{k:'token',l:'Integration Token',t:'password',ph:'secret_...',hint:'notion.so → Settings → Integrations → New'}],
      trello:    [{k:'key',l:'API Key',t:'text',ph:'',hint:'trello.com/app-key'},{k:'token',l:'Token',t:'password',ph:''}],
      jira:      [{k:'domain',l:'Domain',t:'text',ph:'yourcompany'},{k:'email',l:'Email',t:'text',ph:'you@company.com'},{k:'apiToken',l:'API Token',t:'password',ph:'',hint:'id.atlassian.com → Security → API tokens'}],
      linear:    [{k:'token',l:'API Key',t:'password',ph:'lin_api_...',hint:'linear.app → Settings → API'}],
      airtable:  [{k:'token',l:'Personal Access Token',t:'password',ph:'pat...',hint:'airtable.com/create/tokens'}],
      github:    [{k:'token',l:'Personal Access Token',t:'password',ph:'ghp_...',hint:'github.com → Settings → Developer settings → PAT'}],
      gitlab:    [{k:'token',l:'Access Token',t:'password',ph:'glpat-...'}],
      shopify:   [{k:'shopDomain',l:'Shop Domain',t:'text',ph:'myshop.myshopify.com'},{k:'accessToken',l:'Admin API Token',t:'password',ph:'shpat_...'}],
      custom:    [{k:'baseUrl',l:'Base URL',t:'text',ph:'https://api.example.com'},{k:'token',l:'API Token / Key',t:'password',ph:''}],
    };

    var connectingTo = ctx.get('hubConnecting');
    var connForm     = ctx.get('hubConnForm')||{};
    var conns        = ctx.get('hubConns');
    var templates    = ctx.get('hubTemplates');
    var workflows    = ctx.get('hubWorkflows');

    function openConnectForm(tmpl){
      ctx.set('hubConnecting')(tmpl.id);
      ctx.set('hubConnForm')({});
    }
    function doConnect(){
      var tmplId = connectingTo;
      var fields = TEMPLATE_FIELDS[tmplId]||TEMPLATE_FIELDS.custom;
      var creds = {};
      fields.forEach(function(f){ creds[f.k] = connForm[f.k]||''; });
      var cfg = {};
      if(connForm.baseUrl) cfg.baseUrl = connForm.baseUrl;
      ctx.inv('hub-connect',{serviceId:tmplId+'_'+Date.now().toString(36),template:tmplId,credentials:creds,config:cfg})
        .then(function(r){
          if(r&&r.error){ alert('Fehler: '+r.error); return; }
          ctx.set('hubConnecting')(null);
          ctx.set('hubConnForm')({});
          ctx.set('savedMsg')('✓ Verbunden!');
          setTimeout(function(){ctx.set('savedMsg')('');},2500);
          refresh();
        });
    }
    function checkHealth(){
      ctx.inv('hub-health').then(function(r){
        if(r) ctx.set('savedMsg')('Health: '+JSON.stringify(r).slice(0,80));
        setTimeout(function(){ctx.set('savedMsg')('');},4000);
      });
    }

    return e('div',null,
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',{style:{margin:0}},'Integration Hub'),
        e('div',{style:{display:'flex',gap:'8px'}},
          e(UI.DBtn,{label:'↻ Aktualisieren',small:true,onClick:refresh}),
          conns.length>0 && e(UI.DBtn,{label:'Health Check',small:true,onClick:checkHealth})
        )
      ),

      // Connect-Formular
      connectingTo && e('div',{className:'agent-card',style:{marginBottom:'20px',border:'1px solid var(--accent-primary)'}},
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}},
          e('h3',{style:{margin:0,color:'var(--accent-primary)'}},
            '🔌 Verbinde: '+(connectingTo.charAt(0).toUpperCase()+connectingTo.slice(1))),
          e('button',{className:'btn',style:{padding:'4px 12px',fontSize:'12px'},onClick:function(){ctx.set('hubConnecting')(null);}}, '✕ Abbrechen')
        ),
        (TEMPLATE_FIELDS[connectingTo]||TEMPLATE_FIELDS.custom).map(function(f){
          return e(UI.DField,{key:f.k,label:f.l,hint:f.hint},
            e(UI.DInput,{type:f.t||'text',value:connForm[f.k]||'',placeholder:f.ph||'',
              onChange:function(v){ ctx.set('hubConnForm')(function(prev){var n=Object.assign({},prev);n[f.k]=v;return n;}); }
            })
          );
        }),
        e(UI.DBtn,{label:'Verbinden',primary:true,onClick:doConnect,
          disabled:!(TEMPLATE_FIELDS[connectingTo]||TEMPLATE_FIELDS.custom).every(function(f){
            return f.t==='text'&&f.k==='baseUrl' ? true : !!(connForm[f.k]&&connForm[f.k].trim());
          })
        })
      ),

      // Aktive Verbindungen
      conns.length>0 && e('div',{style:{marginBottom:'24px'}},
        e('h3',{style:{margin:'0 0 10px',fontSize:'14px',color:'var(--accent-primary)'}},'✓ Verbunden ('+conns.length+')'),
        e('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:'8px'}},
          conns.map(function(c){
            var healthy = c.health&&c.health.status==='healthy';
            return e('div',{key:c.id,className:'agent-card',style:{padding:'12px 14px'}},
              e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}},
                e('div',null,
                  e('strong',{style:{fontSize:'14px'}},c.service.charAt(0).toUpperCase()+c.service.slice(1)),
                  e('span',{style:{fontSize:'11px',marginLeft:'8px',color:healthy?'var(--success)':'var(--warning)'}},
                    healthy?'● Online':'● '+((c.health&&c.health.status)||'unbekannt'))
                ),
                e(UI.DBtn,{label:'Trennen',small:true,danger:true,
                  onClick:function(){ if(confirm('Verbindung trennen?')) ctx.inv('hub-disconnect',c.id).then(refresh); }})
              ),
              c.baseUrl && e('div',{style:{fontSize:'11px',color:'var(--text-secondary)',fontFamily:'JetBrains Mono, monospace',
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},c.baseUrl)
            );
          })
        )
      ),

      // Service-Templates
      e('div',null,
        e('h3',{style:{margin:'0 0 12px',fontSize:'14px'}},'Services verbinden'),
        templates.length===0 && e('div',{style:{textAlign:'center',padding:'30px',color:'var(--text-secondary)'}},
          e('div',{style:{fontSize:'36px',marginBottom:'8px'}},'🔌'),
          e('div',null,'Lade Templates...'),
          e(UI.DBtn,{label:'Laden',onClick:refresh,style:{marginTop:'12px'}})
        ),
        e('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'8px'}},
          // Built-in templates die immer verfügbar sind
          ['notion','trello','jira','linear','airtable','github','gitlab','shopify','custom'].map(function(id){
            var t = templates.find(function(t){return t.id===id;})||{id:id,name:id.charAt(0).toUpperCase()+id.slice(1),endpoints:[]};
            var alreadyConn = conns.some(function(c){return c.service===id;});
            var icons = {notion:'📝',trello:'📋',jira:'🎯',linear:'📐',airtable:'🗃',github:'🐙',gitlab:'🦊',shopify:'🛍',custom:'🔧'};
            return e('div',{key:id,className:'agent-card',style:{
              padding:'12px',cursor:alreadyConn?'default':'pointer',textAlign:'center',
              opacity:alreadyConn?0.6:1,
              border:connectingTo===id?'1px solid var(--accent-primary)':'1px solid var(--border-color)'
            },onClick:function(){ if(!alreadyConn) openConnectForm(t); }},
              e('div',{style:{fontSize:'24px',marginBottom:'6px'}},icons[id]||'🔌'),
              e('div',{style:{fontWeight:'700',fontSize:'13px'}},t.name),
              e('div',{style:{fontSize:'10px',color:'var(--text-secondary)',marginTop:'2px'}},
                alreadyConn?'✓ Verbunden':(t.endpoints&&t.endpoints.length>0?t.endpoints.length+' Endpoints':'Klicken zum Verbinden'))
            );
          })
        )
      ),

      // Workflows
      e('div',{style:{marginTop:'24px'}},
        e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}},
          e('h3',{style:{margin:0,fontSize:'14px'}},'Workflows'),
          e(UI.DBtn,{label:'+ Workflow',small:true,onClick:function(){
            var name=prompt('Workflow-Name:');
            if(!name) return;
            ctx.inv('hub-create-workflow',{name:name,trigger:{type:'manual'},actions:[]}).then(refresh);
          }})
        ),
        workflows.length===0
          ? e('p',{style:{color:'var(--text-secondary)',fontSize:'13px'}},'Noch keine Workflows. Automatisiere Aktionen zwischen Services.')
          : workflows.map(function(wf){ return e('div',{key:wf.id,className:'agent-card',style:{padding:'10px 14px',marginBottom:'6px',display:'flex',justifyContent:'space-between',alignItems:'center'}},
              e('div',null,
                e('strong',null,wf.name),
                e('span',{style:{fontSize:'11px',marginLeft:'8px',color:wf.enabled?'var(--success)':'var(--text-secondary)'}},
                  wf.enabled?'● Aktiv':'● Pausiert')
              ),
              e('div',{style:{display:'flex',gap:'6px'}},
                e(UI.DBtn,{label:wf.enabled?'Pause':'Start',small:true,
                  onClick:function(){ ctx.inv('hub-toggle-workflow',wf.id).then(refresh); }}),
                e(UI.DBtn,{label:'✕',small:true,danger:true,
                  onClick:function(){ if(confirm('Workflow löschen?')) ctx.inv('hub-delete-workflow',wf.id).then(refresh); }})
              )
            ); })
      )
    );
  }

  return {
    emotionai: viewEmotionAI, creativewriting: viewCreativeWriting,
    enhancedvision: viewEnhancedVision, timeseries: viewTimeSeries,
    integrationhub: viewIntegrationHub,
  };
}
module.exports = { createAdvancedViews };
