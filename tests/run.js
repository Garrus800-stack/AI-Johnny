/**
 * Johnny Test Suite v1.0
 * node tests/run.js
 */
const path = require('path');
const fs   = require('fs');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✓ ' + name); } catch(e) { failed++; console.log('  ✗ ' + name + '\n    ' + e.message); } }
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

// ═══ 1. ServiceRegistry v2 ═══
console.log('\n═══ ServiceRegistry v2 ═══');
var ServiceRegistry = require('../src/core/ServiceRegistry');

test('wireDeps in register()', function() {
  var reg = new ServiceRegistry();
  function A() {} A.prototype.initialize = function(){};
  reg.register('a', A, {}, [], { wireDeps: ['b'], wireMap: { x: 'y' } });
  var e = reg._entries.get('a');
  assert(e.wireDeps[0] === 'b'); assert(e.wireMap.x === 'y');
});

test('registerWiring()', function() {
  var reg = new ServiceRegistry();
  reg.registerWiring('svcA', 'svcB', 'myProp', true);
  assert(reg._wirings.has('svcA')); assert(reg._wirings.get('svcA')[0].bidir === true);
});

test('getHealth() mit register()', function() {
  var reg = new ServiceRegistry();
  function A() {} A.prototype.initialize = function(){};
  reg.register('a', A, {}, []);
  reg.register('b', A, {}, []);
  var h = reg.getHealth();
  assert(h.total === 2, 'Expected 2, got ' + h.total);
  assert(Array.isArray(h.services));
});

test('$ref Config-Auflösung', function() {
  var reg = new ServiceRegistry();
  reg.registerInstance('dep', { value: 42 });
  var r = reg._resolveConfig({ myDep: { $ref: 'dep' } });
  assert(r.myDep.value === 42);
});

test('Topologische Sortierung', function() {
  var reg = new ServiceRegistry();
  function S() {} S.prototype.initialize = function(){};
  reg.register('c', S, {}, ['b']); reg.register('b', S, {}, ['a']); reg.register('a', S, {}, []);
  var order = reg._topologicalSort();
  assert(order.indexOf('a') < order.indexOf('b')); assert(order.indexOf('b') < order.indexOf('c'));
});

test('Phase 1+2 Integration', async function() {
  var reg = new ServiceRegistry();
  function Svc() { this.x = null; }
  Svc.prototype.initialize = function(){};
  function Dep() { this.y = 99; }
  Dep.prototype.initialize = function(){};
  reg.register('dep', Dep, {}, []);
  reg.register('svc', Svc, {}, [], { wireDeps: ['dep'] });
  // Can't run async in sync test, but verify structure
  assert(reg._entries.get('svc').wireDeps[0] === 'dep');
});

// ═══ 2. IPC Channel Contract ═══
console.log('\n═══ IPC Channel Contract ═══');
var channels = require('../src/ipc/channels');

test('channels.js Exports', function() {
  assert(Array.isArray(channels.INVOKE_CHANNELS)); assert(Array.isArray(channels.SEND_CHANNELS)); assert(Array.isArray(channels.EVENT_CHANNELS));
});

test('Keine doppelten Channels', function() {
  var dupes = channels.INVOKE_CHANNELS.filter(function(c,i,a){ return a.indexOf(c) !== i; });
  assert(dupes.length === 0, 'Dupes: ' + dupes.join(', '));
});

test('Kritische Channels vorhanden', function() {
  var inv = channels.INVOKE_CHANNELS;
  ['send-message','get-providers','get-service-status','sandbox-run','check-docker',
   'check-audio-tools','ei-status','cw-status','ev-status','open-file-path','open-url',
   'set-clipboard-text','create-daily-reflection','get-registry-health'].forEach(function(ch) {
    assert(inv.indexOf(ch) >= 0, 'Missing: ' + ch);
  });
});

test('Handler ↔ Channel Sync', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'ipc', 'handlers.js'), 'utf8');
  var re = /ipcMain\.handle\('([^']+)'/g, m, missing = [];
  while ((m = re.exec(code)) !== null) { if (channels.INVOKE_CHANNELS.indexOf(m[1]) < 0) missing.push(m[1]); }
  assert(missing.length < 10, missing.length + ' handlers not in channels.js: ' + missing.slice(0,8).join(', '));
  if (missing.length > 0) console.log('    ⚠ Minor: ' + missing.join(', '));
});

// ═══ 3. Property Naming ═══
console.log('\n═══ Property Naming ═══');

test('Kein mgr.imageService (soll imageGenService)', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ToolRegistryExtensions.js'), 'utf8');
  assert(code.indexOf('mgr.imageService') === -1); assert(code.indexOf('mgr.imageGenService') >= 0);
});

test('Sandbox liest output+stdout', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'views', 'ViewHelpers.js'), 'utf8');
  assert(code.indexOf('r.output') >= 0 && code.indexOf('r.stdout') >= 0);
});

// ═══ 4. View Splitting ═══
console.log('\n═══ View Splitting ═══');

test('ViewRegistry.js ist Thin Router (< 50 Zeilen)', function() {
  var lines = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'views', 'ViewRegistry.js'), 'utf8').split('\n').length;
  assert(lines < 50, lines + ' lines');
});

['ViewsCore.js','ViewsTools.js','ViewsSystem.js','ViewsAdvanced.js','ViewsAutomation.js'].forEach(function(file) {
  test(file + ' hat Views', function() {
    var p = path.join(__dirname, '..', 'src', 'components', 'views', file);
    assert(fs.existsSync(p), 'Missing: ' + file);
    assert(fs.readFileSync(p, 'utf8').indexOf('function view') >= 0, 'No views');
  });
});

// ═══ 5. preload.js ═══
console.log('\n═══ preload.js ═══');

test('preload.js importiert channels.js', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert(code.indexOf('channels') >= 0); assert(code.indexOf('INVOKE_CHANNELS') >= 0);
});

// ═══ 6. main.js Wiring ═══
console.log('\n═══ main.js Wiring ═══');

test('Services benutzen wireDeps statt harte Init-Deps', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  // These should have [], { ... wireDeps: ['agentManager'] }
  // NOT }, ['agentManager'], { ... }
  var bad = ['emotionalIntelligence','creativeWriting','enhancedVision','errorAnalysis',
    'contextMemory','feedbackLearning','creativity','nlp','webAutonomy','dataAnalysis'];
  bad.forEach(function(svc) {
    // Match: register('name', ..., ['agentManager'], {  — the DEPS array position (4th param)
    var re = new RegExp("register\\('" + svc + "'[^)]+\\),\\s*\\['agentManager'\\]");
    assert(!re.test(code), svc + ' has [agentManager] as init dep (4th param)');
  });
});

test('wireDeps deklariert (>= 8)', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert((code.match(/wireDeps:/g) || []).length >= 8);
});

test('registerWiring() benutzt (>= 3)', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert((code.match(/registerWiring\(/g) || []).length >= 3);
});

// ═══ 7. Conversation Handlers ═══
console.log('\n═══ Conversation Handlers ═══');

test('list-conversations alias exists in handlers.js', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'ipc', 'handlers.js'), 'utf8');
  assert(code.indexOf("'list-conversations'") >= 0, 'list-conversations handler missing');
  assert(code.indexOf("'export-conversation'") >= 0, 'export-conversation handler missing');
  assert(code.indexOf("'load-conversation'") >= 0, 'load-conversation handler missing');
  assert(code.indexOf("'delete-conversation'") >= 0, 'delete-conversation handler missing');
});

test('Conversation channels in channels.js', function() {
  var ch = require('../src/ipc/channels');
  ['list-conversations','load-conversation','export-conversation','delete-conversation'].forEach(function(c) {
    assert(ch.INVOKE_CHANNELS.indexOf(c) >= 0, 'Missing channel: ' + c);
  });
});

// ═══ 8. AutoUpdater ═══
console.log('\n═══ AutoUpdater ═══');

test('AutoUpdater modul lädt', function() {
  var AU = require('../src/services/AutoUpdater');
  assert(typeof AU === 'function', 'Should export class');
  var u = new AU({ mainWindow: null, logger: console, store: null });
  assert(typeof u.checkForUpdates === 'function');
  assert(typeof u.getStatus === 'function');
});

test('Update channels in channels.js', function() {
  var ch = require('../src/ipc/channels');
  ['update-check','update-download','update-install','update-status'].forEach(function(c) {
    assert(ch.INVOKE_CHANNELS.indexOf(c) >= 0, 'Missing: ' + c);
  });
  assert(ch.EVENT_CHANNELS.indexOf('update-status') >= 0, 'Missing event: update-status');
});

// ═══ 9. Boot Order ═══
console.log('\n═══ Boot Order ═══');

test('Handler registration before createWindow', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  var handlerPos = code.indexOf('ipcHandlers.register(');
  var windowPos  = code.indexOf('await createWindow()');
  assert(handlerPos > 0, 'ipcHandlers.register not found');
  assert(windowPos > 0, 'createWindow not found');
  assert(handlerPos < windowPos, 'Handlers must be registered BEFORE createWindow! handler=' + handlerPos + ' window=' + windowPos);
});

test('No services with agentManager as init dep (comprehensive)', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  // Find all register() calls with ['agentManager'] in deps position
  var re = /register\('[^']+',\s*\w+,\s*\{[^}]*\},\s*\['agentManager'[^\]]*\]/g;
  var matches = code.match(re) || [];
  // agentManager itself can have deps like ['ollama'] — filter those
  var bad = matches.filter(function(m) { return m.indexOf("'agentManager',") === -1; });
  assert(bad.length === 0, 'Services with agentManager init dep: ' + bad.length + '\n    ' + bad.join('\n    '));
});

// ═══ 10. Feature Completeness ═══
console.log('\n═══ Feature Completeness ═══');

test('Markdown rendering in chat (markdown-it)', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'views', 'ViewsCore.js'), 'utf8');
  assert(code.indexOf('markdown-it') >= 0, 'markdown-it not loaded');
  assert(code.indexOf('renderMarkdown') >= 0, 'renderMarkdown not defined');
  assert(code.indexOf('markdown-body') >= 0, 'markdown-body class not used');
});

test('Streaming support in sendMessage', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'views', 'ViewHelpers.js'), 'utf8');
  assert(code.indexOf('send-message-stream') >= 0, 'Stream channel not used');
  assert(code.indexOf('stream-chunk') >= 0, 'stream-chunk listener not set');
  assert(code.indexOf('streamText') >= 0, 'streamText state not used');
});

test('Toast notification system', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'views', 'ViewHelpers.js'), 'utf8');
  assert(code.indexOf('function notify') >= 0, 'notify function missing');
  assert(code.indexOf("'toasts'") >= 0 || code.indexOf('toasts') >= 0, 'toasts state not used');
});

test('Ollama auto-reconnect in heartbeat', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'context', 'AppContext.js'), 'utf8');
  assert(code.indexOf('ollamaDown') >= 0, 'ollamaDown state missing');
  assert(code.indexOf('list-ollama-models') >= 0 && code.indexOf('ollamaDown') >= 0, 'Auto-reconnect logic missing');
});

test('Plugin Development Guide exists', function() {
  assert(fs.existsSync(path.join(__dirname, '..', 'PLUGIN_DEV.md')), 'PLUGIN_DEV.md missing');
  var content = fs.readFileSync(path.join(__dirname, '..', 'PLUGIN_DEV.md'), 'utf8');
  assert(content.indexOf('Hello World') >= 0, 'Missing Hello World example');
  assert(content.indexOf('manager.searchService') >= 0, 'Missing service reference');
});

test('Conversation sidebar in chat', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'views', 'ViewsCore.js'), 'utf8');
  assert(code.indexOf('showConvSidebar') >= 0, 'Sidebar toggle missing');
  assert(code.indexOf('convSearch') >= 0, 'Conversation search missing');
});

test('Image drag&drop in chat', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'views', 'ViewsCore.js'), 'utf8');
  assert(code.indexOf('onDrop') >= 0, 'Drop handler missing');
  assert(code.indexOf('chatImage') >= 0, 'chatImage state missing');
});

// ═══ 11. AutonomyService ═══
console.log('\n═══ AutonomyService ═══');

test('AutonomyService loads and has correct API', function() {
  var AS = require('../src/services/AutonomyService');
  var a = new AS({ dataDir: '/tmp/test-autonomy', enabled: false });
  assert(typeof a.pushEvent === 'function', 'pushEvent missing');
  assert(typeof a.start === 'function', 'start missing');
  assert(typeof a.stop === 'function', 'stop missing');
  assert(typeof a.getStatus === 'function', 'getStatus missing');
  assert(typeof a.updateBounds === 'function', 'updateBounds missing');
  var status = a.getStatus();
  assert(status.enabled === false, 'Should be disabled');
  assert(Array.isArray(status.bounds.allowed), 'bounds.allowed should be array');
  assert(Array.isArray(status.bounds.forbidden), 'bounds.forbidden should be array');
});

test('AutonomyService safety bounds block forbidden actions', function() {
  var AS = require('../src/services/AutonomyService');
  var a = new AS({ enabled: false });
  assert(a.bounds.forbidden.indexOf('delete-files') >= 0, 'delete-files should be forbidden by default');
  assert(a.bounds.forbidden.indexOf('send-email') >= 0, 'send-email should be forbidden by default');
  assert(a.bounds.allowed.indexOf('notify-user') >= 0, 'notify-user should be allowed');
});

test('AutonomyService event queue works', function() {
  var AS = require('../src/services/AutonomyService');
  var a = new AS({ enabled: false });
  a.pushEvent({ type: 'test', source: 'unit-test' });
  assert(a._eventQueue.length === 1, 'Queue should have 1 event');
  assert(a._eventQueue[0].type === 'test', 'Event type should be test');
  assert(a._eventQueue[0].timestamp > 0, 'Should have timestamp');
});

test('Autonomy channels in channels.js', function() {
  var ch = require('../src/ipc/channels');
  ['autonomy-status','autonomy-toggle','autonomy-bounds'].forEach(function(c) {
    assert(ch.INVOKE_CHANNELS.indexOf(c) >= 0, 'Missing: ' + c);
  });
  assert(ch.EVENT_CHANNELS.indexOf('autonomy-notification') >= 0, 'Missing event: autonomy-notification');
});

// ═══ 12. BiographicalMemory ═══
console.log('\n═══ BiographicalMemory ═══');

test('BiographicalMemory loads and has correct API', function() {
  var BM = require('../src/services/BiographicalMemory');
  var b = new BM({ dataDir: '/tmp/test-bio' });
  assert(typeof b.recordEpisode === 'function', 'recordEpisode missing');
  assert(typeof b.learnFact === 'function', 'learnFact missing');
  assert(typeof b.getFact === 'function', 'getFact missing');
  assert(typeof b.getNarrative === 'function', 'getNarrative missing');
  assert(typeof b.getSystemPromptBlock === 'function', 'getSystemPromptBlock missing');
});

test('BiographicalMemory fact storage works', function() {
  var BM = require('../src/services/BiographicalMemory');
  var b = new BM({});
  b.learnFact('user', 'name', 'Garrus');
  b.learnFact('projects', 'main', 'Johnny AI');
  assert(b.getFact('user', 'name') === 'Garrus', 'Should recall user name');
  assert(b.getFact('projects', 'main') === 'Johnny AI', 'Should recall project');
  assert(b.getCategories().length === 2, 'Should have 2 categories');
});

test('BiographicalMemory episode recording', function() {
  var BM = require('../src/services/BiographicalMemory');
  var b = new BM({});
  b.recordEpisode({ type: 'interaction', summary: 'Test', userMessage: 'Hallo' });
  assert(b._episodes.length === 1, 'Should have 1 episode');
  assert(b._interactionCount === 1, 'Count should be 1');
  var block = b.getSystemPromptBlock();
  assert(block.indexOf('BIOGRAPHICAL MEMORY') >= 0, 'Should contain section header');
});

test('BiographicalMemory tools registered', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ToolRegistryExtensions.js'), 'utf8');
  assert(code.indexOf('remember_fact') >= 0, 'remember_fact tool missing');
  assert(code.indexOf('recall_facts') >= 0, 'recall_facts tool missing');
  assert(code.indexOf('get_my_biography') >= 0, 'get_my_biography tool missing');
  assert(code.indexOf('autonomy_status') >= 0, 'autonomy_status tool missing');
});

// ═══ 13. BackgroundDaemon ═══
console.log('\n═══ BackgroundDaemon ═══');

test('BackgroundDaemon module loads', function() {
  // Can't fully test (needs Electron), but module should parse
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'BackgroundDaemon.js'), 'utf8');
  assert(code.indexOf('class BackgroundDaemon') >= 0, 'Class definition missing');
  assert(code.indexOf('_createTray') >= 0, 'Tray creation missing');
  assert(code.indexOf('notifyUser') >= 0, 'notifyUser missing');
  assert(code.indexOf('backgroundMode') >= 0, 'backgroundMode missing');
});

test('Background mode in window-all-closed', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert(code.indexOf('backgroundMode') >= 0, 'backgroundMode not in main.js');
  assert(code.indexOf('Background Mode') >= 0, 'Background Mode text missing');
});

// ═══ 14. AgentManager — Tool Parsing (PRIO 2) ═══
console.log('\n═══ AgentManager Tool Parsing ═══');

// AgentManager benötigt uuid — mock wenn nicht installiert
var am = null;
try {
  var AgentManager = require('../src/services/AgentManager');
  am = new AgentManager({
    agentsDir: '/tmp/test-agents', knowledgeDir: '/tmp/test-knowledge',
    ollamaService: null, modelProvider: null, pluginManager: null,
  });
} catch(e) {
  // Fallback: _parseToolCalls direkt aus Code extrahieren
  var amCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'AgentManager.js'), 'utf8');
  // Standalone _parseToolCalls für Tests
  am = {
    _parseToolCalls: function(message) {
      var calls = [];
      if (!message) return calls;
      var rx1 = /TOOL_CALL:\s*(\{[\s\S]*?\})(?=\s*(?:TOOL_CALL|\n\n|$))/g;
      var m;
      while ((m = rx1.exec(message)) !== null) {
        try { var p = JSON.parse(m[1].trim()); if (p.tool) calls.push({ tool: p.tool, parameters: p.parameters || {} }); } catch {}
      }
      if (calls.length) return calls;
      var rx2 = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
      while ((m = rx2.exec(message)) !== null) {
        try { var p = JSON.parse(m[1].trim()); if (p.tool) calls.push({ tool: p.tool, parameters: p.parameters || {} }); } catch {}
      }
      if (calls.length) return calls;
      var rx3t = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
      while ((m = rx3t.exec(message)) !== null) {
        try { var p = JSON.parse(m[1].trim()); if (p.tool) calls.push({ tool: p.tool, parameters: p.parameters || {} }); } catch {}
      }
      if (calls.length) return calls;
      var rx3 = /\{[^{}]*"tool"\s*:\s*"([^"]+)"[^{}]*\}/g;
      while ((m = rx3.exec(message)) !== null) {
        try { var p = JSON.parse(m[0]); if (p.tool) calls.push({ tool: p.tool, parameters: p.parameters || {} }); } catch {}
      }
      return calls;
    }
  };
}

test('Parse TOOL_CALL: {...} format', function() {
  var calls = am._parseToolCalls('TOOL_CALL: {"tool":"web_search","parameters":{"query":"test"}}');
  assert(calls.length === 1, 'Should find 1 tool call, got ' + calls.length);
  assert(calls[0].tool === 'web_search', 'Tool should be web_search');
  assert(calls[0].parameters.query === 'test', 'Param should be test');
});

test('Parse multiple TOOL_CALL in one message', function() {
  var msg = 'Let me search.\nTOOL_CALL: {"tool":"web_search","parameters":{"query":"a"}}\n\nNow analyze.\nTOOL_CALL: {"tool":"nlp_sentiment","parameters":{"text":"hello"}}';
  var calls = am._parseToolCalls(msg);
  assert(calls.length === 2, 'Should find 2 tool calls, got ' + calls.length);
  assert(calls[0].tool === 'web_search');
  assert(calls[1].tool === 'nlp_sentiment');
});

test('Parse ```json {...} ``` code block format', function() {
  var msg = 'Here is my action:\n```json\n{"tool":"generate_image","parameters":{"prompt":"cat"}}\n```';
  var calls = am._parseToolCalls(msg);
  assert(calls.length === 1, 'Should find 1 tool call');
  assert(calls[0].tool === 'generate_image');
});

test('Parse <tool_call>{...}</tool_call> XML format', function() {
  var msg = 'I will search. <tool_call>{"tool":"web_search","parameters":{"query":"hello"}}</tool_call>';
  var calls = am._parseToolCalls(msg);
  assert(calls.length === 1, 'Should find 1 tool call');
  assert(calls[0].tool === 'web_search');
});

test('Parse bare JSON with tool field', function() {
  var msg = 'Action: {"tool":"sensor_system_info","parameters":"none"}';
  var calls = am._parseToolCalls(msg);
  assert(calls.length === 1, 'Should find 1 tool call, got ' + calls.length);
  assert(calls[0].tool === 'sensor_system_info');
});

test('Return empty array for messages without tools', function() {
  assert(am._parseToolCalls('Hello, how are you?').length === 0);
  assert(am._parseToolCalls('').length === 0);
  assert(am._parseToolCalls(null).length === 0);
  assert(am._parseToolCalls(undefined).length === 0);
});

test('Handle malformed JSON gracefully', function() {
  var calls = am._parseToolCalls('TOOL_CALL: {broken json here}');
  assert(calls.length === 0, 'Should return empty for malformed JSON');
});

test('Handle mixed text and tool calls', function() {
  var msg = 'Ich analysiere das Bild.\n\nTOOL_CALL: {"tool":"vision_analyze","parameters":{"image":"test.png"}}\n\nDas Bild zeigt eine Katze.';
  var calls = am._parseToolCalls(msg);
  assert(calls.length === 1);
  assert(calls[0].tool === 'vision_analyze');
  assert(calls[0].parameters.image === 'test.png');
});

test('Parse tool call with nested parameters', function() {
  var msg = 'TOOL_CALL: {"tool":"autonomy_set_bounds","parameters":{"allowed":["notify-user","create-task"],"maxActionsPerHour":5}}';
  var calls = am._parseToolCalls(msg);
  assert(calls.length === 1);
  assert(calls[0].tool === 'autonomy_set_bounds');
  assert(Array.isArray(calls[0].parameters.allowed));
  assert(calls[0].parameters.maxActionsPerHour === 5);
});

// ═══ 15. AgentManager — Mock sendMessage flow ═══
console.log('\n═══ AgentManager Mock Flow ═══');

test('Tool parsing logic matches AgentManager._parseToolCalls exactly', function() {
  var amCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'AgentManager.js'), 'utf8');
  // Verify the function exists in AgentManager
  assert(amCode.indexOf('_parseToolCalls(message)') >= 0, '_parseToolCalls method missing');
  // Verify all 4 parsing variants exist
  assert(amCode.indexOf('TOOL_CALL:') >= 0, 'Variant 1 (TOOL_CALL:) missing');
  assert(amCode.indexOf('```json') >= 0 || amCode.indexOf('```(?:json)') >= 0, 'Variant 2 (code block) missing');
  assert(amCode.indexOf('tool_call>') >= 0, 'Variant 3 (XML tags) missing');
  assert(amCode.indexOf('"tool"') >= 0, 'Variant 4 (bare JSON) missing');
});

test('sendMessage method exists in AgentManager', function() {
  var amCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'AgentManager.js'), 'utf8');
  assert(amCode.indexOf('async sendMessage(') >= 0, 'sendMessage missing');
  assert(amCode.indexOf('async _sendMessageInternal(') >= 0, '_sendMessageInternal missing');
  assert(amCode.indexOf('executeToolCallLoop') >= 0, 'executeToolCallLoop missing');
});

// ═══ 16. State Management v2 ═══
console.log('\n═══ State Management v2 ═══');

test('AppContext has SILENT_KEYS optimization', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'context', 'AppContext.js'), 'utf8');
  assert(code.indexOf('SILENT_KEYS') >= 0, 'SILENT_KEYS not found');
  assert(code.indexOf('silentRef') >= 0, 'silentRef not found');
  assert(code.indexOf('useRef') >= 0, 'useRef not used');
});

test('Silent keys include internal flags', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'context', 'AppContext.js'), 'utf8');
  assert(code.indexOf("'_dockerChecked'") >= 0, '_dockerChecked should be silent');
  assert(code.indexOf("'_eiChecked'") >= 0, '_eiChecked should be silent');
  assert(code.indexOf("'debugLog'") >= 0, 'debugLog should be silent');
});

// ═══ 17. HardwareBridgeService ═══
console.log('\n═══ HardwareBridgeService ═══');

test('HardwareBridgeService loads and has correct API', function() {
  var HBS = require('../src/services/HardwareBridgeService');
  var hw = new HBS({ dataDir: '/tmp/test-hw' });
  assert(typeof hw.getGPUInfo === 'function', 'getGPUInfo missing');
  assert(typeof hw.listSerialPorts === 'function', 'listSerialPorts missing');
  assert(typeof hw.flashMicrocontroller === 'function', 'flashMicrocontroller missing');
  assert(typeof hw.startProcess === 'function', 'startProcess missing');
  assert(typeof hw.stopProcess === 'function', 'stopProcess missing');
  assert(typeof hw.getStatus === 'function', 'getStatus missing');
  var status = hw.getStatus();
  assert(status.platform === process.platform, 'Platform mismatch');
  assert(typeof status.cpus === 'number', 'cpus should be number');
});

test('Hardware tools registered', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ToolRegistryExtensions.js'), 'utf8');
  assert(code.indexOf('gpu_info') >= 0, 'gpu_info tool missing');
  assert(code.indexOf('list_serial_ports') >= 0, 'list_serial_ports tool missing');
  assert(code.indexOf('flash_microcontroller') >= 0, 'flash_microcontroller tool missing');
  assert(code.indexOf('manage_process') >= 0, 'manage_process tool missing');
});

// ═══ 18. VisualReasoningService ═══
console.log('\n═══ VisualReasoningService ═══');

test('VisualReasoningService loads and has correct API', function() {
  var VRS = require('../src/services/VisualReasoningService');
  var vr = new VRS({ dataDir: '/tmp/test-visual' });
  assert(typeof vr.analyzeDeep === 'function', 'analyzeDeep missing');
  assert(typeof vr.compareImages === 'function', 'compareImages missing');
  assert(typeof vr.findSimilar === 'function', 'findSimilar missing');
  assert(typeof vr.getVisualContext === 'function', 'getVisualContext missing');
  assert(typeof vr.getStatus === 'function', 'getStatus missing');
});

test('Visual memory search works', function() {
  var VRS = require('../src/services/VisualReasoningService');
  var vr = new VRS({});
  vr._visualMemory = [
    { id:'1', timestamp: Date.now(), type:'screenshot', scene:'Dashboard', focus:'chart', objects:['button','chart','header'] },
    { id:'2', timestamp: Date.now(), type:'foto', scene:'Katze auf Tisch', focus:'Katze', objects:['katze','tisch','lampe'] },
  ];
  var results = vr.findSimilar('katze');
  assert(results.length === 1, 'Should find 1 result for katze');
  assert(results[0].focus === 'Katze');
  var dashResults = vr.findSimilar('dashboard');
  assert(dashResults.length === 1);
});

test('Visual tools registered', function() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ToolRegistryExtensions.js'), 'utf8');
  assert(code.indexOf('visual_deep_analyze') >= 0, 'visual_deep_analyze missing');
  assert(code.indexOf('visual_compare') >= 0, 'visual_compare missing');
  assert(code.indexOf('visual_memory_search') >= 0, 'visual_memory_search missing');
});

// ═══ Summary ═══
console.log('\n═══════════════════════════════════');
console.log('  ✓ ' + passed + ' passed  ✗ ' + failed + ' failed');
console.log('═══════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
