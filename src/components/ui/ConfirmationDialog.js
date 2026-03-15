/**
 * ConfirmationDialog — Security Bestätigungs-Popup
 *
 * Erscheint wenn Johnny eine kritische Aktion ausführen will:
 * execute_command, write_file, install_software, etc.
 *
 * Nutzt ipcRenderer (bereits global verfügbar im Renderer).
 */

function ConfirmationDialog() {
  var pendingState = React.useState(null); // { id, toolName, agentName, description, params }
  var pending = pendingState[0], setPending = pendingState[1];

  var TOOL_ICONS = {
    execute_command:  '⚡',
    write_file:       '📝',
    install_software: '📦',
    extend_code:      '🔧',
    create_tool:      '🛠️',
    modify_config:    '⚙️',
    delete_file:      '🗑️',
  };

  React.useEffect(function() {
    // FIX: preload.js strips event object — callback receives (data) directly
    function onRequest(data) {
      setPending(data);
    }
    var _api = window.johnny || window.ipcRenderer;
    if (_api) {
      _api.on('security:confirm-request', onRequest);
      return function() { _api.removeAllListeners('security:confirm-request'); };
    }
  }, []);

  function respond(approved) {
    if (!pending) return;
    var _api = window.johnny || window.ipcRenderer;
    if (_api) {
      _api.send('security:confirm-response', { confirmId: pending.id, approved: approved });
    }
    setPending(null);
  }

  if (!pending) return null;

  var e = React.createElement;
  var icon = TOOL_ICONS[pending.toolName] || '❓';

  // Params-Vorschau aufbereiten
  var paramsPreview = '';
  if (pending.params) {
    try {
      var p = pending.params;
      if (pending.toolName === 'execute_command') paramsPreview = p.command || '';
      else if (pending.toolName === 'write_file') paramsPreview = p.path + '\n' + (p.content || '').slice(0, 200);
      else if (pending.toolName === 'install_software') paramsPreview = (p.type || '') + ' install ' + (p.package || '');
      else paramsPreview = JSON.stringify(p, null, 2).slice(0, 300);
    } catch(_) {}
  }

  return e('div', {
    style: {
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 99999, backdropFilter: 'blur(4px)'
    }
  },
    e('div', {
      style: {
        background: '#1a1a1a', border: '1px solid #ff6b35',
        borderRadius: '12px', padding: '28px', maxWidth: '520px', width: '90%',
        boxShadow: '0 0 40px rgba(255,107,53,0.3)'
      }
    },
      // Header
      e('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' } },
        e('span', { style: { fontSize: '28px' } }, icon),
        e('div', null,
          e('div', { style: { color: '#ff6b35', fontWeight: 700, fontSize: '14px', fontFamily: 'monospace', letterSpacing: '1px' } }, 'SICHERHEITSABFRAGE'),
          e('div', { style: { color: '#ccc', fontSize: '13px' } }, pending.agentName + ' möchte folgendes ausführen:')
        )
      ),

      // Aktion
      e('div', {
        style: {
          background: '#111', border: '1px solid #333', borderRadius: '8px',
          padding: '12px 16px', marginBottom: '16px'
        }
      },
        e('div', { style: { color: '#fff', fontSize: '14px', marginBottom: paramsPreview ? '10px' : 0 } },
          pending.description
        ),
        paramsPreview && e('pre', {
          style: {
            color: '#aaa', fontSize: '11px', fontFamily: 'monospace', margin: 0,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '120px', overflow: 'auto'
          }
        }, paramsPreview)
      ),

      // Buttons
      e('div', { style: { display: 'flex', gap: '12px', justifyContent: 'flex-end' } },
        e('button', {
          onClick: function() { respond(false); },
          style: {
            background: '#2a2a2a', border: '1px solid #555', color: '#ccc',
            padding: '10px 24px', borderRadius: '8px', cursor: 'pointer',
            fontSize: '14px', fontFamily: 'monospace'
          }
        }, '✗  Ablehnen'),
        e('button', {
          onClick: function() { respond(true); },
          style: {
            background: '#ff6b35', border: 'none', color: '#fff',
            padding: '10px 24px', borderRadius: '8px', cursor: 'pointer',
            fontSize: '14px', fontFamily: 'monospace', fontWeight: 700
          }
        }, '✓  Erlauben')
      ),

      // Timeout-Hinweis
      e('div', {
        style: { color: '#555', fontSize: '11px', marginTop: '12px', textAlign: 'center', fontFamily: 'monospace' }
      }, 'Automatisch abgelehnt in 60 Sekunden.')
    )
  );
}

// Global verfügbar machen
if (typeof window !== 'undefined') window.ConfirmationDialog = ConfirmationDialog;
