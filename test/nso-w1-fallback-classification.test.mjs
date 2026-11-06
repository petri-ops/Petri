/**
 * nso-w1-fallback-classification.test.mjs — BLOCK-365（NSO-W1 F-16）降级分类：硬不可降级优先。
 *
 * 缺口（评估 F-16）：classifyDegradableError 先匹配可降级特征再判不可降级——复合错误会被误判：
 *  `cancelled: timeout`（用户取消后的超时文案）命中 server 的 timeout → 判可降级 → 自动续跑违背用户取消；
 *  `401 api_error` 命中 api_error → 判可降级 → 鉴权错误被换模型掩盖而不是诚实暴露。
 * 契约：用户取消 / 鉴权 / 配置类为「硬不可降级」最先判定；InvalidRequest 包裹的上下文超限仍可降级（既有语义）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyDegradableError } = require('../core/petri-server/helpers/model-fallback-policy.js');

test('W1-F16 负测：用户取消复合超时文案不可降级（不得在用户取消后自动续跑）', () => {
  assert.equal(classifyDegradableError('cancelled: timeout while waiting').degradable, false);
  assert.equal(classifyDegradableError('aborted (network timeout)').degradable, false);
});

test('W1-F16 负测：鉴权/配置类即使带 api_error / 5xx 字样也不可降级（诚实暴露）', () => {
  assert.equal(classifyDegradableError('401 api_error: invalid key').degradable, false);
  assert.equal(classifyDegradableError('403 forbidden (server error)').degradable, false);
  assert.equal(classifyDegradableError('no_api_key for provider').degradable, false);
});

test('W1-F16 既有语义保持：InvalidRequest 包裹的上下文超限仍可降级；纯服务端/配额可降级', () => {
  assert.deepEqual(classifyDegradableError('invalid_request_error: context_length_exceeded'), { degradable: true, category: 'context_window' });
  assert.deepEqual(classifyDegradableError('HTTP 503 service unavailable'), { degradable: true, category: 'server' });
  assert.deepEqual(classifyDegradableError('insufficient_quota'), { degradable: true, category: 'quota' });
  assert.equal(classifyDegradableError('bad request: unknown field').degradable, false);
});
