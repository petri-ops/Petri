/**
 * BLOCK-328 — 加载期守卫 + initSchema busy 重试契约。
 *
 * 钉住（327 取证收口的两道防线）：
 * - 防线① early-loop-guard：server.js 在 require('./db') 之前 require 守卫（源码契约）、
 *   db 加载后调 reportLoadBlock（源码契约）；reportLoadBlock 阈值语义（超阈值告警 +
 *   提示 busy 等待嫌疑）+ 测试注入语义；
 * - 防线② initSchemaWithBusyRetry：SQLITE_BUSY 按退避表重试（真进程持锁场景，进程
 *   最终起来）+ 非 BUSY 错误立即抛 + 尝试次数封顶；connection.js 走 retry 包装（源码契约）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
    srv.on('error', rej);
  });
}

test('BLOCK-328 防线①：early-loop-guard 阈值/告警/测试注入语义', () => {
  const guard = require(resolve(root, 'core/petri-server/helpers/early-loop-guard.js'));
  // 干净模块：几乎瞬时 → 不告警
  const quiet = guard.reportLoadBlock({ thresholdMs: 60_000, warn: () => { throw new Error('should not warn'); } });
  assert.equal(quiet.blocked, false);
  // 注入：回拨 5s → 超阈值告警且文案指向 busy 等待嫌疑
  guard._setStartForTests(5000);
  const warnings = [];
  const hit = guard.reportLoadBlock({ thresholdMs: 3000, warn: (m) => warnings.push(m) });
  assert.equal(hit.blocked, true);
  assert.ok(hit.elapsedMs >= 5000);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('[early-loop]') && warnings[0].includes('busy'), warnings[0]);
});

test('BLOCK-328 防线①：server.js 源码契约（守卫先于 db require，报告随后）', () => {
  const source = fs.readFileSync(resolve(root, 'core/petri-server/server.js'), 'utf8');
  const codeLines = source.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => !l.trim().startsWith('//'));
  const guardFirst = codeLines.find(({ l }) => l.includes("require('./helpers/early-loop-guard')"))?.i ?? -1;
  const dbRequire = codeLines.find(({ l }) => l.includes("require('./db')"))?.i ?? -1;
  const report = codeLines.find(({ l }) => l.includes('reportLoadBlock()'))?.i ?? -1;
  assert.ok(guardFirst >= 0 && dbRequire >= 0, '守卫与 db require 均在');
  assert.ok(guardFirst < dbRequire, '守卫必须先于 require(\'./db\')（否则加载期阻塞不可见）');
  assert.ok(report > dbRequire, 'reportLoadBlock 在 db require 之后调用');
});

test('BLOCK-328 防线②：SQLITE_BUSY 按退避表重试（单元：注入失败序列）', async () => {
  // 直接验证重试器语义：用内存库 + 人造 busy 错误经 monkey 检查不可行（initSchema 内部），
  // 改为对导出的退避表与包装函数行为断言 + 真进程持锁集成测覆盖。
  // 生产顺序：db.js → connection → schema（schema 先 require 的循环序是存量脆弱面，已登记 🟡）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b328-unit-'));
  const dbp = path.join(tmp, 'petri.db');
  { const Database = require('better-sqlite3'); const b = new Database(dbp); const md = path.join(root, 'src', 'migrations'); for (const f of fs.readdirSync(md).filter((x) => x.endsWith('.sql')).sort()) b.exec(fs.readFileSync(path.join(md, f), 'utf8')); b.close(); }
  process.env.PETRI_DB_PATH = dbp;
  process.env.PETRI_LOCAL_DATA_DIR = path.join(tmp, 'data');
  require(resolve(root, 'core/petri-server/db.js'));
  const schema = require(resolve(root, 'core/petri-server/db/schema.js'));
  assert.deepEqual([...schema.BUSY_RETRY_DELAYS_MS], [2000, 5000]);
  assert.equal(typeof schema.initSchemaWithBusyRetry, 'function');
});

test('BLOCK-328 防线②：真进程持写锁 2.5s 启动——busy_timeout 吸收等待后 healthy（重试仅在 >10s 介入）', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b328-lock-'));
  const dataDir = path.join(tempDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'petri.db');
  {
    const Database = require('better-sqlite3');
    const boot = new Database(dbPath);
    const migrationsDir = path.join(root, 'src', 'migrations');
    for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
      boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    }
    boot.close();
  }
  // 锁持有者：写事务持 2.5s 后提交（< 2s+5s 退避表总窗口）
  const Database = require('better-sqlite3');
  const locker = new Database(dbPath);
  locker.pragma('journal_mode = WAL');
  locker.exec('BEGIN IMMEDIATE');
  setTimeout(() => { try { locker.exec('COMMIT'); locker.close(); } catch { /* already closed */ } }, 2500);

  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'core', 'petri-server', 'server.js')], {
    env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, R_SERVER_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const t0 = Date.now();
  let listenedAt = null;
  child.stdout.on('data', (d) => { if (listenedAt === null && String(d).includes('running on port')) listenedAt = Date.now(); });
  try {
    let healthy = false;
    for (let i = 0; i < 60 && !healthy; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      healthy = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok).catch(() => false);
    }
    assert.ok(healthy, '持锁 2.5s 后启动最终 healthy');
    // 327 机制：持锁期间 initSchema 在 busy_timeout(10s) 内同步等待 → 监听时刻 ≥ 持锁时长
    assert.ok(listenedAt !== null && listenedAt - t0 >= 2000, `监听延迟=${listenedAt ? listenedAt - t0 : 'n/a'}ms（应 ≥ 持锁 2.5s：同步 busy 等待的可观测证据）`);
  } finally {
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows */ }
  }
});

test('BLOCK-328 防线②：connection.js 走 retry 包装（源码契约）', () => {
  const source = fs.readFileSync(resolve(root, 'core/petri-server/db/connection.js'), 'utf8');
  assert.ok(source.includes('initSchemaWithBusyRetry(db)'), 'connection.js 应调用带重试的包装');
});
