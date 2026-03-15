// SetupWizard - pure React.createElement, no JSX, no Babel needed
// uses React and ipcRenderer from global scope

function SetupWizard({ onComplete }) {
  var stepState   = React.useState('welcome');
  var progState   = React.useState(0);
  var msgState    = React.useState('Starting Johnny...');

  var step = stepState[0], setStep = stepState[1];
  var prog = progState[0], setProg = progState[1];
  var msg  = msgState[0],  setMsg  = msgState[1];

  React.useEffect(function() {
    // FIX: preload.js strips event object — callback receives (data) directly
    (window.johnny || window.ipcRenderer).on('setup-status', function(d) {
      if (!d) return;
      setStep(d.step);
      setMsg(d.message || '');
      setProg(d.progress || 0);
      if (d.step === 'complete' || d.step === 'model-skipped' || d.step === 'ollama-failed') {
        setTimeout(function() { if (onComplete) onComplete(); }, 1200);
      }
    });
    return function() { (window.johnny || window.ipcRenderer).removeAllListeners('setup-status'); };
  }, []);

  var e = React.createElement;

  return e('div', {
    style: {
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: '#0a0a0a', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 10000
    }
  },
    e('div', { style: { textAlign: 'center', maxWidth: '480px', padding: '40px' } },
      e('div', { style: { fontSize: '56px', marginBottom: '20px' } }, '🤖'),
      e('h1', { style: { fontFamily: 'monospace', color: '#fff', marginBottom: '8px', fontSize: '28px' } }, 'JOHNNY'),
      e('div', { style: { color: '#666', fontSize: '13px', marginBottom: '36px', fontFamily: 'monospace' } }, 'AI ASSISTANT'),
      e('div', { style: { color: '#aaa', fontSize: '15px', marginBottom: '24px', minHeight: '22px' } }, msg),
      e('div', { style: { background: '#1a1a1a', borderRadius: '8px', height: '6px', overflow: 'hidden', marginBottom: '16px' } },
        e('div', { style: {
          width: prog + '%', height: '100%',
          background: 'linear-gradient(90deg, #00ff88, #00cc66)',
          transition: 'width 0.4s ease', borderRadius: '8px'
        }})
      ),
      e('div', { style: { color: '#555', fontSize: '12px', fontFamily: 'monospace' } }, prog + '% — ' + step)
    )
  );
}
