'use strict';

/**
 * helpers/conversation-export.js — 会话导出 Markdown 组合器（UI-444）。
 *
 * 纯函数：输入会话元信息 + 消息行（rowid 升序），输出可存档的 Markdown 文本。
 * 消费方 = routes/ai-conversations.js 的 GET /api/ai/conversations/:id/export.md
 * （配 preload files.downloadFromUrl 静默落 Downloads，点击即下载心智）。
 *
 * 纪律：
 *  - 内容逐字保留（助手回复本身即 Markdown），不改写不转义不截断；
 *  - 空/纯空白消息跳过；role 映射 用户/格物/系统；
 *  - 防御上限 MAX_EXPORT_MESSAGES（超限截断并在头部如实标注）。
 */

const MAX_EXPORT_MESSAGES = 5000;

const ROLE_LABELS = {
  user: '用户',
  assistant: '格物',
  system: '系统',
};

function formatTs(ts) {
  if (typeof ts !== 'string' || !ts) return '';
  // ISO → 「YYYY-MM-DD HH:MM」（本地可读；导出为存档，精确到分足够）
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : ts;
}

/**
 * @param {{conversation: {id: string, title?: string|null, project_id?: string|null, created_at?: string|null},
 *          messages: Array<{role: string, content: string, ts: string}>,
 *          exportedAt?: string}} input
 * @returns {string} markdown 文本
 */
// L-31 补腿（BLOCK-412）：流式导出原语——头部块与单消息块抽为纯函数，
// composeConversationMarkdown 由其重建（逐字节等价），路由按 500 行分块流式写响应。

/** 单消息块（原 for 循环体逐字保持）。 */
function formatMessageBlock(m) {
  const label = ROLE_LABELS[m.role] || '未知';
  const ts = formatTs(m.ts);
  const lines = [];
  lines.push('');
  lines.push(`## ${label}${ts ? ` · ${ts}` : ''}`);
  lines.push('');
  lines.push(m.content);
  lines.push('');
  lines.push('---');
  return lines.join('\n');
}

/** 头部块（keptCount=过滤后保留数；truncatedExtra=截断条数或 0）。 */
function composeExportHeader(conv, { keptCount, truncatedExtra = 0, exportedAt } = {}) {
  const c = conv || {};
  const title = (typeof c.title === 'string' && c.title.trim()) || c.id || '未命名会话';
  const exportTs = typeof exportedAt === 'string' && exportedAt ? exportedAt : new Date().toISOString();
  const lines = [];
  lines.push(`# 会话导出：${title}`);
  lines.push('');
  lines.push(`- 导出时间：${formatTs(exportTs)}`);
  if (c.created_at) lines.push(`- 会话开始：${formatTs(c.created_at)}`);
  if (c.project_id) lines.push(`- 项目：${c.project_id}`);
  lines.push(`- 消息数：${keptCount}${truncatedExtra > 0 ? `（超出 ${MAX_EXPORT_MESSAGES} 上限，已截断 ${truncatedExtra} 条）` : ''}`);
  lines.push('');
  lines.push('---');
  return lines.join('\n');
}

function composeConversationMarkdown(input) {
  const { conversation, messages, exportedAt } = input || {};
  const conv = conversation || {};
  const list = Array.isArray(messages) ? messages : [];

  const usable = list.filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0);
  const truncated = usable.length > MAX_EXPORT_MESSAGES;
  const kept = truncated ? usable.slice(0, MAX_EXPORT_MESSAGES) : usable;

  const parts = [composeExportHeader(conv, { keptCount: kept.length, truncatedExtra: truncated ? usable.length - MAX_EXPORT_MESSAGES : 0, exportedAt })];
  for (const m of kept) parts.push(formatMessageBlock(m));
  if (kept.length === 0) {
    parts.push('\n（该会话没有可导出的消息内容。）');
  }
  return parts.join('\n');
}

module.exports = { composeConversationMarkdown, composeExportHeader, formatMessageBlock, MAX_EXPORT_MESSAGES, ROLE_LABELS, formatTs };
