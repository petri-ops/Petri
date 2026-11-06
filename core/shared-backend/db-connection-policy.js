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
 * foreign_keys 刻意**不**在基础集合内：桌面侧现为 ON、后端侧现为 OFF（历史分歧，
 * 本批实码核对确认）。后端开启 FK 会让当前能写入的违约行开始失败，属行为变更，
 * 需全量回归后单独裁决——先在两侧显式声明现值，不在这里静默统一。
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

module.exports = {
  CANONICAL_PRAGMAS,
  DEFAULT_BUSY_TIMEOUT_MS,
  applyCanonicalPragmas,
  orderMigrationFiles,
  resolveDbPath,
};
