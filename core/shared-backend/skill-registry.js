/**
 * shared-backend/skill-registry.js — Skills 注册与发现机制
 *
 * 实现四层架构中的 Layer 4: Skills 层的注册与发现能力。
 * 支持三来源发现：built-in(10) / pack(15) / installed(20)
 *
 * 设计依据：
 * - docs/skills-architecture.md — 四层架构设计
 * - docs/skills-registry.md — 注册与发现机制详细设计
 * - docs/skills-schema.md — Skill Manifest Schema
 */

const fs = require('fs');
const path = require('path');
const packRegistry = require('./pack-registry');
const { resolveDataDir } = require('./data-paths');

// ── 常量定义 ────────────────────────────────────────────────────────────────

/** Skill 来源优先级（数值越小优先级越高）。
 * BLOCK-156 D7 — marketplace 残迹清除（无加载代码的死值）；远程技能市场转候选池 C-EXT-2。
 * BLOCK-214 — domain pack skills：source='pack'，介于 built-in 与 installed 之间。 */
const SOURCE_PRIORITY = {
  'built-in': 10,
  'pack': 15,
  'installed': 20,
};

/** Skill Manifest 版本 */
const SKILL_MANIFEST_VERSION = 1;

/** 可选的参数类型 */
const PARAM_TYPES = new Set(['select', 'number', 'string', 'boolean', 'file']);

/**
 * 可选的输出类型。
 * BIO-D2 2026-10-07 基线重锚（reason 留痕）：markdown 是 Skill 报告产出的真实形态
 * （如 resources/skills/go-enrichment-analysis 的 analysis_report「分析报告」），与既有的
 * html/text/file 同属报告类，补入合法集；不是放宽门禁，是校验基线对齐现实现。
 */
const OUTPUT_TYPES = new Set(['plot', 'table', 'html', 'json', 'text', 'file', 'markdown']);

// ── 内存注册表 ─────────────────────────────────────────────────────────────

/** @type {Map<string, SkillEntry>} */
const _registry = new Map();

/** @type {Map<string, string>} skillId → source */
const _sourceMap = new Map();

// ── 内置 Skill 清单（来自 resources/skills/manifest.json） ────────────────────

/** 内置 Skill 目录 */
const BUILT_IN_SKILLS_DIR = path.join(__dirname, '..', '..', 'resources', 'skills');

/** 内置 manifest 路径 */
const BUILT_IN_MANIFEST_PATH = path.join(BUILT_IN_SKILLS_DIR, 'manifest.json');

// ── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 读取并解析 JSON 文件
 * @param {string} filePath - 文件路径
 * @returns {object|null}
 */
function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`[skill-registry] Failed to read JSON from ${filePath}: ${e.message}`);
    return null;
  }
}

/**
 * 检查字符串是否符合 semver 格式
 * @param {string} version
 * @returns {boolean}
 */
function isValidSemver(version) {
  return /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/.test(version);
}

/**
 * 规范化 Skill ID（kebab-case）
 * @param {string} id
 * @returns {boolean}
 */
function isValidSkillId(id) {
  return /^[a-z][a-z0-9-]*$/.test(id);
}

// ── BLOCK-176 W7 CP-20 — 声明式依赖（skill 格式 v2·additive）────────────────
// 双格式同语义：SKILL.md frontmatter（os / requires.bins / install）与 skill.json
// `dependencies` 字段归一到同一结构；既有 5 个 skill.json 零改写（缺字段=无依赖）。
const OS_ALIASES = { darwin: 'darwin', macos: 'darwin', mac: 'darwin', win32: 'win32', windows: 'win32', win: 'win32', linux: 'linux' };

/**
 * 归一声明式依赖（纯函数，测试直打）。
 * @param {{os?: string|string[], requiresBins?: string|string[], install?: string}} raw
 * @returns {{ os: string[]|null, requiresBins: string[], install: string|null, invalid: string[] }}
 *  os=null=全平台；invalid 收集非法平台 token（fail-closed 报告面，不静默丢弃）。
 */
function normalizeDependencies(raw) {
  const out = { os: null, requiresBins: [], install: null, invalid: [] };
  if (!raw || typeof raw !== 'object') return out;
  const splitList = (v) => Array.isArray(v) ? v.map((x) => String(x).trim()) : String(v || '').split(/[,\s]+/);
  const osTokens = splitList(raw.os).filter(Boolean).map((t) => t.toLowerCase());
  if (osTokens.length) {
    const mapped = [];
    for (const t of osTokens) {
      if (OS_ALIASES[t]) mapped.push(OS_ALIASES[t]);
      else out.invalid.push(t);
    }
    out.os = mapped.length ? Array.from(new Set(mapped)) : null;
  }
  const bins = splitList(raw.requiresBins).map((b) => b.trim()).filter(Boolean);
  out.requiresBins = Array.from(new Set(bins));
  if (raw.install !== undefined && raw.install !== null && String(raw.install).trim() !== '') {
    out.install = String(raw.install).trim();
  }
  return out;
}

// ── Manifest 解析与校验 ────────────────────────────────────────────────────

/**
 * 解析 Skill Manifest
 * @param {object} manifest - 原始 manifest 对象
 * @param {string} source - 来源类型
 * @param {string} baseDir - 基础目录
 * @returns {SkillEntry|null}
 */
function parseSkillManifest(manifest, source, baseDir) {
  if (!manifest || manifest.skillManifestVersion !== SKILL_MANIFEST_VERSION) {
    return null;
  }

  const { id, name, version, description, category, tags = [], capabilities = [],
    plugins = {}, workflows = {}, prompts = {}, parameters = {},
    recovery_strategies = [], outputs = {}, metadata = {}, dependencies = {} } = manifest;

  // 基本字段校验
  if (!id || !name || !version || !description) {
    return null;
  }

  // ID 格式校验
  if (!isValidSkillId(id)) {
    console.warn(`[skill-registry] Invalid skill ID format: ${id}`);
    return null;
  }

  // 解析 Prompt 模板文件（如果存在）
  const parsedPrompts = { ...prompts };
  if (prompts.system_file && baseDir) {
    const systemPath = path.join(baseDir, prompts.system_file);
    if (fs.existsSync(systemPath)) {
      parsedPrompts.system = fs.readFileSync(systemPath, 'utf8');
    }
  }

  return {
    id,
    name,
    version,
    source,
    category: category || 'general',
    tags: Array.isArray(tags) ? tags : [],
    description,
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    plugins: {
      required: Array.isArray(plugins.required) ? plugins.required : [],
      optional: Array.isArray(plugins.optional) ? plugins.optional : [],
    },
    workflows: {
      default: workflows.default || null,
      variants: Array.isArray(workflows.variants) ? workflows.variants : [],
    },
    prompts: parsedPrompts,
    parameters: {
      required: Array.isArray(parameters.required) ? parameters.required : [],
      optional: parameters.optional || {},
    },
    dependencies: normalizeDependencies(dependencies),
    recoveryStrategies: Array.isArray(recovery_strategies) ? recovery_strategies : [],
    outputs: {
      primary: Array.isArray(outputs.primary) ? outputs.primary : [],
      secondary: Array.isArray(outputs.secondary) ? outputs.secondary : [],
    },
    metadata: {
      author: metadata.author || 'Petri Team',
      license: metadata.license || 'MIT',
      source: metadata.source || source,
      created: metadata.created || new Date().toISOString().split('T')[0],
      updated: metadata.updated || new Date().toISOString().split('T')[0],
      compatibility: metadata.compatibility || {},
    },
    _baseDir: baseDir,
  };
}

/**
 * 校验 Skill Manifest 完整性
 * @param {SkillEntry} skill
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateSkillManifest(skill) {
  const errors = [];

  if (skill.skillManifestVersion !== SKILL_MANIFEST_VERSION) {
    errors.push(`skillManifestVersion must be ${SKILL_MANIFEST_VERSION}`);
  }
  if (!skill.id) errors.push('Missing required field: id');
  if (!skill.name) errors.push('Missing required field: name');
  if (!skill.version) errors.push('Missing required field: version');
  if (!skill.description) errors.push('Missing required field: description');

  if (skill.id && !isValidSkillId(skill.id)) {
    errors.push(`Invalid ID format: ${skill.id} (must be kebab-case)`);
  }

  if (skill.version && !isValidSemver(skill.version)) {
    errors.push(`Invalid version format: ${skill.version} (must be semver)`);
  }

  if (!Array.isArray(skill.plugins?.required)) {
    errors.push('plugins.required must be an array');
  }

  // 校验可选参数定义
  for (const [key, spec] of Object.entries(skill.parameters?.optional || {})) {
    if (!spec.type || !PARAM_TYPES.has(spec.type)) {
      errors.push(`Invalid parameter type for ${key}: ${spec.type}`);
    }
    if (spec.type === 'select' && !Array.isArray(spec.options)) {
      errors.push(`Select parameter ${key} must have options array`);
    }
    if (spec.type === 'number') {
      if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
        errors.push(`Invalid range for parameter ${key}: min > max`);
      }
    }
  }

  // BLOCK-176 W7 CP-20 — 依赖结构校验（存在即校验；缺字段=无依赖合法）
  if (skill.dependencies && Array.isArray(skill.dependencies.invalid) && skill.dependencies.invalid.length) {
    errors.push(`dependencies.os 含非法平台 token: ${skill.dependencies.invalid.join(', ')}（合法 darwin/win32/linux 及别名）`);
  }

  // 校验输出定义
  for (const output of [...(skill.outputs?.primary || []), ...(skill.outputs?.secondary || [])]) {
    if (!output.id) errors.push('Output missing id field');
    if (output.type && !OUTPUT_TYPES.has(output.type)) {
      errors.push(`Invalid output type: ${output.type}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── 发现与加载 ──────────────────────────────────────────────────────────────

/**
 * 扫描目录下的所有 Skill 子目录
 * @param {string} dir - 父目录
 * @returns {string[]}
 */
function scanSkillDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(dir, entry.name));
}

/**
 * 从目录加载单个 Skill
 * @param {string} skillDir - Skill 目录
 * @param {string} source - 来源类型
 * @returns {SkillEntry|null}
 */
function loadSkillFromDir(skillDir, source) {
  const manifestPath = path.join(skillDir, 'skill.json');
  const manifest = readJson(manifestPath);
  if (!manifest) {
    // BLOCK-176 W7 CP-20 — 双格式：无 skill.json 但含 SKILL.md = 直装载（常驻注册）
    return loadSkillMdEntry(skillDir, source);
  }

  const entry = parseSkillManifest(manifest, source, skillDir);
  if (entry) entry._format = 'skill-json';
  return entry;
}

/**
 * 加载内置 Skills
 * @returns {SkillEntry[]}
 */
function loadBuiltInSkills() {
  const skills = [];

  // 首先尝试加载 manifest.json
  const manifest = readJson(BUILT_IN_MANIFEST_PATH);
  if (manifest && manifest.skills) {
    // 从 manifest 声明的目录加载
    for (const id of Object.keys(manifest.skills)) {
      const skillDir = path.join(BUILT_IN_SKILLS_DIR, id);
      const skill = loadSkillFromDir(skillDir, 'built-in');
      if (skill) skills.push(skill);
    }
  } else {
    // 回退：扫描目录
    for (const skillDir of scanSkillDirs(BUILT_IN_SKILLS_DIR)) {
      const skill = loadSkillFromDir(skillDir, 'built-in');
      if (skill) skills.push(skill);
    }
  }

  return skills;
}

/**
 * 获取用户数据目录下的 installed Skills 目录
 * @returns {string}
 */
function getInstalledSkillsDir() {
  // 优先使用环境变量指定的路径
  const envPath = process.env.PETRI_USER_DATA_DIR;
  if (envPath) {
    return path.join(envPath, 'skills');
  }
  // 回退到 common 用户数据路径
  const os = require('os');
  return path.join(os.homedir(), '.petri', 'skills');
}

/**
 * BLOCK-156 D7 — 第三方技能本地目录导入：校验 skill.json 后复制进 installed
 * 目录并 upsert installed manifest（discoverSkills 即刻可见，source='installed'）。
 * fail-closed：manifest 缺失/校验不过/built-in id 冲突一律拒绝且零写入。
 * 同 id 重复导入 = 覆盖更新（v1 语义：以最新导入为准）。
 * @param {string} sourceDir - 含 skill.json 的技能目录（用户经文件对话框选择）
 */
/**
 * BLOCK-160 W2 P5（KNW-4）— SKILL.md 受限解析（零 YAML 依赖，HK-04 解析器同思路）：
 * front-matter 仅认 name/description/version/category 四键；body = 手册正文。
 * id 从目录名归一（非法字符→'-'）；返回 { manifest, systemPrompt } 或 null。
 */
function parseSkillMd(sourceDir) {
  try {
    const file = path.join(sourceDir, 'SKILL.md');
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    let front = {};
    let body = raw;
    if (raw.startsWith('---')) {
      const frontEnd = raw.indexOf('\n---', 3);
      if (frontEnd > 0) {
        // BLOCK-176 W7 CP-20 — 键名允许点号（requires.bins）；依赖三字段 os/requires.bins/install
        for (const line of raw.slice(3, frontEnd).split('\n')) {
          const m = line.match(/^([A-Za-z_][\w.-]*):\s*(.*)$/);
          if (m) front[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
        }
        body = raw.slice(frontEnd + 4).trim();
      }
    }
    const dirName = (path.basename(sourceDir).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')) || 'imported-skill';
    const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
    const dependencies = normalizeDependencies({
      os: front.os,
      requiresBins: front['requires.bins'] !== undefined ? front['requires.bins'] : front['requires-bins'],
      install: front.install,
    });
    return {
      manifest: {
        skillManifestVersion: 1,
        id: dirName,
        name: front.name || dirName,
        version: front.version || '0.1.0',
        description: String(front.description || firstLine || `SKILL.md 导入技能 ${dirName}`).slice(0, 200),
        category: front.category || 'imported',
        tags: front.tags ? String(front.tags).split(/[\s,]+/).filter(Boolean) : ['imported'],
        plugins: { required: [], optional: [] },
        workflows: { default: 'default' },
        prompts: { system: 'prompts/system.md', user_templates: [`按技能 ${dirName} 完成任务：{task}`] },
        parameters: { required: [], optional: {} },
        dependencies,
      },
      systemPrompt: body || `# ${front.name || dirName}
`,
    };
  } catch {
    return null;
  }
}

/**
 * BLOCK-176 W7 CP-20 — SKILL.md 目录直装载（常驻注册面，区别于 installSkillFromDir
 * 的「导入即合成 skill.json」安装面）：合成清单直接装配为 SkillEntry（手册正文进
 * prompts.system），依赖字段随 normalizeDependencies 归一。目录无 SKILL.md = null。
 */
function loadSkillMdEntry(skillDir, source) {
  const parsed = parseSkillMd(skillDir);
  if (!parsed) return null;
  const manifest = { ...parsed.manifest, prompts: { system: parsed.systemPrompt } };
  const entry = parseSkillManifest(manifest, source, skillDir);
  if (entry) entry._format = 'skill-md';
  return entry;
}

function installSkillFromDir(sourceDir) {
  try {
    if (!sourceDir || typeof sourceDir !== 'string') {
      return { ok: false, error: 'source_dir_required' };
    }
    // BLOCK-160 W2 P5（KNW-4）— SKILL.md 兼容：目录缺 skill.json 但含 SKILL.md 时
    // 合成清单（front-matter 受限解析 + body→prompts/system.md；合成文件写 dest，
    // 源目录不可变）。无两者 = 维持原 fail-closed。
    let manifest = readJson(path.join(sourceDir, 'skill.json'));
    const synthesized = manifest ? null : parseSkillMd(sourceDir);
    if (!manifest && !synthesized) {
      return { ok: false, error: 'skill_manifest_missing', message: '所选目录缺少 skill.json 或 SKILL.md' };
    }
    if (synthesized) manifest = synthesized.manifest;
    const validation = validateSkillManifest(manifest);
    if (!validation.ok) {
      return { ok: false, error: 'skill_manifest_invalid', errors: validation.errors };
    }
    // built-in id 冲突拒绝（loadInstalledSkills 会跳过 built-in 占用 id——导入等于静默不可见，须前置拦截）
    const builtIn = loadBuiltInSkills();
    if (builtIn.some((s) => s.id === manifest.id)) {
      return { ok: false, error: 'skill_id_conflicts_builtin', message: `内置技能已占用 id: ${manifest.id}` };
    }
    const installedDir = getInstalledSkillsDir();
    fs.mkdirSync(installedDir, { recursive: true });
    const destDir = path.join(installedDir, manifest.id);
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    fs.cpSync(sourceDir, destDir, { recursive: true });
    // KNW-4 — SKILL.md 合成件写入 dest（skill.json + prompts/system.md），源目录不可变
    if (synthesized) {
      try {
        fs.writeFileSync(path.join(destDir, 'skill.json'), JSON.stringify(synthesized.manifest, null, 2));
        fs.mkdirSync(path.join(destDir, 'prompts'), { recursive: true });
        fs.writeFileSync(path.join(destDir, 'prompts', 'system.md'), synthesized.systemPrompt);
      } catch (e) {
        fs.rmSync(destDir, { recursive: true, force: true });
        return { ok: false, error: 'skill_md_synthesis_failed', message: e.message };
      }
    }
    // 装后回读护栏：parse 必须能装载（防「装了却 discover 不可见」的静默失败）；失败回滚零残留
    if (!loadSkillFromDir(destDir, 'installed')) {
      fs.rmSync(destDir, { recursive: true, force: true });
      return { ok: false, error: 'skill_manifest_unloadable', message: 'manifest 可过校验但无法装载（对照 parseSkillManifest 契约，如 skillManifestVersion）' };
    }
    // installed manifest upsert（装载侧 loadInstalledSkills 只认此清单）
    const manifestPath = path.join(installedDir, 'manifest.json');
    const installedManifest = readJson(manifestPath) || { skills: {} };
    if (!installedManifest.skills || typeof installedManifest.skills !== 'object') {
      installedManifest.skills = {};
    }
    installedManifest.skills[manifest.id] = {
      version: manifest.version,
      importedAt: new Date().toISOString(),
      sourceDir,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(installedManifest, null, 2) + '\n', 'utf8');
    return { ok: true, skillId: manifest.id, version: manifest.version };
  } catch (e) {
    return { ok: false, error: 'install_failed', message: e && e.message ? e.message : String(e) };
  }
}

/**
 * BLOCK-156 D7 — 按 id 卸载已导入技能（清目录 + manifest 条目；仅供导入回路清理）。
 */
function uninstallImportedSkill(skillId) {
  try {
    if (!skillId || typeof skillId !== 'string') return { ok: false, error: 'skill_id_required' };
    const installedDir = getInstalledSkillsDir();
    const manifestPath = path.join(installedDir, 'manifest.json');
    const installedManifest = readJson(manifestPath);
    if (!installedManifest || !installedManifest.skills || !(skillId in installedManifest.skills)) {
      return { ok: false, error: 'skill_not_imported' };
    }
    delete installedManifest.skills[skillId];
    fs.writeFileSync(manifestPath, JSON.stringify(installedManifest, null, 2) + '\n', 'utf8');
    const destDir = path.join(installedDir, skillId);
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
    return { ok: true, removed: skillId };
  } catch (e) {
    return { ok: false, error: 'uninstall_failed', message: e && e.message ? e.message : String(e) };
  }
}

/**
 * 加载已安装的 Skills
 * @returns {SkillEntry[]}
 */
function loadInstalledSkills() {
  const installedDir = getInstalledSkillsDir();
  const manifestPath = path.join(installedDir, 'manifest.json');
  const manifest = readJson(manifestPath);

  if (!manifest || !manifest.skills) return [];

  const skills = [];
  for (const id of Object.keys(manifest.skills)) {
    // 跳过已被 built-in 占用的（BLOCK-156 D7：原 _registry.has 会把 installed
    // 自身的上次发现缓存误判为占用——导入更新后二次发现被跳过，改为只认 built-in）
    if (_sourceMap.get(id) === 'built-in') continue;

    const skillDir = path.join(installedDir, id);
    const skill = loadSkillFromDir(skillDir, 'installed');
    if (skill) skills.push(skill);
  }

  return skills;
}

/**
 * BLOCK-214 — 加载已安装领域包贡献的 Skills。
 * 来源 = <dataDir>/packs/installed.json（enabled !== false），技能目录 = <packRoot>/skills。
 * 包缺失/未安装/停用 → 不返回任何 pack skill；卸载即从 registry 消失。
 * @returns {SkillEntry[]}
 */
function loadPackSkills() {
  const skills = [];
  let packs = [];
  try {
    packs = packRegistry.readInstalledPacks(resolveDataDir());
  } catch {
    return skills;
  }
  for (const pack of packs) {
    if (!pack || pack.enabled === false || !pack.packRoot) continue;
    const skillsRoot = path.join(pack.packRoot, 'skills');
    if (!fs.existsSync(skillsRoot)) continue;
    const manifest = readJson(path.join(skillsRoot, 'manifest.json'));
    const ids = manifest && manifest.skills
      ? Object.keys(manifest.skills)
      : scanSkillDirs(skillsRoot).map((dir) => path.basename(dir));
    for (const id of ids) {
      const skill = loadSkillFromDir(path.join(skillsRoot, id), 'pack');
      if (skill) skills.push(skill);
    }
  }
  return skills;
}

/**
 * 发现并加载所有可用 Skills
 * @returns {SkillEntry[]}
 */
function discoverSkills() {
  const skills = [];

  // 1. 内置 Skills（最高优先级）
  const builtIn = loadBuiltInSkills();
  for (const skill of builtIn) {
    skills.push(skill);
    _registry.set(skill.id, skill);
    _sourceMap.set(skill.id, 'built-in');
  }

  // 2. 已安装 Skills
  const installed = loadInstalledSkills();
  const installedIds = new Set(installed.map((skill) => skill.id));
  for (const skill of installed) {
    skills.push(skill);
    _registry.set(skill.id, skill);
    _sourceMap.set(skill.id, 'installed');
  }

  // BLOCK-156 D7 — installed 残留清理：manifest 已不含的条目从注册表移除
  //（卸载/覆盖降级后 discover 不再返回旧条目；built-in 与手动 register 不受影响）
  for (const id of Array.from(_sourceMap.keys())) {
    if (_sourceMap.get(id) === 'installed' && !installedIds.has(id)) {
      _sourceMap.delete(id);
      _registry.delete(id);
    }
  }

  // 3. 已安装领域包 Skills（BLOCK-214）：built-in/installed 优先，pack 不覆盖同名
  const packSkills = loadPackSkills();
  const packIds = new Set(packSkills.map((skill) => skill.id));
  for (const skill of packSkills) {
    const existingSource = _sourceMap.get(skill.id);
    if (existingSource && existingSource !== 'pack') continue;
    skills.push(skill);
    _registry.set(skill.id, skill);
    _sourceMap.set(skill.id, 'pack');
  }
  for (const id of Array.from(_sourceMap.keys())) {
    if (_sourceMap.get(id) === 'pack' && !packIds.has(id)) {
      _sourceMap.delete(id);
      _registry.delete(id);
    }
  }

  return skills;
}

// ── SkillRegistry 类 ────────────────────────────────────────────────────────

/**
 * Skill 注册表类
 * 提供 Skills 的发现、查询、依赖验证等能力
 */
class SkillRegistry {
  constructor() {
    this._initialized = false;
  }

  /**
   * 初始化注册表（BLOCK-156 D7：discover 已改为每次全量重发现，此钩子仅为
   * 兼容既有调用点保留；_initialized 不再拦截发现——导入/卸载后即刻可见）
   */
  _ensureInitialized() {
    discoverSkills();
    this._initialized = true;
  }

  /**
   * 发现所有可用 Skills
   * @returns {SkillEntry[]} 所有已注册的 Skills
   */
  discover() {
    this._ensureInitialized();
    return Array.from(_registry.values());
  }

  /**
   * 按 ID 获取 Skill
   * @param {string} id - Skill ID
   * @returns {SkillEntry|null}
   */
  get(id) {
    this._ensureInitialized();
    return _registry.get(id) || null;
  }

  /**
   * 按标签搜索 Skills
   * @param {string} query - 搜索关键词（匹配 name、description、tags）
   * @returns {SkillEntry[]}
   */
  search(query) {
    this._ensureInitialized();
    const q = query.toLowerCase();
    return Array.from(_registry.values()).filter(skill => {
      return (
        skill.id.toLowerCase().includes(q) ||
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.tags.some(tag => tag.toLowerCase().includes(q)) ||
        skill.category.toLowerCase().includes(q)
      );
    });
  }

  /**
   * 按类别筛选 Skills
   * @param {string} category - 类别（支持前缀匹配，如 "bioinformatics"）
   * @returns {SkillEntry[]}
   */
  filterByCategory(category) {
    this._ensureInitialized();
    if (!category) return this.discover();
    const cat = category.toLowerCase();
    return Array.from(_registry.values()).filter(skill =>
      skill.category.toLowerCase() === cat ||
      skill.category.toLowerCase().startsWith(cat + '/')
    );
  }

  /**
   * 按来源筛选 Skills
   * @param {string} source - 来源类型
   * @returns {SkillEntry[]}
   */
  filterBySource(source) {
    this._ensureInitialized();
    if (!source) return this.discover();
    return Array.from(_registry.values()).filter(skill => skill.source === source);
  }

  /**
   * 按插件依赖筛选 Skills
   * @param {string} pluginId - 插件 ID
   * @returns {SkillEntry[]}
   */
  filterByPlugin(pluginId) {
    this._ensureInitialized();
    return Array.from(_registry.values()).filter(skill =>
      skill.plugins.required.includes(pluginId) ||
      skill.plugins.optional.includes(pluginId)
    );
  }

  /**
   * 按能力筛选 Skills
   * @param {string} capability - 能力 ID
   * @returns {SkillEntry[]}
   */
  filterByCapability(capability) {
    this._ensureInitialized();
    return Array.from(_registry.values()).filter(skill =>
      skill.capabilities.includes(capability)
    );
  }

  /**
   * 检查 Skill 依赖是否满足
   * @param {string|SkillEntry} skillOrId - Skill ID 或 Skill 对象
   * @param {object} context - 执行上下文（包含可用的 plugins、capabilities）
   * @returns {{ can: boolean, missing: { plugins: string[], capabilities: string[] } }}
   */
  canExecute(skillOrId, context = {}) {
    this._ensureInitialized();
    const skill = typeof skillOrId === 'string' ? this.get(skillOrId) : skillOrId;
    if (!skill) {
      return { can: false, missing: { plugins: [], capabilities: [], reason: 'Skill not found' } };
    }

    const availablePlugins = new Set(context.availablePlugins || []);
    const availableCapabilities = new Set(context.availableCapabilities || []);

    const missingPlugins = skill.plugins.required.filter(p => !availablePlugins.has(p));
    const missingCapabilities = skill.capabilities.filter(c => !availableCapabilities.has(c));

    return {
      can: missingPlugins.length === 0 && missingCapabilities.length === 0,
      missing: {
        plugins: missingPlugins,
        capabilities: missingCapabilities,
      },
    };
  }

  /**
   * 注册新 Skill（用于动态注册）
   * @param {SkillEntry} skill
   * @returns {{ ok: boolean, error?: string }}
   */
  register(skill) {
    if (!skill || !skill.id) {
      return { ok: false, error: 'Invalid skill object' };
    }

    const validation = validateSkillManifest(skill);
    if (!validation.ok) {
      return { ok: false, error: `Validation failed: ${validation.errors.join(', ')}` };
    }

    const existing = _registry.get(skill.id);
    if (existing && SOURCE_PRIORITY[existing.source] <= SOURCE_PRIORITY[skill.source]) {
      return { ok: false, error: `Skill ${skill.id} already registered with higher priority source` };
    }

    _registry.set(skill.id, skill);
    _sourceMap.set(skill.id, skill.source);
    return { ok: true };
  }

  /**
   * 获取注册统计
   * @returns {{ total: number, bySource: object, byCategory: object }}
   */
  getStats() {
    this._ensureInitialized();
    const bySource = {};
    const byCategory = {};

    for (const skill of _registry.values()) {
      bySource[skill.source] = (bySource[skill.source] || 0) + 1;
      byCategory[skill.category] = (byCategory[skill.category] || 0) + 1;
    }

    return {
      total: _registry.size,
      bySource,
      byCategory,
    };
  }

  /**
   * 获取所有唯一类别
   * @returns {string[]}
   */
  getCategories() {
    this._ensureInitialized();
    const categories = new Set();
    for (const skill of _registry.values()) {
      categories.add(skill.category);
    }
    return Array.from(categories).sort();
  }

  /**
   * 获取所有唯一标签
   * @returns {string[]}
   */
  getTags() {
    this._ensureInitialized();
    const tags = new Set();
    for (const skill of _registry.values()) {
      for (const tag of skill.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }

  /**
   * 导出符合 MCP 工具格式的 Skills 列表
   * @returns {object[]}
   */
  toMcpToolList() {
    this._ensureInitialized();
    return Array.from(_registry.values()).map(skill => ({
      name: skill.id,
      description: skill.description,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: `Skill ID: ${skill.id}` },
          params: {
            type: 'object',
            description: 'Skill 执行参数',
            properties: skill.parameters.optional,
          },
          workflow: {
            type: 'string',
            description: '指定执行的 workflow（可选，默认使用 default）',
          },
        },
        required: skill.parameters.required,
      },
      _skill: skill,
    }));
  }

  /**
   * 清除所有注册（主要用于测试）
   */
  clear() {
    _registry.clear();
    _sourceMap.clear();
    this._initialized = false;
  }
}

// ── 导出 ────────────────────────────────────────────────────────────────────

module.exports = {
  // 类导出
  SkillRegistry,

  // 工厂函数导出（兼容旧 API）
  createRegistry: () => new SkillRegistry(),

  // 工具函数导出
  parseSkillManifest,
  parseSkillMd,
  normalizeDependencies,
  validateSkillManifest,
  loadSkillFromDir,
  loadBuiltInSkills,
  loadInstalledSkills,
  loadPackSkills,
  installSkillFromDir,
  uninstallImportedSkill,
  loadSkillMdEntry,
  discoverSkills,

  // 常量导出
  SOURCE_PRIORITY,
  SKILL_MANIFEST_VERSION,
};
