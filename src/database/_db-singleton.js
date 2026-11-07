/**
 * src/database/_db-singleton.js
 *
 * Single source of truth for desktop main-process SQLite access.
 *
 * BLOCK-10 PHASE 1.1 — A-007 + PR-012 + E-019 full.
 *
 * Why this file exists:
 *   src/database/branch-db.js and (the now-retired UI-457) result-db.js both opened the
 *   same `petri.db` file with their own _dbCache + new Database() + close
 *   pair — 30 lines of infrastructure duplicated verbatim (A-007). Worse,
 *   each call to `new Database(filePath)` opens another sqlite3 handle; in
 *   better-sqlite3's WAL mode that's tolerable for readers but compounds
 *   writer-lock contention when both modules are live in IPC handlers and
 *   MCP-server code paths (PR-012). And neither module set `journal_mode =
 *   WAL` nor `busy_timeout`, so writes from `core/petri-server/db.js` (which
 *   does set them) raced the desktop handlers (E-019).
 *
 * What this module provides:
 *   - openDb(role)         → returns the singleton Database for that role
 *                            (one connection per process per file path).
 *   - closeDb(role)        → closes and forgets the role's connection.
 *   - closeAll()           → closes every cached connection.
 *   - _reset()             → closeAll() (test-only escape hatch).
 *
 * `branch` and `result` both resolve to the same `petri.db` under
 * PETRI_LOCAL_DATA_DIR (legacy single-file layout, preserved 100%); the
 * role key only exists so callers don't reach across module boundaries.
 * PR-012 dedup happens because openDb caches by resolved file path, not by
 * role string — the second call returns the same Database instance.
 *
 * E-019 full: the connection is opened with journal_mode=WAL and
 * busy_timeout = getBusyTimeout() (canonical source: shared-backend
 * config-helper.js → getDbConfig().busyTimeoutMs, default 10000ms). Every
 * SQLite handle in the desktop + petri-server process family now uses the
 * same value via the same config helper.
 *
 * 100% backward compatible:
 *   branch-db.js / result-db.js keep their public exports (getDatabase,
 *   closeDatabase, getDatabasePath) and re-export them as thin shims over
 *   this singleton, so existing IPC handlers and petri-server MCP code that
 *   imported them keep working without changes.
 */

const { loadDatabaseConstructor } = require('../migration-runner');
const { resolveCore } = require('../main/core-utils');
const { getBusyTimeout } = require(resolveCore('shared-backend/config-helper'));
// BLOCK-360（NSO-W2-4）路径 precedence 与基础 pragma 单源（与核心 connection.js / migration-runner 同一实现）
const { resolveDbPath, applyCanonicalPragmas, openDatabase, registerDatabaseConstructor } = require(resolveCore('shared-backend/db-connection-policy'));

const VALID_ROLES = new Set(['branch', 'result']);
const _connections = new Map(); // resolved file path → better-sqlite3 Database

function _getDbPath(role) {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Unknown db role: ${role}; expected one of ${[...VALID_ROLES].join(', ')}`);
  }
  // Legacy single-file layout: branch-db.js + result-db.js both opened
  // `petri.db` under PETRI_LOCAL_DATA_DIR — resolveDbPath keeps that exact
  // filename (PR-012 dedup is per-process, not per-file). BLOCK-360: the
  // precedence (PETRI_DB_PATH first) is now shared with the backend so the
  // two processes can never open different files under divergent env.
  const resolved = resolveDbPath(process.env);
  if (!resolved) {
    throw new Error('PETRI_LOCAL_DATA_DIR environment variable is not set');
  }
  return resolved;
}

/**
 * Open (or return cached) SQLite connection for the given logical role.
 * Same file path → same Database instance (PR-012 dedup).
 * @param {'branch'|'result'} role
 * @returns {import('better-sqlite3').Database}
 */
function openDb(role) {
  const dbPath = _getDbPath(role);
  if (_connections.has(dbPath)) {
    return _connections.get(dbPath);
  }
  // BLOCK-379（S4 / G-17）——实例化单源：走 db-connection-policy 的 openDatabase 工厂
  // （pragma 套装与实例化同源）；本进程构造器注册一次（桌面副本），桌面特有
  // foreign_keys=ON（A-007.8）在工厂返回后补声明。
  const Database = loadDatabaseConstructor();
  registerDatabaseConstructor(Database);
  const db = openDatabase(dbPath, { busyTimeoutMs: getBusyTimeout() });
  // foreign_keys=ON matches shared-backend/db.js behavior and prevents
  // accidental ON DELETE CASCADE surprises across the two db modules.
  db.pragma(`foreign_keys = ON`);
  _connections.set(dbPath, db);
  return db;
}

/**
 * Close the connection associated with a role. Safe to call when no
 * connection is cached.
 * @param {'branch'|'result'} role
 */
function closeDb(role) {
  const dbPath = _getDbPath(role);
  const db = _connections.get(dbPath);
  if (!db) return;
  try {
    db.close();
  } catch {
    // already closed or never opened — match db.js closeDatabase tolerance
  }
  _connections.delete(dbPath);
}

/** Close every cached connection. Safe to call repeatedly. */
function closeAll({ checkpoint = false } = {}) {
  for (const [dbPath, db] of _connections) {
    // BLOCK-360 — 退出路径收敛 WAL（will-quit 调用 checkpoint:true）；失败不阻断关闭
    if (checkpoint) {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best-effort */ }
    }
    try {
      db.close();
    } catch {
      // ignore — match the swallow-when-already-closed contract
    }
    _connections.delete(dbPath);
  }
}

/**
 * Test-only escape hatch: drop every cached connection without touching
 * any other module-level state. Use in test setup/teardown so each case
 * starts with a clean singleton.
 */
function _reset() {
  closeAll();
}

module.exports = {
  openDb,
  closeDb,
  closeAll,
  _reset,
  VALID_ROLES: [...VALID_ROLES],
};