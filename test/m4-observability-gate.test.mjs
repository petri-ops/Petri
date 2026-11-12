/**
 * gate:long-task-observability 门自身防假绿负测（M4 / BLOCK-430）。
 * 注入篡改模块，验证 6 类判据必红；不改生产文件、不放宽基线。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateObservability, collectObservabilityModule } from '../scripts/m-blueprint-m4-observability-gate.mjs';

test('门基线：真实模块判据全绿', () => {
  assert.equal(adjudicateObservability(collectObservabilityModule()).length, 0);
});

test('植入「fixture 用真实 Provider / 出网」→ FIXTURE_NOT_LOCAL_MOCK 必红', () => {
  const M = { ...collectObservabilityModule(), generateFixture: () => ({ manifest: { turnCount: 1000, provider: 'real', network: true }, messages: [], parts: [], todos: [] }) };
  assert.ok(adjudicateObservability(M).some((i) => i.includes('FIXTURE_NOT_LOCAL_MOCK')));
});

test('植入「manifest 篡改放过」→ FIXTURE_TAMPER_NOT_RED 必红', () => {
  const M = { ...collectObservabilityModule(), verifyFixture: () => ({ ok: true, issues: [] }) };
  assert.ok(adjudicateObservability(M).some((i) => i.includes('FIXTURE_TAMPER_NOT_RED')));
});

test('植入「合成基线宣称稳定完成长任务」→ BASELINE_OVERCLAIM 必红', () => {
  const M = { ...collectObservabilityModule(), adjudicateLongTaskBaseline: () => ({ successRate: 1, claimStableLongTask: true }) };
  assert.ok(adjudicateObservability(M).some((i) => i.includes('BASELINE_OVERCLAIM')));
});

test('植入「traceId 不贯穿」→ TRACE_ID_NOT_PROPAGATED 必红', () => {
  const M = { ...collectObservabilityModule(), createTraceProjection: () => ({ append: () => ({}), persist: () => ({ spans: [] }), count: 5, spans: [{ traceId: '' }, { traceId: '' }, { traceId: '' }, { traceId: '' }, { traceId: '' }] }) };
  assert.ok(adjudicateObservability(M).some((i) => i.includes('TRACE_ID_NOT_PROPAGATED')));
});

test('植入「失败请求不记账」→ FAILED_REQUEST_NOT_ACCOUNTED 必红', () => {
  const M = { ...collectObservabilityModule(), createUsageLedger: () => ({ record: () => ({}), recordFailed: () => ({}), byLayer: () => [], events: [] }) };
  assert.ok(adjudicateObservability(M).some((i) => i.includes('FAILED_REQUEST_NOT_ACCOUNTED')));
});

test('植入「400+ 节点放过」→ DOM_BUDGET_NOT_RED 必红', () => {
  const M = { ...collectObservabilityModule(), adjudicateUserPerceivedPerf: () => ({ ok: true, issues: [] }) };
  assert.ok(adjudicateObservability(M).some((i) => i.includes('DOM_BUDGET_NOT_RED')));
});
