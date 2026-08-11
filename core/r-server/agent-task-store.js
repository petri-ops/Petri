/**
 * SQLite persistence for background Agent loops and their SSE event stream.
 *
 * The `tasks` table name is retained for existing desktop databases, but this
 * module deliberately exposes no scientific-analysis queue API. Analysis
 * execution belongs to run_tool -> tool_job -> artifact truth.
 */

const Database = require('better-sqlite3');
const config = require('./config');
const logger = require('./logger');

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    params TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'running',
    created_at TEXT NOT NULL,
    finished_at TEXT,
    error TEXT,
    user_id TEXT,
    agent_status TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

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

// Existing databases may predate the Agent-loop columns.
for (const statement of [
  'ALTER TABLE tasks ADD COLUMN user_id TEXT',
  'ALTER TABLE tasks ADD COLUMN agent_status TEXT',
]) {
  try {
    db.exec(statement);
  } catch {}
}

const interrupted = db
  .prepare(
    `UPDATE tasks
     SET status = 'failed', agent_status = 'failed', error = '服务重启，Agent 任务中断', finished_at = ?
     WHERE type = 'agent_loop' AND status = 'running'`
  )
  .run(new Date().toISOString());

if (interrupted.changes > 0) {
  logger.warn(`Marked ${interrupted.changes} interrupted Agent task(s) as failed on startup`);
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO tasks (id, type, params, status, created_at, user_id, agent_status)
    VALUES (?, 'agent_loop', ?, 'running', ?, ?, 'running')
  `),
  get: db.prepare(
    `SELECT id, params, status, created_at, finished_at, error, user_id, agent_status
     FROM tasks WHERE id = ? AND type = 'agent_loop'`
  ),
  insertEvent: db.prepare(`
    INSERT INTO task_events (task_id, seq, event_type, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  listEvents: db.prepare(
    `SELECT seq, event_type, payload, created_at FROM task_events
     WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`
  ),
  listRunning: db.prepare(
    `SELECT id, params, status, created_at, finished_at, error, user_id, agent_status
     FROM tasks WHERE type = 'agent_loop' AND status = 'running'`
  ),
  updateStatus: db.prepare(
    `UPDATE tasks SET agent_status = ?, status = ?, error = ?, finished_at = ?
     WHERE id = ? AND type = 'agent_loop'`
  ),
  requestCancel: db.prepare(
    `UPDATE tasks SET agent_status = 'cancel_requested'
     WHERE id = ? AND type = 'agent_loop' AND status = 'running'`
  ),
};

function insertAgentTask({ taskId, userId, params }) {
  stmts.insert.run(
    taskId,
    JSON.stringify(params || {}),
    new Date().toISOString(),
    userId || null
  );
  return getAgentTask(taskId);
}

function getAgentTask(taskId) {
  const row = stmts.get.get(taskId);
  if (!row) return null;
  return {
    taskId: row.id,
    params: tryParse(row.params),
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    error: row.error,
    userId: row.user_id || null,
    agentStatus: row.agent_status || null,
    // Route compatibility while the persisted SQLite columns remain snake_case.
    user_id: row.user_id || null,
    agent_status: row.agent_status || null,
  };
}

function appendAgentTaskEvent(taskId, seq, eventType, payload) {
  stmts.insertEvent.run(
    taskId,
    seq,
    eventType,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    new Date().toISOString()
  );
}

function getAgentTaskEventsSince(taskId, afterSeq, limit = 500) {
  return stmts.listEvents.all(taskId, afterSeq, limit).map((row) => ({
    seq: row.seq,
    eventType: row.event_type,
    payload: tryParse(row.payload),
    createdAt: row.created_at,
  }));
}

function markAgentTaskDone(taskId) {
  stmts.updateStatus.run('done', 'completed', null, new Date().toISOString(), taskId);
}

function markAgentTaskFailed(taskId, error) {
  stmts.updateStatus.run(
    'failed',
    'failed',
    String(error || 'Agent 任务失败'),
    new Date().toISOString(),
    taskId
  );
}

function requestAgentTaskCancel(taskId) {
  const result = stmts.requestCancel.run(taskId);
  return result.changes > 0;
}

function getRunningChildAgentTasks(parentTaskId) {
  if (!parentTaskId) return [];
  return stmts.listRunning.all().map((row) => ({
    taskId: row.id,
    params: tryParse(row.params),
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    error: row.error,
    userId: row.user_id || null,
    agentStatus: row.agent_status || null,
  })).filter((task) => task.params?.kind === 'subagent' && task.params?.parentTaskId === parentTaskId);
}

/**
 * AGENT-CONCURRENCY: cancel a primary agent loop and cascade the cancel to all
 * of its child sub-agent loops (enumerated by parent_loop_run_id). Cancelling a
 * sub-agent never cascades upward to its parent or sideways to siblings.
 *
 * The cascade reads LoopRun rows from the shared `db` module (injected as
 * `dbMod`) but flips agent task status through this store's own connection, so
 * a primary cancel reaches every still-running child task in a single call.
 *
 * @param {string} taskId  the task to cancel (primary or sub-agent)
 * @param {{ dbMod: object }} deps  shared db module exposing
 *   getLoopRunByTaskId / getLoopRunsByParentLoopRunId
 * @returns {{ cancelledTaskIds: string[] }} ids whose agent_status was flipped
 *   to cancel_requested by this call
 */
function cancelAgentTaskCascade(taskId, { dbMod }) {
  const cancelledTaskIds = [];
  const requestedTask = getAgentTask(taskId);
  // Always request cancel on the requested task itself.
  if (requestAgentTaskCancel(taskId)) cancelledTaskIds.push(taskId);

  // Agent task identity exists before the first tool call creates a LoopRun.
  // Use the durable task parent relation first so cancellation works during
  // ordinary model thinking and context-assist phases as well.
  if ((requestedTask?.params?.kind || 'primary') === 'primary') {
    for (const child of getRunningChildAgentTasks(taskId)) {
      if (requestAgentTaskCancel(child.taskId)) cancelledTaskIds.push(child.taskId);
    }
  }

  // Compatibility fallback for tasks written before parentTaskId was stored.
  try {
    const loop = dbMod.getLoopRunByTaskId(taskId);
    if (loop && loop.kind === 'primary') {
      const children = dbMod.getLoopRunsByParentLoopRunId(loop.loopRunId);
      for (const child of children) {
        if (child.taskId && requestAgentTaskCancel(child.taskId)) {
          cancelledTaskIds.push(child.taskId);
        }
      }
    }
  } catch {}

  return { cancelledTaskIds };
}

function isAgentTaskCancellationRequested(taskId) {
  const task = getAgentTask(taskId);
  return task?.agentStatus === 'cancel_requested' || task?.agentStatus === 'cancelled';
}

function markAgentTaskCancelled(taskId) {
  stmts.updateStatus.run(
    'cancelled',
    'cancelled',
    null,
    new Date().toISOString(),
    taskId
  );
}

function tryParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

module.exports = {
  insertAgentTask,
  getAgentTask,
  appendAgentTaskEvent,
  getAgentTaskEventsSince,
  getRunningChildAgentTasks,
  markAgentTaskDone,
  markAgentTaskFailed,
  requestAgentTaskCancel,
  cancelAgentTaskCascade,
  isAgentTaskCancellationRequested,
  markAgentTaskCancelled,
};
