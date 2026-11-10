/**
 * B-23 三矩阵同源门契约（红绿先行）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateMatrixParity } from '../scripts/post-s7-matrix-parity-gate.mjs';
import { buildCapabilityMap } from '../scripts/block357-capability-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = () => ({
  surface: read('acceptance/functional-audit-2026-11-04/surface-matrix.json'),
  shelf: read('acceptance/block-352/shelf-matrix.json'),
  manifest: read('resources/skills/manifest.json'),
  map: read('docs/capability-map.md'),
});

test('现场：三矩阵同源', () => {
  const r = evaluateMatrixParity(fixture());
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.ok(r.counts.surfaceTools > 100);
});

test('负测：手改能力地图即红', () => {
  const f = fixture(); f.map += '\n<!-- hand edited -->\n';
  const r = evaluateMatrixParity(f);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes('capability-map.md')));
});

test('负测：矩阵刷新而不重跑生成器即红', () => {
  const f = fixture();
  f.surface = JSON.stringify({ ...JSON.parse(f.surface), generatedAt: '2099-01-01T00:00:00Z' });
  const r = evaluateMatrixParity(f);
  assert.equal(r.ok, false);
});

test('负测：货架技能清单与 manifest 不齐 / 非法 verdict 即红', () => {
  const f = fixture();
  const shelf = JSON.parse(f.shelf);
  shelf.shelves.skills = shelf.shelves.skills.filter((r, i) => !(r.source === 'built-in' && i === 0));
  f.shelf = JSON.stringify(shelf);
  const r1 = evaluateMatrixParity(f);
  assert.equal(r1.ok, false);
  assert.ok(r1.issues.some((i) => i.includes('缺 manifest')));

  const f2 = fixture();
  const s2 = JSON.parse(f2.shelf);
  s2.shelves.skills[0].verdict = 'verified-by-guess';
  f2.shelf = JSON.stringify(s2);
  const r2 = evaluateMatrixParity(f2);
  assert.equal(r2.ok, false);
  assert.ok(r2.issues.some((i) => i.includes('非法 verdict')));
});

test('生成器可独立复算（不依赖活栈）', () => {
  const surface = JSON.parse(fixture().surface);
  assert.ok(buildCapabilityMap(surface).startsWith('# Petri 能做什么'));
});
