/**
 * UI-D5 (BLOCK-420) — gap-ledger 终态门负测（植入必红）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFiles, verifyLedger, TERMINALS } from '../scripts/ui-design-gap-ledger-check.mjs';

const good = () => ({ findings: [{ id: 'x', finding: 'f', terminal: 'done', evidence: 'e' }] });
const withExtra = (extra) => ({ findings: [...good().findings, extra] });

test('real gap-ledger: 32 条逐件终态，零 in_progress', () => {
  const r = checkFiles();
  assert.deepEqual(r.problems, []);
  assert.equal(r.total, 32);
  assert.equal(r.counts.in_progress, undefined);
  assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), 32);
});

test('终态封闭集与计数复算', () => {
  assert.deepEqual(TERMINALS, ['done', 'done-partial', 'retain-with-reason', 'pending_human_eye', 'external-blocked', 'pending_user_ruling']);
  const r = verifyLedger(good());
  assert.equal(r.counts.done, 1);
  assert.equal(r.total, 1);
});

test('植入 in_progress / 非法终态 / 重复 id / 缺字段必红', () => {
  assert.ok(verifyLedger(withExtra({ id: 'a', finding: 'f', terminal: 'in_progress', evidence: 'e' })).problems.some((p) => p.includes('in_progress')));
  assert.ok(verifyLedger(withExtra({ id: 'b', finding: 'f', terminal: 'verified', evidence: 'e' })).problems.some((p) => p.includes('非法终态')));
  assert.ok(verifyLedger(withExtra({ id: 'x', finding: 'f', terminal: 'done', evidence: 'e' })).problems.some((p) => p.includes('重复 id')));
  assert.ok(verifyLedger(withExtra({ id: 'c', terminal: 'done' })).problems.some((p) => p.includes('缺字段')));
});

test('未闭合项缺补腿条件 / 冒充 verified 必红；否定语境不算冒充', () => {
  for (const t of ['pending_human_eye', 'external-blocked', 'pending_user_ruling', 'done-partial', 'retain-with-reason']) {
    const p = verifyLedger(withExtra({ id: 'd', finding: 'f', terminal: t, evidence: 'e' })).problems;
    assert.ok(p.some((x) => x.includes('补腿条件')), `${t} 缺补腿未判红`);
  }
  const long = '补腿条件：真人按路线实测并签字后重开';
  assert.ok(verifyLedger(withExtra({ id: 'e', finding: 'f', terminal: 'pending_human_eye', evidence: 'verified by agent', supplement: long })).problems.some((p) => p.includes('verified 措辞')));
  assert.equal(verifyLedger(withExtra({ id: 'f', finding: 'f', terminal: 'pending_human_eye', evidence: 'e', supplement: '补腿条件：Agent 不写 verified，需人签字' })).problems.length, 0);
});
