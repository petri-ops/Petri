/**
 * 试用反馈⑫（owner msg_9b268abb3522）：右键菜单三件——复制ID bug、新增导出、输入框入口迁移。
 * HK-01 静态契约：复制有 fallback+反馈、右键导出项存在、SimpleChat 工具栏导出入口撤除、共享 helper 单源。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const left = read('frontend/src/components/workspace-panels/LeftPanel.tsx');
const chat = read('frontend/src/components/copilot/SimpleChat.tsx');
const helper = read('frontend/src/lib/conversationActions.ts');

test('HK-01-1：复制会话 ID 走共享 copyText（含 fallback），无静默 catch', () => {
  assert.match(left, /copyText\(/);
  assert.doesNotMatch(left, /clipboard\.writeText\(conversation\.id\)\.catch\(\(\) => \{\}\)/);
  assert.match(helper, /execCommand\(['"]copy['"]\)/);
});

test('HK-01-2：复制有轻量反馈（已复制勾选一闪）', () => {
  assert.match(left, /已复制|copiedLabel|copyFeedback/);
});

test('HK-01-3：右键菜单新增「导出会话」项，走共享 helper', () => {
  assert.match(left, /导出会话/);
  assert.match(left, /exportConversation\(/);
});

test('HK-01-4：输入框下导出入口撤除（迁移非复制）', () => {
  assert.doesNotMatch(chat, /onClick=\{handleExportConversation\}/);
  assert.doesNotMatch(chat, /title="导出会话为 Markdown"/);
});

test('HK-01-5：导出逻辑单源在 helper（fetch export.md + saveTextFile + blob 回退）', () => {
  assert.match(helper, /export\.md/);
  assert.match(helper, /saveTextFile/);
  assert.match(helper, /createObjectURL/);
});
