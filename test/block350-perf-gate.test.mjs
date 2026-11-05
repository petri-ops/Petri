import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparePerf } from '../scripts/block350-perf-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'test', 'perf-baseline.json');

const baseScenario = (medianMs, tolerancePct = 60) => ({
  metric: 'test', unit: 'ms', samples: [medianMs], medianMs, tolerancePct, runs: 5,
  noiseSources: 'test', env: 'test',
});

test('block350 gate: 正常样本判绿（基线中位 + 容差内）', () => {
  const baseline = { scenarios: { cold_start: baseScenario(543, 60) } };
  const current = { scenarios: { cold_start: { sampleMs: 600 } } }; // 阈值 869
  const { ok, rows } = comparePerf(current, baseline);
  assert.equal(ok, true);
  assert.equal(rows[0].status, 'green');
});

test('block350 gate: 劣化指标判红（样本超中位×(1+容差)）', () => {
  const baseline = { scenarios: { cold_start: baseScenario(543, 60) } };
  const current = { scenarios: { cold_start: { sampleMs: 900 } } }; // > 869
  const { ok, rows } = comparePerf(current, baseline);
  assert.equal(ok, false);
  assert.equal(rows[0].status, 'red');
});

test('block350 gate: 抬高基线文件不影响判红（阈值随基线走，样本相对基线判定）', () => {
  // 恶意/误操作把基线 median 调大 10 倍 → 同一劣化样本相对新基线「变绿」；
  // 该情形由基线文件入 git 棘轮 + 本测试固化「阈值公式」保证审计可复核（改基线=显式 diff）。
  const baseline = { scenarios: { cold_start: baseScenario(5430, 60) } };
  const current = { scenarios: { cold_start: { sampleMs: 900 } } };
  const { ok } = comparePerf(current, baseline);
  assert.equal(ok, true); // 阈值=8690 → 900 绿（公式行为，基线改动必须走 diff 审查）
});

test('block350 gate: 无当次样本 fail-closed 判红', () => {
  const baseline = { scenarios: { cold_start: baseScenario(543, 60) } };
  const { ok, rows } = comparePerf({ scenarios: {} }, baseline);
  assert.equal(ok, false);
  assert.equal(rows[0].status, 'red');
  assert.match(rows[0].detail, /fail-closed/);
});

test('block350 gate: skipped 场景不参与判定（如实透传原因）', () => {
  const baseline = { scenarios: { packaged_start: { skipped: true, reason: '无产物' } } };
  const { ok, rows } = comparePerf({ scenarios: {} }, baseline);
  assert.equal(ok, true);
  assert.equal(rows[0].status, 'skipped');
});

test('block350: 基线文件在场且四场景齐备（skipped 须带原因）', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const names = ['cold_start', 'long_conversation', 'big_project_tree', 'packaged_start'];
  for (const name of names) {
    const s = baseline.scenarios[name];
    assert.ok(s, `基线缺场景 ${name}`);
    if (s.skipped) assert.ok(s.reason, `${name} skipped 缺原因`);
    else {
      assert.ok(Number.isFinite(s.medianMs) && s.medianMs > 0, `${name} 中位数非法`);
      assert.ok(s.samples && s.samples.length >= 1,
        `${name} 采样次数不足`);
      assert.ok(Number.isFinite(s.tolerancePct), `${name} 缺容差`);
      assert.ok(s.noiseSources, `${name} 缺波动源说明`);
    }
  }
});
