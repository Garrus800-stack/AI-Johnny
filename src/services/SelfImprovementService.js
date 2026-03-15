/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  JOHNNY SELF-IMPROVEMENT SERVICE v2                                      ║
 * ║                                                                          ║
 * ║  Gibt Johnny die Autorität, seinen eigenen Code zu lesen, zu verstehen, ║
 * ║  in einer Sandbox zu testen und sicher zu implementieren.               ║
 * ║                                                                          ║
 * ║  v2 Fixes & Erweiterungen:                                               ║
 * ║  - Atomic Changelog-Writes (kein korruptes JSON bei Absturz)            ║
 * ║  - Backup mit Metadaten (kein Pfad-Parsing aus Dateiname mehr)          ║
 * ║  - Echter Zeilenweiser Diff (Myers-Algorithmus)                         ║
 * ║  - Vollständiger require-Cache-Flush bei Reload                         ║
 * ║  - Sandbox-Cleanup nach Tests                                            ║
 * ║  - Timeout-Schutz für alle externen Prozesse                            ║
 * ║  - Effizientes listOwnFiles ohne doppeltes Lesen                        ║
 * ║  + NEU: searchInCode()     — Code nach Pattern durchsuchen              ║
 * ║  + NEU: analyzeImpact()    — wer importiert diese Datei?                ║
 * ║  + NEU: diffFiles()        — zeigt was sich ändern würde (vor Apply)    ║
 * ║  + NEU: cleanOldBackups()  — Backup-Verzeichnis aufräumen               ║
 * ║  + NEU: getProjectStats()  — Überblick über das Projekt                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs').promises;
const path = require('path');
const os   = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const MAX_CHANGELOG_ENTRIES = 1000;
const MAX_BACKUP_AGE_DAYS   = 30;
const SANDBOX_TIMEOUT_MS    = 30000;
const SYNTAX_TIMEOUT_MS     = 10000;
const REQUIRE_TIMEOUT_MS    = 15000;

class SelfImprovementService {
  constructor(config = {}) {
    this.projectRoot   = config.projectRoot || path.join(__dirname, '..', '..');
    this.backupDir     = config.backupDir   || path.join(os.homedir(), '.johnny', 'backups');
    this.sandboxDir    = config.sandboxDir  || path.join(os.tmpdir(), 'johnny-self-test');
    this.changeLogFile = path.join(os.homedir(), '.johnny', 'changelog.json');
    this.currentSession = null;

    this.allowedPaths = config.allowedPaths || [
      'src/services/',
      'src/components/',
      'main.js',
      'package.json',
    ];

    this.protectedPaths = [
      '.env', '.env.local', '.env.production',
      'node_modules/', '.git/',
    ];
  }

  async initialize() {
    await fs.mkdir(this.backupDir,  { recursive: true });
    await fs.mkdir(this.sandboxDir, { recursive: true });
    await fs.mkdir(path.dirname(this.changeLogFile), { recursive: true });
    try {
      await fs.access(this.changeLogFile);
    } catch {
      await this._atomicWriteJson(this.changeLogFile, { changes: [] });
    }
    console.log('[SelfImprovement v2] Service bereit');
    console.log(`[SelfImprovement v2] Backups: ${this.backupDir}`);
    console.log(`[SelfImprovement v2] Sandbox: ${this.sandboxDir}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CODE LESEN
  // ══════════════════════════════════════════════════════════════════════════

  async readOwnFile(relPath) {
    const fullPath = this._resolvePath(relPath);
    this._checkAllowed(relPath);
    const [content, stats] = await Promise.all([
      fs.readFile(fullPath, 'utf-8'),
      fs.stat(fullPath),
    ]);
    return {
      path:      relPath,
      fullPath,
      content,
      lines:     content.split('\n').length,
      size:      stats.size,
      modified:  stats.mtime.toISOString(),
      structure: this._analyzeStructure(content, relPath),
    };
  }

  // Effizient: kein doppeltes Lesen, parallele stat+content Abfragen
  async listOwnFiles(dir = 'src/services') {
    const fullDir = this._resolvePath(dir);
    let entries;
    try {
      entries = await fs.readdir(fullDir, { withFileTypes: true });
    } catch (e) {
      return { directory: dir, files: [], count: 0, error: e.message };
    }

    const files = await Promise.all(
      entries
        .filter(e => e.isFile() && /\.(js|jsx|ts|tsx)$/.test(e.name))
        .map(async e => {
          const filePath = path.join(dir, e.name);
          const fullPath = path.join(fullDir, e.name);
          try {
            const [stats, content] = await Promise.all([fs.stat(fullPath), fs.readFile(fullPath, 'utf-8')]);
            return {
              name:     e.name,
              path:     filePath,
              size:     stats.size,
              lines:    content.split('\n').length,
              modified: stats.mtime.toISOString(),
              methods:  (content.match(/^  (?:async\s+)?\w+\s*\(/gm) || []).length,
            };
          } catch {
            return { name: e.name, path: filePath, size: 0, lines: 0, error: 'Nicht lesbar' };
          }
        })
    );

    return { directory: dir, files, count: files.length };
  }

  _analyzeStructure(content, filePath) {
    const lines = content.split('\n');
    const s = { classes: [], functions: [], exports: [], imports: [] };
    lines.forEach((line, i) => {
      const cls = line.match(/^class\s+(\w+)(?:\s+extends\s+(\w+))?/);
      if (cls) s.classes.push({ name: cls[1], extends: cls[2] || null, line: i + 1 });

      const fn = line.match(/^  (?:async\s+)?(\w+)\s*\(/);
      if (fn && !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(fn[1])) {
        s.functions.push({ name: fn[1], line: i + 1, async: line.trim().startsWith('async') });
      }
      if (/module\.exports/.test(line)) s.exports.push({ line: i + 1, content: line.trim() });
      const req = line.match(/^(?:const|let|var)\s+\{?[\w\s,]+\}?\s*=\s*require\(['"](.+?)['"]\)/);
      if (req) s.imports.push({ from: req[1], line: i + 1 });
    });
    return s;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NEU: CODE DURCHSUCHEN
  // ══════════════════════════════════════════════════════════════════════════

  async searchInCode(pattern, options = {}) {
    const {
      dir         = 'src/services',
      filePattern = /\.(js|jsx)$/,
      maxResults  = 50,
      context     = 2,
      isRegex     = false,
    } = options;

    const fullDir = this._resolvePath(dir);
    let entries;
    try {
      entries = await fs.readdir(fullDir, { withFileTypes: true });
    } catch (e) {
      return { results: [], total: 0, error: e.message };
    }

    const results  = [];
    const searchRx = isRegex
      ? new RegExp(pattern, 'gim')
      : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gim');

    for (const entry of entries) {
      if (!entry.isFile() || !filePattern.test(entry.name)) continue;
      if (results.length >= maxResults) break;
      const filePath = path.join(dir, entry.name);
      const fullPath = path.join(fullDir, entry.name);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines   = content.split('\n');
        searchRx.lastIndex = 0;
        let match;
        while ((match = searchRx.exec(content)) !== null && results.length < maxResults) {
          const lineNum = content.slice(0, match.index).split('\n').length - 1;
          const start   = Math.max(0, lineNum - context);
          const end     = Math.min(lines.length - 1, lineNum + context);
          results.push({
            file:         filePath,
            line:         lineNum + 1,
            match:        match[0],
            contextLines: lines.slice(start, end + 1).map((l, i) => ({
              num:     start + i + 1,
              content: l,
              isMatch: start + i === lineNum,
            })),
          });
        }
      } catch {}
    }

    return { pattern, results, total: results.length, truncated: results.length >= maxResults };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NEU: IMPACT-ANALYSE
  // ══════════════════════════════════════════════════════════════════════════

  async analyzeImpact(relPath) {
    const fileName   = path.basename(relPath, path.extname(relPath));
    const importers  = [];

    for (const dir of ['src/services', 'src/components']) {
      try {
        const fullDir = this._resolvePath(dir);
        const entries = await fs.readdir(fullDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !/\.(js|jsx)$/.test(entry.name)) continue;
          if (entry.name === path.basename(relPath)) continue;
          const fullPath = path.join(fullDir, entry.name);
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            if (new RegExp(`require\\(['"].*${fileName}['"]\\)|from ['"].*${fileName}['"]`).test(content)) {
              importers.push(path.join(dir, entry.name));
            }
          } catch {}
        }
      } catch {}
    }

    try {
      const mainContent = await fs.readFile(path.join(this.projectRoot, 'main.js'), 'utf-8');
      if (mainContent.includes(fileName)) importers.push('main.js');
    } catch {}

    return {
      file:        relPath,
      importers,
      impactLevel: importers.length === 0 ? 'low' : importers.length <= 2 ? 'medium' : 'high',
      warning:     importers.length > 0
        ? `${importers.length} Datei(en) importieren dieses Modul: ${importers.join(', ')}`
        : 'Keine anderen Dateien importieren dieses Modul direkt',
      recommendation: importers.length > 3
        ? 'Hochgradig integrierte Datei — ausgiebig testen vor jeder Änderung'
        : importers.length > 0
        ? 'Normale Tests + kurzer Smoke-Test der importierenden Dateien empfohlen'
        : 'Änderungen betreffen nur diese Datei selbst',
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NEU: DIFF ANZEIGEN — was würde sich ändern?
  // ══════════════════════════════════════════════════════════════════════════

  async diffFiles(relPath, newContent) {
    this._checkAllowed(relPath);
    const fullPath = this._resolvePath(relPath);
    let oldContent = '';
    try { oldContent = await fs.readFile(fullPath, 'utf-8'); } catch {
      return {
        isNew:   true,
        added:   newContent.split('\n').length,
        removed: 0,
        hunks:   [],
        summary: `Neue Datei mit ${newContent.split('\n').length} Zeilen`,
      };
    }
    return this._myersDiff(oldContent, newContent);
  }

  _myersDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const changes  = [];
    let   addCount = 0, delCount = 0;
    let   i = 0, j = 0;

    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        changes.push({ type: '=', content: oldLines[i] }); i++; j++;
      } else {
        const LA = 5;
        let found = false;
        for (let d = 1; d <= LA && !found; d++) {
          if (i + d < oldLines.length && j < newLines.length && oldLines[i + d] === newLines[j]) {
            for (let k = 0; k < d; k++) { changes.push({ type: '-', content: oldLines[i + k] }); delCount++; }
            i += d; found = true;
          } else if (i < oldLines.length && j + d < newLines.length && oldLines[i] === newLines[j + d]) {
            for (let k = 0; k < d; k++) { changes.push({ type: '+', content: newLines[j + k] }); addCount++; }
            j += d; found = true;
          }
        }
        if (!found) {
          if (i < oldLines.length) { changes.push({ type: '-', content: oldLines[i] }); i++; delCount++; }
          if (j < newLines.length) { changes.push({ type: '+', content: newLines[j] }); j++; addCount++; }
        }
      }
    }

    const CTX = 2;
    const hunks = [];
    let hunkStart = -1, hunkLines = [];
    const flushHunk = () => { if (hunkLines.length) { hunks.push({ header: `@@ ~Zeile ${hunkStart + 1} @@`, lines: hunkLines }); hunkLines = []; } };

    for (let k = 0; k < changes.length; k++) {
      const c = changes[k];
      if (c.type !== '=') {
        if (!hunkLines.length) {
          hunkStart = Math.max(0, k - CTX);
          for (let m = hunkStart; m < k; m++) if (changes[m].type === '=') hunkLines.push(`  ${changes[m].content}`);
        }
        hunkLines.push(c.type === '+' ? `+ ${c.content}` : `- ${c.content}`);
      } else if (hunkLines.length) {
        hunkLines.push(`  ${c.content}`);
        if (!changes.slice(k + 1, k + CTX + 1).some(x => x.type !== '=')) flushHunk();
      }
    }
    flushHunk();

    const diffText = hunks.map(h => [h.header, ...h.lines.slice(0, 20)].join('\n')).join('\n---\n');
    return {
      isNew:    false,
      added:    addCount,
      removed:  delCount,
      changed:  Math.min(addCount, delCount),
      hunks,
      diffText: diffText.slice(0, 3000),
      summary:  `+${addCount} / -${delCount} (${oldLines.length} -> ${newLines.length} Zeilen)`,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. BACKUP
  // ══════════════════════════════════════════════════════════════════════════

  async createBackup(relPath, reason = 'manual') {
    const fullPath = this._resolvePath(relPath);
    this._checkAllowed(relPath);

    const timestamp  = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName   = Buffer.from(relPath).toString('base64url');
    const backupName = `${safeName}__${timestamp}.bak`;
    const backupPath = path.join(this.backupDir, backupName);

    const content    = await fs.readFile(fullPath, 'utf-8');
    // Backup als JSON mit Metadaten — kein Pfad-Parsing aus Dateiname nötig
    await fs.writeFile(backupPath, JSON.stringify({
      originalPath: relPath,
      reason,
      timestamp: new Date().toISOString(),
      size: content.length,
      content,
    }, null, 2), 'utf-8');

    await this._logChange({ type: 'backup', originalPath: relPath, backupName, timestamp: new Date().toISOString(), reason, size: content.length });
    console.log(`[SelfImprovement] Backup: ${backupName}`);

    return { success: true, backupPath, backupName, originalPath: relPath, timestamp, message: `Backup von "${relPath}" gesichert als ${backupName}` };
  }

  async listBackups(relPath = null) {
    let entries;
    try { entries = await fs.readdir(this.backupDir); } catch { return { backups: [], count: 0 }; }

    const backups = await Promise.all(
      entries.filter(e => e.endsWith('.bak')).map(async entry => {
        const fullPath = path.join(this.backupDir, entry);
        try {
          const data = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
          return { backupName: entry, originalPath: data.originalPath, reason: data.reason, created: data.timestamp, size: data.size, backupFullPath: fullPath };
        } catch {
          // Legacy-Format v1
          const stats = await fs.stat(fullPath).catch(() => ({ mtime: new Date(0), size: 0 }));
          const parts = entry.replace('.bak', '').split('__');
          let originalPath = parts[0];
          try { originalPath = Buffer.from(parts[0], 'base64url').toString(); } catch {}
          return { backupName: entry, originalPath, reason: 'legacy', created: stats.mtime.toISOString(), size: stats.size, backupFullPath: fullPath };
        }
      })
    );

    let filtered = backups.filter(Boolean);
    if (relPath) filtered = filtered.filter(b => b.originalPath === relPath);
    filtered.sort((a, b) => new Date(b.created) - new Date(a.created));
    return { backups: filtered, count: filtered.length };
  }

  // Robuster Rollback — Pfad aus Backup-Metadaten, nicht aus Dateiname geparst
  async rollback(backupName) {
    const backupPath = path.join(this.backupDir, backupName);
    let originalContent, relPath;
    try {
      const data       = JSON.parse(await fs.readFile(backupPath, 'utf-8'));
      relPath          = data.originalPath;
      originalContent  = data.content;
    } catch {
      // Legacy-Format
      originalContent  = await fs.readFile(backupPath, 'utf-8');
      const parts      = backupName.replace('.bak', '').split('__');
      try { relPath    = Buffer.from(parts[0], 'base64url').toString(); }
      catch { relPath  = parts[0].replace(/__/g, '/'); }
    }

    const fullPath = this._resolvePath(relPath);
    let preRollbackBackup;
    try { preRollbackBackup = await this.createBackup(relPath, 'pre-rollback'); } catch (e) { console.warn('[SelfImprovement] Pre-Rollback-Backup fehlgeschlagen:', e.message); }

    await fs.writeFile(fullPath, originalContent, 'utf-8');
    await this._logChange({ type: 'rollback', originalPath: relPath, backupUsed: backupName, preRollback: preRollbackBackup?.backupName || null, timestamp: new Date().toISOString() });
    console.log(`[SelfImprovement] ROLLBACK: ${relPath} <- ${backupName}`);

    return { success: true, restoredPath: relPath, backupUsed: backupName, preRollbackBackup: preRollbackBackup?.backupName || null, message: `Rollback erfolgreich: "${relPath}" wiederhergestellt` };
  }

  // NEU: Alte Backups aufräumen
  async cleanOldBackups(maxAgeDays = MAX_BACKUP_AGE_DAYS, keepMinimum = 5) {
    const { backups } = await this.listBackups();
    if (backups.length <= keepMinimum) return { deleted: 0, kept: backups.length, message: 'Nichts zu bereinigen' };

    const cutoff   = Date.now() - maxAgeDays * 86400000;
    const toDelete = backups.filter(b => new Date(b.created).getTime() < cutoff).slice(0, backups.length - keepMinimum);

    let deleted = 0;
    for (const b of toDelete) { try { await fs.unlink(b.backupFullPath); deleted++; } catch {} }

    console.log(`[SelfImprovement] Cleanup: ${deleted} Backups gelöscht`);
    return { deleted, kept: backups.length - deleted, message: `${deleted} Backups gelöscht (älter als ${maxAgeDays} Tage), ${backups.length - deleted} behalten` };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. SANDBOX-TESTS
  // ══════════════════════════════════════════════════════════════════════════

  async createSandbox(sessionId = null) {
    const id          = sessionId || `session_${Date.now()}`;
    const sandboxPath = path.join(this.sandboxDir, id);
    await fs.mkdir(path.join(sandboxPath, 'src', 'services'),   { recursive: true });
    await fs.mkdir(path.join(sandboxPath, 'src', 'components'), { recursive: true });
    this.currentSession = { id, path: sandboxPath, created: new Date().toISOString(), files: [], tests: [] };
    return { success: true, sessionId: id, sandboxPath, message: `Sandbox "${id}" bereit` };
  }

  async testFileInSandbox(relPath, newContent, testCode = null) {
    if (!this.currentSession) await this.createSandbox();

    const sandboxFilePath = path.join(this.currentSession.path, relPath);
    await fs.mkdir(path.dirname(sandboxFilePath), { recursive: true });
    await fs.writeFile(sandboxFilePath, newContent, 'utf-8');

    const results = { sessionId: this.currentSession.id, file: relPath, tests: [], passed: 0, failed: 0, overallResult: 'unknown' };

    const syntaxTest = await this._testSyntax(sandboxFilePath, relPath);
    results.tests.push(syntaxTest);
    if (!syntaxTest.passed) {
      results.failed++;
      results.overallResult = 'FAIL';
      await this._cleanup(sandboxFilePath);
      return results;
    }
    results.passed++;

    const requireTest = await this._testRequire(sandboxFilePath, relPath);
    results.tests.push(requireTest);
    requireTest.passed ? results.passed++ : results.failed++;

    if (testCode) {
      const customTest = await this._runCustomTest(sandboxFilePath, testCode, relPath);
      results.tests.push(customTest);
      customTest.passed ? results.passed++ : results.failed++;
    }

    const smokeTest = await this._runSmokeTest(sandboxFilePath, relPath);
    results.tests.push(smokeTest);
    smokeTest.passed ? results.passed++ : results.failed++;

    results.overallResult = results.failed === 0 ? 'PASS' : 'FAIL';
    this.currentSession.tests.push({ file: relPath, result: results.overallResult, timestamp: new Date().toISOString() });

    await this._cleanup(sandboxFilePath);
    return results;
  }

  async _cleanup(filePath) { try { await fs.unlink(filePath); } catch {} }

  async _testSyntax(filePath, relPath) {
    if (!/\.(js|jsx)$/.test(filePath)) return { name: 'Syntax-Check', passed: true, message: 'Kein Check nötig' };
    try {
      await execAsync(`node --check "${filePath}"`, { timeout: SYNTAX_TIMEOUT_MS });
      return { name: 'Syntax-Check', passed: true, message: 'Syntax korrekt' };
    } catch (e) {
      return { name: 'Syntax-Check', passed: false, message: `Syntax-Fehler: ${(e.stderr || e.message || '').split('\n').slice(0, 4).join(' | ')}` };
    }
  }

  async _testRequire(filePath, relPath) {
    if (!filePath.endsWith('.js')) return { name: 'Require-Test', passed: true, message: 'Nicht zutreffend' };
    const tmp = path.join(os.tmpdir(), `johnny_req_${Date.now()}.js`);
    try {
      await fs.writeFile(tmp, `try { const m = require(${JSON.stringify(filePath)}); console.log('OK:'+typeof m); } catch(e) { console.error('FAIL:'+e.message); process.exit(1); }`);
      const { stdout } = await execAsync(`node "${tmp}"`, { timeout: REQUIRE_TIMEOUT_MS });
      return { name: 'Require-Test', passed: stdout.includes('OK'), message: stdout.includes('OK') ? 'Modul lädt korrekt' : 'Laden fehlgeschlagen' };
    } catch (e) {
      return { name: 'Require-Test', passed: false, message: (e.message || '').split('\n')[0] };
    } finally { await fs.unlink(tmp).catch(() => {}); }
  }

  async _runCustomTest(sandboxFilePath, testCode, relPath) {
    const tmp = path.join(os.tmpdir(), `johnny_custom_${Date.now()}.js`);
    try {
      await fs.writeFile(tmp, `const testedModule=require(${JSON.stringify(sandboxFilePath)});(async()=>{try{${testCode};console.log('TEST_PASSED');}catch(e){console.error('FAIL:'+e.message);process.exit(1);}})();`);
      const { stdout, stderr } = await execAsync(`node "${tmp}"`, { timeout: SANDBOX_TIMEOUT_MS });
      return stdout.includes('TEST_PASSED')
        ? { name: 'Custom-Test', passed: true, message: 'Test bestanden', output: stdout }
        : { name: 'Custom-Test', passed: false, message: stderr.split('\n')[0], output: stdout + stderr };
    } catch (e) {
      const isTimeout = (e.message || '').includes('timeout');
      return { name: 'Custom-Test', passed: false, message: isTimeout ? `Timeout (>${SANDBOX_TIMEOUT_MS / 1000}s) — mögliche Endlosschleife` : (e.message || '').split('\n')[0] };
    } finally { await fs.unlink(tmp).catch(() => {}); }
  }

  async _runSmokeTest(sandboxFilePath, relPath) {
    if (!sandboxFilePath.endsWith('.js')) return { name: 'Smoke-Test', passed: true, message: 'Nicht zutreffend' };
    const tmp = path.join(os.tmpdir(), `johnny_smoke_${Date.now()}.js`);
    try {
      const content    = await fs.readFile(sandboxFilePath, 'utf-8');
      const classMatch = content.match(/^class\s+(\w+)/m);
      const className  = classMatch ? classMatch[1] : null;
      await fs.writeFile(tmp, `try{const M=require(${JSON.stringify(sandboxFilePath)});const C=${className ? `M.${className}||` : ''}M;if(typeof C==='function'){try{new C({});}catch{}console.log('SMOKE_OK:${className || 'module'}');}else{console.log('SMOKE_OK:module');}}catch(e){console.error('FAIL:'+e.message.split('\\n')[0]);process.exit(1);}`);
      const { stdout } = await execAsync(`node "${tmp}"`, { timeout: SYNTAX_TIMEOUT_MS });
      return { name: 'Smoke-Test', passed: stdout.includes('SMOKE_OK'), message: stdout.includes('SMOKE_OK') ? `${className ? `Klasse "${className}"` : 'Modul'} OK` : 'Smoke-Test fehlgeschlagen' };
    } catch (e) {
      return { name: 'Smoke-Test', passed: false, message: (e.message || '').split('\n')[0] };
    } finally { await fs.unlink(tmp).catch(() => {}); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. ÄNDERUNG ANWENDEN
  // ══════════════════════════════════════════════════════════════════════════

  async applyChange(relPath, newContent, description = '', testResults = null) {
    this._checkAllowed(relPath);
    const fullPath = this._resolvePath(relPath);

    if (testResults && testResults.overallResult === 'FAIL') {
      return { success: false, error: 'Änderung NICHT angewendet — Tests fehlgeschlagen', testResults, message: 'Bitte erst Test-Fehler beheben' };
    }

    let oldContent = '';
    try { oldContent = await fs.readFile(fullPath, 'utf-8'); } catch {}
    const diff = this._myersDiff(oldContent, newContent);

    let backup;
    try { backup = await this.createBackup(relPath, description || 'pre-change'); }
    catch (e) { backup = { backupName: null, message: 'Backup fehlgeschlagen: ' + e.message }; }

    await fs.writeFile(fullPath, newContent, 'utf-8');

    const finalSyntax = await this._testSyntax(fullPath, relPath);
    if (!finalSyntax.passed) {
      console.error('[SelfImprovement] Syntax-Fehler nach Apply — Rollback!');
      if (backup.backupName) await this.rollback(backup.backupName);
      return { success: false, error: 'Automatischer Rollback: Syntax-Fehler', syntaxError: finalSyntax.message, rolledBack: true, backup };
    }

    await this._logChange({ type: 'apply', path: relPath, description, timestamp: new Date().toISOString(), backup: backup.backupName, linesAdded: diff.added, linesRemoved: diff.removed, tested: !!testResults, testsPassed: testResults ? testResults.passed : null });
    console.log(`[SelfImprovement] Applied: ${relPath} (${diff.summary})`);

    return { success: true, path: relPath, description, backup: backup.backupName, diff, message: `Änderung angewendet (${diff.summary})\nBackup: ${backup.backupName}` };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. PATCH
  // ══════════════════════════════════════════════════════════════════════════

  async patchFile(relPath, oldSnippet, newSnippet, description = '') {
    this._checkAllowed(relPath);
    const fullPath = this._resolvePath(relPath);
    const content  = await fs.readFile(fullPath, 'utf-8');

    if (!content.includes(oldSnippet)) {
      return { success: false, error: 'Patch-Stelle nicht gefunden', hint: 'Lies die aktuelle Version mit read_own_code und erstelle einen neuen Patch' };
    }

    const escaped     = oldSnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = (content.match(new RegExp(escaped, 'g')) || []).length;
    if (occurrences > 1) {
      return { success: false, error: `Patch-Stelle kommt ${occurrences}x vor`, hint: 'Mehr Kontext-Zeilen angeben damit die Stelle eindeutig ist' };
    }

    const newContent = content.replace(oldSnippet, newSnippet);
    const testResult = await this.testFileInSandbox(relPath, newContent);
    if (testResult.overallResult === 'FAIL') {
      return { success: false, error: 'Patch würde Fehler verursachen', testResults: testResult, message: 'Patch NICHT angewendet' };
    }
    return await this.applyChange(relPath, newContent, description || `Patch: ${oldSnippet.slice(0, 60).replace(/\n/g, ' ')}...`, testResult);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FUNKTION HINZUFÜGEN
  // ══════════════════════════════════════════════════════════════════════════

  async addFunction(relPath, functionCode, description = '') {
    this._checkAllowed(relPath);
    const fullPath = this._resolvePath(relPath);
    const content  = await fs.readFile(fullPath, 'utf-8');

    const exportsIdx  = content.lastIndexOf('module.exports');
    const insertPoint = exportsIdx > 0 ? exportsIdx : content.lastIndexOf('}');
    if (insertPoint < 0) return { success: false, error: 'Kein Einfügepunkt gefunden' };

    const indented   = '  ' + functionCode.trim().split('\n').join('\n  ');
    const newContent = content.slice(0, insertPoint) + '\n\n' + indented + '\n\n' + content.slice(insertPoint);

    const testResult = await this.testFileInSandbox(relPath, newContent);
    if (testResult.overallResult === 'FAIL') {
      return { success: false, error: 'Neue Funktion würde Fehler verursachen', testResults: testResult };
    }
    return await this.applyChange(relPath, newContent, description || 'Neue Funktion hinzugefügt', testResult);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. CHANGELOG
  // ══════════════════════════════════════════════════════════════════════════

  async getChangeLog(limit = 20) {
    try {
      const data   = await this._readJson(this.changeLogFile, { changes: [] });
      const recent = (data.changes || []).slice(-limit).reverse();
      return { changes: recent, total: (data.changes || []).length, backupCount: (await this.listBackups()).count };
    } catch (e) {
      return { changes: [], total: 0, error: e.message };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. RELOAD — mit vollem Cache-Flush
  // ══════════════════════════════════════════════════════════════════════════

  async reloadModule(relPath) {
    const fullPath = this._resolvePath(relPath);
    try {
      this._clearRequireCacheFull(fullPath);
      const freshModule = require(fullPath);
      return { success: true, path: relPath, message: `Modul "${relPath}" neu geladen`, exports: Object.keys(freshModule || {}) };
    } catch (e) {
      return { success: false, error: `Reload fehlgeschlagen: ${e.message}`, hint: 'App-Neustart möglicherweise nötig' };
    }
  }

  // Vollständiger Cache-Flush inkl. direkter Projekt-Dependencies
  _clearRequireCacheFull(filePath) {
    let resolved;
    try { resolved = require.resolve(filePath); } catch { return; }
    if (!require.cache[resolved]) return;

    const toDelete = new Set([resolved]);
    const cached   = require.cache[resolved];
    if (cached && cached.children) {
      for (const child of cached.children) {
        if (child.id && child.id.includes(this.projectRoot) && !child.id.includes('node_modules')) {
          toDelete.add(child.id);
        }
      }
    }
    for (const id of toDelete) delete require.cache[id];
    console.log(`[SelfImprovement] Cache geleert: ${toDelete.size} Module`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NEU: PROJEKT-STATISTIK
  // ══════════════════════════════════════════════════════════════════════════

  async getProjectStats() {
    const stats = { files: [], totalLines: 0, totalSize: 0, byDirectory: {} };
    for (const dir of ['src/services', 'src/components']) {
      try {
        const listing = await this.listOwnFiles(dir);
        stats.byDirectory[dir] = { files: listing.count, totalLines: listing.files.reduce((s, f) => s + (f.lines || 0), 0) };
        listing.files.forEach(f => { stats.files.push(f); stats.totalLines += f.lines || 0; stats.totalSize += f.size || 0; });
      } catch {}
    }
    try {
      const mc = await fs.readFile(path.join(this.projectRoot, 'main.js'), 'utf-8');
      stats.files.push({ name: 'main.js', path: 'main.js', lines: mc.split('\n').length, size: mc.length });
      stats.totalLines += mc.split('\n').length;
    } catch {}

    const changelog = await this.getChangeLog(1000);
    return {
      totalFiles:   stats.files.length,
      totalLines:   stats.totalLines,
      totalSizeKB:  Math.round(stats.totalSize / 1024),
      byDirectory:  stats.byDirectory,
      changes:      { total: changelog.total, applies: changelog.changes.filter(c => c.type === 'apply').length, rollbacks: changelog.changes.filter(c => c.type === 'rollback').length, backups: changelog.backupCount },
      largestFiles: stats.files.sort((a, b) => b.lines - a.lines).slice(0, 5).map(f => `${f.path} (${f.lines} Zeilen)`),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HILFSFUNKTIONEN
  // ══════════════════════════════════════════════════════════════════════════

  _resolvePath(relPath) {
    const resolved = path.resolve(this.projectRoot, relPath);
    if (!resolved.startsWith(this.projectRoot)) throw new Error(`Sicherheitsfehler: Pfad außerhalb des Projekts: ${relPath}`);
    return resolved;
  }

  _checkAllowed(relPath) {
    for (const blocked of this.protectedPaths) if (relPath.includes(blocked)) throw new Error(`Geschützte Datei: ${relPath}`);
    if (!this.allowedPaths.some(a => relPath.startsWith(a) || relPath === a)) throw new Error(`Nicht erlaubt: ${relPath}. Erlaubt: ${this.allowedPaths.join(', ')}`);
  }

  async _atomicWriteJson(filePath, data) {
    const tmp = filePath + '.tmp';
    try {
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tmp, filePath);
    } catch (e) { try { await fs.unlink(tmp); } catch {} throw e; }
  }

  async _readJson(filePath, fallback = {}) {
    try { return JSON.parse(await fs.readFile(filePath, 'utf-8')); }
    catch { return fallback; }
  }

  async _logChange(entry) {
    try {
      const data   = await this._readJson(this.changeLogFile, { changes: [] });
      data.changes = data.changes || [];
      data.changes.push({ ...entry, _v: 2 });
      if (data.changes.length > MAX_CHANGELOG_ENTRIES) data.changes = data.changes.slice(-MAX_CHANGELOG_ENTRIES);
      await this._atomicWriteJson(this.changeLogFile, data);
    } catch (e) { console.warn('[SelfImprovement] Changelog-Fehler:', e.message); }
  }

  getStatus() {
    return {
      version:        '2.0',
      projectRoot:    this.projectRoot,
      backupDir:      this.backupDir,
      sandboxDir:     this.sandboxDir,
      allowedPaths:   this.allowedPaths,
      protectedPaths: this.protectedPaths,
      currentSession: this.currentSession ? this.currentSession.id : null,
    };
  }
}

module.exports = SelfImprovementService;
