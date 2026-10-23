'use strict';

/**
 * routes/ai-agent/team.js — BLOCK-249（Q4a）多智能体团队控制面。
 *
 *   GET  /api/ai/agent/team?taskId=<leaderTaskId>   — leader + members 投影（只读）
 *   POST /api/ai/agent/team/:taskId/stop            — 级联停止 + 逐成员回执（部分成功如实）
 *   POST /api/ai/agent/task/:taskId/pause           — 迭代边界暂停（进行中的工具不冻结）
 *   POST /api/ai/agent/task/:taskId/resume          — 恢复
 *
 * 鉴权：任务 user_id 归属；跨用户 403。暂停登记是进程内内存（重启即丢，不伪造跨重启暂停）。
 */

const agentTaskStore = require('../../agent-task-store');
const dbMod = require('../../db');
const agentPause = require('../../helpers/agent-pause');
const { buildTeamView, stopTeam } = require('../../helpers/agent-team');

function userIdOf(req) {
  return req.user && req.user.id ? String(req.user.id) : '';
}

function taskFor(req, taskId) {
  const task = agentTaskStore.getAgentTask(String(taskId || ''));
  if (!task) return { ok: false, status: 404, error: 'task_not_found' };
  const userId = userIdOf(req);
  if (!userId) return { ok: false, status: 401, error: 'unauthorized' };
  if (task.userId && String(task.userId) !== userId) return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true, task, userId };
}

module.exports = {
  register(app) {
    app.get('/api/ai/agent/team', async (req, res) => {
      const taskId = String(req.query.taskId || '').trim();
      if (!taskId) return res.status(400).json({ ok: false, error: 'task_id_required' });
      const found = taskFor(req, taskId);
      if (!found.ok) return res.status(found.status).json({ ok: false, error: found.error });
      const view = buildTeamView({ store: agentTaskStore, leaderTaskId: taskId, userId: found.userId });
      if (!view.ok) return res.status(view.status || 400).json({ ok: false, error: view.error });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(view);
    });

    app.post('/api/ai/agent/team/:taskId/stop', async (req, res) => {
      const taskId = String(req.params.taskId || '').trim();
      const found = taskFor(req, taskId);
      if (!found.ok) return res.status(found.status).json({ ok: false, error: found.error });
      const result = stopTeam({ store: agentTaskStore, dbMod, leaderTaskId: taskId, userId: found.userId });
      if (!result.ok) return res.status(result.status || 500).json(result);
      return res.json(result);
    });

    app.post('/api/ai/agent/task/:taskId/pause', async (req, res) => {
      const taskId = String(req.params.taskId || '').trim();
      const found = taskFor(req, taskId);
      if (!found.ok) return res.status(found.status).json({ ok: false, error: found.error });
      if (found.task.status !== 'running') {
        return res.status(409).json({ ok: false, error: 'not_running', status: found.task.status });
      }
      if (found.task.agentStatus === 'paused') {
        return res.json({ ok: true, agentStatus: 'paused', effective: 'iteration_boundary' });
      }
      agentPause.requestPause(taskId);
      const stored = agentTaskStore.setAgentTaskPaused(taskId, true);
      if (!stored.ok) {
        agentPause.resumeTask(taskId);
        return res.status(409).json({ ok: false, error: stored.error });
      }
      agentTaskStore.appendSyntheticAgentEvent(taskId, 'agent_paused', { effective: 'iteration_boundary' });
      return res.json({ ok: true, agentStatus: 'paused', effective: 'iteration_boundary' });
    });

    app.post('/api/ai/agent/task/:taskId/resume', async (req, res) => {
      const taskId = String(req.params.taskId || '').trim();
      const found = taskFor(req, taskId);
      if (!found.ok) return res.status(found.status).json({ ok: false, error: found.error });
      if (found.task.agentStatus !== 'paused') {
        return res.status(409).json({ ok: false, error: 'not_paused', agentStatus: found.task.agentStatus });
      }
      agentPause.resumeTask(taskId);
      const stored = agentTaskStore.setAgentTaskPaused(taskId, false);
      if (!stored.ok) return res.status(409).json({ ok: false, error: stored.error });
      agentTaskStore.appendSyntheticAgentEvent(taskId, 'agent_resumed', {});
      return res.json({ ok: true, agentStatus: 'running' });
    });
  },
};
