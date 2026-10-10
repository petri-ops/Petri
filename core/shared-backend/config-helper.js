/**
 * shared-backend/config-helper.js — 统一读取 config 的入口（自洽版）
 *
 * 断点1（分仓前置）：斩断对 petri-server 的反向 require。
 * 调用方（petri-server/desktop）启动时调 configure({getConfig}) 注入自己的 config；
 * 未注入时从环境变量构造 fallback（保持原行为，shared-backend 仍能独立跑）。
 *
 * 历史上本模块按优先级 require petri-server/config → py-server/config（py-server 已于 BLOCK-30 P1 摘除），那是"假独立"——
 * 分仓后 ../petri-server/config 路径会断，initSharedBackend / 执行器 / 存储 / llm-providers 全炸。
 * 依赖反转后，shared-backend 真自洽，分仓安全。
 *
 * E-019 db-config closeout (BLOCK-10 PHASE 2)：
 *   同一进程打开多个 SQLite connection（petri-server/db.js + agent-task-store.js +
 *   src/database/{branch,result}-db.js）共享文件，但 busy_timeout /
 *   journal_mode 等参数历史上各自硬编码。本模块在 config-helper 内追加
 *   db-config 命名空间：getConfig / setConfig / validateVersion(version)。
 *   setConfig 用于 petri-server 与 desktop 进程启动时把 petri-server 端的
 *   `BUSY_TIMEOUT_MS=10000`、`JOURNAL_MODE='WAL'`、expected
 *   `DB_SCHEMA_VERSION='1'` 注入；validateVersion(version) 在 Schema
 *   不一致时抛 `Error('db-version-mismatch')`。该 API 不 ALTER 任何 schema，
 *   仅作为后续可能改变 db 行为的 caller 的版本护栏。
 */

let _getConfig = null; // 注入的 config 提供函数

/**
 * 注入 config 提供函数。调用方启动时调一次。
 * @param {{getConfig: () => object}} provider
 */
function configure(provider) {
  if (provider && typeof provider.getConfig === 'function') {
    _getConfig = provider.getConfig;
  }
}

function getConfig() {
  // 优先用注入的
  if (_getConfig) return _getConfig();
  // fallback：从环境变量构造（真自洽，不依赖 petri-server）
  return {
    rHome: process.env.PETRI_R_HOME || '',
    pyHome: process.env.PETRI_PY_HOME || '',
    tempDir: process.env.PETRI_TEMP_DIR || '/tmp/petri-tmp',
    localResultsDir: process.env.PETRI_LOCAL_RESULTS_DIR || '',
    localUploadsDir: process.env.PETRI_LOCAL_UPLOADS_DIR || '',
  };
}

// ============================================================
// db-config — E-019 closeout (BLOCK-10 PHASE 2)
// ============================================================
//
// The default expected schema version. Bump this when the on-disk schema
// changes shape in a way that older binaries cannot safely read. Callers
// that mutate db behavior should validate via validateVersion(clientVersion)
// before touching the file.
const DB_SCHEMA_VERSION = '1';

let _dbConfig = Object.freeze({
  busyTimeoutMs: 10000,
  journalMode: 'WAL',
  schemaVersion: DB_SCHEMA_VERSION,
});

/**
 * Returns the current db config (a frozen object). Callers must not mutate.
 * @returns {{busyTimeoutMs: number, journalMode: string, schemaVersion: string}}
 */
function getDbConfig() {
  return _dbConfig;
}

/**
 * Replace the db config. Pass a partial object; unspecified keys keep their
 * current values. Validation is intentionally minimal — we want callers
 * (petri-server boot, desktop main) to be able to set valid overrides without
 * being blocked by structural checks.
 * @param {Partial<{busyTimeoutMs: number, journalMode: string, schemaVersion: string}>} patch
 */
function setDbConfig(patch) {
  if (!patch || typeof patch !== 'object') return _dbConfig;
  const next = { ..._dbConfig, ...patch };
  if (typeof next.busyTimeoutMs !== 'number' || !Number.isFinite(next.busyTimeoutMs) || next.busyTimeoutMs < 0) {
    next.busyTimeoutMs = _dbConfig.busyTimeoutMs;
  }
  if (typeof next.journalMode !== 'string' || !next.journalMode) {
    next.journalMode = _dbConfig.journalMode;
  }
  if (typeof next.schemaVersion !== 'string' || !next.schemaVersion) {
    next.schemaVersion = _dbConfig.schemaVersion;
  }
  _dbConfig = Object.freeze(next);
  return _dbConfig;
}

/**
 * Validate a caller's claimed schema version against the expected one.
 * Throws Error('db-version-mismatch') on a mismatch so callers can fail
 * closed before any db mutation.
 *
 * @param {string} clientVersion
 * @returns {boolean}
 */
function validateDbVersion(clientVersion) {
  if (typeof clientVersion !== 'string' || !clientVersion) {
    throw new Error('db-version-mismatch');
  }
  if (clientVersion !== _dbConfig.schemaVersion) {
    throw new Error('db-version-mismatch');
  }
  return true;
}

// 向后兼容：原 module.exports 是个 Proxy，字段访问走 getConfig()。
// 现在导出一个 Proxy，对 configure/getConfig 三个方法名返回函数，其余走 getConfig()。
// 老代码的字段访问仍由 Proxy 转发到当前 config；
// 新代码 `const { configure, getConfig } = require('./config-helper')` 也 work。
//
// BLOCK-10 PHASE 1.1 (E-019 full) 增补：
//   - getBusyTimeout() 返回 getDbConfig().busyTimeoutMs，作为 SQLite 打开期
//     `PRAGMA busy_timeout` 的唯一入口。agent-task-store / branch-db /
//     result-db 全部走这里，避免再次出现"petri-server 单进程 5000 vs 10000"漂移。
//   - Proxy 把 `busyTimeout` 字段转发到 getDbConfig()，所以
//     `configHelper.busyTimeout` / `getConfig().busyTimeout` 也能读（与
//     getBusyTimeout() 同值），方便老代码无需改 import 即可拿到统一值。
function getBusyTimeout() {
  return getDbConfig().busyTimeoutMs;
}

// ============================================================
// A-010 central env reads (PHASE 1.2).
//
// The 6 core desktop path / port / runtime env keys used to be read
// from process.env directly in every consumer (config.js, db.js,
// backend-proc-manager.js, content-plugins.js, r-libs-resolver.js,
// query-tools.js, py-pool.js, …). When env-coordinator injects a
// value at desktop startup, consumers must still pick it up — and
// today they each have their own `process.env.X || default` block,
// which is fine but makes a single mutation point impossible.
//
// PHASE 1.2 only centralises the *reading* path. Two helpers:
//
//   getEnv(key, fallback)
//     — equivalent to `process.env[key] || fallback` with one twist:
//       empty string is treated as unset so a stub env injection
//       (`process.env.PETRI_DB_PATH = ''`) does not silently win
//       against the documented fallback.
//
//   getCoreEnv()
//     — returns the 6 core desktop env keys (busyTimeout + 5 path /
//       port fields) as a frozen snapshot. The keys match
//       `core/petri-server/config.js` consumers (config.rHome,
//       config.localResultsDir, config.localUploadsDir,
//       config.tempDir, config.dbPath, config.port).
//
// Consumers that want the snapshot should call getCoreEnv() at
// module load time. The behaviour is identical to the previous
// `process.env.X || default` reads — PHASE 1.2 invariant is "100%
// backward compatible". ============================================================

/**
 * Read a single env var with a fallback. Empty string is treated as
 * unset so callers can clear an env var by assigning ''.
 *
 * @param {string} key
 * @param {string|number|boolean} fallback
 * @returns {string|number|boolean}
 */
function getEnv(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

/**
 * Snapshot of the 6 core desktop env keys. Returned object is frozen
 * so consumers cannot mutate the cache by accident.
 *
 * Keys:
 *   busyTimeoutMs  — PRAGMA busy_timeout; default 10000 (matches
 *                    E-019 full which routes through getBusyTimeout()).
 *   rHome          — process.env.PETRI_R_HOME || ''
 *   localResultsDir — process.env.PETRI_LOCAL_RESULTS_DIR || ''
 *   localUploadsDir — process.env.PETRI_LOCAL_UPLOADS_DIR || ''
 *   tempDir        — process.env.PETRI_TEMP_DIR || '/tmp/petri-tmp'
 *   dbPath         — process.env.PETRI_DB_PATH || ''
 *
 * (port is *not* included here — ports live in env-coordinator
 *  because Electron owns port allocation. See getBackendPort().)
 *
 * @returns {Readonly<{
 *   busyTimeoutMs: number,
 *   rHome: string,
 *   localResultsDir: string,
 *   localUploadsDir: string,
 *   tempDir: string,
 *   dbPath: string,
 * }>}
 */
function getCoreEnv() {
  return Object.freeze({
    busyTimeoutMs: getBusyTimeout(),
    rHome: getEnv('PETRI_R_HOME', ''),
    localResultsDir: getEnv('PETRI_LOCAL_RESULTS_DIR', ''),
    localUploadsDir: getEnv('PETRI_LOCAL_UPLOADS_DIR', ''),
    tempDir: getEnv('PETRI_TEMP_DIR', '/tmp/petri-tmp'),
    dbPath: getEnv('PETRI_DB_PATH', ''),
  });
}

module.exports = new Proxy(
  {
    configure,
    getConfig,
    getDbConfig,
    setDbConfig,
    validateDbVersion,
    getBusyTimeout,
    getEnv,
    getCoreEnv,
    DB_SCHEMA_VERSION,
  },
  {
    get(target, prop) {
      if (prop === 'configure') return configure;
      if (prop === 'getConfig') return getConfig;
      if (prop === 'getDbConfig') return getDbConfig;
      if (prop === 'setDbConfig') return setDbConfig;
      if (prop === 'validateDbVersion') return validateDbVersion;
      if (prop === 'getBusyTimeout') return getBusyTimeout;
      if (prop === 'getEnv') return getEnv;
      if (prop === 'getCoreEnv') return getCoreEnv;
      if (prop === 'DB_SCHEMA_VERSION') return DB_SCHEMA_VERSION;
      // db-config fields forwarded through getDbConfig so callers can do
      // `configHelper.busyTimeout` without going through getConfig().
      if (prop === 'busyTimeout') return getDbConfig().busyTimeoutMs;
      if (prop === 'journalMode') return getDbConfig().journalMode;
      if (prop === 'schemaVersion') return getDbConfig().schemaVersion;
      return getConfig()[prop];
    },
  }
);
