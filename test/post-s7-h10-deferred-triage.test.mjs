import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyDeferred, evaluateDeferred } from '../scripts/post-s7-deferred-triage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('分类器按 mainOnly / inPreload 分域，不把产品决策混成预留', () => {
  const r = classifyDeferred([
    { channel: 'a', mainOnly: true, inPreload: false },
    { channel: 'b', mainOnly: false, inPreload: true },
    { channel: 'c', mainOnly: false, inPreload: false },
  ]);
  assert.deepEqual(r.mainOnly, ['a']);
  assert.deepEqual(r.needsProductDecision, ['b']);
  assert.deepEqual(r.reserved, ['c']);
});

test('负测：B-04 deferred 少理由 / 数量变化，B-33 桶缺失都红', () => {
  const triage = { buckets: { needsWiring: [], deletable: [], retainWithReason: [] } };
  assert.equal(evaluateDeferred(triage, [
    { id: 'a', state: 'deferred', reason: 'x' }, { id: 'b', state: 'deferred', reason: 'y' },
  ]).ok, true);
  assert.equal(evaluateDeferred(triage, [
    { id: 'a', state: 'deferred', reason: '' }, { id: 'b', state: 'deferred', reason: 'y' },
  ]).ok, false);
  assert.equal(evaluateDeferred({ buckets: { needsWiring: [], deletable: [] } }, [
    { id: 'a', state: 'deferred', reason: 'x' }, { id: 'b', state: 'deferred', reason: 'y' },
  ]).ok, false);
});

test('现场分诊在册，明确不冒充接线完成', () => {
  const e = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/deferred-triage.json'), 'utf8'));
  assert.equal(e.evaluation.ok, true);
  assert.ok(e.b33.needsWiring > 100);
  assert.ok(e.b33.decision.includes('不盲接'));
  assert.ok(e.note.includes('不冒充接线完成'));
});
