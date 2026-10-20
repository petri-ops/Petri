'use strict';

/**
 * helpers/approval-request-store.js — 执行审批一等资源（BLOCK-180 P0）。
 *
 * 动态防护/用户规则命中时，拦截器在此注册 ApprovalRequest 资源（policy 保持
 * 纯函数，注册与决策都在有 I/O 的层）。资源形态：
 *   { requestId, taskId, toolName, fingerprint, guardKey, dimension, detail,
 *     command, spans, createdAt, expiresAt, status: pending|approved|denied|expired,
 *     decidedAt, decidedMode: 'once'|'always'|null }
 *
 * 语义（对齐 guard-ack 诚实边界：任务内内存态，不跨会话）：
 * - 同指纹+guardKey 的 pending 请求幂等复用（模型重试不换 requestId）；
 * - pending TTL 惰性过期（重试/查询时判，不靠定时器）；过期后重试注册新请求；
 * - 「放行一次」= 指纹级批准：approve once 记录指纹，policy 读 ctx.approvedFingerprints
 *   放行该调用一次，拦截器执行前消耗（同指纹再次调用需重新审批）；
 * - 「总是放行」= 维度级（既有 guardKey Set 语义零改写）+ 资源标记 approved；
 * - 决策留痕仍由路由侧 guard_ack 事件承担（事件新增 requestId/decision/spans
 *   字段，向后兼容），本 store 只管资源与放行判定真值。
 */

const crypto = require('crypto');
const { stableStringify } = require('../../shared-backend/canonical-json');
const { analyzeCommandRiskSpans } = require('./command-risk-spans');

const DEFAULT_TTL_MS = 10 * 60 * 1000;

const stores = new Map(); // taskId -> { requests: Map<requestId, request>, approvedFingerprints: Set }

function callFingerprint(toolName, args) {
  const canonical = (() => {
    try { return stableStringify({ name: toolName, args: args || {} }); } catch { return JSON.stringify(toolName); }
  })();
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function getStore(taskId) {
  return taskId ? stores.get(taskId) || null : null;
}

/** loop 侧任务开始时创建（对齐 createGuardAcks 接线点）；返回资源 Map 注入 toolCtx。 */
function createApprovalRequests(taskId) {
  if (!taskId) return null;
  const store = { requests: new Map(), approvedFingerprints: new Set() };
  stores.set(taskId, store);
  return store;
}

function getApprovalRequests(taskId) {
  return taskId ? stores.get(taskId) || null : null;
}

function sweepStore(store, now) {
  for (const [requestId, request] of store.requests) {
    if (request.status === 'pending' && request.expiresAt <= now) {
      request.status = 'expired';
      store.requests.set(requestId, request);
    }
  }
}

// BLOCK-180 P1 — 「放行一次」的指纹登记（路由决策侧调用；loop 已把同一 Set
// 挂到 toolCtx.approvedFingerprints，policy 读侧即时生效，拦截器执行前消耗）。
function approveTaskFingerprint(taskId, fingerprint) {
  const store = getStore(taskId);
  if (!store || !fingerprint) return { ok: false, error: 'task_required' };
  store.approvedFingerprints.add(fingerprint);
  return { ok: true, fingerprint };
}

function isFingerprintApproved(ctx, fingerprint) {
  const approved = ctx && ctx.approvedFingerprints;
  if (!approved) return false;
  if (typeof approved.has === 'function') return approved.has(fingerprint);
  return approved[fingerprint] === true;
}

/**
 * 注册（或幂等复用）审批请求。command（workspace_exec 族）附带风险 span。
 * @returns {{ok:true, request, created:boolean} | {ok:false, error:string}}
 */
function registerApprovalRequest(store, { toolName, args = {}, guardKey, dimension, detail }) {
  if (!store || !(store.requests instanceof Map)) return { ok: false, error: 'store_required' };
  if (!toolName) return { ok: false, error: 'tool_required' };
  const now = Date.now();
  sweepStore(store, now);
  const fingerprint = callFingerprint(toolName, args);
  for (const request of store.requests.values()) {
    if (request.status !== 'pending') continue;
    if (request.fingerprint === fingerprint && request.guardKey === guardKey) {
      return { ok: true, request, created: false };
    }
  }
  const command = typeof args.command === 'string' ? args.command : null;
  const request = {
    requestId: `apr_${crypto.randomBytes(9).toString('hex')}`,
    toolName,
    fingerprint,
    guardKey: String(guardKey || ''),
    dimension: dimension || null,
    detail: detail || null,
    command,
    spans: command ? analyzeCommandRiskSpans(command) : [],
    createdAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
    status: 'pending',
    decidedAt: null,
    decidedMode: null,
  };
  store.requests.set(request.requestId, request);
  return { ok: true, request, created: true };
}

/**
 * 决策审批请求。mode='once' 记录指纹（返回 consumedOnUse 标记供拦截器执行后
 * 消耗）；mode='always' 同时写入 ctx 级 guardKey ack 集（维度级，既有语义）。
 */
function decideApprovalRequest({ taskId, requestId, decision, mode, ackGuardKey }) {
  const store = getStore(taskId);
  if (!store) return { ok: false, error: 'task_required' };
  sweepStore(store, Date.now());
  const request = store.requests.get(String(requestId || ''));
  if (!request) return { ok: false, error: 'request_not_found' };
  if (request.status === 'expired') return { ok: false, error: 'request_expired', requestId: request.requestId };
  if (request.status !== 'pending') return { ok: false, error: 'request_already_decided', requestId: request.requestId, status: request.status };
  if (decision !== 'approve' && decision !== 'deny') return { ok: false, error: 'invalid_decision' };
  const decidedMode = mode === 'always' ? 'always' : 'once';
  request.status = decision === 'approve' ? 'approved' : 'denied';
  request.decidedAt = Date.now();
  request.decidedMode = decidedMode;
  if (decision === 'approve' && decidedMode === 'once') {
    return { ok: true, request, fingerprint: request.fingerprint, consumeOnUse: true };
  }
  if (decision === 'approve' && decidedMode === 'always') {
    if (typeof ackGuardKey === 'function' && request.guardKey) {
      const acked = ackGuardKey(request.guardKey);
      if (acked && acked.ok === false) return { ok: false, error: acked.error || 'guard_ack_failed' };
    }
    return { ok: true, request, fingerprint: null, consumeOnUse: false };
  }
  return { ok: true, request, fingerprint: null, consumeOnUse: false };
}

function getApprovalRequest(taskId, requestId) {
  const store = getStore(taskId);
  if (!store) return null;
  sweepStore(store, Date.now());
  return store.requests.get(String(requestId || '')) || null;
}

/** 指纹放行登记与消耗（拦截器执行侧）。 */
function approveFingerprint(ctx, fingerprint) {
  if (!fingerprint) return;
  const approved = ctx && ctx.approvedFingerprints;
  if (!approved) return;
  if (typeof approved.add === 'function') approved.add(fingerprint);
  else approved[fingerprint] = true;
}

function consumeFingerprint(ctx, fingerprint) {
  if (!fingerprint) return;
  const approved = ctx && ctx.approvedFingerprints;
  if (!approved) return;
  if (typeof approved.delete === 'function') approved.delete(fingerprint);
  else delete approved[fingerprint];
}

/** 任务结束清理（对齐 releaseGuardAcks 接线点）。 */
function releaseApprovalRequests(taskId) {
  if (taskId) stores.delete(taskId);
}

/**
 * BLOCK-223 — 全局 pending 计数（退出摘要只读面）。
 * 先按当前时刻 sweep 各任务 store（TTL 惰性过期语义不靠定时器），再数 pending。
 */
function countPendingApprovals(now = Date.now()) {
  let pending = 0;
  for (const store of stores.values()) {
    sweepStore(store, now);
    for (const request of store.requests.values()) {
      if (request.status === 'pending') pending += 1;
    }
  }
  return pending;
}

module.exports = {
  DEFAULT_TTL_MS,
  callFingerprint,
  createApprovalRequests,
  getApprovalRequests,
  approveTaskFingerprint,
  registerApprovalRequest,
  decideApprovalRequest,
  getApprovalRequest,
  isFingerprintApproved,
  approveFingerprint,
  consumeFingerprint,
  releaseApprovalRequests,
  countPendingApprovals,
};
