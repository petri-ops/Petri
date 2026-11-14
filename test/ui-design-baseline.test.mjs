/**
 * UI-D0 (BLOCK-415) — 对账基线机械门负测。
 * 契约：基线与报告 §0/§1 逐字段相等；篡改 / 删字段 / 未登记字段 / 锚点缺失必红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BASELINE_PATH, PLAN_PATH, readBaseline, readPlan, verifyBaseline, checkFiles,
  FIELD_CONTRACTS,
} from '../scripts/ui-design-baseline.mjs';

const baseline = readBaseline();
const plan = readPlan();
const clone = (o) => JSON.parse(JSON.stringify(o));

test('real baseline matches assessment report §0/§1 (gate:ui-baseline)', () => {
  assert.deepEqual(checkFiles(), []);
  assert.equal(fs.existsSync(BASELINE_PATH), true);
  assert.equal(fs.existsSync(PLAN_PATH), true);
});

test('every field contract resolves exactly one anchored row', () => {
  assert.ok(FIELD_CONTRACTS.length >= 20);
  for (const c of FIELD_CONTRACTS) {
    assert.ok(c.paths.length >= 1, `${c.anchor} must declare paths`);
    assert.ok(['0', '1'].includes(c.section));
  }
});

test('tampering a frozen §1 number is rejected (植入篡改必红)', () => {
  const b = clone(baseline);
  b.visualDebt.numericZIndexOccurrences += 1;
  assert.ok(verifyBaseline(b, plan).some((p) => p.includes('numericZIndexOccurrences')));
});

test('deleting a required top-level field is rejected (删字段必红)', () => {
  const b = clone(baseline);
  delete b.visualDebt;
  assert.ok(verifyBaseline(b, plan).some((p) => p.includes('missing top-level field: visualDebt')));
});

test('an unregistered top-level field is rejected (植入未登记字段必红)', () => {
  const b = clone(baseline);
  b.privateScoreOverride = 5;
  assert.ok(verifyBaseline(b, plan).some((p) => p.includes('unregistered top-level field')));
});

test('a removed report anchor is rejected (报告 §1 被改必红)', () => {
  const broken = plan.split('\n').filter((l) => !l.includes('`;;` 双分号')).join('\n');
  assert.ok(verifyBaseline(baseline, broken).some((p) => p.includes('matched 0 rows')));
});

test('schema drift, score drift and W-attribution drift are rejected', () => {
  const a = clone(baseline); a.schema = 'other';
  assert.ok(verifyBaseline(a, plan).some((p) => p.includes('schema mismatch')));
  const b = clone(baseline); b.staticScores.targetPerDimension = 5.0;
  assert.ok(verifyBaseline(b, plan).some((p) => p.includes('targetPerDimension')));
  const c = clone(baseline); c.gates.uiAuditCheck.result = 'PASS';
  assert.ok(verifyBaseline(c, plan).some((p) => p.includes('uiAuditCheck.result')));
});

test('plan.started / startedAt / ruling must stay frozen (D0 留痕不可回退)', () => {
  const a = clone(baseline); a.plan.started = false;
  assert.ok(verifyBaseline(a, plan).some((p) => p.includes('plan.started')));
  const b = clone(baseline); delete b.plan.startedAt;
  assert.ok(verifyBaseline(b, plan).some((p) => p.includes('startedAt')));
  assert.equal(typeof baseline.plan.ruling, 'string');
});

test('frozen waves remain the six UI-D phases', () => {
  const b = clone(baseline); b.plan.waves.pop();
  assert.ok(verifyBaseline(b, plan).some((p) => p.includes('plan.waves')));
});
