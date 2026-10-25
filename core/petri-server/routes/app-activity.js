'use strict';

/**
 * routes/app-activity.js — BLOCK-223 退出摘要只读面。
 *
 * 退出协调器在「停止并退出 / 最小化到托盘」之前需要知道当前还有多少活动。
 * 这里只聚合**已有真值源**，不新建第二套任务状态：
 *   - tool_jobs：pending（排队/待批准）+ running（执行中）
 *   - 审批：approval-request-store 的全局 pending 数（TTL 惰性 sweep）
 *   - 任务：tasks.status='running'，按 params.kind 分主任务/子代理
 *   - 后台进程：workspace-tools 内存表里 status='running' 的记录
 *
 * 终端会话数由主进程合并（会话 Map 在主进程闭包里，后端不可见）。
 * 响应 = { ok, counts, total, fetchedAt }；只读，无任何取消/停止动作。
 */

const approvalRequests = require('../helpers/approval-request-store');
const {
  countRunningBackgroundProcesses,
} = require('../agent-tools/workspace-tools/internals');
const agentTasks = require('../agent-task-store');

function readToolJobCounts(userId) {
  const db = require('../db').getDatabase();
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS n
    FROM tool_jobs
    WHERE user_id = ? AND is_test_run = 0 AND status IN ('pending', 'running')
    GROUP BY status
  `).all(userId);
  const counts = { running: 0, pending: 0 };
  for (const row of rows) {
    if (row.status === 'running') counts.running = Number(row.n) || 0;
    else if (row.status === 'pending') counts.pending = Number(row.n) || 0;
  }
  return counts;
}

function text(value, max = 80) {
  const out = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

function parseParams(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** BLOCK-260 K3 — 退出摘要逐项查看（有界；只给定位信息，不给参数正文）。 */
function readActivityItems(userId, { limit = 20 } = {}) {
  const db = require('../db').getDatabase();
  const items = [];
  const push = (item) => { if (items.length < limit) items.push(item); };

  try {
    const jobRows = db.prepare(`
      SELECT id, name, tool_id, status, project_id, conversation_id
      FROM tool_jobs
      WHERE user_id = ? AND is_test_run = 0 AND status IN ('pending', 'running')
      ORDER BY created_at DESC LIMIT 8
    `).all(userId);
    for (const row of jobRows) {
      push({
        kind: 'toolJob',
        id: String(row.id),
        label: text(row.name || row.tool_id || '工具作业'),
        status: String(row.status || ''),
        projectId: row.project_id || null,
        conversationId: row.conversation_id || null,
      });
    }

    const taskRows = db.prepare(`
      SELECT id, params, status FROM tasks
      WHERE status = 'running' AND (user_id = ? OR user_id IS NULL)
      ORDER BY created_at DESC LIMIT 8
    `).all(userId);
    for (const row of taskRows) {
      const params = parseParams(row.params);
      const message = params.messages && params.messages[0] && params.messages[0].content;
      push({
        kind: params.kind === 'subagent' ? 'subagentTask' : 'task',
        id: String(row.id),
        label: text(params.title || message || '运行中的任务'),
        status: 'running',
        projectId: params.projectId || null,
        conversationId: params.conversationId || null,
      });
    }

    const approvals = approvalRequests.listPendingApprovals({ limit: Math.max(1, limit - items.length) });
    for (const approval of approvals) {
      push({
        kind: 'approval',
        id: approval.requestId,
        label: text(`审批：${approval.toolName}`),
        status: 'pending',
        projectId: approval.projectId || null,
        conversationId: null,
        taskId: approval.taskId || null,
      });
    }
  } catch {
    // 单项读取失败不拖累退出摘要主面。
  }
  return items.slice(0, limit);
}

module.exports = function registerAppActivity(app) {
  app.get('/api/app/activity-summary', (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: '未登录' });
    }
    try {
      const toolJobs = readToolJobCounts(userId);
      const tasks = agentTasks.countRunningAgentTasks(userId);
      const counts = {
        toolJobsRunning: toolJobs.running,
        toolJobsPending: toolJobs.pending,
        approvalsPending: approvalRequests.countPendingApprovals(),
        primaryTasks: tasks.primary,
        subagentTasks: tasks.subagent,
        backgroundProcesses: countRunningBackgroundProcesses(),
      };
      const total = Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
      return res.json({
        ok: true,
        counts,
        total,
        items: readActivityItems(userId, { limit: 20 }),
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: (error && error.message) || '读取活动状态失败' });
    }
  });
};
