/**
 * core/gateway/pipeline.js — Pipeline 执行引擎
 *
 * 职责：
 * - 顺序执行多步骤工作流（R → Python → R 等）
 * - 中间结果传递（一个步骤的输出作为下一个步骤的输入）
 * - 错误处理与事务回滚
 * - 超时保护与内存限制
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Gateway 配置
const config = {
  rServerUrl: process.env.R_SERVER_URL || 'http://127.0.0.1:3003',
  pyServerUrl: process.env.PY_SERVER_URL || 'http://127.0.0.1:3004',
  // 超时配置
  stepTimeout: parseInt(process.env.PIPELINE_STEP_TIMEOUT || '300000', 10), // 5min per step
  globalTimeout: parseInt(process.env.PIPELINE_GLOBAL_TIMEOUT || '1800000', 10), // 30min total
  // 内存限制：文件路径超过此大小（字节）时，使用临时文件而非内存传递
  maxInlineDataSize: parseInt(process.env.PIPELINE_MAX_INLINE || '10485760', 10), // 10MB
  // 临时目录
  tempDir: process.env.PIPELINE_TEMP_DIR || path.join(os.tmpdir(), 'biof3-pipeline'),
};

// 运行时目录
if (!fs.existsSync(config.tempDir)) {
  fs.mkdirSync(config.tempDir, { recursive: true });
}

// ============================================================
// Pipeline 运行状态存储
// ============================================================

const _pipelines = new Map();

/**
 * 生成 Pipeline ID
 */
function generatePipelineId() {
  return `pl-${crypto.randomBytes(8).toString('hex')}`;
}

// ============================================================
// Pipeline 执行器
// ============================================================

/**
 * 执行 Pipeline
 * @param {Object} request - Pipeline 请求
 * @param {Array} request.steps - 步骤列表
 * @param {boolean} request.continueOnError - 遇到错误是否继续
 * @returns {Promise<Object>} 执行结果
 */
async function executePipeline(request) {
  const { steps = [], continueOnError = false } = request;

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new PipelineError(400, 'Pipeline must contain at least one step');
  }

  const pipelineId = generatePipelineId();
  const startTime = Date.now();

  // 创建 Pipeline 状态
  const pipeline = {
    id: pipelineId,
    status: 'running',
    steps: steps.map((step, index) => ({
      index,
      toolId: step.toolId,
      language: step.language || 'r',
      params: step.params || {},
      status: 'pending',
      startTime: null,
      endTime: null,
      result: null,
      error: null,
    })),
    continueOnError,
    startTime,
    endTime: null,
    totalDuration: null,
    error: null,
  };

  _pipelines.set(pipelineId, pipeline);

  // 全局超时控制
  const globalTimer = setTimeout(() => {
    const pl = _pipelines.get(pipelineId);
    if (pl && pl.status === 'running') {
      pl.status = 'timeout';
      pl.error = 'Global timeout exceeded';
      pl.endTime = Date.now();
      pl.totalDuration = pl.endTime - pl.startTime;
    }
  }, config.globalTimeout);

  try {
    let previousResult = null;

    // 顺序执行每个步骤
    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];
      step.startTime = Date.now();

      // 检查全局超时
      if (pipeline.status === 'timeout') {
        throw new PipelineError(504, 'Pipeline global timeout exceeded');
      }

      // 准备步骤参数：合并前一步的结果
      const stepParams = prepareStepParams(step.params, previousResult, i);

      try {
        // 执行步骤
        const result = await executeStep(step, stepParams);
        step.status = 'completed';
        step.result = result;
        step.endTime = Date.now();

        // 将结果传递给下一步
        previousResult = result;
      } catch (stepError) {
        step.status = 'failed';
        step.error = {
          message: stepError.message,
          code: stepError.code || 'STEP_ERROR',
        };
        step.endTime = Date.now();

        if (!continueOnError) {
          pipeline.status = 'failed';
          pipeline.error = {
            stepIndex: i,
            stepId: step.toolId,
            message: stepError.message,
          };
          break;
        } else {
          console.warn(`[pipeline:${pipelineId}] Step ${i} failed, continuing: ${stepError.message}`);
          // 重置 previousResult，避免错误传播
          previousResult = null;
        }
      }
    }

    // 标记 Pipeline 完成状态
    if (pipeline.status === 'running') {
      pipeline.status = 'completed';
    }

    pipeline.endTime = Date.now();
    pipeline.totalDuration = pipeline.endTime - pipeline.startTime;

    clearTimeout(globalTimer);

    return buildPipelineResponse(pipeline);
  } catch (error) {
    clearTimeout(globalTimer);
    pipeline.status = 'failed';
    pipeline.error = { message: error.message };
    pipeline.endTime = Date.now();
    pipeline.totalDuration = pipeline.endTime - pipeline.startTime;

    throw error;
  }
}

/**
 * 准备步骤参数：将前一步结果合并到当前步骤参数
 */
function prepareStepParams(params, previousResult, stepIndex) {
  const merged = { ...params };

  if (previousResult && stepIndex > 0) {
    // 合并前一步的结果到当前参数
    // 支持多种合并策略
    if (previousResult.outputPath) {
      merged.previous_output_path = previousResult.outputPath;
      // 自动推断合适的输入字段名
      if (previousResult.outputType === 'deg_table') {
        merged.deg_table = previousResult.outputPath;
      } else if (previousResult.outputType === 'data_matrix') {
        merged.data_matrix = previousResult.outputPath;
      } else if (previousResult.outputType === 'gene_list') {
        merged.gene_list = previousResult.outputPath;
      }
    }

    // 传递关键元数据
    if (previousResult.metadata) {
      merged.previous_metadata = previousResult.metadata;
    }

    // 传递文件引用（避免大对象在内存中传递）
    if (previousResult.files) {
      merged.previous_files = previousResult.files;
    }
  }

  return merged;
}

/**
 * 执行单个步骤
 */
async function executeStep(step, params) {
  const { toolId, language } = step;

  // 确定目标服务器
  const targetUrl = language === 'python' ? config.pyServerUrl : config.rServerUrl;

  // 构建执行请求
  const requestBody = {
    toolId,
    params,
  };

  // 创建超时控制器
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.stepTimeout);

  try {
    const response = await fetch(`${targetUrl}/api/tools/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new PipelineStepError(step.index, toolId, response.status, errorData.error || errorData.message);
    }

    const result = await response.json();

    // 验证结果格式
    if (result.status === 'error') {
      throw new PipelineStepError(step.index, toolId, response.status, result.error);
    }

    return result;
  } catch (error) {
    clearTimeout(timeout);

    if (error.name === 'AbortError') {
      throw new PipelineStepError(step.index, toolId, 504, `Step timeout after ${config.stepTimeout}ms`);
    }

    throw new PipelineStepError(step.index, toolId, 0, error.message);
  }
}

/**
 * 构建 Pipeline 响应格式
 */
function buildPipelineResponse(pipeline) {
  return {
    pipelineId: pipeline.id,
    status: pipeline.status,
    steps: pipeline.steps.map((step) => ({
      index: step.index,
      toolId: step.toolId,
      language: step.language,
      status: step.status,
      duration: step.endTime && step.startTime ? step.endTime - step.startTime : null,
      result: step.result,
      error: step.error,
    })),
    continueOnError: pipeline.continueOnError,
    timing: {
      start: pipeline.startTime,
      end: pipeline.endTime,
      totalDuration: pipeline.totalDuration,
    },
    error: pipeline.error,
  };
}

/**
 * 获取 Pipeline 状态
 */
function getPipelineStatus(pipelineId) {
  const pipeline = _pipelines.get(pipelineId);
  if (!pipeline) {
    return null;
  }
  return buildPipelineResponse(pipeline);
}

/**
 * 列出所有 Pipeline
 */
function listPipelines() {
  return Array.from(_pipelines.values()).map((p) => ({
    id: p.id,
    status: p.status,
    stepCount: p.steps.length,
    startTime: p.startTime,
    endTime: p.endTime,
    totalDuration: p.totalDuration,
  }));
}

/**
 * 清理已完成的 Pipeline（保留最近 N 个）
 */
function cleanupPipelines(maxRetain = 100) {
  const completed = [];
  for (const [id, p] of _pipelines.entries()) {
    if (p.status === 'completed' || p.status === 'failed') {
      completed.push({ id, endTime: p.endTime || 0 });
    }
  }

  // 按结束时间排序，保留最新的
  completed.sort((a, b) => b.endTime - a.endTime);

  const toDelete = completed.slice(maxRetain);
  for (const { id } of toDelete) {
    _pipelines.delete(id);
  }

  return { cleaned: toDelete.length, remaining: _pipelines.size };
}

// ============================================================
// 错误类
// ============================================================

class PipelineError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'PipelineError';
    this.statusCode = statusCode;
  }
}

class PipelineStepError extends Error {
  constructor(stepIndex, toolId, statusCode, message) {
    super(message);
    this.name = 'PipelineStepError';
    this.stepIndex = stepIndex;
    this.toolId = toolId;
    this.statusCode = statusCode;
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  executePipeline,
  getPipelineStatus,
  listPipelines,
  cleanupPipelines,
  PipelineError,
  PipelineStepError,
  config,
};
