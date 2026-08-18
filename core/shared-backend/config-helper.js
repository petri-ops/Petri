/**
 * shared-backend/config-helper.js — 统一读取 config 的入口（自洽版）
 *
 * 断点1（分仓前置）：斩断对 r-server/py-server 的反向 require。
 * 调用方（r-server/py-server/desktop）启动时调 configure({getConfig}) 注入自己的 config；
 * 未注入时从环境变量构造 fallback（保持原行为，shared-backend 仍能独立跑）。
 *
 * 历史上本模块按优先级 require r-server/config → py-server/config，那是"假独立"——
 * 分仓后 ../r-server/config 路径会断，initSharedBackend / 执行器 / 存储 / llm-providers 全炸。
 * 依赖反转后，shared-backend 真自洽，分仓安全。
 *
 * E-019 db-config closeout (BLOCK-10 PHASE 2)：
 *   同一进程打开多个 SQLite connection（r-server/db.js + agent-task-store.js +
 *   src/database/{branch,result}-db.js）共享文件，但 busy_timeout /
 *   journal_mode 等参数历史上各自硬编码。本模块在 config-helper 内追加
 *   db-config 命名空间：getConfig / setConfig / validateVersion(version)。
 *   setConfig 用于 r-server 与 desktop 进程启动时把 r-server 端的
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
  // fallback：从环境变量构造（真自洽，不依赖 r-server/py-server）
  return {
    rHome: process.env.BIOF3_R_HOME || '',
    pyHome: process.env.BIOF3_PY_HOME || '',
    tempDir: process.env.BIOF3_TEMP_DIR || '/tmp/biof3-tmp',
    localResultsDir: process.env.BIOF3_LOCAL_RESULTS_DIR || '',
    localUploadsDir: process.env.BIOF3_LOCAL_UPLOADS_DIR || '',
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
 * (r-server boot, desktop main) to be able to set valid overrides without
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
//     result-db 全部走这里，避免再次出现"r-server 单进程 5000 vs 10000"漂移。
//   - Proxy 把 `busyTimeout` 字段转发到 getDbConfig()，所以
//     `configHelper.busyTimeout` / `getConfig().busyTimeout` 也能读（与
//     getBusyTimeout() 同值），方便老代码无需改 import 即可拿到统一值。
function getBusyTimeout() {
  return getDbConfig().busyTimeoutMs;
}

module.exports = new Proxy(
  {
    configure,
    getConfig,
    getDbConfig,
    setDbConfig,
    validateDbVersion,
    getBusyTimeout,
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
