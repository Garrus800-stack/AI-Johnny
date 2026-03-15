/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SPEECH SERVICE v2.0                                                ║
 * ║  Erweiterte Spracherkennung + Sprachsynthese                       ║
 * ║  • Faster-Whisper / Whisper.cpp / OpenAI Whisper                   ║
 * ║  • Echtzeit-Streaming mit VAD (Voice Activity Detection)           ║
 * ║  • Continuous Listening Mode                                        ║
 * ║  • Rauschunterdrückung, Auto-Chunking >25 MB                       ║
 * ║  • Sprecher-Erkennung (einfache Diarization)                       ║
 * ║  • TTS: OpenAI HD / ElevenLabs / Coqui / Edge / System            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fs               = require('fs').promises;
const path             = require('path');
const os               = require('os');
const { exec, spawn }  = require('child_process');
const { promisify }    = require('util');
const { EventEmitter } = require('events');
const execAsync        = promisify(exec);

const CHUNK_MAX_BYTES  = 24 * 1024 * 1024;
const CHUNK_DURATION_S = 300;
const CONTINUOUS_POLL  = 250;

class SpeechService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.openaiKey     = config.openaiApiKey    || process.env.OPENAI_API_KEY;
    this.elevenlabsKey = config.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY;
    this.ttsProvider   = config.ttsProvider  || 'auto';
    this.sttProvider   = config.sttProvider  || 'auto';
    this.defaultLang   = config.language     || 'de';
    this.audioDir      = config.audioDir     || path.join(os.tmpdir(), 'johnny-audio');
    this.gateway       = config.gateway;

    this.voices = {
      openai:     { alloy:'Neutral', echo:'Tief,männlich', fable:'Warm', onyx:'Autoritär', nova:'Freundlich,weiblich', shimmer:'Sanft' },
      edge:       { 'de-DE-ConradNeural':'Conrad DE','de-DE-KatjaNeural':'Katja DE','en-US-GuyNeural':'Guy EN','en-US-JennyNeural':'Jenny EN','en-GB-RyanNeural':'Ryan GB' },
      elevenlabs: { rachel:'Rachel—warm', drew:'Drew—ruhig', clyde:'Clyde—tief', paul:'Paul—klar', domi:'Domi—energisch', bella:'Bella—sanft' },
    };

    this.selectedVoice = config.voice || 'nova';
    this._initialized  = false;
    this._listening    = false;
    this._listenProc   = null;
    this._transcBuf    = '';
  }

  /* ─── Init ───────────────────────────────────────────────────────── */
  async initialize() {
    await fs.mkdir(this.audioDir, { recursive: true });
    this._cap = {
      openaiSTT:     !!this.openaiKey,      openaiTTS:     !!this.openaiKey,
      elevenlabsTTS: !!this.elevenlabsKey,   edgeTTS:       await this._has('edge-tts'),
      whisperLocal:  await this._has('whisper'), fasterWhisper: await this._has('faster-whisper'),
      whisperCpp:    await this._hasWCpp(),  coquiTTS:      await this._has('tts'),
      ffmpeg:        await this._has('ffmpeg'), sox:          await this._has('sox'),
      systemTTS:     process.platform === 'win32' || process.platform === 'darwin',
    };
    if (this.sttProvider === 'auto')
      this.sttProvider = this._cap.fasterWhisper?'faster_whisper': this._cap.whisperCpp?'whisper_cpp': this._cap.openaiSTT?'openai': this._cap.whisperLocal?'whisper_local':'none';
    if (this.ttsProvider === 'auto')
      this.ttsProvider = this._cap.elevenlabsTTS?'elevenlabs': this._cap.openaiTTS?'openai': this._cap.coquiTTS?'coqui': this._cap.edgeTTS?'edge': this._cap.systemTTS?'system':'none';
    this._initialized = true;
    console.log(`[Speech v2] STT=${this.sttProvider} TTS=${this.ttsProvider}`);
    return this._cap;
  }

  /* ═══ STT ════════════════════════════════════════════════════════ */
  async transcribe(audioPath, opts={}) {
    const { language=this.defaultLang, timestamps=false, wordLevel=false, denoise=true, translate=false, diarize=false } = opts;
    if (this.sttProvider==='none') throw new Error('Kein STT-Provider. Installiere faster-whisper oder setze OPENAI_API_KEY.');
    let proc = audioPath;
    if (denoise && this._cap.ffmpeg) proc = await this._denoise(audioPath);
    const stat = await fs.stat(proc);
    if (stat.size > CHUNK_MAX_BYTES) return this._chunked(proc, {language,timestamps,wordLevel,translate});
    let r;
    switch(this.sttProvider){
      case 'openai':         r = await this._sttOAI(proc,language,timestamps,translate); break;
      case 'faster_whisper': r = await this._sttFW(proc,language,timestamps,wordLevel); break;
      case 'whisper_cpp':    r = await this._sttWCpp(proc,language,timestamps); break;
      case 'whisper_local':  r = await this._sttWL(proc,language,timestamps); break;
      default: throw new Error(`STT? ${this.sttProvider}`);
    }
    if (diarize && r.segments?.length) r.speakers = this._diarize(r.segments);
    this.emit('transcription', r);
    return r;
  }

  /* Streaming / Continuous Listening */
  async startStreaming(opts={}) {
    if (this._listening) return {error:'Bereits im Listening-Mode'};
    this._listening = true; this._transcBuf = '';
    this.emit('listening.started');
    const loop = async ()=>{
      if (!this._listening) return;
      const cp = path.join(this.audioDir,`s_${Date.now()}.wav`);
      try {
        await this._recordMic(cp,3);
        if (await this._vad(cp)) {
          const r = await this.transcribe(cp,{language:opts.language||this.defaultLang,denoise:false});
          if (r.text?.trim()) { this._transcBuf+=' '+r.text.trim(); this.emit('transcription.partial',{text:r.text.trim(),accumulated:this._transcBuf.trim()}); }
        }
        await fs.unlink(cp).catch(()=>{});
      } catch(e){ this.emit('transcription.error',{error:e.message}); }
      if (this._listening) setTimeout(loop, CONTINUOUS_POLL);
    };
    loop();
    return {success:true};
  }
  stopStreaming() {
    this._listening = false;
    if (this._listenProc){this._listenProc.kill();this._listenProc=null;}
    const f = this._transcBuf.trim(); this._transcBuf='';
    this.emit('listening.stopped',{finalTranscript:f});
    return {success:true, finalTranscript:f};
  }

  async detectLanguage(audioPath) {
    const r = await this.transcribe(audioPath,{language:'auto',denoise:true,timestamps:true});
    return { detectedLanguage:r.language, confidence: r.segments?.[0]?.avg_logprob?Math.exp(r.segments[0].avg_logprob):null, sampleText:r.text?.slice(0,200) };
  }

  /* ─── STT-Provider ──────────────────────────────────────────── */
  async _sttOAI(ap,lang,ts,translate){
    const FormData=(await import('form-data')).default, fetch=(await import('node-fetch')).default;
    const form=new FormData(); form.append('file',await fs.readFile(ap),{filename:path.basename(ap)}); form.append('model','whisper-1');
    if(lang&&lang!=='auto') form.append('language',lang);
    if(ts){form.append('response_format','verbose_json');form.append('timestamp_granularities[]','word');}
    const url=translate?'https://api.openai.com/v1/audio/translations':'https://api.openai.com/v1/audio/transcriptions';
    const resp=await fetch(url,{method:'POST',headers:{'Authorization':`Bearer ${this.openaiKey}`},body:form});
    if(!resp.ok) throw new Error(`OpenAI STT ${resp.status}`);
    const d=await resp.json();
    return {text:d.text,language:d.language||lang,segments:d.segments||[],words:d.words||[],duration:d.duration,provider:'openai'};
  }
  async _sttFW(ap,lang,ts,wl){
    const la=lang&&lang!=='auto'?`--language ${lang}`:'', wa=wl?'--word_timestamps true':'';
    const {stdout}=await execAsync(`faster-whisper "${ap}" --model medium ${la} ${wa} --output_format json`,{timeout:180000,maxBuffer:10*1024*1024});
    const segs=[]; let txt='';
    for(const l of stdout.trim().split('\n')){try{const s=JSON.parse(l);segs.push(s);txt+=(s.text||'')+' ';}catch{txt+=l+' ';}}
    return {text:txt.trim(),language:lang,segments:segs,provider:'faster_whisper'};
  }
  async _sttWCpp(ap,lang,ts){
    const wp=ap.replace(/\.[^.]+$/,'_16k.wav');
    await execAsync(`ffmpeg -i "${ap}" -ar 16000 -ac 1 -y "${wp}"`,{timeout:30000});
    const m=await this._findWCppModel(), la=lang&&lang!=='auto'?`-l ${lang}`:'';
    try{const{stdout}=await execAsync(`whisper-cpp -m "${m}" -f "${wp}" ${la} --output-json`,{timeout:180000});
      await fs.unlink(wp).catch(()=>{});
      const d=JSON.parse(stdout);
      return{text:d.transcription?.map(s=>s.text).join(' ')||stdout,language:lang,segments:d.transcription||[],provider:'whisper_cpp'};
    }catch(e){await fs.unlink(wp).catch(()=>{});throw new Error(`whisper.cpp: ${e.message}`);}
  }
  async _sttWL(ap,lang,ts){
    const la=lang&&lang!=='auto'?`--language ${lang}`:'', ta=ts?' --word_timestamps True':'';
    const{stdout}=await execAsync(`whisper "${ap}" ${la} --output_format json${ta}`,{timeout:180000});
    try{const d=JSON.parse(await fs.readFile(ap.replace(/\.[^.]+$/,'.json'),'utf-8'));
      return{text:d.text,language:d.language||lang,segments:d.segments||[],provider:'whisper_local'};}
    catch{return{text:stdout.trim(),language:lang,segments:[],provider:'whisper_local'};}
  }

  /* ═══ TTS ════════════════════════════════════════════════════════ */
  async speak(text, opts={}) {
    const {voice=this.selectedVoice,speed=1.0,format='mp3',language=this.defaultLang,emotion=null,provider=this.ttsProvider}=opts;
    if(provider==='none') throw new Error('Kein TTS-Provider.');
    const out=path.join(this.audioDir,`tts_${Date.now()}.${format}`);
    let r;
    switch(provider){
      case 'openai':     r=await this._ttsOAI(text,voice,speed,out);break;
      case 'elevenlabs': r=await this._ttsEL(text,voice,speed,emotion,out);break;
      case 'coqui':      r=await this._ttsCoqui(text,language,out);break;
      case 'edge':       r=await this._ttsEdge(text,voice,speed,language,out);break;
      case 'system':     r=await this._ttsSys(text,language,out);break;
      default: throw new Error(`TTS? ${provider}`);
    }
    this.emit('speech.generated',{provider,...r});
    return r;
  }
  async _ttsOAI(t,v,s,o){const fetch=(await import('node-fetch')).default;const resp=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{'Authorization':`Bearer ${this.openaiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:'tts-1-hd',input:t.slice(0,4096),voice:v,speed:s,response_format:'mp3'})});if(!resp.ok)throw new Error(`TTS ${resp.status}`);const b=Buffer.from(await resp.arrayBuffer());await fs.writeFile(o,b);return{audioPath:o,provider:'openai',voice:v,size:b.length};}
  async _ttsEL(t,v,s,em,o){const fetch=(await import('node-fetch')).default;const vid=({rachel:'21m00Tcm4TlvDq8ikWAM',drew:'29vD33N1CtxCmqQRPOHJ',clyde:'2EiwWnXFnvU5JabPnv8n',paul:'5Q0t7uMcjvnagumLfvZi',domi:'AZnzlk1XvdvUeBnXmlld',bella:'EXAVITQu4vr4xnSDxMaL'})[v]||v;const resp=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`,{method:'POST',headers:{'xi-api-key':this.elevenlabsKey,'Content-Type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({text:t.slice(0,5000),model_id:'eleven_multilingual_v2',voice_settings:{stability:em==='serious'?0.8:0.5,similarity_boost:0.75,style:em==='cheerful'?0.7:0.3,use_speaker_boost:true}})});if(!resp.ok)throw new Error(`EL TTS ${resp.status}`);const b=Buffer.from(await resp.arrayBuffer());await fs.writeFile(o,b);return{audioPath:o,provider:'elevenlabs',voice:vid,size:b.length};}
  async _ttsCoqui(t,lang,o){const m=lang.startsWith('de')?'tts_models/de/thorsten/vits':'tts_models/en/ljspeech/vits';await execAsync(`tts --text "${t.replace(/"/g,'\\"').slice(0,3000)}" --model_name "${m}" --out_path "${o}"`,{timeout:120000});return{audioPath:o,provider:'coqui',model:m};}
  async _ttsEdge(t,v,s,lang,o){const vid=Object.keys(this.voices.edge).includes(v)?v:lang.startsWith('de')?'de-DE-KatjaNeural':'en-US-JennyNeural';const r=s!==1.0?`--rate=${s>1?'+':''}${Math.round((s-1)*100)}%`:'';await execAsync(`edge-tts --voice "${vid}" ${r} --text "${t.replace(/"/g,'\\"').slice(0,5000)}" --write-media "${o}"`,{timeout:60000});return{audioPath:o,provider:'edge',voice:vid};}
  async _ttsSys(t,lang,o){const e=t.replace(/"/g,'\\"').slice(0,2000);if(process.platform==='win32'){await execAsync(`powershell -Command "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${o.replace(/'/g,"''")}'); $s.Speak('${e.replace(/'/g,"''")}'); $s.Dispose()"`,{timeout:30000});}else if(process.platform==='darwin'){await execAsync(`say -o "${o}" "${e}"`,{timeout:30000});}else throw new Error('System-TTS nicht unterstützt');return{audioPath:o,provider:'system'};}

  /* ═══ Audio-Verarbeitung ═════════════════════════════════════════ */
  async _denoise(p){const o=p.replace(/(\.[^.]+)$/,'_clean$1');try{await execAsync(`ffmpeg -i "${p}" -af "highpass=f=80,lowpass=f=8000,afftdn=nf=-25,loudnorm" -y "${o}"`,{timeout:30000});return o;}catch{return p;}}
  async _vad(p){if(!this._cap.ffmpeg)return true;try{const{stderr}=await execAsync(`ffmpeg -i "${p}" -af silencedetect=n=-30dB:d=0.5 -f null -`,{timeout:10000});return /silence_end/.test(stderr);}catch{return true;}}
  async _recordMic(o,d=3){const c=this._cap.sox?`sox -d -r 16000 -c 1 -b 16 "${o}" trim 0 ${d}`:`ffmpeg -f ${process.platform==='win32'?'dshow -i audio="Microphone"':process.platform==='darwin'?'avfoundation -i ":0"':'pulse -i default'} -t ${d} -ar 16000 -ac 1 -y "${o}"`;return execAsync(c,{timeout:(d+5)*1000});}
  async _chunked(ap,opts){if(!this._cap.ffmpeg)throw new Error('ffmpeg für Chunking benötigt');const info=await this.getAudioInfo(ap);const dur=info.duration||600,n=Math.ceil(dur/CHUNK_DURATION_S),all=[];for(let i=0;i<n;i++){const s=i*CHUNK_DURATION_S,cp=path.join(this.audioDir,`ch_${Date.now()}_${i}.wav`);await execAsync(`ffmpeg -i "${ap}" -ss ${s} -t ${CHUNK_DURATION_S} -ar 16000 -ac 1 -y "${cp}"`,{timeout:60000});const r=await this.transcribe(cp,{...opts,denoise:false});all.push(r);await fs.unlink(cp).catch(()=>{});this.emit('transcription.chunk',{chunk:i+1,total:n,text:r.text});}return{text:all.map(r=>r.text).join(' '),language:all[0]?.language||opts.language,segments:all.flatMap((r,ci)=>(r.segments||[]).map(s=>({...s,start:(s.start||0)+ci*CHUNK_DURATION_S,end:(s.end||0)+ci*CHUNK_DURATION_S}))),chunks:all.length,duration:dur,provider:all[0]?.provider};}
  _diarize(segs){const o=[];let s=0,le=0;for(const g of segs){if((g.start||0)-le>2&&le>0)s=(s+1)%2;o.push({speaker:`Sprecher_${s+1}`,text:g.text,start:g.start,end:g.end});le=g.end||le;}return o;}

  /* ═══ Utils ══════════════════════════════════════════════════════ */
  async convertAudio(i,f='mp3',sr=null){if(!this._cap.ffmpeg)throw new Error('ffmpeg fehlt');const o=i.replace(/\.[^.]+$/,`.${f}`);await execAsync(`ffmpeg -i "${i}" ${sr?`-ar ${sr}`:''} -y "${o}"`,{timeout:60000});return o;}
  async getAudioInfo(p){if(!this._cap.ffmpeg)return{size:(await fs.stat(p)).size,path:p};try{const{stdout}=await execAsync(`ffprobe -v quiet -print_format json -show_format -show_streams "${p}"`,{timeout:10000});const i=JSON.parse(stdout);return{duration:parseFloat(i.format?.duration)||0,size:parseInt(i.format?.size)||0,format:i.format?.format_name||'?',bitrate:parseInt(i.format?.bit_rate)||0,sampleRate:parseInt(i.streams?.[0]?.sample_rate)||0,channels:i.streams?.[0]?.channels||0};}catch{return{path:p};}}
  async cleanup(max=3600000){try{const files=await fs.readdir(this.audioDir);const co=Date.now()-max;let c=0;for(const f of files){const fp=path.join(this.audioDir,f);if((await fs.stat(fp)).mtimeMs<co){await fs.unlink(fp).catch(()=>{});c++;}}return{cleaned:c,remaining:files.length-c};}catch{return{cleaned:0};}}
  setVoice(v){this.selectedVoice=v;}
  getCapabilities(){return{...this._cap,ttsProvider:this.ttsProvider,sttProvider:this.sttProvider,selectedVoice:this.selectedVoice,voices:this.voices,isListening:this._listening};}
  getProviderInfo(){return{stt:{active:this.sttProvider,available:['openai','faster_whisper','whisper_cpp','whisper_local'].filter(p=>this._cap[p==='openai'?'openaiSTT':p])},tts:{active:this.ttsProvider,available:['openai','elevenlabs','coqui','edge','system'].filter(p=>this._cap[{openai:'openaiTTS',elevenlabs:'elevenlabsTTS',system:'systemTTS'}[p]||p])}};}
  async _has(c){try{await execAsync(`${process.platform==='win32'?'where':'which'} ${c}`);return true;}catch{return false;}}
  async _hasWCpp(){try{await execAsync('whisper-cpp --help');return true;}catch{return false;}}
  async _findWCppModel(){for(const p of[path.join(os.homedir(),'.whisper','ggml-medium.bin'),path.join(os.homedir(),'.whisper','ggml-base.bin'),'/usr/local/share/whisper/ggml-base.bin','./models/ggml-base.bin']){try{await fs.access(p);return p;}catch{}}throw new Error('Kein whisper.cpp Modell');}
}

module.exports = SpeechService;
