'use strict';

/**
 * helpers/history-assembly.js — BLOCK-95 B1 历史拼装权收归后端。
 *
 * 开关（PETRI_SERVER_HISTORY_ASSEMBLY）：2026-09-18 用户裁决翻默认开（feature-flags 单一真相，
 * 设置页可切换）；环境变量 =1/true 强制开、=0/false 强制关（kill-switch）。打开时，LLM 请求历史由
 * DB（copilot_messages）拼装，前端上报的 messages 只提供「本轮 user 原文」：
 *   - 历史轮次与 DB 完全同源（前端展示层本就 restore 自 DB；无错误轮次会话
 *     与旧链路的前端全量上报逐字一致——契约测试 block95-b1-history-assembly 锁定）；
 *   - 本轮 user 用前端原发 content 回填尾部（落库的 cleanContent 会剥开头
 *     引用行，原文才与旧链路发给 LLM 的内容一致）；
 *   - DB 异常时回退前端上报（不因拼装异常阻断会话）。
 * 这是服务端 compaction（B2）/ cache 感知（B3）的架构前提。
 */

const SERVER_HISTORY_ASSEMBLY_ENV = 'PETRI_SERVER_HISTORY_ASSEMBLY';

function isServerHistoryAssemblyEnabled(env) {
  // BLOCK-95 B1 灰度收编：解析权在 feature-flags（env 强制 > 设置页持久化 > 默认开）
  const { resolveFlag } = require('./feature-flags');
  return resolveFlag('server_history_assembly', env);
}

/**
 * @param {object} opts
 * @param {string|null} opts.conversationId 目标会话（空 = 无 DB 可拼，原样返回）
 * @param {Array<{role,content}>} opts.incomingMessages 前端上报（关开关时原样透传）
 * @param {object} opts.adb db.getAsyncDatabase() Promise facade
 * @returns {Promise<Array<{role,content}>>}
 */
async function assembleServerHistory({ conversationId, incomingMessages, adb }) {
  if (!Array.isArray(incomingMessages) || incomingMessages.length === 0) return incomingMessages;
  if (!conversationId || !adb) return incomingMessages;
  try {
    const rows = await adb.prepare(
      "SELECT role, content FROM copilot_messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY ts ASC, rowid ASC"
    ).all(conversationId);
    if (!Array.isArray(rows) || rows.length === 0) return incomingMessages;
    const assembled = rows.map((r) => ({ role: r.role, content: String(r.content || '') }));
    // 本轮 user 三分支（健壮性：append 落库失败时也不丢本轮输入）：
    //   a) 尾部 user 与前端原文同文 → 已落库，不动；
    //   b) 尾部 user 为落库剥前缀版（cleanContent）→ 回填前端原发 content；
    //   c) 尾部非 user（本轮 append 失败）→ 追加原文。
    const incomingLastUser = [...incomingMessages].reverse().find((m) => m && m.role === 'user');
    if (incomingLastUser) {
      const original = String(incomingLastUser.content || '');
      const lastRow = assembled[assembled.length - 1];
      if (lastRow && lastRow.role === 'user') {
        if (lastRow.content !== original) {
          assembled[assembled.length - 1] = { role: 'user', content: original };
        }
      } else {
        assembled.push({ role: 'user', content: original });
      }
    }
    return assembled;
  } catch (e) {
    try { console.warn('[block95-b1] server history assembly failed, fallback to client messages:', e && e.message); } catch {}
    return incomingMessages;
  }
}

module.exports = {
  SERVER_HISTORY_ASSEMBLY_ENV,
  isServerHistoryAssemblyEnabled,
  assembleServerHistory,
};
