/**
 * src/main/subframe-navigation.js — BLOCK-434/435（M5-4 接线）子框导航分级。
 *
 * 事实约束（BLOCK-168 P1-A 全参位实测）：`preventDefault` 对子框导航无效，
 * 所以这里**不假装能拦**——只把 M5 判据 `adjudicateFrameNavigation` 接成
 * 「分级 + 告警」，供 `security-hardening.js` 的三路侦测（will-frame-navigate /
 * did-frame-navigate / did-fail-load）消费。
 *
 * 改进点：此前只有登记表命中（同进程离开 gen-ui 作用域）才告警，
 * 未登记进程的不可信 http(s) 子框来源静默通过；分级后该类来源也升为劫持信号。
 */

/** 可信帧 origin 单源：复用后端判定用的同一份回环白名单（不新造第二份）。 */
function trustedFrameOrigins() {
  const { resolveCore } = require('./core-utils');
  const { trustedDesktopOrigins } = require(resolveCore('shared-backend', 'local-request-boundary'));
  return trustedDesktopOrigins();
}

/**
 * @param {string} urlText 子框即将/已经导航到的 URL
 * @returns {{kind: 'genui'|'trusted'|'hijack'|'other', origin?: string, reasonCode?: string}}
 */
function classifySubframeNavigation(urlText) {
  const text = String(urlText || '');
  if (text.startsWith('petri-genui://')) return { kind: 'genui' };
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { kind: 'other' };
  }
  // 只对真实 http(s) 来源做判定：about:blank / data: / 'null' 等不透明来源交既有 CSP 与帧策略。
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'other' };
  const { resolveCore } = require('./core-utils');
  const { adjudicateFrameNavigation } = require(resolveCore('petri-server', 'agent-tools', 'security-boundaries'));
  const verdict = adjudicateFrameNavigation({ url: text, allowlist: [...trustedFrameOrigins()] });
  return verdict.ok
    ? { kind: 'trusted', origin: verdict.origin }
    : { kind: 'hijack', reasonCode: verdict.reasonCode };
}

module.exports = {
  classifySubframeNavigation,
};
