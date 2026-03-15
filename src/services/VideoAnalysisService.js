const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * VideoAnalysisService
 * - Frame extraction via FFmpeg
 * - Frame analysis via VisionService (OpenAI / Anthropic / Gemini)
 * - Audio transcription via Whisper
 * - Summary via LLM
 */
class VideoAnalysisService {
  constructor(config) {
    this.visionService = config.visionService;
    this.modelProvider = config.modelProvider;
    this.apiKeys = config.apiKeys || {};
    this.tempDir = config.tempDir || '/tmp/johnny-video';
  }

  async initialize() {
    await fs.mkdir(this.tempDir, { recursive: true });
    this.ffmpegBin       = await this._findFFmpeg();
    this.ffmpegAvailable = !!this.ffmpegBin;
    if (this.ffmpegAvailable) {
      console.log(`VideoAnalysisService: FFmpeg gefunden ✓ (${this.ffmpegBin})`);
    } else {
      console.warn('VideoAnalysisService: FFmpeg nicht gefunden. Installation: winget install ffmpeg');
    }
  }

  async _findFFmpeg() {
    // 1) Im PATH suchen — plattformübergreifend
    const whichCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    try {
      const { stdout } = await execAsync(whichCmd, { timeout: 3000 });
      const found = stdout.trim().split('\n')[0].trim();
      if (found) { await execAsync(`"${found}" -version`, { timeout: 3000 }); return found; }
    } catch {}
    // Fallback: direkt aufrufen
    try {
      await execAsync('ffmpeg -version', { timeout: 3000 });
      return 'ffmpeg';
    } catch {}

    // 2) Plattformspezifische Installationspfade
    const candidates = process.platform === 'win32' ? [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      `${process.env.USERPROFILE}\\scoop\\apps\\ffmpeg\\current\\bin\\ffmpeg.exe`,
      `${process.env.LOCALAPPDATA}\\Programs\\ffmpeg\\bin\\ffmpeg.exe`,
      `${process.env.USERPROFILE}\\.local\\bin\\ffmpeg.exe`,
    ] : process.platform === 'darwin' ? [
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/usr/bin/ffmpeg',
    ] : [
      '/usr/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/snap/bin/ffmpeg',
      '/home/linuxbrew/.linuxbrew/bin/ffmpeg',
    ];

    for (const bin of candidates) {
      try {
        const fs2 = require('fs');
        if (!fs2.existsSync(bin)) continue;
        await execAsync(`"${bin}" -version`, { timeout: 3000 });
        return bin;
      } catch {}
    }
    return null;
  }

  _ff(args) {
    const bin = this.ffmpegBin && this.ffmpegBin !== 'ffmpeg'
      ? `"${this.ffmpegBin}"`
      : 'ffmpeg';
    return `${bin} ${args}`;
  }

  async analyze(videoPath, options = {}) {
    const { maxFrames = 8, includeAudio = true, provider = 'openai', prompt = 'Describe what is happening in this video.' } = options;
    const results = { videoPath, frames: [], audioTranscript: null, analysis: null, summary: null };

    if (this.ffmpegAvailable) {
      // Extract frames
      results.frames = await this.extractFrames(videoPath, maxFrames);
      // Analyze each frame
      if (results.frames.length > 0 && this.visionService) {
        const frameAnalyses = await Promise.all(
          results.frames.map(fp => this.visionService.analyzeImage(fp, 'Describe this video frame.', { provider }))
        );
        results.frameDescriptions = frameAnalyses.map(a => a.analysis || a.description || a.content || '');
      }
      // Extract audio for transcription
      if (includeAudio) {
        try {
          results.audioTranscript = await this.extractAndTranscribeAudio(videoPath);
        } catch (e) {
          console.warn('Audio transcription failed:', e.message);
        }
      }
    }

    // Build final summary via LLM
    results.summary = await this.buildSummary(results, prompt);
    return results;
  }

  async extractFrames(videoPath, maxFrames = 8) {
    const frameDir = path.join(this.tempDir, `frames_${Date.now()}`);
    await fs.mkdir(frameDir, { recursive: true });
    const fps = `fps=1/${Math.ceil(10 / maxFrames)}`;
    // Windows-Pfade mit Leerzeichen: Nutze einfache Anführungszeichen innen
    const isWin = process.platform === 'win32';
    const q = isWin ? '"' : "'";  
    const vpEsc = videoPath.replace(/"/g, '').replace(/'/g, '');
    const fdEsc = frameDir.replace(/"/g, '').replace(/'/g, '');
    const cmd = this._ff(isWin
      ? `-i "${vpEsc}" -vf "${fps}" -frames:v ${maxFrames} "${fdEsc}\\frame_%03d.jpg" -y`
      : `-i '${vpEsc}' -vf '${fps}' -frames:v ${maxFrames} '${fdEsc}/frame_%03d.jpg' -y`);
    await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    const files = await fs.readdir(frameDir);
    return files.filter(f => f.endsWith('.jpg')).sort().map(f => path.join(frameDir, f));
  }

  async extractAndTranscribeAudio(videoPath) {
    const audioPath = path.join(this.tempDir, `audio_${Date.now()}.wav`);
    const vpEsc2 = videoPath.replace(/"/g,'').replace(/'/g,'');
    const apEsc2 = audioPath.replace(/"/g,'').replace(/'/g,'');
    const isWin2 = process.platform === 'win32';
    const audioCmd = this._ff(isWin2
      ? `-i "${vpEsc2}" -vn -acodec pcm_s16le -ar 16000 "${apEsc2}" -y`
      : `-i '${vpEsc2}' -vn -acodec pcm_s16le -ar 16000 '${apEsc2}' -y`);
    await execAsync(audioCmd, { maxBuffer: 10 * 1024 * 1024 });
    // Try Whisper if available
    try {
      const { stdout } = await execAsync(
        `python -c "import whisper; m=whisper.load_model('base'); r=m.transcribe('${audioPath}'); print(r['text'])"`,
        { timeout: 60000 }
      );
      await fs.unlink(audioPath).catch(() => {});
      return stdout.trim();
    } catch {
      await fs.unlink(audioPath).catch(() => {});
      return null;
    }
  }

  async buildSummary(results, userPrompt) {
    if (!this.modelProvider) return 'Analysis complete (no LLM available for summary).';
    const context = [
      results.frameDescriptions?.length ? `Video frames (${results.frameDescriptions.length} analyzed):\n${results.frameDescriptions.map((d,i)=>`Frame ${i+1}: ${d}`).join('\n')}` : '',
      results.audioTranscript ? `Audio transcript:\n${results.audioTranscript}` : ''
    ].filter(Boolean).join('\n\n');
    const messages = [
      { role: 'system', content: 'You are a video analysis assistant. Analyze the provided video data and answer the user\'s question.' },
      { role: 'user', content: `${context}\n\nUser question: ${userPrompt}` }
    ];
    try {
      const res = await this.modelProvider.generate({ provider: this.modelProvider.defaultProvider, model: undefined, messages });
      return res.content;
    } catch (e) {
      return `Summary unavailable: ${e.message}`;
    }
  }

  isAvailable() { return this.ffmpegAvailable; }
}

module.exports = VideoAnalysisService;
