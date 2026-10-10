'use strict';

/**
 * stale-running-reconciler.js — PL-6a（G0-PLATFORM 安全与静默失败首刀）。
 *
 * 兜底对账器：周期扫描 tool_jobs 里 status='running' 的行，凡**进程内无活跃
 * owner**（tool-job-lifecycle-registry 的 activeToolJobs 不含该 id）且心跳已
 * 超时（或从未有心跳且已过启动宽限）的，一律标 failed——一次性兜死所有
 * 终态持久化失败路径（tools-executor 内多处 transition 写失败仅 console.warn
 * 后放弃的滞留场景，含 ssh-direct 完成/adopt/settleSpawn 三类已勘察点位）。
 *
 * 防误杀设计（勘察 PL-6a 风险项）：
 *   - 判定主据 = activeToolJobs 有无 owner（进程活着且在跑 → 绝不动），
 *     心跳超时只是辅助条件——heartbeat 写失败静默属已知路径（armed 版 warn、
 *     ssh-direct 轮询版吞），owner 在场而心跳停更不是滞留；
 *   - pending 不在扫描范围（调度泵自治域）；
 *   - 行级 WHERE status='running' 幂等，与既有 transition 同语义。
 */

const { activeToolJobs } = require('./tool-job-lifecycle-registry');
const { publishJobTerminalState } = require('./job-events');
const { notifyScheduler } = require('./tool-job-lifecycle-registry');

const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000; // 心跳停更阈值：10min（30s 心跳间隔的 20 倍余量）
const DEFAULT_INTERVAL_MS = 60 * 1000; // 对账周期 60s
const DEFAULT_STARTUP_GRACE_MS = 5 * 60 * 1000; // 无心跳行的启动宽限（claim 后首个心跳窗）

function reconcileStaleRunningToolJobs({
  db,
  now = Date.now,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  startupGraceMs = DEFAULT_STARTUP_GRACE_MS,
} = {}) {
  if (!db) return { reconciled: [] };
  const observedAt = now();
  const rows = db
    .prepare("SELECT id, heartbeat_at, created_at FROM tool_jobs WHERE status='running'")
    .all();
  const reconciled = [];
  for (const row of rows) {
    // 主据：进程内有 owner 一律不动（长跑真作业/心跳写失败仍活着的都归这里保护）
    if (activeToolJobs.has(row.id)) continue;
    const heartbeatAt = Number(row.heartbeat_at) || 0;
    const createdOrHeartbeat = heartbeatAt > 0 ? heartbeatAt : Number(row.created_at) || 0;
    const ageLimit = heartbeatAt > 0 ? staleAfterMs : startupGraceMs;
    if (!createdOrHeartbeat || observedAt - createdOrHeartbeat < ageLimit) continue;
    const result = db
      .prepare(
        "UPDATE tool_jobs SET status='failed', error='terminal_persistence_lost: reconciled by stale-running check', completed_at=? WHERE id=? AND status='running'",
      )
      .run(observedAt, row.id);
    if (result && result.changes >= 1) {
      publishJobTerminalState(row.id, 'failed');
      reconciled.push(row.id);
    }
  }
  if (reconciled.length > 0) notifyScheduler();
  return { reconciled };
}

function scheduleStaleRunningReconciler({
  db,
  intervalMs = DEFAULT_INTERVAL_MS,
  setIntervalFn = setInterval,
  reconcile = reconcileStaleRunningToolJobs,
} = {}) {
  const timer = setIntervalFn(() => {
    try {
      const { reconciled } = reconcile({ db });
      if (reconciled.length > 0) {
        console.warn(`[stale-running-reconciler] ${reconciled.length} job(s) reconciled to failed:`, reconciled.join(','));
      }
    } catch (error) {
      // 对账器自身故障不致命（下一轮再扫），但必须可观测——不重蹈「泵静默吞」
      console.warn('[stale-running-reconciler] sweep failed:', error?.message || String(error));
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  DEFAULT_STALE_AFTER_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_STARTUP_GRACE_MS,
  reconcileStaleRunningToolJobs,
  scheduleStaleRunningReconciler,
};
