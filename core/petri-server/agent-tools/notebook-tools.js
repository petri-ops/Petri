/**
 * QODER-E12 P2 — notebook_edit agent 工具 handler（2026-11-23）。
 *
 * 零新依赖：复用 workspace-tools/internals 的 resolveWorkspaceTarget/sha256 +
 * withWorkspace（工作区双模/审批 ctx），helpers/notebook-edit.js 纯函数做 cell CRUD。
 * 红线：execute op 只生成借道 workspace_exec 的计划，不在此执行——审批门不绕过。
 */
'use strict';

const fsp = require('node:fs/promises');
const { resolveWorkspaceTarget, sha256 } = require('./workspace-tools/internals');
const { parseNotebook, serializeNotebook, applyCellOp, buildCellExecution } = require('../helpers/notebook-edit');

function errorResult(code, message) {
  return { ok: false, error: code, message };
}

/**
 * @param {object} options - { withWorkspace }（由 createWorkspaceTools()._internal 注入）
 */
function createNotebookTools(options = {}) {
  // 默认复用 workspace-tools 的 withWorkspace（工作区双模/审批 ctx 单源）；
  // 可注入以便单测。模块加载时构造一次，与 workspace-tools 的 defaultTools 同构。
  const withWorkspace = typeof options.withWorkspace === 'function'
    ? options.withWorkspace
    : require('./workspace-tools').createWorkspaceTools().withWorkspace;

  async function notebookEdit(args = {}, ctx = {}) {
    if (typeof withWorkspace !== 'function') return errorResult('workspace_unavailable', '工作区上下文不可用');
    const op = String(args.op || '');
    return withWorkspace(ctx, async ({ root }) => {
      let resolved;
      try {
        resolved = await resolveWorkspaceTarget(root, args.path || '');
      } catch (error) {
        return errorResult('invalid_path', String(error && error.message || error).slice(0, 200));
      }
      if (!/\.ipynb$/i.test(resolved.target)) return errorResult('not_ipynb', '目标必须是 .ipynb 文件');
      let raw;
      try {
        raw = await fsp.readFile(resolved.target, 'utf8');
      } catch (error) {
        return errorResult('read_failed', String(error && error.message || error).slice(0, 200));
      }
      const actualSha = sha256(raw);
      if (args.expectedSha256 && actualSha !== String(args.expectedSha256)) {
        return errorResult('content_conflict', '文件已变化，expectedSha256 不匹配');
      }
      let notebook;
      try {
        notebook = parseNotebook(raw);
      } catch (error) {
        return errorResult('invalid_notebook', String(error && error.message || error).slice(0, 200));
      }

      if (op === 'list' || op === 'read') {
        return {
          ok: true,
          op,
          path: resolved.relativePath,
          sha256: actualSha,
          cellCount: notebook.cells.length,
          cells: notebook.cells.map((cell, index) => ({
            index,
            id: cell.id || null,
            cell_type: cell.cell_type || 'unknown',
            source: op === 'read' ? cell.source : cell.source.slice(0, 200),
          })),
        };
      }

      if (op === 'execute') {
        const cellId = String(args.cellId || '');
        const cell = notebook.cells.find((item) => item.id === cellId);
        if (!cell) return errorResult('cell_not_found', '目标 cell 不存在');
        const plan = buildCellExecution({
          source: args.source || cell.source,
          language: args.language || (notebook.metadata?.kernelspec?.language || 'python'),
          notebookPath: resolved.relativePath,
          cellId,
        });
        if (!plan.ok) return errorResult(plan.error, '执行计划构造失败');
        return {
          ok: true,
          op: 'execute',
          path: resolved.relativePath,
          cellId,
          plan,
          notice: '执行须由你显式调用 workspace_exec（继承既有审批门）；本工具不直接执行、不伪造 kernel 输出。',
        };
      }

      const outcome = applyCellOp(notebook, args);
      if (!outcome.ok) return errorResult(outcome.error, `cell 操作失败：${outcome.error}`);
      const nextText = serializeNotebook(outcome.notebook);
      const summary = {
        ok: true,
        op,
        path: resolved.relativePath,
        cellId: outcome.cellId || null,
        cellCount: outcome.notebook.cells.length,
        previousSha256: actualSha,
        sha256: sha256(nextText),
        dryRun: args.dryRun === true,
      };
      if (args.dryRun !== true) await fsp.writeFile(resolved.target, nextText, 'utf8');
      return summary;
    });
  }

  return { notebookEdit };
}

module.exports = { createNotebookTools };
