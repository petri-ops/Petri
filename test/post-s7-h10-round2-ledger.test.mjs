/**
 * BLOCK-395 二轮核实契约：按「是否真的需要人」重判 + 15 件逐件交付。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-s7-2026-11-09/h7/gap-ledger.json'), 'utf8'));
const R2 = j.gaps.filter((g) => g.round2Outcome);

test('34 条逐件有 humanRequired 判定，计数机械汇总', () => {
  assert.equal(j.gaps.length, 34);
  for (const g of j.gaps) assert.ok(['yes', 'no', 'split'].includes(g.humanRequired), g.id);
  const c = {};
  for (const g of j.gaps) c[g.humanRequired] = (c[g.humanRequired] || 0) + 1;
  assert.deepEqual(c, j.humanRequiredCounts);
  assert.equal(c.yes, 2, '真需要人只有 B-02 凭据 / B-34 人眼+凭据');
});

test('15 件二轮交付逐件有终态/说明/证据，无静默消失', () => {
  assert.equal(R2.length, 15);
  assert.equal(j.round2Program.delivered, 15);
  for (const g of R2) {
    assert.ok(g.round2Delivery.length > 20, g.id);
    assert.ok(g.round2Evidence.length > 5, g.id);
    assert.equal(g.humanRequired === 'yes', false, `${g.id} 不该在「不需人」范围里`);
  }
});

test('4 处误分类纠正必须在册（B-10/11/12/32）', () => {
  assert.deepEqual(j.round2Program.misclassificationFixed, ['B-10', 'B-11', 'B-12', 'B-32']);
  for (const id of j.round2Program.misclassificationFixed) {
    assert.ok(j.gaps.find((g) => g.id === id).round2Delivery.includes('误分类纠正'), id);
  }
});

test('负测：把人眼项改成 humanRequired=no / 删交付说明都红', () => {
  const mutated = JSON.parse(JSON.stringify(j));
  const b34 = mutated.gaps.find((g) => g.id === 'B-34');
  b34.humanRequired = 'no';
  const c = {};
  for (const g of mutated.gaps) c[g.humanRequired] = (c[g.humanRequired] || 0) + 1;
  assert.notDeepEqual(c, mutated.humanRequiredCounts);
  const dropped = JSON.parse(JSON.stringify(j));
  const b11 = dropped.gaps.find((g) => g.id === 'B-11');
  delete b11.round2Delivery;
  assert.ok(!dropped.gaps.find((g) => g.id === 'B-11').round2Delivery);
});
