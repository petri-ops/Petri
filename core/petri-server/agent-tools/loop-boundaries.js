'use strict';

/**
 * M1 / BLOCK-427 — 统一资源边界族（对标 ZCode「无步数硬上限但边界族完整」之形）。
 *
 * 设计红线：
 *   - 把「无界」变成「有界收敛」，**不是**给主循环加轮次/工具次数硬上限。
 *   - 成本超限**默认软提示**（不改用户裁决）：`costCapPolicy` 显式设 `'hard'` 才硬收尾。
 *   - `cost_cap_exceeded` / `compact_*` 决策一律产出结构化事件（本地可审计、成本可计量、
 *     M4 usage 事实表可消费），不静默吞、不丢链。
 *   - provider usage 为权威 token 源，本地估算只作兜底。
 *
 * 纯新增、零依赖、零副作用；不 require 主循环、不发 IPC、不写库。
 * 与既有 `MODEL_RESULT_LIMIT`(tool-execution.js:10) / `OUTPUT_BUDGET_CEILING`
 * (agent-loop-control.js) 的关系：本模块是**可配置单入口**，既有常量由调用方作为 config
 * 传入，不并造第二份硬编码真相（接线属 M3/M6-A，不在本包提前实现）。
 */

const DEFAULT_BOUNDARIES = Object.freeze({
  toolTimeoutMs: 300000,
  maxOutputBytes: 65536,
  compactFailureLimit: 3,
  rapidRefillTokenLimit: 1000,
  costCapPolicy: 'soft',
});

/** provider usage 权威：0 / 缺失 / 非数都视为「缺席」，回落本地估算，不冒充权威。 */
function authoritativeTokenCount(reply, localEstimate) {
  const usage = reply && typeof reply === 'object' ? reply.usage : null;
  if (!usage) return Number(localEstimate) || 0;
  const candidates = [usage.total_tokens, usage.totalTokens];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return Number(localEstimate) || 0;
}

function createBoundaryGuard({ config = {}, onEvent } = {}) {
  const limits = { ...DEFAULT_BOUNDARIES, ...config };
  const events = [];
  let consecutiveCompactFailures = 0;
  let rapidRefill = false;
  const emit = typeof onEvent === 'function' ? onEvent : null;

  const push = (type, detail) => {
    const event = Object.freeze({
      seq: events.length + 1,
      type,
      at: new Date().toISOString(),
      ...detail,
    });
    events.push(event);
    if (emit) emit(event);
    return event;
  };

  /** compact 双熔断之一：连续失败熔断；之二：压缩后快速回填熔断。 */
  const recordCompactResult = ({ ok, tokensAfter, reason } = {}) => {
    if (ok) {
      consecutiveCompactFailures = 0;
      const after = Number(tokensAfter);
      if (Number.isFinite(after) && after > Number(limits.rapidRefillTokenLimit)) {
        rapidRefill = true;
        push('compact_rapid_refill_tripped', { tokensAfter: after, limit: limits.rapidRefillTokenLimit });
      }
      return { circuitBroken: shouldCircuitBreak() };
    }
    consecutiveCompactFailures += 1;
    push('compact_failed', { consecutive: consecutiveCompactFailures, reason: String(reason || '') });
    if (consecutiveCompactFailures >= Number(limits.compactFailureLimit)) {
      push('compact_consecutive_failure_tripped', { consecutive: consecutiveCompactFailures });
    }
    return { circuitBroken: shouldCircuitBreak() };
  };

  const shouldCircuitBreak = () =>
    consecutiveCompactFailures >= Number(limits.compactFailureLimit) || rapidRefill;

  /** 默认软提示：只有显式 hard 才 stop；两种策略都产出 cost_cap_exceeded 事件链。 */
  const adjudicateCost = ({ spentCny } = {}) => {
    const capCny = Number(limits.costCapCny);
    const spent = Number(spentCny);
    if (!Number.isFinite(capCny) || !Number.isFinite(spent) || spent < capCny) {
      return { exceeded: false, stop: false, capCny, spentCny: spent };
    }
    const hard = limits.costCapPolicy === 'hard';
    push('cost_cap_exceeded', { capCny, spentCny: spent, policy: limits.costCapPolicy });
    return { exceeded: true, stop: hard, capCny, spentCny: spent, policy: limits.costCapPolicy };
  };

  /** 工具超时 / 输出预算统一判定（单入口，不散落硬编码）。 */
  const isToolBoundaryExceeded = ({ elapsedMs, outputBytes } = {}) => {
    const elapsed = Number(elapsedMs);
    const bytes = Number(outputBytes);
    if (Number.isFinite(elapsed) && elapsed > Number(limits.toolTimeoutMs)) {
      push('tool_timeout_exceeded', { elapsedMs: elapsed, limit: limits.toolTimeoutMs });
      return { exceeded: true, code: 'TOOL_TIMEOUT_EXCEEDED' };
    }
    if (Number.isFinite(bytes) && bytes > Number(limits.maxOutputBytes)) {
      push('tool_output_budget_exceeded', { outputBytes: bytes, limit: limits.maxOutputBytes });
      return { exceeded: true, code: 'TOOL_OUTPUT_BUDGET_EXCEEDED' };
    }
    return { exceeded: false, code: null };
  };

  const resolveToolBudget = () => Object.freeze({
    timeoutMs: Number(limits.toolTimeoutMs),
    maxOutputBytes: Number(limits.maxOutputBytes),
    source: 'loop-boundaries.js:DEFAULT_BOUNDARIES + config',
  });

  return {
    limits,
    events,
    authoritativeTokenCount,
    recordCompactResult,
    shouldCircuitBreak,
    adjudicateCost,
    isToolBoundaryExceeded,
    resolveToolBudget,
  };
}

module.exports = {
  DEFAULT_BOUNDARIES,
  authoritativeTokenCount,
  createBoundaryGuard,
};
