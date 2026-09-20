/**
 * LLM Circuit Breaker — wraps callChatProvider with fault-tolerance.
 *
 * State machine:
 *   CLOSED → OPEN → HALF_OPEN → CLOSED (success) / OPEN (failure)
 *
 * Configuration:
 *   failureThreshold: 5  (consecutive failures to trip the breaker)
 *   recoveryTimeout: 60000 (1 minute before trying half-open)
 *   halfOpenMaxCalls: 3  (test requests allowed in half-open state)
 *
 * Usage:
 *   const { wrapChatProvider, llmCircuitBreaker, getBreakerHealth } = require('./circuit-breaker');
 *   const wrappedProvider = wrapChatProvider(callChatProvider);
 *   const result = await wrappedProvider(providerName, apiKey, body, telemetry, onEvent, options);
 */

const { CircuitBreaker: BaseCircuitBreaker } = require('./provider-reliability');
const logger = require('../../shared-backend/logger');

const STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

const DEFAULT_OPTIONS = {
  failureThreshold: 5,
  recoveryTimeout: 60000,
  halfOpenMaxCalls: 3,
};

class LLMCircuitBreaker extends BaseCircuitBreaker {
  constructor(options = {}) {
    super({
      failThreshold: options.failureThreshold || DEFAULT_OPTIONS.failureThreshold,
      cooldownMs: options.recoveryTimeout || DEFAULT_OPTIONS.recoveryTimeout,
    });

    this.halfOpenMaxCalls = options.halfOpenMaxCalls || DEFAULT_OPTIONS.halfOpenMaxCalls;
    this._halfOpenCalls = new Map();
    this._providerStats = new Map();
  }

  isOpen(key) {
    const entry = this.state.get(key);
    if (!entry) return false;

    const now = this.now();

    if (entry.state === STATES.HALF_OPEN) {
      const halfOpenCount = this._halfOpenCalls.get(key) || 0;
      if (halfOpenCount >= this.halfOpenMaxCalls) return true;
      return false;
    }

    if (entry.openUntil && now < entry.openUntil) return true;
    if (entry.openUntil) {
      this.state.set(key, {
        failures: 0,
        openUntil: 0,
        state: STATES.HALF_OPEN,
        halfOpenSuccesses: 0,
      });
      this._halfOpenCalls.set(key, 0);
      logger.info(`[circuit-breaker] HALF_OPEN: ${key} — recovery timeout elapsed, allowing test calls`);
    }
    return false;
  }

  /**
   * @returns {string} current state: CLOSED | OPEN | HALF_OPEN
   */
  getState(key) {
    const entry = this.state.get(key);
    if (!entry) return STATES.CLOSED;
    if (entry.openUntil && this.now() < entry.openUntil) return STATES.OPEN;
    if (entry.state === STATES.HALF_OPEN) return STATES.HALF_OPEN;
    return STATES.CLOSED;
  }

  recordFailure(key) {
    const entry = this.state.get(key) || { failures: 0, openUntil: 0, state: STATES.CLOSED };

    entry.failures += 1;

    if (entry.state === STATES.HALF_OPEN) {
      entry.openUntil = this.now() + this.cooldownMs;
      entry.state = STATES.OPEN;
      this._halfOpenCalls.set(key, 0);
      logger.warn(`[circuit-breaker] HALF_OPEN failure → OPEN: ${key} (failures: ${entry.failures})`);
      this.state.set(key, entry);
      return;
    }

    if (entry.failures >= this.failThreshold) {
      entry.openUntil = this.now() + this.cooldownMs;
      entry.state = STATES.OPEN;
      logger.warn(`[circuit-breaker] OPEN: ${key} — failure threshold reached (${entry.failures}/${this.failThreshold})`);
    }

    this.state.set(key, entry);
    this._updateStats(key, 'failure');
  }

  recordSuccess(key) {
    const entry = this.state.get(key);

    if (entry && entry.state === STATES.HALF_OPEN) {
      entry.halfOpenSuccesses = (entry.halfOpenSuccesses || 0) + 1;
      if (entry.halfOpenSuccesses >= this.halfOpenMaxCalls) {
        this.state.delete(key);
        this._halfOpenCalls.delete(key);
        logger.info(`[circuit-breaker] CLOSED: ${key} — recovery successful (${entry.halfOpenSuccesses} consecutive successes)`);
        this._updateStats(key, 'recovery');
        return;
      }
      this.state.set(key, entry);
      this._updateStats(key, 'success');
      return;
    }

    this.state.delete(key);
    this._updateStats(key, 'success');
  }

  _updateStats(key, event) {
    if (!this._providerStats.has(key)) {
      this._providerStats.set(key, { totalCalls: 0, successes: 0, failures: 0, recoveries: 0 });
    }
    const stats = this._providerStats.get(key);
    stats.totalCalls += 1;
    if (event === 'success') stats.successes += 1;
    else if (event === 'failure') stats.failures += 1;
    else if (event === 'recovery') stats.recoveries += 1;
  }

  recordCallStart(key) {
    const count = (this._halfOpenCalls.get(key) || 0) + 1;
    this._halfOpenCalls.set(key, count);
  }

  /**
   * Get health status for a specific provider or all providers.
   * @param {string|undefined} key - provider key, or undefined for all
   * @returns {object} health status
   */
  getHealth(key) {
    if (key) {
      const entry = this.state.get(key);
      const stats = this._providerStats.get(key);
      const state = this.getState(key);
      const failureRate = stats && stats.totalCalls > 0 ? stats.failures / stats.totalCalls : 0;
      return {
        provider: key,
        state,
        failures: entry ? entry.failures : 0,
        failureThreshold: this.failThreshold,
        recoveryTimeout: this.cooldownMs,
        halfOpenMaxCalls: this.halfOpenMaxCalls,
        halfOpenSuccesses: entry ? entry.halfOpenSuccesses : 0,
        halfOpenCallCount: this._halfOpenCalls.get(key) || 0,
        openUntil: entry && entry.openUntil ? entry.openUntil : null,
        stats: stats || null,
        failureRate: parseFloat(failureRate.toFixed(4)),
        healthy: state === STATES.CLOSED,
      };
    }

    const all = {};
    for (const [k] of this.state) {
      all[k] = this.getHealth(k);
    }
    for (const [k, v] of this._providerStats) {
      if (!all[k]) {
        all[k] = {
          provider: k,
          state: STATES.CLOSED,
          failures: 0,
          failureThreshold: this.failThreshold,
          recoveryTimeout: this.cooldownMs,
          halfOpenMaxCalls: this.halfOpenMaxCalls,
          halfOpenSuccesses: 0,
          halfOpenCallCount: 0,
          openUntil: null,
          stats: v,
          failureRate: parseFloat(((v.failures || 0) / (v.totalCalls || 1)).toFixed(4)),
          healthy: true,
        };
      }
    }
    return all;
  }

  /**
   * Reset circuit breaker state for a specific provider.
   * @param {string} key - provider key
   */
  reset(key) {
    this.state.delete(key);
    this._halfOpenCalls.delete(key);
    logger.info(`[circuit-breaker] Reset: ${key}`);
  }

  /**
   * Reset all circuit breaker state.
   */
  resetAll() {
    this.state.clear();
    this._halfOpenCalls.clear();
    this._providerStats.clear();
    logger.info('[circuit-breaker] All circuits reset');
  }
}

const llmCircuitBreaker = new LLMCircuitBreaker(DEFAULT_OPTIONS);

function wrapChatProvider(chatProviderFn, breakerOptions) {
  const breaker = breakerOptions instanceof LLMCircuitBreaker ? breakerOptions : new LLMCircuitBreaker(breakerOptions);

  return async function wrappedChatProvider(providerName, apiKey, body, telemetry, onEvent, options) {
    const key = providerName || 'default';

    if (breaker.isOpen(key)) {
      const state = breaker.getState(key);
      logger.warn(`[circuit-breaker] Service unavailable: ${key} (state: ${state})`);

      const err = new Error(`AI 服务暂时不可用 (${key})`);
      err.name = 'ServiceUnavailable';
      err.code = 'CIRCUIT_OPEN';
      err.provider = key;
      err.state = state;
      err.retryAfter = breakerOptions?.recoveryTimeout || DEFAULT_OPTIONS.recoveryTimeout;

      throw err;
    }

    breaker.recordCallStart(key);

    try {
      const result = await chatProviderFn(providerName, apiKey, body, telemetry, onEvent, options);

      if (result && result.error) {
        breaker.recordFailure(key);
        const err = new Error(result.message || `AI 服务调用失败 (${key})`);
        err.name = 'ServiceUnavailable';
        err.code = result.error || 'PROVIDER_ERROR';
        err.provider = key;
        throw err;
      }

      breaker.recordSuccess(key);
      return result;
    } catch (err) {
      if (err.name === 'ServiceUnavailable' && err.code === 'CIRCUIT_OPEN') {
        throw err;
      }
      breaker.recordFailure(key);
      throw err;
    }
  };
}

function getBreakerHealth(providerName) {
  return llmCircuitBreaker.getHealth(providerName);
}

function resetBreaker(key) {
  if (key) {
    llmCircuitBreaker.reset(key);
  } else {
    llmCircuitBreaker.resetAll();
  }
}

module.exports = {
  LLMCircuitBreaker,
  llmCircuitBreaker,
  wrapChatProvider,
  getBreakerHealth,
  resetBreaker,
  STATES,
  DEFAULT_OPTIONS,
};
