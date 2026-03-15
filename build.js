/**
 * Johnny Build System — Optional JSX Transpilation
 *
 * Ermöglicht JSX-Syntax in View-Dateien statt React.createElement().
 *
 * Usage:
 *   node build.js          — Build für Produktion
 *   node build.js --watch  — Watch-Modus für Entwicklung
 *
 * HINWEIS: Johnny funktioniert auch OHNE Build-Step.
 * Die bestehenden React.createElement()-Dateien werden direkt geladen.
 * Dieser Build-Step ist NUR für neue Dateien die JSX nutzen wollen.
 *
 * Voraussetzung:
 *   npm install esbuild --save-dev
 */

const path = require('path');

async function build() {
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch {
    console.log('esbuild nicht installiert. Installiere mit:');
    console.log('  npm install esbuild --save-dev');
    console.log('');
    console.log('Johnny funktioniert auch ohne Build-Step (React.createElement).');
    process.exit(0);
  }

  const isWatch = process.argv.includes('--watch');

  const config = {
    entryPoints: [
      // Neue JSX-Views hier eintragen wenn sie erstellt werden
      // 'src/components/views-jsx/ChatView.jsx',
    ],
    bundle: false,       // Kein Bundling — nur JSX→JS Transpilation
    outdir: 'src/components/views-built',
    format: 'cjs',       // CommonJS für Electron
    platform: 'node',
    target: 'node18',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    logLevel: 'info',
  };

  if (config.entryPoints.length === 0) {
    console.log('Keine JSX-Dateien konfiguriert.');
    console.log('');
    console.log('So nutzt du JSX in Johnny:');
    console.log('  1. Erstelle neue View-Dateien als .jsx in src/components/views-jsx/');
    console.log('  2. Trage sie in build.js entryPoints ein');
    console.log('  3. node build.js → transpiliert nach src/components/views-built/');
    console.log('  4. Importiere in ViewRegistry.js aus views-built/');
    console.log('');
    console.log('Beispiel JSX-View:');
    console.log('  // src/components/views-jsx/ExampleView.jsx');
    console.log('  function viewExample() {');
    console.log('    return <div className="agent-card">');
    console.log('      <h2>Mein View</h2>');
    console.log('      <button onClick={() => ctx.actions.log("click")}>Klick</button>');
    console.log('    </div>;');
    console.log('  }');
    return;
  }

  if (isWatch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('Watching for JSX changes...');
  } else {
    await esbuild.build(config);
    console.log('Build complete.');
  }
}

build().catch(console.error);
