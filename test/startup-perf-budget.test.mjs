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
const { STAGES, resolvePlatformBudget, evaluateBudget, assertBudgetNotWidened } = lib;

const rawBudget = JSON.parse(readFileSync(budgetPath, 'utf8'));

function summaryFrom(medians) {
  const out = {};
  for (const stage of STAGES) {
    out[stage] = medians[stage] == null ? null : { median: medians[stage], min: medians[stage], max: medians[stage], n: 5 };
  }
  return out;
}

test('win32 档预算形态合法且七段齐备', () => {
  const ceilings = resolvePlatformBudget(rawBudget, 'win32', budgetPath);
  for (const stage of STAGES) assert.ok(ceilings[stage] > 0, `${stage} 上限必须为正数`);
});

test('darwin 档预算形态合法且七段齐备（BK-08 Mac 会话实测建立）', () => {
  const ceilings = resolvePlatformBudget(rawBudget, 'darwin', budgetPath);
  for (const stage of STAGES) assert.ok(ceilings[stage] > 0, `${stage} 上限必须为正数`);
  // 本机实测档：basis.machine 必须是 darwin 实测痕迹，禁止从 win32 复制数字
  assert.match(rawBudget.platforms.darwin.basis.machine, /darwin/i);
});

test('跨平台不得套用：无本平台档直接抛错并给出建基线方法', () => {
  assert.throws(
    () => resolvePlatformBudget(rawBudget, 'linux', budgetPath),
    /无 linux 平台基线[\s\S]*block101-startup-timeline[\s\S]*×1\.10/
  );
  // 缺档平台在 missingPlatforms 留建基线方法指引（darwin 已由 BK-08 实测建档）
  assert.match(rawBudget.missingPlatforms.linux, /不得跨平台复制数字/);
});

test('基线与上限自洽：上限不低于基线中位数、也不宽于 +25%（防手改漂移）', () => {
  for (const platform of ['win32', 'darwin']) {
    const ceilings = resolvePlatformBudget(rawBudget, platform, budgetPath);
    const basis = rawBudget.platforms[platform].basis.medians;
    for (const stage of STAGES) {
      assert.ok(basis[stage] > 0, `${platform} ${stage} 缺基线中位数`);
      assert.ok(ceilings[stage] >= basis[stage], `${platform} ${stage} 上限低于基线中位数，首轮就会假红`);
      assert.ok(ceilings[stage] <= basis[stage] * 1.25 + 1, `${platform} ${stage} 上限宽于基线 +25%，门禁形同虚设`);
    }
  }
});

test('采样在预算内 → 通过', () => {
  const ceilings = resolvePlatformBudget(rawBudget, 'win32', budgetPath);
  const result = evaluateBudget(summaryFrom(ceilings), ceilings);
  assert.equal(result.pass, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.checked.length, STAGES.length);
});

test('某段超预算 → 不通过并指名该段与超出比例', () => {
  const ceilings = resolvePlatformBudget(rawBudget, 'win32', budgetPath);
  const over = { ...ceilings, dataReady: ceilings.dataReady + 200 };
  const result = evaluateBudget(summaryFrom(over), ceilings);
  assert.equal(result.pass, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].stage, 'dataReady');
  assert.equal(result.violations[0].reason, 'median_over_budget');
  assert.ok(result.violations[0].overPct > 0);
});

test('段缺失 → 判不通过（门禁不接受「没采到」当通过）', () => {
  const ceilings = resolvePlatformBudget(rawBudget, 'win32', budgetPath);
  const summary = summaryFrom(ceilings);
  summary.preload = null;
  const result = evaluateBudget(summary, ceilings);
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((v) => v.stage === 'preload' && v.reason === 'measured_missing'));
});

test('棘轮：收缩放行、放宽抛错、缺段视同放宽', () => {
  const current = resolvePlatformBudget(rawBudget, 'win32', budgetPath);
  assert.doesNotThrow(() => assertBudgetNotWidened(current, current));
  const tightened = assertBudgetNotWidened(current, { ...current, dataReady: current.dataReady - 50 });
  assert.deepEqual(tightened.tightened, ['dataReady']);
  assert.throws(
    () => assertBudgetNotWidened(current, { ...current, dataReady: current.dataReady + 1 }),
    /只许收缩/
  );
  const partial = { ...current };
  delete partial.firstPaint;
  assert.throws(() => assertBudgetNotWidened(current, partial), /firstPaint/);
});

test('schema 或上限非法 → 直接抛错（不静默降级）', () => {
  assert.throws(() => resolvePlatformBudget({ schema: 'other', platforms: {} }, 'win32'), /schema 不符/);
  assert.throws(() => resolvePlatformBudget({ schema: 'v2-only-shape-check', platforms: null }, 'win32'), /schema 不符/);
  const ceilings = resolvePlatformBudget(rawBudget, 'win32', budgetPath);
  assert.throws(
    () => resolvePlatformBudget({ ...rawBudget, platforms: { win32: { medians: { ...ceilings, preload: 0 } } } }, 'win32'),
    /preload/
  );
  assert.throws(
    () => resolvePlatformBudget({ ...rawBudget, platforms: { win32: { medians: { ...ceilings, bogus: 1 } } } }, 'win32'),
    /未知段/
  );
});
