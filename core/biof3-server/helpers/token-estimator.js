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

module.exports = {
  countTokens,
  countMessages,
  estimateRequestTokens,
  getContextWindow,
};
