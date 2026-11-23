/**
 * QODER-E12 Notebook 单元格编辑 — P1 纯函数 HK-01 契约（2026-11-23）。
 *
 * 用户发令「开始 E12 Notebook 单元格编辑」，评审稿范围=cell CRUD + 执行契约、零新依赖。
 * D1 执行沙箱边界=复用 workspace_exec 既有审批门（不改安全边界）；
 * D2 编辑器=最小切片先工具层、不做前端 cell UI。
 *
 * P1 切片=ipynb 结构化纯函数：解析（source string|array 归一）/cell CRUD（幂等、有界）/
 * 执行参数构造（借道 workspace_exec，temp 文件 + 语言驱动，继承既有治理门）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'core', 'petri-server', 'helpers', 'notebook-edit.js');
const load = () => require(MODULE);

const ipynb = (cells) => JSON.stringify({
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { language: 'python', name: 'python3' } },
  cells,
});
const codeCell = (source, id) => ({ cell_type: 'code', id, metadata: {}, execution_count: null, outputs: [], source });

test('E12 P1 模块存在且零新依赖（仅 Node 内置）', () => {
  assert.ok(fs.existsSync(MODULE), '须有 helpers/notebook-edit.js');
  const s = fs.readFileSync(MODULE, 'utf8');
  assert.doesNotMatch(s, /require\(['"](?!\.\.?\/|node:)/, '不得引入非本地/非 node 新依赖');
});

test('parseNotebook：source string|string[] 归一为 string，保留 metadata/outputs', () => {
  const { parseNotebook } = load();
  const doc = parseNotebook(ipynb([
    codeCell(['line1\n', 'line2'], 'a'),
    { cell_type: 'markdown', id: 'b', metadata: {}, source: '# Title' },
  ]));
  assert.equal(doc.cells.length, 2);
  assert.equal(doc.cells[0].source, 'line1\nline2');
  assert.equal(doc.cells[1].source, '# Title');
  assert.equal(doc.nbformat, 4);
  assert.ok(Array.isArray(doc.cells[0].outputs));
});

test('cell CRUD：insert/update/delete 有界且幂等，不改其他 cell', () => {
  const { parseNotebook, applyCellOp } = load();
  const doc = parseNotebook(ipynb([codeCell('print(1)', 'a')]));
  const inserted = applyCellOp(doc, { op: 'insert', index: 1, cellType: 'code', source: 'print(2)' });
  assert.equal(inserted.ok, true);
  assert.equal(inserted.notebook.cells.length, 2);
  assert.equal(inserted.notebook.cells[1].source, 'print(2)');
  assert.equal(inserted.notebook.cells[0].source, 'print(1)', '不得改其他 cell');
  const updated = applyCellOp(inserted.notebook, { op: 'update', cellId: inserted.notebook.cells[1].id, source: 'print(3)' });
  assert.equal(updated.ok, true);
  assert.equal(updated.notebook.cells[1].source, 'print(3)');
  const deleted = applyCellOp(updated.notebook, { op: 'delete', cellId: updated.notebook.cells[0].id });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.notebook.cells.length, 1);
  assert.equal(deleted.notebook.cells[0].source, 'print(3)');
  const bad = applyCellOp(doc, { op: 'update', cellId: 'notfound', source: 'x' });
  assert.equal(bad.ok, false, '未知 cellId 须失败不静默');
});

test('执行参数构造：借道 workspace_exec，语言驱动映射 + 既有审批门字段', () => {
  const { buildCellExecution } = load();
  const plan = buildCellExecution({ source: 'print(1)', language: 'python', notebookPath: 'nb.ipynb', cellId: 'c1' });
  assert.equal(plan.ok, true);
  assert.equal(plan.tool, 'workspace_exec', '须借道既有执行工具，不新建执行器');
  assert.match(plan.command, /python|python3/, 'python cell 须走 python 驱动');
  assert.equal(plan.approvalInherited, true, '须继承 workspace_exec 既有审批门');
  assert.ok(plan.tempFile.includes('.petri-agent-tmp'), '临时文件须落在受治理临时区');
  const r = buildCellExecution({ source: 'print(1)', language: 'ruby', notebookPath: 'nb.ipynb', cellId: 'c2' });
  assert.equal(r.ok, false, '未支持语言须明确拒绝，不静默执行');
});

test('红线：不碰产品安全边界与既有工具注册', () => {
  const scheme = fs.readFileSync(path.join(ROOT, 'src', 'main', 'pack-ui', 'scheme.js'), 'utf8');
  const policy = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'agent-tool-policy.js'), 'utf8');
  assert.match(scheme, /protocol\.handle\(SCHEME/, 'pack handler 未改');
  assert.match(policy, /MUTATING_SIDE_EFFECTS/, '既有策略门未改');
});
