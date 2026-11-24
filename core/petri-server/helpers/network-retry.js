'use strict';

/**
 * BLOCK-511 S1.1 — 网络瞬断重试的纯重试包装（从 loop-orchestrator 抽出）。
 *
 * 原实现只负责「重试调用」；本模块新增可选 onBeforeRetry(retryIndex) 钩子：
 * 每次瞬断重试真正重发前调用一次，供调用方装载 BLOCK-508 同款重放过滤器，
 * 避免首连已下发的半截正文在重连完整重发时被重复追加下发。
 * 无下发时调用方不装载过滤器，行为与抽离前完全一致。
 */
const TRANSIENT_NETWORK_ERROR = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|network/i;

async function callProviderWithNetworkRetry(
  fn,
  { retries = 2, baseDelayMs = 3000, log = () => {}, isAborted = () => false, onBeforeRetry = null } = {}
) {
  let lastErr;
  for (let retry = 0; retry <= retries; retry++) {
    if (retry > 0) {
      if (isAborted()) throw lastErr;
      const delay = baseDelayMs * retry;
      log(`模型连接瞬断，${Math.round(delay / 1000)}s 后自动重试（${retry}/${retries}）`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (isAborted()) throw lastErr;
      if (typeof onBeforeRetry === 'function') onBeforeRetry(retry);
    }
    try {
      return await fn();
    } catch (error) {
      lastErr = error;
      const msg = String((error && error.message) || error);
      if (retry === retries || !TRANSIENT_NETWORK_ERROR.test(msg)) throw error;
      log(`[network-retry] transient model call failure (${msg.slice(0, 140)}), retry ${retry + 1}/${retries}`);
    }
  }
  throw lastErr;
}

module.exports = { callProviderWithNetworkRetry, TRANSIENT_NETWORK_ERROR };
