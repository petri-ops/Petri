'use strict';

// BLOCK-92 Wave C-3 — SQLite 连接单例与生命周期（原 db.js 头部 + 生命周期函数，
// 纯搬运零行为变化）。单例从不替换：closeDatabase 只 close 不置空，域模块
// require 时捕获同一实例安全。DDL 由 ./schema 的 initSchema 在 pragma 后立即
// 执行，与拆分前"模块加载即建表"的时序一致。

const Database = require('better-sqlite3');
const path = require('path');

// BLOCK-360（NSO-W2-4）路径 precedence 与基础 pragma 单源（与桌面 _db-singleton /
// migration-runner 同一实现）：PETRI_DB_PATH > PETRI_LOCAL_DATA_DIR/petri.db > 包内旧默认。
// 基础集合=WAL + busy_timeout 10s（"admin panel frozen" 根因：高频写占 WAL writer 时读立刻
// SQLITE_BUSY）+ mmap 64MB（CK-05 实测大扫描 −8.5%/点查 −15%）+ wal_autocheckpoint 1000。
// BLOCK-372 Batch-2 → BLOCK-377（S2 / G-08）FK 裁决落地：后端 foreign_keys=OFF。
// 事实链：Batch-2 先开 ON 跑全量回归=179 fail（测试 setup 大量不满足 FK 约束，
// 证据 wave-3b/fk-regression-*），按预案裁决回退 OFF——但该回退提交（b4edf467）
// 实际把 ON pragma 写进了本文件（裁决与代码反向，S0 分片勘察钉死）。本包按裁决
// 落地：后端 OFF（与策略模块头注唯一真相一致）；桌面侧 ON 维持（_db-singleton +
// A-007.8 断言）。全量切换（ON）需独立大包逐表清偿违约行 + 测试 setup 补关联。
const { resolveDbPath, applyCanonicalPragmas } = require('../../shared-backend/db-connection-policy');
const DB_PATH = resolveDbPath(process.env) || path.join(__dirname, '..', 'petri.db');
const db = new Database(DB_PATH);
applyCanonicalPragmas(db, { busyTimeoutMs: 10000 });
db.pragma('foreign_keys = OFF');
// Run a manual checkpoint on startup to close any stale WAL from a previous unclean shutdown.
try {
  db.pragma('wal_checkpoint(TRUNCATE)');
} catch {}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
function now() {
  return new Date().toISOString();
}

// 导出先行于 schema require（BLOCK-330 后已无环，顺序仍保留）：schema 的 DDL 在 require 时
// 立即执行，任何此刻需要 uid/now 的迁移体都能拿到完整导出；也避免未来再加 require 时重新
// 出现「部分导出缺属性」的老坑。依赖方向固定为 connection → schema（单向）。
module.exports.db = db;
module.exports.uid = uid;
module.exports.now = now;

require('./schema').initSchemaWithBusyRetry(db); // BLOCK-328：SQLITE_BUSY 有界重试退避

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

// BLOCK-377（S2 §8.7）——后端句柄退出收敛：进程退出前 checkpoint(TRUNCATE) 收敛
// WAL 再 close（防「后端绿但 WAL 残留/句柄泄漏」家族）。与桌面 will-quit closeAll
// 同语义；幂等（重复 close 安全）。真实进程回归=nso-s2-handle-convergence 测试。
let exitHookInstalled = false;
function installExitConvergence() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const converge = () => {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* checkpoint 失败不阻断退出 */ }
    try { db.close(); } catch { /* already closed */ }
  };
  process.once('exit', converge);
  process.once('SIGINT', () => { converge(); process.exit(0); });
  process.once('SIGTERM', () => { converge(); process.exit(0); });
}
installExitConvergence();

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
