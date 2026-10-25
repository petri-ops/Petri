// BLOCK-255 C4 — 逐消息 usage 合计契约（纯函数 + loop/adapter 源码钉）。
// 口径：calls 只数拿到 usage 的调用；unmeasuredCalls 单列；模型名去重有界；
// 负数/NaN 归零；不新增第二套账本（仍走 ai_usage 同源 provider usage）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  buildRunUsageEvent,
  createRunUsageTotals,
  accumulateRunUsage,
} = require('../core/petri-server/helpers/run-usage.js');

const META = {
  conversationId: 'conv_1',
  iteration: 2,
  attempt: 1,
  model: 'deepseek-chat',
  durationMs: 1200,
};

test('空合计：全部归零、models 为空、unmeasured 可单列', () => {
  const totals = createRunUsageTotals();
  assert.deepEqual(totals, {
    calls: 0,
    unmeasuredCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    durationMs: 0,
    models: [],
  });
});

test('累加两次调用：token/cache/duration 求和，模型去重', () => {
  const totals = createRunUsageTotals();
  accumulateRunUsage(totals, buildRunUsageEvent(
    { prompt_tokens: 1000, completion_tokens: 80, prompt_cache_hit_tokens: 600 },
    META,
  ));
  accumulateRunUsage(totals, buildRunUsageEvent(
    { input_tokens: 500, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
    { ...META, model: 'claude-sonnet', durationMs: 300 },
  ));
  assert.equal(totals.calls, 2);
  assert.equal(totals.promptTokens, 1500);
  assert.equal(totals.completionTokens, 100);
  assert.equal(totals.cacheReadTokens, 700);
  assert.equal(totals.cacheCreationTokens, 50);
  assert.equal(totals.durationMs, 1500);
  assert.deepEqual(totals.models, ['deepseek-chat', 'claude-sonnet']);
});

test('模型名有界（最多 5 个）且忽略空值', () => {
  const totals = createRunUsageTotals();
  for (let i = 0; i < 8; i += 1) {
    accumulateRunUsage(totals, buildRunUsageEvent(
      { prompt_tokens: 1, completion_tokens: 1 },
      { ...META, model: i % 2 === 0 ? `model-${i}` : null },
    ));
  }
  assert.equal(totals.models.length, 4);
  assert.ok(totals.models.every((model) => typeof model === 'string' && model));
});

test('负数/NaN 不污染合计；null 载荷原样返回', () => {
  const totals = createRunUsageTotals();
  accumulateRunUsage(totals, {
    promptTokens: -10,
    completionTokens: Number.NaN,
    cacheReadTokens: -3,
    cacheCreationTokens: 'bad',
    durationMs: -1,
    model: '',
  });
  assert.equal(totals.calls, 1);
  assert.equal(totals.promptTokens, 0);
  assert.equal(totals.completionTokens, 0);
  assert.equal(totals.cacheReadTokens, 0);
  assert.equal(totals.cacheCreationTokens, 0);
  assert.equal(totals.durationMs, 0);
  assert.deepEqual(totals.models, []);
  assert.equal(accumulateRunUsage(totals, null), totals);
});

test('loop 接线钉：累加发生在 usage 事件构造成功分支，未返回 usage 计入 unmeasuredCalls', () => {
  const source = readFileSync(resolve(__dirname, '..', 'core', 'petri-server', 'loop-orchestrator.js'), 'utf8');
  assert.match(source, /const runUsageTotals = createRunUsageTotals\(\)/);
  assert.match(source, /accumulateRunUsage\(runUsageTotals, payload\)/);
  assert.match(source, /runUsageTotals\.unmeasuredCalls \+= 1/);
  assert.match(source, /usageTotals: runUsageTotals/);
});

test('落库接线钉：agent-runner 传 assistantUsage，adapter 写 meta.usage', () => {
  const runner = readFileSync(resolve(__dirname, '..', 'core', 'petri-server', 'agent-runner.js'), 'utf8');
  assert.match(runner, /usageTotals,/);
  assert.match(runner, /assistantUsage: usageTotals \|\| null/);
  const adapter = readFileSync(resolve(__dirname, '..', 'core', 'petri-server', 'conversation-adapter.js'), 'utf8');
  assert.match(adapter, /assistantMeta\.usage = \{/);
  assert.match(adapter, /unmeasuredCalls: nonNegative/);
  assert.doesNotMatch(adapter, /CREATE TABLE[\s\S]{0,80}usage/i);
});
