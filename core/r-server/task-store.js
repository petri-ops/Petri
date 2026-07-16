/**
 * Task Store — SQLite-backed persistent task storage.
 *
 * Replaces the in-memory Map so tasks survive server restarts.
 * Running tasks are marked as 'failed' on startup (they were interrupted).
 *
 * Schema:
 *   tasks(id, type, params, oss_input_url, status, progress, progress_message,
 *         created_at, started_at, finished_at, results, error, work_dir, container_work_dir)
 */

const Database = require('better-sqlite3');
const config = require('./config');
const logger = require('./logger');

const USE_TASK_PG = !!(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());
let _pg = null;
let _runPg = null;
if (USE_TASK_PG) {
  const deasync = require('deasync');
  _pg = require('./task-store-pg');
  _runPg = (fn) => {
    if (global.__biof3DeasyncActive) {
      throw new Error(
        '[deasync-guard] concurrent sync DB call rejected (deasync.loopWhile not reentrant) — task-store op during another deasync call'
      );
    }
    let done = false;
    let err = null;
    let result = null;
    Promise.resolve(fn())
      .then((r) => {
        result = r;
        done = true;
      })
      .catch((e) => {
        err = e;
        done = true;
      });
    const DEADLINE_MS = 25_000;
    const deadline = Date.now() + DEADLINE_MS;
    const ka = setInterval(() => {}, 250);
    global.__biof3DeasyncActive = true;
    try {
      deasync.loopWhile(() => !done && Date.now() < deadline);
    } finally {
      global.__biof3DeasyncActive = false;
      clearInterval(ka);
    }
    if (!done) {
      throw new Error(
        '[task-store] PG op exceeded ' +
          DEADLINE_MS +
          'ms deadline (deasync backstop) — likely stale PostgreSQL connection'
      );
    }
    if (err) throw err;
    return result;
  };
  // Startup cleanup is only safe for a process that actually executes tasks.
  // Platform/api nodes share the PG queue with Dell workers, so their restarts
  // must not mark someone else's running tasks as failed.
  if (config.runMode === 'worker' || config.runMode === 'all') {
    try {
      _runPg(() => _pg.markInterruptedOnStartup(config.workerId));
    } catch (e) {
      logger.warn(`[task-store] startup markInterrupted skipped (PG not ready): ${e && e.message}`);
    }
  }
  console.log('[task-store] PostgreSQL tasks queue (platform + Dell workers)');
}

const db = USE_TASK_PG ? null : new Database(config.dbPath);
// ponytail: stmts declared at module scope so ESLint doesn't flag it as
// block-scoped unused (inside if) + no-undef (outside if). The if-block
// assigns it; the Public API functions below read it.
let stmts = null;
if (!USE_TASK_PG) {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // ============================================================
  // Schema migration
  // ============================================================

  db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    params TEXT DEFAULT '{}',
    oss_input_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    progress_message TEXT DEFAULT '排队中...',
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    results TEXT,
    error TEXT,
    work_dir TEXT,
    container_work_dir TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
`);

  try {
    db.exec('ALTER TABLE tasks ADD COLUMN worker_id TEXT');
  } catch {}
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN claimed_at TEXT');
  } catch {}
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN parent_task_id TEXT');
  } catch {}
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN engine TEXT DEFAULT \'R\'');
  } catch {}
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN user_id TEXT');
  } catch {}
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN agent_status TEXT');
  } catch {}

  // agent loop 事件流表（P2-b）：订阅端点按 seq 回放
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task_seq ON task_events(task_id, seq);
  `);

  // On startup: running tasks were interrupted (workers/API restarted)
  const interrupted = db
    .prepare(
      `UPDATE tasks SET status = 'failed', error = '服务重启，任务中断', finished_at = ?, worker_id = NULL
   WHERE status = 'running'`
    )
    .run(new Date().toISOString());

  if (interrupted.changes > 0) {
    logger.warn(`Marked ${interrupted.changes} interrupted task(s) as failed on startup`);
  }

  // ============================================================
  // Prepared statements
  // ============================================================

  stmts = USE_TASK_PG
    ? null
    : {
        insert: db.prepare(`
    INSERT INTO tasks (id, type, params, oss_input_url, status, progress, progress_message,
                       created_at, work_dir, container_work_dir, parent_task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
        get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
        list: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?'),
        listByStatus: db.prepare(
          'SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC LIMIT ?'
        ),
        updateStatus: db.prepare(`
    UPDATE tasks SET status = ?, progress = ?, progress_message = ?,
                     started_at = COALESCE(?, started_at),
                     finished_at = COALESCE(?, finished_at),
                     results = COALESCE(?, results),
                     error = COALESCE(?, error)
    WHERE id = ?
  `),
        countByStatus: db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status'),
        deleteOld: db.prepare(
          'DELETE FROM tasks WHERE finished_at IS NOT NULL AND finished_at < ?'
        ),
        countRunning: db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE status = 'running'`),
        countRunningOnWorker: db.prepare(
          `SELECT COUNT(*) as count FROM tasks WHERE status = 'running' AND worker_id = ?`
        ),
        // agent task（P2-b）
        insertAgent: db.prepare(`
          INSERT INTO tasks (id, type, params, status, created_at, engine, user_id, agent_status)
          VALUES (?, 'agent_loop', ?, 'running', ?, 'agent', ?, 'running')
        `),
        insertEvent: db.prepare(`
          INSERT INTO task_events (task_id, seq, event_type, payload, created_at)
          VALUES (?, ?, ?, ?, ?)
        `),
        listEvents: db.prepare(
          `SELECT seq, event_type, payload, created_at FROM task_events
           WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`
        ),
        updateAgentStatus: db.prepare(
          `UPDATE tasks SET agent_status = ?, status = ?, error = ?, finished_at = ? WHERE id = ?`
        ),
      };
} // end !USE_TASK_PG sqlite init

// ============================================================
// Public API
// ============================================================

function insertTask({
  taskId,
  type,
  params,
  ossInputUrl,
  workDir,
  containerWorkDir,
  parentTaskId,
}) {
  if (USE_TASK_PG)
    return _runPg(() =>
      _pg.insertTask({ taskId, type, params, ossInputUrl, workDir, containerWorkDir, parentTaskId })
    );
  stmts.insert.run(
    taskId,
    type,
    JSON.stringify(params || {}),
    ossInputUrl || null,
    'pending',
    0,
    '排队中...',
    new Date().toISOString(),
    workDir,
    containerWorkDir,
    parentTaskId || null
  );
  return getTask(taskId);
}

function createTaskForQueue({
  type,
  params,
  ossInputUrl,
  parentTaskId,
  workDir,
  containerWorkDir,
}) {
  if (USE_TASK_PG)
    return _runPg(() =>
      _pg.createTaskForQueue({ type, params, ossInputUrl, parentTaskId, workDir, containerWorkDir })
    );
  const { v4: uuidv4 } = require('uuid');
  const taskId = uuidv4();
  insertTask({ taskId, type, params, ossInputUrl, workDir, containerWorkDir, parentTaskId });
  return { taskId, status: 'pending' };
}

function claimPendingTask(workerId) {
  if (USE_TASK_PG) return _runPg(() => _pg.claimPendingTask(workerId));
  const claim = db.transaction(() => {
    const running = stmts.countRunningOnWorker.get(workerId).count;
    if (running >= config.maxConcurrentTasks) return null;
    const row = db
      .prepare(`SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`)
      .get();
    if (!row) return null;
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE tasks SET status = 'running', worker_id = ?, claimed_at = ?,
       progress = 5, progress_message = '正在启动分析...', started_at = ? WHERE id = ?`
    ).run(workerId, now, now, row.id);
    return parseRow(stmts.get.get(row.id));
  });
  return claim();
}

function getRunningCountForWorker(workerId) {
  if (USE_TASK_PG) return _runPg(() => _pg.getRunningCountForWorker(workerId));
  return stmts.countRunningOnWorker.get(workerId).count;
}

function publicTask(task) {
  if (USE_TASK_PG) return _pg.publicTask(task);
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

function getTask(taskId) {
  if (USE_TASK_PG) return _runPg(() => _pg.getTask(taskId));
  const row = stmts.get.get(taskId);
  if (!row) return null;
  return parseRow(row);
}

function listTasks(limit = 50) {
  if (USE_TASK_PG) return _runPg(() => _pg.listTasks(limit));
  return stmts.list.all(limit).map(parseRow);
}

function listPendingTasks(limit = 10) {
  if (USE_TASK_PG) return _runPg(() => _pg.listPendingTasks(limit));
  return stmts.listByStatus.all('pending', limit).map(parseRow);
}

function getRunningCount() {
  if (USE_TASK_PG) return _runPg(() => _pg.getRunningCount());
  return stmts.countRunning.get().count;
}

function markRunning(taskId, workerId) {
  if (USE_TASK_PG) return _runPg(() => _pg.markRunning(taskId, workerId));
  const wid = workerId || config.workerId;
  db.prepare(
    `UPDATE tasks SET status = 'running', progress = 5, progress_message = '正在启动分析...',
     started_at = ?, worker_id = ?, claimed_at = COALESCE(claimed_at, ?) WHERE id = ?`
  ).run(new Date().toISOString(), wid, new Date().toISOString(), taskId);
}

function markDone(taskId, { results, progress = 100, progressMessage = '分析完成' }) {
  if (USE_TASK_PG)
    return _runPg(() => _pg.markDone(taskId, { results, progress, progressMessage }));
  stmts.updateStatus.run(
    'done',
    progress,
    progressMessage,
    null,
    new Date().toISOString(),
    JSON.stringify(results),
    null,
    taskId
  );
}

function markFailed(taskId, errorMsg) {
  if (USE_TASK_PG) return _runPg(() => _pg.markFailed(taskId, errorMsg));
  stmts.updateStatus.run(
    'failed',
    0,
    '分析失败',
    null,
    new Date().toISOString(),
    null,
    errorMsg,
    taskId
  );
}

function updateProgress(taskId, progress, message) {
  if (USE_TASK_PG) return _runPg(() => _pg.updateProgress(taskId, progress, message));
  stmts.updateStatus.run('running', progress, message, null, null, null, null, taskId);
}

function getStats() {
  if (USE_TASK_PG) return _runPg(() => _pg.getStats());
  const rows = stmts.countByStatus.all();
  const stats = { pending: 0, running: 0, done: 0, failed: 0 };
  for (const r of rows) stats[r.status] = r.count;
  return stats;
}

function cleanupOld(maxAgeMs = config.taskRetentionMs) {
  if (USE_TASK_PG) return _runPg(() => _pg.cleanupOld(maxAgeMs));
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const result = stmts.deleteOld.run(cutoff);
  if (result.changes > 0) {
    logger.info(`Cleaned up ${result.changes} old task(s)`);
  }
  return result.changes;
}

// ============================================================
// Agent task（P2-b 阶段 1）— agent loop 解放后的 task + 事件流
// ============================================================

function insertAgentTask({ taskId, userId, params }) {
  if (USE_TASK_PG) return _runPg(() => _pg.insertAgentTask({ taskId, userId, params }));
  stmts.insertAgent.run(
    taskId,
    JSON.stringify(params || {}),
    new Date().toISOString(),
    userId || null
  );
  return getTask(taskId);
}

function appendTaskEvent(taskId, seq, eventType, payload) {
  if (USE_TASK_PG) return _runPg(() => _pg.appendTaskEvent(taskId, seq, eventType, payload));
  stmts.insertEvent.run(
    taskId,
    seq,
    eventType,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    new Date().toISOString()
  );
}

function getTaskEventsSince(taskId, afterSeq, limit = 500) {
  if (USE_TASK_PG) return _runPg(() => _pg.getTaskEventsSince(taskId, afterSeq, limit));
  return stmts.listEvents.all(taskId, afterSeq, limit).map((r) => ({
    seq: r.seq,
    eventType: r.event_type,
    payload: tryParse(r.payload),
    createdAt: r.created_at,
  }));
}

function markAgentDone(taskId) {
  if (USE_TASK_PG) return _runPg(() => _pg.markAgentDone(taskId));
  stmts.updateAgentStatus.run('done', 'completed', null, new Date().toISOString(), taskId);
}

function markAgentFailed(taskId, errorMsg) {
  if (USE_TASK_PG) return _runPg(() => _pg.markAgentFailed(taskId, errorMsg));
  stmts.updateAgentStatus.run('failed', 'failed', String(errorMsg || 'agent task 失败'), new Date().toISOString(), taskId);
}

// ============================================================
// Helpers
// ============================================================

function parseRow(row) {
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

function tryParse(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

module.exports = {
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
