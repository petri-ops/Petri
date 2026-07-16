/**
 * Task Store — SQLite persistent task storage for py-server.
 */

const config = require('./config');
const logger = require('./logger');

let _sqliteDb = null;
function getSqliteDb() {
  if (!_sqliteDb) {
    const Database = require('better-sqlite3');
    _sqliteDb = new Database(config.dbPath);
    _sqliteDb.pragma('journal_mode = WAL');
    _sqliteDb.pragma('busy_timeout = 5000');
  }
  return _sqliteDb;
}

{
  const db = getSqliteDb();
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

  const interrupted = db.prepare(
    `UPDATE tasks SET status = 'failed', error = '服务重启，任务中断', finished_at = ?
     WHERE status IN ('running', 'pending')`
  ).run(new Date().toISOString());
  if (interrupted.changes > 0) {
    logger.warn(`Marked ${interrupted.changes} interrupted task(s) as failed on startup`);
  }
}

const stmts = (() => {
  const db = getSqliteDb();
  return {
    insert: db.prepare(`INSERT INTO tasks (id, type, params, oss_input_url, status, progress, progress_message, created_at, work_dir, container_work_dir) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    list: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?'),
    listByStatus: db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC LIMIT ?'),
    updateStatus: db.prepare(`UPDATE tasks SET status = ?, progress = ?, progress_message = ?, started_at = COALESCE(?, started_at), finished_at = COALESCE(?, finished_at), results = COALESCE(?, results), error = COALESCE(?, error) WHERE id = ?`),
    countByStatus: db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status'),
    deleteOld: db.prepare('DELETE FROM tasks WHERE finished_at IS NOT NULL AND finished_at < ?'),
    countRunning: db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE status = 'running'`),
  };
})();

function insertTask({taskId, type, params, ossInputUrl, workDir, containerWorkDir}) {
  stmts.insert.run(taskId, type, JSON.stringify(params || {}), ossInputUrl || null, 'pending', 0, '排队中...', new Date().toISOString(), workDir, containerWorkDir);
  return getTask(taskId);
}

function getTask(taskId) {
  const row = stmts.get.get(taskId);
  return row ? parseRow(row) : null;
}

function listTasks(limit = 50) {
  return stmts.list.all(limit).map(parseRow);
}
function listPendingTasks(limit = 10) {
  return stmts.listByStatus.all('pending', limit).map(parseRow);
}
function getRunningCount() {
  return stmts.countRunning.get().count;
}

function markRunning(taskId) {
  stmts.updateStatus.run('running', 5, '正在启动分析...', new Date().toISOString(), null, null, null, taskId);
}
function markDone(taskId, {results, progress = 100, progressMessage = '分析完成'}) {
  stmts.updateStatus.run('done', progress, progressMessage, null, new Date().toISOString(), JSON.stringify(results), null, taskId);
}
function markFailed(taskId, errorMsg) {
  stmts.updateStatus.run('failed', 0, '分析失败', null, new Date().toISOString(), null, errorMsg, taskId);
}
function updateProgress(taskId, progress, message) {
  stmts.updateStatus.run('running', progress, message, null, null, null, null, taskId);
}

function getStats() {
  const rows = stmts.countByStatus.all();
  const stats = {pending: 0, running: 0, done: 0, failed: 0};
  for (const r of rows) stats[r.status] = r.count;
  return stats;
}

function cleanupOld(maxAgeMs = config.taskRetentionMs) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const result = stmts.deleteOld.run(cutoff);
  if (result.changes > 0) logger.info(`Cleaned up ${result.changes} old task(s)`);
  return result.changes;
}

function claimPendingTask(workerId) {
  const db = getSqliteDb();
  const claim = db.transaction(() => {
    const running = db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE status = 'running'`).get().count;
    if (running >= config.maxConcurrentTasks) return null;
    const row = db.prepare(`SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`).get();
    if (!row) return null;
    const now = new Date().toISOString();
    db.prepare(`UPDATE tasks SET status = 'running', progress = 5, progress_message = '正在启动分析...', started_at = ? WHERE id = ?`).run(now, row.id);
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.id);
  });
  return parseRow(claim());
}

function parseRow(row) {
  if (!row) return null;
  return {
    taskId: row.id, type: row.type, params: tryParse(row.params),
    ossInputUrl: row.oss_input_url, status: row.status,
    progress: row.progress, progressMessage: row.progress_message,
    createdAt: row.created_at, startedAt: row.started_at,
    finishedAt: row.finished_at, results: tryParse(row.results),
    error: row.error, workDir: row.work_dir, containerWorkDir: row.container_work_dir,
  };
}

function tryParse(str) { if (!str) return null; try { return JSON.parse(str); } catch { return str; } }

module.exports = {
  insertTask, getTask, listTasks, listPendingTasks, getRunningCount,
  claimPendingTask,
  markRunning, markDone, markFailed, updateProgress, getStats, cleanupOld,
};
