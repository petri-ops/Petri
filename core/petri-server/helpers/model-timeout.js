'use strict';

/**
 * 上游模型调用兜底超时（UI-638 加映实机抓真）。
 *
 * /api/ai/chat 原先只在客户端断开时 abort：上游不回包时请求永不结束
 * （2026-10-30 实测 150s 零 token、零报错，界面表现为「静默挂住」）。
 * 这里只负责「到点触发一次」的定时器语义，abort/报错回调由调用方给。
 */
function armAbortTimeout({
  timeoutMs,
  abort,
  onTimeout,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return { clear() {}, fired: () => false };
  }
  let fired = false;
  const timer = setTimer(() => {
    if (fired) return;
    fired = true;
    try { abort?.(); } catch { /* abort 失败不阻断报错 */ }
    try { onTimeout?.(); } catch { /* 报错回调不反噬 */ }
  }, ms);
  return {
    clear() { clearTimer(timer); },
    fired: () => fired,
  };
}

module.exports = { armAbortTimeout };
