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
// BLOCK-10 PHASE 1.1 (E-019 full): busy_timeout is centralized in
// shared-backend/config-helper so db.js + agent-task-store.js +
// branch-db.js + result-db.js can never drift. Defaults to 10000ms;
// core/r-server boot can override via setDbConfig({ busyTimeoutMs }).
const { getBusyTimeout } = require('../shared-backend/config-helper');

// Retry policy configuration by error type
const RETRY_POLICY = {
  network_timeout: { maxRetries: 3, backoff: 'exponential', baseDelay: 1000 },
  rate_limit: { maxRetries: 5, backoff: 'linear', delay: 5000 },
  model_overloaded: { maxRetries: 3, backoff: 'exponential', baseDelay: 2000 },
  internal_error: { maxRetries: 2, backoff: 'constant', delay: 1000 },
};

// Retry statistics — per-task isolation (BLOCK-10 S-006).
// Previously a module-level singleton that mixed every concurrent task's
// retry counters; now keyed by task_id so each agent loop carries its own
// counters and `resetRetryStats(taskId)` can scope the reset.
const retryStats = new Map();

function _ensureRetryStats(taskId) {
  let entry = retryStats.get(taskId);
  if (!entry) {
    entry = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      byErrorType: {
        network_timeout: { attempts: 0, successes: 0 },
        rate_limit: { attempts: 0, successes: 0 },
        model_overloaded: { attempts: 0, successes: 0 },
        internal_error: { attempts: 0, successes: 0 },
      },
    };
    retryStats.set(taskId, entry);
  }
  return entry;
}

/**
 * Detect error type from error message
 * @param {string|Error} error
 * @returns {string|null}
 */
function detectErrorType(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('timeout') || message.includes('timed out') || message.includes('network')) {
    return 'network_timeout';
  }
  if (message.includes('rate limit') || message.includes('rate_limit') || message.includes('too many requests')) {
    return 'rate_limit';
  }
  if (message.includes('overloaded') || message.includes('model busy') || message.includes('server busy')) {
    return 'model_overloaded';
  }
  if (message.includes('internal') || message.includes('500') || message.includes('server error')) {
    return 'internal_error';
  }
  return null;
}

/**
 * Calculate delay with exponential backoff and jitter
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {object} policy - Retry policy for this error type
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffDelay(attempt, policy) {
  let baseDelay;

  if (policy.backoff === 'exponential') {
    baseDelay = policy.baseDelay * Math.pow(2, attempt);
  } else if (policy.backoff === 'linear') {
    baseDelay = policy.delay;
  } else {
    baseDelay = policy.delay || policy.baseDelay || 1000;
  }

  // Add jitter (±25%) to prevent thundering herd
  const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(baseDelay + jitter);
}

/**
 * Check if an error is retryable
 * @param {string|Error} error
 * @returns {boolean}
 */
function isRetryableError(error) {
  return detectErrorType(error) !== null;
}

/**
 * Get retry policy for an error
 * @param {string|Error} error
 * @returns {object|null}
 */
function getRetryPolicy(error) {
  const errorType = detectErrorType(error);
  return errorType ? RETRY_POLICY[errorType] : null;
}

/**
 * Check if more retries are allowed for an error
 * @param {number} currentRetryCount
 * @param {string|Error} error
 * @returns {boolean}
 */
function canRetry(currentRetryCount, error) {
  const policy = getRetryPolicy(error);
  return policy !== null && currentRetryCount < policy.maxRetries;
}

/**
 * Get next retry delay in milliseconds
 * @param {number} currentRetryCount
 * @param {string|Error} error
 * @returns {number}
 */
function getNextRetryDelay(currentRetryCount, error) {
  const policy = getRetryPolicy(error);
  if (!policy) return 0;
  return calculateBackoffDelay(currentRetryCount, policy);
}

/**
 * Calculate next retry timestamp
 * @param {number} currentRetryCount
 * @param {string|Error} error
 * @returns {Date}
 */
function getNextRetryTime(currentRetryCount, error) {
  const delay = getNextRetryDelay(currentRetryCount, error);
  return new Date(Date.now() + delay);
}

/**
 * Record retry attempt in statistics for a specific task.
 * @param {string} taskId - agent task identifier
 * @param {string} errorType
 * @param {boolean} succeeded
 */
function recordRetryAttempt(taskId, errorType, succeeded) {
  const stats = _ensureRetryStats(taskId);
  stats.totalRetries++;
  if (succeeded) {
    stats.successfulRetries++;
  } else {
    stats.failedRetries++;
  }
  if (stats.byErrorType[errorType]) {
    stats.byErrorType[errorType].attempts++;
    if (succeeded) {
      stats.byErrorType[errorType].successes++;
    }
  }
}

/**
 * Get retry statistics for a specific task. If taskId is omitted, returns
 * aggregated stats across all known tasks (back-compat for any external
 * caller that had been relying on the pre-S-006 singleton).
 * @param {string} [taskId]
 * @returns {object}
 */
function getRetryStats(taskId) {
  if (taskId) {
    const stats = retryStats.get(taskId);
    if (!stats) {
      return {
        totalRetries: 0,
        successfulRetries: 0,
        failedRetries: 0,
        byErrorType: {
          network_timeout: { attempts: 0, successes: 0 },
          rate_limit: { attempts: 0, successes: 0 },
          model_overloaded: { attempts: 0, successes: 0 },
          internal_error: { attempts: 0, successes: 0 },
        },
        retrySuccessRate: 0,
      };
    }
    return {
      ...stats,
      retrySuccessRate:
        stats.totalRetries > 0
          ? (stats.successfulRetries / stats.totalRetries) * 100
          : 0,
    };
  }
  // aggregate over all known tasks
  const agg = {
    totalRetries: 0,
    successfulRetries: 0,
    failedRetries: 0,
    byErrorType: {
      network_timeout: { attempts: 0, successes: 0 },
      rate_limit: { attempts: 0, successes: 0 },
      model_overloaded: { attempts: 0, successes: 0 },
      internal_error: { attempts: 0, successes: 0 },
    },
  };
  for (const stats of retryStats.values()) {
    agg.totalRetries += stats.totalRetries;
    agg.successfulRetries += stats.successfulRetries;
    agg.failedRetries += stats.failedRetries;
    for (const errorType of Object.keys(stats.byErrorType)) {
      agg.byErrorType[errorType].attempts += stats.byErrorType[errorType].attempts;
      agg.byErrorType[errorType].successes += stats.byErrorType[errorType].successes;
    }
  }
  return {
    ...agg,
    retrySuccessRate:
      agg.totalRetries > 0
        ? (agg.successfulRetries / agg.totalRetries) * 100
        : 0,
  };
}

/**
 * Reset retry statistics for a specific task (or all tasks if taskId is omitted).
 * @param {string} [taskId]
 */
function resetRetryStats(taskId) {
  if (taskId) {
    retryStats.delete(taskId);
    return;
  }
  retryStats.clear();
}

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
// BLOCK-10 PHASE 1.1 (E-019 full): use the shared config-helper busy_timeout
// (default 10000ms) instead of the legacy hard-coded 5000ms so this handle
// matches core/r-server/db.js and src/database/{branch,result}-db.js.
db.pragma(`busy_timeout = ${getBusyTimeout()}`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    params TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'running',
    created_at TEXT NOT NULL,
    finished_at TEXT,
    error TEXT,
    -- BLOCK-10 S-006: user_id is intended NOT NULL but is kept nullable in
    -- CREATE TABLE for backwards compatibility with existing dev DBs. New
    -- writes must populate user_id (see INSERT/UPDATE statements below).
    user_id TEXT,
    agent_status TEXT,
    retry_count INTEGER DEFAULT 0,
    retry_error_type TEXT,
    next_retry_at TEXT,
    max_retries INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Existing databases may predate the Agent-loop columns and retry columns,
// and predate the indexes that reference those columns. We must ALTER first
// (so the columns exist) before any CREATE INDEX that touches them, and
// tolerate each statement failing on already-present schema/columns.
for (const statement of [
  'ALTER TABLE tasks ADD COLUMN user_id TEXT',
  'ALTER TABLE tasks ADD COLUMN agent_status TEXT',
  'ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN retry_error_type TEXT',
  'ALTER TABLE tasks ADD COLUMN next_retry_at TEXT',
  'ALTER TABLE tasks ADD COLUMN max_retries INTEGER DEFAULT 0',
  'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_next_retry ON tasks(next_retry_at) WHERE status = \'retry_pending\'',
  'CREATE INDEX IF NOT EXISTS idx_task_events_task_seq ON task_events(task_id, seq)',
]) {
  try {
    db.exec(statement);
  } catch (err) {
    // Statement-level failure must not abort module load. A failing ALTER
    // means the column already exists; a failing CREATE INDEX means the
    // column it depends on is still missing. Log so the failure is visible
    // instead of silently swallowed.
    logger.warn(`[agent-task-store] schema step skipped: ${statement} (${err && err.message})`);
  }
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
    `SELECT id, params, status, created_at, finished_at, error, user_id, agent_status,
            retry_count, retry_error_type, next_retry_at, max_retries
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
    `SELECT id, params, status, created_at, finished_at, error, user_id, agent_status,
            retry_count, retry_error_type, next_retry_at, max_retries
     FROM tasks WHERE type = 'agent_loop' AND status = 'running'`
  ),
  listRetryPending: db.prepare(
    `SELECT id, params, status, created_at, finished_at, error, user_id, agent_status,
            retry_count, retry_error_type, next_retry_at, max_retries
     FROM tasks WHERE type = 'agent_loop' AND status = 'retry_pending'
     AND next_retry_at <= ? ORDER BY next_retry_at ASC`
  ),
  updateStatus: db.prepare(
    `UPDATE tasks SET agent_status = ?, status = ?, error = ?, finished_at = ?
     WHERE id = ? AND type = 'agent_loop'`
  ),
  requestCancel: db.prepare(
    `UPDATE tasks SET agent_status = 'cancel_requested'
     WHERE id = ? AND type = 'agent_loop' AND status = 'running'`
  ),
  updateRetryInfo: db.prepare(
    `UPDATE tasks
     SET retry_count = ?, retry_error_type = ?, next_retry_at = ?, max_retries = ?,
         status = 'retry_pending', agent_status = 'retry_pending', error = ?
     WHERE id = ? AND type = 'agent_loop'`
  ),
  clearRetryInfo: db.prepare(
    `UPDATE tasks
     SET retry_count = 0, retry_error_type = NULL, next_retry_at = NULL, max_retries = 0
     WHERE id = ? AND type = 'agent_loop'`
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

// PHASE 2.2b-compatible friendly alias: auto-generates taskId (uuid v4),
// accepts the looser shape used by routes/ai-agent/chat.js
// ({ status, agentStatus, userId, params }). Returns the inserted task
// snapshot so callers can grab the generated taskId without a follow-up read.
function createAgentTask(opts = {}) {
  const { userId, params, status, agentStatus } = opts;
  const taskId = require('crypto').randomUUID();
  const result = insertAgentTask({ taskId, userId, params });
  if (result && (status || agentStatus)) {
    // insertAgentTask already wrote status='running' / agent_status='running'
    // via the prepared statement defaults; if a caller passes different
    // status fields we surface them on the returned snapshot so the caller
    // can decide what to do (most callers ignore — kept lean by default).
    return { ...result, requestedStatus: status, requestedAgentStatus: agentStatus };
  }
  return result;
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
    retryCount: row.retry_count || 0,
    retryErrorType: row.retry_error_type || null,
    nextRetryAt: row.next_retry_at || null,
    maxRetries: row.max_retries || 0,
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
    retryCount: row.retry_count || 0,
    retryErrorType: row.retry_error_type || null,
    nextRetryAt: row.next_retry_at || null,
    maxRetries: row.max_retries || 0,
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

/**
 * Schedule a task for retry based on error type
 * @param {string} taskId
 * @param {string|Error} error
 * @returns {boolean} true if retry was scheduled, false if max retries exceeded
 */
function scheduleAgentTaskRetry(taskId, error) {
  const errorType = detectErrorType(error);
  const policy = getRetryPolicy(error);

  if (!policy) {
    logger.warn(`Task ${taskId}: Non-retryable error, marking as failed`);
    markAgentTaskFailed(taskId, error);
    return false;
  }

  const task = getAgentTask(taskId);
  const currentRetryCount = task?.retryCount || 0;

  if (currentRetryCount >= policy.maxRetries) {
    logger.warn(`Task ${taskId}: Max retries (${policy.maxRetries}) exceeded`);
    markAgentTaskFailed(taskId, `Max retries exceeded: ${error}`);
    recordRetryAttempt(taskId, errorType, false);
    return false;
  }

  const nextRetryCount = currentRetryCount + 1;
  const nextRetryAt = getNextRetryTime(currentRetryCount, error);
  const errorMessage = String(error?.message || error || 'Unknown error');

  stmts.updateRetryInfo.run(
    nextRetryCount,
    errorType,
    nextRetryAt.toISOString(),
    policy.maxRetries,
    `Retry ${nextRetryCount}/${policy.maxRetries}: ${errorMessage}`,
    taskId
  );

  logger.info(
    `Task ${taskId}: Scheduled retry ${nextRetryCount}/${policy.maxRetries} at ${nextRetryAt.toISOString()} (error: ${errorType})`
  );
  recordRetryAttempt(taskId, errorType, false);

  return true;
}

/**
 * Get tasks that are ready for retry
 * @returns {Array}
 */
function getRetryableTasks() {
  const now = new Date().toISOString();
  return stmts.listRetryPending.all(now).map((row) => ({
    taskId: row.id,
    params: tryParse(row.params),
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    error: row.error,
    userId: row.user_id || null,
    agentStatus: row.agent_status || null,
    retryCount: row.retry_count || 0,
    retryErrorType: row.retry_error_type || null,
    nextRetryAt: row.next_retry_at || null,
    maxRetries: row.max_retries || 0,
  }));
}

/**
 * Reset task for retry execution
 * @param {string} taskId
 */
function resetTaskForRetry(taskId) {
  stmts.clearRetryInfo.run(taskId);
  stmts.updateStatus.run('running', 'running', null, null, taskId);
}

/**
 * Check if a task should be retried
 * @param {string} taskId
 * @returns {boolean}
 */
function shouldRetryTask(taskId) {
  const task = getAgentTask(taskId);
  if (!task) return false;
  if (task.status !== 'retry_pending') return false;

  const errorType = task.retryErrorType;
  const policy = errorType ? RETRY_POLICY[errorType] : null;

  if (!policy) return false;
  return task.retryCount < policy.maxRetries;
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
  createAgentTask,
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
  // Retry strategy exports
  RETRY_POLICY,
  detectErrorType,
  isRetryableError,
  getRetryPolicy,
  canRetry,
  getNextRetryDelay,
  getNextRetryTime,
  scheduleAgentTaskRetry,
  getRetryableTasks,
  resetTaskForRetry,
  shouldRetryTask,
  getRetryStats,
  resetRetryStats,
};
