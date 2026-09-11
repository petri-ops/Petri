/**
 * thinking-level.js — BLOCK-81 P1：思考档位 → 上游请求参数的**单一映射点**。
 *
 * 背景（plan §2 调研结论）：思考级别不是模型「显示」出来的，而是客户端控件 +
 * 请求参数映射。各上游参数形状不一，本模块是唯一的映射真相源，调用方只表达
 * 中性档位（`off | standard | high`），不认识任何供应商参数名。
 *
 * 档位语义（BLOCK-81 D1 用户裁决）：
 *   - `standard`（默认）= **不发任何参数**——保证「不选就该怎样还怎样」零行为变化；
 *   - `high`           = 发最强调参数；
 *   - `off`            = 发最弱/显式关闭参数（协议无真「关闭」时的诚实降级见下）。
 *
 * 协议映射（按 profile.protocol，而非供应商名——协议是我们能可靠知道的）：
 *   | protocol            | off                | high                                        |
 *   |---------------------|--------------------|---------------------------------------------|
 *   | openai-compatible   | reasoning_effort:minimal | reasoning_effort:high                  |
 *   | anthropic-messages  | thinking:{type:disabled} | thinking:{type:enabled,budget_tokens} |
 *   | dashscope-native    | enable_thinking:false    | enable_thinking:true                  |
 *
 * 诚实边界：
 *   1. OpenAI 兼容协议**没有真正的「关闭思考」**——`reasoning_effort` 最小档是
 *      `minimal`（发 `low` 会比用户预期「更想」；发 `minimal` 在旧网关可能 400，
 *      由 D3 的去参重试兜底）。故 `off` 映射为 `minimal` 而非 `low`。
 *   2. GLM 系（`thinking:{type}` 形状）经 OpenAI 兼容协议接入时，本模块**无法**从
 *      协议层面识别 → 会发 `reasoning_effort` 而被上游 400 → D3 去参重试一次后
 *      正常工作（代价：一次多余往返）。要根治需渠道级「思考参数形状」声明，
 *      登记为后续候选（见 plan §4 D2 备注）。
 *   3. DeepSeek 官方无思考参数（`deepseek-reasoner` 是独立模型）→ 该渠道不应声明
 *      `reasoning` 能力位；即便声明，`openai-compatible` 映射发参也会被 400 兜底。
 *
 * 能力门控（D3 双保险之一）：仅当 profile 声明 `capabilities` 含 `reasoning`
 * 时才发参——未声明的渠道行为与今天完全一致。
 */

'use strict';

/** 中性档位集合（UI 与后端共用词表）。 */
const THINKING_LEVELS = Object.freeze(['off', 'standard', 'high']);

/** 默认档位：标准 = 不发参数（零行为变化，D1 裁决）。 */
const DEFAULT_THINKING_LEVEL = 'standard';

/** Anthropic 思考预算（high 档）；Anthropic 要求 budget_tokens ≥ 1024。 */
const ANTHROPIC_HIGH_BUDGET_TOKENS = 16000;

/**
 * 归一化外部传入的档位：非法/缺失 → null（调用方据此不发参）。
 * @param {unknown} value
 * @returns {'off'|'standard'|'high'|null}
 */
function normalizeThinkingLevel(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return THINKING_LEVELS.includes(v) ? v : null;
}

/**
 * 中性档位 → 上游请求参数（单一映射点）。
 *
 * @param {object} input
 * @param {unknown} input.level        中性档位（off/standard/high）
 * @param {string} [input.protocol]    profile.protocol（openai-compatible | anthropic-messages | dashscope-native）
 * @param {string[]} [input.capabilities] profile.capabilities（须含 'reasoning' 才发参）
 * @returns {Record<string, unknown>}  待合并进请求体的参数；{} = 不发任何参数
 */
function thinkingParamsFor({ level, protocol, capabilities } = {}) {
  const normalized = normalizeThinkingLevel(level);
  // 未指定或标准档 → 不发参数（默认行为零变化）
  if (!normalized || normalized === DEFAULT_THINKING_LEVEL) return {};
  // 能力门控：未声明 reasoning 的渠道一律不发（避免给不支持的上游发未知参数）
  if (!Array.isArray(capabilities) || !capabilities.includes('reasoning')) return {};

  switch (protocol) {
    case 'openai-compatible':
      return { reasoning_effort: normalized === 'high' ? 'high' : 'minimal' };
    case 'anthropic-messages':
      return normalized === 'high'
        ? { thinking: { type: 'enabled', budget_tokens: ANTHROPIC_HIGH_BUDGET_TOKENS } }
        : { thinking: { type: 'disabled' } };
    case 'dashscope-native':
      return { enable_thinking: normalized === 'high' };
    default:
      // 未知协议：诚实不发参（宁可不支持，也不猜参数名）
      return {};
  }
}

/**
 * 判断上游错误是否属于「未知/非法参数」类——D3 去参重试的判据。
 * 覆盖 OpenAI/Anthropic/DashScope 常见文案（英文为主，兼容中文网关文案）。
 *
 * @param {unknown} error 错误对象或字符串
 * @returns {boolean}
 */
function isUnknownParameterError(error) {
  const raw = typeof error === 'string'
    ? error
    : [
      error && error.message,
      error && error.error,
      error && error.code,
      error && error.body,
      error && error.response && error.response.data,
    ].filter(Boolean).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ');
  const text = String(raw || '').toLowerCase();
  if (!text) return false;
  return (
    /unknown (parameter|argument|field|property)/.test(text)
    || /unrecognized (parameter|field|property)/.test(text)
    || /unsupported (parameter|argument|field|property)/.test(text)
    || /invalid (parameter|argument|field|property)/.test(text)
    || /unexpected (parameter|argument|field)/.test(text)
    || /(未知|不支持|非法|无效).{0,6}(参数|字段)/.test(text)
  );
}

module.exports = {
  THINKING_LEVELS,
  DEFAULT_THINKING_LEVEL,
  ANTHROPIC_HIGH_BUDGET_TOKENS,
  normalizeThinkingLevel,
  thinkingParamsFor,
  isUnknownParameterError,
};
