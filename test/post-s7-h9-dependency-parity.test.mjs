/**
 * B-24 三套依赖树对账门契约（红绿先行）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateDependencyParity, PACKAGE_TREES } from '../scripts/post-s7-dependency-parity-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = () => (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

function drifted(replacements) {
  return (p) => {
    const pkg = real()(p);
    if (replacements[p]) Object.assign(pkg.dependencies, replacements[p]);
    return pkg;
  };
}

test('现场：三树齐、共享包零漂移', () => {
  const r = evaluateDependencyParity();
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.drift.length, 0);
});

test('负测：同名包跨树版本漂移必红', () => {
  const r = evaluateDependencyParity(drifted({ 'frontend/package.json': { 'better-sqlite3': '99.0.0' } }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes('漂移') || i.includes('不一致')));
});

test('负测：缺树 / 非法 package.json 必红（防静默漏测）', () => {
  const r = evaluateDependencyParity((p) => {
    if (p === 'core/petri-server/package.json') throw new Error('ENOENT');
    return real()(p);
  });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes('core: unreadable')));
  const bad = evaluateDependencyParity((p) => (p === 'frontend/package.json' ? [] : real()(p)));
  assert.equal(bad.ok, false);
});

test('登记树清单自洽：三份 package.json 都存在', () => {
  assert.equal(PACKAGE_TREES.length, 3);
  for (const t of PACKAGE_TREES) assert.ok(fs.existsSync(path.join(ROOT, t.file)), t.file);
});
