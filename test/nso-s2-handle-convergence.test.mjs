/**
 * nso-s2-handle-convergence.test.mjs — BLOCK-377（S2 §8.7）后端句柄退出收敛真实进程回归。
 *
 * 契约：持有 backend SQLite 连接的子进程收到 SIGTERM → converge（wal_checkpoint(TRUNCATE)
 * + close）→ exit 0，且 -wal 文件被收敛（不再有未合并 WAL）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('S2-§8.7 SIGTERM → checkpoint+close → exit 0（真实进程回归）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's2-handle-'));
  const dbPath = path.join(tmp, 'petri.db');
  const childScript = [
    // .cjs 内 require 已内建——不得重复声明（ERR_REQUIRE_ESM 假象的实因）
    `require('better-sqlite3');`,
    `const conn = require(${JSON.stringify(path.join(ROOT, 'core/petri-server/db/connection.js'))});`,
    `conn.db.prepare("CREATE TABLE IF NOT EXISTS probe(id INTEGER PRIMARY KEY, v TEXT)").run();`,
    `conn.db.prepare("INSERT INTO probe(v) VALUES ('wal-pending')").run();`,
    `console.log('READY');`,
    // 就绪后自发 SIGTERM（收敛处理器 exit 0）；setInterval 为兜底存活
    `setTimeout(() => process.kill(process.pid, 'SIGTERM'), 200);`,
    `setInterval(() => {}, 1000);`,
  ].join('\n');
  // 子脚本落仓库内 .petri-dev-user-data（gitignored）——/tmp 下 .cjs 加载器解析异常
  // 且仓库内可稳定解析 better-sqlite3 原生模块。
  const scriptPath = path.join(ROOT, '.petri-dev-user-data', `s2-handle-child-${Date.now()}.cjs`);
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, childScript);
  try {
    const r = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PETRI_DB_PATH: dbPath },
      killSignal: 'SIGTERM',
    });
    assert.equal(r.status, 0, `SIGTERM 后应 converge+exit 0（stdout=${r.stdout} stderr=${r.stderr}）`);
    assert.match(r.stdout, /READY/);
    // WAL 收敛断言：-wal 文件要么不存在，要么已 truncate 到 0 字节
    const wal = dbPath + '-wal';
    if (fs.existsSync(wal)) {
      assert.equal(fs.statSync(wal).size, 0, 'checkpoint(TRUNCATE) 后 WAL 应为 0 字节');
    }
    // 数据落盘可读（close 后新连接读到已写行）
    const Database = require('better-sqlite3');
    const check = new Database(dbPath, { readonly: true });
    const row = check.prepare('SELECT v FROM probe').get();
    check.close();
    assert.equal(row && row.v, 'wal-pending', '收敛后数据可复读');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    try { fs.rmSync(scriptPath, { force: true }); } catch { /* best-effort */ }
  }
});
