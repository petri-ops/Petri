import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { withSessionExecutionTarget, withSessionExecutionTargetSync } = require(
  path.join(repoRoot, 'core/petri-server/helpers/remote-execution/session-target.js'),
);

test('session target injects into params when known and absent', async () => {
  const params = { top_n: 8 };
  const out = await withSessionExecutionTarget(params, { executionTargetId: 'tgt_dell' }, async (id) => id === 'tgt_dell');
  assert.deepEqual(out, { top_n: 8, executionTargetId: 'tgt_dell' });
  // 原 params 不被就地修改
  assert.deepEqual(params, { top_n: 8 });
});

test('session target is dropped when unknown (fail-closed to local)', async () => {
  const out = await withSessionExecutionTarget({ a: 1 }, { executionTargetId: 'tgt_ghost' }, async () => false);
  assert.deepEqual(out, { a: 1 });
  assert.equal('executionTargetId' in out, false);
});

test('explicit params-level target wins (no overwrite)', async () => {
  const out = await withSessionExecutionTarget(
    { executionTargetId: 'tgt_aliyun' },
    { executionTargetId: 'tgt_dell' },
    async () => true,
  );
  assert.equal(out.executionTargetId, 'tgt_aliyun');
});

test('no ctx target → params returned as-is', async () => {
  const params = { a: 1 };
  assert.equal(await withSessionExecutionTarget(params, {}, async () => true), params);
  assert.equal(await withSessionExecutionTarget(params, null, async () => true), params);
});

test('validator throwing is treated as unknown (no injection, no crash)', async () => {
  const out = await withSessionExecutionTarget({ a: 1 }, { executionTargetId: 'tgt_x' }, async () => {
    throw new Error('db down');
  });
  assert.deepEqual(out, { a: 1 });
});

test('sync variant keeps legacy semantics (no registry check)', () => {
  const out = withSessionExecutionTargetSync({ a: 1 }, { executionTargetId: 'tgt_dell' });
  assert.equal(out.executionTargetId, 'tgt_dell');
  assert.equal(withSessionExecutionTargetSync(null, { executionTargetId: 'x' }), null);
});
