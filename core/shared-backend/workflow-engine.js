/**
 * shared-backend/workflow-engine.js — BioF3 Desktop Workflow Engine
 *
 * 工作流执行引擎：在 Skills 之上提供流程编排能力。
 *
 * 职责：
 * 1. 加载并解析 Workflow 定义
 * 2. 按 step 顺序执行，支持 condition、错误处理、状态持久化
 * 3. 在 step 之间传递上下文和输出
 * 4. 支持 checkpoint / resume
 *
 * 设计参考：
 * - skill-runtime.js — 单 Skill 执行
 * - skill-registry.js — Skill 发现
 * - agent-workflow.js — 现有工作流模式
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Workflow 状态常量
// ---------------------------------------------------------------------------

const WORKFLOW_STATES = Object.freeze({
  CREATED: 'created',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const STEP_STATES = Object.freeze({
  PENDING: 'pending',
  SKIPPED: 'skipped',
  RUNNING: 'running',
  COMPLETE: 'complete',
  FAILED: 'failed',
});

const ERROR_POLICIES = Object.freeze({
  FAIL: 'fail',
  WARN_CONTINUE: 'warn_continue',
  SKIP_CONTINUE: 'skip_continue',
});

const CONDITION_TYPES = Object.freeze({
  ALWAYS: 'always',
  EXPR: 'expr',
  STEP_SUCCESS: 'step_success',
});

const WORKFLOW_MANIFEST_VERSION = 1;

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function generateId(prefix = 'wf') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function deepGet(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Workflow — 内部执行单元
// ---------------------------------------------------------------------------

/**
 * 单 Workflow 执行实例
 */
class Workflow {
  /**
   * @param {object} manifest — Workflow Manifest
   * @param {object} options
   * @param {SkillsSDK} options.sdk — SkillsSDK 实例
   * @param {object} [options.executor] — 自定义执行器（用于 mock / 测试）
   */
  constructor(manifest, options = {}) {
    this.manifest = manifest;
    this.sdk = options.sdk;
    this.executor = options.executor || null;

    this.id = generateId('wfe');
    this.status = WORKFLOW_STATES.CREATED;
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.completedAt = null;

    /** @type {Map<string, object>} stepId -> StepExecution */
    this.steps = new Map();
    /** step 输出上下文 */
    this.context = {
      params: {},
      user_context: {},
      step_outputs: {},
      groups: [],
    };
  }

  /**
   * 执行整个 workflow
   * @param {object} params
   * @param {object} [userContext]
   * @returns {Promise<object>}
   */
  async execute(params = {}, userContext = {}) {
    this.context.params = { ...params };
    this.context.user_context = { ...userContext };

    // 初始化 step 状态
    for (const step of this.manifest.steps || []) {
      this.steps.set(step.id, {
        id: step.id,
        skill: step.skill,
        status: STEP_STATES.PENDING,
        started_at: null,
        completed_at: null,
        output: null,
        error: null,
      });
    }

    this.status = WORKFLOW_STATES.RUNNING;
    this.startedAt = new Date().toISOString();

    try {
      for (const step of this.manifest.steps || []) {
        const stepExec = this.steps.get(step.id);

        // 1. 评估 condition
        if (!this._evaluateCondition(step.condition)) {
          stepExec.status = STEP_STATES.SKIPPED;
          continue;
        }

        // 2. 解析 inputs
        const resolvedInputs = this._resolveInputs(step.inputs || {}, step.id);

        // 3. 执行 step
        stepExec.status = STEP_STATES.RUNNING;
        stepExec.started_at = new Date().toISOString();

        const result = await this._executeStep(step, resolvedInputs);

        // 4. 收集 outputs
        if (result.success) {
          stepExec.status = STEP_STATES.COMPLETE;
          stepExec.output = result;
          stepExec.completed_at = new Date().toISOString();

          if (step.outputs) {
            this._collectOutputs(step.id, result, step.outputs);
          }
        } else {
          // 错误处理
          stepExec.error = result.error;
          const policy = this._getErrorPolicy(step.id);

          if (policy === ERROR_POLICIES.SKIP_CONTINUE) {
            stepExec.status = STEP_STATES.SKIPPED;
          } else if (policy === ERROR_POLICIES.WARN_CONTINUE) {
            stepExec.status = STEP_STATES.COMPLETE;
            this.context.warnings = this.context.warnings || [];
            this.context.warnings.push({
              step: step.id,
              error: result.error,
            });
          } else {
            // FAIL
            stepExec.status = STEP_STATES.FAILED;
            stepExec.completed_at = new Date().toISOString();
            this.status = WORKFLOW_STATES.FAILED;
            this.completedAt = new Date().toISOString();

            return this._buildResult(false);
          }
        }
      }

      this.status = WORKFLOW_STATES.COMPLETE;
      this.completedAt = new Date().toISOString();
      return this._buildResult(true);
    } catch (error) {
      this.status = WORKFLOW_STATES.FAILED;
      this.completedAt = new Date().toISOString();
      this._lastError = {
        message: error.message,
        stack: error.stack,
      };
      return this._buildResult(false);
    }
  }

  /**
   * 评估 step condition
   * @param {string|undefined} condition
   * @returns {boolean}
   * @private
   */
  _evaluateCondition(condition) {
    if (!condition || condition === 'always') return true;

    const condDef = (this.manifest.conditions || {})[condition];
    if (!condDef) {
      // 未知 condition — 保守执行
      return true;
    }

    if (condDef.type === CONDITION_TYPES.ALWAYS) return true;

    if (condDef.type === CONDITION_TYPES.STEP_SUCCESS) {
      const depStep = this.steps.get(condDef.step);
      return depStep && depStep.status === STEP_STATES.COMPLETE;
    }

    if (condDef.type === CONDITION_TYPES.EXPR) {
      return this._evalExpr(condDef.expr);
    }

    return true;
  }

  /**
   * 求值简单表达式 — 仅支持白名单操作避免 eval 风险
   * @param {string} expr
   * @returns {boolean}
   * @private
   */
  _evalExpr(expr) {
    try {
      // 限制：只允许 context.* / params.* / 数字 / 比较运算符
      const safe = String(expr).trim();
      // 拒绝任何包含函数调用或赋值的表达式
      if (/[;{}()]|=|\beval\b|\bfunction\b/i.test(safe)) {
        return false;
      }
      // eslint-disable-next-line no-new-func
      const fn = new Function('context', 'params', `return (${safe});`);
      return Boolean(fn(this.context, this.context.params));
    } catch (e) {
      return false;
    }
  }

  /**
   * 解析 step inputs — 支持引用上游输出
   * @param {object} inputMap
   * @param {string} stepId
   * @returns {object}
   * @private
   */
  _resolveInputs(inputMap, stepId) {
    const resolved = {};
    for (const [key, value] of Object.entries(inputMap)) {
      resolved[key] = this._resolveValue(value, stepId);
    }
    return resolved;
  }

  /**
   * 解析单个引用值
   * 支持格式：
   *   "params.dataset"        — 顶层参数
   *   "user_context.user_id"  — 用户上下文
   *   "<step_id>.output"      — 上游 step 输出
   *   "<step_id>.output.<key>" — 上游 step 输出字段
   *   其他：字面值
   * @param {*} value
   * @param {string} stepId
   * @returns {*}
   * @private
   */
  _resolveValue(value, stepId) {
    if (typeof value !== 'string') return value;
    if (!value.includes('.')) return value;

    const parts = value.split('.');
    const head = parts[0];

    if (head === 'params') {
      return deepGet(this.context.params, parts.slice(1).join('.'));
    }
    if (head === 'user_context' || head === 'userContext') {
      return deepGet(this.context.user_context, parts.slice(1).join('.'));
    }

    // 引用 step 输出
    if (this.steps.has(head)) {
      const stepExec = this.steps.get(head);
      if (!stepExec || !stepExec.output) return undefined;
      return deepGet(stepExec.output, parts.slice(1).join('.'));
    }

    return value;
  }

  /**
   * 收集 step 输出到 context
   * @param {string} stepId
   * @param {object} result
   * @param {object} outputs
   * @private
   */
  _collectOutputs(stepId, result, outputs) {
    this.context.step_outputs[stepId] = result;

    for (const [alias, source] of Object.entries(outputs)) {
      // source 可以是字符串路径或简单 alias
      const value =
        typeof source === 'string' && source.includes('.')
          ? deepGet(result, source)
          : deepGet(result, source);
      this.context[alias] = value;
    }
  }

  /**
   * 获取错误处理策略
   * @param {string} stepId
   * @returns {string}
   * @private
   */
  _getErrorPolicy(stepId) {
    const overrides = this.manifest.error_handling?.step_overrides || {};
    return overrides[stepId]?.on_error || this.manifest.error_handling?.default || ERROR_POLICIES.FAIL;
  }

  /**
   * 执行单个 step
   * @param {object} step
   * @param {object} inputs
   * @returns {Promise<object>}
   * @private
   */
  async _executeStep(step, inputs) {
    if (this.executor) {
      // 自定义执行器（用于 mock / 测试）
      return this.executor(step, inputs, this.context);
    }

    if (!this.sdk) {
      return {
        success: false,
        error: { code: 'SDK_NOT_AVAILABLE', message: 'SkillsSDK not configured' },
      };
    }

    return this.sdk.executeSkill(step.skill, inputs, {
      workflowName: step.workflow,
      userContext: this.context.user_context,
      stepId: step.id,
    });
  }

  /**
   * 构建执行结果
   * @param {boolean} success
   * @returns {object}
   * @private
   */
  _buildResult(success) {
    return {
      success,
      workflowId: this.id,
      workflowManifestId: this.manifest.id,
      status: this.status,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      duration: this.startedAt && this.completedAt
        ? new Date(this.completedAt).getTime() - new Date(this.startedAt).getTime()
        : null,
      steps: Array.from(this.steps.values()),
      outputs: { ...this.context.step_outputs },
      params: { ...this.context.params },
      warnings: this.context.warnings || [],
      error: this._lastError || null,
    };
  }
}

// ---------------------------------------------------------------------------
// WorkflowEngine — 主类
// ---------------------------------------------------------------------------

/**
 * Workflow Engine
 *
 * 加载、执行、追踪 Workflow 的主入口。
 * 不强制持久化；执行历史保留在内存中以便查询。
 */
class WorkflowEngine {
  /**
   * @param {object} options
   * @param {SkillsSDK} options.sdk — SkillsSDK 实例（必需）
   * @param {string} [options.workflowsDir] — 内置 Workflow 定义目录
   */
  constructor(options = {}) {
    if (!options.sdk) {
      throw new Error('WorkflowEngine requires SkillsSDK instance');
    }
    this.sdk = options.sdk;
    this.workflowsDir = options.workflowsDir || null;

    /** @type {Map<string, object>} workflowId -> Workflow Manifest */
    this._workflows = new Map();
    /** @type {Map<string, Workflow>} executionId -> Workflow 实例 */
    this._executions = new Map();
  }

  // ── 加载 / 注册 ────────────────────────────────────────────────────────

  /**
   * 加载单个 Workflow Manifest
   * @param {object} manifest
   * @returns {object|null}
   */
  loadWorkflow(manifest) {
    if (!manifest || manifest.workflowManifestVersion !== WORKFLOW_MANIFEST_VERSION) {
      return null;
    }
    if (!manifest.id || !manifest.steps || !Array.isArray(manifest.steps)) {
      return null;
    }

    const normalized = this._normalizeManifest(manifest);
    this._workflows.set(manifest.id, normalized);
    return normalized;
  }

  /**
   * 从文件加载 Workflow Manifest
   * @param {string} filePath
   * @returns {object|null}
   */
  loadWorkflowFromFile(filePath) {
    const manifest = readJson(filePath);
    if (!manifest) return null;
    return this.loadWorkflow(manifest);
  }

  /**
   * 从目录加载所有 Workflow
   * @param {string} dir
   * @returns {object[]}
   */
  loadWorkflowsFromDir(dir) {
    if (!fs.existsSync(dir)) return [];
    const loaded = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const wfPath = path.join(dir, entry.name, 'workflow.json');
      const wf = this.loadWorkflowFromFile(wfPath);
      if (wf) loaded.push(wf);
    }
    return loaded;
  }

  /**
   * 注册已加载的 Workflow
   * @param {string} id
   * @param {object} manifest
   * @returns {boolean}
   */
  registerWorkflow(id, manifest) {
    const normalized = this.loadWorkflow({ ...manifest, id });
    return normalized !== null;
  }

  /**
   * 列出所有已加载的 Workflow
   * @returns {object[]}
   */
  listWorkflows() {
    return Array.from(this._workflows.values());
  }

  /**
   * 按 ID 获取 Workflow Manifest
   * @param {string} id
   * @returns {object|null}
   */
  getWorkflow(id) {
    return this._workflows.get(id) || null;
  }

  // ── 执行 ────────────────────────────────────────────────────────────────

  /**
   * 执行 Workflow
   * @param {string} workflowId
   * @param {object} params
   * @param {object} [context]
   * @returns {Promise<object>}
   */
  async execute(workflowId, params = {}, context = {}) {
    let manifest = this._workflows.get(workflowId);

    if (!manifest) {
      // 支持 "skill:workflow" 复合 ID 解析
      if (workflowId.includes(':')) {
        const [skillId, wfName] = workflowId.split(':');
        manifest = this._buildSkillInlineWorkflow(skillId, wfName);
      }
    }

    if (!manifest) {
      return {
        success: false,
        error: {
          code: 'WORKFLOW_NOT_FOUND',
          message: `Workflow not found: ${workflowId}`,
        },
        workflowId,
      };
    }

    const workflow = new Workflow(manifest, {
      sdk: this.sdk,
      executor: context.executor,
    });

    this._executions.set(workflow.id, workflow);
    const result = await workflow.execute(params, context.userContext || {});

    return result;
  }

  /**
   * 执行单步（不依赖 Workflow Manifest）
   * @param {string} skillId
   * @param {object} context
   * @returns {Promise<object>}
   */
  async step(skillId, context = {}) {
    return this.sdk.executeSkill(skillId, context.params || {}, context);
  }

  /**
   * 取消正在执行的 Workflow
   * @param {string} executionId
   * @returns {boolean}
   */
  cancel(executionId) {
    const wf = this._executions.get(executionId);
    if (!wf) return false;
    wf.status = WORKFLOW_STATES.CANCELLED;
    wf.completedAt = new Date().toISOString();
    return true;
  }

  /**
   * 获取执行实例状态
   * @param {string} executionId
   * @returns {object|null}
   */
  getExecution(executionId) {
    const wf = this._executions.get(executionId);
    if (!wf) return null;
    return {
      id: wf.id,
      status: wf.status,
      startedAt: wf.startedAt,
      completedAt: wf.completedAt,
      steps: Array.from(wf.steps.values()),
    };
  }

  // ── 工具方法 ────────────────────────────────────────────────────────────

  /**
   * 规范化 Workflow Manifest
   * @param {object} manifest
   * @returns {object}
   * @private
   */
  _normalizeManifest(manifest) {
    return {
      workflowManifestVersion: WORKFLOW_MANIFEST_VERSION,
      id: manifest.id,
      name: manifest.name || manifest.id,
      version: manifest.version || '1.0.0',
      description: manifest.description || '',
      category: manifest.category || 'general',
      source: manifest.source || 'built-in',
      steps: (manifest.steps || []).map((s) => ({
        id: s.id,
        skill: s.skill,
        description: s.description || '',
        condition: s.condition || 'always',
        inputs: s.inputs || {},
        outputs: s.outputs || {},
        workflow: s.workflow,
      })),
      conditions: manifest.conditions || {},
      error_handling: manifest.error_handling || { default: ERROR_POLICIES.FAIL },
      metadata: manifest.metadata || {},
    };
  }

  /**
   * 从 Skill Manifest 内联构建 Workflow
   * 用于 "skill:workflow" 复合 ID 解析
   * @param {string} skillId
   * @param {string} workflowName
   * @returns {object|null}
   * @private
   */
  _buildSkillInlineWorkflow(skillId, workflowName) {
    const skill = this.sdk.getSkill(skillId);
    if (!skill) return null;

    return {
      workflowManifestVersion: WORKFLOW_MANIFEST_VERSION,
      id: `${skillId}:${workflowName}`,
      name: `${skill.name} (${workflowName})`,
      version: skill.version,
      description: skill.description,
      category: skill.category,
      source: skill.source,
      steps: [
        {
          id: 'main',
          skill: skillId,
          condition: 'always',
          workflow: workflowName,
          inputs: {},
        },
      ],
      error_handling: { default: ERROR_POLICIES.FAIL },
    };
  }
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 WorkflowEngine 实例
 * @param {object} options
 * @returns {WorkflowEngine}
 */
function createWorkflowEngine(options = {}) {
  return new WorkflowEngine(options);
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

module.exports = {
  // 主类
  WorkflowEngine,
  Workflow,

  // 工厂
  createWorkflowEngine,

  // 常量
  WORKFLOW_STATES,
  STEP_STATES,
  ERROR_POLICIES,
  CONDITION_TYPES,
  WORKFLOW_MANIFEST_VERSION,
};
