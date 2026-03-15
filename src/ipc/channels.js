/**
 * IPC Channel Contract v1.0 — Single Source of Truth
 *
 * Definiert ALLE IPC-Channels an EINER Stelle.
 * preload.js und handlers.js referenzieren diese Datei.
 *
 * Wenn ein neuer Handler hinzugefügt wird:
 *   1. Channel hier eintragen
 *   2. Handler in handlers.js implementieren
 *   3. Fertig — preload.js liest automatisch aus dieser Datei
 *
 * Kategorien:
 *   invoke  — renderer → main → response (ipcMain.handle)
 *   send    — renderer → main (one-way, ipcRenderer.send)
 *   events  — main → renderer (BrowserWindow.webContents.send)
 */

// ═══════════════════════════════════════════════════════════════════════
//  INVOKE CHANNELS (renderer calls main, expects response)
// ═══════════════════════════════════════════════════════════════════════

const INVOKE_CHANNELS = [
  // ── Core ──────────────────────────────────────────────────────────
  'get-settings', 'save-settings', 'get-system-stats',
  'get-agents', 'create-agent', 'delete-agent', 'update-agent', 'update-agent-model',
  'send-message', 'send-message-stream',
  'get-tasks', 'get-task-stats', 'clear-tasks',
  'list-conversations', 'get-conversations', 'get-conversations-meta',
  'load-conversation', 'get-conversation', 'delete-conversation',
  'export-conversation', 'export-conversations', 'search-conversations',
  'get-consciousness-state',
  'get-johnny-summary', 'get-memories', 'get-memory-count', 'add-memory',
  'execute-system-command',

  // ── Ollama ────────────────────────────────────────────────────────
  'list-ollama-models', 'pull-ollama-model', 'delete-ollama-model',
  'get-providers', 'get-models', 'set-active-provider-model',
  'set-api-key', 'test-provider',

  // ── Skills & Plugins ──────────────────────────────────────────────
  'list-skills', 'update-skill', 'create-skill', 'delete-skill',
  'list-plugins', 'install-plugin', 'uninstall-plugin',
  'toggle-plugin', 'get-plugin-config', 'set-plugin-config',

  // ── Browser & Vision ──────────────────────────────────────────────
  'browser-navigate', 'browser-click', 'browser-extract',
  'browser-screenshot', 'vision-analyze', 'vision-status',

  // ── Web Search ────────────────────────────────────────────────────
  'web-search', 'set-search-api-key',

  // ── Style ─────────────────────────────────────────────────────────
  'style-get', 'style-set', 'style-reset', 'style-history',

  // ── Embeddings ────────────────────────────────────────────────────
  'embedding-search-memories', 'embedding-status',

  // ── Creativity ────────────────────────────────────────────────────
  'creativity-compare-models', 'creativity-variants',

  // ── Image & Video ─────────────────────────────────────────────────
  'generate-image', 'get-image-providers',
  'analyze-video', 'video-service-status',

  // ── Sandbox ───────────────────────────────────────────────────────
  'sandbox-run', 'sandbox-status', 'sandbox-set-mode',

  // ── Email & Messenger ─────────────────────────────────────────────
  'create-email-account', 'list-email-accounts', 'send-email', 'delete-email-account',
  'connect-messenger', 'disconnect-messenger', 'get-messenger-status', 'send-messenger-message',

  // ── Voice / Audio ─────────────────────────────────────────────────
  'transcribe-audio', 'speak-text',
  'check-whisper', 'install-whisper', 'check-audio-tools',

  // ── Service Status ────────────────────────────────────────────────
  'get-service-status', 'get-registry-health', 'check-docker', 'get-docker-compose',

  // ── Auto-Update ───────────────────────────────────────────────────
  'update-check', 'update-download', 'update-install', 'update-status',

  // ── Autonomy + Biography (v2.1) ──────────────────────────────────
  'autonomy-status', 'autonomy-toggle', 'autonomy-bounds', 'autonomy-push-event',
  'biography-status', 'biography-learn',

  // ── Scheduler ─────────────────────────────────────────────────────
  'list-scheduled-tasks', 'cancel-scheduled-task',

  // ── Cloudflare ────────────────────────────────────────────────────
  'start-cloudflare-tunnel', 'stop-cloudflare-tunnel', 'install-cloudflared',

  // ── Gateway ───────────────────────────────────────────────────────
  'get-gateway-status', 'start-gateway', 'stop-gateway',

  // ── Swarm ─────────────────────────────────────────────────────────
  'run-swarm', 'get-swarms', 'cancel-swarm',

  // ── Heartbeat Tasks ───────────────────────────────────────────────
  'create-heartbeat-task', 'create-morning-briefing', 'create-system-health-check',
  'create-web-monitor', 'create-daily-reflection', 'create-service-watchdog', 'create-cleanup-task',
  'get-heartbeat-tasks', 'toggle-heartbeat-task',
  'delete-heartbeat-task', 'run-heartbeat-task-now',

  // ── Marketplace ───────────────────────────────────────────────────
  'marketplace-search', 'marketplace-categories', 'marketplace-install',
  'marketplace-uninstall', 'marketplace-installed',
  'marketplace-registries', 'marketplace-add-registry',

  // ── Smart Home & Integrations ─────────────────────────────────────
  'smarthome-devices', 'smarthome-sync', 'smarthome-status',
  'smarthome-hue-pair', 'smarthome-control',
  'spotify-search', 'spotify-now-playing', 'spotify-control',
  'calendar-events', 'calendar-create-event',
  'github-repos', 'github-issues', 'github-create-issue',
  'github-actions', 'github-trigger-workflow', 'github-notifications',
  'integrations-status',

  // ── CDP Browser ───────────────────────────────────────────────────
  'cdp-status', 'cdp-launch', 'cdp-tabs', 'cdp-navigate',
  'cdp-screenshot', 'cdp-page-content', 'cdp-eval', 'cdp-click', 'cdp-type',

  // ── Collaboration ─────────────────────────────────────────────────
  'start-collaboration', 'stop-collaboration', 'get-collaboration-status',
  'get-collaboration-rooms', 'open-collaboration-connect',

  // ── Webserver ─────────────────────────────────────────────────────
  'start-webserver', 'stop-webserver',

  // ── RAG / Knowledge ───────────────────────────────────────────────
  'rag-search', 'rag-add-knowledge', 'rag-stats', 'rag-status', 'rag-list-knowledge',

  // ── File Output & Utilities ───────────────────────────────────────
  'write-output-file', 'create-output-zip',
  'read-zip-contents', 'read-zip-contents-b64', 'open-output-folder',
  'open-file-path', 'open-url', 'set-clipboard-text',

  // ── Messenger Auth ────────────────────────────────────────────────
  'messenger:get-whitelist', 'messenger:set-whitelist',
  'messenger:get-all-whitelists', 'messenger:set-allow-all', 'messenger:get-allow-all',
  'telegram:get-whitelist', 'telegram:set-whitelist', 'telegram:set-allow-all',

  // ── Token Budget ──────────────────────────────────────────────────
  'token-budget:get', 'token-budget:set', 'token-budget:usage',

  // ── Logger ────────────────────────────────────────────────────────
  'logger:get-recent', 'logger:get-files',

  // ── Security ──────────────────────────────────────────────────────
  'security:get-settings', 'security:update-settings',
  'security:get-stats', 'security:confirm-response',

  // ── MCP ───────────────────────────────────────────────────────────
  'mcp-status', 'mcp-list-tools', 'mcp-call-tool',
  'mcp-add-server', 'mcp-remove-server',

  // ── v2.0 Advanced ─────────────────────────────────────────────────
  'ei-analyze', 'ei-profile', 'ei-status',
  'cw-generate', 'cw-analyze', 'cw-variants',
  'cw-create-character', 'cw-list-characters',
  'cw-create-project', 'cw-list-projects', 'cw-get-genres', 'cw-status',
  'ev-analyze', 'ev-deep-analyze', 'ev-compare', 'ev-workflow', 'ev-modes', 'ev-status',
  'tsa-load', 'tsa-statistics', 'tsa-forecast', 'tsa-anomalies', 'tsa-list',
  'tsa-trend', 'tsa-changepoints', 'tsa-summarize', 'tsa-status',
  'hub-connections', 'hub-templates', 'hub-connect', 'hub-disconnect',
  'hub-list-workflows', 'hub-create-workflow', 'hub-run-workflow',
  'hub-request', 'hub-health', 'hub-toggle-workflow', 'hub-delete-workflow',
  'hub-webhook-server', 'hub-status',
];

// ═══════════════════════════════════════════════════════════════════════
//  SEND CHANNELS (renderer → main, one-way)
// ═══════════════════════════════════════════════════════════════════════

const SEND_CHANNELS = [
  'renderer-ready',
  'setup-choice',
  'set-heartbeat-mode',
  'security:confirm-request',
];

// ═══════════════════════════════════════════════════════════════════════
//  EVENT CHANNELS (main → renderer, push events)
// ═══════════════════════════════════════════════════════════════════════

const EVENT_CHANNELS = [
  'services-initialized',
  'heartbeat',
  'setup-status',
  'model-pull-progress',
  'model-switched',
  'tool-step',
  'stream-chunk',
  'tunnel-status',
  'task-update',
  'whatsapp-qr', 'whatsapp-ready',
  'collab-update',
  'webserver-started', 'webserver-stopped',
  'update-status',
  'autonomy-notification', 'autonomy-ask',
];

module.exports = {
  INVOKE_CHANNELS,
  SEND_CHANNELS,
  EVENT_CHANNELS,
  ALL_CHANNELS: [...INVOKE_CHANNELS, ...SEND_CHANNELS, ...EVENT_CHANNELS],
};
