/**
 * SQLite persistence for background Agent loops and their SSE event stream.
 *
 * The `tasks` table name is retained for existing desktop databases, but this
 * module deliberately exposes no scientific-analysis queue API. Analysis
 * execution belongs to run_tool -> tool_job -> artifact truth.
 */

const eventBus = require('./helpers/event-bus');
const Database = require('better-sqlite3');
const config = require('./config');
const logger = require('./logger');
// BLOCK-10 PHASE 1.1 (E-019 full): busy_timeout is centralized in
// shared-backend/config-helper so db.js + agent-task-store.js +
// branch-db.js + result-db.js can never drift. Defaults to 10000ms;
// core/biof3-server boot can override via setDbConfig({ busyTimeoutMs }).
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
// matches core/biof3-server/db.js and src/database/{branch,result}-db.js.
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
  // BLOCK-31 P1: 会话级改动归属——任务终态持久化权威 filesChanged 清单（JSON 数组）
  'ALTER TABLE tasks ADD COLUMN files_changed_json TEXT',
  // BLOCK-38 P1: 中断续跑——服务重启清扫把 running agent_loop 任务标 failed 时写显式中断时间戳，
  // resume 端点仅接受 interrupted_at 非空的任务（非中断失败走既有 retry_pending 链路）
  'ALTER TABLE tasks ADD COLUMN interrupted_at TEXT',
  'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_next_retry ON tasks(next_retry_at) WHERE status = \'retry_pending\'',
  'CREATE INDEX IF NOT EXISTS idx_task_events_task_seq ON task_events(task_id, seq)',
  // BLOCK-106 P2 — 保留清扫按 created_at 删除，此前无索引 → 计划为 SCAN（236,087 行
  // 实测 35ms，成本随表线性增长）。与 idx_tasks_created 同一手法补齐。
  'CREATE INDEX IF NOT EXISTS idx_task_events_created ON task_events(created_at)',
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

// BLOCK-102 P4 — task_events 保留清扫：该表此前无界增长（sweeper PR-001 明确
// 排除，归属本模块）。30 天窗口保守值；递归 setTimeout + unref（不绊关闭），
// 失败 warn 不毒化后续轮次。
//
// BLOCK-106 P2 契约纠正：`created_at` 实际是 **JS ISO 串**（insertEvent 传
// `new Date().toISOString()`，形如 `2026-09-07T13:53:33.759Z`），不是本模块
// 旧注释所称的 SQLite `datetime('now')` 格式（`2026-09-07 13:53:33`，空格分隔）。
// 原谓词拿 SQLite 侧字符串比 ISO 侧字符串，字典序在第 10 位分岔（`T`=0x54 vs
// 空格=0x20），cutoff 当日 00:00 至该时刻之间的行会被判为「更新」而漏删（保守多留
// ≤24h，不会早删——2026-09-20 实测该表 236,087 行全为 ISO 形态，无混合行）。
// 现改为 JS 侧算好 ISO cutoff 作参数传入：同一格式比较，语义精确，且可直接走
// idx_task_events_created 范围扫描。
const TASK_EVENTS_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
function sweepOldTaskEvents(dbMod = db, { now = () => new Date() } = {}) {
  try {
    const cutoff = new Date(now().getTime() - TASK_EVENTS_RETENTION_DAYS * DAY_MS).toISOString();
    const result = dbMod
      .prepare('DELETE FROM task_events WHERE created_at < ?')
      .run(cutoff);
    if (result.changes > 0) {
      logger.warn(`[agent-task-store] retention: pruned ${result.changes} task_events older than ${TASK_EVENTS_RETENTION_DAYS}d (cutoff ${cutoff})`);
    }
    return result.changes;
  } catch (err) {
    logger.warn(`[agent-task-store] task_events retention sweep failed: ${err && err.message}`);
    return 0;
  }
}
let taskEventsSweepScheduled = false;
function scheduleTaskEventsRetention(dbMod = db) {
  if (taskEventsSweepScheduled) return;
  taskEventsSweepScheduled = true;
  sweepOldTaskEvents(dbMod);
  const timer = setTimeout(function reschedule() {
    sweepOldTaskEvents(dbMod);
    setTimeout(reschedule, 24 * 60 * 60 * 1000).unref();
  }, 24 * 60 * 60 * 1000);
  timer.unref();
}

// BLOCK-38 P1: 服务重启清扫（dbMod 可注入以便测试，缺省用单例 db——测试必须复用
// 同一连接，另开第二个 better-sqlite3 连接会触发 SQLITE_IOERR_SHORT_READ）。
// 把仍在 running 的 agent_loop 任务标记为 failed 并写入显式 interrupted_at 时间戳
// ——这是 resume 端点判定「可续跑」的唯一依据。模块加载时对单例 db 执行一次。
function sweepInterruptedRunningTasks(dbMod = db, { now = () => new Date().toISOString() } = {}) {
  try {
    const interrupted = dbMod
      .prepare(
        `UPDATE tasks
         SET status = 'failed', agent_status = 'failed', error = '服务重启，Agent 任务中断', finished_at = ?, interrupted_at = ?
         WHERE type = 'agent_loop' AND status = 'running'`
      )
      .run(now(), now());
    if (interrupted.changes > 0) {
      logger.warn(`Marked ${interrupted.changes} interrupted Agent task(s) as failed on startup`);
    }
    return interrupted.changes;
  } catch (err) {
    logger.warn(`[agent-task-store] interrupted task sweep failed: ${err && err.message}`);
    return 0;
  }
}

sweepInterruptedRunningTasks(db);
scheduleTaskEventsRetention(db);

const stmts = {
  insert: db.prepare(`
    INSERT INTO tasks (id, type, params, status, created_at, user_id, agent_status)
    VALUES (?, 'agent_loop', ?, 'running', ?, ?, 'running')
  `),
  get: db.prepare(
    `SELECT id, params, status, created_at, finished_at, error, user_id, agent_status,
            retry_count, retry_error_type, next_retry_at, max_retries, files_changed_json, interrupted_at
     FROM tasks WHERE id = ? AND type = 'agent_loop'`
  ),
  // BLOCK-38 P1: 可续跑任务查询——只有启动清扫显式标记 interrupted_at 的 failed 任务可续跑
  getResumable: db.prepare(
    `SELECT id, params, status, created_at, finished_at, error, user_id, agent_status,
            retry_count, retry_error_type, next_retry_at, max_retries, files_changed_json, interrupted_at
     FROM tasks
     WHERE id = ? AND type = 'agent_loop' AND interrupted_at IS NOT NULL AND status = 'failed'`
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
  // BLOCK-49: 全量子 agent 查询（含终态）——list_agents 工具数据源；
  // created_at 有索引（insert 顺序），parentTaskId 过滤在 JS 侧做 params 解析，
  // 与 getRunningChildAgentTasks 同一手法（params 为 JSON 文本，走 json_extract
  // 会因历史脏数据形态差异漏行）。
  listAll: db.prepare(
    `SELECT id, params, status, created_at, finished_at, error, user_id, agent_status,
            retry_count, retry_error_type, next_retry_at, max_retries, files_changed_json, interrupted_at
     FROM tasks WHERE type = 'agent_loop' ORDER BY created_at ASC`
  ),
  listRetryPending: db.prepare(
    `SELECT id, params, status, created_at, finished_at, error, user_id, agent_status,
            retry_count, retry_error_type, next_retry_at, max_retries
     FROM tasks WHERE type = 'agent_loop' AND status = 'retry_pending'
     AND next_retry_at <= ? ORDER BY next_retry_at ASC`
  ),
  // BLOCK-40 P1: 会话改动权威清单水合数据源——按会话查询已终态 agent_loop
  // 任务（params 为 JSON，conversationId 走 json_extract；排除 running/
  // retry_pending，未终态任务的 files_changed_json 尚未聚合，不构成权威清单）。
  listByConversation: db.prepare(
    `SELECT id, status, created_at, finished_at, files_changed_json
     FROM tasks
     WHERE type = 'agent_loop'
       AND status NOT IN ('running', 'retry_pending')
       AND json_extract(params, '$.conversationId') = ?
     ORDER BY COALESCE(finished_at, created_at) ASC`
  ),
  updateStatus: db.prepare(
    `UPDATE tasks SET agent_status = ?, status = ?, error = ?, finished_at = ?,
     files_changed_json = COALESCE(?, files_changed_json)
     WHERE id = ? AND type = 'agent_loop'`
  ),
  setFilesChanged: db.prepare(
    `UPDATE tasks SET files_changed_json = ?
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
  try { eventBus.publishInvalidation('jobs', { taskId, state: 'created' }); } catch { /* 通知失败不阻塞落库 */ }
  if (result && (status || agentStatus)) {
    // insertAgentTask already wrote status='running' / agent_status='running'
    // via the prepared statement defaults; if a caller passes different
    // status fields we surface them on the returned snapshot so the caller
    // can decide what to do (most callers ignore — kept lean by default).
    return { ...result, requestedStatus: status, requestedAgentStatus: agentStatus };
  }
  return result;
}

function mapTaskRow(row) {
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
    // BLOCK-31 P1: 权威任务改动文件清单（终态时由 agent-runner 聚合写入）
    filesChanged: tryParse(row.files_changed_json) || [],
    // BLOCK-38 P1: 中断时间戳（非空 = 服务重启清扫标记，可续跑）
    interruptedAt: row.interrupted_at || null,
    // Route compatibility while the persisted SQLite columns remain snake_case.
    user_id: row.user_id || null,
    agent_status: row.agent_status || null,
  };
}

function getAgentTask(taskId) {
  const row = stmts.get.get(taskId);
  if (!row) return null;
  return mapTaskRow(row);
}

// BLOCK-38 P1: 可续跑任务——仅 interrupted_at 非空的 failed 任务；不存在返回 null。
function getResumableTask(taskId) {
  const row = stmts.getResumable.get(taskId);
  if (!row) return null;
  return mapTaskRow(row);
}

// BLOCK-162 P1 — 进程内任务事件总线（additive）：appendAgentTaskEvent 落库成功
// 后 emit，网关 WS 订阅者据此即时推送（推送延迟地板 500ms DB 轮询 → 0）。
// 语义边界：总线只是「尽快知道」信号，不是投递保证——兜底仍走
// getAgentTaskEventsSince 水位轮询（2s），漏帧由轮询补齐、前端单调 seq 去重。
const taskEventBus = new (require('node:events').EventEmitter)();
taskEventBus.setMaxListeners(50);

function appendAgentTaskEvent(taskId, seq, eventType, payload) {
  stmts.insertEvent.run(
    taskId,
    seq,
    eventType,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    new Date().toISOString()
  );
  taskEventBus.emit('event', { taskId, seq, eventType, payload });
}

function getAgentTaskEventsSince(taskId, afterSeq, limit = 500) {
  return stmts.listEvents.all(taskId, afterSeq, limit).map((row) => ({
    seq: row.seq,
    eventType: row.event_type,
    payload: tryParse(row.payload),
    createdAt: row.created_at,
  }));
}

// BLOCK-109-CORE-ARCH P1.2（附录 A E2/E5）— 在途主任务清单（恢复的单一后端源）。
// 取代前端 localStorage gewu_agent_task_* 扫描双轨：tasks.status='running' 即权威
// 在途真相（后端重启由 sweepInterruptedRunningTasks 清扫陈旧行），无 TTL 猜测。
// 子任务不在列（kind 过滤）；畸形 params 行按 json_valid 防御视为 primary
// （同 listRecentSubAgentTasks 的防御先例）。
function listInFlightPrimaryTasks(userId, conversationId) {
  const rows = db.prepare(`
    SELECT id AS taskId, status, created_at AS createdAt, params
    FROM tasks
    WHERE user_id = ? AND status = 'running'
      AND (json_valid(params) = 0
           OR COALESCE(json_extract(params, '$.kind'), 'primary') <> 'subagent')
    ORDER BY created_at DESC
  `).all(userId);
  const mapped = rows.map((row) => {
    let rowConversationId = null;
    try { rowConversationId = (JSON.parse(row.params) || {}).conversationId || null; } catch {}
    return {
      taskId: row.taskId,
      status: row.status,
      createdAt: row.createdAt,
      conversationId: rowConversationId,
    };
  });
  if (!conversationId) return mapped;
  return mapped.filter((t) => t.conversationId === conversationId);
}

// BLOCK-109-CORE-ARCH P1（附录 A E3 裁决）— 终态 delta 合并（透明快照，非裸删）。
// 依据：①裸 delta 占 task_events 写入量 ~98.5%（BLOCK-106 实测）；②面板回放
// （subscribeAgentTask afterSeq=0 全量重放）依赖 delta 行承载流式正文/思考——
// 直接删除会丢失败运行的半截文本（P1.0 实测结论，plan 附录 A.3 补记）。
// 做法：按 iter 事件重建迭代边界，逐（迭代×类型）把 content/reasoning delta
// 合并为单条快照行（event_type 仍 'delta'、payload 形状不变 → 对回放器透明，
// 回放文本恒等），事务内删除被合并的原始行；结构 delta（tool_calls/未知形状）
// 与全部非 delta 事件原样保留。行数缩减 ≈ delta 行数 − 快照行数。
const DELTA_COALESCE_MIN_ROWS = 10;
function coalesceTaskDeltas(taskId) {
  const rows = db.prepare(
    'SELECT seq, event_type, payload FROM task_events WHERE task_id = ? ORDER BY seq'
  ).all(taskId);
  let deltaCount = 0;
  for (const r of rows) if (r.event_type === 'delta') deltaCount += 1;
  if (deltaCount < DELTA_COALESCE_MIN_ROWS) return { coalesced: 0, snapshots: 0 };

  const merged = new Map();
  const keepSeqs = new Set();
  let iteration = 0;
  for (const r of rows) {
    if (r.event_type === 'iter') { iteration += 1; continue; }
    if (r.event_type !== 'delta') continue;
    let kind = null;
    let text = '';
    try {
      const parsed = JSON.parse(r.payload);
      const delta = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
      if (!delta) { keepSeqs.add(r.seq); continue; }
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        kind = 'content'; text = delta.content;
      } else if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
        kind = 'reasoning'; text = delta.reasoning_content;
      } else {
        keepSeqs.add(r.seq); // tool_calls 等结构 delta 与空 delta 原样保留
        continue;
      }
    } catch {
      keepSeqs.add(r.seq);
      continue;
    }
    const key = iteration + ':' + kind;
    merged.set(key, (merged.get(key) || '') + text);
  }
  if (merged.size === 0) return { coalesced: 0, snapshots: 0 };

  const maxSeqRow = db.prepare('SELECT MAX(seq) AS m FROM task_events WHERE task_id = ?').get(taskId);
  let nextSeq = (maxSeqRow && maxSeqRow.m ? maxSeqRow.m : 0) + 1;
  const insertSnapshot = db.prepare(
    "INSERT INTO task_events (task_id, seq, event_type, payload, created_at) VALUES (?, ?, 'delta', ?, ?)"
  );
  const deleteCoalesced = db.prepare(
    'DELETE FROM task_events WHERE task_id = ? AND event_type = \'delta\' AND seq = ?'
  );
  const run = db.transaction(() => {
    const keys = [...merged.keys()].sort((a, b) => {
      const [ai, ak] = a.split(':');
      const [bi, bk] = b.split(':');
      return (Number(ai) - Number(bi)) || (ak === bk ? 0 : ak === 'reasoning' ? -1 : 1);
    });
    for (const key of keys) {
      const [, kind] = key.split(':');
      const payload = kind === 'content'
        ? { choices: [{ delta: { content: merged.get(key) } }] }
        : { choices: [{ delta: { reasoning_content: merged.get(key) } }] };
      insertSnapshot.run(taskId, nextSeq, JSON.stringify(payload), new Date().toISOString());
      nextSeq += 1;
    }
    let coalesced = 0;
    for (const r of rows) {
      if (r.event_type !== 'delta' || keepSeqs.has(r.seq)) continue;
      deleteCoalesced.run(taskId, r.seq);
      coalesced += 1;
    }
    return { coalesced, snapshots: keys.length };
  });
  return run();
}

function serializeFilesChanged(filesChanged) {
  if (!Array.isArray(filesChanged) || filesChanged.length === 0) return null;
  try {
    return JSON.stringify(filesChanged);
  } catch {
    return null;
  }
}

// BLOCK-31 P1: filesChanged 为可选权威清单（agent-files-changed.js 聚合产物），
// 传空/缺省时保留列中原值（COALESCE）。
function markAgentTaskDone(taskId, filesChanged) {
  try { eventBus.publishInvalidation('jobs', { taskId, state: 'completed' }); } catch { /* 通知失败不阻塞落库 */ }
  stmts.updateStatus.run(
    'done',
    'completed',
    null,
    new Date().toISOString(),
    serializeFilesChanged(filesChanged),
    taskId
  );
}

function markAgentTaskFailed(taskId, error, filesChanged) {
  try { eventBus.publishInvalidation('jobs', { taskId, state: 'failed' }); } catch { /* 通知失败不阻塞落库 */ }
  stmts.updateStatus.run(
    'failed',
    'failed',
    String(error || 'Agent 任务失败'),
    new Date().toISOString(),
    serializeFilesChanged(filesChanged),
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

// BLOCK-49: list_agents 数据源——当前任务派生的全部子 agent（含终态，按派生序）
function listChildAgentTasks(parentTaskId) {
  if (!parentTaskId) return [];
  return stmts.listAll.all().map((row) => ({
    taskId: row.id,
    params: tryParse(row.params),
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    error: row.error,
    userId: row.user_id || null,
    agentStatus: row.agent_status || null,
    filesChanged: tryParse(row.files_changed_json) || [],
  })).filter((task) => task.params?.kind === 'subagent' && task.params?.parentTaskId === parentTaskId);
}

// BLOCK-65 P2-c：agent 俯瞰面板数据源——该用户最近 N 个子 agent 任务
// （跨会话；只读投影 tasks 表，零第二真相）。
// UI-405 实机抓真修正：kind 过滤必须下推 SQL——曾整表 LIMIT 后再 JS 过滤
// subagent，主任务占满最近窗口时子 agent 任务被挤出俯瞰面板（🟡清偿）。
// json_valid 防御畸形 params 行（json_extract 对非法 JSON 会抛错）。
function listRecentSubAgentTasks(userId, limit = 50) {
  if (!userId) return [];
  const rows = db.prepare(
    `SELECT * FROM tasks
     WHERE user_id = ? AND json_valid(params) = 1 AND json_extract(params, '$.kind') = 'subagent'
     ORDER BY created_at DESC LIMIT ?`
  ).all(userId, Math.max(1, Math.min(200, limit)));
  return rows.map((row) => ({
    taskId: row.id,
    params: tryParse(row.params),
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    error: row.error,
    userId: row.user_id || null,
    agentStatus: row.agent_status || null,
    filesChanged: tryParse(row.files_changed_json) || [],
  }));
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

function markAgentTaskCancelled(taskId, filesChanged) {
  try { eventBus.publishInvalidation('jobs', { taskId, state: 'cancelled' }); } catch { /* 通知失败不阻塞落库 */ }
  stmts.updateStatus.run(
    'cancelled',
    'cancelled',
    null,
    new Date().toISOString(),
    serializeFilesChanged(filesChanged),
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
  // 重试重新运行前清除上一轮的终态文件清单
  stmts.setFilesChanged.run(null, taskId);
  stmts.updateStatus.run('running', 'running', null, null, null, taskId);
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

// BLOCK-40 P1: 会话改动权威清单水合源——跨任务按 path 合并（行序 =
// COALESCE(finished_at, created_at) 升序，后写覆盖先写），返回
// [{path,status,iteration,tool,lastChangedAt}]；lastChangedAt 用任务
// finishedAt/createdAt 兜底（files_changed_json 本身不存逐文件时间戳）。
function listConversationChanges(conversationId) {
  if (!conversationId) return [];
  const rows = stmts.listByConversation.all(conversationId);
  const byPath = new Map();
  for (const row of rows) {
    const items = tryParse(row.files_changed_json);
    if (!Array.isArray(items)) continue;
    const ts = row.finished_at || row.created_at;
    for (const item of items) {
      if (!item || typeof item.path !== 'string' || !item.path) continue;
      byPath.set(item.path, {
        path: item.path,
        status: item.status === 'created' ? 'created' : 'modified',
        iteration: typeof item.iteration === 'number' ? item.iteration : undefined,
        tool: typeof item.tool === 'string' ? item.tool : undefined,
        lastChangedAt: ts,
      });
    }
  }
  return Array.from(byPath.values());
}

module.exports = {
  insertAgentTask,
  createAgentTask,
  getAgentTask,
  getResumableTask,
  listConversationChanges,
  sweepInterruptedRunningTasks,
  // BLOCK-106 P2 — 导出供定向测试注入 dbMod/now（保留清扫语义与 ISO cutoff 契约）
  sweepOldTaskEvents,
  TASK_EVENTS_RETENTION_DAYS,
  appendAgentTaskEvent,
  taskEventBus, // BLOCK-162 P1 — 进程内事件总线（网关 WS 即时推送源）
  getAgentTaskEventsSince,
  coalesceTaskDeltas,
  listInFlightPrimaryTasks,
  getRunningChildAgentTasks,
  listChildAgentTasks,
  listRecentSubAgentTasks,
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
