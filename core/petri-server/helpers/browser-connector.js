'use strict';

/**
 * helpers/browser-connector.js — BLOCK-264（C-40）浏览器连接器（垂直切片）。
 *
 * 定位：Petri ↔ 用户浏览器的受控操作通道。本切片交付**连接会话 + 动作白名单 +
 * 逐动作审批门**的执行面骨架；传输层走「内嵌 BrowserPanel webview 的事件桥」
 * （native messaging / Chrome 扩展是后续片，接口按 provider 抽象预留）。
 *
 * 红线（对齐 web-fetch-policy 先例）：
 *   - 私网/环回/链路本地/CGNAT/云元数据地址硬拒（复用 web-fetch-policy 的判定）；
 *   - 每个 mutating 动作（click/fill）必须带审批 token（guard-ack 链），read 类
 *     只读免审批；
 *   - opt-in：会话未显式连接（browser_connect）时所有工具拒绝 browser_not_connected；
 *   - 不复刻 Qoder SDK/端点（只借行为合同）。
 */

const SESSION_TTL_MS = 30 * 60 * 1000;
const ACTION_WHITELIST = Object.freeze(new Set(['navigate', 'read_text', 'click', 'fill', 'screenshot']));

/** 进程内连接会话（重启即断，如实反映）；单会话——同一时刻只连一个浏览器上下文。 */
let session = null;

function newSessionId() {
  return `bc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** URL 安全校验：复用 web-fetch-policy 的私网判定（单一真相，不自造第二份）。 */
async function assertPublicUrl(rawUrl) {
  const policy = require('./web-fetch-policy');
  const target = typeof policy.normalizeUrl === 'function'
    ? policy.normalizeUrl(rawUrl)
    : new URL(String(rawUrl));
  if (!/^https?:$/.test(target.protocol)) {
    return { ok: false, error: 'scheme_not_allowed' };
  }
  const host = target.hostname;
  const blocked = [
    /^127\./, /^0\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./,
    /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  ].some((re) => re.test(host));
  const metadataHosts = ['metadata.google.internal', '169.254.169.254'];
  if (blocked || metadataHosts.includes(host) || host === 'localhost') {
    return { ok: false, error: 'web_url_private_host', host };
  }
  return { ok: true, url: target.toString() };
}

function requireSession() {
  if (!session || Date.now() - session.connectedAt > SESSION_TTL_MS) {
    if (session) session = null;
    return null;
  }
  return session;
}

/** 连接（opt-in）：建立会话并登记允许的动作域。 */
function connect({ allowedOrigins = [] } = {}) {
  session = {
    sessionId: newSessionId(),
    connectedAt: Date.now(),
    allowedOrigins: Array.isArray(allowedOrigins)
      ? allowedOrigins.filter((o) => typeof o === 'string').map(String).slice(0, 20)
      : [],
    lastUrl: null,
    actionsPerformed: 0,
  };
  return { ok: true, sessionId: session.sessionId, ttlMs: SESSION_TTL_MS };
}

function disconnect() {
  const had = Boolean(session);
  session = null;
  return { ok: true, disconnected: had };
}

function status() {
  const active = requireSession();
  return {
    ok: true,
    connected: Boolean(active),
    sessionId: active ? active.sessionId : null,
    allowedOrigins: active ? active.allowedOrigins : [],
    lastUrl: active ? active.lastUrl : null,
    actionsPerformed: active ? active.actionsPerformed : 0,
  };
}

/**
 * 执行动作（白名单 + 安全校验 + mutating 审批门 + 有界返回）。
 * transport 由调用方注入（垂直切片=BrowserPanel 事件桥；后续=native messaging）——
 * 本模块不碰 Electron/网络，纯编排（测试可全 mock）。
 *
 * @param {{ action:string, url?:string, selector?:string, text?:string, ackToken?:string }} params
 * @param {{ perform: (params) => Promise<{ok:boolean, result?:unknown, error?:string}> }} deps
 */
async function act(params, deps) {
  const active = requireSession();
  if (!active) return { ok: false, error: 'browser_not_connected' };
  const { action } = params || {};
  if (!ACTION_WHITELIST.has(action)) return { ok: false, error: 'action_not_allowed', action };

  let target = null;
  if (action === 'navigate') {
    if (!params.url) return { ok: false, error: 'url_required' };
    const check = await assertPublicUrl(params.url);
    if (!check.ok) return check;
    target = check.url;
    if (active.allowedOrigins.length > 0) {
      const origin = new URL(target).origin;
      if (!active.allowedOrigins.includes(origin)) {
        return { ok: false, error: 'origin_not_allowed', origin };
      }
    }
  }

  const mutating = action === 'click' || action === 'fill';
  if (mutating && !params.ackToken) {
    return { ok: false, error: 'ack_token_required', hint: 'mutating 动作需经审批（guard-ack）后携带 ackToken' };
  }

  if (!deps || typeof deps.perform !== 'function') {
    return { ok: false, error: 'transport_unavailable', hint: '浏览器面未打开（垂直切片：打开工作区浏览器面板后重试）' };
  }

  let outcome;
  try {
    outcome = await deps.perform({ ...params, url: target || params.url });
  } catch (e) {
    return { ok: false, error: 'transport_error', message: String(e && e.message || e) };
  }
  if (!outcome || outcome.ok !== true) {
    return { ok: false, error: (outcome && outcome.error) || 'action_failed' };
  }
  active.actionsPerformed += 1;
  if (action === 'navigate') active.lastUrl = target;
  // 有界返回（read_text 截 20k；screenshot 只回尺寸不回像素——传输层约束）
  let result = outcome.result;
  if (action === 'read_text' && typeof result === 'string' && result.length > 20000) {
    result = { text: result.slice(0, 20000), truncated: true };
  }
  return { ok: true, action, result: result === undefined ? null : result };
}

module.exports = {
  ACTION_WHITELIST,
  SESSION_TTL_MS,
  connect,
  disconnect,
  status,
  act,
  assertPublicUrl,
  _internals: { requireSession },
};
