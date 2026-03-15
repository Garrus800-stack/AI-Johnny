/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SENSOR SERVICE v1.0 — Außenwelt-Interaktion                       ║
 * ║                                                                      ║
 * ║  Hardware- und Umgebungssensoren für Johnny:                        ║
 * ║  - System-Sensoren: CPU, RAM, GPU, Disk, Temperatur, Akku         ║
 * ║  - Netzwerk-Monitoring: Ping, Port-Scan, Bandbreite, WLAN-Scan    ║
 * ║  - Serial/USB: Arduino, ESP32, Zigbee-Adapter lesen/schreiben     ║
 * ║  - Webcam: Snapshot, Bewegungserkennung                            ║
 * ║  - Umgebung: Wetter-API, Standort, Tageszeit-Awareness            ║
 * ║  - Dateisystem-Watcher: Ordner überwachen auf Änderungen          ║
 * ║  - Prozess-Monitor: Laufende Apps, Ressourcenverbrauch             ║
 * ║  - Clipboard-Monitoring                                             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const { EventEmitter } = require('events');
const { exec }         = require('child_process');
const { promisify }    = require('util');
const fs               = require('fs').promises;
const path             = require('path');
const os               = require('os');

const execAsync = promisify(exec);

class SensorService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.serialPorts   = new Map();    // name → { port, baudRate, buffer }
    this.watchers      = new Map();    // path → FSWatcher
    this.monitors      = new Map();    // name → intervalId
    this.weatherApiKey = config.weatherApiKey || process.env.OPENWEATHER_API_KEY;
    this.dataDir       = config.dataDir || path.join(os.tmpdir(), 'johnny-sensors');
    this._sysInfo      = null;         // Lazy-loaded systeminformation
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });

    // systeminformation lazy-loaden
    try {
      this._sysInfo = require('systeminformation');
      console.log('[Sensor] systeminformation verfügbar ✓');
    } catch {
      console.warn('[Sensor] systeminformation nicht installiert — npm install systeminformation');
    }

    console.log('[Sensor] SensorService initialized');
    return this.getCapabilities();
  }

  // ════════════════════════════════════════════════════════════════════
  // 1. SYSTEM-SENSOREN
  // ════════════════════════════════════════════════════════════════════

  /** Vollständiger System-Snapshot */
  async getSystemSnapshot() {
    if (!this._sysInfo) return this._getSystemFallback();

    const [cpu, mem, disk, temp, battery, osInfo, load, processes] = await Promise.allSettled([
      this._sysInfo.cpu(),
      this._sysInfo.mem(),
      this._sysInfo.fsSize(),
      this._sysInfo.cpuTemperature(),
      this._sysInfo.battery(),
      this._sysInfo.osInfo(),
      this._sysInfo.currentLoad(),
      this._sysInfo.processes(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      cpu: {
        model:       cpu.value?.brand || 'unbekannt',
        cores:       cpu.value?.physicalCores || os.cpus().length,
        threads:     cpu.value?.cores || os.cpus().length,
        speed:       cpu.value?.speed || 0,
        load:        load.value?.currentLoad ? Math.round(load.value.currentLoad) : null,
        temperature: temp.value?.main || null,
      },
      memory: {
        total:     mem.value?.total ? Math.round(mem.value.total / 1073741824 * 10) / 10 : null,
        used:      mem.value?.used  ? Math.round(mem.value.used  / 1073741824 * 10) / 10 : null,
        free:      mem.value?.free  ? Math.round(mem.value.free  / 1073741824 * 10) / 10 : null,
        usedPct:   mem.value?.total ? Math.round(mem.value.used / mem.value.total * 100) : null,
      },
      disk: (disk.value || []).map(d => ({
        mount: d.mount, size: Math.round(d.size / 1073741824), used: Math.round(d.used / 1073741824), usedPct: Math.round(d.use),
      })),
      battery: battery.value?.hasBattery ? {
        percent: battery.value.percent, charging: battery.value.isCharging, timeRemaining: battery.value.timeRemaining,
      } : null,
      os: {
        platform: osInfo.value?.platform || os.platform(),
        distro:   osInfo.value?.distro   || '',
        release:  osInfo.value?.release   || os.release(),
        hostname: os.hostname(),
        uptime:   Math.round(os.uptime() / 3600 * 10) / 10 + ' Stunden',
      },
      topProcesses: (processes.value?.list || [])
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 10)
        .map(p => ({ name: p.name, cpu: Math.round(p.cpu * 10) / 10, mem: Math.round(p.mem * 10) / 10, pid: p.pid })),
    };
  }

  async _getSystemFallback() {
    const cpus = os.cpus();
    const mem  = os.totalmem();
    const free = os.freemem();
    return {
      timestamp: new Date().toISOString(),
      cpu: { model: cpus[0]?.model || '?', cores: cpus.length, load: null, temperature: null },
      memory: { total: Math.round(mem / 1073741824 * 10) / 10, free: Math.round(free / 1073741824 * 10) / 10, usedPct: Math.round((1 - free / mem) * 100) },
      os: { platform: os.platform(), hostname: os.hostname(), uptime: Math.round(os.uptime() / 3600) + 'h' },
    };
  }

  /** Nur CPU-Last + Temperatur (leichtgewichtig, für Dashboards) */
  async getCPUStatus() {
    if (this._sysInfo) {
      const [load, temp] = await Promise.all([this._sysInfo.currentLoad(), this._sysInfo.cpuTemperature()]);
      return { load: Math.round(load.currentLoad), temperature: temp.main, cores: load.cpus?.map(c => Math.round(c.load)) };
    }
    return { load: null, temperature: null, note: 'systeminformation nicht verfügbar' };
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. NETZWERK-SENSOREN
  // ════════════════════════════════════════════════════════════════════

  /** Ping-Test */
  async ping(host, count = 4) {
    const flag = process.platform === 'win32' ? '-n' : '-c';
    try {
      const { stdout } = await execAsync(`ping ${flag} ${count} ${host}`, { timeout: 15000 });

      // Durchschnittliche Latenz parsen
      const avgMatch = stdout.match(/(?:Average|avg)[^=]*=\s*(\d+(?:\.\d+)?)/i)
        || stdout.match(/(\d+(?:\.\d+)?)\s*ms/);
      const lossMatch = stdout.match(/(\d+(?:\.\d+)?)\s*%\s*(?:loss|verlust)/i);

      return {
        host, reachable: true,
        avgLatency: avgMatch ? parseFloat(avgMatch[1]) : null,
        packetLoss: lossMatch ? parseFloat(lossMatch[1]) : 0,
        raw: stdout.slice(0, 500),
      };
    } catch (e) {
      return { host, reachable: false, error: e.message };
    }
  }

  /** Einfacher Port-Check */
  async checkPort(host, port, timeout = 3000) {
    return new Promise((resolve) => {
      const net = require('net');
      const sock = new net.Socket();
      sock.setTimeout(timeout);
      sock.on('connect', () => { sock.destroy(); resolve({ host, port, open: true }); });
      sock.on('timeout', () => { sock.destroy(); resolve({ host, port, open: false, reason: 'timeout' }); });
      sock.on('error', (e) => { sock.destroy(); resolve({ host, port, open: false, reason: e.code }); });
      sock.connect(port, host);
    });
  }

  /** WLAN-Netzwerke scannen */
  async scanWifi() {
    try {
      let cmd;
      if (process.platform === 'win32') cmd = 'netsh wlan show networks mode=bssid';
      else if (process.platform === 'darwin') cmd = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -s';
      else cmd = 'nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list';

      const { stdout } = await execAsync(cmd, { timeout: 15000 });
      return { networks: this._parseWifiOutput(stdout, process.platform), raw: stdout.slice(0, 2000) };
    } catch (e) {
      return { error: e.message };
    }
  }

  _parseWifiOutput(output, platform) {
    const networks = [];
    if (platform === 'linux') {
      for (const line of output.trim().split('\n')) {
        const [ssid, signal, security] = line.split(':');
        if (ssid) networks.push({ ssid, signal: parseInt(signal) || 0, security: security || 'open' });
      }
    } else {
      // Einfaches Parsing für Win/Mac — SSID-Zeilen finden
      const ssidPattern = /SSID\s*[:\s]+(.+)/gi;
      let m;
      while ((m = ssidPattern.exec(output)) !== null) {
        if (m[1].trim()) networks.push({ ssid: m[1].trim() });
      }
    }
    return networks;
  }

  /** Netzwerk-Interfaces */
  async getNetworkInfo() {
    if (this._sysInfo) {
      const [ifaces, stats] = await Promise.all([this._sysInfo.networkInterfaces(), this._sysInfo.networkStats()]);
      return {
        interfaces: (ifaces || []).filter(i => !i.internal).map(i => ({ name: i.iface, ip4: i.ip4, ip6: i.ip6, mac: i.mac, speed: i.speed })),
        stats: (stats || []).map(s => ({ iface: s.iface, rxSec: s.rx_sec, txSec: s.tx_sec })),
      };
    }
    const ifaces = os.networkInterfaces();
    return { interfaces: Object.entries(ifaces).flatMap(([name, addrs]) => addrs.filter(a => !a.internal).map(a => ({ name, address: a.address, family: a.family }))) };
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. SERIAL / USB — Arduino, ESP32, Sensoren
  // ════════════════════════════════════════════════════════════════════

  /** Verfügbare Serial-Ports auflisten */
  async listSerialPorts() {
    try {
      const { SerialPort } = require('serialport');
      const ports = await SerialPort.list();
      return ports.map(p => ({
        path: p.path, manufacturer: p.manufacturer || '?',
        vendorId: p.vendorId, productId: p.productId,
        serialNumber: p.serialNumber,
      }));
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        return { error: 'serialport nicht installiert. npm install serialport' };
      }
      return { error: e.message };
    }
  }

  /** Serial-Port öffnen und Daten lesen */
  async openSerial(portPath, opts = {}) {
    const { baudRate = 9600, delimiter = '\n' } = opts;

    try {
      const { SerialPort } = require('serialport');
      const { ReadlineParser } = require('@serialport/parser-readline');

      const port = new SerialPort({ path: portPath, baudRate });
      const parser = port.pipe(new ReadlineParser({ delimiter }));

      const buffer = [];
      parser.on('data', (line) => {
        buffer.push({ data: line, timestamp: Date.now() });
        if (buffer.length > 1000) buffer.shift();
        this.emit('serial.data', { port: portPath, data: line });
      });

      port.on('error', (err) => this.emit('serial.error', { port: portPath, error: err.message }));

      this.serialPorts.set(portPath, { port, parser, buffer, baudRate });
      return { success: true, port: portPath, baudRate };
    } catch (e) {
      return { error: e.message };
    }
  }

  /** Daten an Serial-Port senden */
  async writeSerial(portPath, data) {
    const entry = this.serialPorts.get(portPath);
    if (!entry) return { error: `Port ${portPath} nicht geöffnet` };

    return new Promise((resolve, reject) => {
      entry.port.write(data + '\n', (err) => {
        if (err) reject(err);
        else resolve({ success: true, sent: data });
      });
    });
  }

  /** Letzte N Einträge vom Serial-Port lesen */
  readSerialBuffer(portPath, count = 20) {
    const entry = this.serialPorts.get(portPath);
    if (!entry) return { error: `Port ${portPath} nicht geöffnet` };
    return { port: portPath, data: entry.buffer.slice(-count), total: entry.buffer.length };
  }

  /** Serial-Port schließen */
  async closeSerial(portPath) {
    const entry = this.serialPorts.get(portPath);
    if (!entry) return { error: `Port ${portPath} nicht geöffnet` };
    return new Promise((resolve) => {
      entry.port.close(() => {
        this.serialPorts.delete(portPath);
        resolve({ success: true, closed: portPath });
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. WEBCAM
  // ════════════════════════════════════════════════════════════════════

  /** Webcam-Snapshot aufnehmen (ffmpeg) */
  async captureWebcam(opts = {}) {
    const { device = null, width = 1280, height = 720 } = opts;
    const outPath = path.join(this.dataDir, `webcam_${Date.now()}.jpg`);

    let cmd;
    if (process.platform === 'win32') {
      const dev = device || 'video=Integrated Camera';
      cmd = `ffmpeg -f dshow -i "${dev}" -frames:v 1 -s ${width}x${height} -y "${outPath}"`;
    } else if (process.platform === 'darwin') {
      cmd = `ffmpeg -f avfoundation -framerate 30 -i "${device || '0'}" -frames:v 1 -s ${width}x${height} -y "${outPath}"`;
    } else {
      cmd = `ffmpeg -f v4l2 -i ${device || '/dev/video0'} -frames:v 1 -s ${width}x${height} -y "${outPath}"`;
    }

    try {
      await execAsync(cmd, { timeout: 10000 });
      return { success: true, path: outPath };
    } catch (e) {
      return { error: `Webcam-Fehler: ${e.message}` };
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. UMGEBUNGS-SENSOREN
  // ════════════════════════════════════════════════════════════════════

  /** Wetter von OpenWeatherMap */
  async getWeather(city = 'Berlin', units = 'metric') {
    if (!this.weatherApiKey) return { error: 'OPENWEATHER_API_KEY nicht gesetzt' };

    try {
      const axios = require('axios');
      const resp = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
        params: { q: city, appid: this.weatherApiKey, units, lang: 'de' },
        timeout: 10000,
      });
      const d = resp.data;
      return {
        city: d.name, country: d.sys?.country,
        temp: d.main?.temp, feelsLike: d.main?.feels_like,
        humidity: d.main?.humidity, pressure: d.main?.pressure,
        wind: { speed: d.wind?.speed, direction: d.wind?.deg },
        description: d.weather?.[0]?.description,
        icon: d.weather?.[0]?.icon,
        sunrise: d.sys?.sunrise ? new Date(d.sys.sunrise * 1000).toLocaleTimeString('de') : null,
        sunset:  d.sys?.sunset  ? new Date(d.sys.sunset * 1000).toLocaleTimeString('de')  : null,
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  /** Tageszeit-Awareness */
  getTimeAwareness() {
    const now  = new Date();
    const hour = now.getHours();
    let phase;
    if (hour >= 5 && hour < 9)        phase = 'früher Morgen';
    else if (hour >= 9 && hour < 12)   phase = 'Vormittag';
    else if (hour >= 12 && hour < 14)  phase = 'Mittag';
    else if (hour >= 14 && hour < 17)  phase = 'Nachmittag';
    else if (hour >= 17 && hour < 21)  phase = 'Abend';
    else if (hour >= 21 || hour < 1)   phase = 'später Abend';
    else                               phase = 'Nacht';

    return {
      time: now.toLocaleTimeString('de'),
      date: now.toLocaleDateString('de'),
      day:  now.toLocaleDateString('de', { weekday: 'long' }),
      phase,
      hour,
      isWeekend: [0, 6].includes(now.getDay()),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // 6. DATEISYSTEM-WATCHER
  // ════════════════════════════════════════════════════════════════════

  /** Ordner überwachen */
  async watchDirectory(dirPath, opts = {}) {
    const { recursive = true, filter = null } = opts;

    if (this.watchers.has(dirPath)) return { error: 'Bereits überwacht' };

    try {
      const chokidar = require('chokidar');
      const watcher = chokidar.watch(dirPath, {
        persistent: true, ignoreInitial: true,
        depth: recursive ? 5 : 0,
      });

      watcher.on('add',    p => this._fsEvent('add', p, dirPath, filter));
      watcher.on('change', p => this._fsEvent('change', p, dirPath, filter));
      watcher.on('unlink', p => this._fsEvent('delete', p, dirPath, filter));

      this.watchers.set(dirPath, watcher);
      return { success: true, watching: dirPath, recursive };
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') return { error: 'chokidar nicht installiert' };
      return { error: e.message };
    }
  }

  _fsEvent(type, filePath, watchDir, filter) {
    if (filter && !filePath.match(new RegExp(filter))) return;
    this.emit('fs.change', { type, path: filePath, watchDir, timestamp: Date.now() });
  }

  async unwatchDirectory(dirPath) {
    const w = this.watchers.get(dirPath);
    if (!w) return { error: 'Nicht überwacht' };
    await w.close();
    this.watchers.delete(dirPath);
    return { success: true, unwatched: dirPath };
  }

  // ════════════════════════════════════════════════════════════════════
  // 7. PROZESS-MONITOR
  // ════════════════════════════════════════════════════════════════════

  /** Top-Prozesse nach CPU/RAM */
  async getTopProcesses(sortBy = 'cpu', count = 10) {
    if (this._sysInfo) {
      const procs = await this._sysInfo.processes();
      return (procs.list || [])
        .sort((a, b) => b[sortBy] - a[sortBy])
        .slice(0, count)
        .map(p => ({ name: p.name, pid: p.pid, cpu: Math.round(p.cpu * 10) / 10, mem: Math.round(p.mem * 10) / 10 }));
    }

    // Fallback: ps/tasklist
    try {
      const cmd = process.platform === 'win32'
        ? 'tasklist /FO CSV /NH'
        : 'ps aux --sort=-%cpu | head -15';
      const { stdout } = await execAsync(cmd, { timeout: 10000 });
      return { raw: stdout.slice(0, 2000) };
    } catch (e) { return { error: e.message }; }
  }

  /** Prüfe ob ein bestimmter Prozess läuft */
  async isProcessRunning(name) {
    try {
      const cmd = process.platform === 'win32'
        ? `tasklist /FI "IMAGENAME eq ${name}" /NH`
        : `pgrep -x "${name}"`;
      const { stdout } = await execAsync(cmd, { timeout: 5000 });
      return { name, running: stdout.includes(name) || stdout.trim().length > 0 };
    } catch {
      return { name, running: false };
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 8. MONITORING (Kontinuierlich)
  // ════════════════════════════════════════════════════════════════════

  /** Starte periodisches System-Monitoring */
  startMonitor(name, intervalMs = 5000, callback) {
    if (this.monitors.has(name)) return { error: 'Monitor existiert bereits' };

    const id = setInterval(async () => {
      try {
        let data;
        switch (name) {
          case 'cpu':     data = await this.getCPUStatus(); break;
          case 'system':  data = await this.getSystemSnapshot(); break;
          case 'network': data = await this.getNetworkInfo(); break;
          case 'process': data = await this.getTopProcesses(); break;
          default:        data = await this.getSystemSnapshot();
        }
        this.emit(`monitor.${name}`, data);
        if (callback) callback(data);
      } catch (e) {
        this.emit('monitor.error', { name, error: e.message });
      }
    }, intervalMs);

    this.monitors.set(name, id);
    return { success: true, monitor: name, intervalMs };
  }

  stopMonitor(name) {
    const id = this.monitors.get(name);
    if (!id) return { error: 'Monitor nicht gefunden' };
    clearInterval(id);
    this.monitors.delete(name);
    return { success: true, stopped: name };
  }

  // ════════════════════════════════════════════════════════════════════
  // CLEANUP & STATUS
  // ════════════════════════════════════════════════════════════════════

  async cleanup() {
    // Serial-Ports schließen
    for (const [port] of this.serialPorts) await this.closeSerial(port);
    // Watchers stoppen
    for (const [dir] of this.watchers) await this.unwatchDirectory(dir);
    // Monitors stoppen
    for (const [name] of this.monitors) this.stopMonitor(name);
  }

  getCapabilities() {
    return {
      systemInfo:  !!this._sysInfo,
      serial:      (() => { try { require('serialport'); return true; } catch { return false; } })(),
      chokidar:    (() => { try { require('chokidar'); return true; } catch { return false; } })(),
      weather:     !!this.weatherApiKey,
      activeSerialPorts: [...this.serialPorts.keys()],
      activeWatchers:    [...this.watchers.keys()],
      activeMonitors:    [...this.monitors.keys()],
    };
  }
}

module.exports = SensorService;
