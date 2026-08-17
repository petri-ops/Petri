/**
 * core/r-server/jobs/retention-sweeper.js
 *
 * Retention sweeper for SQLite append-only tables (PR-001 closeout).
 *
 * Background:
 *   r-server hosts append-only ledgers (loop_iterations / loop_actions /
 *   loop_evidence / loop_decisions / loop_state_snapshots in db.js, plus
 *   copilot_messages in helpers/conversations.js). Without a sweeper, long
 *   running installs accumulate rows indefinitely. We do NOT touch
 *   agent-task-store.js (task_events) here — that module is owned by an
 *   earlier work package and the sweeper would race its writers.
 *
 * Failure model:
 *   - Each table delete is wrapped in its own try/catch. A single failure
 *     MUST NOT halt the rest of the sweep. Failures are logged via
 *     console.warn so the operator sees partial progress, then re-tried
 *     on the next tick. We never swallow silently.
 *   - Concurrency: better-sqlite3 is synchronous and a single process owns
 *     the file at a time (WAL allows multiple readers + single writer), so
 *     we run deletes sequentially.
 *
 * Scheduling:
 *   - `scheduleRetentionSweep` uses a recursive setTimeout (NOT setInterval)
 *     to match the existing cacheManager pattern in core/r-server/.
 *   - The handle is unref'd so a pending sweep never keeps the process alive
 *     during shutdown.
 *
 * NOT in scope:
 *   - Vacuum / incremental_vacuum (deferred — would need additional IO
 *     priority reasoning).
 *   - branch_db.messages / result_db.result_versions tables (those live in
 *     src/database/* which is owned by the branch+result work package).
 *   - agent_task_events (owned by agent-task-store.js — out of scope).
 */

'use strict';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

// Per-table retention window in days. Conservative defaults; tune only with
// accompanying product decision.
const RETENTION_DAYS = {
  copilotMessages: 90,
  loopIterations: 30,
  loopActions: 30,
  loopEvidence: 30,
  loopDecisions: 30,
  loopStateSnapshots: 30,
};

function nowIsoDate(daysAgo) {
  const ts = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  return new Date(ts).toISOString();
}

function isoDaysAgo(days) {
  return `datetime('now', '-${Math.max(1, Math.floor(days))} day')`;
}

/**
 * Run a single retention pass. Each table delete is isolated so one
 * failure does not poison the others.
 *
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db  r-server main DB
 * @param {Function} [deps.warn]  logger (defaults to console.warn)
 * @returns {{ scanned: string[], deleted: Record<string,number>, failures: Array<{table: string, reason: string}> }}
 */
function runRetentionSweep({ db, warn = console.warn } = {}) {
  if (!db) {
    return { scanned: [], deleted: {}, failures: [{ table: '<sweep>', reason: 'db_not_provided' }] };
  }

  const deleted = {};
  const failures = [];
  const scanned = [];

  // ---- copilot_messages: delete rows older than RETENTION_DAYS.copilotMessages
  // whose parent conversation is not 'active'. Active conversations must keep
  // full history so the user never sees message loss.
  scanned.push('copilot_messages');
  try {
    const cutoff = isoDaysAgo(RETENTION_DAYS.copilotMessages);
    const res = db.prepare(`
      DELETE FROM copilot_messages
      WHERE ts < ${cutoff}
        AND conversation_id NOT IN (
          SELECT id FROM copilot_conversations WHERE status = 'active'
        )
    `).run();
    deleted.copilot_messages = res.changes || 0;
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    warn(`retention-purge: failed at copilot_messages, reason=${msg}`);
    failures.push({ table: 'copilot_messages', reason: msg });
  }

  // ---- loop ledger: only sweep terminal loop_runs (completed / failed /
  // cancelled). planned / running must keep their full audit trail so a
  // multi-turn task can resume. Loop iterations / actions / evidence /
  // decisions / snapshots are deleted when their parent loop_run is
  // terminal AND the row itself is older than the window.
  const terminalLoopRunWhere = `
    loop_run_id IN (
      SELECT loop_run_id FROM loop_runs
      WHERE loop_status IN ('completed','failed','cancelled')
        AND updated_at < ${isoDaysAgo(RETENTION_DAYS.loopIterations)}
    )
  `;

  const loopTables = [
    ['loop_iterations', 'created_at'],
    ['loop_actions', 'created_at'],
    ['loop_evidence', 'created_at'],
    ['loop_decisions', 'created_at'],
    ['loop_state_snapshots', 'created_at'],
  ];

  for (const [table, tsColumn] of loopTables) {
    scanned.push(table);
    try {
      const cutoff = isoDaysAgo(RETENTION_DAYS.loopIterations);
      const res = db.prepare(`
        DELETE FROM ${table}
        WHERE ${tsColumn} < ${cutoff}
          AND ${terminalLoopRunWhere}
      `).run();
      deleted[table] = res.changes || 0;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      warn(`retention-purge: failed at ${table}, reason=${msg}`);
      failures.push({ table, reason: msg });
    }
  }

  return { scanned, deleted, failures };
}

let schedulerHandle = null;
let activeIntervalMs = DEFAULT_INTERVAL_MS;
let lastDbRef = null;
let lastWarnFn = console.warn;

function computeNextDelay(intervalMs) {
  // Stagger the first run ~60s after boot so we do not contend with recovery
  // sweeps (zombie job scan, etc.). Subsequent runs follow the normal interval.
  if (schedulerHandle === null) return Math.min(intervalMs, 60 * 1000);
  return intervalMs;
}

/**
 * Schedule a retention sweep that re-runs every `intervalMs` milliseconds
 * using a recursive setTimeout. The handle is unref'd so it never keeps the
 * process alive during graceful shutdown.
 *
 * @param {object} opts
 * @param {number} [opts.intervalMs]
 * @param {import('better-sqlite3').Database} opts.db
 * @param {Function} [opts.warn]
 * @param {Function} [opts.setTimeoutFn]
 * @param {Function} [opts.clearTimeoutFn]
 */
function scheduleRetentionSweep({
  intervalMs = DEFAULT_INTERVAL_MS,
  db,
  warn = console.warn,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!db) {
    warn('retention-purge: scheduler not started, db missing');
    return null;
  }
  if (schedulerHandle) {
    // Already running — restart with the new interval.
    clearTimeoutFn(schedulerHandle);
    schedulerHandle = null;
  }

  activeIntervalMs = intervalMs;
  lastDbRef = db;
  lastWarnFn = warn;

  function scheduleNext() {
    const delay = computeNextDelay(activeIntervalMs);
    schedulerHandle = setTimeoutFn(() => {
      try {
        const report = runRetentionSweep({ db: lastDbRef, warn: lastWarnFn });
        const total = Object.values(report.deleted).reduce((acc, n) => acc + (n || 0), 0);
        if (report.failures.length > 0) {
          warn(
            `retention-purge: partial sweep deleted=${total} tables=${report.scanned.length} failures=${report.failures.length}`
          );
        } else if (total > 0) {
          warn(`retention-purge: deleted=${total} tables=${report.scanned.length}`);
        }
      } catch (e) {
        // Top-level guard. runRetentionSweep already isolates per-table
        // failures; this catches the unexpected (e.g. db handle closed).
        const msg = e && e.message ? e.message : String(e);
        warn(`retention-purge: sweep top-level error, reason=${msg}`);
      }
      scheduleNext();
    }, delay);
    if (schedulerHandle && typeof schedulerHandle.unref === 'function') {
      schedulerHandle.unref();
    }
  }

  scheduleNext();
  return schedulerHandle;
}

function stopRetentionSweep({ clearTimeoutFn = clearTimeout } = {}) {
  if (schedulerHandle) {
    clearTimeoutFn(schedulerHandle);
    schedulerHandle = null;
  }
  lastDbRef = null;
}

module.exports = {
  runRetentionSweep,
  scheduleRetentionSweep,
  stopRetentionSweep,
  RETENTION_DAYS,
  DEFAULT_INTERVAL_MS,
};