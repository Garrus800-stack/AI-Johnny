/**
 * ToolRegistry — alle Standard-Tools für Johnny
 *
 * Ausgelagert aus AgentManager.js (war ~1800 Zeilen inline).
 * AgentManager ruft registerAll(manager) beim Initialisieren auf.
 *
 * Neue Tools hinzufügen:
 *   Einfach hier eine neue toolRegistry.set()-Gruppe eintragen —
 *   AgentManager muss nicht angefasst werden.
 */

'use strict';

/**
 * registerAll — lädt alle Tools in die toolRegistry des AgentManager
 * @param {AgentManager} manager
 */
function registerAll(manager) {
  const toolRegistry = manager.toolRegistry;

  // ══════════════════════════════════════════════════════════════════════
  // STANDARD TOOLS (aus registerDefaultTools)
  // ══════════════════════════════════════════════════════════════════════

    // System Command Execution
    toolRegistry.set('execute_command', {
      name: 'execute_command',
      description: 'Führt einen System-Befehl aus. Gefährliche Befehle werden blockiert, kritische brauchen Bestätigung.',
      parameters: {
        command: 'string - Der auszuführende Befehl'
      },
      execute: async (params, agent, manager) => {
        const cmd = (params.command || '').trim();

        // ── 1. Denylist-Check ─────────────────────────────────────────
        if (manager && manager.security) {
          const check = manager.security.checkCommand(cmd);
          if (!check.allowed) {
            logger.warn('AgentManager', `execute_command blockiert: ${check.reason}`, { cmd: cmd.slice(0, 80) });
            return { error: `Befehl blockiert: ${check.reason}`, blocked: true, complete: true };
          }
        }

        // ── 2. Confirmation Gate ──────────────────────────────────────
        if (manager && manager.security) {
          const confirm = await manager.security.requestConfirmation('execute_command', params, agent && agent.name);
          if (!confirm.approved) {
            logger.info('AgentManager', `execute_command vom User abgelehnt: ${cmd.slice(0, 80)}`);
            return { error: 'Befehl vom User abgelehnt.', denied: true, complete: true };
          }
        }

        logger.info('AgentManager', `execute_command: ${cmd.slice(0, 100)}`);
        try {
          const { stdout, stderr } = await execAsync(cmd, {
            timeout: 120000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: false
          });
          return { stdout: stdout || '', stderr: stderr || '', complete: true };
        } catch (err) {
          return { stdout: err.stdout || '', stderr: err.stderr || err.message || '', exitCode: err.code, complete: true };
        }
      }
    });

    // File Operations
    toolRegistry.set('find_program', {
      name: 'find_program',
      description: 'Findet wo ein Programm/Paket installiert ist (which, where, pip show)',
      parameters: {
        program: 'string - Name des Programms oder Pakets (z.B. ffmpeg, python, whisper)'
      },
      execute: async (params) => {
        const prog = (params.program || '').replace(/[^a-zA-Z0-9._-]/g, '');  // Sanitize
        if (!prog) return { found: false, locations: [], complete: true };
        const cmds = [
          `where ${prog} 2>&1 || which ${prog} 2>&1`,
          `pip show ${prog} 2>&1 || pip3 show ${prog} 2>&1`,
          `${prog} --version 2>&1`,
          `python -c "import ${prog}; print(getattr(${prog},'__file__','imported ok'))" 2>&1`
        ];
        const results = [];
        for (const cmd of cmds) {
          try {
            const { stdout, stderr } = await execAsync(cmd, { timeout: 10000, maxBuffer: 1024*1024 });
            if (stdout && stdout.trim()) {
              results.push(stdout.trim());
              break;  // Frühes Beenden nach erstem Treffer
            }
          } catch (e) {
            if (e.stdout && e.stdout.trim()) {
              results.push(e.stdout.trim());
              break;  // Frühes Beenden nach erstem Treffer
            }
          }
        }
        return {
          program: prog,
          found: results.length > 0,
          locations: results,
          complete: true
        };
      }
    });

    toolRegistry.set('read_file', {
      name: 'read_file',
      description: 'Liest eine Datei',
      parameters: {
        path: 'string - Dateipfad'
      },
      execute: async (params, agent, manager) => {
        if (manager && manager.security) {
          const check = manager.security.checkPath(params.path);
          if (!check.allowed) return { error: `Zugriff verweigert: ${check.reason}`, complete: true };
        }
        const fileContent = await fs.readFile(params.path, 'utf-8');
        // Scan gelesenen Datei-Inhalt auf Injection
        const safeContent = (manager && manager.security)
          ? manager.security.wrapExternalContent(fileContent, `read_file:${params.path}`)
          : fileContent;
        return { content: safeContent, complete: true };
      }
    });

    toolRegistry.set('write_file', {
      name: 'write_file',
      description: 'Schreibt Inhalt in eine Datei',
      parameters: {
        path: 'string - Dateipfad',
        content: 'string - Inhalt'
      },
      execute: async (params, agent, manager) => {
        if (manager && manager.security) {
          const pathCheck = manager.security.checkPath(params.path);
          if (!pathCheck.allowed) return { error: `Schreiben verweigert: ${pathCheck.reason}`, complete: true };
          const confirm = await manager.security.requestConfirmation('write_file', params, agent && agent.name);
          if (!confirm.approved) return { error: 'Vom User abgelehnt.', denied: true, complete: true };
        }
        await fs.writeFile(params.path, params.content, 'utf-8');
        logger.info('AgentManager', `write_file: ${params.path} (${(params.content||'').length} Zeichen)`);
        return { success: true, complete: true };
      }
    });

    // ZIP erstellen — mehrere Dateien in ein Archiv
    toolRegistry.set('create_zip', {
      name: 'create_zip',
      description: 'Erstellt eine ZIP-Datei aus mehreren Dateien und gibt sie zum Download bereit. Nutze das wenn du ein vollständiges Projekt oder mehrere Dateien erstellt hast.',
      parameters: {
        files: 'array - [{name: "datei.js", content: "code..."}] — Liste der Dateien',
        zip_name: 'string - Name des ZIP-Archivs (ohne .zip)',
      },
      execute: async (params) => {
        try {
          const AdmZip = require('adm-zip');
          const zip = new AdmZip();
          const files = params.files || [];
          if (files.length === 0) return { error: 'Keine Dateien angegeben', complete: true };
          for (const f of files) {
            zip.addFile(f.name, Buffer.from(f.content || '', 'utf8'));
          }
          const os = require('os');
          const path = require('path');
          const outputDir = path.join(os.homedir(), 'Downloads', 'Johnny-Output');
          await fs.mkdir(outputDir, { recursive: true });
          const zipName = (params.zip_name || 'johnny-projekt').replace(/[/\\:*?"<>|]/g, '_');
          const zipPath = path.join(outputDir, zipName + '.zip');
          zip.writeZip(zipPath);
          logger.info('AgentManager', `create_zip: ${zipPath} (${files.length} Dateien)`);
          return {
            success: true,
            path: zipPath,
            file_count: files.length,
            message: `✓ ZIP erstellt: ${zipPath} (${files.length} Dateien)`,
            complete: true,
          };
        } catch (err) {
          return { error: 'ZIP-Fehler: ' + err.message, complete: true };
        }
      }
    });

    // Code-Review — analysiert Code auf Bugs und Verbesserungen
    toolRegistry.set('analyze_code', {
      name: 'analyze_code',
      description: 'Analysiert Code auf Bugs, Sicherheitsprobleme und Verbesserungsmöglichkeiten',
      parameters: {
        code: 'string - Der zu analysierende Code',
        filename: 'string - Dateiname (gibt Sprache/Kontext an)',
        focus: 'string - optional: "bugs" | "security" | "performance" | "all"',
      },
      execute: async (params, agent, manager) => {
        const focus = params.focus || 'all';
        const systemPrompt = `Du bist ein erfahrener Code-Reviewer. Analysiere den folgenden Code aus "${params.filename || 'code'}" auf:
${focus === 'all' || focus === 'bugs' ? '- Bugs und logische Fehler' : ''}
${focus === 'all' || focus === 'security' ? '- Sicherheitslücken' : ''}
${focus === 'all' || focus === 'performance' ? '- Performance-Probleme' : ''}
- Verbesserungsvorschläge

Antworte strukturiert mit: 🔴 Kritisch, 🟡 Warnung, 🟢 Verbesserung, ✅ OK
Halte die Antwort prägnant und actionable.`;
        try {
          const result = await manager.sendToModel(params.code, { systemPrompt, temperature: 0.3, maxTokens: 2000 });
          return { review: result, filename: params.filename, complete: true };
        } catch (err) {
          return { error: err.message, complete: true };
        }
      }
    });

    // Agent Creation
    toolRegistry.set('create_agent', {
      name: 'create_agent',
      description: 'Erstellt einen neuen Agenten',
      parameters: {
        name: 'string - Name des Agenten',
        role: 'string - Rolle',
        personality: 'string - Persönlichkeit',
        capabilities: 'array - Fähigkeiten'
      },
      execute: async (params, agent, manager) => {
        const newAgent = await manager.createAgent(params);
        return { 
          agent: newAgent,
          message: `Agent ${newAgent.name} created successfully`,
          complete: true 
        };
      }
    });

    // Memory
    toolRegistry.set('save_memory', {
      name: 'save_memory',
      description: 'Speichert eine Information im Gedächtnis',
      parameters: {
        content: 'string - Zu speichernde Information'
      },
      execute: async (params, agent, manager) => {
        agent.memory.push({
          content: params.content,
          timestamp: new Date().toISOString()
        });
        await manager.saveAgentMarkdown(agent);
        return { success: true, complete: true };
      }
    });

    // Agent-zu-Agent Kommunikation
    toolRegistry.set('communicate_with_agent', {
      name: 'communicate_with_agent',
      description: 'Kommuniziert mit einem anderen Agenten',
      parameters: {
        targetAgent: 'string - Name des Ziel-Agenten',
        message: 'string - Nachricht'
      },
      execute: async (params, agent, manager) => {
        const response = await manager.sendMessage(params.targetAgent, params.message);
        return {
          response: response.response,
          complete: true
        };
      }
    });

    // ==================== SELF-IMPROVEMENT TOOLS ====================

    // Software Installation
    toolRegistry.set('install_software', {
      name: 'install_software',
      description: 'Installiert Software oder Packages (npm, pip, apt, etc.)',
      parameters: {
        type: 'string - npm, pip, apt, winget, oder custom',
        package: 'string - Package Name',
        global: 'boolean - Global installieren (optional)'
      },
      execute: async (params) => {
        let command;
        switch (params.type) {
          case 'npm':
            command = params.global ? `npm install -g ${params.package}` : `npm install ${params.package}`;
            break;
          case 'pip':
            command = `pip install ${params.package} --break-system-packages`;
            break;
          case 'apt':
            command = `sudo apt-get install -y ${params.package}`;
            break;
          case 'winget':
            command = `winget install ${params.package}`;
            break;
          default:
            command = params.package; // Custom command
        }

        // ── Confirmation Gate ─────────────────────────────────────────
        if (typeof manager !== 'undefined' && manager && manager.security) {
          const confirm = await manager.security.requestConfirmation('install_software', params, 'Johnny');
          if (!confirm.approved) {
            return { error: 'Installation vom User abgelehnt.', denied: true, complete: true };
          }
        }
        logger.info('AgentManager', `install_software: ${command}`);
        const { stdout, stderr } = await execAsync(command, { timeout: 120000 });
        return {
          success: !stderr.toLowerCase().includes('error'),
          output: stdout,
          errors: stderr,
          complete: true
        };
      }
    });

    // Code Extension
    toolRegistry.set('extend_code', {
      name: 'extend_code',
      description: 'Erweitert existierenden Code durch Hinzufügen neuer Funktionen',
      parameters: {
        filepath: 'string - Pfad zur Datei',
        code: 'string - Hinzuzufügender Code',
        position: 'string - before_end, after_imports, oder custom'
      },
      execute: async (params) => {
        const content = await fs.readFile(params.filepath, 'utf-8');
        let newContent;

        if (params.position === 'before_end') {
          // Vor dem Ende der Datei einfügen
          newContent = content.trimEnd() + '\n\n' + params.code + '\n';
        } else if (params.position === 'after_imports') {
          // Nach Imports einfügen
          const lines = content.split('\n');
          let insertIndex = 0;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('const ') || lines[i].startsWith('import ')) {
              insertIndex = i + 1;
            } else if (insertIndex > 0 && !lines[i].startsWith('const ') && !lines[i].startsWith('import ')) {
              break;
            }
          }
          lines.splice(insertIndex, 0, '', params.code);
          newContent = lines.join('\n');
        } else {
          // Custom position
          newContent = content + '\n' + params.code;
        }

        await fs.writeFile(params.filepath, newContent, 'utf-8');
        
        return {
          success: true,
          filepath: params.filepath,
          message: 'Code erfolgreich erweitert',
          complete: true
        };
      }
    });

    // Tool Creation
    toolRegistry.set('create_tool', {
      name: 'create_tool',
      description: 'Erstellt ein neues Tool das der Agent nutzen kann',
      parameters: {
        name: 'string - Tool Name',
        description: 'string - Beschreibung',
        code: 'string - JavaScript Code für execute Funktion',
        parameters: 'object - Parameter-Definition'
      },
      execute: async (params, agent, manager) => {
        // Erstelle neues Tool
        const safeName = (params.name || '').replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeDesc = (params.description || '').replace(/'/g, "\\'").replace(/\\/g, '\\\\');
        const toolCode = `
module.exports = {
  name: '${safeName}',
  description: '${safeDesc}',
  parameters: ${JSON.stringify(params.parameters || {})},
  
  execute: async (toolParams, agent, manager) => {
    ${params.code}
  }
};`;

        const toolPath = path.join(manager.agentsDir, '..', 'custom-tools', `${params.name}.js`);
        await fs.mkdir(path.dirname(toolPath), { recursive: true });
        await fs.writeFile(toolPath, toolCode, 'utf-8');

        // Registriere Tool dynamisch
        delete require.cache[require.resolve(toolPath)];
        const tool = require(toolPath);
        manager.toolRegistry.set(params.name, tool);

        return {
          success: true,
          toolName: params.name,
          message: `Tool ${params.name} erstellt und registriert`,
          complete: true
        };
      }
    });

    // Config Modification
    toolRegistry.set('modify_config', {
      name: 'modify_config',
      description: 'Ändert Konfigurations-Einstellungen',
      parameters: {
        key: 'string - Config Key',
        value: 'any - Neuer Wert'
      },
      execute: async (params, agent, manager) => {
        // Electron-store nutzen wenn verfügbar
        try {
          const Store = require('electron-store');
          const store = new Store();
          store.set(params.key, params.value);
          console.log(`Config updated: ${params.key} = ${JSON.stringify(params.value)}`);
        } catch {
          console.log(`Config update (nicht persistiert): ${params.key} = ${params.value}`);
        }
        
        return {
          success: true,
          key: params.key,
          value: params.value,
          complete: true
        };
      }
    });

    // ==================== BROWSER AUTOMATION ====================

    toolRegistry.set('browser_navigate', {
      name: 'browser_navigate',
      description: 'Navigiert zu einer URL und macht Screenshot',
      parameters: {
        url: 'string - URL to navigate to'
      },
      execute: async (params, agent, manager) => {
        if (!manager.browserService) {
          return { error: 'Browser service not available', complete: true };
        }
        const result = await manager.browserService.navigateAndCapture(params.url);
        return { ...result, complete: true };
      }
    });

    toolRegistry.set('browser_click', {
      name: 'browser_click',
      description: 'Klickt auf ein Element auf einer Webseite',
      parameters: {
        url: 'string - URL',
        selector: 'string - CSS Selector'
      },
      execute: async (params, agent, manager) => {
        if (!manager.browserService) {
          return { error: 'Browser service not available', complete: true };
        }
        const result = await manager.browserService.clickElement(params.url, params.selector);
        return { ...result, complete: true };
      }
    });

    toolRegistry.set('browser_extract', {
      name: 'browser_extract',
      description: 'Extrahiert Daten von einer Webseite',
      parameters: {
        url: 'string - URL',
        selectors: 'object - Key-value pairs of data to extract'
      },
      execute: async (params, agent, manager) => {
        if (!manager.browserService) {
          return { error: 'Browser service not available', complete: true };
        }
        const result = await manager.browserService.extractData(params.url, params.selectors);
        return { ...result, complete: true };
      }
    });

    // ==================== VISION ====================

    toolRegistry.set('analyze_screenshot', {
      name: 'analyze_screenshot',
      description: 'Analysiert einen Screenshot mit Vision Model',
      parameters: {
        screenshotPath: 'string - Path to screenshot',
        prompt: 'string - What to analyze'
      },
      execute: async (params, agent, manager) => {
        if (!manager.visionService) {
          return { error: 'Vision service not available', complete: true };
        }
        const result = await manager.visionService.analyzeImage(
          params.screenshotPath,
          params.prompt
        );
        return { ...result, complete: true };
      }
    });

    toolRegistry.set('describe_image', {
      name: 'describe_image',
      description: 'Beschreibt ein Bild oder Screenshot',
      parameters: {
        imagePath: 'string - Path to image'
      },
      execute: async (params, agent, manager) => {
        if (!manager.visionService) {
          return { error: 'Vision service not available', complete: true };
        }
        const result = await manager.visionService.describeScreenshot(params.imagePath);
        return { ...result, complete: true };
      }
    });

    // ==================== WEB SEARCH ====================

    toolRegistry.set('web_search', {
      name: 'web_search',
      description: 'Sucht im Internet nach Informationen',
      parameters: {
        query: 'string - Search query',
        limit: 'number - Number of results (optional, default 10)'
      },
      execute: async (params, agent, manager) => {
        if (!manager.searchService) {
          return { error: 'Search service not available', complete: true };
        }
        const result = await manager.searchService.search(
          params.query,
          { limit: params.limit || 10 }
        );
        return { ...result, complete: true };
      }
    });

    toolRegistry.set('web_research', {
      name: 'web_research',
      description: 'Recherchiert ein Thema ausführlich',
      parameters: {
        topic: 'string - Topic to research',
        depth: 'number - Research depth (optional, default 3)'
      },
      execute: async (params, agent, manager) => {
        if (!manager.searchService) {
          return { error: 'Search service not available', complete: true };
        }
        const result = await manager.searchService.research(
          params.topic,
          params.depth || 3
        );
        return { ...result, complete: true };
      }
    });

    // ==================== MULTI-LANGUAGE CODE EXECUTION ====================

    toolRegistry.set('run_code', {
      name: 'run_code',
      description: 'Execute code safely in Python, JavaScript, C++, Bash, PowerShell. Uses sandbox when available.',
      parameters: {
        language: 'string - python, javascript, cpp, bash, powershell',
        code: 'string - The code to execute'
      },
      execute: async (params, agent, manager) => {
        // Bevorzuge SandboxService wenn verfügbar
        if (manager && manager.sandboxService) {
          const result = await manager.sandboxService.runCode(params.language, params.code);
          return result;
        }

        // Fallback: direkt ausführen (alter Code-Pfad)
        const { language, code } = params;
        const tmpDir = path.join(require('os').tmpdir(), 'johnny-code');
        await fs.mkdir(tmpDir, { recursive: true });

        let cmd, filename;
        switch (language.toLowerCase()) {
          case 'python': case 'py':
            filename = path.join(tmpDir, `run_${Date.now()}.py`);
            await fs.writeFile(filename, code);
            cmd = `python "${filename}"`;
            break;
          case 'javascript': case 'js': case 'node':
            filename = path.join(tmpDir, `run_${Date.now()}.js`);
            await fs.writeFile(filename, code);
            cmd = `node "${filename}"`;
            break;
          case 'bash': case 'sh':
            filename = path.join(tmpDir, `run_${Date.now()}.sh`);
            await fs.writeFile(filename, code);
            cmd = `bash "${filename}"`;
            break;
          case 'powershell': case 'ps1':
            filename = path.join(tmpDir, `run_${Date.now()}.ps1`);
            await fs.writeFile(filename, code);
            cmd = `powershell -ExecutionPolicy Bypass -File "${filename}"`;
            break;
          default:
            return { error: `Unknown language: ${language}`, complete: true };
        }
        try {
          const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
          return { output: stdout, errors: stderr, sandboxMode: 'none', complete: true };
        } catch (e) {
          return { error: e.message, output: e.stdout || '', sandboxMode: 'none', complete: true };
        }
      }
    });

    toolRegistry.set('save_and_run', {
      name: 'save_and_run',
      description: 'Save code to a file and optionally run it',
      parameters: {
        filepath: 'string - Full path to save the file',
        code: 'string - Code content',
        run: 'boolean - Whether to also execute the file',
        language: 'string - Language for execution (optional)'
      },
      execute: async (params) => {
        await fs.mkdir(path.dirname(params.filepath), { recursive: true });
        await fs.writeFile(params.filepath, params.code, 'utf-8');
        let result = { saved: params.filepath, complete: true };
        if (params.run) {
          const ext = path.extname(params.filepath).slice(1);
          const lang = params.language || ext;
          const toolResult = await this.toolRegistry.get('run_code').execute({ language: lang, code: params.code });
          result = { ...result, ...toolResult };
        }
        return result;
      }
    });

    // ==================== ENHANCED FILE TOOLS ====================

    toolRegistry.set('list_directory', {
      name: 'list_directory',
      description: 'List contents of a directory',
      parameters: { path: 'string - Directory path' },
      execute: async (params) => {
        try {
          const entries = await fs.readdir(params.path, { withFileTypes: true });
          const files = entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
          return { path: params.path, files, count: files.length, complete: true };
        } catch(e) { return { error: e.message, complete: true }; }
      }
    });

    toolRegistry.set('open_file_or_folder', {
      name: 'open_file_or_folder',
      description: 'Open a file or folder in the OS default app or explorer',
      parameters: { path: 'string - Path to open' },
      execute: async (params) => {
        const p = params.path.replace(/"/g, '');
        const platform = require('os').platform();
        let cmd;
        if (platform === 'win32') cmd = `explorer "${p}"`;
        else if (platform === 'darwin') cmd = `open "${p}"`;
        else cmd = `xdg-open "${p}"`;
        try {
          exec(cmd);
          return { opened: p, complete: true };
        } catch(e) { return { error: e.message, complete: true }; }
      }
    });

    toolRegistry.set('download_file', {
      name: 'download_file',
      description: 'Download a file from URL to local path',
      parameters: { url: 'string - URL to download', destination: 'string - Local path to save' },
      execute: async (params) => {
        const { default: axios } = await Promise.resolve().then(() => require('axios'));
        const response = await axios.get(params.url, { responseType: 'arraybuffer' });
        await fs.mkdir(path.dirname(params.destination), { recursive: true });
        await fs.writeFile(params.destination, response.data);
        return { saved: params.destination, size: response.data.length, complete: true };
      }
    });

    toolRegistry.set('install_npm_package', {
      name: 'install_npm_package',
      description: 'Install an npm package globally or locally',
      parameters: {
        package: 'string - Package name',
        global: 'boolean - Install globally (default false)'
      },
      execute: async (params) => {
        const cmd = params.global ? `npm install -g ${params.package}` : `npm install ${params.package}`;
        try {
          const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
          return { success: true, output: stdout, complete: true };
        } catch(e) { return { error: e.message, complete: true }; }
      }
    });

    toolRegistry.set('install_pip_package', {
      name: 'install_pip_package',
      description: 'Install a Python pip package',
      parameters: { package: 'string - Package name' },
      execute: async (params) => {
        try {
          const { stdout } = await execAsync(`pip install ${params.package} --break-system-packages`, { timeout: 120000 });
          return { success: true, output: stdout, complete: true };
        } catch(e) { return { error: e.message, complete: true }; }
      }
    });

    toolRegistry.set('get_clipboard', {
      name: 'get_clipboard',
      description: 'Get current clipboard content',
      parameters: {},
      execute: async () => {
        try {
          const { clipboard } = require('electron');
          return { content: clipboard.readText(), complete: true };
        } catch(e) { return { error: e.message, complete: true }; }
      }
    });

    toolRegistry.set('set_clipboard', {
      name: 'set_clipboard',
      description: 'Set clipboard content',
      parameters: { content: 'string - Content to copy' },
      execute: async (params) => {
        try {
          const { clipboard } = require('electron');
          clipboard.writeText(params.content);
          return { success: true, complete: true };
        } catch(e) { return { error: e.message, complete: true }; }
      }
    });

    // ==================== PLUGIN MARKETPLACE ====================

    toolRegistry.set('install_plugin', {
      name: 'install_plugin',
      description: 'Install a plugin from a URL (npm package or git repo)',
      parameters: {
        url: 'string - Plugin URL or npm package name',
        name: 'string - Plugin name (optional)'
      },
      execute: async (params, agent, manager) => {
        if (manager.pluginManager) {
          return await manager.pluginManager.installPlugin(params.url);
        }
        return { error: 'Plugin manager not available', complete: true };
      }
    });

    // ==================== HTTP / API TOOLS ====================

    toolRegistry.set('http_request', {
      name: 'http_request',
      description: 'Make an HTTP request to any URL or API',
      parameters: {
        method: 'string - GET, POST, PUT, DELETE',
        url: 'string - URL',
        headers: 'object - HTTP headers (optional)',
        body: 'any - Request body (optional)'
      },
      execute: async (params) => {
        const { default: axios } = await Promise.resolve().then(() => require('axios'));
        const response = await axios({
          method: params.method || 'GET',
          url: params.url,
          headers: params.headers || {},
          data: params.body,
          timeout: 30000
        });
        return { status: response.status, data: response.data, complete: true };
      }
    });

    // ==================== WEB FETCH ====================

    toolRegistry.set('web_fetch', {
      name: 'web_fetch',
      description: 'Fetches the full text content of a web page URL',
      parameters: {
        url: 'string - URL to fetch'
      },
      execute: async (params, agent, manager) => {
        if (manager.searchService) {
          const result = await manager.searchService.fetchPage(params.url);
          // ── Injection-Scan auf Seiteninhalt ──────────────────────────
          if (manager.security && result.text) {
            result.text = manager.security.wrapExternalContent(result.text, `web_fetch:${params.url}`);
          }
          return { ...result, complete: true };
        }
        // Fallback: direct fetch
        const axios = require('axios');
        const cheerio = require('cheerio');
        const response = await axios.get(params.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 15000
        });
        const $ = cheerio.load(response.data);
        $('script, style, nav, footer, header').remove();
        let text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 12000);
        // ── Injection-Scan ────────────────────────────────────────────
        if (manager.security) {
          text = manager.security.wrapExternalContent(text, `web_fetch:${params.url}`);
        }
        return { success: true, url: params.url, title: $('title').text(), text, complete: true };
      }
    });

    // ==================== IMAGE GENERATION (Tool) ====================

    toolRegistry.set('generate_image', {
      name: 'generate_image',
      description: 'Generates an image from a text prompt using DALL-E 3 or Stable Diffusion',
      parameters: {
        prompt: 'string - Image description',
        provider: 'string - openai, replicate, or stable-diffusion (optional)',
        size: 'string - e.g. 1024x1024 (optional)'
      },
      execute: async (params, agent, manager) => {
        if (!manager.imageGenService) return { error: 'Image generation service not available', complete: true };
        const result = await manager.imageGenService.generate({
          prompt: params.prompt,
          provider: params.provider,
          size: params.size || '1024x1024'
        });
        return { ...result, complete: true };
      }
    });

    // ==================== VIDEO ANALYSIS (Tool) ====================

    toolRegistry.set('analyze_video', {
      name: 'analyze_video',
      description: 'Analyzes a video file (extracts frames, transcribes audio, generates summary)',
      parameters: {
        videoPath: 'string - Path to video file',
        prompt: 'string - What to analyze (optional)',
        maxFrames: 'number - Max frames to extract (optional, default 8)'
      },
      execute: async (params, agent, manager) => {
        if (!manager.videoService) return { error: 'Video analysis service not available', complete: true };
        const result = await manager.videoService.analyze(params.videoPath, {
          prompt: params.prompt,
          maxFrames: params.maxFrames
        });
        return { ...result, complete: true };
      }
    });

    // ==================== SCHEDULE TASK (via node-cron) ====================

    toolRegistry.set('schedule_task', {
      name: 'schedule_task',
      description: 'Schedule a recurring task (cron syntax). Examples: "*/5 * * * *" (every 5 min), "0 9 * * 1-5" (9 AM weekdays)',
      parameters: {
        name: 'string - Task name',
        cron: 'string - Cron expression',
        command: 'string - Command or message to execute',
        type: 'string - "command" (run system cmd) or "message" (send to agent, default)'
      },
      execute: async (params, agent, manager) => {
        try {
          const cron = require('node-cron');
          if (!cron.validate(params.cron)) {
            return { error: 'Invalid cron expression: ' + params.cron, complete: true };
          }
          if (!manager._scheduledTasks) manager._scheduledTasks = new Map();
          const taskId = params.name.toLowerCase().replace(/\s/g, '_') + '_' + Date.now();
          const task = cron.schedule(params.cron, async () => {
            console.log(`[Scheduler] Running task: ${params.name}`);
            try {
              if (params.type === 'command') {
                await execAsync(params.command, { timeout: 120000 });
              } else {
                await manager.sendMessage(agent.name, params.command);
              }
            } catch (e) {
              console.error(`[Scheduler] Task ${params.name} failed:`, e.message);
            }
          });
          manager._scheduledTasks.set(taskId, { task, name: params.name, cron: params.cron, command: params.command });
          return { success: true, taskId, message: `Task "${params.name}" scheduled (${params.cron})`, complete: true };
        } catch (e) {
          return { error: 'node-cron not available: ' + e.message, complete: true };
        }
      }
    });

    toolRegistry.set('list_scheduled_tasks', {
      name: 'list_scheduled_tasks',
      description: 'List all scheduled tasks',
      parameters: {},
      execute: async (params, agent, manager) => {
        if (!manager._scheduledTasks) return { tasks: [], complete: true };
        const tasks = [];
        manager._scheduledTasks.forEach((v, k) => tasks.push({ id: k, name: v.name, cron: v.cron, command: v.command }));
        return { tasks, complete: true };
      }
    });

    toolRegistry.set('cancel_scheduled_task', {
      name: 'cancel_scheduled_task',
      description: 'Cancel a scheduled task by its ID',
      parameters: { taskId: 'string - Task ID to cancel' },
      execute: async (params, agent, manager) => {
        if (!manager._scheduledTasks || !manager._scheduledTasks.has(params.taskId)) {
          return { error: 'Task not found', complete: true };
        }
        manager._scheduledTasks.get(params.taskId).task.stop();
        manager._scheduledTasks.delete(params.taskId);
        return { success: true, message: 'Task cancelled', complete: true };
      }
    });

    // ==================== SYSTEM TOOLS ====================

    toolRegistry.set('get_system_info', {
      name: 'get_system_info',
      description: 'Get system information (OS, memory, CPU, etc.)',
      parameters: {},
      execute: async () => {
        const os = require('os');
        return {
          platform: os.platform(),
          arch: os.arch(),
          hostname: os.hostname(),
          username: os.userInfo().username,
          homeDir: os.homedir(),
          totalMem: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
          freeMem: Math.round(os.freemem() / 1024 / 1024 / 1024) + 'GB',
          cpus: os.cpus().length,
          complete: true
        };
      }
    });

    toolRegistry.set('get_env', {
      name: 'get_env',
      description: 'Get environment variable',
      parameters: { name: 'string - Variable name' },
      execute: async (params) => ({
        name: params.name,
        value: process.env[params.name] || null,
        complete: true
      })
    });

    toolRegistry.set('notify', {
      name: 'notify',
      description: 'Show a desktop notification to the user',
      parameters: {
        title: 'string - Notification title',
        message: 'string - Notification body'
      },
      execute: async (params, agent, manager) => {
        try {
          const { Notification } = require('electron');
          new Notification({ title: params.title, body: params.message }).show();
          return { sent: true, complete: true };
        } catch(e) { return { error: e.message, complete: true }; }
      }
    });

    // ==================== COMPUTER USE LOOP (Browser + Vision kombiniert) ====================

    toolRegistry.set('computer_use', {
      name: 'computer_use',
      description: 'Navigiert im Browser, macht Screenshots und analysiert sie mit Vision – alles in einem autonomen Loop. Ideal für Web-Formulare, Scraping mit visueller Verifikation, GUI-Bedienung.',
      parameters: {
        url: 'string - Start-URL',
        goal: 'string - Was soll erreicht werden?',
        actions: 'array (optional) - Vordefinierte Aktionen [{type: click|fill|wait, selector, value}]',
        maxSteps: 'number (optional) - Max. Schritte, default 5'
      },
      execute: async (params, agent, manager) => {
        if (!manager.browserService || !manager.visionService) {
          return { error: 'computer_use requires both browserService and visionService', complete: true };
        }

        const maxSteps = params.maxSteps || 5;
        const log = [];
        let currentUrl = params.url;

        if (this.stepEmitter) this.stepEmitter({ type: 'think', message: `🖥️ Computer Use: ${params.goal}` });

        for (let step = 1; step <= maxSteps; step++) {
          try {
            // 1. Screenshot + Navigation
            const navResult = await manager.browserService.navigateAndCapture(currentUrl);
            log.push({ step, action: 'navigate', url: currentUrl, screenshot: navResult.screenshotPath });

            if (!navResult.screenshotPath) break;

            // 2. Vision analysiert Screenshot
            const visionResult = await manager.visionService.analyzeImage(
              navResult.screenshotPath,
              `Goal: "${params.goal}"\nCurrent step: ${step}/${maxSteps}\n\n` +
              `Analyze this screenshot. Describe what you see, whether the goal is achieved, ` +
              `and what CSS selector to interact with next (if any). ` +
              `Reply as JSON: { "achieved": bool, "description": string, "nextAction": { "type": "click|fill|none", "selector": string, "value": string } }`
            );

            let visionData;
            try {
              const jsonMatch = (visionResult.analysis || visionResult.description || visionResult.text || '').match(/\{[\s\S]*\}/);
              visionData = jsonMatch ? JSON.parse(jsonMatch[0]) : { achieved: false, nextAction: { type: 'none' } };
            } catch {
              visionData = { achieved: false, nextAction: { type: 'none' } };
            }

            log.push({ step, vision: visionData });
            if (this.stepEmitter) this.stepEmitter({ type: 'done', message: `👁️ Step ${step}: ${visionData.description || 'analyzed'}` });

            // 3. Ziel erreicht?
            if (visionData.achieved) {
              return { success: true, steps: log, message: `Goal achieved in ${step} steps`, complete: true };
            }

            // 4. Nächste Aktion ausführen
            if (visionData.nextAction && visionData.nextAction.type !== 'none') {
              const { type, selector, value } = visionData.nextAction;
              if (type === 'click' && selector) {
                await manager.browserService.clickElement(currentUrl, selector);
                log.push({ step, action: 'click', selector });
              } else if (type === 'fill' && selector) {
                await manager.browserService.fillForm(currentUrl, { [selector]: value });
                log.push({ step, action: 'fill', selector, value });
              }
            } else {
              // Keine weiteren Aktionen möglich
              break;
            }
          } catch (e) {
            log.push({ step, error: e.message });
            if (this.stepEmitter) this.stepEmitter({ type: 'error', message: `Step ${step} failed: ${e.message}` });
            break;
          }
        }

        return { success: false, steps: log, message: `Goal not fully achieved after ${maxSteps} steps`, complete: true };
      }
    });

    // ==================== RAG TOOLS ====================

    toolRegistry.set('remember', {
      name: 'remember',
      description: 'Speichert Wissen im Langzeit-Gedächtnis (RAG)',
      parameters: {
        topic: 'string - Topic',
        content: 'string - Content to remember'
      },
      execute: async (params, agent, manager) => {
        if (!manager.ragService) {
          return { error: 'RAG service not available', complete: true };
        }
        const result = await manager.ragService.addKnowledge(
          params.topic,
          params.content
        );
        return { ...result, complete: true };
      }
    });

    toolRegistry.set('recall', {
      name: 'recall',
      description: 'Sucht in Langzeit-Gedächtnis nach relevanten Informationen',
      parameters: {
        query: 'string - What to recall'
      },
      execute: async (params, agent, manager) => {
        if (!manager.ragService) {
          return { error: 'RAG service not available', complete: true };
        }
        const result = await manager.ragService.searchKnowledge(params.query);
        return { ...result, complete: true };
      }
    });

    // ==================== SMART HOME TOOLS ====================

    toolRegistry.set('smart_home', {
      name: 'smart_home',
      description: 'Steuere Smart-Home-Geräte (Licht, Thermostat, Szenen). Unterstützt Home Assistant und Philips Hue.',
      parameters: {
        action: 'string - turn_on, turn_off, toggle, set_light, set_climate, scene, list',
        entityId: 'string - Entity-ID (z.B. light.wohnzimmer) oder Szenen-Name',
        brightness: 'number - Helligkeit 0-100 (optional)',
        temperature: 'number - Temperatur in °C (optional)',
        color: 'array - RGB-Farbe [r,g,b] (optional)'
      },
      execute: async (params, agent, manager) => {
        if (!manager.smartHomeService) return { error: 'Smart Home not configured', complete: true };
        try {
          if (params.action === 'list') return { devices: manager.smartHomeService.getDevices(params.entityId), complete: true };
          if (params.action === 'turn_on') return { ...await manager.smartHomeService.turnOn(params.entityId, params), complete: true };
          if (params.action === 'turn_off') return { ...await manager.smartHomeService.turnOff(params.entityId), complete: true };
          if (params.action === 'toggle') return { ...await manager.smartHomeService.toggle(params.entityId), complete: true };
          if (params.action === 'set_light') return { ...await manager.smartHomeService.setLight(params.entityId, params.brightness, params.color), complete: true };
          if (params.action === 'set_climate') return { ...await manager.smartHomeService.setClimate(params.entityId, params.temperature), complete: true };
          if (params.action === 'scene') return { ...await manager.smartHomeService.executeScene(params.entityId), complete: true };
          return { error: 'Unknown action: ' + params.action, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ==================== SPOTIFY TOOLS ====================

    toolRegistry.set('spotify', {
      name: 'spotify',
      description: 'Spotify-Kontrolle: Suche Songs, spiele Musik, zeige aktuellen Track',
      parameters: {
        action: 'string - search, now_playing',
        query: 'string - Suchbegriff (für search)',
        type: 'string - track, artist, album (optional, default: track)'
      },
      execute: async (params, agent, manager) => {
        if (!manager.integrationsService) return { error: 'Integrations not configured', complete: true };
        try {
          if (params.action === 'search') return { results: await manager.integrationsService.spotifySearch(params.query, params.type), complete: true };
          if (params.action === 'now_playing') return { ...await manager.integrationsService.spotifyNowPlaying(params.userToken), complete: true };
          return { error: 'Unknown spotify action', complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ==================== CALENDAR TOOLS ====================

    toolRegistry.set('calendar', {
      name: 'calendar',
      description: 'Google Calendar: Termine anzeigen und erstellen',
      parameters: {
        action: 'string - list, create',
        days: 'number - Anzahl Tage vorausschauen (für list, default 7)',
        title: 'string - Termin-Titel (für create)',
        start: 'string - Startzeit ISO (für create)',
        end: 'string - Endzeit ISO (für create)',
        description: 'string - Beschreibung (optional)'
      },
      execute: async (params, agent, manager) => {
        if (!manager.integrationsService) return { error: 'Integrations not configured', complete: true };
        try {
          if (params.action === 'list') return { events: await manager.integrationsService.calendarEvents('primary', params.days || 7), complete: true };
          if (params.action === 'create') return { event: await manager.integrationsService.calendarCreateEvent(params), complete: true };
          return { error: 'Unknown calendar action', complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ==================== GITHUB TOOLS ====================

    toolRegistry.set('github', {
      name: 'github',
      description: 'GitHub: Repos, Issues, Pull Requests, Actions, Notifications',
      parameters: {
        action: 'string - repos, issues, create_issue, prs, workflows, trigger_workflow, notifications',
        repo: 'string - Repository (owner/name)',
        title: 'string - Issue title (für create_issue)',
        body: 'string - Issue body (für create_issue)',
        workflowId: 'string - Workflow ID (für trigger_workflow)'
      },
      execute: async (params, agent, manager) => {
        if (!manager.integrationsService) return { error: 'Integrations not configured', complete: true };
        try {
          switch (params.action) {
            case 'repos': return { repos: await manager.integrationsService.ghListRepos(), complete: true };
            case 'issues': return { issues: await manager.integrationsService.ghListIssues(params.repo), complete: true };
            case 'create_issue': return { issue: await manager.integrationsService.ghCreateIssue(params.repo, params.title, params.body), complete: true };
            case 'prs': return { prs: await manager.integrationsService.ghListPRs(params.repo), complete: true };
            case 'workflows': return { workflows: await manager.integrationsService.ghListWorkflows(params.repo), complete: true };
            case 'trigger_workflow': return { ...await manager.integrationsService.ghTriggerWorkflow(params.repo, params.workflowId), complete: true };
            case 'notifications': return { notifications: await manager.integrationsService.ghGetNotifications(), complete: true };
            default: return { error: 'Unknown github action', complete: true };
          }
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ==================== CDP BROWSER TOOLS ====================

    toolRegistry.set('browser_live', {
      name: 'browser_live',
      description: 'Live-Browser-Kontrolle via Chrome DevTools Protocol. Steuert den echten Chrome-Browser (nicht headless).',
      parameters: {
        action: 'string - navigate, screenshot, content, click, type, eval, tabs, page_info, pdf',
        url: 'string - URL (für navigate)',
        selector: 'string - CSS Selector (für click/type)',
        text: 'string - Text (für type)',
        expression: 'string - JS Code (für eval)',
        tabId: 'string - Tab ID (optional)'
      },
      execute: async (params, agent, manager) => {
        if (!manager.cdpBrowserService || !manager.cdpBrowserService.connected) {
          return { error: 'CDP Browser not connected. Start Chrome with --remote-debugging-port=9222', complete: true };
        }
        try {
          switch (params.action) {
            case 'navigate': await manager.cdpBrowserService.navigate(params.url, params.tabId); return { success: true, url: params.url, complete: true };
            case 'screenshot': return { ...await manager.cdpBrowserService.screenshot(params.tabId), complete: true };
            case 'content': return { ...await manager.cdpBrowserService.getPageContent(params.tabId), complete: true };
            case 'click': return { result: await manager.cdpBrowserService.click(params.selector, params.tabId), complete: true };
            case 'type': return { result: await manager.cdpBrowserService.type(params.selector, params.text, params.tabId), complete: true };
            case 'eval': return { result: await manager.cdpBrowserService.evaluateJS(params.expression, params.tabId), complete: true };
            case 'tabs': return { tabs: await manager.cdpBrowserService.getTabs(), complete: true };
            case 'page_info': return { ...await manager.cdpBrowserService.getPageInfo(params.tabId), complete: true };
            case 'pdf': return { ...await manager.cdpBrowserService.generatePDF(params.tabId), complete: true };
            default: return { error: 'Unknown browser action', complete: true };
          }
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ==================== SWARM TOOL ====================

    toolRegistry.set('swarm', {
      name: 'swarm',
      description: 'Starte einen Agent-Swarm: Mehrere Agenten arbeiten parallel an Teilaufgaben. Ideal für Research, Brainstorming, Code-Reviews.',
      parameters: {
        goal: 'string - Was soll der Swarm erreichen?',
        type: 'string - research, brainstorm, pipeline, custom (optional)',
        agents: 'array - Welche Agenten sollen mitmachen (optional, default: alle)'
      },
      execute: async (params, agent, manager) => {
        if (!manager.swarmService) return { error: 'Swarm service not available', complete: true };
        try {
          const result = await manager.swarmService.runSwarm({
            goal: params.goal,
            type: params.type || 'research',
            agents: params.agents || []
          });
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });


  // ══════════════════════════════════════════════════════════════════════════
  // JOHNNY'S CODE-SELF-MODIFICATION TOOLS
  // Lesen → Backup → Sandbox-Test → Anwenden → Rollback
  // ══════════════════════════════════════════════════════════════════════════


  // ══════════════════════════════════════════════════════════════════════
  // SELF-IMPROVEMENT TOOLS (aus _registerSelfImprovementTools)
  // ══════════════════════════════════════════════════════════════════════

    const svc = () => this.selfImprovementService;

    // ── Eigenen Code lesen ───────────────────────────────────────────────────
    toolRegistry.set('read_own_code', {
      name: 'read_own_code',
      description: 'Liest eine Datei aus Johnnys eigenem Quellcode. Zeigt Inhalt, Zeilenzahl und Code-Struktur.',
      parameters: {
        path: 'string - Relativer Pfad z.B. "src/services/AgentManager.js" oder "main.js"'
      },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          const result = await svc().readOwnFile(params.path);
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ── Eigene Dateien auflisten ─────────────────────────────────────────────
    toolRegistry.set('list_own_files', {
      name: 'list_own_files',
      description: 'Listet Johnnys eigene Source-Dateien auf (mit Größe, Zeilen, Datum).',
      parameters: {
        directory: 'string - Verzeichnis z.B. "src/services" oder "src/components" (optional, default: src/services)'
      },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          const result = await svc().listOwnFiles(params.directory || 'src/services');
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ── Backup erstellen ─────────────────────────────────────────────────────
    toolRegistry.set('backup_own_code', {
      name: 'backup_own_code',
      description: 'Erstellt ein Backup einer Datei BEVOR sie geändert wird. Immer zuerst aufrufen!',
      parameters: {
        path: 'string - Relativer Pfad der Datei',
        reason: 'string - Grund für das Backup z.B. "vor Feature X Implementierung"'
      },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          const result = await svc().createBackup(params.path, params.reason || 'manual');
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ── Backups auflisten ────────────────────────────────────────────────────
    toolRegistry.set('list_backups', {
      name: 'list_backups',
      description: 'Zeigt alle vorhandenen Backups. Optional gefiltert nach einer bestimmten Datei.',
      parameters: {
        path: 'string - Optionaler Pfad-Filter z.B. "src/services/AgentManager.js"'
      },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          const result = await svc().listBackups(params.path || null);
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ── Rollback ─────────────────────────────────────────────────────────────
    toolRegistry.set('rollback_code', {
      name: 'rollback_code',
      description: 'Stellt eine Datei aus einem Backup wieder her. Benutze list_backups um den Namen zu finden.',
      parameters: {
        backupName: 'string - Name des Backups z.B. "src__services__AgentManager.js__2024-01-01..."'
      },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          const result = await svc().rollback(params.backupName);
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ── Code in Sandbox testen ───────────────────────────────────────────────
    toolRegistry.set('test_code_change', {
      name: 'test_code_change',
      description: 'Testet neuen Code in einer isolierten Sandbox OHNE die echte Datei zu ändern. Führt Syntax-, Require- und Smoke-Tests durch.',
      parameters: {
        path: 'string - Relativer Pfad der Datei',
        newContent: 'string - Der vollständige neue Dateiinhalt',
        testCode: 'string - Optionaler JavaScript-Testcode der gegen das neue Modul läuft'
      },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          const result = await svc().testFileInSandbox(params.path, params.newContent, params.testCode || null);
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ── Änderung live anwenden ───────────────────────────────────────────────
    toolRegistry.set('apply_code_change', {
      name: 'apply_code_change',
      description: 'Wendet eine Code-Änderung auf die echte Datei an. Zeigt ZUERST einen Diff-Preview und wartet auf Bestätigung. Dann: Sandbox-Test → Backup → Apply → Rollback bei Fehler.',
      parameters: {
        path: 'string - Relativer Pfad der Datei',
        newContent: 'string - Der vollständige neue Dateiinhalt',
        description: 'string - Beschreibung was geändert wurde'
      },
      execute: async (params, agent, manager) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          // ── 1. Diff-Preview erzeugen ────────────────────────────────────
          let diffPreview = '(Diff nicht verfügbar)';
          try {
            const dr = await svc().diffFiles(params.path, params.newContent);
            diffPreview = dr.diff || dr.summary || '(keine Änderungen)';
          } catch (_) {}

          // ── 2. Bestätigung mit Diff anzeigen ───────────────────────────
          if (manager && manager.security) {
            const confirm = await manager.security.requestConfirmation(
              'apply_code_change',
              { path: params.path, description: params.description, diff: diffPreview.slice(0, 800) },
              agent && agent.name
            );
            if (!confirm.approved) {
              logger.info('AgentManager', `apply_code_change abgelehnt: ${params.path}`);
              return { error: 'Code-Änderung vom User abgelehnt.', denied: true, complete: true };
            }
          }

          // ── 3. Sandbox-Test ────────────────────────────────────────────
          const testResult = await svc().testFileInSandbox(params.path, params.newContent);

          // ── 4. Anwenden ────────────────────────────────────────────────
          const result = await svc().applyChange(params.path, params.newContent, params.description || '', testResult);
          logger.info('AgentManager', `apply_code_change erfolgreich: ${params.path}`);
          return { ...result, testResults: testResult, diffPreview: diffPreview.slice(0, 400), complete: true };
        } catch (e) {
          logger.error('AgentManager', `apply_code_change Fehler: ${e.message}`);
          return { error: e.message, complete: true };
        }
      }
    });

    // ── Patch (einzelne Stelle) ──────────────────────────────────────────────
    toolRegistry.set('patch_own_code', {
      name: 'patch_own_code',
      description: 'Ändert einen spezifischen Code-Abschnitt (alter Text → neuer Text). Zeigt Diff-Preview + wartet auf Bestätigung. Testet in Sandbox.',
      parameters: {
        path: 'string - Relativer Pfad der Datei',
        oldSnippet: 'string - Der exakte Code-Text der ersetzt werden soll (muss genau 1x vorkommen)',
        newSnippet: 'string - Der neue Code-Text der eingefügt werden soll',
        description: 'string - Was wurde geändert und warum'
      },
      execute: async (params, agent, manager) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          // ── Diff-Preview vor Apply ──────────────────────────────────────
          let diffSummary = `${params.path}: "${(params.oldSnippet||'').slice(0,60)}..." → "${(params.newSnippet||'').slice(0,60)}..."`;
          try {
            const fs = require('fs').promises;
            const path = require('path');
            const fullPath = path.join(process.cwd(), params.path);
            const old = await fs.readFile(fullPath, 'utf-8').catch(() => '');
            const patched = old.replace(params.oldSnippet, params.newSnippet);
            const dr = await svc().diffFiles(params.path, patched).catch(() => null);
            if (dr) diffSummary = (dr.diff || dr.summary || diffSummary).slice(0, 800);
          } catch (_) {}

          // ── Bestätigung ────────────────────────────────────────────────
          if (manager && manager.security) {
            const confirm = await manager.security.requestConfirmation(
              'patch_own_code',
              { path: params.path, description: params.description, diff: diffSummary },
              agent && agent.name
            );
            if (!confirm.approved) return { error: 'Patch vom User abgelehnt.', denied: true, complete: true };
          }

          const result = await svc().patchFile(params.path, params.oldSnippet, params.newSnippet, params.description || '');
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ── Neue Funktion hinzufügen ─────────────────────────────────────────────
    toolRegistry.set('add_function_to_code', {
      name: 'add_function_to_code',
      description: 'Fügt eine neue Funktion/Methode am Ende einer Klasse ein. Zeigt Preview + wartet auf Bestätigung. Backup + Sandbox-Test.',
      parameters: {
        path: 'string - Relativer Pfad der Datei',
        functionCode: 'string - Der vollständige Funktionscode (async functionName(params) { ... })',
        description: 'string - Was macht die neue Funktion'
      },
      execute: async (params, agent, manager) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          const preview = `Neue Funktion in ${params.path}:\n${(params.functionCode||'').slice(0, 400)}`;

          if (manager && manager.security) {
            const confirm = await manager.security.requestConfirmation(
              'add_function_to_code',
              { path: params.path, description: params.description, preview },
              agent && agent.name
            );
            if (!confirm.approved) return { error: 'Funktion-Hinzufügen abgelehnt.', denied: true, complete: true };
          }

          const result = await svc().addFunction(params.path, params.functionCode, params.description || '');
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ── Modul neu laden ──────────────────────────────────────────────────────
    toolRegistry.set('reload_module', {
      name: 'reload_module',
      description: 'Lädt ein geändertes Modul neu in den laufenden Prozess (ohne Neustart). Aktiviert Änderungen sofort.',
      parameters: {
        path: 'string - Relativer Pfad des Moduls'
      },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          const result = await svc().reloadModule(params.path);
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ── Änderungshistorie ────────────────────────────────────────────────────
    toolRegistry.set('get_change_log', {
      name: 'get_change_log',
      description: 'Zeigt Johnnys Änderungshistorie: was wurde wann geändert, getestet, gerollt back.',
      parameters: {
        limit: 'number - Anzahl der letzten Einträge (optional, default 20)'
      },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try {
          const result = await svc().getChangeLog(params.limit || 20);
          return { ...result, complete: true };
        } catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ── Neue Tools v2 ─────────────────────────────────────────────────────

    toolRegistry.set('search_in_code', {
      name: 'search_in_code',
      description: 'Durchsucht den Projekt-Code nach einem Text oder Regex-Pattern. Zeigt Treffer mit Kontext-Zeilen.',
      parameters: { pattern: 'string', dir: 'string (optional, default: src/services)', isRegex: 'boolean (optional)', maxResults: 'number (optional)' },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try { return { ...await svc().searchInCode(params.pattern, { dir: params.dir, isRegex: params.isRegex || false, maxResults: params.maxResults || 30 }), complete: true }; }
        catch (e) { return { error: e.message, complete: true }; }
      }
    });

    toolRegistry.set('analyze_impact', {
      name: 'analyze_impact',
      description: 'Zeigt welche anderen Dateien eine Datei importieren — wichtig VOR jeder Änderung um Impact einzuschätzen.',
      parameters: { path: 'string (relativer Pfad, z.B. src/services/JohnnyCore.js)' },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try { return { ...await svc().analyzeImpact(params.path), complete: true }; }
        catch (e) { return { error: e.message, complete: true }; }
      }
    });

    toolRegistry.set('diff_files', {
      name: 'diff_files',
      description: 'Zeigt was sich ändern würde (Diff) BEVOR apply_code_change aufgerufen wird. Empfohlen nach test_code_change.',
      parameters: { path: 'string', newContent: 'string' },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try { return { ...await svc().diffFiles(params.path, params.newContent), complete: true }; }
        catch (e) { return { error: e.message, complete: true }; }
      }
    });

    toolRegistry.set('clean_old_backups', {
      name: 'clean_old_backups',
      description: 'Löscht alte Backups (Standard: älter als 30 Tage), behält mindestens 5.',
      parameters: { maxAgeDays: 'number (optional, default 30)', keepMinimum: 'number (optional, default 5)' },
      execute: async (params) => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try { return { ...await svc().cleanOldBackups(params.maxAgeDays || 30, params.keepMinimum || 5), complete: true }; }
        catch (e) { return { error: e.message, complete: true }; }
      }
    });

    toolRegistry.set('get_project_stats', {
      name: 'get_project_stats',
      description: 'Überblick über das gesamte Projekt: Anzahl Dateien, Zeilen, Änderungshistorie, größte Dateien.',
      parameters: {},
      execute: async () => {
        if (!svc()) return { error: 'SelfImprovementService nicht verfügbar', complete: true };
        try { return { ...await svc().getProjectStats(), complete: true }; }
        catch (e) { return { error: e.message, complete: true }; }
      }
    });

    // ══════════════════════════════════════════════════════════════════
    // NEUE TOOLS v1.6
    // ══════════════════════════════════════════════════════════════════

    // ── Kreativität ────────────────────────────────────────────────
    toolRegistry.set('brainstorm', {
      name: 'brainstorm',
      description: 'Strukturiertes Brainstorming. Techniken: scamper, sixHats, fiveWhys, random, morphological.',
      parameters: { topic: 'string (Thema)', technique: 'string (optional, default: scamper)' },
      execute: async (params) => {
        if (!this.creativity) return { error: 'CreativityService nicht verfügbar' };
        try { return await this.creativity.brainstorm(params.topic, params.technique); }
        catch (e) { return { error: e.message }; }
      }
    });

    toolRegistry.set('change_perspective', {
      name: 'change_perspective',
      description: 'Betrachtet ein Thema aus verschiedenen Perspektiven (Kind, Skeptiker, Ingenieur, Künstler, etc.).',
      parameters: { topic: 'string (Thema)' },
      execute: async (params) => {
        if (!this.creativity) return { error: 'CreativityService nicht verfügbar' };
        try { return await this.creativity.changePerspective(params.topic); }
        catch (e) { return { error: e.message }; }
      }
    });

    toolRegistry.set('generate_analogy', {
      name: 'generate_analogy',
      description: 'Erstellt eine kreative Analogie für ein Konzept.',
      parameters: { concept: 'string', domain: 'string (optional, z.B. Natur, Kochen, Sport)' },
      execute: async (params) => {
        if (!this.creativity) return { error: 'CreativityService nicht verfügbar' };
        try { return await this.creativity.generateAnalogy(params.concept, params.domain); }
        catch (e) { return { error: e.message }; }
      }
    });

    // ── Sprache (TTS/STT) ──────────────────────────────────────────
    toolRegistry.set('speak', {
      name: 'speak',
      description: 'Spricht Text als Audio (TTS). Voices: alloy, echo, fable, onyx, nova, shimmer.',
      parameters: { text: 'string', voice: 'string (optional)', speed: 'number (optional, default: 1.0)' },
      execute: async (params) => {
        if (!this.speech) return { error: 'SpeechService nicht verfügbar' };
        try { return await this.speech.speak(params.text, params); }
        catch (e) { return { error: e.message }; }
      }
    });

    toolRegistry.set('transcribe', {
      name: 'transcribe',
      description: 'Konvertiert Audio-Datei in Text (STT/Whisper).',
      parameters: { audioPath: 'string (Pfad zur Audio-Datei)', language: 'string (optional, default: de)' },
      execute: async (params) => {
        if (!this.speech) return { error: 'SpeechService nicht verfügbar' };
        try { return await this.speech.transcribe(params.audioPath, params); }
        catch (e) { return { error: e.message }; }
      }
    });

    // ── Datenanalyse ───────────────────────────────────────────────
    toolRegistry.set('analyze_data', {
      name: 'analyze_data',
      description: 'Lädt und analysiert Daten (CSV, JSON, TSV). Liefert Statistiken, Trends, Anomalien oder Charts.',
      parameters: { source: 'string (Dateipfad/URL)', type: 'string (optional: stats|trend|anomaly|chart|summary)' },
      execute: async (params) => {
        if (!this.dataAnalysis) return { error: 'DataAnalysisService nicht verfügbar' };
        try {
          const data = await this.dataAnalysis.loadData(params.source);
          const stats = this.dataAnalysis.analyze(data);
          switch (params.type) {
            case 'trend': {
              const numCol = Object.entries(stats).find(([,s]) => s.type === 'numeric');
              return numCol ? this.dataAnalysis.detectTrend(data, numCol[0]) : { error: 'Keine numerische Spalte' };
            }
            case 'anomaly': {
              const numCol2 = Object.entries(stats).find(([,s]) => s.type === 'numeric');
              return numCol2 ? this.dataAnalysis.detectAnomalies(data, numCol2[0]) : { error: 'Keine numerische Spalte' };
            }
            case 'chart':
              return this.dataAnalysis.generateChart(data);
            case 'summary':
              return await this.dataAnalysis.summarize(data, stats);
            default:
              return { stats, meta: data.meta };
          }
        }
        catch (e) { return { error: e.message }; }
      }
    });

    // ── Fehler-Dashboard ───────────────────────────────────────────
    toolRegistry.set('error_dashboard', {
      name: 'error_dashboard',
      description: 'Zeigt Fehler-Statistiken, erkannte Muster und aktuelle Fehler.',
      parameters: {},
      execute: async () => {
        if (!this.errorAnalysis) return { error: 'ErrorAnalysisService nicht verfügbar' };
        try {
          return {
            summary: this.errorAnalysis.getErrorSummary(),
            patterns: this.errorAnalysis.getTopPatterns(5),
            recent: this.errorAnalysis.getRecentErrors(10),
          };
        }
        catch (e) { return { error: e.message }; }
      }
    });

    toolRegistry.set('analyze_errors', {
      name: 'analyze_errors',
      description: 'LLM-gestützte Tiefenanalyse der Fehlermuster mit Root-Cause-Analyse und Fix-Vorschlägen.',
      parameters: {},
      execute: async () => {
        if (!this.errorAnalysis) return { error: 'ErrorAnalysisService nicht verfügbar' };
        try { return await this.errorAnalysis.analyzeWithLLM(); }
        catch (e) { return { error: e.message }; }
      }
    });

    // ── Qualitäts-Report ───────────────────────────────────────────
    toolRegistry.set('quality_report', {
      name: 'quality_report',
      description: 'Zeigt Qualitäts-Scores und Feedback-Statistiken.',
      parameters: {},
      execute: async () => {
        if (!this.feedbackLearning) return { error: 'FeedbackLearningService nicht verfügbar' };
        try { return this.feedbackLearning.getStats(); }
        catch (e) { return { error: e.message }; }
      }
    });

    // ── Multi-Agenten Pipeline ─────────────────────────────────────
    toolRegistry.set('run_pipeline', {
      name: 'run_pipeline',
      description: 'Startet eine Multi-Agenten Pipeline. Templates: deep-research, code-project, decision-making, brainstorm-refine, content-creation.',
      parameters: { goal: 'string (Ziel)', template: 'string (Pipeline-Template)' },
      execute: async (params) => {
        if (!this.swarmService) return { error: 'SwarmService nicht verfügbar' };
        try { return await this.swarmService.runPipeline(params.goal, params.template); }
        catch (e) { return { error: e.message }; }
      }
    });

    // ── Kontext-Gedächtnis ─────────────────────────────────────────
    toolRegistry.set('context_stats', {
      name: 'context_stats',
      description: 'Zeigt Statistiken des Kontext-Gedächtnisses: gespeicherte Themen, Summaries, aktive Topics.',
      parameters: {},
      execute: async () => {
        if (!this.contextMemory) return { error: 'ContextMemoryService nicht verfügbar' };
        try { return this.contextMemory.getStats(); }
        catch (e) { return { error: e.message }; }
      }
    });

    toolRegistry.set('summarize_session', {
      name: 'summarize_session',
      description: 'Erstellt eine Zusammenfassung der aktuellen Gesprächssession und speichert sie im Langzeitgedächtnis.',
      parameters: {},
      execute: async () => {
        if (!this.contextMemory) return { error: 'ContextMemoryService nicht verfügbar' };
        try { return await this.contextMemory.summarizeSession(this.johnny?.self?.activeUserId || 'default'); }
        catch (e) { return { error: e.message }; }
      }
    });

    // ── v3.0: Analytics & Diagnose-Tools ───────────────────────────────
    toolRegistry.set('tool_analytics', {
      name: 'tool_analytics',
      description: 'Zeigt Tool-Performance-Statistiken: Aufruf-Häufigkeit, Erfolgsrate, Durchschnittsdauer. Identifiziert langsame und unzuverlässige Tools.',
      parameters: {},
      execute: async () => ({
        topTools:       this.getToolAnalytics(15),
        slowTools:      this.getSlowTools(3000),
        unreliableTools: this.getUnreliableTools(70),
        complete: true,
      }),
    });

    toolRegistry.set('search_conversations', {
      name: 'search_conversations',
      description: 'Durchsucht alle gespeicherten Konversationen nach einem Suchbegriff.',
      parameters: { query: 'string (Suchbegriff)', agent: 'string (optional, Agenten-Name)' },
      execute: async (params) => {
        try { return { results: await this.searchConversations(params.query, params.agent), complete: true }; }
        catch (e) { return { error: e.message, complete: true }; }
      },
    });

    toolRegistry.set('daily_summary', {
      name: 'daily_summary',
      description: 'Erstellt eine Tages-Zusammenfassung: Interaktionen, Emotionen, Entscheidungen, Performance.',
      parameters: {},
      execute: async () => {
        if (!this.johnny) return { error: 'JohnnyCore nicht verfügbar', complete: true };
        try { return { ...await this.johnny.generateDailySummary(), complete: true }; }
        catch (e) { return { error: e.message, complete: true }; }
      },
    });

    // ════════════════════════════════════════════════════════════════════
    // v1.7: STIL-STEUERUNG — Explizites Style-Switching per Chat
    // ════════════════════════════════════════════════════════════════════

    toolRegistry.set('set_style', {
      name: 'set_style',
      description: [
        'Ändert dauerhaft Johnnys Kommunikationsstil für diesen User.',
        'Verwende dieses Tool wenn der User explizit nach einem anderen Stil fragt:',
        '"sei förmlicher", "mehr Humor bitte", "sei direkter", "kreativ-Modus an",',
        '"analysiere tiefer", "kurz und knapp", "entspannter Ton", usw.',
        'Die Einstellung bleibt über Sitzungen hinweg erhalten.',
      ].join(' '),
      parameters: {
        formalityLevel:   'string (optional) — "formal" | "casual" | "auto"',
        humorLevel:       'string (optional) — "high" | "low" | "auto"',
        responseEmotion:  'string (optional) — "serious" | "warm" | "playful" | "auto"',
        analysisDepth:    'string (optional) — "quick" | "standard" | "deep"',
        creativeMode:     'boolean (optional) — true = Kreativ-Modus aktiv',
        verbosity:        'string (optional) — "short" | "medium" | "detailed"',
      },
      execute: async (params, agent, manager) => {
        if (!manager.johnny) return { error: 'JohnnyCore nicht verfügbar' };
        const userId = manager.johnny.self.activeUserId || 'default';
        const result = await manager.johnny.setStylePreference(userId, params, 'user');
        if (!result.success) return { error: 'Keine gültigen Style-Parameter angegeben', params };
        const beschreibung = Object.entries(result.current)
          .filter(([, v]) => v && v !== 'auto' && v !== false)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        return {
          success: true,
          message: beschreibung
            ? `Stil gesetzt — ${beschreibung}. Bleibt bis zur nächsten Änderung aktiv.`
            : 'Stil auf Auto zurückgesetzt — Johnny passt sich wieder automatisch an.',
          current: result.current,
        };
      },
    });

    // ════════════════════════════════════════════════════════════════════
    // v1.7: TIEFE TEXTANALYSE — Semantik, Struktur, Stimmung, Implikationen
    // ════════════════════════════════════════════════════════════════════

    toolRegistry.set('analyze_text', {
      name: 'analyze_text',
      description: [
        'Führt eine tiefe semantische Analyse eines Textes durch.',
        'Erkennt Hauptthemen, Argumentationsstruktur, Sentiment, Widersprüche,',
        'implizite Annahmen, rhetorische Mittel und mögliche Intention des Autors.',
        'Ideal für komplexe Texte, Argumente, Artikel oder mehrdeutige Aussagen.',
      ].join(' '),
      parameters: {
        text:  'string — Der zu analysierende Text',
        focus: 'string (optional) — "sentiment" | "structure" | "rhetoric" | "intent" | "full" (default: full)',
        depth: 'string (optional) — "quick" | "standard" | "deep" (default: standard)',
      },
      execute: async (params, agent, manager) => {
        if (!params.text) return { error: 'Parameter "text" fehlt' };
        const focus = params.focus || 'full';
        const depth = params.depth || 'standard';

        const focusInstructions = {
          sentiment:  'Fokus auf: emotionalen Ton, Valenz (positiv/negativ/gemischt), Intensität der Emotionen, emotionale Entwicklung im Text.',
          structure:  'Fokus auf: Aufbau des Arguments, Thesen, Prämissen, Schlussfolgerungen, logische Konsistenz, Überzeugungsstrategie.',
          rhetoric:   'Fokus auf: rhetorische Mittel (Metaphern, Alliterationen, Ironie, Hyperbeln), Stil, Zielgruppe, Wirkung.',
          intent:     'Fokus auf: Absicht des Autors, implizite Botschaften, was nicht gesagt wird, mögliche Agenda oder Bias.',
          full:       'Vollständige Analyse: Themen, Sentiment, Struktur, Rhetorik, Absicht, Widersprüche, implizite Annahmen.',
        };

        const depthInstructions = {
          quick:    'Antworte knapp in 3–5 Sätzen je Aspekt.',
          standard: 'Antworte ausführlich mit konkreten Textstellen als Belegen.',
          deep:     'Analysiere erschöpfend: Gehe auf Nuancen, Kontext, alternative Interpretationen und mögliche blinde Flecken ein.',
        };

        const prompt = `Analysiere den folgenden Text sorgfältig:

---
${params.text.slice(0, 4000)}
---

${focusInstructions[focus] || focusInstructions.full}
${depthInstructions[depth] || depthInstructions.standard}

Strukturiere deine Antwort als JSON mit diesen Feldern:
{
  "hauptthemen": ["..."],
  "sentiment": { "gesamt": "positiv|negativ|neutral|gemischt", "intensitaet": 0.0-1.0, "beschreibung": "..." },
  "struktur": { "aufbau": "...", "argumente": ["..."], "logik": "konsistent|widersprüchlich|lückenhaft" },
  "rhetorik": { "mittel": ["..."], "stil": "...", "zielgruppe": "..." },
  "absicht": "...",
  "impliziteAnnahmen": ["..."],
  "widersprueche": ["..."],
  "stärken": ["..."],
  "schwächen": ["..."],
  "zusammenfassung": "..."
}

Antworte NUR mit dem JSON-Objekt.`;

        if (!manager) return { error: 'Manager nicht verfügbar' };
        try {
          const result = await manager.sendMessage('Johnny', prompt);
          const jsonMatch = result.response.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return { raw: result.response };
          const analysis = JSON.parse(jsonMatch[0]);
          return { ...analysis, textLength: params.text.length, focus, depth };
        } catch (e) {
          return { error: `Analyse fehlgeschlagen: ${e.message}` };
        }
      },
    });

    // ════════════════════════════════════════════════════════════════════
    // v1.7: VISION CHAT — Bild direkt aus Chat-Kontext analysieren
    // ════════════════════════════════════════════════════════════════════

    toolRegistry.set('vision_chat', {
      name: 'vision_chat',
      description: [
        'Analysiert ein Bild das der User als Dateipfad oder URL angegeben hat.',
        'Nutze dieses Tool wenn der User ein Bild teilt oder beschrieben haben möchte.',
        'Unterstützt lokale Dateipfade und URLs. Für Screenshots: analyze_screenshot verwenden.',
      ].join(' '),
      parameters: {
        source:  'string — Dateipfad (C:\\bild.png) oder URL (https://...)',
        frage:   'string — Was soll Johnny über das Bild herausfinden oder beschreiben?',
        detail:  'string (optional) — "kurz" | "detailliert" | "technisch" (default: detailliert)',
      },
      execute: async (params, agent, manager) => {
        if (!params.source) return { error: 'Parameter "source" (Pfad oder URL) fehlt' };

        const frage  = params.frage  || 'Beschreibe dieses Bild ausführlich.';
        const detail = params.detail || 'detailliert';

        const detailPrompt = {
          kurz:        'Beschreibe in 2–3 Sätzen was du siehst.',
          detailliert: 'Beschreibe ausführlich: Was ist zu sehen? Farben, Objekte, Personen, Stimmung, Kontext?',
          technisch:   'Analysiere technisch: Auflösung schätzungsweise, Bildaufbau, Fokus, Beleuchtung, mögliche Entstehungszeit.',
        };

        const fullPrompt = `${frage}\n\n${detailPrompt[detail] || detailPrompt.detailliert}`;

        // URL-Support: direkt herunterladen
        if (params.source.startsWith('http://') || params.source.startsWith('https://')) {
          if (!manager.visionService) {
            // Fallback: Ollama direkt mit URL (falls Modell unterstützt)
            const ollamaService = manager.ollamaService || manager.registry?.get?.('ollama');
            if (!ollamaService) return { error: 'Kein Vision-Service verfügbar. Bitte installiere ein Vision-Modell (z.B. llava, moondream).' };
            try {
              const dlAxios = require('axios');
              const tmpPath = require('path').join(require('os').tmpdir(), `johnny_img_${Date.now()}.jpg`);
              const fsSync  = require('fs');
              const response = await dlAxios.get(params.source, {
                responseType: 'arraybuffer',
                timeout: 15000,
                maxRedirects: 5,
                headers: { 'User-Agent': 'Mozilla/5.0' },
              });
              fsSync.writeFileSync(tmpPath, Buffer.from(response.data));
              // jetzt mit lokalem Pfad weiter
              params.source = tmpPath;
            } catch (e) {
              return { error: `Bild-Download fehlgeschlagen: ${e.message}` };
            }
          }
        }

        if (!manager.visionService) {
          return {
            error: 'VisionService nicht verfügbar.',
            hint:  'Johnny braucht ein Multimodal-Modell (llava, moondream, bakllava) in Ollama. Installiere es mit: ollama pull llava',
            source: params.source,
          };
        }

        try {
          const result = await manager.visionService.analyzeImage(params.source, fullPrompt);
          return {
            beschreibung: result.description || result.text || result,
            source:       params.source,
            frage,
          };
        } catch (e) {
          return { error: `Vision-Analyse fehlgeschlagen: ${e.message}`, source: params.source };
        }
      },
    });

  // ════════════════════════════════════════════════════════════════════
  // v2.0: ERWEITERUNGEN — NLP, Sensor, WebAutonomy, Enhanced Image/Speech
  // ════════════════════════════════════════════════════════════════════

  try {
    const { registerExtensions } = require('./ToolRegistryExtensions');
    registerExtensions(manager);
    console.log('[ToolRegistry] Extensions geladen ✓');
  } catch (e) {
    console.warn('[ToolRegistry] Extensions nicht geladen:', e.message);
  }

}

module.exports = { registerAll };
