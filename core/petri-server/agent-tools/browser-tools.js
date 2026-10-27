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

async function browser_act(args = {}) {
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
