'use strict';

/**
 * helpers/model-fallback-policy.js — BLOCK-56 P1 模型降级策略（纯函数）。
 *
 * 职责边界：只做分类与候选解析，不发起任何调用、不落任何状态。
 * 编排层（agent-fallback.js）消费这里的判定结果。
 *
 * 可降级类（plan §2.1）：
 *   - 超限（ContextWindowExceeded）——备用模型若 ctx 更大可吃下原任务
 *   - 服务端（ServerOverloaded / 5xx 持续 / 网络超时）
 *   - 配额（UsageLimitReached / 余额不足）
 * 不可降级类：
 *   - 参数错误（InvalidRequest，请求本身问题，换模型没用）
 *   - 鉴权/配置（no_api_key / provider_not_registered / 401 / 403）——应诚实暴露
 *   - 用户主动取消（aborted / cancelled）
 */

const DEGRADABLE_PATTERNS = [
  {
    category: 'context_window',
    re: /context (length|window)|maximum context|context_length_exceeded|context_window_exceeded|上下文(长度|窗口)(超限|过长|已满)|reduce the length/i,
  },
  {
    category: 'quota',
    re: /usage limit|usage_limit|insufficient[-_ ](balance|quota)|quota (exceeded|exhausted)|exceeded your (current )?quota|billing|arrears|余额不足|配额不足|账户.*欠费/i,
  },
  {
    category: 'server',
    re: /overloaded|server busy|model busy|server error|internal error|bad gateway|service unavailable|\b5\d\d\b|\b429\b|rate limit|rate_limit|too many requests|timeout|timed out|network|http_error|api_error|req_error|res_error|parse_error|fetch failed|econn|socket hang up/i,
  },
];

const NON_DEGRADABLE_RE = /invalid request|invalid_request|bad request|unauthorized|\b401\b|forbidden|\b403\b|no_api_key|api key|provider_not_registered|model_profile_not_found|provider_method_missing|aborted|cancelled|serialize_error|未登录|无权/i;

/**
 * 分类一次 provider 失败是否可降级。
 * @param {string|Error|null} errorText 终态错误（providerFailureReason / terminal.error）
 * @returns {{ degradable: boolean, category: 'context_window'|'quota'|'server'|null }}
 */
function classifyDegradableError(errorText) {
  const message = String((errorText && errorText.message) || errorText || '').trim();
  if (!message) return { degradable: false, category: null };
  // 超限/配额/服务端的特征词优先判定——InvalidRequest 包裹的 context length
  // （OpenAI 风格 400）仍属于可降级超限，所以先查可降级再查不可降级。
  for (const { category, re } of DEGRADABLE_PATTERNS) {
    if (re.test(message)) return { degradable: true, category };
  }
  if (NON_DEGRADABLE_RE.test(message)) return { degradable: false, category: null };
  return { degradable: false, category: null };
}

/**
 * 从 gateway 配置解析任务级备用 profile（首个有效候选，排除主 profile）。
 * @param {{fallbackEnabled: boolean, fallbackBindings: object, profiles: Array}} config normalizeModelConfig 输出
 * @param {string|null} primaryProfileId 失败任务使用的主 profile id
 * @param {string} [role] 模型角色，默认 agent
 * @returns {object|null} ModelProfile 或 null（未启用/无候选/候选均无效）
 */
function resolveTaskFallbackProfile(config, primaryProfileId, role = 'agent') {
  if (!config || config.fallbackEnabled !== true) return null;
  const bindings = (config.fallbackBindings && config.fallbackBindings[role]) || [];
  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  const byId = new Map(profiles.map((p) => [p && p.id, p]));
  for (const id of bindings) {
    if (!id || id === primaryProfileId) continue;
    const profile = byId.get(id);
    if (profile) return profile;
  }
  return null;
}

/**
 * 组装降级续跑消息：原请求历史 + 执行进度摘要 + 合成恢复指令。
 * 与 BLOCK-38 resume（routes/ai-agent/resume.js）同构，措辞换为降级语义；
 * 并要求模型在最终回答末尾附一句降级说明（plan §2.1 诚实纪律）。
 * @param {Array} originalMessages 原 task params.messages
 * @param {string} digest task_events 重建的执行进度摘要
 * @param {{reason?: string, label?: string}} [meta]
 * @returns {Array} 续跑 messages
 */
function buildFallbackResumeMessages(originalMessages, digest, meta = {}) {
  const reasonText = meta.reason ? `失败原因：${meta.reason}` : '失败原因：模型服务异常';
  const lines = [
    '=== 任务恢复（系统注入，非用户输入） ===',
    `上次执行因模型服务异常中断，系统已自动切换到备用模型「${meta.label || '备用模型'}」继续本任务。`,
    reasonText,
    '中断前的执行进度：',
    digest || '（无已记录的工具执行）',
    '请基于以上进度继续完成原任务；已完成的步骤不要重复执行。',
    meta.label
      ? `任务完成时，请在最终回答末尾用一句话注明：本次结果由备用模型「${meta.label}」降级生成。`
      : '任务完成时，请在最终回答末尾用一句话注明本次结果由备用模型降级生成。',
  ];
  return [
    ...(Array.isArray(originalMessages) ? originalMessages : []),
    { role: 'user', content: lines.join('\n') },
  ];
}

module.exports = {
  classifyDegradableError,
  resolveTaskFallbackProfile,
  buildFallbackResumeMessages,
};
