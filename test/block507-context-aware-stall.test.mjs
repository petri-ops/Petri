/**
 * BLOCK-507 大上下文韧性票 1 — 上下文感知看门狗首包预算（HK-01 红绿先行）。
 *
 * 用户 2026-11-19 发令「彻底解决」（停滞多次折磨 + 后续可能有 1M 量级上下文）。
 * 缺口：BLOCK-338 两段阈值（90s 首 token）为固定值——1M 量级 prefill 的服务端
 * 首包耗时远超 90s，固定阈值必然误杀大上下文首次请求（同 BLOCK-338 注释
 * 「45s 稳定误杀 45002ms」的事故形态，只是量级更大）。
 *
 * 裁决形态（docs/block507-context-aware-stall-plan.md）：
 *   - 预估 token：CJK≈1 token/字符、其它≈1/4；messages + tools 全量计入
 *     （16k 工具定义实测显著拉长 prefill——BLOCK-338 注释在案）。
 *   - 首包预算 = base(env 首段，默认 90s) + ceil(预估 token / 3000) × 1s，封顶 600s；
 *     idle 段（60s）不随体量缩放（token 流一旦开始，中途 60s 静默仍是死亡信号）。
 *   - env 语义不变：PETRI_STREAM_STALL_FIRST_MS 是 base 预算而非硬上限。
 *   - 常数为保守下限，待真实 1M 数据再校准（同 BLOCK-338 45→90s 校准先例）。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  estimateRequestTokens,
  resolveRequestStallThresholds,
  resolveStallThresholds,
} = require('../core/shared-backend/llm-providers/stream-stall-watchdog.js');

test('BLOCK-507 ① token 估算：CJK≈1/字符、其它≈1/4、tools 计入、空体=0', () => {
  assert.equal(estimateRequestTokens(null), 0);
  assert.equal(estimateRequestTokens({}), 0);
  // 400 个 CJK 字符 ≈ 400 token
  const cjk = { messages: [{ role: 'user', content: '测'.repeat(400) }] };
  const estCjk = estimateRequestTokens(cjk);
  assert.ok(estCjk >= 390 && estCjk <= 420, `CJK 400 字应估 ~400 token，实际 ${estCjk}`);
  // 400 个 ASCII 字符 ≈ 100 token
  const ascii = { messages: [{ role: 'user', content: 'a'.repeat(400) }] };
  const estAscii = estimateRequestTokens(ascii);
  assert.ok(estAscii >= 95 && estAscii <= 105, `ASCII 400 字应估 ~100 token，实际 ${estAscii}`);
  // tools 计入（16k 工具定义拉长 prefill 的实测形态）
  const withTools = { messages: [{ role: 'user', content: 'hi' }], tools: [{ function: { description: 'x'.repeat(8000) } }] };
  assert.ok(estimateRequestTokens(withTools) > estimateRequestTokens({ messages: [{ role: 'user', content: 'hi' }] }), 'tools 必须计入估算');
});

test('BLOCK-507 ② 小请求不缩放：base 预算原样（90s 默认）', () => {
  const small = { messages: [{ role: 'user', content: 'hi' }] };
  const t = resolveRequestStallThresholds(small, {});
  assert.equal(t.firstTokenMs, 90_000, '小请求（不足 3000 token）不缩放，base 90s');
  assert.equal(t.idleTokenMs, 60_000, 'idle 段不随体量缩放');
  assert.equal(t.firstTokenScaled, false);
});

test('BLOCK-507 ③ 大请求缩放：1M 量级预填不再被固定 90s 误杀（封顶 600s）', () => {
  // ~400K token 量级（120 万 ASCII 字符）→ 90s + ceil(400000/3000)s = 90+134 = 224s
  const big = { messages: [{ role: 'user', content: 'a'.repeat(1_200_000) }] };
  const t = resolveRequestStallThresholds(big, {});
  assert.ok(t.estimatedTokens >= 299_000 && t.estimatedTokens <= 301_500, `预估 ~300K token（role 等小串计入），实际 ${t.estimatedTokens}`);
  assert.equal(t.firstTokenScaled, true);
  assert.equal(t.firstTokenMs, 90_000 + Math.floor(t.estimatedTokens / 3000) * 1000, '首包预算 = base + floor(预估/3000) 秒（每满 3000 加 1s）');
  // 封顶：~1.6M token（640 万字符）→ 90+534=624 > 600 → 600s
  const huge = { messages: [{ role: 'user', content: 'a'.repeat(6_400_000) }] };
  const capped = resolveRequestStallThresholds(huge, {});
  assert.equal(capped.firstTokenMs, 600_000, '首包预算封顶 600s');
  assert.equal(capped.idleTokenMs, 60_000, '封顶不影响 idle 段');
});

test('BLOCK-507 ④ env base 语义不变：PETRI_STREAM_STALL_FIRST_MS 是 base 预算而非硬上限', () => {
  process.env.PETRI_STREAM_STALL_FIRST_MS = '120000';
  try {
    const small = resolveRequestStallThresholds({ messages: [{ role: 'user', content: 'hi' }] }, process.env);
    assert.equal(small.firstTokenMs, 120_000, 'env base 原样生效');
    const big = resolveRequestStallThresholds({ messages: [{ role: 'user', content: 'a'.repeat(1_200_000) }] }, process.env);
    assert.ok(big.firstTokenMs > 120_000 && big.firstTokenMs <= 600_000, 'env base + 体量缩放叠加且封顶生效');
    assert.ok(big.firstTokenMs <= 600_000, '封顶仍生效');
  } finally {
    delete process.env.PETRI_STREAM_STALL_FIRST_MS;
  }
});

test('BLOCK-507 ⑤ 既有 resolveStallThresholds 零回归（无体量入参时行为不变）', () => {
  const base = resolveStallThresholds({});
  assert.equal(base.firstTokenMs, 90_000);
  assert.equal(base.idleTokenMs, 60_000);
});
