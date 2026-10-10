'use strict';

// BLOCK-92 Wave C-3 — 细胞子集与细胞标签 DAO 外迁（原 db.js，纯搬运零行为变化）。

const { db, uid } = require('./connection');

function listSubsets(datasetId) {
  const rows = db
    .prepare('SELECT * FROM subsets WHERE dataset_id = ? ORDER BY created_at DESC')
    .all(datasetId);
  return rows.map(parseSubsetRow);
}

function getSubset(id) {
  const row = db.prepare('SELECT * FROM subsets WHERE id = ?').get(id);
  return row ? parseSubsetRow(row) : null;
}

function createSubset({ datasetId, name, description, cellIds }) {
  const id = uid('s');
  const ids = Array.isArray(cellIds) ? cellIds : [];
  db.prepare(
    'INSERT INTO subsets (id, dataset_id, name, description, cell_ids, n_cells) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, datasetId, name, description || '', JSON.stringify(ids), ids.length);
  return getSubset(id);
}

function updateSubset(id, { name, description }) {
  db.prepare(
    'UPDATE subsets SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?'
  ).run(name || null, description ?? null, id);
  return getSubset(id);
}

function deleteSubset(id) {
  db.prepare('DELETE FROM subsets WHERE id = ?').run(id);
}

function parseSubsetRow(row) {
  if (!row) return row;
  return {
    ...row,
    cell_ids: tryParseArray(row.cell_ids),
  };
}

function tryParseArray(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ============================================================
// Cell labels — user-defined annotation columns
// ============================================================

function listCellLabels(datasetId) {
  const rows = db
    .prepare('SELECT * FROM cell_labels WHERE dataset_id = ? ORDER BY label_name, created_at')
    .all(datasetId);
  return rows.map(parseLabelRow);
}

function getCellLabel(id) {
  const row = db.prepare('SELECT * FROM cell_labels WHERE id = ?').get(id);
  return row ? parseLabelRow(row) : null;
}

function createCellLabel({ datasetId, labelName, labelValue, cellIds }) {
  const id = uid('lbl');
  const ids = Array.isArray(cellIds) ? cellIds : [];
  db.prepare(
    'INSERT INTO cell_labels (id, dataset_id, label_name, label_value, cell_ids, n_cells) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, datasetId, labelName, labelValue, JSON.stringify(ids), ids.length);
  return getCellLabel(id);
}

function deleteCellLabel(id) {
  db.prepare('DELETE FROM cell_labels WHERE id = ?').run(id);
}

/** Group label values by label_name for a dataset. Returns:
 *  { tumor_focus: [{value: 'yes', cells: 100, id: 'lbl_xxx'}, {value: 'no', cells: 200}], ... }
 */
function getLabelsSummary(datasetId) {
  const rows = listCellLabels(datasetId);
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.label_name]) grouped[r.label_name] = [];
    grouped[r.label_name].push({
      id: r.id,
      value: r.label_value,
      cells: r.n_cells,
      createdAt: r.created_at,
    });
  }
  return grouped;
}

function parseLabelRow(row) {
  if (!row) return row;
  return {
    ...row,
    cell_ids: tryParseArray(row.cell_ids),
  };
}

// === Admin: user management ===

module.exports = {
  listSubsets,
  getSubset,
  createSubset,
  updateSubset,
  deleteSubset,
  listCellLabels,
  getCellLabel,
  createCellLabel,
  deleteCellLabel,
  getLabelsSummary,
};
