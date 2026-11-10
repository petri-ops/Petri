/**
 * B-05 补腿契约：CASCADE 依赖清单是只读决策材料，不是 FK 切换授权。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateCascadeScan } from '../scripts/post-s7-b05-cascade-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('分类器：CASCADE 与显式 DELETE 都能识别', () => {
  const r = evaluateCascadeScan({
    'a.sql': 'CREATE TABLE x (id TEXT, FOREIGN KEY (p) REFERENCES projects(id) ON DELETE CASCADE);',
    'b.js': "db.prepare('DELETE FROM subsets WHERE id = ?').run(id);",
  });
  assert.equal(r.cascades.length, 1);
  assert.equal(r.cascades[0].line, 1);
  assert.equal(r.deletes.length, 1);
  assert.ok(r.deletes[0].sql.includes('DELETE FROM subsets'));
});

test('负测：无 CASCADE / 无 DELETE 时清单为空（不虚构依赖）', () => {
  const r = evaluateCascadeScan({ 'a.sql': 'CREATE TABLE x (id TEXT);' });
  assert.equal(r.cascades.length, 0);
  assert.equal(r.deletes.length, 0);
});

test('现场清单在册，且明确不是切换授权', () => {
  const p = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/cascade-scan.json');
  const e = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(e.scannedFiles >= 100);
  assert.ok(e.cascadeDdlCount > 0, '必须如实列出 CASCADE 依赖，不能报零交差');
  assert.ok(e.explicitDeleteCount > 0);
  assert.ok(e.note.includes('仍需用户显式裁决'));
  assert.equal(e.kind, 'b05-cascade-dependency-scan');
});
