/**
 * UI-D5 (BLOCK-420) — 汇总门负测（篡改任一门 / 缺门 / 结论伪造必红）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  checkFiles, summarize, runGate, GATES, FLOWS,
} from '../scripts/ui-design-program.mjs';

const allGreen = () => GATES.map((g) => ({ ...g, exit: 0, output: 'PASS' }));

test('real tree: all six phase gates pass (gate:ui-program)', () => {
  const r = checkFiles();
  assert.equal(r.summary.allPass, true, JSON.stringify(r.summary.problems));
  assert.equal(r.summary.passed, 6);
});

test('植入任一门失败必红（六个门逐个验证）', () => {
  for (const g of GATES) {
    const rigged = allGreen().map((r) => r.id === g.id ? { ...r, exit: 1, output: 'FAIL synthetic' } : r);
    const s = summarize(rigged);
    assert.equal(s.allPass, false, `${g.id} 植入失败未判红`);
    assert.ok(s.problems.some((p) => p.includes(g.id)));
  }
});

test('门缺失 / 脚本不存在 / 结论伪造必红', () => {
  const missing = allGreen().slice(0, 5);
  assert.ok(summarize(missing).problems.some((p) => p.includes('门数量不符') || p.includes('门缺失')));
  const absent = runGate({ id: 'ghost', script: 'scripts/no-such-gate.mjs' });
  assert.equal(absent.exit, 127);
  assert.ok(summarize([...allGreen(), absent]).problems.length > 0);
  // 汇总结论只能由逐门退出码推出，不接受调用方自报 allPass
  const rigged = summarize(allGreen().map((r) => r.id === 'ui-a11y' ? { ...r, exit: 1 } : r));
  assert.equal(rigged.allPass, false);
});

test('六期门禁与证据路径一一对应且证据在册', () => {
  assert.equal(GATES.length, 6);
  assert.deepEqual(GATES.map((g) => g.phase), ['D0', 'D1', 'D2', 'D2', 'D3', 'D4']);
  for (const g of GATES) {
    assert.ok(fs.existsSync(new URL(`../${g.script}`, import.meta.url)), `${g.script} missing`);
    assert.ok(fs.existsSync(new URL(`../acceptance/ui-design-assessment-2026-11-11/${g.evidence}`, import.meta.url)), `${g.evidence} missing`);
  }
});

test('视觉/几何回归 flow 复用两份既有 flow，不另立第二份', () => {
  assert.equal(FLOWS.length, 2);
  for (const f of FLOWS) {
    assert.ok(fs.existsSync(new URL(`../${f.file}`, import.meta.url)), `${f.file} missing`);
    assert.ok(fs.existsSync(new URL(`../acceptance/ui-design-assessment-2026-11-11/${f.evidence}`, import.meta.url)), `${f.evidence} missing`);
  }
  assert.ok(FLOWS.every((f) => f.note.length > 0));
});
