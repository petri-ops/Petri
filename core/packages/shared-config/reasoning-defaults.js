'use strict';

/**
 * reasoning-defaults.js — 推理档位词表与「中性档位 → 上游实参」映射的**数据单源**（BLOCK-200 P2）。
 *
 * 为什么把表抽到这里而不是留在 `thinking-level.js`：P0-5 要让用户能改档位默认值、
 * Anthropic 预算与逐协议映射，而设置面（`core/petri-server`）与映射点（`core/shared-backend`）
 * 分属两层——`shared-backend` 不能反向 require `petri-server`（架构方向红线），
 * 所以两侧都只认这份 `core/packages/**` 合法共享层的表。
 *
 * **默认值逐字等于迁移前 `thinking-level.js:38/41/44/73-85` 的硬编码**（D-1 敏感项最保守），
 * 由 `test/block200-thinking-baseline.test.mjs`（拆前基线，已冻结）与
 * `test/block200-reasoning-mapping.test.mjs` 双向钉住。
 *
 * 纯函数、零 require、零第三方。
 */

const THINKING_LEVELS = Object.freeze(['off', 'standard', 'high']);
const DEFAULT_THINKING_LEVEL = 'standard';
const ANTHROPIC_HIGH_BUDGET_TOKENS = 16000;

/**
 * 映射令牌 = 「发什么」的最小可声明单位；展开成实参形状由协议决定（见 `expandToken`）。
 * `none`=不发任何参数（标准档的默认，也是"这个档位这条协议我不表态"的诚实表达）。
 */
const DEFAULT_MAPPING = Object.freeze({
  'openai-compatible': Object.freeze({ off: 'reasoning_effort:minimal', standard: 'none', high: 'reasoning_effort:high' }),
  'anthropic-messages': Object.freeze({ off: 'thinking:disabled', standard: 'none', high: 'thinking:enabled' }),
  'dashscope-native': Object.freeze({ off: 'enable_thinking:false', standard: 'none', high: 'enable_thinking:true' }),
});

/** 每个协议允许的令牌集合（写侧据此拒"给 openai 配 thinking:enabled"这类跨协议错配）。 */
const KNOWN_PARAMS = Object.freeze({
  'openai-compatible': Object.freeze(['none', 'reasoning_effort:minimal', 'reasoning_effort:low', 'reasoning_effort:medium', 'reasoning_effort:high']),
  'anthropic-messages': Object.freeze(['none', 'thinking:disabled', 'thinking:enabled']),
  'dashscope-native': Object.freeze(['none', 'enable_thinking:true', 'enable_thinking:false']),
});

function isKnownProtocol(protocol) {
  return Object.prototype.hasOwnProperty.call(DEFAULT_MAPPING, protocol);
}

function allowedTokens(protocol) {
  return KNOWN_PARAMS[protocol] || [];
}

/** 令牌是否该协议的合法选择（未知协议一律拒——宁可不支持，也不猜参数名）。 */
function isAllowedToken(protocol, token) {
  return allowedTokens(protocol).includes(token);
}

/**
 * 令牌 → 上游请求参数片段。`{}`=不发参数。
 * @param {string} token 形如 `reasoning_effort:high` / `thinking:enabled` / `none`
 * @param {{budgetTokens?: number}} [options] anthropic `thinking:enabled` 的预算
 */
function expandToken(token, options = {}) {
  if (!token || token === 'none') return {};
  const separator = token.indexOf(':');
  const param = separator >= 0 ? token.slice(0, separator) : token;
  const rawValue = separator >= 0 ? token.slice(separator + 1) : '';
  if (param === 'reasoning_effort') return { reasoning_effort: rawValue };
  if (param === 'enable_thinking') return { enable_thinking: rawValue === 'true' };
  if (param === 'thinking') {
    if (rawValue === 'disabled') return { thinking: { type: 'disabled' } };
    const budget = Number.isFinite(options.budgetTokens) ? options.budgetTokens : ANTHROPIC_HIGH_BUDGET_TOKENS;
    return { thinking: { type: 'enabled', budget_tokens: budget } };
  }
  // 未知参数名：不发（映射表被改坏时静默降级为"不表态"，比发一个上游必 400 的键安全）
  return {};
}

/** 深合并用户覆盖到默认表：只接受 `已知协议/已知档位/允许令牌` 三重命中的项。 */
function mergeMapping(overrides) {
  const merged = {};
  for (const [protocol, tiers] of Object.entries(DEFAULT_MAPPING)) {
    merged[protocol] = { ...tiers };
  }
  if (!overrides || typeof overrides !== 'object') return merged;
  for (const [protocol, tiers] of Object.entries(overrides)) {
    if (!isKnownProtocol(protocol) || !tiers || typeof tiers !== 'object') continue;
    for (const [tier, token] of Object.entries(tiers)) {
      if (!THINKING_LEVELS.includes(tier)) continue;
      if (!isAllowedToken(protocol, token)) continue;
      merged[protocol][tier] = token;
    }
  }
  return merged;
}

module.exports = {
  THINKING_LEVELS,
  DEFAULT_THINKING_LEVEL,
  ANTHROPIC_HIGH_BUDGET_TOKENS,
  DEFAULT_MAPPING,
  KNOWN_PARAMS,
  isKnownProtocol,
  allowedTokens,
  isAllowedToken,
  expandToken,
  mergeMapping,
};
