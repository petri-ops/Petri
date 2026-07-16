/**
 * Task store — PostgreSQL (shared queue for platform enqueue + Dell workers).
 */
const {query, getPool} = require('./db-pg');
const config = require('./config');
const logger = require('./logger');

function tryParse(str) {
  if (!str) return null;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function parseRow(row) {
  if (!row) return null;
  return {
    taskId: row.id,
    type: row.type,
    params: tryParse(row.params),
    ossInputUrl: row.oss_input_url,
    status: row.status,
    progress: row.progress,
    progressMessage: row.progress_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    results: tryParse(row.results),
    error: row.error,
    workDir: row.work_dir,
    containerWorkDir: row.container_work_dir,
    parentTaskId: row.parent_task_id || null,
    workerId: row.worker_id || null,
    claimedAt: row.claimed_at || null,
    engine: row.engine || null,
    userId: row.user_id || null,
    agentStatus: row.agent_status || null,
    // 下划线别名：路由层（ai-agent.js 订阅端点）按 task.user_id / task.agent_status 读
    user_id: row.user_id || null,
    agent_status: row.agent_status || null,
  };
}

async function markInterruptedOnStartup(workerId) {
  if (!workerId) return {rowCount: 0, rows: []};
  const r = await query(
    `UPDATE tasks SET status = 'failed', error = '服务重启，任务中断', finished_at = NOW(), worker_id = NULL
     WHERE status = 'running' AND engine = 'R' AND worker_id = $1 RETURNING id`,
    [workerId],
  );
  if (r.rowCount > 0) logger.warn(`Marked ${r.rowCount} interrupted task(s) for worker ${workerId} as failed on startup (PG)`);
  return r;
}

async function insertTask({taskId, type, params, ossInputUrl, workDir, containerWorkDir, parentTaskId}) {
  await query(
    `INSERT INTO tasks (id, type, params, oss_input_url, status, progress, progress_message,
      created_at, work_dir, container_work_dir, parent_task_id, engine)
     VALUES ($1, $2, $3, $4, 'pending', 0, '排队中...', NOW(), $5, $6, $7, 'R')`,
    [
      taskId,
      type,
      JSON.stringify(params || {}),
      ossInputUrl || null,
      workDir,
      containerWorkDir,
      parentTaskId || null,
    ],
  );
  return getTask(taskId);
}

async function createTaskForQueue(opts) {
  const {v4: uuidv4} = require('uuid');
  const taskId = uuidv4();
  await insertTask({taskId, ...opts});
  return {taskId, status: 'pending'};
}

async function getTask(taskId) {
  const r = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  return parseRow(r.rows[0]);
}

async function listTasks(limit = 50) {
  const r = await query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows.map(parseRow);
}

async function listPendingTasks(limit = 10) {
  const r = await query(
    `SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return r.rows.map(parseRow);
}

async function getRunningCount() {
  const r = await query(`SELECT COUNT(*)::int AS count FROM tasks WHERE status = 'running'`);
  return r.rows[0].count;
}

async function getRunningCountForWorker(workerId) {
  const r = await query(
    `SELECT COUNT(*)::int AS count FROM tasks WHERE status = 'running' AND worker_id = $1`,
    [workerId],
  );
  return r.rows[0].count;
}

async function claimPendingTask(workerId) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const running = await client.query(
      `SELECT COUNT(*)::int AS count FROM tasks WHERE status = 'running' AND worker_id = $1`,
      [workerId],
    );
    if (running.rows[0].count >= config.maxConcurrentTasks) {
      await client.query('ROLLBACK');
      return null;
    }
    const pick = await client.query(
      `SELECT id FROM tasks WHERE status = 'pending' AND engine = 'R' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
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

function publicTask(task) {
  if (!task) return null;
  return {
    taskId: task.taskId,
    type: task.type,
    status: task.status,
    progress: task.progress,
    progressMessage: task.progressMessage,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    results: task.results,
    error: task.error,
    workerId: task.workerId || null,
  };
}

async function markRunning(taskId, workerId) {
  const wid = workerId || config.workerId;
  await query(
    `UPDATE tasks SET status = 'running', progress = 5, progress_message = '正在启动分析...',
     started_at = COALESCE(started_at, NOW()), worker_id = $1, claimed_at = COALESCE(claimed_at, NOW())
     WHERE id = $2`,
    [wid, taskId],
  );
}

async function markDone(taskId, {results, progress = 100, progressMessage = '分析完成'}) {
  await query(
    `UPDATE tasks SET status = 'done', progress = $1, progress_message = $2,
     finished_at = NOW(), results = $3, error = NULL WHERE id = $4`,
    [progress, progressMessage, JSON.stringify(results), taskId],
  );
}

async function markFailed(taskId, errorMsg) {
  await query(
    `UPDATE tasks SET status = 'failed', progress = 0, progress_message = '分析失败',
     finished_at = NOW(), error = $1 WHERE id = $2`,
    [errorMsg, taskId],
  );
}

async function updateProgress(taskId, progress, message) {
  await query(
    `UPDATE tasks SET status = 'running', progress = $1, progress_message = $2 WHERE id = $3`,
    [progress, message, taskId],
  );
}

async function getStats() {
  const r = await query('SELECT status, COUNT(*)::int AS count FROM tasks GROUP BY status');
  const stats = {pending: 0, running: 0, done: 0, failed: 0};
  for (const row of r.rows) stats[row.status] = row.count;
  return stats;
}

async function cleanupOld(maxAgeMs = config.taskRetentionMs) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const r = await query(`DELETE FROM tasks WHERE finished_at IS NOT NULL AND finished_at < $1`, [cutoff]);
  if (r.rowCount > 0) logger.info(`Cleaned up ${r.rowCount} old task(s) (PG)`);
  return r.rowCount;
}

// ============================================================
// Agent task（P2-b 阶段 1）— agent loop 解放后的 task + 事件流
// ============================================================

async function insertAgentTask({ taskId, userId, params }) {
  await query(
    `INSERT INTO tasks (id, type, params, status, progress, progress_message, created_at, engine, user_id, agent_status)
     VALUES ($1, 'agent_loop', $2, 'running', 0, 'agent 推理中...', NOW(), 'agent', $3, 'running')`,
    [taskId, JSON.stringify(params || {}), userId || null]
  );
  return getTask(taskId);
}

async function appendTaskEvent(taskId, seq, eventType, payload) {
  await query(
    `INSERT INTO task_events (task_id, seq, event_type, payload, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [taskId, seq, eventType, typeof payload === 'string' ? payload : JSON.stringify(payload)]
  );
}

async function getTaskEventsSince(taskId, afterSeq, limit = 500) {
  const r = await query(
    `SELECT seq, event_type, payload, created_at FROM task_events
     WHERE task_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
    [taskId, afterSeq, limit]
  );
  return (r.rows || []).map((row) => ({
    seq: row.seq,
    eventType: row.event_type,
    payload: tryParse(row.payload),
    createdAt: row.created_at,
  }));
}

async function markAgentDone(taskId) {
  await query(
    `UPDATE tasks SET agent_status = 'done', status = 'completed', error = NULL, finished_at = NOW() WHERE id = $1`,
    [taskId]
  );
}

async function markAgentFailed(taskId, errorMsg) {
  await query(
    `UPDATE tasks SET agent_status = 'failed', status = 'failed', error = $2, finished_at = NOW() WHERE id = $1`,
    [taskId, errorMsg]
  );
}

module.exports = {
  markInterruptedOnStartup,
  insertTask,
  createTaskForQueue,
  getTask,
  listTasks,
  listPendingTasks,
  getRunningCount,
  claimPendingTask,
  getRunningCountForWorker,
  publicTask,
  markRunning,
  markDone,
  markFailed,
  updateProgress,
  getStats,
  cleanupOld,
  // agent task（P2-b）
  insertAgentTask,
  appendTaskEvent,
  getTaskEventsSince,
  markAgentDone,
  markAgentFailed,
};
