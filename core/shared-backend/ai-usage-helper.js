/**
 * shared-backend/ai-usage-helper.js — AI 用量记录的注入式入口（自洽版）
 *
 * 断点1（分仓前置）：斩断 llm-providers 对 r-server/helpers/ai-usage 的反向 require。
 * 调用方（r-server）启动时调 configure({recordAiUsage}) 注入自己的实现；
 * 未注入时 no-op（不阻塞 LLM 调用，计费降级但不报错）。
 *
 * 历史上 deepseek/dashscope/dashscope-vision 各自懒 require r-server/helpers/ai-usage，
 * 分仓后 ../../r-server/helpers/ai-usage 路径会断。依赖反转后，shared-backend 真自洽。
 */

let _recordAiUsage = null;

/**
 * 注入 recordAiUsage 实现。调用方启动时调一次。
 * @param {{recordAiUsage: Function}} provider
 */
function configure(provider) {
  if (provider && typeof provider.recordAiUsage === 'function') {
    _recordAiUsage = provider.recordAiUsage;
  }
}

/**
 * 记录 AI 用量。未注入时 no-op（计费降级，不阻塞 LLM 调用）。
 */
function recordAiUsage(args) {
  if (_recordAiUsage) return _recordAiUsage(args);
  // 未注入：no-op
}

module.exports = { configure, recordAiUsage };
