const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const vm = require('vm');
const { v4: uuidv4 } = require('uuid');
const logger = require('../core/Logger');

const execAsync = promisify(exec);

/**
 * PluginManager - Verwaltet Skills und Plugins in verschiedenen Sprachen
 * 
 * Unterstützte Formate:
 * - JavaScript (.js)
 * - Python (.py)
 * - Custom Protocols (MCP, LangChain, etc.)
 */
class PluginManager {
  constructor(config) {
    this.pluginsDir = config.pluginsDir;
    this.skillsDir = config.skillsDir;
    this.agentManager = config.agentManager;
    this.plugins = new Map();
    this.skills = new Map();
    this.skillTemplates = new Map();
    this.pythonAvailable = false;
  }

  async initialize() {
    console.log('Initializing Plugin Manager...');
    
    // Erstelle Verzeichnisse
    await fs.mkdir(this.pluginsDir, { recursive: true });
    await fs.mkdir(this.skillsDir, { recursive: true });
    
    // Prüfe Python-Verfügbarkeit
    this.pythonAvailable = await this.checkPythonAvailable();
    
    // Lade eingebaute Skill-Templates
    this.loadSkillTemplates();
    
    // Lade existierende Plugins und Skills
    await this.loadPlugins();
    await this.loadSkills();
    
    console.log(`Plugin Manager initialized with ${this.plugins.size} plugins and ${this.skills.size} skills`);
  }

  async checkPythonAvailable() {
    try {
      const { stdout } = await execAsync('python --version');
      console.log('Python available:', stdout.trim());
      return true;
    } catch (error) {
      console.log('Python not available');
      return false;
    }
  }

  // ==================== SKILL TEMPLATES ====================
  
  loadSkillTemplates() {
    // JavaScript Template
    this.skillTemplates.set('javascript', {
      name: 'JavaScript Skill',
      extension: '.js',
      template: `/**
 * JavaScript Skill Template
 * Name: {SKILL_NAME}
 * Description: {DESCRIPTION}
 */

module.exports = {
  name: '{SKILL_NAME}',
  description: '{DESCRIPTION}',
  version: '1.0.0',
  parameters: {
    // Definiere Parameter hier
    // param1: 'string - Beschreibung'
  },
  
  async execute(params, context) {
    // Skill-Logik hier
    console.log('Executing {SKILL_NAME} with params:', params);
    
    // Beispiel: Zugriff auf Agent-Kontext
    // context.agent - Der ausführende Agent
    // context.tools - Verfügbare Tools
    // context.memory - Agent Memory
    
    return {
      success: true,
      result: 'Skill executed successfully',
      data: {}
    };
  }
};`
    });

    // Python Template
    this.skillTemplates.set('python', {
      name: 'Python Skill',
      extension: '.py',
      template: `"""
Python Skill Template
Name: {SKILL_NAME}
Description: {DESCRIPTION}
"""

import json
import sys

class Skill:
    def __init__(self):
        self.name = "{SKILL_NAME}"
        self.description = "{DESCRIPTION}"
        self.version = "1.0.0"
    
    def execute(self, params):
        """
        Führt den Skill aus
        
        Args:
            params (dict): Input-Parameter
            
        Returns:
            dict: Ergebnis
        """
        print(f"Executing {self.name} with params: {params}")
        
        # Skill-Logik hier
        
        return {
            "success": True,
            "result": "Skill executed successfully",
            "data": {}
        }

if __name__ == "__main__":
    # CLI Interface für Node.js
    skill = Skill()
    
    if len(sys.argv) > 1:
        params = json.loads(sys.argv[1])
        result = skill.execute(params)
        print(json.dumps(result))
    else:
        print(json.dumps({"error": "No parameters provided"}))
`
    });

    // MCP Compatible Template
    this.skillTemplates.set('mcp', {
      name: 'MCP Protocol Skill',
      extension: '.js',
      template: `/**
 * MCP-Compatible Skill
 * Kompatibel mit Model Context Protocol
 */

module.exports = {
  protocol: 'mcp',
  name: '{SKILL_NAME}',
  description: '{DESCRIPTION}',
  version: '1.0.0',
  
  // MCP Schema
  inputSchema: {
    type: 'object',
    properties: {
      // Definiere Input-Schema
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      result: { type: 'string' }
    }
  },
  
  async execute(input, context) {
    // MCP-kompatible Ausführung
    return {
      success: true,
      result: 'MCP skill executed'
    };
  }
};`
    });
  }

  // ==================== SKILL CREATION ====================

  async createSkill(config) {
    const {
      name,
      description,
      language = 'javascript',
      template = null,
      code = null
    } = config;

    const skillId = uuidv4();
    const templateData = this.skillTemplates.get(language);
    
    if (!templateData && !code) {
      throw new Error(`Unknown language: ${language}`);
    }

    let skillCode = code;
    if (!skillCode) {
      // Erstelle aus Template
      skillCode = templateData.template
        .replace(/{SKILL_NAME}/g, name)
        .replace(/{DESCRIPTION}/g, description);
    }

    const filename = `${name.toLowerCase().replace(/\s/g, '-')}${templateData.extension}`;
    const filepath = path.join(this.skillsDir, filename);

    // Speichere Skill
    await fs.writeFile(filepath, skillCode, 'utf-8');

    // Erstelle Manifest
    const manifest = {
      id: skillId,
      name,
      description,
      language,
      filepath,
      filename,
      version: '1.0.0',
      created: new Date().toISOString(),
      enabled: true,
      parameters: {}
    };

    const manifestPath = path.join(this.skillsDir, `${filename}.manifest.json`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    // Lade Skill
    await this.loadSkill(filepath, manifest);

    console.log(`Skill created: ${name} (${language})`);
    
    return {
      id: skillId,
      name,
      filepath,
      manifest
    };
  }

  async updateSkill(config) {
    const { id, code } = config;
    if (!id || code === undefined) throw new Error('id und code erforderlich');
    const existing = Array.from(this.skills.values()).find(function(s){ return s.id === id; });
    if (!existing) throw new Error('Skill nicht gefunden: ' + id);
    await fs.writeFile(existing.filepath, code, 'utf-8');
    const manifestPath = existing.filepath + '.manifest.json';
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw);
      manifest.updated = new Date().toISOString();
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch(_) {}
    await this.loadSkill(existing.filepath, existing);
    return { success: true, id };
  }

  // ==================== SKILL LOADING ====================
  async loadSkills() {
    try {
      const files = await fs.readdir(this.skillsDir);
      
      for (const file of files) {
        if (file.endsWith('.manifest.json')) {
          const manifestPath = path.join(this.skillsDir, file);
          const manifestData = await fs.readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(manifestData);
          
          if (manifest.enabled) {
            await this.loadSkill(manifest.filepath, manifest);
          }
        }
      }
    } catch (error) {
      console.error('Error loading skills:', error);
    }
  }

  async loadSkill(filepath, manifest) {
    try {
      let skill;

      if (manifest.language === 'javascript') {
        // ── VM-Sandbox für JavaScript Skills ─────────────────────────────
        // Skills laufen in isoliertem Kontext, kein Zugriff auf
        // require(), process, fs oder andere Node-Interna
        const code = await fs.readFile(filepath, 'utf-8');
        const sandbox = {
          module:  { exports: {} },
          exports: {},
          console: { log: (...a) => console.log('[Skill]', ...a), warn: (...a) => console.warn('[Skill]', ...a), error: (...a) => console.error('[Skill]', ...a) },
          // Explizit erlaubte Module (kein require() für alles andere)
          JSON, Math, Date, parseInt, parseFloat, isNaN, isFinite,
          setTimeout, clearTimeout, Promise, Array, Object, String, Number, Boolean, RegExp,
          Error, Map, Set, Symbol,
        };
        sandbox.global = sandbox;
        try {
          const script = new vm.Script(code, { filename: filepath, timeout: 5000 });
          const ctx = vm.createContext(sandbox);
          script.runInContext(ctx, { timeout: 5000 });
          skill = sandbox.module.exports;
        } catch (vmErr) {
          throw new Error(`VM-Sandbox Fehler in ${filepath}: ${vmErr.message}`);
        }
      } else if (manifest.language === 'python' && this.pythonAvailable) {
        // Python Skill - Wrapper erstellen
        skill = this.createPythonSkillWrapper(filepath, manifest);
      } else {
        console.log(`Skipping skill ${manifest.name} - language ${manifest.language} not supported`);
        return;
      }

      // Validiere Skill
      if (!skill.name || !skill.execute) {
        throw new Error(`Invalid skill format: ${filepath}`);
      }

      this.skills.set(manifest.id, {
        ...manifest,
        skill: skill,
        loaded: true
      });

      console.log(`Loaded skill: ${manifest.name}`);
    } catch (error) {
      console.error(`Error loading skill ${filepath}:`, error);
    }
  }

  createPythonSkillWrapper(filepath, manifest) {
    return {
      name: manifest.name,
      description: manifest.description,
      language: 'python',
      
      async execute(params, context) {
        try {
          const paramsJson = JSON.stringify(params);
          const { stdout, stderr } = await execAsync(
            `python "${filepath}" '${paramsJson}'`
          );

          if (stderr) {
            console.error('Python skill stderr:', stderr);
          }

          const result = JSON.parse(stdout);
          return result;
        } catch (error) {
          console.error('Python skill execution error:', error);
          throw error;
        }
      }
    };
  }

  // ==================== PLUGIN LOADING ====================

  async loadPlugins() {
    try {
      const files = await fs.readdir(this.pluginsDir);
      
      for (const file of files) {
        if (file.endsWith('.plugin.js')) {
          const pluginPath = path.join(this.pluginsDir, file);
          await this.loadPlugin(pluginPath);
        }
      }
    } catch (error) {
      console.error('Error loading plugins:', error);
    }
  }

  async loadPlugin(filepath) {
    try {
      delete require.cache[require.resolve(filepath)];
      const plugin = require(filepath);

      // Validiere Plugin
      if (!plugin.name || !plugin.version || !plugin.initialize) {
        throw new Error(`Invalid plugin format: ${filepath}`);
      }

      // Initialisiere Plugin
      await plugin.initialize({
        agentManager: this.agentManager,
        pluginManager: this
      });

      this.plugins.set(plugin.name, {
        plugin,
        filepath,
        loaded: true
      });

      console.log(`Loaded plugin: ${plugin.name} v${plugin.version}`);
    } catch (error) {
      console.error(`Error loading plugin ${filepath}:`, error);
    }
  }

  // ==================== SKILL EXECUTION ====================

  async executeSkill(skillId, params, context) {
    const skillData = this.skills.get(skillId);
    
    if (!skillData || !skillData.loaded) {
      throw new Error(`Skill not found or not loaded: ${skillId}`);
    }

    console.log(`Executing skill: ${skillData.name}`);
    
    try {
      const result = await skillData.skill.execute(params, context);
      return result;
    } catch (error) {
      console.error(`Error executing skill ${skillData.name}:`, error);
      throw error;
    }
  }

  // ==================== AUTO-SKILL-GENERATION ====================

  async generateSkillFromDescription(description, language = 'javascript') {
    logger.info('PluginManager', `Generiere ${language}-Skill: ${description.slice(0, 80)}`);

    const templateData = this.skillTemplates.get(language);
    if (!templateData) throw new Error(`Unbekannte Sprache: ${language}`);

    const prompt = `Du bist ein erfahrener ${language}-Entwickler. Generiere einen funktionierenden Skill nach dieser Beschreibung:

BESCHREIBUNG: ${description}

TEMPLATE-STRUKTUR (halte dich genau daran):
${templateData.template}

REGELN:
- Fülle {SKILL_NAME} und {DESCRIPTION} sinnvoll aus
- Schreibe vollständig funktionierenden Code
- Nutze NUR Standard-Node.js (kein require außer was im Template steht)
- Gib NUR den Code zurück, keine Erklärungen, kein Markdown, keine Code-Fences

CODE:`;

    try {
      // AgentManager gibt Zugang zum modelProvider / ollamaService
      const agentMgr = this.agentManager;
      let generatedCode = null;

      if (agentMgr && agentMgr.modelProvider) {
        const result = await agentMgr.modelProvider.generate({
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          maxTokens: 1500,
        });
        generatedCode = (result.content || '').trim();
        // Strip markdown code fences if model added them
        generatedCode = generatedCode
          .replace(/^```[a-zA-Z]*[\r\n]?/, '')
          .replace(/[\r\n]?```$/, '')
          .trim();
      } else if (agentMgr && agentMgr.ollamaService) {
        const result = await agentMgr.ollamaService.generate(prompt, [], { temperature: 0.3 });
        generatedCode = (result.message || '').trim()
          .replace(/^```[a-zA-Z]*[\r\n]?/, '').replace(/[\r\n]?```$/, '').trim();
      }

      if (generatedCode && generatedCode.includes('module.exports')) {
        logger.info('PluginManager', `Skill generiert (${generatedCode.length} Zeichen)`);
        return generatedCode;
      }

      // Fallback: Template mit ausgefüllten Platzhaltern
      logger.warn('PluginManager', 'LLM-Generierung fehlgeschlagen, nutze Template-Fallback');
    } catch (e) {
      logger.warn('PluginManager', `Skill-Generierung Fehler: ${e.message}`);
    }

    // Fallback-Template
    const skillName = description.slice(0, 30).replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'GeneratedSkill';
    return templateData.template
      .replace(/{SKILL_NAME}/g, skillName)
      .replace(/{DESCRIPTION}/g, description);
  }

  // ==================== PLUGIN MARKETPLACE ====================

  async installPluginFromUrl(url) {
    console.log(`Installing plugin from: ${url}`);
    try {
      // Resolve GitHub blob URLs to raw URLs
      let resolvedUrl = url.trim();
      if (resolvedUrl.includes('github.com') && !resolvedUrl.includes('raw.githubusercontent.com')) {
        resolvedUrl = resolvedUrl
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
      }

      // Use axios for better compatibility in Electron main process
      const axios = require('axios');
      const response = await axios.get(resolvedUrl, {
        responseType: 'text',
        timeout: 30000,
        headers: { 'User-Agent': 'Johnny-AI/2.0' },
      });
      const pluginCode = response.data;

      if (!pluginCode || typeof pluginCode !== 'string' || pluginCode.trim().length === 0) {
        return { success: false, error: 'Leere oder ungültige Antwort von ' + resolvedUrl };
      }

      // Basic validation - must look like a JS module
      if (!pluginCode.includes('module.exports') && !pluginCode.includes('exports.') && !pluginCode.includes('export default')) {
        return { success: false, error: 'Datei ist kein gültiges Node.js-Plugin (module.exports fehlt)' };
      }

      const urlObj = new URL(resolvedUrl);
      const baseName = path.basename(urlObj.pathname).replace(/[^a-zA-Z0-9._-]/g, '_') || 'plugin';
      const pluginFileName = baseName.endsWith('.js') ? baseName : baseName + '.js';
      const pluginPath = path.join(this.pluginsDir, pluginFileName);

      await fs.writeFile(pluginPath, pluginCode, 'utf-8');

      // Try to load — if it fails, remove the file
      try {
        await this.loadPlugin(pluginPath);
      } catch (loadErr) {
        await fs.unlink(pluginPath).catch(() => {});
        return { success: false, error: 'Plugin geladen aber Fehler beim Initialisieren: ' + loadErr.message };
      }

      return { success: true, path: pluginPath, filename: pluginFileName };
    } catch (error) {
      const msg = error.message || 'Unbekannter Fehler';
      if (msg.includes('404')) return { success: false, error: 'URL nicht gefunden (404) — GitHub raw URL verwenden' };
      if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) return { success: false, error: 'Verbindung fehlgeschlagen — Internet-Verbindung prüfen' };
      return { success: false, error: msg };
    }
  }

  async installMCPServer(serverConfig) {
    // Installiere MCP Server als Plugin
    console.log('Installing MCP Server:', serverConfig.name);
    
    const pluginCode = `
module.exports = {
  name: '${serverConfig.name}',
  version: '1.0.0',
  type: 'mcp-server',
  config: ${JSON.stringify(serverConfig)},
  
  async initialize(context) {
    // MCP Server Setup
    console.log('MCP Server ${serverConfig.name} initialized');
  },
  
  async execute(method, params) {
    // MCP Server Calls
  }
};`;

    const pluginPath = path.join(
      this.pluginsDir, 
      `${serverConfig.name.toLowerCase()}.plugin.js`
    );
    
    await fs.writeFile(pluginPath, pluginCode, 'utf-8');
    await this.loadPlugin(pluginPath);
    
    return { success: true, path: pluginPath };
  }

  // ==================== MANAGEMENT ====================

  async listSkills() {
    return Array.from(this.skills.values()).map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      language: s.language,
      version: s.version,
      enabled: s.enabled,
      loaded: s.loaded
    }));
  }

  async listPlugins() {
    return Array.from(this.plugins.values()).map(p => ({
      name: p.plugin.name,
      version: p.plugin.version,
      description: p.plugin.description,
      loaded: p.loaded
    }));
  }

  async enableSkill(skillId) {
    const skill = this.skills.get(skillId);
    if (skill) {
      skill.enabled = true;
      await this.saveSkillManifest(skill);
    }
  }

  async disableSkill(skillId) {
    const skill = this.skills.get(skillId);
    if (skill) {
      skill.enabled = false;
      await this.saveSkillManifest(skill);
    }
  }

  async saveSkillManifest(skill) {
    const manifestPath = path.join(
      this.skillsDir, 
      `${skill.filename}.manifest.json`
    );
    await fs.writeFile(
      manifestPath, 
      JSON.stringify(skill, null, 2), 
      'utf-8'
    );
  }

  async deleteSkill(skillId) {
    const skill = this.skills.get(skillId);
    if (skill) {
      await fs.unlink(skill.filepath);
      await fs.unlink(`${skill.filepath}.manifest.json`);
      this.skills.delete(skillId);
    }
  }

  // ==================== SKILL DISCOVERY ====================

  async discoverAvailablePlugins() {
    // Entdecke verfügbare Plugins aus verschiedenen Quellen
    return {
      langchain: {
        name: 'LangChain Tools',
        url: 'https://github.com/langchain/langchain',
        compatible: true
      },
      autogen: {
        name: 'AutoGen Framework',
        url: 'https://github.com/microsoft/autogen',
        compatible: true
      },
      openai_plugins: {
        name: 'OpenAI Plugins',
        url: 'https://platform.openai.com/docs/plugins',
        compatible: false // Benötigt Adapter
      }
    };
  }
}

module.exports = PluginManager;
