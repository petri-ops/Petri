'use strict';

/**
 * item88 第二波：双通道结论回写单一幂等入口（设计稿 §4.6 红线）。
 * 主会话 PM 转达与工位直连都调它；同一 taskId+eventKey 只落一条 task_events，
 * 终态由调用方用 state-machine.transitionRun 决定，本模块只记事实。
 */

function writebackOutcome({ db, taskId, outcome, channel = 'pm', eventKey, payload = {} } = {}) {
  if (!db || !taskId || !outcome) throw new Error('workbench_writeback_args_required');
  if (typeof db.prepare !== 'function') throw new Error('workbench_writeback_db_invalid');
  const key = eventKey || `${channel}:${outcome}`;
  // 不用 json_extract（本机 better-sqlite3 未编 JSON1）：payload 里 eventKey 固定首字段，LIKE 精确匹配。
  const escaped = String(key).replace(/[\\%_]/g, '\\$&');
  const existing = db.prepare(
    "SELECT 1 FROM task_events WHERE task_id=? AND event_type='workbench.writeback' AND payload LIKE ? ESCAPE '\\'",
  ).get(taskId, `%"eventKey":"${escaped}"%`);
  if (existing) return { ok: true, deduped: true, taskId };
  const next = db.prepare('SELECT COALESCE(MAX(seq),0) + 1 AS seq FROM task_events WHERE task_id = ?').get(taskId);
  db.prepare('INSERT INTO task_events (task_id, seq, event_type, payload, created_at) VALUES (?,?,?,?,?)')
    .run(taskId, next.seq, 'workbench.writeback', JSON.stringify({ eventKey: key, outcome, channel, ...payload }), new Date().toISOString());
  return { ok: true, deduped: false, taskId, seq: next.seq };
}

module.exports = { writebackOutcome };
