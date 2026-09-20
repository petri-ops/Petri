/**
 * BLOCK-106 P2 — task_events 保留清扫：索引存在 + ISO cutoff 语义（源契约纠正）。
 *
 * 覆盖：
 *   1. schema 声明含 created_at 索引（源文件守卫，对标 E-019.2 busy_timeout 手法）
 *   2. 清扫按 JS ISO cutoff 作参数删除，计划走 created_at 索引（不再 SCAN 全表）
 *   3. cutoff 当日凌晨的行不再漏删——旧实现拿 SQLite 空格格式串比 ISO 列值，
 *      字典序在 `T`(0x54) vs 空格(0x20) 处失配，cutoff 当日早于该时刻的行被误判为更新
 *   4. 表缺失/语句失败时返回 0 不抛（清扫不毒化后续轮次）
 *
 * 运行：node --test test/block106-task-events-retention.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const coreServerRoot = path.join(root, 'core', 'biof3-server');
const storePath = path.join(coreServerRoot, 'agent-task-store.js');
const req = createRequire(path.join(coreServerRoot, 'package.json'));
const Database = req('better-sqlite3');

// 测试期不触碰任何真实库：先把 dbPath 指向临时目录再加载模块（对标既有测试姿势）
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'block106-retention-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'agent-tasks.db');
const store = req(storePath);

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date('2026-09-20T12:00:00.000Z');

function makeDb({ withCreatedIndex = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX idx_task_events_task_seq ON task_events(task_id, seq)');
  if (withCreatedIndex) db.exec('CREATE INDEX idx_task_events_created ON task_events(created_at)');
  return db;
}

function insert(db, createdAt, seq) {
  db.prepare('INSERT INTO task_events (task_id, seq, event_type, payload, created_at) VALUES (?,?,?,?,?)')
    .run('task-a', seq, 'log', '{}', createdAt);
}

const iso = (msAgo) => new Date(FIXED_NOW.getTime() - msAgo).toISOString();

test('schema 声明含 task_events created_at 索引（清扫不得长期跑全表 SCAN）', () => {
  const source = fs.readFileSync(storePath, 'utf8');
  assert.match(
    source,
    /CREATE INDEX IF NOT EXISTS idx_task_events_created ON task_events\(created_at\)/,
    '缺 created_at 索引 → 保留清扫的 DELETE 计划为 SCAN，成本随表线性增长'
  );
});

test('清扫按 ISO cutoff 删除且计划走索引', () => {
  const db = makeDb();
  insert(db, iso(31 * DAY_MS), 1); // 应删
  insert(db, iso(45 * DAY_MS), 2); // 应删
  insert(db, iso(29 * DAY_MS), 3); // 应留
  insert(db, iso(1 * DAY_MS), 4); // 应留
  const changes = store.sweepOldTaskEvents(db, { now: () => FIXED_NOW });
  assert.equal(changes, 2);
  assert.equal(db.prepare('select count(*) c from task_events').get().c, 2);
  const cutoff = new Date(FIXED_NOW.getTime() - 30 * DAY_MS).toISOString();
  const plan = db.prepare('EXPLAIN QUERY PLAN DELETE FROM task_events WHERE created_at < ?').all(cutoff);
  assert.match(JSON.stringify(plan), /USING INDEX idx_task_events_created/, '计划应命中 created_at 索引');
});

test('cutoff 当日凌晨的行不再漏删（旧 SQLite 空格格式串回归钉）', () => {
  const db = makeDb();
  // 30 天零 1 小时前：日期部分等于 cutoff 当日、时刻更早——旧实现因 `T` > 空格 判其「更新」而保留
  insert(db, iso(30 * DAY_MS + 60 * 60 * 1000), 1);
  const changes = store.sweepOldTaskEvents(db, { now: () => FIXED_NOW });
  assert.equal(changes, 1, '早于 30 天的行必须被删');
  assert.equal(db.prepare('select count(*) c from task_events').get().c, 0);
});

test('恰在窗口内的行保留（不早删：保留期只多不少）', () => {
  const db = makeDb();
  insert(db, iso(29 * DAY_MS - 60 * 60 * 1000), 1); // 28.96 天前
  insert(db, FIXED_NOW.toISOString(), 2);
  assert.equal(store.sweepOldTaskEvents(db, { now: () => FIXED_NOW }), 0);
  assert.equal(db.prepare('select count(*) c from task_events').get().c, 2);
});

test('表缺失时返回 0 且不抛（清扫失败不毒化后续轮次）', () => {
  const empty = new Database(':memory:');
  assert.equal(store.sweepOldTaskEvents(empty, { now: () => FIXED_NOW }), 0);
});

test('保留窗口常量仍为 30 天（改动需显式裁决）', () => {
  assert.equal(store.TASK_EVENTS_RETENTION_DAYS, 30);
});
