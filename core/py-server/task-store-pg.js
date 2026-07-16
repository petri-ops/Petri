/**
 * Task store — PostgreSQL for py-server (shared queue with r-server).
 * Exports both async functions (for async drainQueue) and sync wrappers (via deasync).
 */
const {Pool} = require('pg');
const deasync = require('deasync');

const config = require('./config');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 10_000,
});
pool.connect().then((c) => c.release()).catch(() => {});

function tryParse(str) {
  if (!str) return null;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return str; }
}

function parseRow(row) {
  if (!row) return null;
  return {
    taskId: row.id, type: row.type,
    params: tryParse(row.params),
    ossInputUrl: row.oss_input_url,
    status: row.status,
    progress: row.progress,
    progressMessage: row.progress_message,
    createdAt: row.created_at, startedAt: row.started_at,
    finishedAt: row.finished_at,
    results: tryParse(row.results),
    error: row.error,
    workDir: row.work_dir,
    containerWorkDir: row.container_work_dir,
    parentTaskId: row.parent_task_id || null,
    workerId: row.worker_id || null,
    claimedAt: row.claimed_at || null,
  };
}

async function insertTask({taskId, type, params, ossInputUrl, workDir, containerWorkDir, parentTaskId}) {
  await pool.query(
    `INSERT INTO tasks (id, type, params, oss_input_url, status, progress, progress_message,
      created_at, work_dir, container_work_dir, parent_task_id, engine)
     VALUES ($1, $2, $3, $4, 'pending', 0, '排队中...', NOW(), $5, $6, $7, 'Python')`,
    [taskId, type, JSON.stringify(params || {}), ossInputUrl || null, workDir, containerWorkDir, parentTaskId || null],
  );
  return getTask(taskId);
}

async function getTask(taskId) {
  const r = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  return parseRow(r.rows[0]);
}

async function listTasks(limit = 50) {
  const r = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows.map(parseRow);
}

async function listPendingTasks(limit = 10) {
  const r = await pool.query(
    `SELECT * FROM tasks WHERE status = 'pending' AND engine = 'Python' ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return r.rows.map(parseRow);
}

async function getRunningCount() {
  const r = await pool.query(`SELECT COUNT(*)::int AS count FROM tasks WHERE status = 'running' AND engine = 'Python'`);
  return r.rows[0].count;
}

// Async claim — preferred for async drainQueue
async function asyncClaimPendingTask(workerId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const running = await client.query(
      `SELECT COUNT(*)::int AS count FROM tasks WHERE status = 'running' AND engine = 'Python' AND worker_id = $1`,
      [workerId],
    );
    if (running.rows[0].count >= config.maxConcurrentTasks) {
      await client.query('ROLLBACK');
      return null;
    }
    const pick = await client.query(
      `SELECT id FROM tasks WHERE status = 'pending' AND engine = 'Python' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!pick.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const id = pick.rows[0].id;
    await client.query(
      `UPDATE tasks SET status = 'running', worker_id = $1, claimed_at = NOW(),
       progress = 5, progress_message = '正在启动分析...', started_at = NOW() WHERE id = $2`,
      [workerId, id],
    );
    const row = await client.query('SELECT * FROM tasks WHERE id = $1', [id]);
    await client.query('COMMIT');
    return parseRow(row.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Sync wrapper for synchronous callers
function claimPendingTask(workerId) {
  let done = false, err = null, result = null;
  asyncClaimPendingTask(workerId)
    .then((r) => { result = r; done = true; })
    .catch((e) => { err = e; done = true; });
  deasync.loopWhile(() => !done);
  if (err) throw err;
  return result;
}

async function markRunning(taskId, workerId) {
  const wid = workerId || config.workerId;
  await pool.query(
    `UPDATE tasks SET status = 'running', progress = 5, progress_message = '正在启动分析...',
     started_at = COALESCE(started_at, NOW()), worker_id = $1, claimed_at = COALESCE(claimed_at, NOW())
     WHERE id = $2`,
    [wid, taskId],
  );
}

async function markDone(taskId, {results, progress = 100, progressMessage = '分析完成'}) {
  await pool.query(
    `UPDATE tasks SET status = 'done', progress = $1, progress_message = $2,
     finished_at = NOW(), results = $3, error = NULL WHERE id = $4`,
    [progress, progressMessage, JSON.stringify(results), taskId],
  );
}

async function markFailed(taskId, errorMsg) {
  await pool.query(
    `UPDATE tasks SET status = 'failed', progress = 0, progress_message = '分析失败',
     finished_at = NOW(), error = $1 WHERE id = $2`,
    [errorMsg, taskId],
  );
}

async function updateProgress(taskId, progress, message) {
  await pool.query(
    `UPDATE tasks SET status = 'running', progress = $1, progress_message = $2 WHERE id = $3`,
    [progress, message, taskId],
  );
}

async function getStats() {
  const r = await pool.query('SELECT status, COUNT(*)::int AS count FROM tasks WHERE engine = $1 GROUP BY status', ['Python']);
  const stats = {pending: 0, running: 0, done: 0, failed: 0};
  for (const row of r.rows) stats[row.status] = row.count;
  return stats;
}

async function cleanupOld(maxAgeMs = config.taskRetentionMs) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const r = await pool.query(`DELETE FROM tasks WHERE engine = 'Python' AND finished_at IS NOT NULL AND finished_at < $1`, [cutoff]);
  return r.rowCount;
}

module.exports = {
  insertTask, getTask, listTasks, listPendingTasks, getRunningCount,
  claimPendingTask, asyncClaimPendingTask,
  markRunning, markDone, markFailed, updateProgress, getStats, cleanupOld,
};
