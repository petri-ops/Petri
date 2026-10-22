'use strict';

/**
 * helpers/approval-request-store.js — 执行审批一等资源（BLOCK-180 P0；BLOCK-243 Q1 v2）。
 *
 * 动态防护/用户规则/MCP trust 命中时，拦截器在此注册 ApprovalRequest 资源
 * （policy 保持纯函数，注册与决策都在有 I/O 的层）。资源形态：
 *   { requestId, taskId, toolName, fingerprint, originalFingerprint,
 *     effectiveFingerprint, guardKey, dimension, detail, mcpServerId,
 *     command, spans, argsPreview, argsPreviewTruncated, inputEditable,
 *     ctxSnapshot, createdAt, expiresAt, status, scope, decidedAt,
 *     decidedMode, decision, decisionReason, durationMs, updatedInput }
 *
 * 语义（对齐 guard-ack 诚实边界：任务内内存态，不跨会话）：
 * - 同指纹+guardKey 的 pending 请求幂等复用（模型重试不换 requestId）；
 * - pending TTL 惰性过期（重试/查询时判，不靠定时器）；
 * - scope='once'：批准**生效参数**指纹一次（编辑参数时只批 effective，
 *   原参数重试不自动放行）；拦截器执行前消耗；
 * - scope='task'：维度级 ack（既有 guardKey Set 语义，任务结束失效）；
 * - scope='always'：仅带 mcpServerId 的请求可用，经 applyAlways 回调写
 *   MCP 服务 trust=allow（配置写入在路由层，本 store 不做策略 I/O）；
 * - legacy mode='always' 映射为 scope='task'（BLOCK-180 语义零改写）；
 * - 决策留痕由路由侧 permission.resolved（+ legacy guard_ack）事件承担。
 */

const crypto = require('crypto');
const { stableStringify } = require('../../shared-backend/canonical-json');
const { redactSensitiveValue } = require('../../shared-backend/redaction');
const { analyzeCommandRiskSpans } = require('./command-risk-spans');

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEW_CHARS = 4000;
const VALID_SCOPES = new Set(['once', 'task', 'always']);

const stores = new Map(); // taskId -> { requests: Map<requestId, request>, approvedFingerprints: Set }

function callFingerprint(toolName, args) {
  const canonical = (() => {
    try { return stableStringify({ name: toolName, args: args || {} }); } catch { return JSON.stringify(toolName); }
  })();
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/** 脱敏 + 有界参数预览；含脱敏字段或截断时前端不可编辑（避免把 [REDACTED] 写回）。 */
function boundedJsonPreview(value) {
  let redacted;
  try { redacted = redactSensitiveValue(value == null ? {} : value); } catch { redacted = {}; }
  let text;
  try { text = JSON.stringify(redacted); } catch { text = '{}'; }
  if (typeof text !== 'string') text = '{}';
  if (text.length <= MAX_PREVIEW_CHARS) {
    return { text, truncated: false, redacted: text.includes('[REDACTED]') };
  }
  return {
    text: `${text.slice(0, MAX_PREVIEW_CHARS)}…`,
    truncated: true,
    redacted: text.includes('[REDACTED]'),
  };
}

/** 审批请求只保留可重校验的执行上下文标量，不持有 loop 引用。 */
function normalizeCtxSnapshot(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const snapshot = {};
  if (typeof ctx.accessMode === 'string') snapshot.accessMode = ctx.accessMode;
  if (typeof ctx.planMode === 'boolean') snapshot.planMode = ctx.planMode;
  if (typeof ctx.allowExecution === 'boolean') snapshot.allowExecution = ctx.allowExecution;
  if (ctx.projectId != null && String(ctx.projectId).trim() !== '') snapshot.projectId = String(ctx.projectId);
  if (ctx.userId != null && String(ctx.userId).trim() !== '') snapshot.userId = String(ctx.userId);
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function getStore(taskId) {
  return taskId ? stores.get(taskId) || null : null;
}

/** loop 侧任务开始时创建（对齐 createGuardAcks 接线点）；返回资源 Map 注入 toolCtx。 */
function createApprovalRequests(taskId) {
  if (!taskId) return null;
  const store = {
    requests: new Map(),
    approvedFingerprints: new Set(),
    // BLOCK-243 — 编辑参数批准后的一次性替换：原始指纹 → 生效参数。
    // 模型重试原调用时拦截器替换为生效参数（原始/生效都进审计）。
    overrides: new Map(),
    // BLOCK-244 — 同参连续调用历史（循环防护；只存指纹+时刻，不存参数）。
    callHistory: [],
  };
  stores.set(taskId, store);
  return store;
}

/** 查找（并惰性过期）本次调用的参数替换。 */
function findInputOverride(ctx, fingerprint) {
  const store = ctx && ctx.approvalRequests;
  if (!store || !(store.overrides instanceof Map) || !fingerprint) return null;
  const entry = store.overrides.get(fingerprint);
  if (!entry) return null;
  if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now()) {
    store.overrides.delete(fingerprint);
    return null;
  }
  return entry;
}

function consumeInputOverride(ctx, fingerprint) {
  const store = ctx && ctx.approvalRequests;
  if (!store || !(store.overrides instanceof Map) || !fingerprint) return;
  store.overrides.delete(fingerprint);
}

/** BLOCK-244 — 记录一次工具调用尝试（循环防护；有界 50 条）。 */
function recordToolCall(ctx, toolName, args) {
  const store = ctx && ctx.approvalRequests;
  if (!store || !Array.isArray(store.callHistory)) return null;
  const fingerprint = callFingerprint(toolName, args);
  store.callHistory.push({ fingerprint, at: Date.now() });
  if (store.callHistory.length > 50) store.callHistory.splice(0, store.callHistory.length - 50);
  return fingerprint;
}

function getCallHistory(ctx) {
  const store = ctx && ctx.approvalRequests;
  return store && Array.isArray(store.callHistory) ? store.callHistory : [];
}

/** 撤销最近一次记录（审批/策略拒绝的尝试不进入循环计数）。 */
function removeToolCall(ctx, fingerprint) {
  const history = getCallHistory(ctx);
  const last = history[history.length - 1];
  if (last && (!fingerprint || last.fingerprint === fingerprint)) history.pop();
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

function pendingCount(store) {
  if (!store || !(store.requests instanceof Map)) return 0;
  sweepStore(store, Date.now());
  let count = 0;
  for (const request of store.requests.values()) {
    if (request.status === 'pending') count += 1;
  }
  return count;
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

function normalizeScope({ scope, mode }) {
  if (scope !== undefined && scope !== null && String(scope).trim() !== '') {
    const value = String(scope).trim();
    return VALID_SCOPES.has(value) ? value : null;
  }
  return mode === 'always' ? 'task' : 'once';
}

/**
 * 注册（或幂等复用）审批请求。command（workspace_exec 族）附带风险 span。
 * @returns {{ok:true, request, created, pendingCount, duplicateOfRequestId?} | {ok:false, error:string}}
 */
function registerApprovalRequest(store, {
  toolName,
  args = {},
  guardKey,
  dimension,
  detail,
  mcpServerId = null,
  ctxSnapshot = null,
  intent = null,
  source = 'main',
}) {
  if (!store || !(store.requests instanceof Map)) return { ok: false, error: 'store_required' };
  if (!toolName) return { ok: false, error: 'tool_required' };
  const now = Date.now();
  sweepStore(store, now);
  const fingerprint = callFingerprint(toolName, args);
  for (const request of store.requests.values()) {
    if (request.status !== 'pending') continue;
    if (request.fingerprint === fingerprint && request.guardKey === guardKey) {
      return {
        ok: true,
        request,
        created: false,
        duplicateOfRequestId: request.requestId,
        pendingCount: pendingCount(store),
      };
    }
  }
  const command = typeof args.command === 'string' ? args.command : null;
  const preview = boundedJsonPreview(args);
  const request = {
    requestId: `apr_${crypto.randomBytes(9).toString('hex')}`,
    toolName,
    fingerprint,
    originalFingerprint: fingerprint,
    effectiveFingerprint: null,
    guardKey: String(guardKey || ''),
    dimension: dimension || null,
    detail: detail || null,
    mcpServerId: mcpServerId ? String(mcpServerId) : null,
    intent: intent && typeof intent === 'object' ? intent : null,
    source: source === 'side-task' ? 'side-task' : 'main',
    command,
    spans: command ? analyzeCommandRiskSpans(command) : [],
    argsPreview: preview.text,
    argsPreviewTruncated: preview.truncated,
    inputEditable: !preview.truncated && !preview.redacted,
    ctxSnapshot: normalizeCtxSnapshot(ctxSnapshot),
    createdAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
    status: 'pending',
    scope: null,
    decidedAt: null,
    decidedMode: null,
    decision: null,
    decisionReason: null,
    durationMs: null,
    updatedInput: false,
    effectiveInput: null,
    effectiveInputTruncated: false,
  };
  store.requests.set(request.requestId, request);
  return { ok: true, request, created: true, pendingCount: pendingCount(store) };
}

/**
 * 决策审批请求。
 * @param {object} options
 * @param {'once'|'task'|'always'} [options.scope] 新范围；缺省按 mode 兼容映射
 * @param {'once'|'always'} [options.mode] BLOCK-180 legacy（always→task）
 * @param {object} [options.updatedInput] 批准时编辑后的生效参数（仅 approve）
 * @param {string} [options.reason] 用户备注（审计）
 * @param {(key:string)=>{ok?:boolean,error?:string}} [options.ackGuardKey] task 级 ack 回调
 * @param {(request:object)=>{ok?:boolean,error?:string}} [options.applyAlways] always 级 trust 写入回调
 */
function decideApprovalRequest({
  taskId,
  requestId,
  decision,
  mode,
  scope,
  updatedInput,
  reason,
  ackGuardKey,
  applyAlways,
}) {
  const store = getStore(taskId);
  if (!store) return { ok: false, error: 'task_required' };
  sweepStore(store, Date.now());
  const request = store.requests.get(String(requestId || ''));
  if (!request) return { ok: false, error: 'request_not_found' };
  if (request.status === 'expired') return { ok: false, error: 'request_expired', requestId: request.requestId };
  if (request.status !== 'pending') {
    return { ok: false, error: 'request_already_decided', requestId: request.requestId, status: request.status };
  }
  if (decision !== 'approve' && decision !== 'deny') return { ok: false, error: 'invalid_decision' };
  const effectiveScope = normalizeScope({ scope, mode });
  if (!effectiveScope) return { ok: false, error: 'invalid_scope' };
  if (decision === 'deny' && updatedInput !== undefined) return { ok: false, error: 'updated_input_with_deny' };
  if (updatedInput !== undefined && updatedInput !== null
    && (!updatedInput || typeof updatedInput !== 'object' || Array.isArray(updatedInput))) {
    return { ok: false, error: 'updated_input_invalid' };
  }
  if (decision === 'approve' && effectiveScope === 'always' && !request.mcpServerId) {
    return { ok: false, error: 'always_scope_unavailable' };
  }
  if (decision === 'approve' && effectiveScope === 'always' && typeof applyAlways !== 'function') {
    return { ok: false, error: 'always_handler_required' };
  }
  const hasUpdated = decision === 'approve' && updatedInput !== undefined && updatedInput !== null;
  if (hasUpdated && effectiveScope !== 'once') {
    // 编辑参数是一次性精确批准；「本任务/始终」必须先按原参数建立范围。
    return { ok: false, error: 'updated_input_requires_once' };
  }

  let fingerprint = null;
  let consumeOnUse = false;
  let override = false;
  if (decision === 'approve') {
    if (effectiveScope === 'task') {
      if (typeof ackGuardKey === 'function' && request.guardKey) {
        const acked = ackGuardKey(request.guardKey);
        if (acked && acked.ok === false) return { ok: false, error: acked.error || 'guard_ack_failed' };
      }
    } else if (effectiveScope === 'always') {
      const applied = applyAlways(request);
      if (applied && applied.ok === false) return { ok: false, error: applied.error || 'always_apply_failed' };
    } else if (hasUpdated) {
      // 登记「原始指纹 → 生效参数」替换；模型重试原调用时拦截器执行生效参数，
      // 执行前再跑一次 schema/preflight/policy（新风险拒绝），通过后消耗。
      store.overrides.set(request.fingerprint, {
        requestId: request.requestId,
        toolName: request.toolName,
        guardKey: request.guardKey,
        args: updatedInput,
        createdAt: Date.now(),
        expiresAt: Date.now() + DEFAULT_TTL_MS,
      });
      override = true;
    } else {
      fingerprint = request.fingerprint;
      consumeOnUse = true;
    }
  }

  request.status = decision === 'approve' ? 'approved' : 'denied';
  request.decidedAt = Date.now();
  // legacy decidedMode 保持 BLOCK-180 语义（once / always），新代码读 scope。
  request.decidedMode = effectiveScope === 'once' ? 'once' : 'always';
  request.scope = effectiveScope;
  request.decision = decision;
  request.decisionReason = reason ? String(reason).slice(0, 500) : null;
  request.durationMs = request.decidedAt - request.createdAt;
  if (hasUpdated) {
    const preview = boundedJsonPreview(updatedInput);
    request.updatedInput = true;
    request.effectiveInput = preview.text;
    request.effectiveInputTruncated = preview.truncated;
    request.effectiveFingerprint = callFingerprint(request.toolName, updatedInput);
  }
  return { ok: true, request, fingerprint, consumeOnUse, scope: effectiveScope, override };
}

/** task_events.permission.resolved 形状（路由侧单源；guard_ack 保留兼容）。 */
function buildPermissionResolvedEvent(request, outcome = {}) {
  const decision = outcome.decision || request.decision || 'deny';
  const scope = outcome.scope || request.scope || 'once';
  const effectiveInput = request.effectiveInput || request.argsPreview || null;
  return {
    event: 'permission.resolved',
    requestId: request.requestId,
    decision,
    behavior: decision === 'approve' ? 'allow' : 'deny',
    scope,
    reason: outcome.reason || request.decisionReason || null,
    toolName: request.toolName,
    guardKey: request.guardKey,
    dimension: request.dimension || null,
    mcpServerId: request.mcpServerId || null,
    source: request.source || 'main',
    updatedInput: request.updatedInput === true,
    originalInputHash: request.originalFingerprint || request.fingerprint,
    effectiveInputHash: request.effectiveFingerprint || request.fingerprint,
    originalInput: request.argsPreview || null,
    effectiveInput,
    inputTruncated: request.argsPreviewTruncated === true || request.effectiveInputTruncated === true,
    durationMs: Number.isFinite(request.durationMs) ? request.durationMs : 0,
    at: new Date().toISOString(),
  };
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
  MAX_PREVIEW_CHARS,
  callFingerprint,
  createApprovalRequests,
  getApprovalRequests,
  approveTaskFingerprint,
  registerApprovalRequest,
  decideApprovalRequest,
  findInputOverride,
  consumeInputOverride,
  recordToolCall,
  getCallHistory,
  removeToolCall,
  buildPermissionResolvedEvent,
  getApprovalRequest,
  isFingerprintApproved,
  approveFingerprint,
  consumeFingerprint,
  releaseApprovalRequests,
  countPendingApprovals,
  pendingCount,
};
