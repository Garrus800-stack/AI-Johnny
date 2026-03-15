const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

class CloudflareService {
  constructor(config = {}) {
    this.agentManager = config.agentManager;
    this.mainWindow = config.mainWindow;
    this.tunnelProcess = null;
    this.tunnelUrl = null;
    this.tunnelId = null;
  }

  async initialize() {
    const installed = await this.isInstalled();
    console.log('Cloudflared installed:', installed);
  }

  async isInstalled() {
    try {
      await execAsync('cloudflared --version');
      return true;
    } catch(_) { return false; }
  }

  async install() {
    const platform = os.platform();
    try {
      if (platform === 'win32') {
        // Try winget first, then direct download
        try {
          await execAsync('winget install Cloudflare.cloudflared', { timeout: 120000 });
          return { success: true, message: 'cloudflared installed via winget' };
        } catch(_) {
          // Download directly
          const url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
          const dest = path.join(process.env.LOCALAPPDATA || os.homedir(), 'cloudflared', 'cloudflared.exe');
          const { execAsync: ea } = require('util').promisify;
          const { default: axios } = await Promise.resolve().then(() => require('axios'));
          const fs = require('fs').promises;
          await fs.mkdir(path.dirname(dest), { recursive: true });
          const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
          await fs.writeFile(dest, res.data);
          // Add to PATH
          process.env.PATH = process.env.PATH + ';' + path.dirname(dest);
          return { success: true, message: 'cloudflared downloaded to ' + dest };
        }
      } else if (platform === 'linux') {
        await execAsync('curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared', { timeout: 60000 });
        return { success: true, message: 'cloudflared installed' };
      } else if (platform === 'darwin') {
        await execAsync('brew install cloudflared', { timeout: 120000 });
        return { success: true, message: 'cloudflared installed via brew' };
      }
    } catch(e) {
      return { success: false, message: 'Install failed: ' + e.message + '. Download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/' };
    }
  }

  async createTunnel(config) {
    const { port, protocol = 'http', name } = config;
    const localUrl = `${protocol}://127.0.0.1:${port}`;

    // Stop any existing tunnel
    await this.stopTunnel();

    return new Promise((resolve, reject) => {
      console.log(`Starting cloudflare tunnel for ${localUrl}...`);

      // Use spawn so we can read stdout/stderr in real time
      this.tunnelProcess = spawn('cloudflared', ['tunnel', '--url', localUrl], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.tunnelUrl = null;
      const timeout = setTimeout(() => {
        if (!this.tunnelUrl) reject(new Error('Timeout: no tunnel URL received after 45s'));
      }, 45000);

      const onData = (data) => {
        const text = data.toString();
        console.log('[cloudflared]', text.trim());

        // Send progress to renderer
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('tunnel-status', { status: text.trim().slice(0, 100) });
        }

        // Parse tunnel URL
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match && !this.tunnelUrl) {
          this.tunnelUrl = match[0];
          clearTimeout(timeout);
          console.log('Tunnel URL:', this.tunnelUrl);
          if (this.mainWindow && this.mainWindow.webContents) {
            this.mainWindow.webContents.send('tunnel-status', { url: this.tunnelUrl });
          }
          resolve({ url: this.tunnelUrl, port, localUrl });
        }
      };

      this.tunnelProcess.stdout.on('data', onData);
      this.tunnelProcess.stderr.on('data', onData); // cloudflared logs to stderr

      this.tunnelProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error('cloudflared not found. Please install it first.'));
      });

      this.tunnelProcess.on('exit', (code) => {
        this.tunnelProcess = null;
        this.tunnelUrl = null;
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('tunnel-status', { status: 'Tunnel stopped' });
        }
      });
    });
  }

  async stopTunnel() {
    if (this.tunnelProcess) {
      try {
        this.tunnelProcess.kill('SIGTERM');
        if (os.platform() === 'win32') {
          await execAsync('taskkill /F /IM cloudflared.exe').catch(() => {});
        }
      } catch(_) {}
      this.tunnelProcess = null;
      this.tunnelUrl = null;
    }
  }

  getStatus() {
    return {
      running: !!this.tunnelProcess,
      url: this.tunnelUrl
    };
  }
}

module.exports = CloudflareService;
