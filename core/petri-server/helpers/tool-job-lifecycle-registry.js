'use strict';

/**
 * tool-job-lifecycle-registry.js — BLOCK-128（G0-PLATFORM PL-1 执行语义统一）。
 *
 * 进程级共享的活跃 tool_job 登记表：HTTP 异步路径（tools-executor）与
 * agent/MCP 同步路径（run-plugin-script）共用同一份 owner 装置——心跳、
 * 硬超时、僵尸扫描（executor 启动的 recoverZombieJobs 扫的就是这张表）
 * 与取消链因此对两条路径同等生效。并发准入计数与 HTTP 路径同语义
 *（每用户 pending+running，终态不计）。
 */

/** @type {Map<string, import('./tools-executor/active-job').ActiveToolJobOwner>} */
const activeToolJobs = new Map();

/** 每用户在途（pending+running）作业数；终态不计。 */
function countActiveUserToolJobs(db, userId) {
  if (!db || !userId) return 0;
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM tool_jobs WHERE user_id = ? AND status IN ('pending','running')")
      .get(userId);
    return row && Number.isFinite(row.n) ? row.n : 0;
  } catch {
    return 0;
  }
}

/**
 * BLOCK-130（PL-3 队列化）：终态调度泵挂点。executor 工厂注册泵函数，
 * 状态机终态原语释放槽位后触发——排队中的 pending 作业由泵拉起。
 * 永不 throw（泵故障不阻断终态收敛），fire-and-forget。
 */
let schedulerPump = null;

function setSchedulerPump(pump) {
  schedulerPump = typeof pump === 'function' ? pump : null;
}

function notifyScheduler() {
  try {
    if (schedulerPump) schedulerPump();
  } catch (error) {
    console.warn('[tools] queue pump notify failed:', error.message);
  }
}

module.exports = {
  activeToolJobs,
  countActiveUserToolJobs,
  setSchedulerPump,
  notifyScheduler,
};
