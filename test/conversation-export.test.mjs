import assert from 'node:assert/strict';
import test from 'node:test';
import { composeConversationMarkdown, MAX_EXPORT_MESSAGES, formatTs } from '../core/biof3-server/helpers/conversation-export.js';

/**
 * UI-444 — 会话导出 Markdown 组合器契约。
 * 后端单源组合（routes/ai-conversations.js /export.md 消费），前端只负责触发下载。
 */

test('基本组合：元信息头 + 角色/时间戳分节 + 内容逐字保留', () => {
  const md = composeConversationMarkdown({
    conversation: { id: 'conv_x', title: 'DESeq2 结果解读', project_id: 'p_1', created_at: '2026-09-26T01:29:22.000Z' },
    messages: [
      { role: 'user', content: '这个结果说明了什么？', ts: '2026-09-26T01:30:00.000Z' },
      { role: 'assistant', content: '显著基因 82 个（上调 46 / 下调 36）。\n\n| 基因 | padj |\n|---|---|', ts: '2026-09-26T01:30:20.000Z' },
    ],
    exportedAt: '2026-09-26T09:00:00.000Z',
  });
  assert.match(md, /^# 会话导出：DESeq2 结果解读/);
  assert.match(md, /- 导出时间：2026-09-26 09:00/);
  assert.match(md, /- 会话开始：2026-09-26 01:29/);
  assert.match(md, /- 项目：p_1/);
  assert.match(md, /- 消息数：2/);
  assert.match(md, /## 用户 · 2026-09-26 01:30/);
  assert.match(md, /## 格物 · 2026-09-26 01:30/);
  assert.ok(md.includes('| 基因 | padj |'), '内容（含 Markdown 表格）逐字保留');
  assert.ok(md.includes('---'), '分节分隔线在场');
});

test('空内容与纯空白消息跳过；未知角色映射「未知」；空会话给出诚实提示', () => {
  const md = composeConversationMarkdown({
    conversation: { id: 'conv_empty' },
    messages: [
      { role: 'user', content: '', ts: '2026-09-26T01:30:00.000Z' },
      { role: 'assistant', content: '   \n  ', ts: '2026-09-26T01:30:01.000Z' },
      { role: 'weird', content: '有内容', ts: '2026-09-26T01:30:02.000Z' },
    ],
  });
  assert.ok(!md.includes('## 用户'), '空内容不产出分节');
  assert.ok(!md.includes('## 格物'), '纯空白不产出分节');
  assert.match(md, /## 未知/);
  assert.match(md, /- 消息数：1/);

  const empty = composeConversationMarkdown({ conversation: { id: 'conv_none' }, messages: [] });
  assert.match(empty, /没有可导出的消息内容/);
});

test('截断防御：超过上限截断并在头部如实标注', () => {
  const many = Array.from({ length: MAX_EXPORT_MESSAGES + 3 }, (_, i) => ({
    role: 'user',
    content: `消息 ${i + 1}`,
    ts: '2026-09-26T01:30:00.000Z',
  }));
  const md = composeConversationMarkdown({ conversation: { id: 'c' }, messages: many });
  assert.match(md, /- 消息数：\d+（超出 \d+ 上限，已截断 3 条）/);
  const keptCount = (md.match(/## 用户/g) || []).length;
  assert.equal(keptCount, MAX_EXPORT_MESSAGES);
});

test('formatTs：ISO 截到分；非 ISO 原样返回；无时间戳时分节不带时间', () => {
  assert.equal(formatTs('2026-09-26T09:07:33.000Z'), '2026-09-26 09:07');
  assert.equal(formatTs('随便'), '随便');
  assert.equal(formatTs(''), '');
  const md = composeConversationMarkdown({
    conversation: { id: 'c' },
    messages: [{ role: 'user', content: 'x', ts: '' }],
  });
  assert.match(md, /^## 用户$/m);
});
