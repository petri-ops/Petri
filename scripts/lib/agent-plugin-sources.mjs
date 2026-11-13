/**
 * scripts/lib/agent-plugin-sources.mjs — BLOCK-445 通用 Agent 插件/技能来源发现。
 *
 * 目标：不绑定某一个 Agent。ZCode / Claude Code / Codex / CodeBuddy / OpenCode /
 * Continue / Kiro / Qwen / Windsurf / Trae / Roo / Goose / Augment 等插件目录，
 * 以及 `.agents/skills` 这类纯技能目录，都走同一套识别与投影。
 *
 * 只读 + 路径收敛：不执行任何插件代码，不跟随软链，限制扫描规模。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 清单候选（按优先级）。ZCode 与 Claude 的优先级与其自身识别顺序一致。 */
export const MANIFEST_CANDIDATES = Object.freeze([
  '.zcode-plugin/plugin.json',
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.codebuddy-plugin/plugin.json',
  '.opencode-plugin/plugin.json',
  '.continue/plugin.json',
  '.kiro-plugin/plugin.json',
  '.qwen-plugin/plugin.json',
  '.windsurf/plugin.json',
  '.trae/plugin.json',
  '.agents/plugin.json',
  'plugin.json',
  'manifest.json',
]);

/** 外部 Agent 的插件根（用户级，相对 HOME）。 */
export const USER_PLUGIN_ROOTS = Object.freeze([
  { agent: 'claude-code', rel: '.claude/plugins' },
  { agent: 'codex', rel: '.codex/plugins' },
  { agent: 'codebuddy', rel: '.codebuddy/plugins' },
  { agent: 'opencode', rel: '.config/opencode/plugins' },
  { agent: 'openclaw', rel: '.openclaw/plugins' },
  { agent: 'augment', rel: '.augment/plugins' },
  { agent: 'continue', rel: '.continue/plugins' },
  { agent: 'goose', rel: '.config/goose/plugins' },
  { agent: 'qwen-code', rel: '.qwen/plugins' },
  { agent: 'qoder', rel: '.qoder/plugins' },
  { agent: 'windsurf', rel: '.codeium/windsurf/plugins' },
  { agent: 'trae', rel: '.trae/plugins' },
  { agent: 'kiro', rel: '.kiro/plugins' },
  { agent: 'roo-code', rel: '.roo/plugins' },
]);

/** 工作区级插件/技能根（相对 workspace）。 */
export const WORKSPACE_PLUGIN_ROOTS = Object.freeze([
  { agent: 'claude-code', rel: '.claude/plugins' },
  { agent: 'codex', rel: '.codex/plugins' },
  { agent: 'codebuddy', rel: '.codebuddy/plugins' },
  { agent: 'any', rel: '.agents/plugins' },
  { agent: 'any', rel: '.agents/skills' },
  { agent: 'any', rel: 'skills' },
  { agent: 'any', rel: '.claude/skills' },
  { agent: 'any', rel: '.codex/skills' },
]);

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

/** 泛化清单（manifest.json / plugin.json）必须有插件特征键，避免把普通文件误认成插件。 */
export function looksLikePluginManifest(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  const hints = ['extension', 'ui', 'mcpServers', 'skills', 'commands', 'hooks', 'contributes', 'agents', 'marketplace'];
  return Boolean(j.name || j.id) && hints.some((k) => Object.prototype.hasOwnProperty.call(j, k));
}

/** 单技能目录：目录自身含 SKILL.md / skill.json（Claude/Codex/通用 .agents/skills 形态）。 */
export function isSingleSkillDir(dir) {
  return fs.existsSync(path.join(dir, 'SKILL.md')) || fs.existsSync(path.join(dir, 'skill.json'));
}

/**
 * 解析插件根。返回 { root, manifestPath, manifest, agent, singleSkill } 或 null。
 * 兼容：多形态清单、marketplace 根、无清单的单技能目录。
 */
export function resolvePluginRoot(sourceDir) {
  if (!isDir(sourceDir)) return null;
  for (const rel of MANIFEST_CANDIDATES) {
    const p = path.join(sourceDir, rel);
    if (!fs.existsSync(p)) continue;
    const j = readJson(p);
    if (!j) continue;
    const generic = rel === 'manifest.json' || rel === 'plugin.json';
    if (generic && !looksLikePluginManifest(j)) continue;
    const agent = rel.startsWith('.zcode-plugin') ? 'zcode'
      : rel.startsWith('.claude-plugin') ? 'claude-code'
        : rel.startsWith('.codex-plugin') ? 'codex'
          : rel.startsWith('.codebuddy-plugin') ? 'codebuddy'
            : rel.startsWith('.opencode-plugin') ? 'opencode'
              : rel.startsWith('.continue') ? 'continue'
                : 'generic';
    return { root: sourceDir, manifestPath: p, manifest: j, agent, singleSkill: false };
  }
  // marketplace 根：取 plugins[0].source
  for (const rel of ['.claude-plugin/marketplace.json', 'marketplace.json', '.agents/marketplace.json']) {
    const p = path.join(sourceDir, rel);
    if (!fs.existsSync(p)) continue;
    const j = readJson(p);
    const first = j && Array.isArray(j.plugins) ? j.plugins[0] : null;
    const src = first && (typeof first.source === 'string' ? first.source : first.source && first.source.path);
    if (!src) continue;
    const candidate = path.resolve(sourceDir, src);
    if (isDir(candidate)) {
      const nested = resolvePluginRoot(candidate);
      if (nested) return nested;
    }
  }
  // 无清单：目录本身就是技能
  if (isSingleSkillDir(sourceDir)) {
    return {
      root: sourceDir,
      manifestPath: null,
      manifest: { name: path.basename(sourceDir), version: '0.1.0' },
      agent: 'any-skill',
      singleSkill: true,
    };
  }
  return null;
}

/** 子目录里含清单或技能文件的，才算插件/技能候选。 */
function qualifiesAsCandidate(dir) {
  if (!isDir(dir)) return false;
  if (isSingleSkillDir(dir)) return true;
  for (const rel of MANIFEST_CANDIDATES) {
    if (fs.existsSync(path.join(dir, rel))) return true;
  }
  return false;
}

/**
 * 扫描任意 Agent 的插件/技能来源（只读）。
 * @returns {Array<{sourceDir:string, agent:string, kind:'plugin'|'skill'}>}
 */
export function scanPluginSources(options = {}) {
  const home = options.home || os.homedir();
  const workspace = options.workspace || process.cwd();
  const limit = Number.isFinite(options.limit) ? options.limit : 200;
  const roots = [];
  for (const r of USER_PLUGIN_ROOTS) roots.push({ dir: path.join(home, r.rel), agent: r.agent, scope: 'user' });
  for (const r of WORKSPACE_PLUGIN_ROOTS) roots.push({ dir: path.join(workspace, r.rel), agent: r.agent, scope: 'workspace' });
  if (Array.isArray(options.extraRoots)) {
    for (const d of options.extraRoots) roots.push({ dir: path.resolve(d), agent: 'custom', scope: 'custom' });
  }

  const out = [];
  const seen = new Set();
  for (const r of roots) {
    if (out.length >= limit) break;
    if (!isDir(r.dir) || seen.has(r.dir)) continue;
    seen.add(r.dir);
    let entries = [];
    try { entries = fs.readdirSync(r.dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (out.length >= limit) break;
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const d = path.join(r.dir, e.name);
      if (!qualifiesAsCandidate(d)) continue;
      if (seen.has(d)) continue;
      seen.add(d);
      out.push({ sourceDir: d, agent: r.agent, scope: r.scope, kind: isSingleSkillDir(d) ? 'skill' : 'plugin' });
    }
    // 技能根自身可能是一个技能目录（例如 .agents/skills/<name> 已被上面覆盖；这里处理根即技能）
    if (isSingleSkillDir(r.dir) && !seen.has(`${r.dir}:self`)) {
      seen.add(`${r.dir}:self`);
      out.push({ sourceDir: r.dir, agent: r.agent, scope: r.scope, kind: 'skill' });
    }
  }
  return out;
}

/**
 * 命令模板 → 合成技能（让 slash 命令在 Petri 里也能「拿来即用」）。
 * 返回 [{ id, sourceDir, synthetic:true }]，调用方负责在临时目录里写入 SKILL.md。
 */
export function synthesizeCommandSkills(commands, tempDir, options = {}) {
  const prefix = String(options.prefix || 'cmd').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const out = [];
  for (const c of commands.slice(0, 40)) {
    const id = `${prefix}-${String(c.name || 'command').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`.slice(0, 60);
    const dir = path.join(tempDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const front = [
      '---',
      `name: ${id}`,
      `description: ${String(c.description || `命令模板：${c.name}`).replace(/\n/g, ' ').slice(0, 160)}`,
      'version: 0.1.0',
      'category: imported-command',
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `${front}${String(c.body || '').slice(0, 4000)}\n`, 'utf8');
    out.push({ id, sourceDir: dir, synthetic: true });
  }
  return out;
}
