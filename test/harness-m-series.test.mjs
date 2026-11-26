/**
 * harness M 系列（owner msg_8640320d302e）：M2 工具重试默认 0→1 + M5 AI_PRICING 扩容。
 * HK-01：行为变化的红绿断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('HK-01-M2：未设 env 时工具重试默认 1（原为 0=重试关闭）', () => {
  const src = read('core/petri-server/helpers/tool-retry-policy.js');
  const at = src.indexOf('function getRetryMax()');
  const fn = src.slice(at, src.indexOf('\n}', at));
  assert.match(fn, /if \(raw === undefined \|\| raw === ''\) return 1;/);
});

test('HK-01-M2：env 显式配置仍可覆盖默认（0 仍可关闭）', () => {
  const src = read('core/petri-server/helpers/tool-retry-policy.js');
  assert.match(src, /Number\.parseInt\(raw, 10\)/);
  assert.match(src, /parsed < 0\) return 0/);
});

test('HK-01-M5：AI_PRICING 覆盖当前活跃模型集（不再 3 模型）', () => {
  const src = read('core/petri-server/helpers/ai-usage.js');
  const at = src.indexOf('const AI_PRICING');
  const block = src.slice(at, src.indexOf('};', at));
  for (const model of ['deepseek-chat', 'deepseek-flash', 'deepseek-reasoner', 'qwen-vl-max', 'text-embedding-v3']) {
    assert.match(block, new RegExp(`'${model}'`));
  }
  const keys = [...block.matchAll(/'([^']+)':\s*\{/g)].map((m) => m[1]);
  assert.ok(keys.length >= 5, `定价模型应 ≥5（实际 ${keys.length}）`);
});


test('HK-01-M5：估算定价显式标 estimated（不冒充真实单价）', () => {
  const src = read('core/petri-server/helpers/ai-usage.js');
  const at = src.indexOf('const AI_PRICING');
  const block = src.slice(at, src.indexOf('};', at));
  assert.match(block, /estimated: true/);
  assert.match(src, /待 owner 用真实账单校准/);
});
