/**
 * HardwareBridgeService — Johnnys Brücke zur physischen Hardware
 *
 * Löst das "Electron-Gefängnis"-Problem: Johnny ist nicht nur
 * child_process.exec, sondern hat direkten Zugriff auf:
 *   - GPU-Info (nvidia-smi, CUDA, VRAM)
 *   - Serial/USB-Geräte (Arduino, ESP32) — direkt flashen
 *   - Prozesse (starten, stoppen, überwachen)
 *   - Systemdienste (start/stop/status)
 *   - Netzwerk-Hardware (Interfaces, WiFi, Bluetooth)
 */
'use strict';

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

class HardwareBridgeService {
  constructor(config = {}) {
    this.dataDir = config.dataDir || './data/hardware';
    this._gpuInfo = null;
    this._serialPorts = [];
    this._processes = new Map();
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    // GPU-Info beim Start cachen
    this._gpuInfo = await this.getGPUInfo();
    console.log('[HardwareBridge] Initialized — GPU:', this._gpuInfo?.name || 'none');
  }

  // ══════════════════════════════════════════════════════════════════
  //  GPU — NVIDIA, AMD, Intel
  // ══════════════════════════════════════════════════════════════════

  async getGPUInfo() {
    const info = { available: false, type: 'none', name: null, vram: null, driver: null, cuda: null, utilization: null };

    // NVIDIA (nvidia-smi)
    try {
      const { stdout } = await execAsync('nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,driver_version --format=csv,noheader,nounits', { timeout: 5000 });
      const parts = stdout.trim().split(',').map(s => s.trim());
      if (parts.length >= 6) {
        info.available = true;
        info.type = 'nvidia';
        info.name = parts[0];
        info.vram = { total: parseInt(parts[1]), used: parseInt(parts[2]), free: parseInt(parts[3]), unit: 'MiB' };
        info.utilization = parseInt(parts[4]);
        info.driver = parts[5];
      }
    } catch {}

    // CUDA-Version
    if (info.type === 'nvidia') {
      try {
        const { stdout } = await execAsync('nvcc --version 2>/dev/null || nvidia-smi | grep "CUDA Version"', { timeout: 3000 });
        const cudaMatch = stdout.match(/CUDA[^\d]*(\d+\.\d+)/i);
        if (cudaMatch) info.cuda = cudaMatch[1];
      } catch {}
    }

    // AMD (rocm-smi) — Fallback
    if (!info.available) {
      try {
        const { stdout } = await execAsync('rocm-smi --showproductname --showmeminfo vram --json 2>/dev/null', { timeout: 5000 });
        const data = JSON.parse(stdout);
        if (data) { info.available = true; info.type = 'amd'; info.name = 'AMD GPU (ROCm)'; }
      } catch {}
    }

    // Intel (Level Zero) — Fallback
    if (!info.available && process.platform === 'linux') {
      try {
        const { stdout } = await execAsync('intel_gpu_top -l 1 -J 2>/dev/null', { timeout: 3000 });
        if (stdout.includes('engines')) { info.available = true; info.type = 'intel'; info.name = 'Intel GPU'; }
      } catch {}
    }

    this._gpuInfo = info;
    return info;
  }

  /** Läuft Ollama auf GPU? */
  async getOllamaGPUStatus() {
    try {
      const { stdout } = await execAsync('nvidia-smi --query-compute-apps=pid,name,used_gpu_memory --format=csv,noheader', { timeout: 3000 });
      const ollamaProcs = stdout.split('\n').filter(l => l.toLowerCase().includes('ollama'));
      return {
        onGPU: ollamaProcs.length > 0,
        processes: ollamaProcs.map(l => {
          const p = l.split(',').map(s => s.trim());
          return { pid: p[0], name: p[1], vram: p[2] };
        }),
        gpu: this._gpuInfo,
      };
    } catch {
      return { onGPU: false, processes: [], gpu: this._gpuInfo };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  SERIAL / USB — Arduino, ESP32, Mikrocontroller
  // ══════════════════════════════════════════════════════════════════

  /** Alle seriellen Ports auflisten. */
  async listSerialPorts() {
    try {
      const SerialPort = require('serialport');
      this._serialPorts = await SerialPort.list();
      return this._serialPorts.map(p => ({
        path: p.path, manufacturer: p.manufacturer, serialNumber: p.serialNumber,
        vendorId: p.vendorId, productId: p.productId, pnpId: p.pnpId,
      }));
    } catch {
      // Fallback ohne serialport-Modul
      if (process.platform === 'linux') {
        try {
          const { stdout } = await execAsync('ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null');
          return stdout.trim().split('\n').filter(Boolean).map(p => ({ path: p }));
        } catch { return []; }
      }
      if (process.platform === 'win32') {
        try {
          const { stdout } = await execAsync('mode', { timeout: 3000 });
          const ports = stdout.match(/COM\d+/g) || [];
          return ports.map(p => ({ path: p }));
        } catch { return []; }
      }
      return [];
    }
  }

  /** Arduino/ESP32 Sketch flashen via arduino-cli oder esptool. */
  async flashMicrocontroller(options) {
    const { port, firmware, board, tool } = options;
    if (!port || !firmware) return { error: 'port und firmware sind Pflicht' };

    const flashTool = tool || 'arduino-cli';

    if (flashTool === 'arduino-cli') {
      try {
        const boardFqbn = board || 'arduino:avr:uno';
        const { stdout, stderr } = await execAsync(
          `arduino-cli upload -p ${port} --fqbn ${boardFqbn} --input-file "${firmware}"`,
          { timeout: 120000 }
        );
        return { success: true, output: stdout, warnings: stderr };
      } catch (e) {
        return { error: e.message };
      }
    }

    if (flashTool === 'esptool') {
      try {
        const { stdout, stderr } = await execAsync(
          `esptool.py --port ${port} --baud 460800 write_flash 0x0 "${firmware}"`,
          { timeout: 120000 }
        );
        return { success: true, output: stdout, warnings: stderr };
      } catch (e) {
        return { error: e.message };
      }
    }

    return { error: `Unbekanntes Flash-Tool: ${flashTool}` };
  }

  // ══════════════════════════════════════════════════════════════════
  //  PROZESSE — Starten, Überwachen, Stoppen
  // ══════════════════════════════════════════════════════════════════

  /** Lang-laufenden Prozess starten und überwachen. */
  startProcess(name, command, args = [], options = {}) {
    if (this._processes.has(name)) return { error: `Prozess "${name}" läuft bereits` };

    const proc = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const entry = { pid: proc.pid, name, command, startedAt: Date.now(), output: [], errors: [] };

    proc.stdout.on('data', (d) => { entry.output.push(d.toString()); if (entry.output.length > 200) entry.output.shift(); });
    proc.stderr.on('data', (d) => { entry.errors.push(d.toString()); if (entry.errors.length > 100) entry.errors.shift(); });
    proc.on('close', (code) => { entry.exitCode = code; entry.endedAt = Date.now(); });

    this._processes.set(name, { proc, entry });
    return { success: true, pid: proc.pid, name };
  }

  /** Prozess stoppen. */
  stopProcess(name) {
    const p = this._processes.get(name);
    if (!p) return { error: `Prozess "${name}" nicht gefunden` };
    p.proc.kill('SIGTERM');
    setTimeout(() => { try { p.proc.kill('SIGKILL'); } catch {} }, 5000);
    this._processes.delete(name);
    return { success: true, name };
  }

  /** Alle überwachten Prozesse. */
  listProcesses() {
    const result = [];
    for (const [name, p] of this._processes) {
      result.push({
        name, pid: p.entry.pid, command: p.entry.command,
        running: p.entry.exitCode == null,
        uptime: Date.now() - p.entry.startedAt,
        lastOutput: p.entry.output.slice(-5).join(''),
        lastError: p.entry.errors.slice(-3).join(''),
      });
    }
    return result;
  }

  // ══════════════════════════════════════════════════════════════════
  //  SYSTEMDIENSTE
  // ══════════════════════════════════════════════════════════════════

  async serviceStatus(serviceName) {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync(`sc query "${serviceName}"`, { timeout: 5000 });
        return { running: stdout.includes('RUNNING'), output: stdout.trim() };
      } catch (e) { return { running: false, error: e.message }; }
    }
    // Linux/Mac
    try {
      const { stdout } = await execAsync(`systemctl is-active ${serviceName} 2>/dev/null || service ${serviceName} status 2>/dev/null`, { timeout: 5000 });
      return { running: stdout.trim() === 'active' || stdout.includes('running'), output: stdout.trim() };
    } catch { return { running: false }; }
  }

  // ══════════════════════════════════════════════════════════════════
  //  STATUS
  // ══════════════════════════════════════════════════════════════════

  getStatus() {
    return {
      gpu: this._gpuInfo,
      serialPorts: this._serialPorts.length,
      managedProcesses: this._processes.size,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
    };
  }
}

module.exports = HardwareBridgeService;
