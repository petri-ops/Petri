'use strict';

/**
 * helpers/guard-ack-store.js — 动态防护/用户规则确认通道写侧（BLOCK-171 CP-2）。
 *
 * 读侧早已在册（agent-tool-policy.isGuardAcked 读 ctx.dynamicGuardAcks，
 * Set 或 {key:true} 皆可），但从未有生产者——require-ack 拦截后模型与用户
 * 都没有放行通道。本 store 按 task 锚定 ack 集：
 *   - loop 侧 createGuardAcks(taskId) 建 Set 注入 toolCtx.dynamicGuardAcks；
 *   - HTTP guard-ack 路由 ackGuard(taskId, guardKey) 写入（用户裁定留痕
 *     由路由侧 guard_ack 事件承担，本 store 只管放行判定真值）；
 *   - runLoop 单返回点 releaseGuardAcks(taskId)。
 * 诚实边界：v1 为任务内内存态（「本任务总是放行」= 任务生命周期内）；
 * 跨会话持久化=用户规则面（ORC-1）职责，不在此越权。
 */

const stores = new Map(); // taskId -> Set<guardKey>

function createGuardAcks(taskId) {
  if (!taskId) return null;
  const set = new Set();
  stores.set(taskId, set);
  return set;
}

function getGuardAcks(taskId) {
  return taskId ? stores.get(taskId) || null : null;
}

function ackGuard(taskId, guardKey) {
  const key = String(guardKey || '').trim();
  if (!key) return { ok: false, error: 'guard_key_required' };
  let set = getGuardAcks(taskId);
  if (!set) set = createGuardAcks(taskId);
  if (!set) return { ok: false, error: 'task_required' };
  set.add(key);
  return { ok: true, guardKey: key, total: set.size };
}

function releaseGuardAcks(taskId) {
  if (taskId) stores.delete(taskId);
}

module.exports = {
  createGuardAcks,
  getGuardAcks,
  ackGuard,
  releaseGuardAcks,
};
