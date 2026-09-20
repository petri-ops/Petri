import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const budgetPath = path.join(here, 'startup-perf-budget.json');
const lib = require(path.join(here, '..', 'scripts', 'lib', 'startup-perf-budget.cjs'));
const { STAGES, parseBudget, evaluateBudget, assertBudgetNotWidened } = lib;

const rawBudget = JSON.parse(readFileSync(budgetPath, 'utf8'));

function summaryFrom(medians) {
  const out = {};
  for (const stage of STAGES) {
    out[stage] = medians[stage] == null ? null : { median: medians[stage], min: medians[stage], max: medians[stage], n: 5 };
  }
  return out;
}

test('真实预算文件形态合法且七段齐备', () => {
  const medians = parseBudget(rawBudget, budgetPath);
  for (const stage of STAGES) assert.ok(medians[stage] > 0, `${stage} 上限必须为正数`);
  assert.equal(rawBudget.schema, 'gewu/startup-perf-budget.v1');
});

test('基线与上限自洽：上限不低于基线中位数、也不宽于 +25%（防手改漂移）', () => {
  const medians = parseBudget(rawBudget, budgetPath);
  const basis = rawBudget.basis.medians;
  for (const stage of STAGES) {
    assert.ok(basis[stage] > 0, `${stage} 缺基线中位数`);
    assert.ok(medians[stage] >= basis[stage], `${stage} 上限低于基线中位数，首轮就会假红`);
    assert.ok(medians[stage] <= Math.ceil((basis[stage] * 1.25) / 1) + 1, `${stage} 上限宽于基线 +25%，门禁形同虚设`);
  }
});

test('采样在预算内 → 通过', () => {
  const medians = parseBudget(rawBudget, budgetPath);
  const result = evaluateBudget(summaryFrom(medians), medians);
  assert.equal(result.pass, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.checked.length, STAGES.length);
});

test('某段超预算 → 不通过并指名该段与超出比例', () => {
  const medians = parseBudget(rawBudget, budgetPath);
  const over = { ...medians, dataReady: medians.dataReady + 200 };
  const result = evaluateBudget(summaryFrom(over), medians);
  assert.equal(result.pass, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].stage, 'dataReady');
  assert.equal(result.violations[0].reason, 'median_over_budget');
  assert.ok(result.violations[0].overPct > 0);
});

test('段缺失 → 判不通过（门禁不接受「没采到」当通过）', () => {
  const medians = parseBudget(rawBudget, budgetPath);
  const summary = summaryFrom(medians);
  summary.preload = null;
  const result = evaluateBudget(summary, medians);
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((v) => v.stage === 'preload' && v.reason === 'measured_missing'));
});

test('棘轮：收缩放行、放宽抛错、缺段视同放宽', () => {
  const current = parseBudget(rawBudget, budgetPath);
  assert.doesNotThrow(() => assertBudgetNotWidened(rawBudget, rawBudget));
  const tightened = assertBudgetNotWidened(rawBudget, { ...rawBudget, medians: { ...current, dataReady: current.dataReady - 50 } });
  assert.deepEqual(tightened.tightened, ['dataReady']);
  assert.throws(
    () => assertBudgetNotWidened(rawBudget, { ...rawBudget, medians: { ...current, dataReady: current.dataReady + 1 } }),
    /只许收缩/
  );
  const partial = { ...current };
  delete partial.firstPaint;
  assert.throws(() => assertBudgetNotWidened(rawBudget, { ...rawBudget, medians: partial }), /firstPaint/);
});

test('schema 或上限非法 → 直接抛错（不静默降级）', () => {
  assert.throws(() => parseBudget({ schema: 'other', medians: { mainReady: 1 } }), /schema 不符/);
  assert.throws(() => parseBudget({ schema: rawBudget.schema, medians: { ...rawBudget.medians, preload: 0 } }), /preload/);
  assert.throws(() => parseBudget({ schema: rawBudget.schema, medians: { ...rawBudget.medians, bogus: 1 } }), /未知段/);
});
