/**
 * r-server-db-pg.js (P0-B, 2026-06-07)
 *
 * PostgreSQL implementation of r-server-db.js for py-server.
 * Used when DATABASE_URL is set — writes tool_jobs / reads users /
 * bridges datasets in the shared PostgreSQL DB (symmetric with r-server's PG path),
 * instead of the Dell-local biof3.db SQLite file.
 *
 * Exports fully async functions. r-server-db.js provides sync wrappers
 * (via deasync) so the synchronous Express consumers (tools-router.js,
 * task-queue.js) keep working unchanged.
 *
 * Schema source: r-server/migrations/pg/006_tool_jobs.sql + 001_core.sql.
 * Note: tool_jobs.created_at / completed_at are BIGINT (epoch ms) — pg returns
 * BIGINT as string, so we coerce them back to Number to match the SQLite shape
 * the consumers expect.
 */

const {getPool} = require('./db-pg');

function q(text, params) {
  return getPool().query(text, params);
}

function toNum(v) {
  if (v === null || v === undefined) return v;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}

// Normalize a tool_jobs row to the shape SQLite produced (numeric epoch ms,
// numeric is_public / is_test_run flags).
function normJob(row) {
  if (!row) return row;
  return {
    ...row,
    created_at: toNum(row.created_at),
    completed_at: row.completed_at === null || row.completed_at === undefined ? row.completed_at : toNum(row.completed_at),
    is_public: toNum(row.is_public),
    is_test_run: toNum(row.is_test_run),
  };
}

// ============================================================
// Read: user info
// ============================================================

async function getUserById(userId) {
  const r = await q(
    'SELECT id, username, role, quota_mb, max_analyses_month, enabled FROM users WHERE id = $1',
    [userId],
  );
  return r.rows[0] || undefined;
}

// ============================================================
// Read: project (for project-run-layout resolver)
//
// Phase 2 (project-result-sandbox): resolver needs projectId → workspace_path.
// Only reads the projects table in the shared PG DB (symmetric with r-server).
// ============================================================

async function getProject(id) {
  const r = await q('SELECT * FROM projects WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// ============================================================
// Write/Read: tool_jobs
// ============================================================

async function insertToolJob({jobId, userId, toolId, params, name, isTestRun, projectId}) {
  await q(
    `INSERT INTO tool_jobs (id, user_id, tool_id, params_json, status, created_at, name, is_test_run, project_id)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)`,
    [jobId, userId, toolId, JSON.stringify(params || {}), Date.now(), name, isTestRun ? 1 : 0, projectId || null],
  );
  return getToolJob(jobId);
}

async function getToolJob(jobId) {
  const r = await q('SELECT * FROM tool_jobs WHERE id = $1', [jobId]);
  return normJob(r.rows[0]);
}

async function updateToolJobStatus(jobId, {status, error, resultJson, completedAt}) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (status !== undefined) { sets.push(`status = $${i++}`); vals.push(status); }
  if (error !== undefined) { sets.push(`error = $${i++}`); vals.push(error); }
  if (resultJson !== undefined) {
    sets.push(`result_json = $${i++}`);
    vals.push(typeof resultJson === 'string' ? resultJson : JSON.stringify(resultJson));
  }
  if (completedAt !== undefined) { sets.push(`completed_at = $${i++}`); vals.push(completedAt); }
  if (sets.length === 0) return;
  vals.push(jobId);
  await q(`UPDATE tool_jobs SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

async function listToolJobsByUser(userId, {limit = 50, includeTestRuns = false} = {}) {
  const sql = includeTestRuns
    ? 'SELECT id, tool_id, status, created_at, completed_at, error, name FROM tool_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2'
    : 'SELECT id, tool_id, status, created_at, completed_at, error, name FROM tool_jobs WHERE user_id = $1 AND is_test_run = 0 ORDER BY created_at DESC LIMIT $2';
  const r = await q(sql, [userId, limit]);
  return r.rows.map((row) => ({
    ...row,
    created_at: toNum(row.created_at),
    completed_at: row.completed_at === null || row.completed_at === undefined ? row.completed_at : toNum(row.completed_at),
  }));
}

async function countRunningJobsByUser(userId) {
  const r = await q(
    `SELECT COUNT(*)::int AS cnt FROM tool_jobs
     WHERE user_id = $1 AND status IN ('pending','running') AND is_test_run = 0`,
    [userId],
  );
  return r.rows[0] ? r.rows[0].cnt : 0;
}

async function deleteToolJob(jobId) {
  await q('DELETE FROM tool_jobs WHERE id = $1', [jobId]);
}

// ============================================================
// Cross-server bridge — update datasets.meta_url/features_url by py task id.
// Find the analysis row by py-server task_id, then update its dataset's URLs.
// ============================================================

async function updateDatasetMetaUrlsByTaskId(taskId, {metaUrl, featuresUrl}) {
  const r = await q('SELECT dataset_id FROM analyses WHERE task_id = $1', [taskId]);
  const row = r.rows[0];
  if (!row || !row.dataset_id) return false;
  await q('UPDATE datasets SET meta_url = $1, features_url = $2 WHERE id = $3', [metaUrl, featuresUrl, row.dataset_id]);
  return true;
}

async function getPublicDemo(toolId) {
  const r = await q(
    `SELECT * FROM tool_jobs WHERE tool_id = $1 AND is_public = 1 AND status = 'completed' LIMIT 1`,
    [toolId],
  );
  return normJob(r.rows[0]);
}

module.exports = {
  getUserById,
  getProject,
  insertToolJob, getToolJob, updateToolJobStatus,
  listToolJobsByUser, countRunningJobsByUser, deleteToolJob,
  getPublicDemo,
  updateDatasetMetaUrlsByTaskId,
};
