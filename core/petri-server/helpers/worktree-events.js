'use strict';

/**
 * helpers/worktree-events.js — BLOCK-336 P3 worktree 生命周期事件（task_events 可观测流）。
 *
 * 双写与语义分工（与 BLOCK-323 的既有裁定一致）：
 *   - `worktree-audit.jsonl`（`worktree-contract.appendAudit`）= 治理证据，永久、不被清扫；
 *   - `task_events` = **当下可观测**（会话内可读的生命周期流，随 agent 事件 30 天清扫）。
 *   本模块只写后者，**best-effort**：写失败绝不回滚或阻断 git 动作（证据仍以 jsonl 为准）。
 *
 * 作用域：一条 worktree 自成一条流，`task_id = 'worktree:<worktreeId>'`，seq 从 1 递增；
 * 项目层副本（P2）复用同一 worktreeId 流，payload 带 `via='project-layer'`。
 *
 * 依赖纪律：**本模块零项目依赖**（不 require db / agent-task-store），连接由调用方注入。
 * 否则 `db → project-worktree → worktree-events → db` 会成环（arch-cycles 实测抓到）。
 */

function nextSeq(database, taskId) {
  const row = database.prepare('SELECT MAX(seq) AS m FROM task_events WHERE task_id = ?').get(taskId);
  const max = row && Number.isFinite(Number(row.m)) ? Number(row.m) : 0;
  return max + 1;
}

/**
 * 记录一条 worktree 生命周期事件（best-effort，绝不抛）。
 * @param {{ database?: object, worktreeId: string, action: 'create'|'remove'|'merge_request', payload?: object }} input
 * @returns {{ ok: boolean, seq?: number, reason?: string }}
 */
function recordWorktreeEvent({ database, worktreeId, action, payload = {} }) {
  if (!worktreeId || !action) return { ok: false, reason: 'invalid_input' };
  if (!database || typeof database.prepare !== 'function') return { ok: false, reason: 'database_unavailable' };
  const taskId = `worktree:${worktreeId}`;
  const eventType = `worktree_${action}`;
  try {
    const seq = nextSeq(database, taskId);
    database
      .prepare('INSERT INTO task_events (task_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(taskId, seq, eventType, JSON.stringify({ ...payload, action }), new Date().toISOString());
    return { ok: true, seq };
  } catch (error) {
    return { ok: false, reason: 'append_failed', message: error.message };
  }
}

module.exports = { recordWorktreeEvent };
