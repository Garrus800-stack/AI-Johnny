const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

/**
 * SandboxService – sichere Code-Ausführung
 *
 * Strategie (automatische Auswahl):
 *   1. Docker  – vollständige Isolation (empfohlen, wenn Docker verfügbar)
 *   2. Process – separate Node-Kindprozesse mit begrenzten Ressourcen (Fallback)
 *
 * Der Benutzer kann den Modus in den Settings erzwingen:
 *   sandboxMode: 'auto' | 'docker' | 'process' | 'none'
 */
class SandboxService {
  constructor(config = {}) {
    this.mode       = config.sandboxMode || 'auto'; // auto | docker | process | none
    this.tmpDir     = config.tmpDir || path.join(os.tmpdir(), 'johnny-sandbox');
    this.timeout    = config.timeout   || 30000;   // ms
    this.memLimit   = config.memLimit  || '256m';  // Docker memory limit
    this.cpuQuota   = config.cpuQuota  || '50000'; // Docker CPU quota (50%)

    this.dockerAvailable = false;
    this.resolvedMode    = 'process'; // set after probe
  }

  // ── Init: Docker-Verfügbarkeit prüfen ─────────────────────────────────────
  async initialize() {
    await fs.mkdir(this.tmpDir, { recursive: true });

    if (this.mode === 'none') {
      this.resolvedMode = 'none';
      console.log('[Sandbox] Mode: none (direct execution)');
      return;
    }

    try {
      await execAsync('docker info', { timeout: 5000 });
      this.dockerAvailable = true;
    } catch {
      this.dockerAvailable = false;
    }

    if (this.mode === 'docker' && !this.dockerAvailable) {
      console.warn('[Sandbox] Docker requested but not available – falling back to process');
      this.resolvedMode = 'process';
    } else if (this.mode === 'auto') {
      this.resolvedMode = this.dockerAvailable ? 'docker' : 'process';
    } else {
      this.resolvedMode = this.mode;
    }

    console.log(`[Sandbox] Mode: ${this.resolvedMode} (docker available: ${this.dockerAvailable})`);
  }

  // ── Haupt-API: Code ausführen ─────────────────────────────────────────────
  async runCode(language, code, options = {}) {
    const startedAt = Date.now();
    const timeout   = options.timeout || this.timeout;

    if (this.resolvedMode === 'docker') {
      return await this._runInDocker(language, code, timeout, startedAt);
    } else if (this.resolvedMode === 'process') {
      return await this._runInProcess(language, code, timeout, startedAt);
    } else {
      // none – direkt ausführen (kein Sandbox)
      return await this._runDirect(language, code, timeout, startedAt);
    }
  }

  // ── Docker-Ausführung ─────────────────────────────────────────────────────
  async _runInDocker(language, code, timeout, startedAt) {
    const { image, filename, cmd } = this._dockerConfig(language, code);
    if (!image) return { error: `Unsupported language: ${language}`, sandboxMode: 'docker' };

    const runId   = `johnny_${Date.now()}`;
    const hostDir = path.join(this.tmpDir, runId);
    await fs.mkdir(hostDir, { recursive: true });
    await fs.writeFile(path.join(hostDir, filename), code, 'utf-8');

    const dockerCmd = [
      'docker run --rm',
      `--name ${runId}`,
      `--memory=${this.memLimit}`,
      `--cpu-quota=${this.cpuQuota}`,
      '--network=none',           // kein Netzwerkzugriff
      '--read-only',              // Dateisystem read-only außer /tmp
      '--tmpfs /tmp:rw,size=64m', // eigenes /tmp
      `--volume "${hostDir}:/code:ro"`,
      `--workdir /code`,
      `--user nobody`,
      image,
      cmd
    ].join(' ');

    try {
      const { stdout, stderr } = await execAsync(dockerCmd, {
        timeout,
        maxBuffer: 1024 * 1024
      });
      return {
        output: stdout,
        errors: stderr,
        duration: Date.now() - startedAt,
        sandboxMode: 'docker',
        image,
        complete: true
      };
    } catch (e) {
      // Container ggf. aufräumen
      execAsync(`docker rm -f ${runId}`).catch(() => {});
      return {
        error: e.killed ? `Timeout after ${timeout}ms` : e.message,
        output: e.stdout || '',
        duration: Date.now() - startedAt,
        sandboxMode: 'docker',
        complete: true
      };
    } finally {
      fs.rm(hostDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  _dockerConfig(language, code) {
    const ts = Date.now();
    switch (language.toLowerCase()) {
      case 'python': case 'py':
        return { image: 'python:3.11-slim', filename: `run_${ts}.py`, cmd: `python run_${ts}.py` };
      case 'javascript': case 'js': case 'node':
        return { image: 'node:20-slim', filename: `run_${ts}.js`, cmd: `node run_${ts}.js` };
      case 'bash': case 'sh':
        return { image: 'alpine:3.19', filename: `run_${ts}.sh`, cmd: `sh run_${ts}.sh` };
      case 'ruby': case 'rb':
        return { image: 'ruby:3.2-slim', filename: `run_${ts}.rb`, cmd: `ruby run_${ts}.rb` };
      case 'php':
        return { image: 'php:8.2-cli', filename: `run_${ts}.php`, cmd: `php run_${ts}.php` };
      default:
        return { image: null };
    }
  }

  // ── Process-Sandbox (kein Docker) ─────────────────────────────────────────
  async _runInProcess(language, code, timeout, startedAt) {
    const ts       = Date.now();
    const tmpFile  = path.join(this.tmpDir, `run_${ts}`);
    let   cmd, args;

    switch (language.toLowerCase()) {
      case 'python': case 'py':
        await fs.writeFile(tmpFile + '.py', code);
        cmd = 'python'; args = [tmpFile + '.py'];
        break;
      case 'javascript': case 'js': case 'node':
        await fs.writeFile(tmpFile + '.js', code);
        cmd = 'node'; args = [tmpFile + '.js'];
        break;
      case 'bash': case 'sh':
        await fs.writeFile(tmpFile + '.sh', code);
        cmd = 'bash'; args = [tmpFile + '.sh'];
        break;
      case 'powershell': case 'ps1':
        await fs.writeFile(tmpFile + '.ps1', code);
        cmd = 'powershell'; args = ['-ExecutionPolicy', 'Bypass', '-File', tmpFile + '.ps1'];
        break;
      case 'cpp': case 'c++': {
        const src = tmpFile + '.cpp';
        const out = tmpFile + '.exe';
        await fs.writeFile(src, code);
        await execAsync(`g++ "${src}" -o "${out}"`, { timeout: 20000 });
        cmd = out; args = [];
        break;
      }
      default:
        return { error: `Unsupported language: ${language}`, sandboxMode: 'process' };
    }

    return new Promise((resolve) => {
      let stdout = '', stderr = '', killed = false;

      const child = spawn(cmd, args, {
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Ressourcenlimits wo möglich
        ...(os.platform() !== 'win32' ? { uid: process.getuid() } : {})
      });

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, timeout);

      child.stdout.on('data', d => { stdout += d.toString().slice(0, 50000); });
      child.stderr.on('data', d => { stderr += d.toString().slice(0, 10000); });

      child.on('close', (code) => {
        clearTimeout(timer);
        // Temp-Dateien aufräumen (kein Glob bei fs.rm – einzeln löschen)
        fs.readdir(this.tmpDir).then(files => {
          files.filter(f => f.startsWith('run_' + ts)).forEach(f =>
            fs.unlink(path.join(this.tmpDir, f)).catch(() => {})
          );
        }).catch(() => {});
        resolve({
          output: stdout,
          errors: stderr,
          exitCode: code,
          killed,
          error: killed ? `Timeout after ${timeout}ms` : undefined,
          duration: Date.now() - startedAt,
          sandboxMode: 'process',
          complete: true
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ error: err.message, sandboxMode: 'process', duration: Date.now() - startedAt, complete: true });
      });
    });
  }

  // ── Direkte Ausführung (kein Sandbox, Modus 'none') ───────────────────────
  async _runDirect(language, code, timeout, startedAt) {
    const tmpDir  = this.tmpDir;
    const ts      = Date.now();
    let   cmd, filename;

    switch (language.toLowerCase()) {
      case 'python': case 'py':
        filename = path.join(tmpDir, `run_${ts}.py`);
        await fs.writeFile(filename, code);
        cmd = `python "${filename}"`;
        break;
      case 'javascript': case 'js': case 'node':
        filename = path.join(tmpDir, `run_${ts}.js`);
        await fs.writeFile(filename, code);
        cmd = `node "${filename}"`;
        break;
      case 'bash': case 'sh':
        filename = path.join(tmpDir, `run_${ts}.sh`);
        await fs.writeFile(filename, code);
        cmd = `bash "${filename}"`;
        break;
      case 'powershell': case 'ps1':
        filename = path.join(tmpDir, `run_${ts}.ps1`);
        await fs.writeFile(filename, code);
        cmd = `powershell -ExecutionPolicy Bypass -File "${filename}"`;
        break;
      default:
        return { error: `Unsupported language: ${language}`, sandboxMode: 'none' };
    }

    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout, maxBuffer: 1024 * 1024 });
      return { output: stdout, errors: stderr, sandboxMode: 'none', duration: Date.now() - startedAt, complete: true };
    } catch (e) {
      return { error: e.message, output: e.stdout || '', sandboxMode: 'none', duration: Date.now() - startedAt, complete: true };
    } finally {
      if (filename) fs.unlink(filename).catch(() => {});
    }
  }

  // ── Hilfsmethoden ─────────────────────────────────────────────────────────
  getStatus() {
    return {
      mode: this.resolvedMode,
      configured: this.mode,
      dockerAvailable: this.dockerAvailable,
      memLimit: this.memLimit,
      cpuQuota: this.cpuQuota,
      timeout: this.timeout
    };
  }

  async setMode(mode) {
    this.mode = mode;
    await this.initialize();
    return this.getStatus();
  }
}

module.exports = SandboxService;
