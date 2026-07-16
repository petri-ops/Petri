/** Reliability primitives adapted from api-failover-proxy (MIT). */

function shouldRetry(status, error) {
  if (error) return true;
  return status === 0 || status === 429 || status >= 500;
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
