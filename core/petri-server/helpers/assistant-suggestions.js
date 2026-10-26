'use strict';

/**
 * helpers/assistant-suggestions.js — BLOCK-264（C-36）模型侧追问建议。
 *
 * 用当前 chat 模型对「上一条助手回复」生成三条追问（JSON 数组形态约束 +
 * 终态校验 + 截断兜底）；模型调用失败时如实失败——**不回落关键词模板冒充
 * 模型建议**（关键词模板仍保留为独立的免模型动作，两者在前端并列可选）。
 *
 * 红线：只生成建议文本，永不自动发送；正文截断 6000 字；输出 3 条各 ≤160 字。
 */

const { modelGateway, getCredential } = require('./model-gateway');
const { getAiSettings, getChatProviderName } = require('./ai-settings');

const MAX_INPUT_CHARS = 6000;
const MAX_ITEMS = 3;
const MAX_ITEM_CHARS = 160;
const TIMEOUT_MS = 20000;

function clampItem(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.slice(0, MAX_ITEM_CHARS);
}

/** 解析模型输出（容忍 ```json 围栏与前后杂文；非法整体拒绝）。 */
function parseSuggestions(raw) {
  const text = String(raw || '');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  const items = parsed
    .map((item) => (typeof item === 'string' ? item : item && typeof item.question === 'string' ? item.question : null))
    .map(clampItem)
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  return items.length > 0 ? items : null;
}

/**
 * 生成三条追问建议。
 * @returns {Promise<{ok:true, suggestions:string[], model:string|null}|{ok:false,error:string}>}
 */
async function generateFollowUpSuggestions({ assistantContent, userId }) {
  const content = String(assistantContent || '').trim();
  if (!content) return { ok: false, error: 'content_required' };
  const settings = getAiSettings();
  const providerName = getChatProviderName();
  let apiKey = null;
  try {
    apiKey = providerName ? getCredential(providerName) : null;
  } catch { apiKey = null; }
  if (!apiKey) return { ok: false, error: 'no_credential' };

  const bounded = content.slice(0, MAX_INPUT_CHARS);
  const system = '你是追问建议生成器。根据用户给出的助手回复，生成 3 条用户最可能想追问的问题。只输出 JSON 字符串数组（3 个元素，每条不超过 80 字），不要输出任何其他文字。';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const result = await modelGateway.chat({
      role: 'chat',
      body: {
        model: (settings.model_profiles && settings.model_profiles.length > 0 && settings.active_chat_model_id
          ? (settings.model_profiles.find((p) => p.id === settings.active_chat_model_id) || {}).model
          : undefined),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `助手回复如下：\n\n${bounded}` },
        ],
        temperature: 0.4,
        max_tokens: 400,
      },
      telemetry: { userId: userId || null, kind: 'followup-suggestions' },
      signal: controller.signal,
    });
    const text = result && result.choices && result.choices[0] && result.choices[0].message
      ? result.choices[0].message.content
      : (result && result.content) || '';
    const suggestions = parseSuggestions(text);
    if (!suggestions) return { ok: false, error: 'model_output_unparsable' };
    return { ok: true, suggestions, model: providerName };
  } catch (e) {
    return { ok: false, error: (e && e.name === 'AbortError') ? 'timeout' : ((e && e.message) || 'model_call_failed') };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  MAX_INPUT_CHARS,
  MAX_ITEMS,
  MAX_ITEM_CHARS,
  parseSuggestions,
  generateFollowUpSuggestions,
  generatePolishedDraft,
};

/**
 * BLOCK-264（C-36）— 模型润色草稿（只产文本，不自动发送）。
 * @returns {Promise<{ok:true,draft:string,model:string|null}|{ok:false,error:string}>}
 */
async function generatePolishedDraft({ assistantContent, userId }) {
  const content = String(assistantContent || '').trim();
  if (!content) return { ok: false, error: 'content_required' };
  const settings = getAiSettings();
  const providerName = getChatProviderName();
  let apiKey = null;
  try {
    apiKey = providerName ? getCredential(providerName) : null;
  } catch { apiKey = null; }
  if (!apiKey) return { ok: false, error: 'no_credential' };

  const bounded = content.slice(0, MAX_INPUT_CHARS);
  const system = '你是文本润色器。保持事实、数字与结论完全不变，只改进结构与表达，输出润色后的全文，不要任何前后缀说明。';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const result = await modelGateway.chat({
      role: 'chat',
      body: {
        model: (settings.model_profiles && settings.model_profiles.length > 0 && settings.active_chat_model_id
          ? (settings.model_profiles.find((p) => p.id === settings.active_chat_model_id) || {}).model
          : undefined),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: bounded },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      },
      telemetry: { userId: userId || null, kind: 'polish-draft' },
      signal: controller.signal,
    });
    const draft = result && result.choices && result.choices[0] && result.choices[0].message
      ? String(result.choices[0].message.content || '').trim()
      : '';
    if (!draft) return { ok: false, error: 'model_output_empty' };
    return { ok: true, draft: draft.slice(0, MAX_INPUT_CHARS), model: providerName };
  } catch (e) {
    return { ok: false, error: (e && e.name === 'AbortError') ? 'timeout' : ((e && e.message) || 'model_call_failed') };
  } finally {
    clearTimeout(timer);
  }
}
