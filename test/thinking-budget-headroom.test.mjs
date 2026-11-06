/**
 * 思考预算与正文预算必须分离（2026-11-05 实测沉淀）。
 *
 * 事故：Anthropic `thinking.budget_tokens=16000` 与 `max_tokens=16384` 组合时，
 * 思考段与正文共享上限，正文只剩 384 token → 必然 `finish_reason=length` + 空正文，
 * 再被最终整理误判成「上游返回了空正文」。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  clampThinkingBudgetForOutput,
  MIN_CONTENT_TOKENS_FOR_THINKING,
} = require(path.join(ROOT, 'core', 'shared-backend', 'llm-providers', 'model-gateway.js'));

test('思考预算吃满时自动给正文留出空间', () => {
  const clamped = clampThinkingBudgetForOutput({
    max_tokens: 16384,
    thinking: { type: 'enabled', budget_tokens: 16000 },
  });
  assert.equal(clamped.thinking.budget_tokens, 16384 - MIN_CONTENT_TOKENS_FOR_THINKING);
  assert.ok(clamped.thinking.budget_tokens >= 1024);
  assert.ok(clamped.thinking.budget_tokens < clamped.max_tokens, 'Anthropic 要求 budget_tokens < max_tokens');
});

test('预算本身有空间时不得改动请求', () => {
  const roomy = clampThinkingBudgetForOutput({
    max_tokens: 65536,
    thinking: { type: 'enabled', budget_tokens: 16000 },
  });
  assert.equal(roomy.thinking.budget_tokens, 16000);
});

test('非思考请求与缺上限请求保持原样', () => {
  const disabled = clampThinkingBudgetForOutput({ max_tokens: 16384, thinking: { type: 'disabled' } });
  assert.equal(disabled.thinking.budget_tokens, undefined);

  const noMax = clampThinkingBudgetForOutput({ thinking: { type: 'enabled', budget_tokens: 16000 } });
  assert.equal(noMax.thinking.budget_tokens, 16000);
});

test('agent 输出预算按上下文窗口自适应（1M 窗口不再死守 16384）', () => {
  const { resolveOutputBudget } = require(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'agent-loop-control.js'));
  assert.equal(resolveOutputBudget(1000000, undefined), 65536, '大窗口必须给思考段留出正文空间');
  assert.equal(resolveOutputBudget(32000, undefined), 16384);
  assert.equal(resolveOutputBudget(128000, undefined), 16384);
  assert.equal(resolveOutputBudget(1000000, 8192), 8192, '用户显式配置优先');
  assert.equal(resolveOutputBudget(undefined, undefined), 16384);
});

test('预算耗尽重试必须要求直接给结论、不再输出思考过程', () => {
  const { buildFinalizationRetryRequest } = require(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'agent-loop-control.js'));
  const retry = buildFinalizationRetryRequest({
    messages: [{ role: 'user', content: '继续' }],
    max_tokens: 65536,
    tools: [{ type: 'function' }],
    tool_choice: 'auto',
  });
  assert.match(retry.messages.at(-1).content, /不要输出思考过程/);
  assert.match(retry.messages.at(-1).content, /只输出面向用户的完整最终答复/);
  assert.equal(retry.tools, undefined);
  assert.equal(retry.tool_choice, undefined);
  assert.equal(retry.max_tokens, 65536, '重试沿用自适应后的预算，不再退回 16384');
});

test('极小上限下守住 1024 下限且仍小于 max_tokens', () => {
  const tiny = clampThinkingBudgetForOutput({
    max_tokens: 2048,
    thinking: { type: 'enabled', budget_tokens: 16000 },
  });
  assert.equal(tiny.thinking.budget_tokens, 1024);
  assert.ok(tiny.thinking.budget_tokens < tiny.max_tokens);
});
