// M1-4 数据 migration runner（H3）
// 桌面版启动时自动跑未应用的 SQLite migration，防升级 schema 错乱。
//
// migration 文件放 src/migrations/*.sql，命名 NNN_description.sql（主进程 src/main.js 以
// path.join(__dirname, "migrations") 传入本 runner；顶层 migrations/ 空目录是历史占位，不放文件）。
// 已应用版本记录在 schema_migrations 表（version INTEGER + applied_at TEXT）。
//
// 注意：遵循 Global Constraints，不用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT。
// migration SQL 用 BEGIN/COMMIT 包裹，单个 migration 失败回滚不影响已应用的。

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

/**
 * Development uses the system Node process for Core servers, while
 * electron-builder rebuilds the root native dependency for Electron. Pointing
 * the migration child at Core's dependency root avoids coupling startup to
 * whichever ABI the last packaging/test command left in root node_modules.
 */
function loadDatabaseConstructor() {
  const dependencyRoot = process.env.PETRI_BETTER_SQLITE3_ROOT;
  if (!dependencyRoot) return require('better-sqlite3');
  const scopedRequire = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'));
  return scopedRequire('better-sqlite3');
}

const Database = loadDatabaseConstructor();

/**
 * BLOCK-360（NSO-W2-4）连接策略单源（core/shared-backend/db-connection-policy.js）。
 * 本文件既被主进程 require，也作为 ELECTRON_RUN_AS_NODE 迁移子进程独立运行（无 electron），
 * 故不经 resolveCore：开发态相对路径命中仓库 core/；打包态回落 Resources/core（双态兜底）。
 * R5 只禁 src→core/petri-server/**，src→core/shared-backend/** 属合法共享层。
 */
function requireDbConnectionPolicy() {
  const candidates = [path.join(__dirname, '..', 'core', 'shared-backend', 'db-connection-policy.js')];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'core', 'shared-backend', 'db-connection-policy.js'));
  }
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (!error || error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error(`db-connection-policy unavailable: ${candidates.join(' | ')}`);
}
const { orderMigrationFiles, openDatabase } = requireDbConnectionPolicy();

const SCHEMA_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
)`;

/**
 * 查询已应用的最新 migration 版本。空库返回 0。
 */
function getAppliedVersion(dbPath) {
  const db = openDatabase(dbPath, { ctor: Database }); // BLOCK-379（S4 / G-17）实例化单源
  try {
    db.exec(SCHEMA_TABLE_SQL);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    return row?.v ?? 0;
  } finally {
    db.close();
  }
}

/**
 * 跑未应用的 migration。
 * @param {string} dbPath - petri.db 路径
 * @param {string} migrationsDir - 含 NNN_*.sql 的目录
 * @returns {Promise<number>} 应用后的最新版本号
 */
async function runMigrations(dbPath, migrationsDir) {
  const db = openDatabase(dbPath, { ctor: Database }); // BLOCK-379（S4 / G-17）实例化单源
  try {
    db.exec(SCHEMA_TABLE_SQL);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    const applied = row?.v ?? 0;

    // BLOCK-360 — 数值定序 + 重号/非法名 fail-fast（先于任何应用）。此前字典序 + parseInt：
    // 重号时第二个文件 ver<=applied 被永久静默跳过，非法名静默忽略。
    let entries;
    try {
      entries = fs.readdirSync(migrationsDir);
    } catch {
      // 目录不存在 → 无 migration，返回当前版本
      return applied;
    }
    const ordered = orderMigrationFiles(entries);

    let lastVersion = applied;
    for (const { file: f, version: ver } of ordered) {
      if (ver <= applied) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      // 单个 migration 用事务包裹
      const tx = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations(version) VALUES(?)').run(ver);
      });
      try {
        tx();
        lastVersion = ver;
        console.log(`[migration] applied ${f} → v${ver}`);
      } catch (e) {
        console.error(`[migration] FAILED ${f}: ${e.message}`);
        throw new Error(`Migration ${f} failed: ${e.message}`);
      }
    }
    return lastVersion;
  } finally {
    db.close();
  }
}

module.exports = { getAppliedVersion, runMigrations, loadDatabaseConstructor };

if (require.main === module) {
  const dbPath = process.argv[2];
  const migrationsDir = process.argv[3];
  if (!dbPath || !migrationsDir) {
    console.error('Usage: node migration-runner.js <db-path> <migrations-dir>');
    process.exitCode = 2;
  } else {
    runMigrations(dbPath, migrationsDir)
      .then((version) => {
        console.log(`[desktop] migrations applied, version = ${version}`);
      })
      .catch((error) => {
        console.error(`[desktop] migration failed: ${error.message}`);
        process.exitCode = 1;
      });
  }
}
