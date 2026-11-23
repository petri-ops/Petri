/**
 * QODER-E12 P2 handler 端到端契约（2026-11-23）。
 *
 * 注入 mock withWorkspace（{root} 指临时工作区），验证 notebook_edit handler 的
 * cell CRUD 真落盘、sha256 并发冲突、execute 只返计划不执行（审批门不绕过）。
 * 零新依赖、不碰产品安全边界。
 */
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const { createNotebookTools } = require(path.join(ROOT, 'core/petri-server/agent-tools/notebook-tools.js'));
const { sha256 } = require(path.join(ROOT, 'core/petri-server/agent-tools/workspace-tools/internals.js'));

let tmp;
let tools;
const nb = () => JSON.stringify({
  nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { language: 'python' } },
  cells: [{ cell_type: 'code', id: 'c1', metadata: {}, execution_count: null, outputs: [], source: ['print(1)\n'] }],
});

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e12-notebook-handler-'));
  fs.writeFileSync(path.join(tmp, 'nb.ipynb'), nb());
  tools = createNotebookTools({ withWorkspace: async (_ctx, fn) => fn({ root: tmp }) });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('read/list：读回 cell 结构与 sha256', async () => {
  const out = await tools.notebookEdit({ path: 'nb.ipynb', op: 'read' }, {});
  assert.equal(out.ok, true);
  assert.equal(out.cellCount, 1);
  assert.equal(out.cells[0].source, 'print(1)\n');
  assert.equal(out.sha256, sha256(nb()));
});

test('insert 落盘 + expectedSha256 并发冲突防护', async () => {
  const before = fs.readFileSync(path.join(tmp, 'nb.ipynb'), 'utf8');
  const out = await tools.notebookEdit({
    path: 'nb.ipynb', op: 'insert', cellType: 'code', source: 'print(2)', expectedSha256: sha256(before),
  }, {});
  assert.equal(out.ok, true);
  assert.equal(out.cellCount, 2);
  const after = fs.readFileSync(path.join(tmp, 'nb.ipynb'), 'utf8');
  assert.notEqual(after, before, '写操作须真落盘');
  const parsed = JSON.parse(after);
  assert.equal(parsed.cells.length, 2);
  assert.equal(parsed.cells[1].source.join(''), 'print(2)');

  const conflict = await tools.notebookEdit({
    path: 'nb.ipynb', op: 'insert', source: 'print(3)', expectedSha256: sha256(before),
  }, {});
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'content_conflict', '旧 sha256 须被拒');
});

test('dryRun 不落盘；execute 只返计划、不执行、继承审批门标记', async () => {
  const before = fs.readFileSync(path.join(tmp, 'nb.ipynb'), 'utf8');
  const dry = await tools.notebookEdit({
    path: 'nb.ipynb', op: 'insert', source: 'print(9)', expectedSha256: sha256(before), dryRun: true,
  }, {});
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.equal(fs.readFileSync(path.join(tmp, 'nb.ipynb'), 'utf8'), before, 'dryRun 不得写盘');

  const plan = await tools.notebookEdit({ path: 'nb.ipynb', op: 'execute', cellId: 'c1' }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.plan.tool, 'workspace_exec');
  assert.equal(plan.plan.approvalInherited, true);
  assert.match(plan.notice, /workspace_exec/);
});
