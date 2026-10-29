'use strict';

/**
 * routes/ai-agent/workflow.js — BLOCK-262（Q4b）工作流脚本 REST 面。
 *
 *   POST /api/ai/agent/workflow/run            — dryRun 预估 或 启动真跑（opt-in）
 *   GET  /api/ai/agent/workflow/runs           — 有界列表（≤50，按目录序倒排）
 *   GET  /api/ai/agent/workflow/runs/:id       — run.json + journal 尾部 ≤100 行
 *   POST /api/ai/agent/workflow/runs/:id/cancel— 不再启动新步骤 + 级联取消子任务
 *
 * opt-in：PETRI_WORKFLOW_ENABLED !== '1' 时全部端点 503 workflow_disabled
 * （与 Q2b web-search 默认关同构；调用时读 env，不固化模块常量——dev-verify 教训）。
 *
 * 真实接线：伞 task（kind=workflow，复用 agentTaskStore 零新表）作 parentTaskId，
 * agent() 唯一路径=spawn-agent-tools.launchSubAgent（不建第二执行器）。
 * 测试注入：register(app, { deps }) 覆盖真实 deps（此时跳过伞 task）。
 */

const dataPaths = require('../../../shared-backend/data-paths');
const runnerMod = require('../../helpers/workflow-runner');
const workflowJournal = require('../../helpers/workflow-journal');
const { loadWorkflowModule } = require('../../helpers/workflow-sandbox');

// 进程内活跃 run 注册表（重启即丢；持久状态在 <dataDir>/workflows/<runId>/）
const activeRuns = new Map();

function workflowEnabled() {
  return process.env.PETRI_WORKFLOW_ENABLED === '1';
}

function workflowsRoot() {
  return dataPaths.dataFile('workflows');
}

function userIdOf(req) {
  return req.user && req.user.id ? String(req.user.id) : '';
}

/** 真实 deps：launchSubAgent 唯一执行路径 + 轮询终态 + 级联取消。 */
function buildRealDeps({ parentTaskId, userId }) {
  const spawnTools = require('../../agent-tools/spawn-agent-tools');
  const agentTaskStore = require('../../agent-task-store');
  const dbMod = require('../../db');
  const { authorizeProject } = require('../../agent-tools/workspace-tools/internals');
  const { runModel3DRecipe } = require('../../helpers/model3d-recipe-runner');
  // 终态双写形态：markAgentTaskDone 落 status='completed'/agent_status='done'
  // （实测 DB 列序），failed/cancelled 同列同名——四个都收，避免漏识别。
  const TERMINAL = new Set(['done', 'completed', 'failed', 'cancelled']);
  return {
    launchSubAgent: ({ userContent, role, goals }) =>
      spawnTools.launchSubAgent({
        parentTaskId,
        userId,
        parentParams: {},
        parentContext: {},
        // model 缺省={}：accessModeHint 不注入、preset 走默认 provider 回落
        // （与 spawn_agent 未显式选模时的 resolveSpawnModelSettings 语义一致）
        model: {},
        userContent,
        role: role || null,
        goals: goals || [],
        spawnSource: 'workflow',
      }),
    waitAgentTerminal: async (agentId) => {
      for (;;) {
        const task = agentTaskStore.getAgentTask(String(agentId));
        if (task && TERMINAL.has(String(task.status || '').toLowerCase())) {
          let summary = '';
          try {
            const raw = task.result_json ? JSON.parse(task.result_json) : task.result || null;
            summary = String((raw && (raw.finalText || raw.summary)) || '').slice(0, 1000);
          } catch {
            /* result 解析失败不影响终态 */
          }
          const s = String(task.status || '').toLowerCase();
          return { status: s === 'done' ? 'completed' : s, summary };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    },
    requestCancellation: (agentId) => {
      try {
        return agentTaskStore.cancelAgentTaskCascade(String(agentId), { dbMod });
      } catch {
        return null;
      }
    },
    // NEXT-05 — recipe 领域原语：dryRun 纯生成；执行时授权项目后复用同一 runner。
    recipe: async ({ recipeId, params, projectId, dryRun = true, path: relativePath, render, views, formats, signal } = {}) => {
      if (dryRun) return runModel3DRecipe({ recipeId, params, dryRun: true });
      if (signal?.aborted) return { ok: false, error: 'recipe_cancelled' };
      const project = projectId ? dbMod.getProject(String(projectId)) : null;
      if (!project || !project.workspace_path) return { ok: false, error: 'project_required' };
      try {
        authorizeProject(project, userId, dbMod);
      } catch (error) {
        return { ok: false, error: error.code || 'permission_denied', message: error.message };
      }
      if (project.workspace_kind === 'ssh') {
        return { ok: false, error: 'local_project_required', message: 'recipe 渲染在本机执行，仅支持本地项目。' };
      }
      return runModel3DRecipe({
        recipeId,
        params,
        workspaceRoot: project.workspace_path,
        relativePath,
        dryRun: false,
        render,
        views,
        formats,
        signal,
      });
    },
  };
}

/** dryRun 静态预估：meta 声明上界 + 源码 agent( 字面计数（标注 estimate，不承诺精确）。 */
function dryRunEstimate(source, meta) {
  const agentCalls = (String(source).match(/\bagent\s*\(/g) || []).length;
  return {
    estimate: true,
    agentCallsInSource: agentCalls,
    budget: meta.budget,
    concurrency: meta.concurrency,
    note: '静态上界估计；实际启动数以 budget 帽为准',
  };
}

function readOwnedRunMeta(userId, runId) {
  const meta = workflowJournal.readRunMeta(workflowsRoot(), runId);
  if (!meta.ok) return { ok: false, statusCode: 404, body: { ok: false, error: 'run_not_found' } };
  if (!userId) return { ok: false, statusCode: 401, body: { ok: false, error: 'unauthorized' } };
  if (meta.meta.userId && String(meta.meta.userId) !== userId) {
    return { ok: false, statusCode: 403, body: { ok: false, error: 'forbidden' } };
  }
  return { ok: true, meta: meta.meta };
}

function startWorkflow({ script, args, dryRun = false, resumeFromRunId = null, userId, deps } = {}) {
  if (!workflowEnabled()) return { statusCode: 503, body: { ok: false, error: 'workflow_disabled' } };
  if (!userId) return { statusCode: 401, body: { ok: false, error: 'unauthorized' } };
  if (typeof script !== 'string' || script.length === 0) {
    return { statusCode: 400, body: { ok: false, error: 'script_required' } };
  }
  if (script.length > 256 * 1024) {
    return { statusCode: 400, body: { ok: false, error: 'script_too_large' } };
  }

  const loaded = loadWorkflowModule(script, { host: {}, seed: 0 });
  if (!loaded.ok) {
    return {
      statusCode: 400,
      body: { ok: false, error: loaded.error, diagnostics: loaded.diagnostics, message: loaded.message },
    };
  }
  if (dryRun) {
    return {
      statusCode: 200,
      body: {
        ok: true,
        dryRun: true,
        meta: loaded.meta,
        estimate: dryRunEstimate(script, loaded.meta),
      },
    };
  }

  let parentTaskId = null;
  let effectiveDeps = deps;
  let umbrellaTaskId = null;
  if (!deps) {
    const agentTaskStore = require('../../agent-task-store');
    umbrellaTaskId = agentTaskStore
      .createAgentTask({
        status: 'running',
        agentStatus: 'running',
        userId,
        params: { kind: 'workflow', spawnSource: 'workflow-route' },
      })
      .taskId;
    parentTaskId = umbrellaTaskId;
    effectiveDeps = buildRealDeps({ parentTaskId, userId });
  }

  const run = runnerMod.startWorkflowRun({
    source: script,
    args,
    userId,
    deps: effectiveDeps,
    root: workflowsRoot(),
    resumeFromRunId: resumeFromRunId || null,
    extraRunMeta: umbrellaTaskId ? { taskId: umbrellaTaskId } : null,
  });
  if (run._loadError) {
    return { statusCode: 400, body: { ok: false, error: run._loadError.error, message: run._loadError.message } };
  }

  activeRuns.set(run.runId, { run, userId });
  run.promise
    .then((result) => {
      if (umbrellaTaskId) {
        const agentTaskStore = require('../../agent-task-store');
        try {
          if (result.status === 'completed') agentTaskStore.markAgentTaskDone(umbrellaTaskId);
          else if (result.status === 'cancelled') agentTaskStore.markAgentTaskCancelled(umbrellaTaskId);
          else agentTaskStore.markAgentTaskFailed(umbrellaTaskId, result.error || 'workflow failed');
        } catch { /* umbrella is diagnostic projection, not execution truth */ }
      }
    })
    .finally(() => activeRuns.delete(run.runId));

  return {
    statusCode: 202,
    body: {
      ok: true,
      runId: run.runId,
      taskId: umbrellaTaskId,
      status: 'running',
      resumeFromRunId: resumeFromRunId || null,
    },
    run,
  };
}

function listWorkflowRuns({ userId, limit = 20 } = {}) {
  if (!workflowEnabled()) return { statusCode: 503, body: { ok: false, error: 'workflow_disabled' } };
  if (!userId) return { statusCode: 401, body: { ok: false, error: 'unauthorized' } };
  const bounded = Math.max(1, Math.min(Number(limit) || 20, 50));
  const root = workflowsRoot();
  const runs = [];
  for (const runId of workflowJournal.listRunIds(root, { limit: bounded })) {
    const meta = workflowJournal.readRunMeta(root, runId);
    if (!meta.ok) continue;
    if (meta.meta.userId && String(meta.meta.userId) !== userId) continue;
    runs.push({
      runId,
      status: meta.meta.status,
      name: meta.meta.meta && meta.meta.meta.name,
      createdAt: meta.meta.createdAt,
      finishedAt: meta.meta.finishedAt || null,
    });
  }
  return { statusCode: 200, body: { ok: true, runs } };
}

function getWorkflowRun({ userId, runId } = {}) {
  if (!workflowEnabled()) return { statusCode: 503, body: { ok: false, error: 'workflow_disabled' } };
  const owned = readOwnedRunMeta(userId, runId);
  if (!owned.ok) return owned;
  const meta = owned.meta;
  const tail = workflowJournal.readJournalLines(workflowsRoot(), meta.runId, {
    limit: workflowJournal.MAX_JOURNAL_TAIL,
  });
  return {
    statusCode: 200,
    body: {
      ok: true,
      run: {
        runId: meta.runId,
        status: meta.status,
        meta: meta.meta,
        scriptHash: meta.scriptHash,
        argsHash: meta.argsHash,
        resumeFromRunId: meta.resumeFromRunId || null,
        error: meta.error || null,
        createdAt: meta.createdAt,
        finishedAt: meta.finishedAt || null,
      },
      journalTail: tail,
    },
  };
}

async function cancelWorkflowRun({ userId, runId } = {}) {
  if (!workflowEnabled()) return { statusCode: 503, body: { ok: false, error: 'workflow_disabled' } };
  const owned = readOwnedRunMeta(userId, runId);
  if (!owned.ok) return owned;
  const meta = owned.meta;
  const active = activeRuns.get(meta.runId);
  if (active) {
    await active.run.cancel();
    return { statusCode: 200, body: { ok: true, cancelled: true, mode: 'in_process' } };
  }
  if (meta.taskId) {
    try {
      const agentTaskStore = require('../../agent-task-store');
      const dbMod = require('../../db');
      agentTaskStore.cancelAgentTaskCascade(String(meta.taskId), { dbMod });
      return { statusCode: 200, body: { ok: true, cancelled: true, mode: 'cascade_via_umbrella_task' } };
    } catch { /* fall through to explicit not-active */ }
  }
  return {
    statusCode: 409,
    body: {
      ok: false,
      error: 'run_not_active',
      status: meta.status,
      message: '该运行不在本进程且无伞任务可级联（可能已完成或经测试注入启动）',
    },
  };
}

function resumeWorkflowRun({ userId, runId, deps } = {}) {
  if (!workflowEnabled()) return { statusCode: 503, body: { ok: false, error: 'workflow_disabled' } };
  const owned = readOwnedRunMeta(userId, runId);
  if (!owned.ok) return owned;
  const meta = owned.meta;
  if (!meta.scriptSource) return { statusCode: 409, body: { ok: false, error: 'run_script_unavailable' } };
  if (meta.status === 'running') return { statusCode: 409, body: { ok: false, error: 'run_still_running' } };
  return startWorkflow({
    script: meta.scriptSource,
    args: meta.args,
    dryRun: false,
    resumeFromRunId: meta.runId,
    userId,
    deps,
  });
}

function register(app, { deps } = {}) {
  const send = (res, result) => res.status(result.statusCode).json(result.body);

  app.post('/api/ai/agent/workflow/run', async (req, res) => {
    const { script, args, dryRun, resumeFromRunId } = req.body || {};
    send(res, startWorkflow({
      script,
      args,
      dryRun: Boolean(dryRun),
      resumeFromRunId,
      userId: userIdOf(req),
      deps,
    }));
  });

  app.get('/api/ai/agent/workflow/runs', (req, res) => {
    send(res, listWorkflowRuns({ userId: userIdOf(req), limit: req.query.limit }));
  });

  app.get('/api/ai/agent/workflow/runs/:id', (req, res) => {
    send(res, getWorkflowRun({ userId: userIdOf(req), runId: req.params.id }));
  });

  app.post('/api/ai/agent/workflow/runs/:id/cancel', async (req, res) => {
    send(res, await cancelWorkflowRun({ userId: userIdOf(req), runId: req.params.id }));
  });

  app.post('/api/ai/agent/workflow/runs/:id/resume', (req, res) => {
    send(res, resumeWorkflowRun({ userId: userIdOf(req), runId: req.params.id, deps }));
  });
}

module.exports = {
  register,
  startWorkflow,
  _internals: { activeRuns, buildRealDeps, dryRunEstimate, workflowsRoot },
};
