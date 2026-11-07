'use strict';

/**
 * core/shared-backend/execution-admission.js — BLOCK-377（S2 / G-06）执行准入内核。
 *
 * 职责：一次性 capability token 的签发 / 校验 / 消耗（纯决策，不做 IO、不发事件）。
 * 三执行入口（tools-executor / ssh-direct-runner；MCP run-plugin-script 依 BLOCK-374
 * 两轴分离裁决由 MCP trust 轴治理，不走本面）在执行边界校验并消耗本 token——
 * 「策略判定（拦截器/规则层）」与「真正执行」由此焊成一条可审计闭环。
 *
 * Token 形状：{ v, taskId, fingerprint, ctxSnapshotHash, expiresAt, nonce }。
 * 单次消耗：consume 后即刻失效（重放拒绝）；fingerprint/ctxSnapshot/taskId 任一不匹配
 * 即拒绝；过期拒绝；enforcement 关闭时 decide 仍返回判定结果（observe 模式由调用方裁量）。
 *
 * 红线：本模块不引入第二执行器/第二台账；消耗状态是进程内一次性语义（幂等键=nonce），
 * 跨进程审计仍走 task_events / decision_log 既有通道。
 */

const crypto = require('crypto');

const TOKEN_VERSION = 1;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

const consumedNonces = new Set();

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * 签发一次性执行凭据。
 * @param {{ taskId: string, fingerprint: string, ctxSnapshot: object, ttlMs?: number }} input
 * @returns {{ token: object, tokenHash: string }}
 */
function issueExecutionToken({ taskId, fingerprint, ctxSnapshot, ttlMs } = {}) {
  if (!taskId || !fingerprint) {
    throw new Error('execution token requires taskId and fingerprint');
  }
  const now = Date.now();
  const token = {
    v: TOKEN_VERSION,
    taskId: String(taskId),
    fingerprint: String(fingerprint),
    ctxSnapshotHash: sha256(stableStringify(ctxSnapshot ?? null)),
    expiresAt: now + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  return { token, tokenHash: sha256(stableStringify(token)) };
}

/**
 * 校验并消耗（单次）。任一失败不消耗（除重放外——重放本身即违规事实）。
 * @param {{ token: object, taskId?: string, fingerprint?: string, ctxSnapshot?: object, now?: number }} input
 * @returns {{ ok: true, tokenHash: string } | { ok: false, reason: string, detail?: object }}
 */
function verifyAndConsumeExecutionToken({ token, taskId, fingerprint, ctxSnapshot, now } = {}) {
  if (!token || typeof token !== 'object' || token.v !== TOKEN_VERSION) {
    return { ok: false, reason: 'execution_token_invalid' };
  }
  const at = Number.isFinite(now) ? now : Date.now();
  if (!Number.isFinite(token.expiresAt) || at > token.expiresAt) {
    return { ok: false, reason: 'execution_token_expired', detail: { expiresAt: token.expiresAt || null } };
  }
  if (taskId && String(token.taskId) !== String(taskId)) {
    return { ok: false, reason: 'execution_token_task_mismatch', detail: { tokenTaskId: token.taskId, expected: String(taskId) } };
  }
  if (fingerprint && String(token.fingerprint) !== String(fingerprint)) {
    return { ok: false, reason: 'execution_token_fingerprint_mismatch', detail: { tokenFingerprint: token.fingerprint } };
  }
  if (ctxSnapshot !== undefined) {
    const expected = sha256(stableStringify(ctxSnapshot ?? null));
    if (token.ctxSnapshotHash !== expected) {
      return { ok: false, reason: 'execution_token_ctx_rewritten' };
    }
  }
  if (consumedNonces.has(token.nonce)) {
    return { ok: false, reason: 'execution_token_replayed', detail: { nonce: token.nonce } };
  }
  consumedNonces.add(token.nonce);
  return { ok: true, tokenHash: sha256(stableStringify(token)) };
}

/** observe 模式辅助：只判定不消耗（enforcement 关闭时的同构判定面）。 */
function inspectExecutionToken(input) {
  if (!input || !input.token) return { ok: false, reason: 'execution_token_invalid' };
  const probe = { ...input.token };
  const decision = verifyAndConsumeExecutionToken({ ...input, token: probe });
  if (decision.ok) {
    // inspect 不消耗：把试探 nonce 从消耗集合移除
    consumedNonces.delete(probe.nonce);
  }
  return decision;
}

/** 测试缝：清空消耗集合（进程内单次语义不跨进程）。 */
function _resetConsumedNonces() {
  consumedNonces.clear();
}

module.exports = {
  issueExecutionToken,
  verifyAndConsumeExecutionToken,
  inspectExecutionToken,
  TOKEN_VERSION,
  DEFAULT_TTL_MS,
  _resetConsumedNonces,
};
