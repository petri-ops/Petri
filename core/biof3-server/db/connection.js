'use strict';

// BLOCK-92 Wave C-3 — SQLite 连接单例与生命周期（原 db.js 头部 + 生命周期函数，
// 纯搬运零行为变化）。单例从不替换：closeDatabase 只 close 不置空，域模块
// require 时捕获同一实例安全。DDL 由 ./schema 的 initSchema 在 pragma 后立即
// 执行，与拆分前"模块加载即建表"的时序一致。

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.BIOF3_DB_PATH || path.join(__dirname, '..', 'biof3.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
// busy_timeout: if writer holds lock, wait up to 10s instead of immediately returning SQLITE_BUSY.
// This is the #1 cause of "admin panel frozen" — a high-frequency write (page_view / heartbeat)
// holding the WAL writer while an admin API read tries to acquire a shared lock.
db.pragma('busy_timeout = 10000');
// WAL auto-checkpoint: checkpoint every 1000 pages to keep WAL file from growing unbounded.
// Default is 1000 pages (~4MB for 4KB pages) which is reasonable. Also run a manual
// checkpoint on startup to close any stale WAL from a previous unclean shutdown.
db.pragma('wal_autocheckpoint = 1000');
try {
  db.pragma('wal_checkpoint(TRUNCATE)');
} catch {}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
function now() {
  return new Date().toISOString();
}

// 增量导出且先于 schema require：schema.js 的迁移体在 CJS 循环加载期间
// 就要读到 now（函数声明提升，此处导出赋值先行，避免"部分导出缺属性"）。
module.exports.db = db;
module.exports.uid = uid;
module.exports.now = now;

// uid/now 先于 schema 定义：schema.js 的迁移体引用 now()，
// 在 CJS 循环加载时必须已存在于本模块的部分导出中。
require('./schema').initSchema(db);

function getDatabase() {
  return db;
}

/** Close the underlying SQLite connection (releases the file handle).
 *  Needed so callers/tests can remove the DB file on platforms (Windows)
 *  that forbid deleting an open file. Safe to call when already closed. */
function closeDatabase() {
  try {
    db.close();
  } catch {
    // already closed or never opened
  }
}

/** Promise facade over better-sqlite3 for async route handlers. */
function createAsyncDatabaseFacade(realDb) {
  return {
    async exec(ddl) {
      return realDb.exec(ddl);
    },
    prepare(sql) {
      const stmt = realDb.prepare(sql);
      return {
        async run(...p) {
          return stmt.run(...p);
        },
        async get(...p) {
          return stmt.get(...p);
        },
        async all(...p) {
          return stmt.all(...p);
        },
      };
    },
  };
}

function getAsyncDatabase() {
  return createAsyncDatabaseFacade(db);
}

module.exports.getDatabase = getDatabase;
module.exports.closeDatabase = closeDatabase;
module.exports.createAsyncDatabaseFacade = createAsyncDatabaseFacade;
module.exports.getAsyncDatabase = getAsyncDatabase;
