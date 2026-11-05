import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeCriteria } from '../scripts/block354-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'acceptance', 'block-354', 'readiness.json');

test('block354: 判据表六项全判定且全达标（当前基线）', () => {
  const results = judgeCriteria();
  assert.equal(results.length, 6);
  for (const r of results) {
    assert.equal(r.ok, true, `${r.id} 未达：${r.reason}`);
    for (const ev of r.evidence.split(' + ')) {
      assert.ok(fs.existsSync(path.join(ROOT, ev)), `${r.id} 证据路径不存在：${ev}`);
    }
  }
});

test('block354 负测：移除一项证据 → 该项判未达且就绪度下降', () => {
  const base = judgeCriteria();
  assert.equal(base.filter((r) => r.ok).length, 6);
  // 人为移除 ⑥ packaged 回归证据
  const damaged = judgeCriteria({ files: { 'acceptance/block-353/packaged-regression.json': null } });
  const pkg = damaged.find((r) => r.id === 'packaged-regression');
  assert.equal(pkg.ok, false, '移除证据后应判未达');
  assert.ok(damaged.filter((r) => r.ok).length < 6, '就绪度应下降');
});

test('block354 负测：EAR 跌破 40% → 判未达', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/block-351/assetized-manifest.json'), 'utf8'));
  const damaged = judgeCriteria({
    files: { 'acceptance/block-351/assetized-manifest.json': { ...m, totals: { ...m.totals, earPct: 33.5 } } },
  });
  assert.equal(damaged.find((r) => r.id === 'evidence-assetization').ok, false, 'EAR < 40% 应判未达');
});

test('block354 负测：恢复证据 → 回升 6/6', () => {
  const restored = judgeCriteria();
  assert.equal(restored.filter((r) => r.ok).length, 6);
});

test('block354: readiness.json 只由脚本生成且带红线条款', () => {
  const out = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  assert.match(out.readiness, /^\d\/6$/);
  assert.match(out.redLine, /G1 启动仍需用户显式发令/);
  assert.match(out.redLine, /不得表述 GA/);
  assert.ok(out.criteria.length === 6);
});

test('block354: 判据定义在计划文档冻结（§2 六项各带条件/证据/命令/替代判据）', () => {
  const plan = fs.readFileSync(path.join(ROOT, 'docs/block-354-g0-exit-criteria-plan.md'), 'utf8');
  for (const frag of ['达标条件', '证据路径', '判定命令', '替代判据', '宣称红线', '不启动 G1']) {
    assert.ok(plan.includes(frag), `计划缺「${frag}」要素`);
  }
});
