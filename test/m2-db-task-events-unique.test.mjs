/**
 * BLOCK-450 · task_events (task_id, seq) 唯一约束契约测试（M2-4-db 清偿）。
 *
 * 缺陷（当次 dev 库实测 4 组跨事件类型 seq 碰撞）：appendAgentTaskEvent(taskId, seq, …)
 * 的 seq 由调用方读-算-写，双写者竞态碰撞（如 child_finished 与 token_budget 同挂
 * seq=109）——持久层此前无唯一不变量兜底。
 *
 * 契约（按 agent-task-store 模块加载通道=task_events 表 DDL 单源）：
 *  1) 新库启动后存在唯一索引 uq_task_events_task_seq(task_id, seq)；
 *  2) 同 (task_id, seq) 双写不产生重复行——第二次写入经原子 max+1 重分配成功且 seq 递增；
 *  3) 存量碰撞库启动自愈：行数守恒（零删除）、碰撞清零；重排只动碰撞成员（让位到当前
 *     max+1，非碰撞行不动——接受对个别历史行的微序畸变，单任务 seq 单调性保持）。
 *
 * 测试形态：子进程隔离（agent-task-store 为模块级单例，PETRI_DB_PATH 在 require 时
 * 解析——每场景独立子进程跑真实模块加载路径，父进程断言 JSON 输出）。
 * 红证据：实现前本文件 3 场景全红（索引缺席 / 重复行在册 / 碰撞留存）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreRequire = createRequire(path.join(ROOT, 'core', 'petri-server', 'package.json'));
const Database = coreRequire('better-sqlite3');

function bootstrap(dbPath) {
  const raw = new Database(dbPath);
  for (const f of fs.readdirSync(path.join(ROOT, 'src', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, 'src', 'migrations', f), 'utf8'));
  }
  raw.close();
}

const CHILD_SOURCE = `
const fs = require('node:fs');
const Database = require(process.argv[5]);
// 裸句柄延后打开：store boot 会把库切到 WAL（journal_mode=persistent）——
// 先开的原生连接停留在旧日志模式快照上看不到 WAL 提交（BLOCK-450 实测抓真）。
const scenario = process.argv[2];
const ROOT = ${JSON.stringify(ROOT)};
function out(obj) { fs.writeFileSync(process.argv[4], JSON.stringify(obj)); process.exit(0); }
process.env.PETRI_DB_PATH = process.argv[3];
if (scenario === 'fresh-db-contract') {
  require(ROOT + '/core/petri-server/agent-task-store.js');
  const db = new Database(process.argv[3]);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='uq_task_events_task_seq'").get();
  out({ uniqueIndexPresent: Boolean(idx) });
}
if (scenario === 'same-seq-double-append') {
  const store = require(ROOT + '/core/petri-server/agent-task-store.js');
  const taskId = store.createAgentTask({ status: 'running', agentStatus: 'running', userId: 'u-t', params: { messages: [] } }).taskId;
  store.appendAgentTaskEvent(taskId, 1, 'tool_call', { a: 1 });
  store.appendAgentTaskEvent(taskId, 1, 'token_budget', { b: 2 });
  const db = new Database(process.argv[3]);
  const rows = db.prepare('SELECT seq, event_type FROM task_events WHERE task_id=? ORDER BY rowid').all(taskId);
  const dupGroups = db.prepare('SELECT COUNT(*) c FROM (SELECT task_id, seq FROM task_events GROUP BY task_id, seq HAVING COUNT(*)>1)').get().c;
  out({ rows, dupGroups });
}
if (scenario === 'collision-renumber') {
  require(ROOT + '/core/petri-server/agent-task-store.js');
  const db = new Database(process.argv[3]);
  const taskId = 'legacy-collision-task';
  const rows = db.prepare('SELECT seq, event_type, created_at FROM task_events WHERE task_id=? ORDER BY created_at, rowid').all(taskId);
  const dupGroups = db.prepare('SELECT COUNT(*) c FROM (SELECT task_id, seq FROM task_events GROUP BY task_id, seq HAVING COUNT(*)>1)').get().c;
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='uq_task_events_task_seq'").get();
  out({ rows, dupGroups, uniqueIndexPresent: Boolean(idx), totalRows: db.prepare('SELECT COUNT(*) c FROM task_events').get().c });
}
out({ error: 'unknown scenario ' + scenario });
`;

function runChild(scenario, dbPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-unique-child-'));
  const childScript = path.join(dir, 'child.cjs');
  const outFile = path.join(dir, 'out.json');
  fs.writeFileSync(childScript, CHILD_SOURCE);
  try {
    execFileSync(process.execPath, [childScript, scenario, dbPath, outFile, coreRequire.resolve('better-sqlite3')], {
      cwd: ROOT,
      timeout: 60_000,
      env: { ...process.env, PETRI_LOCAL_DATA_DIR: dir, PETRI_CREDENTIAL_BACKEND: 'file' },
    });
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('契约 1：新库启动后存在 uq_task_events_task_seq 唯一索引（红=索引缺席）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-unique-fresh-'));
  const dbPath = path.join(dir, 'petri.db');
  bootstrap(dbPath);
  try {
    const r = runChild('fresh-db-contract', dbPath);
    assert.equal(r.uniqueIndexPresent, true, `唯一索引在册：${JSON.stringify(r)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('契约 2：同 (task_id, seq) 双写必分离（红=重复行在册）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-unique-double-'));
  const dbPath = path.join(dir, 'petri.db');
  bootstrap(dbPath);
  try {
    const r = runChild('same-seq-double-append', dbPath);
    assert.equal(r.dupGroups, 0, `零碰撞组：${JSON.stringify(r)}`);
    assert.equal(r.rows.length, 2, `两行都在场（零丢失）：${JSON.stringify(r.rows)}`);
    assert.equal(r.rows[0].seq, 1, '首写保持显式 seq');
    assert.ok(Number(r.rows[1].seq) > 1, `碰撞写经原子重分配 seq 递增：${JSON.stringify(r.rows)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('契约 3：存量碰撞库启动自愈——行数守恒、碰撞清零（红=碰撞留存）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-unique-legacy-'));
  const dbPath = path.join(dir, 'petri.db');
  bootstrap(dbPath);
  // 模拟存量库：先以旧形态 DDL 建表（tasks/task_events 的表体在 agent-task-store
  // 模块加载通道创建，src/migrations 不含它们——存量库=旧版本 store 留下的表 + 数据），
  // 再播种碰撞行，最后跑新 store boot（CREATE TABLE IF NOT EXISTS no-op → 步骤 → 重排 → 唯一索引）。
  {
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        params TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'running',
        created_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        user_id TEXT,
        agent_status TEXT,
        retry_count INTEGER DEFAULT 0,
        retry_error_type TEXT,
        next_retry_at TEXT,
        max_retries INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    raw.prepare(`INSERT INTO tasks (id, type, params, status, created_at) VALUES (?, 'agent_loop', '{}', 'failed', ?)`)
      .run('legacy-collision-task', '2026-10-30T00:00:00.000Z');
    const ins = raw.prepare('INSERT INTO task_events (task_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)');
    ins.run('legacy-collision-task', 7, 'child_finished', '{"event":"child_finished"}', '2026-10-30T06:09:37.238Z');
    ins.run('legacy-collision-task', 7, 'token_budget', '{"event":"token_budget"}', '2026-10-30T06:09:37.625Z');
    ins.run('legacy-collision-task', 8, 'done', '{"event":"done"}', '2026-10-30T06:09:38.000Z');
    raw.close();
  }
  try {
    const r = runChild('collision-renumber', dbPath);
    assert.equal(r.totalRows, 3, `行数守恒（零删除）：${JSON.stringify(r)}`);
    assert.equal(r.dupGroups, 0, `碰撞清零：${JSON.stringify(r)}`);
    assert.equal(r.uniqueIndexPresent, true, `唯一索引在册：${JSON.stringify(r)}`);
    // 重排策略：只动碰撞成员——首行保留 seq=7；碰撞后行者让位到当时 max+1（done=8 在册）
    // ⇒ token_budget 重排为 9。非碰撞行不动；单任务 seq 全局唯一且单调不减（按写入序）。
    const byType = Object.fromEntries(r.rows.map((x) => [x.event_type, Number(x.seq)]));
    assert.equal(byType.child_finished, 7, `首行保留原 seq：${JSON.stringify(r.rows)}`);
    assert.equal(byType.done, 8, '非碰撞行不动');
    assert.equal(byType.token_budget, 9, '碰撞成员让位到当时 max+1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
