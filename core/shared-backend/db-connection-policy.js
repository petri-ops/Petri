'use strict';

/**
 * BLOCK-360（NSO-W2-4）SQLite 连接策略单源：路径 precedence + 基础 pragma + 迁移文件定序。
 *
 * 消费方（三处，此前各写一份）：
 *   - core/petri-server/db/connection.js（后端进程单例）
 *   - src/database/_db-singleton.js（桌面主进程，经 resolveCore 引用——与 config-helper 同一桥）
 *   - src/migration-runner.js（启动期迁移）
 *
 * 路径：PETRI_DB_PATH > PETRI_LOCAL_DATA_DIR/petri.db > null（调用方自定兜底）。env-coordinator
 * 在桌面启动时把两者写成一致；两侧同读本函数后，即使 env 被单独覆写也不会各指一个库。
 *
 * foreign_keys 刻意**不**在基础集合内：桌面侧现为 ON、后端侧为 OFF。BLOCK-372 Batch-2
 * 实测 FK=ON 全量 179 fail（测试 setup + 可能存量数据大量不满足 FK 约束）——已回退为 OFF，
 * 登录 wave-0/full-test-shards/ 证据。全量切换需独立大包逐表清偿。
 */

const path = require('path');

const DEFAULT_BUSY_TIMEOUT_MS = 10000;
const MMAP_SIZE_BYTES = 64 * 1024 * 1024;

const CANONICAL_PRAGMAS = Object.freeze([
  'journal_mode = WAL',
  'busy_timeout = <busyTimeoutMs>',
  `mmap_size = ${MMAP_SIZE_BYTES}`,
  'wal_autocheckpoint = 1000',
]);

function resolveDbPath(env = process.env) {
  const explicit = env && typeof env.PETRI_DB_PATH === 'string' ? env.PETRI_DB_PATH.trim() : '';
  if (explicit) return explicit;
  const dataDir = env && typeof env.PETRI_LOCAL_DATA_DIR === 'string' ? env.PETRI_LOCAL_DATA_DIR.trim() : '';
  if (dataDir) return path.join(dataDir, 'petri.db');
  return null;
}

function applyCanonicalPragmas(db, { busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS } = {}) {
  const timeout = Number.isFinite(Number(busyTimeoutMs)) && Number(busyTimeoutMs) >= 0
    ? Math.floor(Number(busyTimeoutMs))
    : DEFAULT_BUSY_TIMEOUT_MS;
  db.pragma('journal_mode = WAL');
  db.pragma(`busy_timeout = ${timeout}`);
  db.pragma(`mmap_size = ${MMAP_SIZE_BYTES}`);
  db.pragma('wal_autocheckpoint = 1000');
  return db;
}

const MIGRATION_NAME_RE = /^(\d{3,})_[A-Za-z0-9][\w.-]*\.sql$/;

/**
 * 迁移文件定序：只认 NNN_name.sql（≥3 位数字前缀），按数值排序；重号与非法名 fail-fast。
 * 此前字典序 + parseInt：重号时第二个文件因 ver<=applied 被永久静默跳过。
 * @param {string[]} files
 * @returns {{ file: string, version: number }[]}
 */
function orderMigrationFiles(files) {
  const seen = new Map();
  const out = [];
  for (const file of files || []) {
    if (!String(file).endsWith('.sql')) continue;
    const match = MIGRATION_NAME_RE.exec(file);
    if (!match) {
      const error = new Error(`migration_name_invalid: ${file}（须为 NNN_name.sql，至少三位数字前缀）`);
      error.code = 'migration_name_invalid';
      throw error;
    }
    const version = Number.parseInt(match[1], 10);
    if (seen.has(version)) {
      const error = new Error(`migration_version_duplicate: v${version} 同时出现在 ${seen.get(version)} 与 ${file}`);
      error.code = 'migration_version_duplicate';
      throw error;
    }
    seen.set(version, file);
    out.push({ file, version });
  }
  return out.sort((a, b) => a.version - b.version);
}

// BLOCK-379（S4 / G-17）——实例化单源：三处 `new Database` 收编为一个工厂。
// 策略（pragma/路径）与实例化同源；依赖注入 Database 构造器（桌面/后端各自的
// better-sqlite3 副本由调用方传入，策略层不钉死副本）。
let databaseCtor = null;

/**
 * 注册 Database 构造器（进程内一次；宿主入口调用）。
 * @param {(path: string) => object} ctor
 */
function registerDatabaseConstructor(ctor) {
  if (typeof ctor !== 'function') throw new Error('database_ctor_required');
  databaseCtor = ctor;
}

/**
 * 打开一个已应用 canonical pragma 的连接（单源工厂）。
 * @param {string} dbPath
 * @param {{ busyTimeoutMs?: number, ctor?: (path: string) => object }} [options]
 * @returns {object} better-sqlite3 实例
 */
function openDatabase(dbPath, options = {}) {
  const ctor = options.ctor || databaseCtor;
  if (typeof ctor !== 'function') {
    throw new Error('database_ctor_not_registered——宿主入口须先 registerDatabaseConstructor（或经 options.ctor 显式传入）');
  }
  const db = new ctor(dbPath);
  applyCanonicalPragmas(db, { busyTimeoutMs: options.busyTimeoutMs });
  return db;
}

module.exports = {
  CANONICAL_PRAGMAS,
  DEFAULT_BUSY_TIMEOUT_MS,
  applyCanonicalPragmas,
  orderMigrationFiles,
  resolveDbPath,
  registerDatabaseConstructor,
  openDatabase,
};
