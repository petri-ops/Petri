// BLOCK-172 CP-5 — 摘要式 auto-compact 契约（源码扫描钉：防退化回丢弃式）。
// 锚点=loop-orchestrator 0.85 断路块内的四要素；逐条语义见 plan CP-5。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(ROOT, 'core', 'petri-server', 'loop-orchestrator.js'), 'utf8');

test('CP-5：0.85 断路丢弃前走摘要通道（agent_context_compaction 调用在场）', () => {
  assert.match(source, /kind: 'agent_context_compaction'/);
  assert.match(source, /summaryBody/);
});

test('CP-5：摘要注入为 system 消息且标注留证来源（llm-transcripts）', () => {
  assert.match(source, /BLOCK-172 CP-5 自动压缩摘要/);
  assert.match(source, /原文见 llm-transcripts/);
});

test('CP-5：context_compacted 事件落 task_events（可审计压缩）', () => {
  assert.match(source, /event: 'context_compacted'/);
  assert.match(source, /summarized: Boolean\(compactSummaryText\)/);
});

test('CP-5：fail-open——摘要异常回退纯丢弃（不阻塞任务）', () => {
  assert.match(source, /cp5-compact-summary] fail-open to plain trim/);
});

test('CP-5：丢弃过少不触发摘要模型调用（<4 条不值得一跳）', () => {
  assert.match(source, /droppedCount >= 4/);
});
