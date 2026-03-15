/**
 * Johnny Logger — rotierender File-Logger
 *
 * Schreibt strukturierte Logs in ~/.johnny/logs/johnny-YYYY-MM-DD.log
 * Hält maximal 7 Tage an Log-Dateien (auto-rotate).
 * Gibt gleichzeitig auf console aus (mit Farbe).
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const LOG_DIR       = path.join(os.homedir(), '.johnny', 'logs');
const MAX_LOG_DAYS  = 7;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB pro Datei

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[90m',   // grau
  info:  '\x1b[36m',   // cyan
  warn:  '\x1b[33m',   // gelb
  error: '\x1b[31m',   // rot
  reset: '\x1b[0m',
};

class Logger {
  constructor() {
    this._level       = 'info';  // Minimum-Level für Datei
    this._consoleLevel = 'info'; // Minimum-Level für Console
    this._stream      = null;
    this._currentDate = null;
    this._initialized = false;
    this._queue       = [];      // Puffer vor Initialisierung
  }

  initialize(options = {}) {
    this._level        = options.level        || 'info';
    this._consoleLevel = options.consoleLevel || 'info';

    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      this._openStream();
      this._cleanOldLogs();
      this._initialized = true;

      // Puffer leeren
      for (const entry of this._queue) this._write(entry);
      this._queue = [];

      this.info('Logger', `Gestartet — Level: ${this._level} | Log: ${this._currentFile}`);
    } catch (e) {
      console.error('[Logger] Konnte Log-Verzeichnis nicht erstellen:', e.message);
    }
  }

  _dateString() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }

  _openStream() {
    const date     = this._dateString();
    const filename = `johnny-${date}.log`;
    this._currentFile = path.join(LOG_DIR, filename);
    this._currentDate = date;

    this._stream = fs.createWriteStream(this._currentFile, { flags: 'a', encoding: 'utf8' });
    this._stream.on('error', (e) => console.error('[Logger] Stream-Fehler:', e.message));
  }

  _rotateIfNeeded() {
    const today = this._dateString();
    if (today !== this._currentDate) {
      if (this._stream) { this._stream.end(); this._stream = null; }
      this._openStream();
      return;
    }
    // Größen-Rotation
    try {
      const stat = fs.statSync(this._currentFile);
      if (stat.size > MAX_FILE_SIZE) {
        if (this._stream) { this._stream.end(); this._stream = null; }
        const ts   = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
        const name = `johnny-${today}-${ts}.log`;
        this._currentFile = path.join(LOG_DIR, name);
        this._stream = fs.createWriteStream(this._currentFile, { flags: 'a', encoding: 'utf8' });
      }
    } catch (_) {}
  }

  _cleanOldLogs() {
    try {
      const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('johnny-') && f.endsWith('.log'))
        .map(f => ({ name: f, full: path.join(LOG_DIR, f), mtime: fs.statSync(path.join(LOG_DIR, f)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);

      const cutoff = Date.now() - MAX_LOG_DAYS * 24 * 3600 * 1000;
      for (const file of files) {
        if (file.mtime.getTime() < cutoff) {
          fs.unlinkSync(file.full);
        }
      }
    } catch (_) {}
  }

  _write({ level, module: mod, message, data, ts }) {
    // Console-Ausgabe
    if (LEVELS[level] >= LEVELS[this._consoleLevel]) {
      const color  = COLORS[level] || '';
      const reset  = COLORS.reset;
      const prefix = `${color}[${level.toUpperCase()}]${reset}`;
      const modStr = mod ? `\x1b[35m[${mod}]\x1b[0m ` : '';
      const dataStr = data ? ' ' + JSON.stringify(data) : '';
      console.log(`${prefix} ${modStr}${message}${dataStr}`);
    }

    // Datei-Ausgabe
    if (this._stream && LEVELS[level] >= LEVELS[this._level]) {
      this._rotateIfNeeded();
      const line = JSON.stringify({ ts, level, module: mod, message, data }) + '\n';
      try { this._stream.write(line); } catch (_) {}
    }
  }

  _log(level, mod, message, data) {
    const entry = { level, module: mod, message, data, ts: new Date().toISOString() };
    if (!this._initialized) {
      this._queue.push(entry);
    } else {
      this._write(entry);
    }
  }

  debug(mod, message, data) { this._log('debug', mod, message, data); }
  info(mod, message, data)  { this._log('info',  mod, message, data); }
  warn(mod, message, data)  { this._log('warn',  mod, message, data); }
  error(mod, message, data) { this._log('error', mod, message, data); }

  /** Gibt Pfad zum aktuellen Log-File zurück */
  getCurrentLogFile() { return this._currentFile || null; }

  /** Gibt die letzten N Zeilen zurück */
  getRecentLines(n = 100) {
    if (!this._currentFile) return [];
    try {
      const content = fs.readFileSync(this._currentFile, 'utf8');
      return content.trim().split('\n').slice(-n).map(line => {
        try { return JSON.parse(line); } catch { return { raw: line }; }
      });
    } catch { return []; }
  }

  /** Gibt alle Log-Dateien zurück */
  getLogFiles() {
    try {
      return fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('johnny-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(LOG_DIR, f),
          size: fs.statSync(path.join(LOG_DIR, f)).size,
          date: f.replace('johnny-', '').replace('.log', ''),
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch { return []; }
  }
}

// Singleton
const logger = new Logger();
module.exports = logger;
