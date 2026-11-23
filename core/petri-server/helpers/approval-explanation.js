/**
 * QODER-A2 P1 — 审批意图解释的模型解释辅助（2026-11-23）。
 *
 * 用户发令「🟡9 立刻开工 A2」；评审稿默认 D1 零新 provider / D2 复用现有本地模型绑定。
 * 零新依赖：只用现有 callModelTask({role:'explanation'})（Model Gateway 统一路由，
 * ollama/lmstudio/vllm 为既有绑定）。模型解释是**可选项附加**：
 * 成功覆盖卡片解释文案，失败/空一律 fail-soft 返回 null（保留确定性 explanation + intent），
 * 审批「允许/拒绝」按钮全程可用——不替代、不编造、不改变 deny/allow 语义。
 */
'use strict';

const { callModelTask } = require('./model-tasks');

const MAX_EXPLANATION_CHARS = 600;

/** 从确定性 intent 派生模型解释 prompt；只复述已给事实，明确不编造/不替代审批判断。 */
function buildApprovalExplanationPrompt(intent = {}) {
  const source = intent && typeof intent === 'object' ? intent : {};
  const action = typeof source.action === 'string' && source.action.trim() ? source.action.trim() : '（未给出动作）';
  const impact = typeof source.impact === 'string' && source.impact.trim() ? source.impact.trim() : '（未给出影响面）';
  const reversible = source.reversible === true ? '可撤销' : source.reversible === false ? '不可撤销' : '可逆性未知';
  const reason = typeof source.reason === 'string' && source.reason.trim() ? source.reason.trim() : '（未给出理由）';
  return [
    '请仅依据下列已判定的事实，用一到两句中文解释这次工具审批请求，让用户看懂再决定。',
    `动作：${action}`,
    `影响：${impact}`,
    `可逆性：${reversible}`,
    `理由：${reason}`,
    '要求：不编造未给出的事实、不新增风险判断、不替代用户的允许/拒绝决定；只把上述事实改写成易读的话。',
    '只输出解释正文，不要前缀、标题或列表。',
  ].join('\n');
}

/** 文本规范化：空白/空 → null；超长有界截断；去首尾空白。 */
function normalizeModelExplanation(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_EXPLANATION_CHARS);
}

/** 默认模型调用器：复用现有 explanation role，失败向上传播由 resolve 兜底。 */
async function defaultCallTask(intent) {
  return callModelTask({
    role: 'explanation',
    messages: [{ role: 'user', content: buildApprovalExplanationPrompt(intent) }],
    temperature: 0,
    maxTokens: 220,
  });
}

/**
 * 取模型解释；任何失败（异常/error/空文本）一律返回 null（fail-soft）。
 * callTask 可注入以便无模型单测；生产走 defaultCallTask。
 */
async function resolveModelExplanation({ intent = {}, callTask = defaultCallTask } = {}) {
  try {
    const result = await callTask(intent);
    if (!result || result.error) return null;
    return normalizeModelExplanation(result.text);
  } catch {
    return null;
  }
}

module.exports = {
  MAX_EXPLANATION_CHARS,
  buildApprovalExplanationPrompt,
  normalizeModelExplanation,
  resolveModelExplanation,
};
