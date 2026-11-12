/**
 * gate:tool-capability 门自身防假绿负测（M3 / BLOCK-429）。
 * 注入篡改模块，验证 6 类判据必红；不改生产文件、不放宽基线。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateCapability, collectCapabilityModule } from '../scripts/m-blueprint-m3-capability-gate.mjs';

test('门基线：真实模块判据全绿', () => {
  assert.equal(adjudicateCapability(collectCapabilityModule()).length, 0);
});

test('植入「compact 缺字段不判红」→ COMPACT_MISSING_FIELD_NOT_RED 必红', () => {
  const M = { ...collectCapabilityModule(), buildCompactSummary: () => ({ ok: true }) };
  assert.ok(adjudicateCapability(M).some((i) => i.includes('COMPACT_MISSING_FIELD_NOT_RED')));
});

test('植入「跨表漂移放过」→ CONTRACT_DRIFT_NOT_RED 必红', () => {
  const M = { ...collectCapabilityModule(), adjudicateToolSurface: () => ({ ok: true }) };
  assert.ok(adjudicateCapability(M).some((i) => i.includes('CONTRACT_DRIFT_NOT_RED')));
});

test('植入「无 broker 也放行」→ PERMISSION_NOT_FAIL_CLOSED 必红', () => {
  const M = { ...collectCapabilityModule(), adjudicatePermission: () => ({ decision: 'allow' }) };
  assert.ok(adjudicateCapability(M).some((i) => i.includes('PERMISSION_NOT_FAIL_CLOSED')));
});

test('植入「stopTurn 后留悬挂调用」→ DANGLING_TOOL_CALL_AFTER_STOP 必红', () => {
  const M = { ...collectCapabilityModule(), planToolTopology: () => ({ ok: true, syntheticResults: [] }) };
  assert.ok(adjudicateCapability(M).some((i) => i.includes('DANGLING_TOOL_CALL_AFTER_STOP')));
});

test('植入「超预算不落 artifact」→ RESULT_BUDGET_ARTIFACT_MISSING 必红', () => {
  const M = { ...collectCapabilityModule(), projectResultBudget: () => ({ truncated: true, artifact: null }) };
  assert.ok(adjudicateCapability(M).some((i) => i.includes('RESULT_BUDGET_ARTIFACT_MISSING')));
});

test('植入「untrusted 包装失效」→ UNTRUSTED_WRAPPER_BROKEN 必红', () => {
  const M = { ...collectCapabilityModule(), wrapUntrusted: () => ({ text: 'raw', instructionLike: true }) };
  assert.ok(adjudicateCapability(M).some((i) => i.includes('UNTRUSTED_WRAPPER_BROKEN')));
});
