/**
 * M0-1 / M0-2 植入必红负测（BLOCK-426，HK-01 红绿先行的判据侧证据）。
 *
 * 复用既有纯函数，不新建第二套判据：
 *   - compareWarnDomains（scripts/lint-ledger-verify.mjs，L-88 warnings 分域只减棘轮）
 *   - comparePerf（scripts/block350-perf-gate.mjs，L-27/L-28 性能判据）
 *   - adjudicateBaselineBinding（scripts/lib/block350-hot-paths.mjs，L-30 基线绑定）
 *
 * lint-ledger-verify.mjs 顶层无条件 main()（会跑全量 eslint 并写 process.exitCode），
 * 故 warnings 三域负测走**子进程隔离**调用同一纯函数：既不改既有脚本，也不建第二套判据。
 * 这些是当次现跑的植入必红，不是复用历史「全绿」结论。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { comparePerf } from '../scripts/block350-perf-gate.mjs';
import { adjudicateBaselineBinding } from '../scripts/lib/block350-hot-paths.mjs';

const CHILD = `
import { compareWarnDomains } from './scripts/lint-ledger-verify.mjs';
const baseline = { domains: { production: 1489, test: 417, scripts: 539 }, total: 2445 };
const out = {};
for (const domain of ['production', 'test', 'scripts']) {
  const current = Object.create(null);
  for (const [key, value] of Object.entries(baseline.domains)) current[key] = value;
  current[domain] = Object.getOwnPropertyDescriptor(current, domain).value + 1;
  out[domain] = compareWarnDomains(current, baseline).issues;
}
const shrunk = { production: 1488, test: 416, scripts: 538 };
const down = compareWarnDomains(shrunk, baseline);
out.improvements = down.improvements;
out.downIssues = down.issues;
process.stdout.write('@@M0@@' + JSON.stringify(out) + '@@END@@');
`;

test('M0-1 warnings 分域只减：三域各植入 +1 必红（3/3）', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { encoding: 'utf8' });
  const marker = r.stdout?.match(/@@M0@@([\s\S]*?)@@END@@/);
  assert.ok(marker, `子进程纯函数输出缺失：${r.stderr?.slice(0, 300)}`);
  const out = JSON.parse(marker[1]);
  for (const [domain, issues] of Object.entries(out)) {
    if (domain === 'improvements' || domain === 'downIssues') continue;
    assert.ok(issues.length > 0, `${domain} 域新增 warning 必须判红`);
  }
  assert.equal(out.downIssues.length, 0, '三域齐降不得判红');
  assert.ok(out.improvements.length > 0, '下降须提示 --update 下调');
});

const PACKAGED_BASELINE = {
  host: { platform: 'darwin-arm64', cpus: 8, node: 'v24.16.0' },
  coreSha: '7493447930e3f558',
  scenarios: { packaged_start: { medianMs: 379, tolerancePct: 30 } },
};

test('M0-2 packaged_start 慢样本必红（当次 5/5 读数逐一回灌）', () => {
  for (const sampleMs of [496, 501, 504, 512, 516]) {
    const { ok, rows } = comparePerf({ scenarios: { packaged_start: { sampleMs } } }, PACKAGED_BASELINE);
    assert.equal(ok, false, `${sampleMs}ms > 阈值 493ms 必须判红，不得被容差吸收`);
    assert.equal(rows[0].status, 'red');
  }
});

test('M0-2 植入「放宽容差」必不得改写判定（禁抬阈值）', () => {
  const widened = { ...PACKAGED_BASELINE, scenarios: { packaged_start: { medianMs: 379, tolerancePct: 60 } } };
  const { ok } = comparePerf({ scenarios: { packaged_start: { sampleMs: 516 } } }, widened);
  assert.equal(ok, true, '容差 60% 会把 516ms 判绿——这正是本轮红线禁止的动作');
  const { ok: strictOk } = comparePerf({ scenarios: { packaged_start: { sampleMs: 516 } } }, PACKAGED_BASELINE);
  assert.equal(strictOk, false, '原容差 30% 仍判红 ⇒ 放行只能来自抬阈值，不得冒充修复');
});

test('M0-2 coreSha 绑定：热路径 sha 漂移必要求重采（fail-closed）', () => {
  const host = PACKAGED_BASELINE.host;
  assert.equal(adjudicateBaselineBinding(PACKAGED_BASELINE, { host, coreSha: '7493447930e3f558' }).ok, true);
  const drifted = adjudicateBaselineBinding(PACKAGED_BASELINE, { host, coreSha: '0000000000000000' });
  assert.equal(drifted.ok, false);
  assert.ok(drifted.issues.some((i) => i.includes('coreSha') || i.includes('热路径')));
});
