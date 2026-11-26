/**
 * prompt-enhance-retry.js — 空输出诊断+重试（owner msg_aaad9b13c360 追加要求）。
 *
 * 边界：①正文只认 content，reasoning_content 是思考过程、**绝不**当答案误用；
 * ②仅当提取为空时自动重试一次（模型偶发空回的稳健防御，非根因修复——
 * 根因=deepseek-flash 推理吃光 240 预算，已由 quickOutputBudget 下限 1024 修复）；
 * ③重试结果如实标注 retried/empty，不冒充成功。零新依赖。
 */

/** 从 modelGateway 信封提取正文；空 content 不回退 reasoning（思考≠答案）。 */
function extractOptimizedText(result) {
  if (!result || typeof result !== 'object') return '';
  const fromChoices = result.choices && result.choices[0] && result.choices[0].message
    ? result.choices[0].message.content
    : '';
  const raw = fromChoices != null && fromChoices !== '' ? fromChoices : result.content;
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * 空输出自动重试一次。
 * @param {() => Promise<object>} call 实际的 modelGateway.chat 调用（每次返回新信封）
 * @returns {Promise<{result:object, retried:boolean, empty:boolean}>}
 */
async function retryOnEmptyOutput(call) {
  const first = await call();
  if (extractOptimizedText(first)) return { result: first, retried: false, empty: false };
  const second = await call();
  return { result: second, retried: true, empty: !extractOptimizedText(second) };
}

module.exports = { extractOptimizedText, retryOnEmptyOutput };
