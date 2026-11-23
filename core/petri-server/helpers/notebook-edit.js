/**
 * QODER-E12 P1 — Notebook 单元格编辑纯函数（2026-11-23）。
 *
 * 用户发令「开始 E12 Notebook 单元格编辑」，评审稿范围=cell CRUD + 执行契约、零新依赖。
 * D1 执行沙箱边界=复用 workspace_exec 既有审批门（不新建执行器、不改安全边界）；
 * D2 编辑器=最小切片先工具层（前端 cell UI 不在本切片）。
 *
 * 零新依赖：ipynb 即 JSON，仅用 Node 内置 JSON + crypto。
 * 边界诚实：借道 workspace_exec 执行只能得到 stdout 文本回填，不支持 kernel 状态、
 * %magic、富 MIME、真实 execution_count——这些是约束外的诚实降级，不伪造。
 */
'use strict';

const crypto = require('node:crypto');

const MAX_CELLS = 500;
const MAX_SOURCE_CHARS = 200_000;
const TEMP_DIR = '.petri-agent-tmp';

/** source 在 ipynb 里可能是 string 或 string[]（按行）——归一为单个 string。 */
function normalizeSource(source) {
  if (Array.isArray(source)) return source.join('');
  return typeof source === 'string' ? source : '';
}

/** 解析 ipynb JSON，归一每个 cell 的 source，保留 metadata/outputs/execution_count/nbformat。 */
function parseNotebook(text) {
  const parsed = typeof text === 'string' ? JSON.parse(text) : text;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cells)) {
    throw new Error('invalid_notebook');
  }
  return {
    nbformat: parsed.nbformat,
    nbformat_minor: parsed.nbformat_minor,
    metadata: parsed.metadata || {},
    cells: parsed.cells.map((cell) => ({
      ...cell,
      source: normalizeSource(cell && cell.source),
    })),
  };
}

/** 序列化回 ipynb：source 归一为数组按行（ipynb 规范常见形态），其余字段原样保留。 */
function serializeNotebook(notebook) {
  return JSON.stringify({
    ...notebook,
    cells: (notebook.cells || []).map((cell) => ({
      ...cell,
      source: normalizeSource(cell.source).split('\n').map((line, index, all) => (
        index < all.length - 1 ? `${line}\n` : line
      )),
    })),
  }, null, 1);
}

function newCellId() {
  return `cell_${crypto.randomBytes(6).toString('hex')}`;
}

/** cell CRUD：insert/update/delete。失败返回 {ok:false,error}，不抛异常、不改原对象。 */
function applyCellOp(notebook, op) {
  if (!notebook || !Array.isArray(notebook.cells)) return { ok: false, error: 'invalid_notebook' };
  if (!op || typeof op !== 'object') return { ok: false, error: 'invalid_op' };
  const cells = notebook.cells.map((cell) => ({ ...cell }));
  const kind = String(op.op || '');
  if (kind === 'insert') {
    if (cells.length >= MAX_CELLS) return { ok: false, error: 'cell_limit' };
    const source = normalizeSource(op.source);
    if (source.length > MAX_SOURCE_CHARS) return { ok: false, error: 'source_too_large' };
    const cellType = op.cellType === 'markdown' ? 'markdown' : 'code';
    const cell = cellType === 'code'
      ? { cell_type: 'code', id: newCellId(), metadata: {}, execution_count: null, outputs: [], source }
      : { cell_type: 'markdown', id: newCellId(), metadata: {}, source };
    const index = Number.isInteger(op.index) ? Math.max(0, Math.min(op.index, cells.length)) : cells.length;
    cells.splice(index, 0, cell);
    return { ok: true, notebook: { ...notebook, cells }, cellId: cell.id };
  }
  if (kind === 'update') {
    const cellId = String(op.cellId || '');
    const target = cells.find((cell) => cell.id === cellId);
    if (!target) return { ok: false, error: 'cell_not_found' };
    const source = normalizeSource(op.source);
    if (source.length > MAX_SOURCE_CHARS) return { ok: false, error: 'source_too_large' };
    target.source = source;
    return { ok: true, notebook: { ...notebook, cells }, cellId };
  }
  if (kind === 'delete') {
    const cellId = String(op.cellId || '');
    const index = cells.findIndex((cell) => cell.id === cellId);
    if (index < 0) return { ok: false, error: 'cell_not_found' };
    cells.splice(index, 1);
    return { ok: true, notebook: { ...notebook, cells }, cellId };
  }
  return { ok: false, error: 'unsupported_op' };
}

/** 语言 → 既有执行驱动（借道 workspace_exec）；未支持语言明确拒绝。 */
const LANGUAGE_RUNNERS = {
  python: 'python3',
  python3: 'python3',
  r: 'Rscript',
  rscript: 'Rscript',
};

/**
 * 构造 cell 执行计划：source 落受治理临时区 → workspace_exec 执行 → stdout 回填 outputs。
 * approvalInherited=true 表示继承 workspace_exec 既有审批门（不新建执行器、不改审计语义）。
 */
function buildCellExecution({ source, language, notebookPath, cellId } = {}) {
  const runner = LANGUAGE_RUNNERS[String(language || '').toLowerCase()];
  if (!runner) return { ok: false, error: 'unsupported_language' };
  const text = normalizeSource(source);
  if (!text.trim()) return { ok: false, error: 'empty_source' };
  const safeName = String(notebookPath || 'notebook').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'notebook';
  const tempFile = `${TEMP_DIR}/${safeName}_${String(cellId || 'cell').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32)}.${runner === 'Rscript' ? 'R' : 'py'}`;
  return {
    ok: true,
    tool: 'workspace_exec',
    command: `${runner} "${tempFile}"`,
    tempFile,
    source: text,
    approvalInherited: true,
    // 诚实降级：无 kernel 状态/富 MIME/真 execution_count，outputs 仅 stdout 文本。
    fidelity: 'stdout-text-only',
  };
}

module.exports = {
  MAX_CELLS,
  MAX_SOURCE_CHARS,
  parseNotebook,
  serializeNotebook,
  applyCellOp,
  buildCellExecution,
};
