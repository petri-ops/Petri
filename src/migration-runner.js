// M1-4 数据 migration runner（H3）
// 桌面版启动时自动跑未应用的 SQLite migration，防升级 schema 错乱。
//
// migration 文件放 desktop-app/migrations/*.sql，命名 NNN_description.sql。
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
  const dependencyRoot = process.env.BIOF3_BETTER_SQLITE3_ROOT;
  if (!dependencyRoot) return require('better-sqlite3');
  const scopedRequire = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'));
  return scopedRequire('better-sqlite3');
}

const Database = loadDatabaseConstructor();

const SCHEMA_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
)`;

/**
 * 查询已应用的最新 migration 版本。空库返回 0。
 */
function getAppliedVersion(dbPath) {
  const db = new Database(dbPath);
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
 * @param {string} dbPath - biof3.db 路径
 * @param {string} migrationsDir - 含 NNN_*.sql 的目录
 * @returns {Promise<number>} 应用后的最新版本号
 */
async function runMigrations(dbPath, migrationsDir) {
  const db = new Database(dbPath);
  try {
    db.exec(SCHEMA_TABLE_SQL);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    const applied = row?.v ?? 0;

    // 列出所有 migration 文件，按版本号排序
    let files = [];
    try {
      files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
    } catch {
      // 目录不存在 → 无 migration，返回当前版本
      return applied;
    }

    let lastVersion = applied;
    for (const f of files) {
      const ver = parseInt(f.split('_')[0], 10);
      if (isNaN(ver) || ver <= applied) continue;

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
