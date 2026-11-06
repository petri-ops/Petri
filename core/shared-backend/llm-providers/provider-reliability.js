/** Reliability primitives adapted from api-failover-proxy (MIT). */

// BLOCK-366（NSO-W5b）重试分类单源：委托网关 isRetryableProviderError（评估 F-23——
// 此处原自持一套 `0|429|>=500` 阈值，与网关 408/409/425/429/5xx 双源漂移）。
// 网络层异常（error 传参）恒可重试的语义保持。
const { isRetryableProviderError } = require('./model-gateway');
function shouldRetry(status, error) {
  if (error) return true;
  // status 0 = 无响应（网络层失败），按网络错误判定；其余带上 http_error 码交网关按状态码分类
  // （网关对无错误码的结果一律判不可重试，裸 { status } 会被误判——契约以绝对期望值钉住）。
  if (!status) return isRetryableProviderError({ error: 'network_error' });
  return isRetryableProviderError({ error: 'http_error', status });
}

class CircuitBreaker {
  constructor({ failThreshold = 5, cooldownMs = 60000, now = () => Date.now() } = {}) {
    this.failThreshold = failThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.state = new Map();
  }

  isOpen(key) {
    const entry = this.state.get(key);
    if (!entry) return false;
    if (entry.openUntil && this.now() < entry.openUntil) return true;
    if (entry.openUntil) this.state.set(key, { failures: 0, openUntil: 0 });
    return false;
  }

  recordFailure(key) {
    const entry = this.state.get(key) || { failures: 0, openUntil: 0 };
    entry.failures += 1;
    if (!entry.openUntil && entry.failures >= this.failThreshold) {
      entry.openUntil = this.now() + this.cooldownMs;
    }
    this.state.set(key, entry);
  }

  recordSuccess(key) {
    this.state.delete(key);
  }

  snapshot(key) {
    const entry = this.state.get(key) || { failures: 0, openUntil: 0 };
    return { failures: entry.failures, open: this.isOpen(key), openUntil: entry.openUntil };
  }
}

module.exports = { shouldRetry, CircuitBreaker };
