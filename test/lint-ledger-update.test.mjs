/**
 * BLOCK-468 / S4 — lint-ledger --update 死代码路径修复的工具负测（HK-01 判据侧红绿，BLOCK-426 先例）。
 *
 * 纯函数 planWarnBaselineUpdate(current, baseline) 三场景植入必红/必绿：
 *   ① 基线在场 + 任一域上涨 → reject（不放宽棘轮，铁律）；
 *   ② 基线在场 + 全域下降/持平 → 写 min(current,baseline)（旧实现死代码，修复后真正下调）；
 *   ③ 基线缺席 → 首打 create。
 * lint-ledger-verify.mjs 顶层无条件 main()，故子进程隔离调用同一纯函数，不建第二套判据。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const CHILD = `
import { planWarnBaselineUpdate } from './scripts/lint-ledger-verify.mjs';
const base = { domains: { production: 1484, test: 418, scripts: 539 }, total: 2441 };
const current = { production: 1480, test: 418, scripts: 539 };
const out = {};
out.lower = planWarnBaselineUpdate(current, base);
out.equal = planWarnBaselineUpdate(base.domains, base);
for (const d of ['production', 'test', 'scripts']) {
  const up = { ...base.domains, [d]: base.domains[d] + 1 };
  out['up_' + d] = planWarnBaselineUpdate(up, base);
}
out.absent = planWarnBaselineUpdate(current, null);
process.stdout.write('@@S4@@' + JSON.stringify(out) + '@@END@@');
`;

function runChild() {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { encoding: 'utf8' });
  const marker = r.stdout?.match(/@@S4@@([\s\S]*?)@@END@@/);
  assert.ok(marker, `子进程纯函数输出缺失：${r.stderr?.slice(0, 400)}`);
  return JSON.parse(marker[1]);
}

test('S4-A1 基线在场 + 全域下降 → 允许下调（旧死代码路径修活）', () => {
  const out = runChild();
  assert.equal(out.lower.action, 'update');
  assert.equal(out.lower.ok, true);
  assert.deepEqual(out.lower.domains, { production: 1480, test: 418, scripts: 539 });
  assert.equal(out.lower.total, 2437);
  assert.equal(out.lower.issues.length, 0);
});

test('S4-A2 基线在场 + 持平 → 幂等 update（不虚涨）', () => {
  const out = runChild();
  assert.equal(out.equal.action, 'update');
  assert.deepEqual(out.equal.domains, { production: 1484, test: 418, scripts: 539 });
  assert.equal(out.equal.total, 2441);
});

test('S4-A3 任一域上涨 → reject（棘轮语义不放宽，3/3 必红）', () => {
  const out = runChild();
  for (const d of ['production', 'test', 'scripts']) {
    const r = out[`up_${d}`];
    assert.equal(r.action, 'reject', `${d} 域上涨必须拒绝 update`);
    assert.equal(r.ok, false);
    assert.ok(r.issues.length > 0, `${d} 域上涨必须给红原因`);
  }
});

test('S4-A4 基线缺席 → 首打 create（旧能力不丢）', () => {
  const out = runChild();
  assert.equal(out.absent.action, 'create');
  assert.equal(out.absent.ok, true);
  assert.deepEqual(out.absent.domains, { production: 1480, test: 418, scripts: 539 });
});
