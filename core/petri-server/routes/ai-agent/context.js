'use strict';

/**
 * routes/ai-agent/context.js — context 子域（PHASE 2.2b）
 *
 * 下沉的端点（来自 routes/ai-agent.js 第 1099-1124 行）：
 *   POST /api/ai/agent/task/:taskId/cancel
 *
 * 共享依赖走本文件顶部 require（与原 routes/ai-agent.js 一致）。
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
 */

const agentTaskStore = require('../../agent-task-store');
const dbMod = require('../../db');
// BLOCK-171 CP-1 — Stop 级联取消在途可取消工具（注册表协作 abort；无在途=零操作）
const { getToolCancellation } = require('../../helpers/tool-cancel-registry');

module.exports = {
  register(app) {
    app.post('/api/ai/agent/task/:taskId/cancel', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ status: 'error', error: '未登录' });
      }
      const { taskId } = req.params;
      let task;
      try {
        task = agentTaskStore.getAgentTask(taskId);
      } catch {
        return res.status(500).json({ status: 'error', error: '查询 task 失败' });
      }
      if (!task) return res.status(404).json({ status: 'error', error: 'task 不存在' });
      if (task.user_id && task.user_id !== userId) {
        return res.status(403).json({ status: 'error', error: '无权取消该 task' });
      }
      if (task.agent_status === 'done' || task.agent_status === 'failed' || task.agent_status === 'cancelled') {
        return res.json({ status: task.agent_status, taskId, alreadyTerminal: true });
      }
      // AGENT-CONCURRENCY：取消主 agent 时级联取消其子 agent（按 parent_loop_run_id）。
      // cancelAgentTaskCascade 同时请求取消主 task 本身，并在其为 primary 时级联子 agent。
      agentTaskStore.cancelAgentTaskCascade(taskId, { dbMod });
      // BLOCK-171 CP-1 — Stop 同时中止在途可取消工具（wait_agent/workspace_search 等），
      // 长工具不再拖到轮边界才让出。
      const inFlightCancellation = getToolCancellation(taskId);
      if (inFlightCancellation) inFlightCancellation.cancel({});

      return res.json({ status: 'cancel_requested', taskId });
    });
  },
};
