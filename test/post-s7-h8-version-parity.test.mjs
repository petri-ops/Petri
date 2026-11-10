/**
 * 跨语言版本对账门契约（红绿先行）：漂移必红、定义被移走必红、现场一致。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateParity, PRODUCTION_LITERAL_POINTS } from '../scripts/post-s7-version-parity-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELD = PRODUCTION_LITERAL_POINTS[0].field;

function fakeRead(overrides) {
  return (p) => overrides[p] ?? fs.readFileSync(path.join(ROOT, p), 'utf8');
}

test('现场：生产面字面量与登记处一致', () => {
  const r = evaluateParity();
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.ok(r.checked.length >= 2);
});

test('负测：单边升版（改登记处）必红', () => {
  const r = evaluateParity(fakeRead({
    [PRODUCTION_LITERAL_POINTS[0].file]: 'export const x = { contractVersion: 999 };',
  }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes('≠')));
});

test('负测：字面量被移走但没登记也必红（防静默漏测）', () => {
  const r = evaluateParity(fakeRead({
    [PRODUCTION_LITERAL_POINTS[0].file]: 'export const x = { artifactId: "a" };',
  }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes('no literal found')));
});

test('登记点清单自洽：路径存在、字段在登记处', () => {
  const r = evaluateParity();
  for (const p of PRODUCTION_LITERAL_POINTS) {
    assert.ok(fs.existsSync(path.join(ROOT, p.file)), p.file);
    assert.equal(typeof r.registry[p.field], 'number');
  }
  assert.equal(typeof r.registry[FIELD], 'number');
});

test('B-17：插件侧 5 处 artifactSchemaVersion 全部单源引用，字面量回潮必红', () => {
  const r = evaluateParity();
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(typeof r.registry.ARTIFACT_SCHEMA_VERSION, 'number');
  assert.equal(r.registry.ARTIFACT_SCHEMA_VERSION, 1);
  assert.ok(r.checked.some((c) => c.value === 'single-source-ref'));
  assert.ok(r.checked.filter((c) => c.value === 'single-source-ref').length >= 5);
});

test('B-17 负测：把某插件文件改回硬编码即红', () => {
  const r = evaluateParity(fakeRead({
    'core/petri-server/plugin-loader.js': 'artifactSchemaVersion: 1,',
  }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes('schema-versions 单源') || i.includes('字面量')));
});
