/**
 * core/biof3-server/jobs/retention-sweeper.js
 *
 * Retention sweeper for SQLite append-only tables (PR-001 closeout).
 *
 * Background:
 *   biof3-server hosts append-only ledgers (loop_iterations / loop_actions /
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
 *     to match the existing cacheManager pattern in core/biof3-server/.
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
  // PL-4a（2026-09-29）— tool_jobs 终态行 90 天窗口（对齐 copilotMessages 保守值）：
  // 每次分析 = 1 行（result_json manifest 数十 KB）+ 一个 job 目录（inputs 副本 +
  // all_results.zip 双份等），无界增长在此止血。demo/公开资产与活跃作业（无
  // completed_at 的终态外状态）永不删；目录级联清理与软引用风险见下方实现注释。
  toolJobs: 90,
};

// PL-D2（BLOCK-149 · 2026-10-08 裁决落定）——BIOF3_TOOL_JOBS_RETENTION_DAYS 的
// 缺省保留天数=30：主代理按推荐代裁+用户批量推进授权（先例=agent-task-store.js
// 的 TASK_EVENTS_RETENTION_DAYS=30）；此前 BLOCK-136 机制先行期默认 0=关闭。
// 用户可一句话改回：显式设 env 0/负数=关闭。
const DEFAULT_TOOL_JOBS_RETENTION_DAYS = 30;

/**
 * PL-D2 缺省解析器（纯函数，契约测试 block136-retention.test.mjs 钉住）：
 *   - 未设（undefined）→ 缺省 30 天；
 *   - 合法数值（含 0/负数=显式关闭、小数不取整）→ 原样透传（窗口语义交
 *     retentionSweep 纯函数：<=0 视为 disabled）；
 *   - 非法值/空串 → 0 关闭（fail-closed：解析不确定时宁可少删不多删）。
 * @param {string|undefined} rawEnv  process.env.BIOF3_TOOL_JOBS_RETENTION_DAYS 原始值
 * @returns {number}
 */
function resolveToolJobsRetentionDays(rawEnv) {
  if (rawEnv === undefined) return DEFAULT_TOOL_JOBS_RETENTION_DAYS;
  const days = Number(rawEnv);
  return Number.isFinite(days) ? days : 0;
}

function isoDaysAgo(days) {
  return `datetime('now', '-${Math.max(1, Math.floor(days))} day')`;
}

/**
 * Run a single retention pass. Each table delete is isolated so one
 * failure does not poison the others.
 *
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db  biof3-server main DB
 * @param {Function} [deps.warn]  logger (defaults to console.warn)
 * @returns {{ scanned: string[], deleted: Record<string,number>, failures: Array<{table: string, reason: string}> }}
 */
function runRetentionSweep({ db, warn = console.warn, jobsDir: jobsDirParam } = {}) {
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

  // ---- tool_jobs: PL-4a — 终态（completed/failed）+ completed_at 超 90 天窗口。
  // 保护面：is_public=1（含 public demo 资产）与 PUBLIC_DEMO_JOB_IDS 双保险；
  // 非终态（pending/running——含对账器管辖域）绝不删。
  // 目录级联：删除前行先 SELECT 出 (id, project_id)，项目内布局经
  // resolveProjectRunLayout 解析 jobRoot（与 tools-executor 的
  // cleanupLocalToolJobDir 同语义；该函数为工厂闭包不可直接复用，此处内联
  // 等价实现），全局回退 jobsDir/<jobId>；目录清理失败不阻塞行删除（下次
  // sweep 不再命中该行——孤儿目录风险登记：以 jobsDir 落盘为准）。
  // 软引用：scientific_task_specs.tool_job_id / lineage / truth-projection 对
  // 已删行均按 .get() 容错（lineage 实证 null→「无血缘可投影」诚实回退）；
  // 与既有单条删除端点 DELETE /api/tools/job/:id 同后果同风险等级。
  scanned.push('tool_jobs');
  try {
    const fsMod = require('node:fs');
    const pathMod = require('node:path');
    const osMod = require('node:os');
    const { resolveProjectRunLayout } = require('../../shared-backend/project-run-layout');
    // config-helper 导出 Proxy（字段访问直通 getConfig()，无 {config} 具名导出）
    const config = require('../../shared-backend/config-helper');
    const { PUBLIC_DEMO_JOB_IDS } = require('../helpers/tools-assets');
    const jobsDir = jobsDirParam || pathMod.join(
      config.localResultsDir || pathMod.join(osMod.homedir(), 'Documents', 'BioF3-Local', 'results'),
      'tool-jobs',
    );
    // completed_at 是 INTEGER 毫秒——不能用 isoDaysAgo 的 datetime() 字符串（类型序
    // 下 INTEGER < TEXT 恒真会把所有行当超窗；既有表是 TEXT 时间才适用该助手）
    const cutoffMs = Date.now() - RETENTION_DAYS.toolJobs * 24 * 60 * 60 * 1000;
    const victims = db.prepare(`
      SELECT id, project_id FROM tool_jobs
      WHERE status IN ('completed','failed')
        AND completed_at IS NOT NULL
        AND completed_at < ${cutoffMs}
        AND is_public = 0
    `).all().filter((row) => !PUBLIC_DEMO_JOB_IDS.has(row.id));
    let dirsRemoved = 0;
    for (const row of victims) {
      try {
        let jobDir = null;
        if (row.project_id) {
          try {
            const layout = resolveProjectRunLayout({
              projectId: row.project_id,
              toolJobId: row.id,
              db: db,
              skipPermissionCheck: true,
              ensureDirs: false,
            });
            jobDir = layout.jobRoot;
          } catch { /* 布局解析失败落全局回退 */ }
        }
        if (!jobDir) jobDir = pathMod.join(jobsDir, row.id);
        if (fsMod.existsSync(jobDir)) {
          fsMod.rmSync(jobDir, { recursive: true, force: true });
          dirsRemoved += 1;
        }
      } catch (e) {
        warn(`retention-purge: tool_jobs dir cleanup failed id=${row.id} reason=${e && e.message}`);
      }
    }
    const res = db.prepare(`
      DELETE FROM tool_jobs
      WHERE status IN ('completed','failed')
        AND completed_at IS NOT NULL
        AND completed_at < ${cutoffMs}
        AND is_public = 0
        AND id IN (${victims.length ? victims.map(() => '?').join(',') : "''"})
    `).run(...victims.map((row) => row.id));
    deleted.tool_jobs = res.changes || 0;
    deleted.tool_jobs_dirs = dirsRemoved;
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    warn(`retention-purge: failed at tool_jobs, reason=${msg}`);
    failures.push({ table: 'tool_jobs', reason: msg });
  }

  // ---- tool_jobs retention（BLOCK-136 · PL-4 机制先行；PL-D2 裁决落定）——环境变量
  // 驱动的第二把扫帚，挂在下方既有清扫节拍（scheduleRetentionSweep 的递归
  // setTimeout → 本函数）上。上方 PL-4a 内联段保持原样：completed/failed +
  // completed_at 90 天常开，契约测试 pl4a-tool-jobs-retention.test.mjs 钉住。
  // 本段职责（PL-D2 2026-10-08 裁决=缺省 30 天删除，主代理按推荐代裁+用户
  // 批量推进授权；先例=task_events TASK_EVENTS_RETENTION_DAYS=30）：
  //   - BIOF3_TOOL_JOBS_RETENTION_DAYS（缺省 30 天）实时读取（见
  //     resolveToolJobsRetentionDays：显式 0/负数=关闭；非法值按 0 关闭）；
  //   - created_at 时间窗 + 终态三态（含 cancelled，比 PL-4a 面宽）；
  //   - 保护清单同源：helpers/tools-assets 的 PUBLIC_DEMO_JOB_IDS（公开演示
  //     作业，与上方内联段同一 require 源）；is_public 列过滤不在上方内联段（两段
  //     保护面差异已注明，PL-D2 统合时一并裁决）；
  //   - 目录只清全局布局 <jobsDir>/<jobId>，项目布局目录归项目 GC 域不动。
  scanned.push('tool_jobs_retention');
  try {
    const rawDays = module.exports.resolveToolJobsRetentionDays(process.env.BIOF3_TOOL_JOBS_RETENTION_DAYS);
    const { retentionSweep } = require('../helpers/tool-jobs-retention');
    const { PUBLIC_DEMO_JOB_IDS } = require('../helpers/tools-assets');
    const pathMod = require('node:path');
    const osMod = require('node:os');
    // config-helper 导出 Proxy（字段访问直通 getConfig()，无 {config} 具名导出）
    const config = require('../../shared-backend/config-helper');
    // 目录不存在由 retentionSweep 的 rmSync force:true 容忍，无需先探测
    const retentionJobsDir = jobsDirParam || pathMod.join(
      config.localResultsDir || pathMod.join(osMod.homedir(), 'Documents', 'BioF3-Local', 'results'),
      'tool-jobs',
    );
    const result = retentionSweep({
      db,
      retentionDays: Number.isFinite(rawDays) ? rawDays : 0,
      jobsDir: retentionJobsDir,
      protectedJobIds: [...PUBLIC_DEMO_JOB_IDS],
    });
    if (result.reason !== 'disabled') {
      deleted.tool_jobs_retention = result.deleted;
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    warn(`retention-purge: failed at tool_jobs_retention, reason=${msg}`);
    failures.push({ table: 'tool_jobs_retention', reason: msg });
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
  DEFAULT_TOOL_JOBS_RETENTION_DAYS,
  resolveToolJobsRetentionDays,
};