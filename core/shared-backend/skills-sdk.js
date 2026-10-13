/**
 * shared-backend/skills-sdk.js — Petri Desktop Skills SDK
 *
 * 统一 Skills 层访问入口，对接 Agent、MCP、Workflow Engine。
 *
 * 设计目标：
 * 1. 对外暴露简洁 API：list / get / search / execute / validate
 * 2. 内部桥接 SkillRegistry、SkillRuntime、WorkflowEngine
 * 3. 不破坏现有 Plugin 系统，所有调用向后兼容
 * 4. 支持 MCP tool 列表导出
 *
 * 依赖：
 * - ./skill-registry.js — Skill 发现与注册
 * - ./skill-schema.js — Skill Manifest 校验
 * - ./skill-runtime.js — Skill 执行运行时
 * - ./workflow-engine.js — Workflow 执行引擎
 */

'use strict';

const {
  SkillRegistry,
  createRegistry,
  loadBuiltInSkills,
  loadInstalledSkills,
  discoverSkills,
  uninstallImportedSkill,
  installSkillFromDir,
  SOURCE_PRIORITY,
} = require('./skill-registry');

// BLOCK-177 — 治理偏好单源（停用/审计；与 registry 同 userData 口径）
const skillPrefs = require('./skill-prefs.js');

const {
  SkillSchema,
  validateSkillManifest: validateSchemaManifest,
  applySkillDefaults,
  PARAM_TYPES,
  SOURCE_TYPES,
  OUTPUT_TYPES,
  ERROR_CODES,
} = require('./skill-schema');

const {
  SkillRuntime,
  createSkillRuntime,
  EXECUTION_STATES,
} = require('./skill-runtime');

// ---------------------------------------------------------------------------
// 默认 Skill Runtime 工厂
// ---------------------------------------------------------------------------

/**
 * 默认 SkillRuntime 工厂 — 创建并返回 SkillRuntime 实例。
 *
 * @param {object} skill - Skill Manifest
 * @param {object} deps - 依赖注入
 * @returns {SkillRuntime}
 */
function defaultRuntimeFactory(skill, deps = {}) {
  return createSkillRuntime(skill, {
    registry: deps.registry,
    pluginManager: deps.pluginManager,
    workflowRuntime: deps.workflowEngine,
    capabilityProvisioning: deps.capabilityProvisioning,
  });
}

// ---------------------------------------------------------------------------
// SkillsSDK — 主类
// ---------------------------------------------------------------------------

/**
 * Skills SDK
 *
 * 暴露 Skills 层给上层（Agent / MCP / Frontend）的统一接口。
 * 不持久化状态；所有发现结果可缓存但不依赖内存单例。
 */
class SkillsSDK {
  /**
   * @param {object} options
   * @param {SkillRegistry} [options.registry] — 已存在的 Registry 实例
   * @param {Function} [options.runtimeFactory] — 自定义 Runtime 工厂
   * @param {object} [options.workflowEngine] — Workflow Engine 实例
   * @param {object} [options.pluginManager] — Plugin Manager
   * @param {object} [options.capabilityProvisioning] — Capability Provisioning
   */
  constructor(options = {}) {
    this.registry = options.registry || createRegistry();
    this.runtimeFactory = options.runtimeFactory || defaultRuntimeFactory;
    this.workflowEngine = options.workflowEngine || null;
    this.pluginManager = options.pluginManager || null;
    this.capabilityProvisioning = options.capabilityProvisioning || null;

    this._schema = new SkillSchema({ locale: options.locale || 'en' });
  }

  // ── 发现 API ────────────────────────────────────────────────────────────

  /**
   * 列出所有 Skills，支持筛选
   * @param {object} [filter]
   * @param {string} [filter.source] — built-in / installed / marketplace
   * @param {string} [filter.category] — 类别前缀（如 bioinformatics）
   * @param {string} [filter.tag] — 按标签筛选
   * @returns {object[]}
   */
  listSkills(filter = {}) {
    let skills = this.registry.discover();

    if (filter.source) {
      skills = skills.filter((s) => s.source === filter.source);
    }
    if (filter.category) {
      const cat = filter.category.toLowerCase();
      skills = skills.filter(
        (s) =>
          s.category.toLowerCase() === cat ||
          s.category.toLowerCase().startsWith(cat + '/')
      );
    }
    if (filter.tag) {
      const tag = filter.tag.toLowerCase();
      skills = skills.filter((s) =>
        s.tags.some((t) => t.toLowerCase() === tag)
      );
    }

    // BLOCK-177 — 停用旗标（管理面置灰可见；agent/执行面另行过滤/拒绝）
    return skillPrefs.annotateDisabled(skills);
  }

  /**
   * 按 ID 获取 Skill
   * @param {string} id
   * @returns {object|null}
   */
  getSkill(id) {
    return this.registry.get(id);
  }

  // ── BLOCK-177 治理面（停用/卸载/重装；全部落审计）──────────────────────

  /** 停用/启用技能（幂等；审计留痕）。built-in 与 installed 同语义（停用不删件）。 */
  setSkillDisabled(skillId, disabled, reason) {
    const skill = this.registry.get(skillId);
    if (!skill) return { ok: false, error: 'skill_not_found', message: `未找到技能：${skillId}` };
    const result = skillPrefs.setSkillDisabled(skillId, disabled, reason);
    return result;
  }

  /** 卸载已导入技能（built-in 诚实拒绝；审计留痕）。 */
  uninstallSkill(skillId) {
    const skill = this.registry.get(skillId);
    if (!skill) return { ok: false, error: 'skill_not_found', message: `未找到技能：${skillId}` };
    if (skill.source === 'built-in') {
      return { ok: false, error: 'builtin_cannot_uninstall', message: `「${skill.name}」是内置技能，不提供卸载——如不需要可在 Skills 页停用（随时可重新启用）。` };
    }
    // 卸载会删 installed manifest 条目——先把来源目录留存进 prefs（重装面依据）
    const info = this.getInstallInfo(skillId);
    if (info.ok && info.sourceDir) skillPrefs.recordUninstalledSource(skillId, info.sourceDir);
    const result = uninstallImportedSkill(skillId);
    if (result.ok) skillPrefs.appendAudit('uninstall', skillId, { source: skill.source });
    return result;
  }

  /** 已导入技能的安装信息（来源目录/导入时间；卸载后「从哪里再次获取」的答案）。 */
  getInstallInfo(skillId) {
    const fs = require('fs');
    const path = require('path');
    const prefsDir = skillPrefs.getUserDataBaseDir();
    let sourceDir = null;
    let importedAt = null;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(prefsDir, 'skills', 'manifest.json'), 'utf8'));
      const entry = raw.skills && raw.skills[skillId];
      if (entry) { sourceDir = entry.sourceDir || null; importedAt = entry.importedAt || null; }
    } catch { /* installed manifest 缺失 = 无来源记录 */ }
    // BLOCK-177 — 已卸载技能：来源记录从 prefs 留存面回退（卸载后仍可一键重装）
    let uninstalled = false;
    if (!sourceDir) {
      const retained = skillPrefs.getUninstalledSource(skillId);
      if (retained) { sourceDir = retained; uninstalled = true; }
    }
    if (!sourceDir) return { ok: false, error: 'skill_not_installed', message: `无安装/来源记录：${skillId}` };
    let sourceExists = false;
    try { sourceExists = fs.existsSync(sourceDir); } catch { sourceExists = false; }
    return { ok: true, skillId, sourceDir, sourceExists, importedAt, uninstalled };
  }

  /** 从记录的来源目录重装（同 id 覆盖语义沿用 installSkillFromDir；审计留痕）。 */
  reinstallFromSource(skillId) {
    const info = this.getInstallInfo(skillId);
    if (!info.ok) return info;
    if (!info.sourceDir) return { ok: false, error: 'source_dir_unknown', message: '导入记录未包含来源目录——请从原始位置重新导入。' };
    if (!info.sourceExists) return { ok: false, error: 'source_dir_missing', message: `来源目录已不存在：${info.sourceDir}——请从原始位置重新导入。` };
    const result = installSkillFromDir(info.sourceDir);
    if (result.ok) skillPrefs.appendAudit('reinstall', skillId, { sourceDir: info.sourceDir });
    return result;
  }

  /**
   * 搜索 Skills（匹配 name、description、tags、id）
   * @param {string} query
   * @returns {object[]}
   */
  searchSkills(query) {
    if (!query || typeof query !== 'string') {
      return [];
    }
    return this.registry.search(query);
  }

  /**
   * 按类别筛选
   * @param {string} category
   * @returns {object[]}
   */
  filterByCategory(category) {
    return this.registry.filterByCategory(category);
  }

  /**
   * 按插件依赖筛选
   * @param {string} pluginId
   * @returns {object[]}
   */
  filterByPlugin(pluginId) {
    return this.registry.filterByPlugin(pluginId);
  }

  /**
   * 按能力筛选
   * @param {string} capability
   * @returns {object[]}
   */
  filterByCapability(capability) {
    return this.registry.filterByCapability(capability);
  }

  /**
   * 列出所有类别
   * @returns {string[]}
   */
  getCategories() {
    return this.registry.getCategories();
  }

  /**
   * 列出所有标签
   * @returns {string[]}
   */
  getTags() {
    return this.registry.getTags();
  }

  /**
   * 获取注册统计信息
   * @returns {{ total: number, bySource: object, byCategory: object }}
   */
  getStats() {
    return this.registry.getStats();
  }

  // ── 校验 API ────────────────────────────────────────────────────────────

  /**
   * 校验 Skill Manifest 完整性
   * @param {object} manifest — Skill Manifest 对象
   * @returns {{ valid: boolean, errors: object[] }}
   */
  validateSkill(manifest) {
    return this._schema.validate(manifest);
  }

  /**
   * 检查 Skill 是否可以执行（依赖满足）
   * @param {string} id
   * @param {object} [context]
   * @returns {{ can: boolean, missing: { plugins: string[], capabilities: string[] } }}
   */
  canExecute(id, context = {}) {
    return this.registry.canExecute(id, context);
  }

  // ── 执行 API ────────────────────────────────────────────────────────────

  /**
   * 执行 Skill
   * @param {string} skillId
   * @param {object} params — 用户参数
   * @param {object} [context] — 执行上下文
   * @returns {Promise<object>}
   */
  async executeSkill(skillId, params = {}, context = {}) {
    const skill = this.registry.get(skillId);
    if (!skill) {
      return {
        success: false,
        error: { code: 'SKILL_NOT_FOUND', message: `Skill not found: ${skillId}` },
        skillId,
      };
    }

    // BLOCK-177 — 停用件拒绝执行（诚实报错；管理面仍可见可重新启用）
    if (skillPrefs.isSkillDisabled(skillId)) {
      return {
        success: false,
        error: { code: 'SKILL_DISABLED', message: `技能已停用：${skillId}（在 Skills 页重新启用后可执行）` },
        skillId,
      };
    }

    const runtime = this.runtimeFactory(skill, {
      registry: this.registry,
      pluginManager: this.pluginManager,
      workflowEngine: this.workflowEngine,
      capabilityProvisioning: this.capabilityProvisioning,
    });

    return runtime.execute(params, context);
  }

  /**
   * 执行 Workflow
   * @param {string} workflowId — workflow ID 或 skill:workflow 复合 ID
   * @param {object} params — 执行参数
   * @param {object} [context] — 执行上下文
   * @returns {Promise<object>}
   */
  async executeWorkflow(workflowId, params = {}, context = {}) {
    if (!this.workflowEngine) {
      return {
        success: false,
        error: {
          code: 'WORKFLOW_ENGINE_NOT_AVAILABLE',
          message: 'WorkflowEngine not configured',
        },
        workflowId,
      };
    }
    return this.workflowEngine.execute(workflowId, params, context);
  }

  // ── MCP 集成 ────────────────────────────────────────────────────────────

  /**
   * 导出 MCP 工具列表 — 用于在 MCP Server 注册
   * @returns {object[]}
   */
  toMcpToolList() {
    const skills = this.registry.discover();

    const skillListTool = {
      name: 'list_skills',
      description: '列出所有可用的 Petri Skills，支持按类别/标签/来源筛选',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: '类别筛选（如 bioinformatics）' },
          tag: { type: 'string', description: '标签筛选' },
          source: {
            type: 'string',
            enum: SOURCE_TYPES,
            description: '来源筛选',
          },
        },
      },
    };

    const getSkillTool = {
      name: 'get_skill',
      description: '获取指定 Skill 的完整定义',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill ID（kebab-case）' },
        },
        required: ['id'],
      },
    };

    const executeSkillTool = {
      name: 'execute_skill',
      description: '执行一个 Petri Skill',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill ID' },
          params: { type: 'object', description: '执行参数' },
          workflow: { type: 'string', description: '指定 workflow 变体（可选）' },
          user_context: { type: 'object', description: '用户上下文' },
        },
        required: ['id'],
      },
    };

    const searchSkillsTool = {
      name: 'search_skills',
      description: '按关键词搜索 Skills',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
    };

    const canExecuteTool = {
      name: 'can_execute_skill',
      description: '检查 Skill 当前是否可执行（依赖是否满足）',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill ID' },
        },
        required: ['id'],
      },
    };

    const skillMetaTools = skills.map((skill) => ({
      name: `skill:${skill.id}`,
      description: `[${skill.source}] ${skill.description}`,
      inputSchema: {
        type: 'object',
        properties: {
          params: {
            type: 'object',
            description: 'Skill 执行参数',
            properties: skill.parameters?.optional || {},
          },
        },
        required: skill.parameters?.required || [],
      },
      _skill: skill,
    }));

    return [
      skillListTool,
      getSkillTool,
      executeSkillTool,
      searchSkillsTool,
      canExecuteTool,
      ...skillMetaTools,
    ];
  }

  /**
   * 处理 MCP 工具调用
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<object>}
   */
  async handleMcpCall(toolName, args = {}) {
    switch (toolName) {
      case 'list_skills':
        return { skills: this.listSkills(args) };

      case 'get_skill': {
        const skill = this.getSkill(args.id);
        if (!skill) {
          return { error: `Skill not found: ${args.id}` };
        }
        return { skill };
      }

      case 'search_skills':
        return { skills: this.searchSkills(args.query) };

      case 'execute_skill':
        return this.executeSkill(args.id, args.params || {}, {
          workflowName: args.workflow,
          userContext: args.user_context,
        });

      case 'can_execute_skill':
        return this.canExecute(args.id);

      default:
        if (toolName.startsWith('skill:')) {
          const skillId = toolName.slice('skill:'.length);
          return this.executeSkill(skillId, args.params || {}, {
            userContext: args.user_context,
          });
        }
        return { error: `Unknown tool: ${toolName}` };
    }
  }
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 SkillsSDK 实例（默认注册表）
 * @param {object} [options]
 * @returns {SkillsSDK}
 */
function createSkillsSDK(options = {}) {
  return new SkillsSDK(options);
}

/**
 * 创建带内置 Skills 的 SDK — 默认最简启动方式
 * @returns {SkillsSDK}
 */
function createDefaultSDK() {
  const registry = createRegistry();
  // 触发惰性初始化
  discoverSkills();
  return new SkillsSDK({ registry });
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

module.exports = {
  // 主类
  SkillsSDK,

  // 工厂
  createSkillsSDK,
  createDefaultSDK,
  defaultRuntimeFactory,

  // 重新导出 Registry / Schema / Runtime 关键 API
  SkillRegistry,
  createRegistry,
  discoverSkills,
  loadBuiltInSkills,
  loadInstalledSkills,

  SkillSchema,
  validateSchemaManifest,
  applySkillDefaults,

  SkillRuntime,
  createSkillRuntime,
  EXECUTION_STATES,

  // 常量
  SOURCE_PRIORITY,
  PARAM_TYPES,
  SOURCE_TYPES,
  OUTPUT_TYPES,
  ERROR_CODES,
};
