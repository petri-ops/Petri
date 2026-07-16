/**
 * r-server-db.js (W2-A, 2026-05-28)
 *
 * py-server's bridge to the shared user/tool-jobs/datasets store.
 *
 * SQLite backend — reads/writes r-server's local biof3.db on the same host
 * (better-sqlite3 + WAL). Path from BIOF3_R_DB_PATH or /opt/biof3-r-server/biof3.db.
 *
 * This module only reads users + reads/writes tool_jobs + bridges datasets.meta_url
 * (py-server should not touch other tables).
 */

// ============================================================
// SQLite backend (lazy — only opened when actually used)
// ============================================================

const R_DB_PATH = process.env.BIOF3_R_DB_PATH || '/opt/biof3-r-server/biof3.db';

let _db = null;
function db() {
  if (!_db) {
    const Database = require('better-sqlite3');
    _db = new Database(R_DB_PATH, {readonly: false, fileMustExist: true});
    _db.pragma('journal_mode = WAL');
    _db.pragma('busy_timeout = 5000');
  }
  return _db;
}

// ============================================================
// Read: user info
// ============================================================

function getUserById(userId) {
  return db().prepare('SELECT id, username, role, quota_mb, max_analyses_month, enabled FROM users WHERE id = ?').get(userId);
}

// ============================================================
// Read: project (for project-run-layout resolver)
//
// Phase 2 (project-result-sandbox): the resolver needs projectId → workspace_path.
// This method only reads the projects table (workspace_path / status / user_id);
// it does not create or hydrate workspace paths — desktop projects are created via
// r-server/db.js which already hydrates workspace_path on creation.
// ============================================================

function getProject(id) {
  return db().prepare('SELECT * FROM projects WHERE id = ?').get(id) || null;
}

// ============================================================
// Write/Read: tool_jobs (mirror of routes/tools.js schema)
// ============================================================

function insertToolJob({jobId, userId, toolId, params, name, isTestRun, projectId}) {
  db().prepare(`INSERT INTO tool_jobs (id, user_id, tool_id, params_json, status, created_at, name, is_test_run, project_id)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
    .run(jobId, userId, toolId, JSON.stringify(params || {}), Date.now(), name, isTestRun ? 1 : 0, projectId || null);
  return getToolJob(jobId);
}

function getToolJob(jobId) {
  return db().prepare('SELECT * FROM tool_jobs WHERE id = ?').get(jobId);
}

function updateToolJobStatus(jobId, {status, error, resultJson, completedAt}) {
  // Build dynamic update so we don't overwrite fields we don't intend to.
  const sets = [];
  const vals = [];
  if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
  if (error !== undefined) { sets.push('error = ?'); vals.push(error); }
  if (resultJson !== undefined) { sets.push('result_json = ?'); vals.push(typeof resultJson === 'string' ? resultJson : JSON.stringify(resultJson)); }
  if (completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(completedAt); }
  if (sets.length === 0) return;
  vals.push(jobId);
  db().prepare(`UPDATE tool_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function listToolJobsByUser(userId, {limit = 50, includeTestRuns = false} = {}) {
  const sql = includeTestRuns
    ? 'SELECT id, tool_id, status, created_at, completed_at, error, name FROM tool_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT id, tool_id, status, created_at, completed_at, error, name FROM tool_jobs WHERE user_id = ? AND is_test_run = 0 ORDER BY created_at DESC LIMIT ?';
  return db().prepare(sql).all(userId, limit);
}

function countRunningJobsByUser(userId) {
  const row = db().prepare(`SELECT COUNT(*) AS cnt FROM tool_jobs
    WHERE user_id = ? AND status IN ('pending','running') AND is_test_run = 0`).get(userId);
  return row ? row.cnt : 0;
}

function deleteToolJob(jobId) {
  db().prepare('DELETE FROM tool_jobs WHERE id = ?').run(jobId);
}

// ============================================================
// W3-D (2026-05-28): Cross-server bridge — update datasets.meta_url/features_url
// after py-server spatial_standard completes (mirror r-server task-manager behavior
// so /spatial 数据预览 tab 与 /single-cell 一致用 CsvTable 渲染 obs/var 表).
//
// Find the analysis row by py-server task_id, then update its dataset's URLs.
// ============================================================

function updateDatasetMetaUrlsByTaskId(taskId, {metaUrl, featuresUrl}) {
  const row = db().prepare('SELECT dataset_id FROM analyses WHERE task_id = ?').get(taskId);
  if (!row || !row.dataset_id) return false;
  db().prepare('UPDATE datasets SET meta_url = ?, features_url = ? WHERE id = ?')
    .run(metaUrl, featuresUrl, row.dataset_id);
  return true;
}

function getPublicDemo(toolId) {
  return db().prepare(`SELECT * FROM tool_jobs WHERE tool_id = ? AND is_public = 1 AND status = 'completed' LIMIT 1`).get(toolId);
}

module.exports = {
  R_DB_PATH,
  getUserById,
  getProject,
  insertToolJob, getToolJob, updateToolJobStatus,
  listToolJobsByUser, countRunningJobsByUser, deleteToolJob,
  getPublicDemo,
  updateDatasetMetaUrlsByTaskId,
};
