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
  SOURCE_PRIORITY,
} = require('./skill-registry');

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

    return skills;
  }

  /**
   * 按 ID 获取 Skill
   * @param {string} id
   * @returns {object|null}
   */
  getSkill(id) {
    return this.registry.get(id);
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
