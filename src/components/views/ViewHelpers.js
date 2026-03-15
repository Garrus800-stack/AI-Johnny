/**
 * ViewHelpers — Action-Funktionen die von Views genutzt werden
 * Extrahiert aus der monolithischen App.jsx
 */
'use strict';

function _api() { return (typeof window !== 'undefined' && window.johnny) ? window.johnny : window.ipcRenderer; }


function createHelpers(ctx) {
  var messagesEndRef = React.useRef(null);

  // ── Chat (Streaming) ─────────────────────────────────────────────────
  function sendMessage() {
    var msg = ctx.get('input').trim();
    if(!msg || ctx.get('loading')) return;
    ctx.set('input')('');
    ctx.set('toolSteps')([]);
    ctx.set('streamText')('');
    ctx.set('messages')(function(p){ return p.concat([{role:'user',content:msg,ts:Date.now()}]); });
    ctx.set('loading')(true);

    var streamBuffer = '';
    var streamDone = false;
    var streamUnsub = _api().on('stream-chunk', function(d) {
      if (!d || streamDone) return;
      if (d.text) { streamBuffer += d.text; ctx.set('streamText')(streamBuffer); }
      if (d.done) {
        streamDone = true;
        if (streamUnsub) streamUnsub();
        var finalText = streamBuffer || '';
        if (d.error) { finalText = finalText || ('Fehler: ' + d.error); notify('error', d.error); }
        if (finalText) {
          ctx.set('messages')(function(p){ return p.concat([{role:'assistant',content:finalText,agent:ctx.get('activeAgent'),ts:Date.now()}]); });
        }
        if(d.conversationId) ctx.set('convId')(d.conversationId);
        ctx.set('loading')(false); ctx.set('streamText')('');
        if(ctx.get('ttsActive') && finalText) speakText(finalText);
      }
    });

    _api().invoke('send-message-stream',{agentName:ctx.get('activeAgent'),message:msg,conversationId:ctx.get('convId')})
      .then(function(res){
        // Falls kein Streaming passiert ist → normales Result nutzen
        if (!streamDone && res && (res.response || res.message)) {
          streamDone = true;
          if (streamUnsub) streamUnsub();
          var reply = res.response || res.message || 'No response';
          ctx.set('messages')(function(p){ return p.concat([{role:'assistant',content:reply,agent:ctx.get('activeAgent'),ts:Date.now()}]); });
          if(res.conversationId) ctx.set('convId')(res.conversationId);
          ctx.set('loading')(false); ctx.set('streamText')('');
          if(ctx.get('ttsActive')) speakText(reply);
        }
      })
      .catch(function(e){
        streamDone = true;
        if (streamUnsub) streamUnsub();
        ctx.set('messages')(function(p){ return p.concat([{role:'system',content:'Error: '+e.message,ts:Date.now()}]); });
        ctx.set('loading')(false); ctx.set('streamText')('');
        notify('error', e.message);
      });
  }
  function sendMsg(text){
    if(!text||!text.trim()||ctx.get('loading')) return;
    ctx.set('input')(text);
    sendMessage();
  }

  // ── Notifications (Toast) ──────────────────────────────────────────────
  function notify(type, message) {
    var id = Date.now() + Math.random();
    ctx.set('toasts')(function(prev) {
      return (prev||[]).concat([{id:id,type:type,message:message}]).slice(-5);
    });
    setTimeout(function(){
      ctx.set('toasts')(function(prev){ return (prev||[]).filter(function(t){return t.id!==id;}); });
    }, type === 'error' ? 8000 : 4000);
  }
  function handleKey(e){ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} }

  // ── Agents ──────────────────────────────────────────────────────────────
  function openCreateAgent(){
    ctx.set('form')({name:'',role:'',personality:'',modelProvider:'ollama',model:ctx.get('activeModel'),capabilities:['tool-calling','autonomous-decision']});
    ctx.set('modal')('agent');
  }
  function submitAgent(){
    if(!ctx.get('form').name) return;
    ctx.inv('create-agent', ctx.get('form')).then(function(){ ctx.actions.loadAll(); ctx.set('modal')(null); });
  }
  function deleteAgent(name){ ctx.inv('delete-agent',name).then(function(){ ctx.actions.loadAll(); }); }

  // ── Skills ──────────────────────────────────────────────────────────────
  function openCreateSkill(){
    ctx.set('form')({name:'',description:'',language:'javascript'});
    ctx.set('modal')('skill');
  }
  function submitSkill(){
    if(!ctx.get('form').name) return;
    ctx.inv('create-skill',ctx.get('form')).then(function(){ ctx.actions.loadAll(); ctx.set('modal')(null); });
  }

  // ── API Keys ──────────────────────────────────────────────────────────
  function openApiKey(p){
    ctx.set('form')({providerId:p.id,providerName:p.name,key:''});
    ctx.set('modal')('apikey');
  }
  function submitApiKey(){
    if(!ctx.get('form').key) return;
    ctx.inv('set-api-key',{provider:ctx.get('form').providerId,apiKey:ctx.get('form').key}).then(function(){ ctx.actions.loadAll(); ctx.set('modal')(null); });
  }

  // ── Messenger ──────────────────────────────────────────────────────────
  function openMessenger(type){
    ctx.set('form')({type:type||'telegram',token:'',chatId:'',phoneNumber:'',botToken:'',appToken:'',homeserver:'',userId:'',password:'',accessToken:'',sessionName:''});
    ctx.set('modal')('messenger');
  }
  function submitMessenger(){
    var f = ctx.get('form'), type = f.type;
    var config = { agentName: ctx.get('activeAgent') };
    switch(type) {
      case 'telegram': config.token = f.token; break;
      case 'discord':  config.token = f.token; break;
      case 'whatsapp': config.sessionName = f.sessionName || 'johnny-whatsapp'; break;
      case 'signal':   config.phoneNumber = f.phoneNumber; break;
      case 'slack':    config.botToken = f.botToken; config.appToken = f.appToken; break;
      case 'matrix':   config.homeserver = f.homeserver; config.userId = f.userId; config.password = f.password; if(f.accessToken) config.accessToken = f.accessToken; break;
    }
    ctx.inv('connect-messenger',{messenger:type,config:config}).then(function(r){
      if(r&&r.error) ctx.actions.log('Messenger: '+r.error);
      ctx.actions.loadAll(); ctx.set('modal')(null);
    });
  }
  function disconnectMessenger(name){ ctx.inv('disconnect-messenger',name).then(function(){ ctx.actions.loadAll(); }); }

  // ── Email ──────────────────────────────────────────────────────────────
  function openEmail(){
    ctx.set('form')({displayName:'',email:'',password:'',imapHost:'',smtpHost:''});
    ctx.set('modal')('email');
  }
  function submitEmail(){
    if(!ctx.get('form').email) return;
    ctx.inv('create-email-account',ctx.get('form')).then(function(){ ctx.actions.loadAll(); ctx.set('modal')(null); });
  }

  // ── Tunnel ──────────────────────────────────────────────────────────────
  function startTunnel(){
    ctx.set('tunnelMsg')('Starting...');
    ctx.inv('start-cloudflare-tunnel',{port:parseInt(ctx.get('tunnelPort'))||8765,protocol:'http'})
      .then(function(r){ if(r&&r.url){ctx.set('tunnelUrl')(r.url);ctx.set('tunnelRunning')(true);ctx.set('tunnelMsg')('✓ Active');} });
  }
  function stopTunnel(){ ctx.inv('stop-cloudflare-tunnel').then(function(){ ctx.set('tunnelRunning')(false);ctx.set('tunnelUrl')('');ctx.set('tunnelMsg')('Stopped'); }); }
  function installCloudflared(){ ctx.set('tunnelMsg')('Installing...'); ctx.inv('install-cloudflared').then(function(r){ ctx.set('tunnelMsg')(r?r.message||'Done':'Failed'); }); }

  // ── Voice / TTS ─────────────────────────────────────────────────────────
  var mediaRecorderRef = {current: null};
  var audioChunksRef   = {current: []};
  var ttsAudioRef      = {current: null};

  function startRecording(){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      ctx.set('voiceStatus')('❌ Mikrofon nicht verfügbar'); return;
    }
    ctx.set('voiceStatus')('🎤 Zugriff...');
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
      var mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr; audioChunksRef.current = [];
      mr.ondataavailable = function(ev){ if(ev.data.size>0) audioChunksRef.current.push(ev.data); };
      mr.onstop = function(){
        var blob = new Blob(audioChunksRef.current, {type:'audio/webm'});
        var reader = new FileReader();
        reader.onload = function(){
          ctx.set('voiceStatus')('⏳ Transkribiere...');
          _api().invoke('transcribe-audio', reader.result)
            .then(function(text){
              if(text){ ctx.set('input')(text); ctx.set('voiceStatus')('✅ '+text.slice(0,40)); setTimeout(function(){ sendMsg(text); ctx.set('voiceStatus')(''); }, 500); }
              else { ctx.set('voiceStatus')('⚠ Keine Sprache erkannt'); setTimeout(function(){ctx.set('voiceStatus')('');}, 3000); }
            })
            .catch(function(e){ ctx.set('voiceStatus')('❌ '+e.message.slice(0,60)); setTimeout(function(){ctx.set('voiceStatus')('');}, 6000); });
        };
        reader.readAsArrayBuffer(blob);
        stream.getTracks().forEach(function(t){t.stop();});
      };
      mr.start(); ctx.set('recording')(true); ctx.set('voiceStatus')('🔴 Aufnahme läuft');
    }).catch(function(e){ ctx.set('voiceStatus')('❌ '+e.message); });
  }
  function stopRecording(){
    if(mediaRecorderRef.current && mediaRecorderRef.current.state!=='inactive') mediaRecorderRef.current.stop();
    ctx.set('recording')(false); ctx.set('voiceStatus')('');
  }
  function toggleVoice(){ if(ctx.get('recording')) stopRecording(); else startRecording(); }

  function speakText(text){
    if(!text || !text.trim()) return;
    var prov = ctx.get('ttsProvider') || 'browser';
    if(ttsAudioRef.current){ ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
    if(window.speechSynthesis) window.speechSynthesis.cancel();
    _api().invoke('speak-text',{text:text, provider:prov}).then(function(res){
      if(!res || !res.success) return;
      if(res.audioBase64){
        var blob = new Blob([Uint8Array.from(atob(res.audioBase64),function(c){return c.charCodeAt(0);})], {type: res.mimeType||'audio/mpeg'});
        var url = URL.createObjectURL(blob);
        var audio = new Audio(url);
        ttsAudioRef.current = audio;
        audio.onended = function(){ URL.revokeObjectURL(url); ttsAudioRef.current = null; };
        audio.play().catch(function(){});
      } else if(res.provider === 'browser' && window.speechSynthesis){
        var utter = new SpeechSynthesisUtterance(res.text || text);
        var lang = res.lang || 'de-DE';
        utter.lang = lang.length === 2 ? (lang==='de'?'de-DE':lang==='en'?'en-US':lang+'-'+lang.toUpperCase()) : lang;
        var voices = window.speechSynthesis.getVoices();
        var match = voices.find(function(v){ return v.lang.startsWith(utter.lang.slice(0,2)); });
        if(match) utter.voice = match;
        window.speechSynthesis.speak(utter);
      }
    }).catch(function(){});
  }
  function stopSpeaking(){
    if(ttsAudioRef.current){ ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
    if(window.speechSynthesis) window.speechSynthesis.cancel();
  }

  // ── Sandbox ──────────────────────────────────────────────────────────
  function runSandbox(){
    if(ctx.get('sandboxRunning')) return;
    ctx.set('sandboxRunning')(true); ctx.set('sandboxOutput')('Running...');
    ctx.inv('sandbox-run',{language:ctx.get('sandboxLang'),code:ctx.get('sandboxCode'),timeout:15000})
      .then(function(r){
        if(!r){ ctx.set('sandboxOutput')('[no output]'); return; }
        var out = r.output || r.stdout || '';
        var err = r.errors || r.stderr || '';
        var errMsg = r.error || '';
        var result = out + (err ? '\n[stderr] ' + err : '') + (errMsg ? '\n[error] ' + errMsg : '');
        ctx.set('sandboxOutput')(result.trim() || '[no output]');
      })
      .catch(function(e){ ctx.set('sandboxOutput')('[error] '+e.message); })
      .finally(function(){ ctx.set('sandboxRunning')(false); });
  }
  function setSandboxMode(mode){
    ctx.set('sandboxMode')(mode);
    ctx.inv('sandbox-set-mode', mode).then(function(v){ if(v) ctx.set('sandboxStatus')(v); });
    ctx.inv('save-settings',{sandboxMode:mode});
  }

  // ── Tasks ──────────────────────────────────────────────────────────
  function clearTasks(){ ctx.inv('clear-tasks').then(function(){ ctx.set('tasks')([]); }); }
  function refreshTasks(){ ctx.inv('get-tasks').then(function(v){ if(v) ctx.set('tasks')(v); }); }

  return {
    messagesEndRef: messagesEndRef,
    sendMessage: sendMessage, sendMsg: sendMsg, handleKey: handleKey,
    openCreateAgent: openCreateAgent, submitAgent: submitAgent, deleteAgent: deleteAgent,
    openCreateSkill: openCreateSkill, submitSkill: submitSkill,
    openApiKey: openApiKey, submitApiKey: submitApiKey,
    openMessenger: openMessenger, submitMessenger: submitMessenger, disconnectMessenger: disconnectMessenger,
    openEmail: openEmail, submitEmail: submitEmail,
    startTunnel: startTunnel, stopTunnel: stopTunnel, installCloudflared: installCloudflared,
    startRecording: startRecording, stopRecording: stopRecording, toggleVoice: toggleVoice,
    speakText: speakText, stopSpeaking: stopSpeaking,
    runSandbox: runSandbox, setSandboxMode: setSandboxMode,
    clearTasks: clearTasks, refreshTasks: refreshTasks,
    notify: notify,
  };
}

module.exports = { createHelpers: createHelpers };
