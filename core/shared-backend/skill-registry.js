/**
 * shared-backend/skill-registry.js — Skills 注册与发现机制
 *
 * 实现四层架构中的 Layer 4: Skills 层的注册与发现能力。
 * 支持两来源发现：built-in(10) / installed(20)
 *
 * 设计依据：
 * - docs/skills-architecture.md — 四层架构设计
 * - docs/skills-registry.md — 注册与发现机制详细设计
 * - docs/skills-schema.md — Skill Manifest Schema
 */

const fs = require('fs');
const path = require('path');

// ── 常量定义 ────────────────────────────────────────────────────────────────

/** Skill 来源优先级（数值越小优先级越高）。
 * BLOCK-156 D7 — marketplace 残迹清除（无加载代码的死值）；远程技能市场转候选池 C-EXT-2。 */
const SOURCE_PRIORITY = {
  'built-in': 10,
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
    recovery_strategies = [], outputs = {}, metadata = {} } = manifest;

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
    recoveryStrategies: Array.isArray(recovery_strategies) ? recovery_strategies : [],
    outputs: {
      primary: Array.isArray(outputs.primary) ? outputs.primary : [],
      secondary: Array.isArray(outputs.secondary) ? outputs.secondary : [],
    },
    metadata: {
      author: metadata.author || 'BioF3 Team',
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
  if (!manifest) return null;

  return parseSkillManifest(manifest, source, skillDir);
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
  const envPath = process.env.BIOF3_USER_DATA_DIR;
  if (envPath) {
    return path.join(envPath, 'skills');
  }
  // 回退到 common 用户数据路径
  const os = require('os');
  return path.join(os.homedir(), '.biof3', 'skills');
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
    // 跳过已被 built-in 占用的
    if (_registry.has(id)) continue;

    const skillDir = path.join(installedDir, id);
    const skill = loadSkillFromDir(skillDir, 'installed');
    if (skill) skills.push(skill);
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
  for (const skill of installed) {
    skills.push(skill);
    _registry.set(skill.id, skill);
    _sourceMap.set(skill.id, 'installed');
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
   * 初始化注册表（惰性加载）
   */
  _ensureInitialized() {
    if (!this._initialized) {
      discoverSkills();
      this._initialized = true;
    }
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
  validateSkillManifest,
  loadSkillFromDir,
  loadBuiltInSkills,
  loadInstalledSkills,
  discoverSkills,

  // 常量导出
  SOURCE_PRIORITY,
  SKILL_MANIFEST_VERSION,
};
