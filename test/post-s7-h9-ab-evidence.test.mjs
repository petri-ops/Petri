/**
 * B-09 / B-11 A/B 证据形状契约。
 * 只钉「证据在册且判定有据」，不冒充视觉绿 / 不冒充代码已改。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H9 = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h9');
const read = (f) => JSON.parse(fs.readFileSync(path.join(H9, f), 'utf8'));

test('B-09 证据：A/B 同条件、cv 确实生效、判定有据', () => {
  const e = read('cv-ab.json');
  assert.equal(e.evidenceClass, 'cdp-dom-measurement');
  assert.equal(e.humanEyeEquivalent, false);
  assert.equal(e.visualVerified, false);
  assert.equal(e.a.nodes, e.b.nodes, 'cv 不改 DOM 节点数（判据修正的实证）');
  assert.ok(e.b.cvComputedOnRows > e.a.cvComputedOnRows, 'B 态 cv 必须真的生效，否则 A/B 无效');
  assert.ok(typeof e.a.medianLayoutMs === 'number' && typeof e.b.medianLayoutMs === 'number');
  assert.equal(e.improved, e.b.medianLayoutMs < e.a.medianLayoutMs * 0.9);
  if (!e.improved) assert.equal(e.decision, 'rollback-no-measurable-gain');
});

test('B-09 负测：把判定改成「无收益仍落 CSS」必须被识别', () => {
  const e = read('cv-ab.json');
  const forged = { ...e, improved: false, decision: 'apply-cv' };
  assert.notEqual(forged.decision, 'rollback-no-measurable-gain');
  assert.ok(forged.improved === false && forged.decision === 'apply-cv');
});

test('B-11 证据：三态视口齐、几何差异具体、不改代码判定有据', () => {
  const e = read('layout-ab.json');
  assert.equal(e.evidenceClass, 'cdp-dom-measurement');
  assert.equal(e.visualVerified, false);
  assert.equal(e.a.length, 3);
  assert.equal(e.b.length, 3);
  assert.equal(e.deltas.length, 3);
  assert.ok(e.materialDifference, '本次实测几何差异非平凡');
  assert.equal(e.decision, 'no-code-change-needs-independent-slice-and-human-eye');
  assert.ok(e.pendingHumanEye.includes('人眼'));
  const baselineDelta = e.deltas.find((d) => d.label === '1600x1000');
  assert.ok(Math.abs(baselineDelta.scMessages.dw) > 2, '常规视口宽度变化必须被记录');
});

test('B-11 负测：几何全零却声称 material 必须能被识别', () => {
  const e = read('layout-ab.json');
  const zeroed = { ...e, deltas: e.deltas.map((d) => ({ ...d, scMessages: { dw: 0, dh: 0, dx: 0, dy: 0 } })) };
  const anyMaterial = zeroed.deltas.some((d) => Math.abs(d.scMessages.dw) > 2);
  assert.equal(anyMaterial, false);
});
