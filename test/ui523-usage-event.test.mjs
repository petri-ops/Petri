// UI-523 — 单次调用 usage 事件构造契约（纯函数）+ loop 接线源码钉。
// 口径：token 字段三协议兼容、cache 走 BLOCK-95 B3 同一提取器、不可算时 null（不发事件）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { buildRunUsageEvent } = require('../core/petri-server/helpers/run-usage.js');

const META = {
  conversationId: 'conv_1',
  iteration: 3,
  attempt: 1,
  model: 'deepseek-chat',
  durationMs: 1240,
};

test('OpenAI 原始形状：prompt/completion + prompt_cache_hit_tokens 进 cacheRead', () => {
  const event = buildRunUsageEvent(
    { prompt_tokens: 1200, completion_tokens: 80, prompt_cache_hit_tokens: 1000 },
    META,
  );
  assert.equal(event.event, 'usage');
  assert.equal(event.scope, 'call');
  assert.equal(event.conversationId, 'conv_1');
  assert.equal(event.iteration, 3);
  assert.equal(event.attempt, 1);
  assert.equal(event.model, 'deepseek-chat');
  assert.equal(event.promptTokens, 1200);
  assert.equal(event.completionTokens, 80);
  assert.equal(event.cacheReadTokens, 1000);
  assert.equal(event.cacheCreationTokens, 0);
  assert.equal(event.durationMs, 1240);
  assert.match(event.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('Anthropic 形状：input/output_tokens + cache_read_input_tokens', () => {
  const event = buildRunUsageEvent(
    { input_tokens: 500, output_tokens: 60, cache_read_input_tokens: 400, cache_creation_input_tokens: 100 },
    META,
  );
  assert.equal(event.promptTokens, 500);
  assert.equal(event.completionTokens, 60);
  assert.equal(event.cacheReadTokens, 400);
  assert.equal(event.cacheCreationTokens, 100);
});

test('stream-aggregate 归一形状：cache_read_tokens 不丢', () => {
  const event = buildRunUsageEvent(
    { prompt_tokens: 300, completion_tokens: 30, cache_read_tokens: 250 },
    META,
  );
  assert.equal(event.cacheReadTokens, 250);
  assert.equal(event.promptTokens, 300);
});

test('诚实边界：usage 缺失 / 全 0 ⇒ null（调用方不发事件，前端显「—」）', () => {
  assert.equal(buildRunUsageEvent(null, META), null);
  assert.equal(buildRunUsageEvent(undefined, META), null);
  assert.equal(buildRunUsageEvent({}, META), null);
  assert.equal(buildRunUsageEvent({ prompt_tokens: 0, completion_tokens: 0 }, META), null);
});

test('元信息缺失/异常归一：iteration 0、attempt ≥1、负耗时归 0、model 保留 null', () => {
  const event = buildRunUsageEvent(
    { prompt_tokens: 10, completion_tokens: 5 },
    { durationMs: -50 },
  );
  assert.equal(event.iteration, 0);
  assert.equal(event.attempt, 1);
  assert.equal(event.conversationId, null);
  assert.equal(event.model, null);
  assert.equal(event.durationMs, 0);
});

test('loop 接线钉：耗时在调用外层实测，事件在调用返回后发（观测不改控制流）', () => {
  const source = readFileSync(resolve(__dirname, '..', 'core', 'petri-server', 'loop-orchestrator.js'), 'utf8');
  assert.match(source, /const callStartedAt = Date\.now\(\);/);
  assert.match(source, /_emitCallUsage\(upJson, \{ iteration: iter \+ 1, attempt, durationMs: Date\.now\(\) - callStartedAt \}\);/);
  assert.match(source, /buildRunUsageEvent\(upJson && upJson\.usage/);
  // 事件字段全部来自 provider 返回的 usage，不得另起一套 token 计数
  assert.doesNotMatch(source, /event: 'usage'[\s\S]{0,200}estimateTokens/);
});
