'use strict';

/**
 * helpers/prompt-assembly.js — 提示词消息组装（BLOCK-212）。
 *
 * 唯一职责：把「静态前缀 + 历史消息 + 动态上下文」拼成发给 Provider 的 messages。
 *
 * 为什么动态段在**末尾**（而不是 system 里）：所有 Provider 的 prompt cache 都是
 * **前缀缓存**——从第一个字节起连续相同的部分才可复用。动态段（项目数据集/分析历史/
 * 结果摘要，每轮可能变）如果留在 system（消息链第一条），任何变化都会把整段历史的
 * 复用作废。放到末尾且**不落历史**，下一轮前缀=静态头+干净历史，逐轮增长、完全可复用。
 *
 * 纯函数：不读 env、不碰 DB，便于离线断言（`test/block212-prompt-prefix.test.mjs`）。
 */

const DYNAMIC_HEADING = '以下是当前界面与项目上下文（每轮更新，放在末尾以免破坏缓存前缀）：';

/**
 * @param {{staticPrefix: string, dynamicContext?: string, messages?: object[], dynamicHeading?: string}} input
 * @returns {object[]} messages（首条恒为 system=staticPrefix；末尾按需追加动态 system 块）
 */
function assembleMessages({ staticPrefix, dynamicContext, messages, dynamicHeading } = {}) {
  const history = Array.isArray(messages) ? messages : [];
  const prefix = typeof staticPrefix === 'string' ? staticPrefix : '';
  const out = [{ role: 'system', content: prefix }, ...history];
  const dynamic = typeof dynamicContext === 'string' ? dynamicContext.trim() : '';
  if (dynamic) {
    out.push({
      role: 'system',
      content: `${dynamicHeading || DYNAMIC_HEADING}\n${dynamic}`,
    });
  }
  return out;
}

module.exports = { assembleMessages, DYNAMIC_HEADING };
