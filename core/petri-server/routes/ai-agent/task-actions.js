'use strict';

const resilienceMod = require('../../helpers/agent-resilience');

/**
 * routes/ai-agent/task-actions.js — BLOCK-65 P1-a/P2-c 子域
 *
 * agent 专属窗（用户态）交互端点，语义与 agent-tools 单源：
 *   GET  /api/ai/agent/tasks?limit=50      — 用户最近子 agent 任务列表（俯瞰面板）
 *   GET  /api/ai/agent/task/:taskId/meta   — 单任务元信息（窗口标题 task 描述）
 *   POST /api/ai/agent/task/:taskId/message  — 留言（队列语义，spawn-agent-tools.queueUserMessage）
 *   POST /api/ai/agent/task/:taskId/followup — 续派（终态后，spawn-agent-tools.launchUserFollowup）
 *
 * 中断不在此处：复用既有 POST /api/ai/agent/task/:taskId/cancel（context.js，级联语义）。
 */

const agentTaskStore = require('../../agent-task-store');
const conversationHelper = require('../../helpers/conversations');
const { queueUserMessage, launchUserFollowup } = require('../../agent-tools/spawn-agent-tools');
const { getToolCancellation } = require('../../helpers/tool-cancel-registry');
const { ackGuard } = require('../../helpers/guard-ack-store');
const db = require('../../db').getAsyncDatabase();

const STATUS_HTTP = {
  invalid_arguments: 400,
  not_found: 404,
  no_parent: 409,
  parent_gone: 409,
  agent_terminal: 409,
  agent_running: 409,
  queue_failed: 500,
};

function fail(res, code, message, httpOverride) {
  return res.status(httpOverride || STATUS_HTTP[code] || 400).json({ ok: false, error: code, message });
}

module.exports = {
  register(app) {
    // BLOCK-98 M4 — 输入插队：primary 任务运行中用户消息入队（下一轮模型请求注入）。
  // 子 agent 仍走 queueUserMessage 留言语义（followup 注入，原样保留）。
  app.post('/api/ai/agent/task/:taskId/steer', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
    const task = agentTaskStore.getAgentTask(req.params.taskId);
    if (!task) return res.status(404).json({ ok: false, error: 'not_found', message: '任务不存在' });
    if (task.user_id && task.user_id !== userId) return res.status(403).json({ ok: false, error: 'forbidden', message: '无权访问该任务' });
    const text = String((req.body && req.body.message) || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'message 不能为空' });
    const enq = resilienceMod.enqueueUserInput(task.taskId, text);
    if (!enq.ok) return res.status(400).json({ ok: false, ...enq });
    try {
      const events = agentTaskStore.getAgentTaskEventsSince(task.taskId, 0, 1000000);
      const seq = (events.length ? events[events.length - 1].seq : 0) + 1;
      agentTaskStore.appendAgentTaskEvent(
        task.taskId, seq,
        'input_queued',
        { event: 'input_queued', text: text.slice(0, 300), depth: enq.depth, at: new Date().toISOString() }
      );
    } catch { /* SSE 可见性失败不阻塞入队 */ }
    return res.json({ ok: true, queued: true, depth: enq.depth, note: '已排队，将在当前步骤结束后加入' });
  });

  // BLOCK-171 CP-1 — 运行内工具协作取消（cancellable 族）：callId 精确取消；
  // 取消动作写 tool_cancel 事件入 task_events（可审计取消）。
  app.post('/api/ai/agent/task/:taskId/tool-cancel', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
    const task = agentTaskStore.getAgentTask(req.params.taskId);
    if (!task) return res.status(404).json({ ok: false, error: 'not_found', message: '任务不存在' });
    if (task.user_id && task.user_id !== userId) return res.status(403).json({ ok: false, error: 'forbidden', message: '无权取消该任务工具' });
    const callId = req.body && req.body.callId ? String(req.body.callId) : undefined;
    const registry = getToolCancellation(task.taskId || req.params.taskId);
    if (!registry) {
      return res.json({ ok: true, cancelled: [], note: '当前无可取消的在途工具' });
    }
    const result = registry.cancel(callId ? { callId } : {});
    try {
      const events = agentTaskStore.getAgentTaskEventsSince(task.taskId || req.params.taskId, 0, 1000000);
      const seq = (events.length ? events[events.length - 1].seq : 0) + 1;
      agentTaskStore.appendAgentTaskEvent(
        task.taskId || req.params.taskId, seq,
        'tool_cancel',
        { event: 'tool_cancel', callId: callId || null, cancelled: result.cancelled, at: new Date().toISOString() }
      );
    } catch { /* SSE 可见性失败不阻塞取消 */ }
    return res.json({ ok: true, cancelled: result.cancelled });
  });

  // BLOCK-171 CP-2 — 确认通道写侧：require-ack 弹卡的用户裁定落点。
  // ack 写入 task 内确认集（策略读侧即时生效）；guard_ack 事件入 task_events
  // （审批记录可复审=可审计治理的自有形态）。
  app.post('/api/ai/agent/task/:taskId/guard-ack', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
    const task = agentTaskStore.getAgentTask(req.params.taskId);
    if (!task) return res.status(404).json({ ok: false, error: 'not_found', message: '任务不存在' });
    if (task.user_id && task.user_id !== userId) return res.status(403).json({ ok: false, error: 'forbidden', message: '无权确认该任务防护' });
    const guardKey = String((req.body && req.body.guardKey) || '').trim();
    if (!guardKey) return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'guardKey 不能为空' });
    const always = (req.body && req.body.always) === true;
    const result = ackGuard(task.taskId || req.params.taskId, guardKey);
    if (!result.ok) return res.status(400).json({ ok: false, ...result });
    try {
      const events = agentTaskStore.getAgentTaskEventsSince(task.taskId || req.params.taskId, 0, 1000000);
      const seq = (events.length ? events[events.length - 1].seq : 0) + 1;
      agentTaskStore.appendAgentTaskEvent(
        task.taskId || req.params.taskId, seq,
        'guard_ack',
        { event: 'guard_ack', guardKey, always, at: new Date().toISOString() }
      );
    } catch { /* SSE 可见性失败不阻塞确认 */ }
    return res.json({ ok: true, guardKey, always });
  });

  // BLOCK-171 CP-2 — 审批记录复查（guard_ack 事件 × 本人任务，最新 50）。
  app.get('/api/ai/agent/guard-events', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
      const rows = await db.prepare(
        `SELECT e.task_id AS task_id, e.payload AS payload, e.created_at AS created_at
         FROM task_events e JOIN tasks t ON t.id = e.task_id
         WHERE e.event_type = 'guard_ack' AND t.user_id = ?
         ORDER BY e.created_at DESC LIMIT ?`
      ).all(userId, limit);
      const events = rows.map((row) => {
        let payload = {};
        try { payload = JSON.parse(row.payload || '{}'); } catch { /* 损坏留痕按空投影 */ }
        return {
          taskId: row.task_id,
          guardKey: String(payload.guardKey || ''),
          always: payload.always === true,
          at: row.created_at,
        };
      });
      return res.json({ ok: true, events });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'guard_events_failed', message: e && e.message ? e.message : String(e) });
    }
  });

  // 俯瞰面板数据源：该用户最近子 agent 任务（跨会话，只读 tasks 投影）。
    // BLOCK-65 修正：附 projectId（经会话归属解析），供面板按项目隔离。
    // BLOCK-109-CORE-ARCH P1.2 — 在途主任务清单（前端恢复单一后端源；additive）。
    // 取代前端 localStorage petri_agent_task_* 扫描：status='running' 即权威在途。
    app.get('/api/ai/agent/tasks/inflight', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
      try {
        const conversationId = (req.query.conversationId && String(req.query.conversationId)) || null;
        const tasks = agentTaskStore.listInFlightPrimaryTasks(userId, conversationId);
        return res.json({ ok: true, tasks });
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: 'inflight_list_failed',
          message: String((err && err.message) || err),
        });
      }
    });

    app.get('/api/ai/agent/tasks', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
      try {
        const limit = Number(req.query.limit) || 50;
        const conversationId = req.query.conversationId || null;
        let tasks = agentTaskStore.listRecentSubAgentTasks(userId, limit).map((t) => ({
          taskId: t.taskId,
          status: t.status,
          agentStatus: t.agentStatus,
          createdAt: t.createdAt,
          finishedAt: t.finishedAt,
          error: t.error,
          conversationId: (t.params && t.params.conversationId) || null,
          parentTaskId: (t.params && t.params.parentTaskId) || null,
          spawnSource: (t.params && t.params.spawnSource) || null,
          // BLOCK-88 P2（D3）— 访客工程师署名（联邦委托任务「来自工程师 X」数据源）
          federatedFrom: (t.params && t.params.federated && t.params.federated.displayName) || null,
          taskText: String((t.params && t.params.messages && t.params.messages[0] && t.params.messages[0].content) || '').slice(0, 200),
          ...(t.params && t.params.role ? { role: t.params.role } : {}),
        }));
        if (conversationId) tasks = tasks.filter((t) => t.conversationId === conversationId);
        const convIds = [...new Set(tasks.map((t) => t.conversationId).filter(Boolean))];
        const convProject = new Map();
        if (convIds.length) {
          const placeholders = convIds.map(() => '?').join(',');
          const rows = await db.prepare(`SELECT id, project_id FROM copilot_conversations WHERE id IN (${placeholders})`).all(...convIds);
          for (const r of rows) convProject.set(r.id, r.project_id || null);
        }
        for (const t of tasks) t.projectId = t.conversationId ? (convProject.get(t.conversationId) || null) : null;
        // UI-408 — 终态摘要头（内联结果卡数据源）：批量取每个子任务最近一条 assistant 消息
        const taskIds = tasks.map((t) => t.taskId);
        if (taskIds.length) {
          const placeholders = taskIds.map(() => '?').join(',');
          const summaryRows = await db
            .prepare(
              `SELECT m.task_id AS task_id, m.content AS content
               FROM copilot_messages m
               WHERE m.task_id IN (${placeholders}) AND m.role = 'assistant'
               ORDER BY m.ts DESC`
            )
            .all(...taskIds);
          const summaryMap = new Map();
          for (const row of summaryRows) {
            if (!summaryMap.has(row.task_id)) summaryMap.set(row.task_id, String(row.content || ''));
          }
          for (const t of tasks) {
            const content = summaryMap.get(t.taskId);
            t.summaryHead = content ? content.slice(0, 200) : null;
          }
        }
        return res.json({ ok: true, tasks });
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'list_failed', message: e && e.message ? e.message : String(e) });
      }
    });

    // 窗口标题数据源：单任务元信息
    app.get('/api/ai/agent/task/:taskId/meta', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
      try {
        const task = agentTaskStore.getAgentTask(req.params.taskId);
        if (!task) return fail(res, 'not_found', '任务不存在');
        if (task.userId && task.userId !== userId) return res.status(403).json({ ok: false, error: 'forbidden', message: '无权查看该任务' });
        return res.json({
          ok: true,
          taskId: task.taskId,
          status: task.status,
          agentStatus: task.agentStatus,
          taskText: String((task.params && task.params.messages && task.params.messages[0] && task.params.messages[0].content) || '').slice(0, 200),
          ...(task.params && task.params.role ? { role: task.params.role } : {}),
          conversationId: (task.params && task.params.conversationId) || null,
          // BLOCK-88 P2（D3）— 访客署名透出（委托任务「来自工程师 X」断言面）
          ...(task.params && task.params.federated ? { federatedFrom: task.params.federated.displayName } : {}),
          conversationTitle: conversationHelper.getConversationTitle(
            (task.params && task.params.conversationId) || null
          ),
          parentTaskId: (task.params && task.params.parentTaskId) || null,
          createdAt: task.createdAt,
          finishedAt: task.finishedAt,
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'meta_failed', message: e && e.message ? e.message : String(e) });
      }
    });

    // 留言（队列语义——运行中不即时注入，续派时作为上下文注入）
    app.post('/api/ai/agent/task/:taskId/message', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
      try {
        const task = agentTaskStore.getAgentTask(req.params.taskId);
        if (!task) return fail(res, 'not_found', '任务不存在');
        if (task.userId && task.userId !== userId) return res.status(403).json({ ok: false, error: 'forbidden', message: '无权向该任务留言' });
        const result = queueUserMessage({ childTaskId: task.taskId, message: req.body && req.body.message });
        if (!result.ok) return fail(res, result.error, result.message);
        return res.json(result);
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'message_failed', message: e && e.message ? e.message : String(e) });
      }
    });

    // 续派（终态后；沿用原任务父链/模型/权限继承）
    app.post('/api/ai/agent/task/:taskId/followup', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
      try {
        const task = agentTaskStore.getAgentTask(req.params.taskId);
        if (!task) return fail(res, 'not_found', '任务不存在');
        if (task.userId && task.userId !== userId) return res.status(403).json({ ok: false, error: 'forbidden', message: '无权续派该任务' });
        const result = await launchUserFollowup({ childTaskId: task.taskId, userId, task: req.body && req.body.task });
        if (!result.ok) return fail(res, result.error, result.message);
        return res.json(result);
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'followup_failed', message: e && e.message ? e.message : String(e) });
      }
    });
  },
};
