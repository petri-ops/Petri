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

function loadRunForRequest(req, res, runId) {
  const meta = workflowJournal.readRunMeta(workflowsRoot(), runId);
  if (!meta.ok) {
    res.status(404).json({ ok: false, error: 'run_not_found' });
    return null;
  }
  const userId = userIdOf(req);
  if (!userId) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return null;
  }
  if (meta.meta.userId && String(meta.meta.userId) !== userId) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return null;
  }
  return meta.meta;
}

module.exports = {
  register(app, { deps } = {}) {
    app.post('/api/ai/agent/workflow/run', async (req, res) => {
      if (!workflowEnabled()) return res.status(503).json({ ok: false, error: 'workflow_disabled' });
      const userId = userIdOf(req);
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized' });

      const { script, args, dryRun, resumeFromRunId } = req.body || {};
      if (typeof script !== 'string' || script.length === 0) {
        return res.status(400).json({ ok: false, error: 'script_required' });
      }
      if (script.length > 256 * 1024) {
        return res.status(400).json({ ok: false, error: 'script_too_large' });
      }

      const loaded = loadWorkflowModule(script, { host: {}, seed: 0 });
      if (!loaded.ok) {
        return res.status(400).json({
          ok: false,
          error: loaded.error,
          diagnostics: loaded.diagnostics,
          message: loaded.message,
        });
      }

      if (dryRun) {
        return res.status(200).json({
          ok: true,
          dryRun: true,
          meta: loaded.meta,
          estimate: dryRunEstimate(script, loaded.meta),
        });
      }

      // 真跑：默认走伞 task + 真实 deps；注入 deps（测试形态）时跳过伞 task
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
        return res.status(400).json({ ok: false, error: run._loadError.error, message: run._loadError.message });
      }

      activeRuns.set(run.runId, { run, userId });

      // 后台收尾：伞 task 终态 + 活跃表清理（best-effort）
      run.promise
        .then((result) => {
          if (umbrellaTaskId) {
            const agentTaskStore = require('../../agent-task-store');
            try {
              if (result.status === 'completed') agentTaskStore.markAgentTaskDone(umbrellaTaskId);
              else if (result.status === 'cancelled') agentTaskStore.markAgentTaskCancelled(umbrellaTaskId);
              else agentTaskStore.markAgentTaskFailed(umbrellaTaskId, result.error || 'workflow failed');
            } catch {}
          }
        })
        .finally(() => activeRuns.delete(run.runId));

      return res.status(202).json({
        ok: true,
        runId: run.runId,
        taskId: umbrellaTaskId,
        status: 'running',
        resumeFromRunId: resumeFromRunId || null,
      });
    });

    app.get('/api/ai/agent/workflow/runs', (req, res) => {
      if (!workflowEnabled()) return res.status(503).json({ ok: false, error: 'workflow_disabled' });
      const userId = userIdOf(req);
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 50));
      const root = workflowsRoot();
      const runs = [];
      for (const runId of workflowJournal.listRunIds(root, { limit })) {
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
      return res.status(200).json({ ok: true, runs });
    });

    app.get('/api/ai/agent/workflow/runs/:id', (req, res) => {
      if (!workflowEnabled()) return res.status(503).json({ ok: false, error: 'workflow_disabled' });
      const meta = loadRunForRequest(req, res, req.params.id);
      if (!meta) return;
      const tail = workflowJournal.readJournalLines(workflowsRoot(), meta.runId, {
        limit: workflowJournal.MAX_JOURNAL_TAIL,
      });
      return res.status(200).json({
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
      });
    });

    app.post('/api/ai/agent/workflow/runs/:id/cancel', async (req, res) => {
      if (!workflowEnabled()) return res.status(503).json({ ok: false, error: 'workflow_disabled' });
      const runId = String(req.params.id || '');
      const meta = loadRunForRequest(req, res, runId);
      if (!meta) return;

      const active = activeRuns.get(runId);
      if (active) {
        await active.run.cancel();
        return res.status(200).json({ ok: true, cancelled: true, mode: 'in_process' });
      }
      // 进程重启后 runner 不在内存：按持久状态兜底——对伞 task 级联取消
      if (meta.taskId) {
        try {
          const agentTaskStore = require('../../agent-task-store');
          const dbMod = require('../../db');
          agentTaskStore.cancelAgentTaskCascade(String(meta.taskId), { dbMod });
          return res.status(200).json({ ok: true, cancelled: true, mode: 'cascade_via_umbrella_task' });
        } catch {}
      }
      return res.status(409).json({
        ok: false,
        error: 'run_not_active',
        status: meta.status,
        message: '该运行不在本进程且无伞任务可级联（可能已完成或经测试注入启动）',
      });
    });
  },

  // 测试/子域 surface
  _internals: { activeRuns, buildRealDeps, dryRunEstimate, workflowsRoot },
};
