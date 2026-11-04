'use strict';

/**
 * agent-tools/browser-tools.js — BLOCK-264（C-40）browser_connect/act/status/disconnect 执行面。
 *
 * 会话/白名单/审批门全在 helpers/browser-connector.js（纯编排，测试单测覆盖）；
 * 本模块做工具签名适配 + transport 桥接。
 *
 * BLOCK-269（C-40 尾项）— transport 接线：动作经 event-bus SSE 下发给打开中的
 * BrowserPanel（webview 执行），结果经 POST /api/browser-connector/action-result
 * 回传 resolve。面板未打开/未回传 = 25s 超时如实失败（不假装操作成功）。
 */

const connector = require('../helpers/browser-connector');
const eventBus = require('../helpers/event-bus');

/** pending 动作（actionId → resolve）；进程内，重启即清（如实反映）。 */
const pendingActions = new Map();
const PERFORM_TIMEOUT_MS = 25_000;

/**
 * BLOCK-269 transport：动作下发 + 回传 resolve。
 * 超时/面板离线 → transport_timeout（connector 归一为 transport_error 家族）。
 */
function _createTransport(timeoutMs = PERFORM_TIMEOUT_MS) {
  return {
    timeoutMs,
    async perform(params) {
      const actionId = `ba-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const promise = new Promise((resolve) => {
        pendingActions.set(actionId, { resolve, params });
      });
      const timer = setTimeout(() => {
        const entry = pendingActions.get(actionId);
        if (entry) {
          pendingActions.delete(actionId);
          entry.resolve({ ok: false, error: 'transport_timeout', message: `浏览器面板未在 ${timeoutMs / 1000}s 内回传结果（面板可能未打开）` });
        }
      }, timeoutMs);
      if (timer.unref) timer.unref();
      eventBus.publishInvalidation('browser-connector', { kind: 'browser-action', actionId, params });
      try {
        return await promise;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function currentTransport() {
  return _createTransport();
}

/** routes 回传面：resolve 一个 pending 动作。未知 actionId 返回 false（路由层 404）。 */
function resolveBrowserAction(actionId, outcome) {
  const entry = pendingActions.get(actionId);
  if (!entry) return false;
  pendingActions.delete(actionId);
  if (outcome && outcome.ok === true) {
    entry.resolve({ ok: true, result: outcome.result });
  } else {
    entry.resolve({ ok: false, error: (outcome && outcome.error) || 'action_failed', message: outcome && outcome.message });
  }
  return true;
}

/** 测试/诊断：在途动作数。 */
function pendingCount() {
  return pendingActions.size;
}

async function browser_connect(args = {}) {
  const allowed = Array.isArray(args.allowedOrigins) ? args.allowedOrigins : [];
  return connector.connect({ allowedOrigins: allowed });
}

// BLOCK-346 T1 — 写动作（click/fill）两段式审批。
// 历史缺陷：connector 硬门要求 ackToken（helpers/browser-connector.js mutating 分支），
// 但全仓无任何签发路径 → 浏览器写操作恒 ack_token_required，且因契约 sideEffect=
// external-request 被判非 mutating，policy 也不会弹审批。此处复用 computer_* 的
// 同一套协议（同 tool_jobs 表 / 同 ackToken 语义），只对 mutating 动作设门。
const BROWSER_MUTATING_ACTIONS = new Set(['click', 'fill']);

async function browser_act(args = {}, ctx = {}) {
  const action = String(args.action || '');
  // 只在「agent 工具调用」语义下设审批门（有 ctx 身份）；REST 直调面
  // （/api/browser-connector/act，面板/实机 flow 用）保持原语义：调用方自带 ackToken，
  // 由 connector 层校验存在性——它不承担签发职责，也不应在无 DB 环境触库。
  const isAgentCall = Boolean(ctx && (ctx.userId || ctx.conversationId));
  if (BROWSER_MUTATING_ACTIONS.has(action) && isAgentCall) {
    // 惰性 require：模块加载期不得绑定 DB（测试/工具脚本可无 schema）；只读动作完全不触库
    const { ensureControlConfirmation } = require('./computer-use-tools');
    const dbMod = require('../db');
    const gate = ensureControlConfirmation(args, ctx, {
      toolId: 'browser_act',
      summary: `浏览器 ${action}${args.selector ? ` ${String(args.selector)}` : ''}`,
    });
    if (gate.denial) return gate.denial;
    if (gate.needApproval) return gate.needApproval;
    const result = await connector.act(args, currentTransport());
    if (gate.jobId) {
      try {
        dbMod.updateToolJob(gate.jobId, {
          status: result && result.ok === false ? 'failed' : 'done',
          resultJson: result,
          completedAt: new Date().toISOString(),
          error: result && result.ok === false ? (result.error || 'failed') : null,
        });
      } catch { /* 审计回写失败不影响结果返回 */ }
    }
    return result;
  }
  return connector.act(args, currentTransport());
}

async function browser_status() {
  return connector.status();
}

async function browser_disconnect() {
  return connector.disconnect();
}

module.exports = {
  browser_connect,
  browser_act,
  browser_status,
  browser_disconnect,
  resolveBrowserAction,
  pendingCount,
  PERFORM_TIMEOUT_MS,
  _createTransport,
};
