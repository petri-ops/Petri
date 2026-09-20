'use strict';

/**
 * skill-runtime.js — BioF3 Desktop Skills 执行运行时
 *
 * Phase 1 产物：Skills 层执行引擎，负责：
 * 1. Skill 执行编排
 * 2. 参数校验与填充
 * 3. 依赖检查（plugins + capabilities）
 * 4. Workflow 编排调用
 * 5. 恢复策略处理
 * 6. 执行状态持久化与断点恢复
 *
 * 位置：core/shared-backend/skill-runtime.js
 * 架构：Layer 4 (Skills) → Layer 3 (Workflows) → Layer 2 (Plugins) → Layer 1 (Capabilities)
 *
 * 设计参考：
 * - agent-workflow.js：工作流状态投影与执行模式
 * - loop-checkpoint.js：检查点持久化与状态管理
 * - tool-registry.js：工具注册与发现
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Execution States
// ---------------------------------------------------------------------------

const EXECUTION_STATES = Object.freeze({
  CREATED: 'created',
  VALIDATING_PARAMS: 'validating_params',
  CHECKING_DEPS: 'checking_dependencies',
  RUNNING: 'running',
  PAUSED: 'paused',
  RECOVERING: 'recovering',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const EXECUTION_STATE_VERSION = 1;

// ---------------------------------------------------------------------------
// SkillRuntime — 主执行器类
// ---------------------------------------------------------------------------

/**
 * Skill 执行运行时
 *
 * @param {Object} options
 * @param {Object} options.skill - Skill Manifest
 * @param {Object} options.registry - Skill Registry 实例
 * @param {Object} options.pluginManager - Plugin Manager 实例
 * @param {Object} options.workflowRuntime - Workflow Runtime 实例
 * @param {Function} options.getToolJob - 获取 Tool Job 的函数 (jobId) => job
 * @param {Object} options.capabilityProvisioning - Capability Provisioning 实例
 */
class SkillRuntime {
  constructor(options = {}) {
    this.skill = options.skill || null;
    this.registry = options.registry || null;
    this.pluginManager = options.pluginManager || null;
    this.workflowRuntime = options.workflowRuntime || null;
    this.getToolJob = options.getToolJob || null;
    this.capabilityProvisioning = options.capabilityProvisioning || null;

    // 执行上下文
    this._executions = new Map(); // executionId → ExecutionContext

    // 日志前缀
    this._logPrefix = `[SkillRuntime:${this.skill?.id || 'unknown'}]`;
  }

  // ---------------------------------------------------------------------------
  // Core API: execute / resume / cancel
  // ---------------------------------------------------------------------------

  /**
   * 执行 Skill
   *
   * @param {Object} params - 用户提供的参数
   * @param {Object} context - 执行上下文
   * @param {string} [context.executionId] - 可选：恢复已有执行
   * @param {string} [context.workflowName] - 可选：指定 workflow 变体
   * @param {Object} [context.userContext] - 用户上下文
   * @returns {Promise<ExecutionResult>}
   */
  async execute(params = {}, context = {}) {
    const startTime = Date.now();
    const executionId = context.executionId || this._generateExecutionId();

    this._log('info', `Starting execution ${executionId}`);

    try {
      // 1. 获取或创建执行上下文
      let execCtx = this._executions.get(executionId);
      if (!execCtx) {
        execCtx = this._createExecutionContext(executionId, params, context);
        this._executions.set(executionId, execCtx);
      }

      // 2. 参数校验与填充
      execCtx.status = EXECUTION_STATES.VALIDATING_PARAMS;
      const validatedParams = await this._validateAndFillParams(params, execCtx);

      // 3. 依赖检查
      execCtx.status = EXECUTION_STATES.CHECKING_DEPS;
      await this._checkDependencies(execCtx);

      // 4. 执行 Workflow
      execCtx.status = EXECUTION_STATES.RUNNING;
      const workflowResult = await this._runWorkflow(execCtx, validatedParams);

      // 5. 处理恢复策略（如需要）
      if (workflowResult.status === 'recoverable') {
        execCtx.status = EXECUTION_STATES.RECOVERING;
        const recoveryResult = await this._applyRecovery(workflowResult, execCtx);
        if (recoveryResult.recovered) {
          return this._buildSuccessResult(execCtx, recoveryResult.result, startTime);
        }
      }

      // 6. 检查最终状态
      if (workflowResult.status === 'failed') {
        execCtx.status = EXECUTION_STATES.FAILED;
        execCtx.error = workflowResult.error;
        return this._buildFailureResult(execCtx, workflowResult.error, startTime);
      }

      // 7. 聚合结果
      execCtx.status = EXECUTION_STATES.COMPLETE;
      return this._buildSuccessResult(execCtx, workflowResult, startTime);

    } catch (error) {
      this._log('error', `Execution ${executionId} failed:`, error.message);
      const execCtx = this._executions.get(executionId);
      if (execCtx) {
        execCtx.status = EXECUTION_STATES.FAILED;
        execCtx.error = this._serializeError(error);
      }
      return this._buildFailureResult(
        execCtx || { executionId, skillId: this.skill?.id },
        error,
        startTime
      );
    }
  }

  /**
   * 恢复执行
   *
   * @param {string} executionId - 执行 ID
   * @param {Object} [options] - 恢复选项
   * @param {Object} [options.params] - 新的参数（如需要覆盖）
   * @returns {Promise<ExecutionResult>}
   */
  async resume(executionId, options = {}) {
    const execCtx = this._executions.get(executionId);
    if (!execCtx) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    this._log('info', `Resuming execution ${executionId}, status: ${execCtx.status}`);

    // 根据状态决定恢复策略
    switch (execCtx.status) {
      case EXECUTION_STATES.PAUSED:
        return this._resumeFromPaused(execCtx, options);

      case EXECUTION_STATES.RECOVERING:
        return this._resumeFromRecovering(execCtx, options);

      case EXECUTION_STATES.FAILED:
        return this._retryFailed(execCtx, options);

      default:
        throw new Error(`Cannot resume from status: ${execCtx.status}`);
    }
  }

  /**
   * 取消执行
   *
   * @param {string} executionId - 执行 ID
   * @returns {void}
   */
  cancel(executionId) {
    const execCtx = this._executions.get(executionId);
    if (!execCtx) {
      this._log('warn', `Execution not found for cancel: ${executionId}`);
      return;
    }

    this._log('info', `Cancelling execution ${executionId}`);

    // 标记为已取消
    execCtx.status = EXECUTION_STATES.CANCELLED;
    execCtx.cancelledAt = new Date().toISOString();

    // 如果有进行中的 workflow job，取消它
    if (execCtx.currentWorkflowJobId && this.workflowRuntime?.cancel) {
      try {
        this.workflowRuntime.cancel(execCtx.currentWorkflowJobId);
      } catch (err) {
        this._log('warn', `Failed to cancel workflow job:`, err.message);
      }
    }

    // 保存最终状态
    this._persistExecutionState(execCtx);
  }

  /**
   * 获取执行状态
   *
   * @param {string} executionId
   * @returns {ExecutionContext|null}
   */
  getExecutionStatus(executionId) {
    return this._executions.get(executionId) || null;
  }

  /**
   * 列出所有执行
   *
   * @param {Object} [filter]
   * @param {string} [filter.skillId]
   * @param {string} [filter.status]
   * @returns {ExecutionContext[]}
   */
  listExecutions(filter = {}) {
    const executions = Array.from(this._executions.values());

    return executions.filter((exec) => {
      if (filter.skillId && exec.skillId !== filter.skillId) return false;
      if (filter.status && exec.status !== filter.status) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Execution Context Management
  // ---------------------------------------------------------------------------

  /**
   * 创建执行上下文
   */
  _createExecutionContext(executionId, params, context) {
    return {
      executionId,
      skillId: this.skill?.id,
      skillVersion: this.skill?.version,

      // 参数
      initialParams: { ...params },
      validatedParams: null,
      resolvedParams: null,

      // 执行状态
      status: EXECUTION_STATES.CREATED,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      cancelledAt: null,

      // 工作流执行
      workflowName: context.workflowName || this.skill?.workflows?.default || 'default',
      currentWorkflowJobId: null,
      workflowCheckpoint: null,

      // 产物收集
      artifacts: [],
      outputs: {},

      // 错误与恢复
      error: null,
      recoveryAttempts: [],
      lastRecoveryStrategy: null,

      // 用户上下文
      userContext: context.userContext || {},

      // 断点
      checkpoints: [],
      currentStepIndex: 0,
      stepResults: [],

      // 预算跟踪
      budgetUsed: {
        elapsedMs: 0,
        iterations: 0,
      },

      // 元数据
      schemaVersion: EXECUTION_STATE_VERSION,
    };
  }

  /**
   * 保存执行状态到检查点
   */
  _persistExecutionState(execCtx) {
    const checkpoint = this._createCheckpoint(execCtx);
    execCtx.checkpoints.push(checkpoint);
    // 保持最多 10 个检查点
    if (execCtx.checkpoints.length > 10) {
      execCtx.checkpoints = execCtx.checkpoints.slice(-10);
    }
    return checkpoint;
  }

  /**
   * 创建检查点
   */
  _createCheckpoint(execCtx) {
    return {
      checkpointId: this._generateCheckpointId(execCtx.executionId),
      executionId: execCtx.executionId,
      sequence: execCtx.checkpoints.length,
      status: execCtx.status,
      currentStepIndex: execCtx.currentStepIndex,
      validatedParams: execCtx.validatedParams,
      workflowCheckpoint: execCtx.workflowCheckpoint,
      artifacts: [...execCtx.artifacts],
      outputs: { ...execCtx.outputs },
      createdAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Parameter Validation and Filling
  // ---------------------------------------------------------------------------

  /**
   * 校验并填充参数
   *
   * @param {Object} params
   * @param {Object} execCtx
   * @returns {Promise<Object>} 校验后的参数
   */
  async _validateAndFillParams(params, execCtx) {
    const spec = this.skill?.parameters || {};
    const required = spec.required || [];
    const optional = spec.optional || {};

    const errors = [];
    const result = { ...params };

    // 1. 检查必填参数
    for (const param of required) {
      if (!(param in result) || result[param] === null || result[param] === undefined) {
        errors.push({
          code: 'MISSING_REQUIRED_PARAM',
          param,
          message: `Missing required parameter: ${param}`,
        });
      }
    }

    if (errors.length > 0) {
      throw this._buildValidationError('Parameter validation failed', errors);
    }

    // 2. 填充可选参数默认值
    for (const [key, spec] of Object.entries(optional)) {
      if (!(key in result) || result[key] === null || result[key] === undefined) {
        if ('default' in spec) {
          result[key] = spec.default;
        }
      }
    }

    // 3. 类型校验
    const typeErrors = this._validateParamTypes(result, spec);
    if (typeErrors.length > 0) {
      errors.push(...typeErrors);
    }

    if (errors.length > 0) {
      throw this._buildValidationError('Parameter validation failed', errors);
    }

    // 4. 值范围校验
    const rangeErrors = this._validateParamRanges(result, spec);
    if (rangeErrors.length > 0) {
      errors.push(...rangeErrors);
    }

    if (errors.length > 0) {
      throw this._buildValidationError('Parameter validation failed', errors);
    }

    execCtx.validatedParams = result;
    this._log('debug', 'Parameters validated:', result);

    return result;
  }

  /**
   * 校验参数类型
   */
  _validateParamTypes(params, spec) {
    const errors = [];
    const optional = spec.optional || {};

    for (const [key, value] of Object.entries(params)) {
      const paramSpec = optional[key];
      if (!paramSpec) continue;

      const expectedType = paramSpec.type;
      if (!expectedType) continue;

      if (expectedType === 'number' && typeof value !== 'number') {
        errors.push({
          code: 'INVALID_PARAM_TYPE',
          param: key,
          expected: expectedType,
          actual: typeof value,
          message: `Parameter ${key} must be of type ${expectedType}`,
        });
      } else if (expectedType === 'string' && typeof value !== 'string') {
        errors.push({
          code: 'INVALID_PARAM_TYPE',
          param: key,
          expected: expectedType,
          actual: typeof value,
          message: `Parameter ${key} must be of type ${expectedType}`,
        });
      } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
        errors.push({
          code: 'INVALID_PARAM_TYPE',
          param: key,
          expected: expectedType,
          actual: typeof value,
          message: `Parameter ${key} must be of type ${expectedType}`,
        });
      } else if (expectedType === 'select') {
        const options = paramSpec.options || [];
        if (!options.includes(value)) {
          errors.push({
            code: 'INVALID_SELECT_OPTION',
            param: key,
            value,
            allowed: options,
            message: `Parameter ${key} must be one of: ${options.join(', ')}`,
          });
        }
      }
    }

    return errors;
  }

  /**
   * 校验参数范围
   */
  _validateParamRanges(params, spec) {
    const errors = [];
    const optional = spec.optional || {};

    for (const [key, value] of Object.entries(params)) {
      const paramSpec = optional[key];
      if (!paramSpec || typeof value !== 'number') continue;

      if ('min' in paramSpec && value < paramSpec.min) {
        errors.push({
          code: 'PARAM_BELOW_MIN',
          param: key,
          value,
          min: paramSpec.min,
          message: `Parameter ${key} must be >= ${paramSpec.min}`,
        });
      }

      if ('max' in paramSpec && value > paramSpec.max) {
        errors.push({
          code: 'PARAM_ABOVE_MAX',
          param: key,
          value,
          max: paramSpec.max,
          message: `Parameter ${key} must be <= ${paramSpec.max}`,
        });
      }
    }

    return errors;
  }

  /**
   * 构建校验错误
   */
  _buildValidationError(message, errors) {
    const error = new Error(message);
    error.code = 'VALIDATION_ERROR';
    error.validationErrors = errors;
    return error;
  }

  // ---------------------------------------------------------------------------
  // Dependency Checking
  // ---------------------------------------------------------------------------

  /**
   * 检查依赖就绪状态
   */
  async _checkDependencies(execCtx) {
    const skill = this.skill;
    if (!skill) return;

    const dependencyErrors = [];

    // 1. 检查必需插件
    const requiredPlugins = skill.plugins?.required || [];
    for (const pluginId of requiredPlugins) {
      const ready = await this._checkPluginReady(pluginId);
      if (!ready) {
        dependencyErrors.push({
          code: 'PLUGIN_NOT_READY',
          pluginId,
          message: `Required plugin not available: ${pluginId}`,
        });
      }
    }

    // 2. 检查可选插件（警告但不阻止）
    const optionalPlugins = skill.plugins?.optional || [];
    for (const pluginId of optionalPlugins) {
      const ready = await this._checkPluginReady(pluginId);
      if (!ready) {
        execCtx.warnings = execCtx.warnings || [];
        execCtx.warnings.push({
          code: 'OPTIONAL_PLUGIN_NOT_READY',
          pluginId,
          message: `Optional plugin not available: ${pluginId}, some features may be disabled`,
        });
      }
    }

    // 3. 检查 Capabilities
    const capabilities = skill.capabilities || [];
    for (const capabilityId of capabilities) {
      const ready = await this._checkCapabilityReady(capabilityId);
      if (!ready) {
        // 尝试自动准备
        if (this.capabilityProvisioning?.provision) {
          try {
            await this.capabilityProvisioning.provision(capabilityId);
          } catch (err) {
            dependencyErrors.push({
              code: 'CAPABILITY_NOT_READY',
              capabilityId,
              message: `Required capability not available: ${capabilityId}`,
              detail: err.message,
            });
          }
        } else {
          dependencyErrors.push({
            code: 'CAPABILITY_NOT_READY',
            capabilityId,
            message: `Required capability not available: ${capabilityId}`,
          });
        }
      }
    }

    if (dependencyErrors.length > 0) {
      throw this._buildDependencyError('Dependencies not satisfied', dependencyErrors);
    }
  }

  /**
   * 检查插件是否就绪
   */
  async _checkPluginReady(pluginId) {
    // 优先使用 registry
    if (this.registry?.isPluginAvailable) {
      return this.registry.isPluginAvailable(pluginId);
    }

    // 备用：直接检查 pluginManager
    if (this.pluginManager?.isPluginInstalled) {
      return this.pluginManager.isPluginInstalled(pluginId);
    }

    // 兜底：假设就绪
    return true;
  }

  /**
   * 检查 Capability 是否就绪
   */
  async _checkCapabilityReady(capabilityId) {
    if (this.capabilityProvisioning?.checkReady) {
      return this.capabilityProvisioning.checkReady(capabilityId);
    }
    return true;
  }

  /**
   * 构建依赖错误
   */
  _buildDependencyError(message, errors) {
    const error = new Error(message);
    error.code = 'DEPENDENCY_ERROR';
    error.dependencyErrors = errors;
    return error;
  }

  // ---------------------------------------------------------------------------
  // Workflow Orchestration
  // ---------------------------------------------------------------------------

  /**
   * 运行 Workflow
   */
  async _runWorkflow(execCtx, params) {
    const workflowName = execCtx.workflowName;
    const workflowId = `${this.skill?.id}:${workflowName}`;

    this._log('info', `Running workflow ${workflowId}`);

    // 如果有 workflow runtime，使用它
    if (this.workflowRuntime?.run) {
      const result = await this.workflowRuntime.run(workflowId, params, {
        skillContext: {
          executionId: execCtx.executionId,
          skillId: this.skill?.id,
          checkpoint: execCtx.workflowCheckpoint,
        },
      });

      // 收集 artifacts
      if (result.artifacts) {
        execCtx.artifacts.push(...result.artifacts);
      }
      if (result.outputs) {
        execCtx.outputs = { ...execCtx.outputs, ...result.outputs };
      }

      // 保存检查点
      if (result.checkpoint) {
        execCtx.workflowCheckpoint = result.checkpoint;
      }

      return result;
    }

    // 兜底：直接执行 plugin 步骤
    return this._runFallbackWorkflow(execCtx, params);
  }

  /**
   * 兜底：直接执行 plugin 步骤
   */
  async _runFallbackWorkflow(execCtx, params) {
    const plugins = this.skill?.plugins?.required || [];

    const results = [];
    for (const pluginId of plugins) {
      this._log('info', `Executing plugin ${pluginId}`);

      // 调用 run_tool 接口
      const pluginResult = await this._executePlugin(pluginId, params, execCtx);

      results.push({
        pluginId,
        status: pluginResult.success ? 'complete' : 'failed',
        result: pluginResult,
      });

      if (pluginResult.artifacts) {
        execCtx.artifacts.push(...pluginResult.artifacts);
      }
      if (pluginResult.output) {
        execCtx.outputs[pluginId] = pluginResult.output;
      }

      if (!pluginResult.success) {
        return {
          status: 'failed',
          error: {
            code: 'PLUGIN_EXECUTION_FAILED',
            pluginId,
            message: pluginResult.error?.message || 'Plugin execution failed',
          },
          partialResults: results,
        };
      }
    }

    return {
      status: 'complete',
      artifacts: execCtx.artifacts,
      outputs: execCtx.outputs,
      results,
    };
  }

  /**
   * 执行单个 Plugin
   */
  async _executePlugin(pluginId, params, _execCtx) {
    // 调用 run_tool 接口
    // 这应该通过 MCP 或其他 IPC 机制调用
    const toolId = this._resolveToolId(pluginId);

    try {
      // 优先使用 registry 执行
      if (this.registry?.runTool) {
        const result = await this.registry.runTool(toolId, params);
        return {
          success: true,
          output: result.output,
          artifacts: result.artifacts || [],
        };
      }

      // 兜底：返回失败
      return {
        success: false,
        error: new Error(`No tool executor available for ${pluginId}`),
      };
    } catch (err) {
      return {
        success: false,
        error: err,
      };
    }
  }

  /**
   * 解析 Plugin ID 到 Tool ID
   */
  _resolveToolId(pluginId) {
    // plugin 和 tool 通常有相同的 ID
    return pluginId;
  }

  // ---------------------------------------------------------------------------
  // Recovery Strategies
  // ---------------------------------------------------------------------------

  /**
   * 应用恢复策略
   */
  async _applyRecovery(workflowResult, execCtx) {
    const strategies = this.skill?.recovery_strategies || [];
    const error = workflowResult.error;

    for (const strategy of strategies) {
      if (strategy.when !== error?.code && strategy.when !== error?.message) {
        continue;
      }

      if (!strategy.recoverable) {
        continue;
      }

      this._log('info', `Applying recovery strategy: ${strategy.description}`);

      try {
        const recoveryResult = await this._executeRecovery(strategy, error, execCtx);

        if (recoveryResult.recovered) {
          execCtx.recoveryAttempts.push({
            strategyId: strategy.when,
            timestamp: new Date().toISOString(),
            result: 'success',
          });
          return recoveryResult;
        }
      } catch (err) {
        execCtx.recoveryAttempts.push({
          strategyId: strategy.when,
          timestamp: new Date().toISOString(),
          result: 'failed',
          error: err.message,
        });
        this._log('warn', `Recovery strategy failed:`, err.message);
      }
    }

    return { recovered: false, error: 'No recovery strategy succeeded' };
  }

  /**
   * 执行单个恢复策略
   */
  async _executeRecovery(strategy, error, execCtx) {
    const strategyType = this._determineRecoveryType(strategy);

    switch (strategyType) {
      case 'retry':
        return this._recoveryRetry(strategy, execCtx);

      case 'fallback':
        return this._recoveryFallback(strategy, execCtx);

      case 'repair':
        return this._recoveryRepair(strategy, error, execCtx);

      default:
        return { recovered: false, error: 'Unknown recovery type' };
    }
  }

  /**
   * 确定恢复类型
   */
  _determineRecoveryType(strategy) {
    if (strategy.type === 'retry') return 'retry';
    if (strategy.type === 'fallback') return 'fallback';
    if (strategy.type === 'repair') return 'repair';
    // 根据 do 字段内容推断
    const doStr = (strategy.do || '').toLowerCase();
    if (doStr.includes('retry') || doStr.includes('重试')) return 'retry';
    if (doStr.includes('fallback') || doStr.includes('降级')) return 'fallback';
    return 'repair';
  }

  /**
   * 重试恢复
   */
  async _recoveryRetry(strategy, execCtx) {
    // 等待后重试
    await this._sleep(1000);

    const result = await this._runWorkflow(execCtx, execCtx.validatedParams);

    return {
      recovered: result.status === 'complete',
      result,
    };
  }

  /**
   * 降级恢复
   */
  async _recoveryFallback(strategy, execCtx) {
    // 使用降级参数重试
    const fallbackParams = this._applyFallbackParams(execCtx.validatedParams, strategy);

    const result = await this._runWorkflow(execCtx, fallbackParams);

    return {
      recovered: result.status === 'complete',
      result,
    };
  }

  /**
   * 修复恢复
   */
  async _recoveryRepair(strategy, error, execCtx) {
    // 尝试修复问题
    const repairedParams = this._repairParams(execCtx.validatedParams, error, strategy);

    if (repairedParams) {
      const result = await this._runWorkflow(execCtx, repairedParams);

      return {
        recovered: result.status === 'complete',
        result,
      };
    }

    return { recovered: false, error: 'Repair not applicable' };
  }

  /**
   * 应用降级参数
   */
  _applyFallbackParams(params, strategy) {
    // 从 strategy 解析降级参数
    const fallback = { ...params };

    // 常见降级模式：放宽阈值
    if (strategy.fallback?.includes('threshold')) {
      // 尝试放宽 padj_threshold
      if (fallback.padj_threshold) {
        fallback.padj_threshold = Math.min(fallback.padj_threshold * 2, 0.1);
      }
      if (fallback.pvalue_cutoff) {
        fallback.pvalue_cutoff = Math.min(fallback.pvalue_cutoff * 2, 0.1);
      }
    }

    return fallback;
  }

  /**
   * 修复参数
   */
  _repairParams(params, error, _strategy) {
    const repaired = { ...params };

    // 根据错误类型修复
    switch (error?.code) {
      case 'PARAM_BELOW_MIN':
        repaired[error.param] = error.min;
        break;

      case 'PARAM_ABOVE_MAX':
        repaired[error.param] = error.max;
        break;

      default:
        // 无法修复
        return null;
    }

    return repaired;
  }

  // ---------------------------------------------------------------------------
  // Resume Implementations
  // ---------------------------------------------------------------------------

  /**
   * 从暂停状态恢复
   */
  async _resumeFromPaused(execCtx, _options) {
    this._log('info', 'Resuming from paused state');

    // 重新检查依赖
    await this._checkDependencies(execCtx);

    // 从检查点恢复
    const checkpoint = execCtx.checkpoints[execCtx.checkpoints.length - 1];
    if (checkpoint) {
      execCtx.workflowCheckpoint = checkpoint.workflowCheckpoint;
    }

    // 继续执行
    return this.execute(execCtx.validatedParams, {
      executionId: execCtx.executionId,
      workflowName: execCtx.workflowName,
    });
  }

  /**
   * 从恢复状态恢复
   */
  async _resumeFromRecovering(execCtx, _options) {
    this._log('info', 'Resuming from recovering state');

    // 继续恢复流程
    const workflowResult = await this._runWorkflow(execCtx, execCtx.validatedParams);

    if (workflowResult.status === 'complete') {
      return this._buildSuccessResult(execCtx, workflowResult, Date.now());
    }

    return this._buildFailureResult(execCtx, workflowResult.error, Date.now());
  }

  /**
   * 重试失败的执行
   */
  async _retryFailed(execCtx, options) {
    this._log('info', 'Retrying failed execution');

    // 重置状态
    execCtx.status = EXECUTION_STATES.CREATED;
    execCtx.error = null;
    execCtx.startedAt = new Date().toISOString();

    // 应用新的参数（如果有）
    const params = options.params || execCtx.validatedParams;

    // 重新执行
    return this.execute(params, {
      executionId: execCtx.executionId,
      workflowName: execCtx.workflowName,
    });
  }

  // ---------------------------------------------------------------------------
  // Result Building
  // ---------------------------------------------------------------------------

  /**
   * 构建成功结果
   */
  _buildSuccessResult(execCtx, workflowResult, startTime) {
    const duration = Date.now() - startTime;

    return {
      success: true,
      executionId: execCtx.executionId,
      skillId: this.skill?.id,

      status: 'complete',
      duration,

      artifacts: workflowResult.artifacts || execCtx.artifacts,
      outputs: workflowResult.outputs || execCtx.outputs,

      checkpoints: execCtx.checkpoints.map((cp) => cp.checkpointId),

      execution: {
        skillId: execCtx.skillId,
        skillVersion: execCtx.skillVersion,
        workflowName: execCtx.workflowName,
        createdAt: execCtx.createdAt,
        startedAt: execCtx.startedAt,
        completedAt: new Date().toISOString(),
        recoveryAttempts: execCtx.recoveryAttempts.length,
      },
    };
  }

  /**
   * 构建失败结果
   */
  _buildFailureResult(execCtx, error, startTime) {
    const duration = Date.now() - startTime;

    return {
      success: false,
      executionId: execCtx?.executionId,
      skillId: this.skill?.id,

      status: 'failed',
      duration,

      error: this._serializeError(error),

      checkpoints: execCtx?.checkpoints?.map((cp) => cp.checkpointId) || [],

      execution: {
        skillId: execCtx?.skillId,
        skillVersion: execCtx?.skillVersion,
        workflowName: execCtx?.workflowName,
        createdAt: execCtx?.createdAt,
        startedAt: execCtx?.startedAt,
        failedAt: new Date().toISOString(),
        recoveryAttempts: execCtx?.recoveryAttempts?.length || 0,
      },
    };
  }

  /**
   * 序列化错误
   */
  _serializeError(error) {
    if (!error) return { code: 'UNKNOWN', message: 'Unknown error' };

    return {
      code: error.code || 'EXECUTION_ERROR',
      message: error.message || String(error),
      details: error.validationErrors || error.dependencyErrors || null,
      stack: error.stack,
    };
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  _generateExecutionId() {
    return `exec_${crypto.randomBytes(8).toString('hex')}`;
  }

  _generateCheckpointId(executionId) {
    return `cp_${crypto.createHash('sha256')
      .update(`${executionId}:${Date.now()}`)
      .digest('hex')
      .slice(0, 16)}`;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _log(level, ...args) {
    const prefix = this._logPrefix;
    if (level === 'error') {
      console.error(prefix, ...args);
    } else if (level === 'warn') {
      console.warn(prefix, ...args);
    } else if (level === 'debug') {
      console.debug(prefix, ...args);
    } else {
      console.log(prefix, ...args);
    }
  }
}

// ---------------------------------------------------------------------------
// SkillRuntimeFactory — 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 SkillRuntime 实例
 *
 * @param {Object} skill - Skill Manifest
 * @param {Object} options - 运行时选项
 * @returns {SkillRuntime}
 */
function createSkillRuntime(skill, options = {}) {
  return new SkillRuntime({
    skill,
    registry: options.registry,
    pluginManager: options.pluginManager,
    workflowRuntime: options.workflowRuntime,
    getToolJob: options.getToolJob,
    capabilityProvisioning: options.capabilityProvisioning,
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // 类
  SkillRuntime,

  // 工厂
  createSkillRuntime,

  // 常量
  EXECUTION_STATES,
  EXECUTION_STATE_VERSION,
};
