/**
 * Token counting utilities using tiktoken (cl100k_base encoding).
 * DeepSeek-V3 uses OpenAI-compatible API with the same encoding.
 */
let _enc = null;

function getEncoder() {
  if (!_enc) {
    const { encoding_for_model: encForModel } = require('tiktoken');
    // cl100k_base covers DeepSeek-V3 / GPT-4 / GPT-3.5-turbo tokenizers
    _enc = encForModel('gpt-4');
  }
  return _enc;
}

/**
 * Count tokens in a single text string.
 * @param {string} text
 * @returns {number}
 */
function countTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  try {
    return getEncoder().encode(text).length;
  } catch {
    // Fallback: rough estimate (chars / 4)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Count tokens across an array of message objects.
 * Adds role/content overhead per message.
 * @param {Array<{role?: string, content?: string, name?: string, tool_calls?: Array}>} messages
 * @returns {number}
 */
function countMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    // Role overhead (approx 4 tokens per message)
    total += 4;
    if (m.name) total += 4;
    // Tool call overhead
    if (Array.isArray(m.tool_calls)) {
      total += m.tool_calls.length * 15;
    }
    // Content
    total += countTokens(m.content || '');
  }
  return total;
}

/**
 * Estimate total tokens for a full API request payload.
 * @param {{ systemPrompt: string, messages: Array, maxTokens?: number }} opts
 * @returns {{ systemPromptTokens: number, messagesTokens: number, maxTokens: number, total: number }}
 */
function estimateRequestTokens({ systemPrompt, messages, maxTokens = 8192 }) {
  const systemPromptTokens = countTokens(systemPrompt);
  const messagesTokens = countMessages(messages);
  const total = systemPromptTokens + messagesTokens + maxTokens;
  return {
    systemPromptTokens,
    messagesTokens,
    maxTokens,
    total,
  };
}

/**
 * Get the model's context window.
 * Priority order:
 *   1. presetContextWindow — user-configured value in ChatModelPreset (stable, authoritative)
 *   2. Hard-coded known list
 *   3. OpenRouter in-memory cache (may return 0 on first call for new models)
 *   4. Unknown → 0
 * @param {string} modelName
 * @param {string} [providerName]
 * @param {string} [baseUrl]
 * @param {string} [apiKey]
 * @param {number} [presetContextWindow] — from ChatModelPreset.contextWindow
 * @returns {Promise<number>} context window in tokens (0 = unknown)
 */
async function getContextWindow(modelName, providerName, baseUrl, apiKey, presetContextWindow) {
  // 1. Preset configuration (authoritative)
  if (presetContextWindow && presetContextWindow > 0) return presetContextWindow;

  const { getContextWindow: resolve } = require('./model-context-windows');
  return resolve(modelName, providerName, baseUrl, apiKey);
}

/**
 * BLOCK-163 W3 P4（MDL-1）— 预算专用窗口解析（去盲区）。
 * 与 getContextWindow 的区别：未知模型不再返回 0（预算侧静默跳过=盲区），
 * 改为保守缺省 32768 + resolved:false 标注（token_budget 事件透出，前端 additive）。
 * 展示面（ContextBudgetBar 的「—」）继续消费 getContextWindow 的 0 语义不动。
 * @returns {Promise<{window: number, resolved: boolean}>}
 */
async function getContextWindowForBudget(modelName, providerName, baseUrl, apiKey, presetContextWindow) {
  const window = await getContextWindow(modelName, providerName, baseUrl, apiKey, presetContextWindow);
  if (window > 0) return { window, resolved: true };
  return { window: 32768, resolved: false };
}

/**
 * UI-622 — 上下文构成分类（全部来自真实请求载荷，可逐项对账）：
 * 系统提示词（含知识空间注入，knowledge 为其子集）/ 工具定义 / 对话消息 /
 * 工具结果 / 其他系统内容（压缩摘要等）/ 输出预留（max_tokens）。
 * @param {{ systemPrompt?: string, messages?: Array, toolDefinitionsTokens?: number, maxTokens?: number, knowledgeTokens?: number }} opts
 */
function computeContextBreakdown({
  systemPrompt = '',
  messages = [],
  toolDefinitionsTokens = 0,
  maxTokens = 0,
  knowledgeTokens = 0,
}) {
  const systemPromptTokens = countTokens(systemPrompt);
  let messagesTokens = 0;
  let toolResults = 0;
  let otherSystem = 0;
  for (const msg of Array.isArray(messages) ? messages : []) {
    const tokens = countMessages([msg]);
    if (msg && msg.role === 'tool') toolResults += tokens;
    else if (msg && msg.role === 'system') otherSystem += tokens;
    else messagesTokens += tokens;
  }
  const toolDefinitions = Math.max(0, toolDefinitionsTokens || 0);
  const outputReserve = Math.max(0, maxTokens || 0);
  const knowledge = Math.min(Math.max(0, knowledgeTokens || 0), systemPromptTokens);
  return {
    systemPrompt: systemPromptTokens,
    knowledge,
    toolDefinitions,
    messages: messagesTokens,
    toolResults,
    otherSystem,
    outputReserve,
    total: systemPromptTokens + toolDefinitions + messagesTokens + toolResults + otherSystem + outputReserve,
  };
}

module.exports = {
  countTokens,
  countMessages,
  estimateRequestTokens,
  computeContextBreakdown,
  getContextWindow,
  getContextWindowForBudget,
};
