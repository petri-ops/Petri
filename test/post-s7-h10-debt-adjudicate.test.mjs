import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { adjudicateRow } from '../scripts/post-s7-debt-adjudicate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('判据：观感/读屏归人眼、外部条件归 retain、其余可机械判档', () => {
  assert.equal(adjudicateRow({ id: 'UI-1', reason: '待实机观感' }), 'pending_human_eye');
  assert.equal(adjudicateRow({ id: 'UI-2', reason: 'VoiceOver 朗读确认' }), 'pending_human_eye');
  assert.equal(adjudicateRow({ id: 'UI-3', reason: '隧道公网依赖' }), 'retain-external-condition');
  assert.equal(adjudicateRow({ id: 'UI-4', reason: '已 cancelled' }), 'retain-external-condition');
  assert.equal(adjudicateRow({ id: 'UI-5', reason: '代码+组件测试完成待接线' }), 'agent-adjudicable');
});

test('现场：三桶在册，人眼桶非空且保持不变', () => {
  const e = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/debt-adjudication.json'), 'utf8'));
  assert.equal(e.totalDebt, Object.values(e.buckets).reduce((a, b) => a + b, 0));
  assert.ok(e.buckets.pending_human_eye > 0);
  assert.ok(e.decision.includes('不是已 verified'));
  assert.ok(e.note.includes('不代答'));
});

// 防复发：派生台账 title 被截断，判档必须回读 canonical 完整标题
test('canonical 原文里的「实机走查待人工 / 待实机观感」必须归人眼（不能靠截断洗桶）', () => {
  const canonical = fs.readFileSync(path.join(ROOT, 'docs/ui-productization-audit.md'), 'utf8');
  const titleOf = (id) => {
    const line = canonical.split(/\r?\n/).find((l) => l.startsWith(`## ${id}:`));
    return line ? line.slice(line.indexOf(': ') + 2) : '';
  };
  for (const id of ['UI-699', 'UI-698', 'UI-697', 'UI-695']) {
    const title = titleOf(id);
    assert.ok(title.length > 0, `${id} 台账原文必须存在`);
    assert.equal(adjudicateRow({ id, reason: title }), 'pending_human_eye', `${id} 完整标题应归人眼`);
  }
  const e = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/debt-adjudication.json'), 'utf8'));
  assert.ok(e.buckets.pending_human_eye >= 20, '人眼桶不得被截断数据洗小');
  assert.equal(e.totalDebt, 35);
});
