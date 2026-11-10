import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparePerf } from '../scripts/block350-perf-gate.mjs';
import { adjudicateBaselineBinding, HOT_PATH_FILES, computeHotPathSha } from '../scripts/lib/block350-hot-paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'test', 'perf-baseline.json');

const baseScenario = (medianMs, tolerancePct = 60) => ({
  metric: 'test', unit: 'ms', samples: [medianMs], medianMs, tolerancePct, runs: 5,
  noiseSources: 'test', env: 'test',
});

test('block350 gate: 正常样本判绿（基线中位 + 容差内）', () => {
  const baseline = { scenarios: { warm_backend_spawn: baseScenario(543, 60) } };
  const current = { scenarios: { warm_backend_spawn: { sampleMs: 600 } } }; // 阈值 869
  const { ok, rows } = comparePerf(current, baseline);
  assert.equal(ok, true);
  assert.equal(rows[0].status, 'green');
});

test('block350 gate: 劣化指标判红（样本超中位×(1+容差)）', () => {
  const baseline = { scenarios: { warm_backend_spawn: baseScenario(543, 60) } };
  const current = { scenarios: { warm_backend_spawn: { sampleMs: 900 } } }; // > 869
  const { ok, rows } = comparePerf(current, baseline);
  assert.equal(ok, false);
  assert.equal(rows[0].status, 'red');
});

test('block350 gate L0-2: +30% 慢样本必红（收紧容差 25% 下）', () => {
  const baseline = { scenarios: { warm_backend_spawn: baseScenario(800, 25) } };
  const current = { scenarios: { warm_backend_spawn: { sampleMs: 1040 } } }; // 阈值 1000
  const { ok, rows } = comparePerf(current, baseline);
  assert.equal(ok, false, '1040 > 1000（800×1.25）：+30% 慢样本必须红');
  assert.equal(rows[0].status, 'red');
});

test('block350 gate: 抬高基线文件不影响判红（阈值随基线走，样本相对基线判定）', () => {
  // 恶意/误操作把基线 median 调大 10 倍 → 同一劣化样本相对新基线「变绿」；
  // 该情形由基线文件入 git 棘轮 + 本测试固化「阈值公式」保证审计可复核（改基线=显式 diff），
  // 且 L0-2 后基线绑定 host/热路径 sha，换源码/换机不再能沿用旧基线。
  const baseline = { scenarios: { warm_backend_spawn: baseScenario(5430, 60) } };
  const current = { scenarios: { warm_backend_spawn: { sampleMs: 900 } } };
  const { ok } = comparePerf(current, baseline);
  assert.equal(ok, true); // 阈值=8690 → 900 绿（公式行为，基线改动必须走 diff 审查）
});

test('block350 gate: 无当次样本 fail-closed 判红', () => {
  const baseline = { scenarios: { warm_backend_spawn: baseScenario(543, 60) } };
  const { ok, rows } = comparePerf({ scenarios: {} }, baseline);
  assert.equal(ok, false);
  assert.equal(rows[0].status, 'red');
  assert.match(rows[0].detail, /fail-closed/);
});

test('block350 gate L0-2 负测: 基线 skipped 默认判红（缺样本不得即绿——L-28）', () => {
  const baseline = { scenarios: { packaged_start: { skipped: true, reason: '无产物' } } };
  const { ok, rows, coverageGaps } = comparePerf({ scenarios: {} }, baseline);
  assert.equal(ok, false);
  assert.equal(rows[0].status, 'red');
  assert.match(rows[0].detail, /L-28/);
  assert.equal(coverageGaps.length, 0);
});

test('block350 gate L0-2: PETRI_ALLOW_SKIP=1 显式放行 skipped 并计覆盖缺口（不冒充覆盖）', () => {
  const baseline = { scenarios: { packaged_start: { skipped: true, reason: '无产物' } } };
  const { ok, rows, coverageGaps } = comparePerf({ scenarios: {} }, baseline, { allowSkip: true });
  assert.equal(ok, true);
  assert.equal(rows[0].status, 'skipped-allowed');
  assert.deepEqual(coverageGaps, [{ name: 'packaged_start', reason: '无产物' }]);
});

test('block350 gate L0-2 负测: 当次采集 skipped（基线有样本）→ 判红（不冒充覆盖）', () => {
  const baseline = { scenarios: { packaged_start: baseScenario(429, 30) } };
  const current = { scenarios: { packaged_start: { skipped: true, reason: '采样失败' } } };
  const { ok, rows } = comparePerf(current, baseline);
  assert.equal(ok, false);
  assert.equal(rows[0].status, 'red');
});

// ── BLOCK-359 双判据（绝对噪声地板 + 相对容差）───────────────────────────────
// 低耗时场景（20ms 量级）纯百分比容差落在调度噪声带内（实测 32/34/36ms 跨 32ms 阈值
// FAIL/PASS/FAIL）；双判据=阈值取 max(中位×(1+容差), 中位+absoluteSlackMs)。

test('block359 gate: 低耗时场景噪声地板生效——噪声带内样本判绿（修复前判红）', () => {
  const baseline = { scenarios: { long_conversation: { ...baseScenario(20), absoluteSlackMs: 20 } } };
  const current = { scenarios: { long_conversation: { sampleMs: 36 } } };
  const { ok, rows } = comparePerf(current, baseline);
  assert.equal(ok, true, '36ms 是实测噪声带内样本（中位 20 + 地板 20 = 40 阈值），不得判红');
  assert.equal(rows[0].status, 'green');
  assert.match(rows[0].detail, /地板/);
});

test('block359 gate: 高耗时场景相对容差仍主导（地板不抬阈值）', () => {
  const baseline = { scenarios: { warm_backend_spawn: { ...baseScenario(546, 60), absoluteSlackMs: 20 } } };
  const current = { scenarios: { warm_backend_spawn: { sampleMs: 900 } } };
  const { ok, rows } = comparePerf(current, baseline);
  assert.equal(ok, false, '900 > max(874, 566)=874：相对容差主导，劣化照判红');
  assert.equal(rows[0].status, 'red');
});

test('block359 gate: 植入慢样本必红（噪声地板不放过真实退化）', () => {
  const baseline = { scenarios: { long_conversation: { ...baseScenario(20), absoluteSlackMs: 20 } } };
  const current = { scenarios: { long_conversation: { sampleMs: 400 } } };
  const { ok, rows } = comparePerf(current, baseline);
  assert.equal(ok, false);
  assert.equal(rows[0].status, 'red');
});

test('block359 gate: 未声明 absoluteSlackMs 的场景行为逐字节不变（纯百分比）', () => {
  const baseline = { scenarios: { long_conversation: baseScenario(20) } };
  const current = { scenarios: { long_conversation: { sampleMs: 33 } } };
  const { ok, rows } = comparePerf(current, baseline);
  assert.equal(ok, false, '33 > 32：无地板声明时保持旧行为（棘轮语义不变）');
  assert.equal(rows[0].status, 'red');
});

// ── L0-2 基线绑定（L-30：host + 热路径组合 sha）────────────────────────────

test('block350 gate L0-2 负测: host 漂移 → 基线失效要求重采', () => {
  const binding = adjudicateBaselineBinding(
    { host: { platform: 'linux-x64', cpus: 4, node: 'v20.0.0' }, coreSha: 'x' },
    { host: { platform: 'darwin-arm64', cpus: 8, node: 'v24.16.0' }, coreSha: 'x' },
  );
  assert.equal(binding.ok, false);
  assert.ok(binding.issues.some((i) => i.includes('host.platform')));
  assert.ok(binding.issues.some((i) => i.includes('host.cpus')));
  assert.ok(binding.issues.some((i) => i.includes('host.node')));
});

test('block350 gate L0-2 负测: 热路径文件改动 → coreSha 失配要求重采', () => {
  const binding = adjudicateBaselineBinding(
    { host: { platform: 'darwin-arm64', cpus: 8, node: 'v24.16.0' }, coreSha: '0000000000000000' },
    { host: { platform: 'darwin-arm64', cpus: 8, node: 'v24.16.0' }, coreSha: computeHotPathSha(ROOT) },
  );
  assert.equal(binding.ok, false);
  assert.ok(binding.issues.some((i) => i.includes('热路径源码变化')));
  assert.equal(HOT_PATH_FILES.length >= 5, true);
});

test('block350: 基线文件在场且四场景齐备 + L0-2 绑定字段齐备（skipped 须带原因）', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const names = ['warm_backend_spawn', 'long_conversation', 'big_project_tree', 'packaged_start'];
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
  // L0-2 绑定：host/coreSha/coldStartTrueLeg 在场，且热路径 sha 与当前源码一致（否则 gate exit 2）
  assert.ok(baseline.host, '基线缺 host 绑定');
  assert.ok(baseline.coreSha, '基线缺 coreSha 绑定');
  assert.equal(baseline.coreSha, computeHotPathSha(ROOT), '基线热路径 sha 与当前源码不一致——重采基线');
  assert.ok(baseline.coldStartTrueLeg?.script, '基线缺 coldStartTrueLeg 指针');
  assert.ok(fs.existsSync(path.join(ROOT, baseline.coldStartTrueLeg.script)), 'coldStartTrueLeg 脚本缺失');
});
