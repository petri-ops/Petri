import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const BLUEPRINT = 'acceptance/next-stage-super-blueprint-2026-11-17/SUPER-BLUEPRINT.md';

test('C-54 超级总蓝图落档：索引文件存在且自称 projection/index', () => {
  const doc = read(BLUEPRINT);
  assert.match(doc, /^# Petri 下一阶段超级总蓝图/);
  assert.match(doc, /Projection \/ Index/);
  assert.match(doc, /非第二真相自检/);
  assert.match(doc, /权威边界矩阵/);
});

test('C-54 不是 second canonical：无 plan frontmatter / 不授权启动', () => {
  const doc = read(BLUEPRINT);
  assert.doesNotMatch(doc, /^---\r?\nkind: (living-plan|work-package)/m);
  assert.doesNotMatch(doc, /^status: active\r?\n/m);
  assert.match(doc, /不启动工作包/);
  assert.match(doc, /不授权/);
});

test('C-54 未进入 DOC-REGISTRY canonical 文档集合', () => {
  const registry = JSON.parse(read('docs/DOC-REGISTRY.json'));
  const docs = Array.isArray(registry.documents) ? registry.documents : [];
  assert.equal(
    docs.some((row) => String(row.path || '').includes('next-stage-super-blueprint')),
    false,
    'super blueprint must remain outside DOC-REGISTRY',
  );
});

test('C-54 在 AUDIT-LOG 与 pending-work-backlog 有索引行', () => {
  assert.match(read('docs/AUDIT-LOG.md'), /C-54 超级总蓝图落档/);
  assert.match(read('docs/pending-work-backlog.md'), /C-54/);
});
