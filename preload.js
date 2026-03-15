/**
 * preload.js v2.0 — IPC-Brücke (Auto-Whitelist aus channels.js)
 *
 * Whitelist wird automatisch aus src/ipc/channels.js generiert.
 * Neuen Channel? → In channels.js eintragen, fertig.
 *
 * window.johnny.invoke('channel', data) — whitelisted IPC
 */

const { ipcRenderer } = require('electron');

// ── Whitelist aus Single Source of Truth ───────────────────────────────────
let INVOKE_CHANNELS, SEND_CHANNELS, EVENT_CHANNELS;
try {
  const ch = require('./src/ipc/channels');
  INVOKE_CHANNELS = ch.INVOKE_CHANNELS;
  SEND_CHANNELS   = ch.SEND_CHANNELS;
  EVENT_CHANNELS  = ch.EVENT_CHANNELS;
} catch (e) {
  console.warn('[preload] channels.js nicht gefunden — Fallback auf leere Listen');
  INVOKE_CHANNELS = [];
  SEND_CHANNELS   = [];
  EVENT_CHANNELS  = [];
}

const ALLOWED_INVOKE  = new Set(INVOKE_CHANNELS);
const ALLOWED_SEND    = new Set(SEND_CHANNELS);
const ALLOWED_RECEIVE = new Set([...EVENT_CHANNELS, ...SEND_CHANNELS]);

// ── API ───────────────────────────────────────────────────────────────────
window.johnny = {
  invoke(channel, data) {
    if (!ALLOWED_INVOKE.has(channel)) {
      console.warn(`[preload] Blocked invoke: "${channel}"`);
      return Promise.reject(new Error(`Channel "${channel}" not allowed`));
    }
    return ipcRenderer.invoke(channel, data);
  },

  on(channel, callback) {
    if (!ALLOWED_RECEIVE.has(channel)) {
      console.warn(`[preload] Blocked on: "${channel}"`);
      return;
    }
    const sub = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  },

  once(channel, callback) {
    if (!ALLOWED_RECEIVE.has(channel)) return;
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
  },

  send(channel, data) {
    if (ALLOWED_SEND.has(channel)) ipcRenderer.send(channel, data);
  },

  removeAllListeners(channel) {
    if (ALLOWED_RECEIVE.has(channel)) ipcRenderer.removeAllListeners(channel);
  },
};

window.johnnyEnv = {
  platform: process.platform,
  version:  process.env.npm_package_version || '2.1.0',
};

console.log(`[preload] Johnny API v2.1 — ${ALLOWED_INVOKE.size} invoke, ${ALLOWED_RECEIVE.size} event channels`);
