const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const { reconcileArtifactTruth } = require('./artifact-truth');
const {
  resolveProjectRunLayout,
  safeJoinUnder,
} = require('../../shared-backend/project-run-layout');

const STEP_TASK_TYPES = {
  'scrna-standard': 'scrna_standard',
  recluster: 'recluster',
  deg: 'deg',
  enrichment: 'enrichment',
  annotation: 'cell_annotation',
  integration: 'scrna_integration',
  trajectory: 'trajectory',
  communication: 'communication',
  'cell-cycle': 'cell_cycle',
  doublet: 'doublet',
};

function taskTypeForStep(toolId) {
  return STEP_TASK_TYPES[toolId] || null;
}

function stepToolJobId(task) {
  return task?.params?.__harness?.toolJobId || null;
}

function publicStepParams(params = {}) {
  const next = { ...params };
  delete next.__harness;
  return next;
}

function buildStepTaskRequest({ toolId, args = {}, toolJobId, userId, projectId }) {
  const type = taskTypeForStep(toolId);
  if (!type) throw new Error(`unsupported_step_tool: ${toolId}`);
  const ossInputUrl = args.ossInputUrl || args.inputUrl || args.input_url || null;
  const parentTaskId = args.parentTaskId || args.parent_task_id || null;
  if (!ossInputUrl) throw new Error('missing_oss_input_url');
  const params = { ...args };
  for (const key of [
    'ossInputUrl',
    'inputUrl',
    'input_url',
    'parentTaskId',
    'parent_task_id',
  ]) {
    delete params[key];
  }
  params.__harness = {
    version: 1,
    toolId,
    toolJobId,
    userId,
    projectId,
  };
  return { type, params, ossInputUrl, parentTaskId };
}

function prepareStepToolJob({ toolId, args, userId, projectId, existingToolJobId }) {
  const publicParams = publicStepParams(args);
  const job = existingToolJobId
    ? db.prepareToolJobForRun(existingToolJobId, {
        params: publicParams,
        name: `${toolId} via agent`,
      })
    : db.createToolJob({
        toolId,
        userId,
        projectId,
        params: publicParams,
        status: 'queued',
        name: `${toolId} via agent`,
      });
  return job;
}

function persistentResultDir(taskId) {
  if (config.storageMode !== 'local') return null;
  const root =
    config.localResultsDir ||
    path.join(require('os').homedir(), 'Documents', 'BioF3-Local', 'results');
  return path.join(root, 'results', `task-${taskId}`);
}

function harnessOf(task) {
  return (task && task.params && task.params.__harness) || {};
}

/**
 * Phase 5b（单细胞 step 引擎收敛）：把 step 任务在 ephemeral workDir 里产出的已声明
 * artifacts 物化到项目沙盒 <workspace>/results/jobs/<toolJobId>/output/，让 harness/
 * tool_job 的 artifact truth 落在与 R/Python/MCP 工具完全一致的运行目录契约内，
 * 并通过同一 /api/tools/file/<toolJobId>/<name> 身份提供。
 *
 * - 仅在 harness 上下文携带 projectId + toolJobId 时物化（项目作用域运行）。
 * - 物化的是"已声明产物"（plots + files + summary.json），不搬运中间态大文件。
 * - 沿用 Phase 5「远端执行完成后物化到本地项目 output/」的模式：workDir 是临时执行区
 *   （相当于 ephemeral executor），沙盒是唯一的持久结果家；不是"复制冒充收敛"。
 * - 失败不致命：返回 null，调用方回退旧的 persistentResultDir 行为。
 *
 * @returns {{ outputDir: string, jobRoot: string, copied: string[] } | null}
 */
function materializeStepArtifactsToProject({ task, results }) {
  const { projectId, toolJobId } = harnessOf(task);
  if (!projectId || !toolJobId) return null;
  const workDir = task && task.workDir;
  if (!workDir || !fs.existsSync(workDir)) return null;

  let layout;
  try {
    layout = resolveProjectRunLayout({
      projectId,
      toolJobId,
      db,
      skipPermissionCheck: true,
      ensureDirs: true,
    });
  } catch (error) {
    console.warn('[step-tool-job] project layout resolution failed for materialize:', error.message);
    return null;
  }

  const outputDir = layout.outputDir;
  const declared = [
    ...((results && results.plots) || []),
    ...((results && results.files) || []),
  ]
    .map((item) => item && (item.filename || item.name))
    .filter(Boolean)
    .map((name) => path.basename(String(name)));
  // summary.json 也是产物的一部分（报告/汇总）
  const names = new Set([...declared, 'summary.json']);

  const copied = [];
  for (const name of names) {
    const src = path.join(workDir, name);
    const dest = safeJoinUnder(outputDir, name);
    if (dest && fs.existsSync(src) && fs.statSync(src).isFile()) {
      try {
        fs.copyFileSync(src, dest);
        copied.push(name);
      } catch (error) {
        console.warn(`[step-tool-job] materialize copy failed for ${name}:`, error.message);
      }
    }
  }
  return { outputDir, jobRoot: layout.jobRoot, copied };
}

function canonicalizeFromExecution(execution, value) {
  if (!value) return null;
  const localRoot = execution?.workDir;
  const canonicalRoot = execution?.canonicalWorkDir;
  const resolved = path.resolve(value);
  if (!localRoot || !canonicalRoot) return resolved.replace(/\\/g, '/');
  const relative = path.relative(path.resolve(localRoot), resolved);
  return relative && !relative.startsWith('..')
    ? path.posix.join(canonicalRoot, relative.split(path.sep).join('/'))
    : resolved.replace(/\\/g, '/');
}

function declaredArtifacts(results = []) {
  return results
    .filter(Boolean)
    .map((item, index) => ({
      id: item.id || `artifact_${index + 1}`,
      name: item.filename || item.name,
      filename: item.filename || item.name,
      type: item.type || (/\.png$/i.test(item.filename || item.name || '') ? 'plot' : 'file'),
      label: item.label || item.name || item.filename,
      url: item.url || null,
      required: false,
    }))
    .filter((item) => item.name);
}

function queuedStepResult({ toolId, taskId, execution }) {
  return {
    harnessStepExecutionVersion: 1,
    toolId,
    taskId,
    taskStatus: 'queued',
    execution,
    artifactSchemaVersion: 1,
    artifacts: [],
  };
}

function markStepToolQueued({ toolJobId, toolId, taskId, execution }) {
  return db.updateToolJob(toolJobId, {
    status: 'queued',
    resultJson: queuedStepResult({ toolId, taskId, execution }),
  });
}

function syncStepToolRunning(task, execution) {
  const toolJobId = stepToolJobId(task);
  if (!toolJobId) return null;
  const previous = db.getToolJob(toolJobId);
  const result = {
    ...(previous?.result || {}),
    harnessStepExecutionVersion: 1,
    taskId: task.taskId,
    taskStatus: 'running',
    execution,
  };
  return db.updateToolJob(toolJobId, { status: 'running', resultJson: result });
}

function syncStepToolCompleted(task, results, execution) {
  const toolJobId = stepToolJobId(task);
  if (!toolJobId) return null;
  // Phase 5b: 项目作用域的 step 运行，把产物物化进项目沙盒并把 resultDir 指向沙盒 output/。
  // 非项目运行（无 projectId）回退旧的 persistentResultDir 行为，不改变既有语义。
  let resultDir = null;
  try {
    const materialized = materializeStepArtifactsToProject({ task, results });
    if (materialized) resultDir = materialized.outputDir;
  } catch (error) {
    console.warn('[step-tool-job] materialize step artifacts failed:', error.message);
  }
  if (!resultDir) resultDir = persistentResultDir(task.taskId);
  const artifacts = declaredArtifacts([...(results?.plots || []), ...(results?.files || [])]);
  let result = {
    ...results,
    harnessStepExecutionVersion: 1,
    toolId: task.params.__harness.toolId,
    taskId: task.taskId,
    taskStatus: 'completed',
    resultDir,
    canonicalResultDir: canonicalizeFromExecution(execution, resultDir),
    execution,
    artifactSchemaVersion: 1,
    artifacts,
    outputs: artifacts,
    files: artifacts,
  };
  if (resultDir && fs.existsSync(resultDir)) {
    result = reconcileArtifactTruth({
      result,
      resultDir,
      canonicalizePath: (value) => canonicalizeFromExecution(execution, value),
    }).result;
  }
  return db.updateToolJob(toolJobId, {
    status: 'completed',
    resultJson: result,
    completedAt: Date.now(),
  });
}

function syncStepToolFailed(task, error, execution) {
  const toolJobId = stepToolJobId(task);
  if (!toolJobId) return null;
  return db.updateToolJob(toolJobId, {
    status: 'failed',
    error: String(error || 'step task failed'),
    resultJson: {
      harnessStepExecutionVersion: 1,
      toolId: task.params.__harness.toolId,
      taskId: task.taskId,
      taskStatus: 'failed',
      execution,
    },
    completedAt: Date.now(),
  });
}

module.exports = {
  STEP_TASK_TYPES,
  taskTypeForStep,
  publicStepParams,
  buildStepTaskRequest,
  prepareStepToolJob,
  queuedStepResult,
  markStepToolQueued,
  syncStepToolRunning,
  syncStepToolCompleted,
  syncStepToolFailed,
  materializeStepArtifactsToProject,
};
