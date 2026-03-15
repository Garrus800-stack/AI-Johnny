/**
 * AutoUpdater — Automatische Updates für Johnny
 *
 * Nutzt electron-updater. Benötigt:
 *   1. electron-updater als Dependency
 *   2. publish-Config in package.json (z.B. GitHub Releases)
 *   3. Code-Signing für Produktion (optional für Dev)
 *
 * Falls electron-updater nicht installiert → stilles No-Op.
 */
'use strict';

class AutoUpdater {
  constructor({ mainWindow, logger, store }) {
    this.mainWindow = mainWindow;
    this.logger     = logger || console;
    this.store      = store;
    this.autoUpdater = null;
    this.updateAvailable = false;
    this.updateInfo = null;
  }

  initialize() {
    try {
      const { autoUpdater } = require('electron-updater');
      this.autoUpdater = autoUpdater;

      // Kein Auto-Download — User soll entscheiden
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;

      autoUpdater.on('checking-for-update', () => {
        this._send('update-status', { status: 'checking' });
      });

      autoUpdater.on('update-available', (info) => {
        this.updateAvailable = true;
        this.updateInfo = info;
        this._send('update-status', {
          status: 'available',
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes,
        });
        this.logger.info('AutoUpdater', `Update verfügbar: v${info.version}`);
      });

      autoUpdater.on('update-not-available', () => {
        this._send('update-status', { status: 'up-to-date' });
      });

      autoUpdater.on('download-progress', (progress) => {
        this._send('update-status', {
          status: 'downloading',
          percent: Math.round(progress.percent),
          transferred: progress.transferred,
          total: progress.total,
        });
      });

      autoUpdater.on('update-downloaded', (info) => {
        this._send('update-status', {
          status: 'ready',
          version: info.version,
        });
        this.logger.info('AutoUpdater', `Update v${info.version} heruntergeladen — Neustart zum Installieren`);
      });

      autoUpdater.on('error', (err) => {
        this._send('update-status', { status: 'error', error: err.message });
        this.logger.warn('AutoUpdater', 'Fehler: ' + err.message);
      });

      // Auto-Check beim Start (nach 30 Sekunden)
      if (this.store?.get('settings.autoUpdate') !== false) {
        setTimeout(() => this.checkForUpdates(), 30000);
      }

      this.logger.info('AutoUpdater', 'Initialisiert ✓');
    } catch (e) {
      this.logger.info('AutoUpdater', 'electron-updater nicht verfügbar — Auto-Update deaktiviert');
    }
  }

  async checkForUpdates() {
    if (!this.autoUpdater) return { status: 'not-available', reason: 'electron-updater nicht installiert' };
    try {
      const result = await this.autoUpdater.checkForUpdates();
      return { status: 'checked', updateInfo: result?.updateInfo };
    } catch (e) {
      return { status: 'error', error: e.message };
    }
  }

  async downloadUpdate() {
    if (!this.autoUpdater) return { error: 'electron-updater nicht installiert' };
    try {
      await this.autoUpdater.downloadUpdate();
      return { success: true };
    } catch (e) {
      return { error: e.message };
    }
  }

  installUpdate() {
    if (!this.autoUpdater) return;
    this.autoUpdater.quitAndInstall(false, true);
  }

  getStatus() {
    return {
      available: this.updateAvailable,
      info: this.updateInfo,
      autoUpdateEnabled: this.store?.get('settings.autoUpdate') !== false,
      updaterInstalled: !!this.autoUpdater,
    };
  }

  _send(channel, data) {
    if (this.mainWindow?.webContents) {
      this.mainWindow.webContents.send(channel, data);
    }
  }
}

module.exports = AutoUpdater;
