/**
 * BackgroundDaemon — Johnny existiert auch ohne UI
 *
 * Löst das "Schrödingers Johnny"-Problem:
 * Wenn der User das Fenster schließt, stirbt Johnny nicht mehr.
 * Er läuft als Tray-Icon weiter und denkt autonom.
 *
 * Was passiert im Background:
 *   - HeartbeatTasks laufen weiter (Morning Briefing, Watchdog)
 *   - AutonomyService evaluiert Events
 *   - Sensor-Polling (System-Gesundheit)
 *   - Messenger bleiben verbunden (Telegram, Discord)
 *   - Notifications via System-Tray
 *
 * Klick auf Tray → Fenster öffnet sich wieder
 * Rechtsklick → Kontextmenü (Status, Quit)
 */
'use strict';

const { Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');

class BackgroundDaemon {
  constructor({ app, createWindow, mainWindowGetter, store, registry, logger }) {
    this.app              = app;
    this.createWindow     = createWindow;
    this.getMainWindow    = mainWindowGetter;
    this.store            = store;
    this.registry         = registry;
    this.logger           = logger || console;
    this.tray             = null;
    this._backgroundMode  = false;
    this._notifQueue      = [];
  }

  initialize() {
    if (this.store?.get('settings.backgroundMode') === false) {
      this.logger.info('BackgroundDaemon', 'Deaktiviert (settings.backgroundMode = false)');
      return;
    }

    this._createTray();
    this._setupWindowIntercept();
    this.logger.info('BackgroundDaemon', 'Initialisiert — Johnny lebt weiter wenn das Fenster schließt');
  }

  _createTray() {
    try {
      // Versuche Icon zu laden, Fallback auf leeres Icon
      let iconPath = path.join(__dirname, '..', '..', 'public', 'icon.png');
      let icon;
      try {
        icon = nativeImage.createFromPath(iconPath);
        if (icon.isEmpty()) icon = nativeImage.createEmpty();
      } catch {
        icon = nativeImage.createEmpty();
      }

      // Tray mit 16x16 Icon
      this.tray = new Tray(icon.resize({ width: 16, height: 16 }));
      this.tray.setToolTip('Johnny AI — Running in Background');

      this._updateTrayMenu();

      // Klick → Fenster öffnen/fokussieren
      this.tray.on('click', () => this._showWindow());
    } catch (e) {
      this.logger.warn('BackgroundDaemon', 'Tray creation failed: ' + e.message);
    }
  }

  _updateTrayMenu() {
    if (!this.tray) return;

    const self = this;
    const menu = Menu.buildFromTemplate([
      {
        label: '🤖 Johnny öffnen',
        click: () => self._showWindow(),
      },
      {
        label: self._backgroundMode ? '● Background Mode aktiv' : '○ Background Mode',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '📊 Status',
        click: () => {
          const autonomy = self.registry?.get('autonomy');
          const status = autonomy ? autonomy.getStatus() : { enabled: false };
          const hb = self.registry?.get('heartbeatTask');
          const tasks = hb?.tasks?.size || 0;
          self._showNotification('Johnny Status',
            `Autonomie: ${status.enabled ? 'AN' : 'AUS'}\n` +
            `Queue: ${status.queueLength || 0} Events\n` +
            `Tasks: ${tasks} aktiv\n` +
            `Aktionen/h: ${status.actionsThisHour || 0}/${status.maxActionsPerHour || 10}`
          );
        },
      },
      {
        label: '🔔 Autonomie ' + (this.store?.get('settings.autonomyEnabled') !== false ? 'deaktivieren' : 'aktivieren'),
        click: () => {
          const current = self.store?.get('settings.autonomyEnabled') !== false;
          self.store?.set('settings.autonomyEnabled', !current);
          const autonomy = self.registry?.get('autonomy');
          if (autonomy) { current ? autonomy.stop() : autonomy.start(); }
          self._updateTrayMenu();
        },
      },
      { type: 'separator' },
      {
        label: '❌ Johnny beenden',
        click: () => {
          self._backgroundMode = false;
          self.app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  /**
   * Fenster-Close abfangen → statt beenden → in Background wechseln.
   */
  _setupWindowIntercept() {
    // Überschreibe window-all-closed: Johnny beendet sich NICHT
    this.app.on('window-all-closed', (e) => {
      if (process.platform === 'darwin') return; // macOS: normal
      // Auf Windows/Linux: NICHT quiten, Johnny lebt im Tray
      this._backgroundMode = true;
      this._updateTrayMenu();
      this.tray?.setToolTip('Johnny AI — Background Mode 🟢');
      this.logger.info('BackgroundDaemon', 'Fenster geschlossen → Background Mode');
    });
  }

  async _showWindow() {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    } else {
      // Fenster neu erstellen
      await this.createWindow();
    }
    this._backgroundMode = false;
    this._updateTrayMenu();
    this.tray?.setToolTip('Johnny AI — Active');
  }

  /**
   * System-Notification senden (auch ohne offenes Fenster).
   */
  _showNotification(title, body) {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body, icon: path.join(__dirname, '..', '..', 'public', 'icon.png') }).show();
      }
    } catch {}
  }

  /**
   * Von AutonomyService aufgerufen — zeigt Notification.
   */
  notifyUser(message, priority = 'info') {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      // Fenster offen → Toast im UI
      win.webContents.send('autonomy-notification', { message, priority });
    } else {
      // Background → System-Notification
      this._showNotification(
        priority === 'critical' ? '🚨 Johnny — Kritisch' : '🤖 Johnny',
        message
      );
    }
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = BackgroundDaemon;
