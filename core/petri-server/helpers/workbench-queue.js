'use strict';

/**
 * item88 第二波：调度队列的机械层纯函数（设计稿 §4.2③）。
 * 不引入第二执行器：只做排序与重试决策，并发仍走 runtime.js 的 acquire/release。
 */

const { RETRY_POLICY } = require('../agent-task-store');

function rankQueueTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .slice()
    .sort((a, b) => {
      const priority = (Number(b && b.priority) || 0) - (Number(a && a.priority) || 0);
      if (priority !== 0) return priority;
      return String((a && a.created_at) || '').localeCompare(String((b && b.created_at) || ''));
    });
}

function computeRetryDecision({ retryCount = 0, errorType = 'internal_error', rng = Math.random } = {}) {
  const policy = RETRY_POLICY[errorType] || RETRY_POLICY.internal_error;
  if (retryCount >= policy.maxRetries) return { action: 'failed', attempt: retryCount };
  const base = policy.backoff === 'exponential'
    ? (policy.baseDelay || 1000) * (2 ** retryCount)
    : (policy.delay || policy.baseDelay || 1000);
  const factor = 0.75 + (Number(rng()) || 0) * 0.5;
  return { action: 'retry', attempt: retryCount + 1, delayMs: Math.round(base * factor) };
}

module.exports = { rankQueueTasks, computeRetryDecision };
