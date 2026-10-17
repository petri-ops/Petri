// BLOCK-200 P2 拆前基线（先写先绿，此后**冻结不得改**）：
// 冻结 `thinking-level.js` 迁移前的完整映射事实——档位词表、默认档、Anthropic 预算、
// 三协议 × 三档的出站参数形状、能力门与未知协议诚实不发参。
// 改实现后本测若红，说明改的是**用户可感行为**而不是内部结构：回退实现，不许改本测。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const thinking = require('../core/shared-backend/llm-providers/thinking-level.js');

const CAPS = ['reasoning'];

test('档位词表与默认档（默认=不发参数，零行为变化）', () => {
  assert.deepEqual([...thinking.THINKING_LEVELS], ['off', 'standard', 'high']);
  assert.equal(thinking.DEFAULT_THINKING_LEVEL, 'standard');
  assert.deepEqual(thinking.thinkingParamsFor({ level: 'standard', protocol: 'openai-compatible', capabilities: CAPS }), {});
  assert.deepEqual(thinking.thinkingParamsFor({ level: undefined, protocol: 'openai-compatible', capabilities: CAPS }), {});
  assert.deepEqual(thinking.thinkingParamsFor({ level: 'ultra', protocol: 'openai-compatible', capabilities: CAPS }), {});
});

test('Anthropic high 档预算数值（迁移后不得漂移，除非设置页显式改了）', () => {
  assert.equal(thinking.ANTHROPIC_HIGH_BUDGET_TOKENS, 16000);
});

test('三协议 × 两非默认档的出站参数形状逐字冻结', () => {
  const table = [
    ['openai-compatible', 'high', { reasoning_effort: 'high' }],
    ['openai-compatible', 'off', { reasoning_effort: 'minimal' }],
    ['anthropic-messages', 'high', { thinking: { type: 'enabled', budget_tokens: 16000 } }],
    ['anthropic-messages', 'off', { thinking: { type: 'disabled' } }],
    ['dashscope-native', 'high', { enable_thinking: true }],
    ['dashscope-native', 'off', { enable_thinking: false }],
  ];
  for (const [protocol, level, expected] of table) {
    assert.deepEqual(
      thinking.thinkingParamsFor({ level, protocol, capabilities: CAPS }),
      expected,
      `${protocol}/${level}`,
    );
  }
});

test('能力门与未知协议：一律不发参（宁可不支持，也不猜参数名）', () => {
  for (const capabilities of [undefined, [], ['vision'], 'reasoning']) {
    assert.deepEqual(thinking.thinkingParamsFor({ level: 'high', protocol: 'openai-compatible', capabilities }), {}, String(capabilities));
  }
  assert.deepEqual(thinking.thinkingParamsFor({ level: 'high', protocol: 'mystery-protocol', capabilities: CAPS }), {});
});

test('归一化只认三档，其余一律 null', () => {
  assert.equal(thinking.normalizeThinkingLevel(' HIGH '), 'high');
  assert.equal(thinking.normalizeThinkingLevel('Off'), 'off');
  assert.equal(thinking.normalizeThinkingLevel('maximum'), null);
  assert.equal(thinking.normalizeThinkingLevel(7), null);
});
