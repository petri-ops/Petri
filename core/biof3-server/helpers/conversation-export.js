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
function composeConversationMarkdown(input) {
  const { conversation, messages, exportedAt } = input || {};
  const conv = conversation || {};
  const list = Array.isArray(messages) ? messages : [];
  const title = (typeof conv.title === 'string' && conv.title.trim()) || conv.id || '未命名会话';
  const exportTs = typeof exportedAt === 'string' && exportedAt ? exportedAt : new Date().toISOString();

  const usable = list.filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0);
  const truncated = usable.length > MAX_EXPORT_MESSAGES;
  const kept = truncated ? usable.slice(0, MAX_EXPORT_MESSAGES) : usable;

  const lines = [];
  lines.push(`# 会话导出：${title}`);
  lines.push('');
  lines.push(`- 导出时间：${formatTs(exportTs)}`);
  if (conv.created_at) lines.push(`- 会话开始：${formatTs(conv.created_at)}`);
  if (conv.project_id) lines.push(`- 项目：${conv.project_id}`);
  lines.push(`- 消息数：${kept.length}${truncated ? `（超出 ${MAX_EXPORT_MESSAGES} 上限，已截断 ${usable.length - MAX_EXPORT_MESSAGES} 条）` : ''}`);
  lines.push('');
  lines.push('---');
  for (const m of kept) {
    const label = ROLE_LABELS[m.role] || '未知';
    const ts = formatTs(m.ts);
    lines.push('');
    lines.push(`## ${label}${ts ? ` · ${ts}` : ''}`);
    lines.push('');
    lines.push(m.content);
    lines.push('');
    lines.push('---');
  }
  if (kept.length === 0) {
    lines.push('');
    lines.push('（该会话没有可导出的消息内容。）');
  }
  return lines.join('\n');
}

module.exports = { composeConversationMarkdown, MAX_EXPORT_MESSAGES, ROLE_LABELS, formatTs };
