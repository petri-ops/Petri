#!/usr/bin/env node
/**
 * scripts/import-external-plugin.mjs — BLOCK-444 外部 Agent 插件导入器。
 *
 * 目标：把 ZCode / Claude Code / Codex / CodeBuddy 等插件的「可迁移部分」投影成 Petri 资产，
 * 让别人的插件尽量「拿来即用」；不可迁移部分**显式诊断**，绝不静默丢弃。
 *
 * 可迁移（真实消费方存在）：
 *   - skills/<name>/SKILL.md 或 skill.json → Petri 技能（skill-registry 原生双格式）
 *   - .mcp.json / mcpServers          → Petri MCP 配置片段（stdio/http/sse）
 *   - commands/<name>.md              → 命令模板（Petri 无 slash 命令运行时，落模板清单）
 *
 * 不可迁移（Petri 无对应运行时，只诊断）：
 *   - extension.main（JS 扩展进程 + 能力表 RPC + contributes.views/slots）
 *   - hooks/（钩子运行时）
 *   - ui.surfaces / 工具 _meta.ui（MCP App / ext-apps 交互页面；Petri 的 gen-ui 是自有协议）
 *
 * 安全边界：本脚本**从不执行**插件代码，也不 require 插件里的 JS；只读清单与 Markdown。
 *
 * 用法：
 *   node scripts/import-external-plugin.mjs --source <pluginDir> [--apply] [--data-dir <dir>]
 *   node scripts/import-external-plugin.mjs --zip <plugin.zip>  [--apply] [--data-dir <dir>]
 *   --json   机器可读输出（默认人读摘要）
 *   --apply  真实写入（默认 dry-run：只校验与报告）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  MANIFEST_CANDIDATES,
  resolvePluginRoot,
  scanPluginSources,
  synthesizeCommandSkills,
} from './lib/agent-plugin-sources.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAX_SKILL_FILES = 500;
const MAX_SKILL_BYTES = 10 * 1024 * 1024;
const MAX_REPORT_ITEMS = 200;


const UNSUPPORTED_DIRS = [
  { dir: 'hooks', capability: 'hooks', reason: 'Petri 无钩子运行时（事件拦截/注入不在当前产品面内）' },
  { dir: 'agents', capability: 'subagents', reason: 'Petri 无插件级子代理注册面' },
];

const listFiles = (dir, limit = MAX_SKILL_FILES) => {
  const out = [];
  const walk = (d) => {
    if (out.length >= limit) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue; // 不跟随软链（防逃逸）
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out;
};

const dirSize = (dir) => listFiles(dir, 10_000).reduce((a, f) => {
  try { return a + fs.statSync(f).size; } catch { return a; }
}, 0);

const readJsonSafe = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

/** 解析 SKILL.md 的 frontmatter（只读，不执行）；与 skill-registry 的受限解析同口径。 */
function parseSkillMd(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const front = new Map();
  let body = raw;
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end > 0) {
      for (const line of raw.slice(3, end).split('\n')) {
        const m = line.match(/^([A-Za-z_][\w.-]*):\s*(.*)$/);
        if (m) front.set(m[1].toLowerCase(), m[2].trim().replace(/^["']|["']$/g, ''));
      }
      body = raw.slice(end + 4).trim();
    }
  }
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
  return {
    name: front.get('name') || '',
    description: front.get('description') || firstLine,
    keys: [...front.keys()],
  };
}

/** 归一 MCP server 声明 → Petri 形态（与 /api/mcp/servers 的字段一致）。 */
function normalizeMcpServers(raw, source, options = {}) {
  const servers = [];
  if (!raw || typeof raw !== 'object') return { servers, diagnostics: [] };
  // BLOCK-444（真实插件实测）：清单里没有 mcpServers 时，不能把整个 manifest 当服务器表
  //（否则 name/version 等字符串会被判成 mcp_entry_not_object，产生假诊断）。
  const bag = raw.mcpServers && typeof raw.mcpServers === 'object'
    ? raw.mcpServers
    : (options.fromManifest ? null : raw);
  if (!bag) return { servers, diagnostics: [] };
  const map = bag;
  const diagnostics = [];
  for (const [id, cfg] of Object.entries(map)) {
    if (!cfg || typeof cfg !== 'object') {
      diagnostics.push({ id, code: 'mcp_entry_not_object', source });
      continue;
    }
    const url = typeof cfg.url === 'string' ? cfg.url : '';
    const transport = url ? (cfg.transport === 'sse' ? 'sse' : 'http') : 'stdio';
    if (transport === 'stdio' && typeof cfg.command !== 'string') {
      diagnostics.push({ id, code: 'mcp_command_missing', source });
      continue;
    }
    if (transport !== 'stdio' && !url) {
      diagnostics.push({ id, code: 'mcp_url_missing', source });
      continue;
    }
    servers.push({
      id: String(id).slice(0, 80),
      transport,
      ...(transport === 'stdio'
        ? {
            command: cfg.command,
            args: Array.isArray(cfg.args) ? cfg.args.filter((a) => typeof a === 'string') : [],
            env: cfg.env && typeof cfg.env === 'object' ? cfg.env : {},
          }
        : { url, ...(cfg.headers && typeof cfg.headers === 'object' ? { headers: cfg.headers } : {}) }),
      importedFrom: source,
    });
  }
  return { servers, diagnostics };
}

/** 命令 Markdown → 模板（Petri 无 slash 命令运行时；模板可被用户复制进对话）。 */
function readCommandTemplates(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).slice(0, MAX_REPORT_ITEMS)) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const file = path.join(dir, e.name);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const front = new Map();
    if (text.startsWith('---')) {
      const end = text.indexOf('\n---', 3);
      if (end > 0) {
        for (const line of text.slice(3, end).split('\n')) {
          const m = line.match(/^([A-Za-z_][\w.-]*):\s*(.*)$/);
          if (m) front.set(m[1].toLowerCase(), m[2].trim());
        }
        text = text.slice(end + 4).trim();
      }
    }
    out.push({
      name: e.name.replace(/\.md$/, ''),
      description: front.get('description') || '',
      body: text.slice(0, 4000),
    });
  }
  return out;
}

/**
 * 纯函数主流程（可测试）：只读 + 可选写入，不执行插件代码。
 * @param {{sourceDir?:string, zipFile?:string, apply?:boolean, dataDir?:string}} options
 */
export async function importExternalPlugin(options = {}) {
  const report = {
    ok: false,
    plugin: { id: null, name: null, version: null, manifestPath: null },
    imported: { skills: [], mcpServers: [], commandTemplates: [] },
    skipped: [],
    unsupported: [],
    diagnostics: [],
    notes: [],
    applied: false,
    dataDir: null,
  };

  let workDir = options.sourceDir ? path.resolve(options.sourceDir) : '';
  let tempDir = null;
  if (!workDir && options.zipFile) {
    const zipPath = path.resolve(options.zipFile);
    if (!fs.existsSync(zipPath)) {
      report.diagnostics.push({ code: 'zip_not_found', path: zipPath });
      return report;
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-plugin-'));
    try {
      const { extractZipFile } = require(path.join(ROOT, 'src', 'plugin-manager.js'));
      await extractZipFile(zipPath, tempDir);
    } catch (e) {
      report.diagnostics.push({ code: 'zip_extract_failed', message: String(e && e.message || e).slice(0, 200) });
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      return report;
    }
    workDir = tempDir;
  }
  if (!workDir || !fs.existsSync(workDir)) {
    report.diagnostics.push({ code: 'source_not_found', path: workDir || '(none)' });
    return report;
  }

  const found = resolvePluginRoot(workDir);
  if (!found) {
    report.diagnostics.push({ code: 'manifest_not_found', path: workDir, candidates: MANIFEST_CANDIDATES });
    if (tempDir) try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    return report;
  }

  const { root, manifestPath, manifest } = found;
  report.plugin = {
    id: String(manifest.id || manifest.name || path.basename(root)).slice(0, 80),
    name: String(manifest.name || manifest.title || '').slice(0, 120),
    version: String(manifest.version || '').slice(0, 40),
    manifestPath: manifestPath ? path.relative(workDir, manifestPath) : null,
    agent: found.agent,
    singleSkill: found.singleSkill,
  };

  // ① skills —— 可直接投影（Petri skill-registry 原生支持 SKILL.md / skill.json）
  const skillsDir = found.singleSkill ? root : path.join(root, 'skills');
  if (found.singleSkill && fs.existsSync(skillsDir)) {
    const hasMd = fs.existsSync(path.join(root, 'SKILL.md'));
    const meta = hasMd ? parseSkillMd(path.join(root, 'SKILL.md')) : { name: '', description: '', keys: [] };
    report.imported.skills.push({
      id: path.basename(root),
      name: meta.name || path.basename(root),
      description: String(meta.description || '').slice(0, 200),
      sourceDir: root,
      format: hasMd ? 'SKILL.md' : 'skill.json',
      frontmatterKeys: meta.keys,
    });
  }
  if (fs.existsSync(skillsDir) && !found.singleSkill) {
    let entries = [];
    try { entries = fs.readdirSync(skillsDir, { withFileTypes: true }); } catch { entries = []; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const d = path.join(skillsDir, e.name);
      const hasMd = fs.existsSync(path.join(d, 'SKILL.md'));
      const hasJson = fs.existsSync(path.join(d, 'skill.json'));
      if (!hasMd && !hasJson) {
        report.skipped.push({ kind: 'skill', id: e.name, reason: 'no SKILL.md / skill.json' });
        continue;
      }
      const files = listFiles(d);
      const bytes = dirSize(d);
      if (files.length > MAX_SKILL_FILES || bytes > MAX_SKILL_BYTES) {
        report.skipped.push({ kind: 'skill', id: e.name, reason: 'too_large', files: files.length, bytes });
        continue;
      }
      const meta = hasMd ? parseSkillMd(path.join(d, 'SKILL.md')) : { name: '', description: '', keys: [] };
      report.imported.skills.push({
        id: e.name,
        name: meta.name || e.name,
        description: String(meta.description || '').slice(0, 200),
        sourceDir: d,
        format: hasJson ? 'skill.json' : 'SKILL.md',
        frontmatterKeys: meta.keys,
      });
    }
  }

  // ② MCP servers —— .mcp.json / 清单内 mcpServers
  const mcpCandidates = [
    path.join(root, '.mcp.json'),
    path.join(root, '.claude-plugin', '.mcp.json'),
    manifestPath,
  ];
  for (const p of mcpCandidates) {
    if (!fs.existsSync(p)) continue;
    const fromManifest = p === manifestPath;
    const raw = fromManifest ? { mcpServers: manifest.mcpServers } : readJsonSafe(p);
    if (!raw) continue;
    const { servers, diagnostics } = normalizeMcpServers(raw, path.relative(workDir, p), { fromManifest });
    if (servers.length > 0 || diagnostics.length > 0) {
      report.imported.mcpServers.push(...servers);
      report.diagnostics.push(...diagnostics);
      break;
    }
  }

  // ③ commands —— 模板投影（Petri 无 slash 运行时）
  const commandsDir = path.join(root, 'commands');
  if (fs.existsSync(commandsDir)) {
    report.imported.commandTemplates = readCommandTemplates(commandsDir);
    if (report.imported.commandTemplates.length > 0) {
      report.unsupported.push({
        capability: 'slash-commands',
        reason: 'Petri 无原生 slash 命令运行时；已投影为命令模板，--apply 时默认转成可直接引用的合成技能',
        files: report.imported.commandTemplates.map((c) => `commands/${c.name}.md`).slice(0, 20),
      });
    }
  }

  // ④ 不可迁移能力诊断（显式列出，不静默丢弃）
  if (manifest.extension && typeof manifest.extension === 'object') {
    const ext = manifest.extension;
    const contributes = ext.contributes && typeof ext.contributes === 'object' ? ext.contributes : {};
    report.unsupported.push({
      capability: 'extension-host',
      reason: 'ZCode 扩展进程模型（extension.main + 能力表 RPC + contributes.views/slots）在 Petri 无对应运行时',
      detail: {
        main: typeof ext.main === 'string' ? ext.main : null,
        activationEvents: Array.isArray(ext.activationEvents) ? ext.activationEvents : [],
        contributes: Object.keys(contributes),
      },
    });
  }
  if (manifest.ui && typeof manifest.ui === 'object') {
    report.unsupported.push({
      capability: 'mcp-apps-ui',
      reason: 'MCP App / ext-apps 页面（ui.surfaces / _meta.ui.resourceUri）需 MCP Apps 渲染层；Petri 的 gen-ui 是自有 petri-genui:// 协议',
      detail: Object.keys(manifest.ui),
    });
  }
  for (const u of UNSUPPORTED_DIRS) {
    const d = path.join(root, u.dir);
    if (!fs.existsSync(d)) continue;
    const files = listFiles(d).map((f) => path.relative(root, f)).slice(0, 20);
    if (files.length === 0) continue;
    report.unsupported.push({ capability: u.capability, reason: u.reason, files });
  }

  // ⑤ 可选写入（dry-run 默认）
  if (options.apply) {
    const dataDir = path.resolve(options.dataDir || process.env.PETRI_USER_DATA_DIR || path.join(os.homedir(), '.petri'));
    report.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });

    // BLOCK-445：命令模板默认投影成技能（Petri 无 slash 运行时，但技能可在对话里引用）。
    let commandSkillsTemp = null;
    if (options.commandsAsSkills !== false && report.imported.commandTemplates.length > 0) {
      commandSkillsTemp = fs.mkdtempSync(path.join(os.tmpdir(), `cmd-skills-${report.plugin.id}-`));
      const synthetic = synthesizeCommandSkills(report.imported.commandTemplates, commandSkillsTemp, {
        prefix: `cmd-${report.plugin.id}`,
      });
      for (const sk of synthetic) {
        report.imported.skills.push({
          id: sk.id, name: sk.id, description: `命令模板：${sk.id}`,
          sourceDir: sk.sourceDir, format: 'SKILL.md', frontmatterKeys: [], synthetic: true,
        });
      }
      report.notes.push('commands/ 已投影为合成技能（非原生 slash 命令）');
    }

    const registry = require(path.join(ROOT, 'core', 'shared-backend', 'skill-registry.js'));
    const prevUserData = process.env.PETRI_USER_DATA_DIR;
    process.env.PETRI_USER_DATA_DIR = dataDir;
    try {
      for (const s of report.imported.skills) {
        const r = registry.installSkillFromDir(s.sourceDir);
        if (r && r.ok) {
          s.installed = true;
          s.installedId = r.skillId;
        } else {
          s.installed = false;
          s.error = (r && (r.error || r.message)) || 'install_failed';
        }
      }
    } finally {
      if (prevUserData === undefined) delete process.env.PETRI_USER_DATA_DIR;
      else process.env.PETRI_USER_DATA_DIR = prevUserData;
    }

    // BLOCK-444（真实插件实测）：MCP server 的脚本通常在插件目录内（如
    // `${ZCODE_PLUGIN_ROOT}/dist/server.mjs`），只导入 skills 会让该路径失效。
    // apply 时把整个插件目录复制到 dataDir/external-plugins/<id>，并替换 ROOT 变量。
    const pluginCopyDir = path.join(dataDir, 'external-plugins', report.plugin.id);
    try {
      fs.rmSync(pluginCopyDir, { recursive: true, force: true });
      fs.cpSync(root, pluginCopyDir, {
        recursive: true,
        filter: (src) => !src.split(path.sep).includes('node_modules'),
      });
      report.pluginCopyDir = pluginCopyDir;
      const vars = new Map([
        ['ZCODE_PLUGIN_ROOT', pluginCopyDir],
        ['CLAUDE_PLUGIN_ROOT', pluginCopyDir],
        ['CODEX_PLUGIN_ROOT', pluginCopyDir],
      ]);
      const substitute = (v) => {
        if (typeof v === 'string') {
          return v.replace(/\$\{([A-Z0-9_]+)\}/g, (m, k) => (vars.has(k) ? vars.get(k) : m));
        }
        if (Array.isArray(v)) return v.map(substitute);
        if (v && typeof v === 'object') {
          return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, substitute(val)]));
        }
        return v;
      };
      report.imported.mcpServers = report.imported.mcpServers.map((srv) => substitute(srv));
    } catch (e) {
      report.diagnostics.push({ code: 'plugin_copy_failed', message: String(e && e.message || e).slice(0, 160) });
    }
    // 插件内 MCP server 若带 npm 依赖，需要用户在该目录 npm install（不自动联网安装）
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = readJsonSafe(pkgPath);
      const deps = pkg && pkg.dependencies && typeof pkg.dependencies === 'object' ? Object.keys(pkg.dependencies) : [];
      const hasBuild = Boolean(pkg && pkg.scripts && pkg.scripts.build);
      if (deps.length > 0 || hasBuild) {
        report.requiresInstall = {
          dir: report.pluginCopyDir || root,
          dependencies: deps.slice(0, 20),
          buildScript: hasBuild ? String(pkg.scripts.build).slice(0, 120) : null,
          hint: '在该目录执行 npm install' + (hasBuild ? ' && npm run build' : '') + ' 后，MCP server 才能启动',
        };
      }
    }
    // BLOCK-444（真实插件实测）：ZCode 插件多为 TS 源码，dist/server.mjs 需先构建；
    // 若配置里引用的脚本不存在，显式诊断（保留配置，但明确告知「现在起不来」）。
    const missingScripts = [];
    for (const srv of report.imported.mcpServers) {
      if (srv.transport !== 'stdio' || !Array.isArray(srv.args)) continue;
      for (const a of srv.args) {
        if (typeof a === 'string' && report.pluginCopyDir && a.startsWith(report.pluginCopyDir) && !fs.existsSync(a)) {
          missingScripts.push({ serverId: srv.id, path: a });
        }
      }
    }
    if (missingScripts.length > 0) {
      report.diagnostics.push({
        code: 'mcp_entry_script_missing',
        entries: missingScripts.slice(0, 10),
        message: 'MCP server 引用的脚本不存在（多为插件源码未构建）；先在该插件目录构建，否则该 server 启动会失败',
      });
    }

    if (report.imported.mcpServers.length > 0) {
      const out = path.join(dataDir, 'mcp-imported.json');
      fs.writeFileSync(out, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        plugin: report.plugin,
        servers: report.imported.mcpServers,
        note: '把 servers[] 逐条 POST /api/mcp/servers 或合并进应用 MCP 设置；此处只落转换结果，不改用户配置。',
      }, null, 2)}\n`);
      report.mcpOutputPath = out;
    }
    if (report.imported.commandTemplates.length > 0) {
      const out = path.join(dataDir, 'command-templates.json');
      fs.writeFileSync(out, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        plugin: report.plugin,
        commands: report.imported.commandTemplates,
      }, null, 2)}\n`);
      report.commandOutputPath = out;
    }
    if (commandSkillsTemp) {
      try { fs.rmSync(commandSkillsTemp, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    report.applied = true;
  }

  report.ok = report.imported.skills.length > 0
    || report.imported.mcpServers.length > 0
    || report.imported.commandTemplates.length > 0;
  if (tempDir) try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  return report;
}

function formatHuman(r) {
  const lines = [];
  lines.push(`插件: ${r.plugin.id || '(unknown)'}  version=${r.plugin.version || '-'}  manifest=${r.plugin.manifestPath || '-'}`);
  lines.push(`可迁移: skills=${r.imported.skills.length}  mcp=${r.imported.mcpServers.length}  commands=${r.imported.commandTemplates.length}`);
  for (const s of r.imported.skills) {
    lines.push(`  [skill] ${s.id} (${s.format})${s.installed === undefined ? '' : s.installed ? ' → 已安装' : ` → 失败: ${s.error}`}`);
  }
  for (const m of r.imported.mcpServers) {
    lines.push(`  [mcp]   ${m.id} (${m.transport}) ${m.transport === 'stdio' ? m.command : m.url}`);
  }
  for (const c of r.imported.commandTemplates) lines.push(`  [cmd]   ${c.name}`);
  if (r.unsupported.length > 0) {
    lines.push('不可迁移（需对应运行时）:');
    for (const u of r.unsupported) lines.push(`  ✗ ${u.capability}: ${u.reason}`);
  }
  for (const d of r.diagnostics) lines.push(`  ! ${d.code}${d.path ? ` ${d.path}` : ''}${d.message ? ` — ${d.message}` : ''}`);
  for (const s of r.skipped) lines.push(`  - skip ${s.kind}/${s.id}: ${s.reason}`);
  if (r.applied) {
    lines.push(`已写入: dataDir=${r.dataDir}${r.mcpOutputPath ? ` mcp=${r.mcpOutputPath}` : ''}${r.commandOutputPath ? ` commands=${r.commandOutputPath}` : ''}`);
  } else {
    lines.push('（dry-run：未写入；加 --apply 生效）');
  }
  return lines.join('\n');
}

function parseArgs(list) {
  const out = { apply: false, json: false };
  const it = list[Symbol.iterator]();
  const take = () => {
    const n = it.next();
    return n.done ? undefined : n.value;
  };
  for (let step = it.next(); !step.done; step = it.next()) {
    const a = step.value;
    if (a === '--apply') out.apply = true;
    else if (a === '--json') out.json = true;
    else if (a === '--source') out.sourceDir = take();
    else if (a === '--zip') out.zipFile = take();
    else if (a === '--data-dir') out.dataDir = take();
    else if (a === '--scan') out.scan = true;
    else if (a === '--scan-root') {
      if (!Array.isArray(out.scanRoots)) out.scanRoots = [];
      out.scanRoots.push(take());
    } else if (a === '--no-command-skills') out.commandsAsSkills = false;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const isCli = (() => {
  try { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();

if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  const usage = '用法: --source <dir> | --zip <file> | --scan [--scan-root <dir>]… [--apply] [--data-dir <dir>] [--no-command-skills] [--json]';
  if (args.help || (!args.sourceDir && !args.zipFile && !args.scan)) {
    console.error(usage);
    process.exit(1);
  }
  if (args.scan) {
    const sources = scanPluginSources({ workspace: ROOT, limit: 200, extraRoots: args.scanRoots });
    const results = [];
    for (const src of sources) {
      const r = await importExternalPlugin({
        sourceDir: src.sourceDir,
        apply: args.apply,
        dataDir: args.dataDir,
        commandsAsSkills: args.commandsAsSkills,
      });
      results.push({
        sourceDir: src.sourceDir,
        agent: src.agent,
        scope: src.scope,
        kind: src.kind,
        ok: r.ok,
        skills: r.imported.skills.length,
        mcp: r.imported.mcpServers.length,
        commands: r.imported.commandTemplates.length,
        unsupported: r.unsupported.map((u) => u.capability),
        diagnostics: r.diagnostics.map((d) => d.code),
      });
    }
    if (args.json) {
      console.log(JSON.stringify({ scanned: sources.length, results }, null, 2));
    } else {
      console.log(`扫描 ${sources.length} 个来源${args.apply ? '（已写入）' : '（dry-run）'}`);
      for (const x of results) {
        const extra = x.unsupported.length ? ` 不支持:${x.unsupported.join(',')}` : '';
        console.log(`${x.ok ? '✓' : '✗'} [${x.agent}] ${x.sourceDir} skills=${x.skills} mcp=${x.mcp} cmd=${x.commands}${extra}`);
      }
    }
    process.exit(0);
  }
  const report = await importExternalPlugin(args);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatHuman(report));
  process.exit(report.ok ? 0 : 2);
}
