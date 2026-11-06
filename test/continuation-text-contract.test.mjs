/**
 * 续写正文的完整性与计数口径（2026-11-05，用户视角）。
 *
 * 事故：方案 B 续写时每段只进请求 messages，`assistantAcc` 只保留最后一段 →
 * 用户刷新历史后回答「变短」；`recordTruncation(max_tokens)` 把请求上限当已消耗，
 * 4 条链实际只剩 3 段可用；续写只说「继续」，模型可能重写开头。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  CONTINUATION_PROMPT,
  mergeContinuationText,
  resolveTruncationTokens,
} = require(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'agent-loop-control.js'));

test('续写各段必须拼成完整正文，刷新历史不得变短', () => {
  assert.equal(mergeContinuationText(['第一段。', '第二段。'], '收尾。'), '第一段。第二段。收尾。');
  assert.equal(mergeContinuationText([], '只有一段。'), '只有一段。');
  assert.equal(mergeContinuationText(['A', null, 42, '', 'B'], ''), 'AB');
});

test('截断计入实际 completion tokens，而不是请求上限', () => {
  assert.equal(resolveTruncationTokens({ usage: { completion_tokens: 9000 } }, 16384), 9000);
  assert.equal(resolveTruncationTokens({ usage: { completionTokens: 7000 } }, 16384), 7000);
  assert.equal(resolveTruncationTokens({}, 16384), 16384, '缺 usage 时保守回落请求上限');
  assert.equal(resolveTruncationTokens({}, undefined), 0);
});

test('续写提示必须禁止重复与重写开头', () => {
  assert.match(CONTINUATION_PROMPT, /不要重复/);
  assert.match(CONTINUATION_PROMPT, /不要重写开头/);
  assert.match(CONTINUATION_PROMPT, /直接输出剩余部分/);
});
