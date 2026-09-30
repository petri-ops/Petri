'use strict';

/**
 * BLOCK-136（G0-PLATFORM PL-4 机制先行）— tool_jobs retention 纯函数契约。
 *
 * 默认关闭（retentionDays<=0 → disabled 零删除）；保护边界：绝不碰
 * pending/running 等非终态、绝不碰 protectedJobIds=公开演示作业；
 * jobsDir 仅清全局目录 <jobsDir>/<jobId>，项目布局目录不动（归项目 GC 域）。
 * 建库风格参考 test/block127-lineage.test.mjs（node:test + ESM + better-sqlite3）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const { retentionSweep } = require('../core/biof3-server/helpers/tool-jobs-retention.js');
const { runRetentionSweep } = require('../core/biof3-server/jobs/retention-sweeper.js');

const DAY = 24 * 60 * 60 * 1000;
// 固定 now：边界（恰好等于 retentionDays 天龄）可精确断言，不依赖真实时钟
const NOW = 1_760_000_000_000;

// 内存库 + 最小 tool_jobs schema（retentionSweep 只读写 id/status/created_at）
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE tool_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '',
    tool_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at BIGINT NOT NULL,
    is_public INTEGER DEFAULT 0
  )`);
  return db;
}

function insertJob(db, { id, status, createdAt }) {
  db.prepare('INSERT INTO tool_jobs (id, user_id, tool_id, status, created_at) VALUES (?,?,?,?,?)')
    .run(id, 'u1', 'deseq2', status, createdAt);
}

test('① retentionDays=0（与负数）返回 disabled 且零删除（不查库）', () => {
  // 无 tool_jobs 表的裸库：若实现真的查了库会 throw no such table——
  // 「disabled 短路不查库」由不炸间接证明
  const bare = new Database(':memory:');
  const report = retentionSweep({ db: bare, now: NOW, retentionDays: 0 });
  assert.equal(report.reason, 'disabled');
  assert.equal(report.deleted, 0);
  bare.close();

  const db = makeDb();
  insertJob(db, { id: 'j_ancient', status: 'completed', createdAt: 1 });
  for (const days of [0, -5]) {
    const r = retentionSweep({ db, now: NOW, retentionDays: days });
    assert.equal(r.reason, 'disabled', `retentionDays=${days} 应 disabled`);
    assert.equal(r.deleted, 0);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tool_jobs').get().n, 1, '关闭时零删除');
  db.close();
});

test('② 超龄 completed/failed/cancelled 删、pending/running 保留', () => {
  const db = makeDb();
  const old = NOW - 100 * DAY;
  insertJob(db, { id: 'j_completed', status: 'completed', createdAt: old });
  insertJob(db, { id: 'j_failed', status: 'failed', createdAt: old });
  insertJob(db, { id: 'j_cancelled', status: 'cancelled', createdAt: old });
  insertJob(db, { id: 'j_pending', status: 'pending', createdAt: old });
  insertJob(db, { id: 'j_running', status: 'running', createdAt: old });

  const report = retentionSweep({ db, now: NOW, retentionDays: 30 });
  assert.equal(report.reason, 'ok');
  assert.equal(report.deleted, 3, `只删超龄终态三态，实际 deleted=${report.deleted}`);
  assert.deepEqual([...report.ids].sort(), ['j_cancelled', 'j_completed', 'j_failed']);
  for (const keep of ['j_pending', 'j_running']) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM tool_jobs WHERE id = ?').get(keep);
    assert.equal(row.n, 1, `${keep} 必须保留`);
  }
  db.close();
});

test('③ protectedJobIds 命中的超龄作业保留', () => {
  const db = makeDb();
  const old = NOW - 400 * DAY;
  insertJob(db, { id: 'job_demo', status: 'completed', createdAt: old });
  insertJob(db, { id: 'job_plain', status: 'completed', createdAt: old });

  const report = retentionSweep({
    db, now: NOW, retentionDays: 30, protectedJobIds: ['job_demo'],
  });
  assert.equal(report.deleted, 1);
  assert.deepEqual(report.ids, ['job_plain']);
  const row = db.prepare('SELECT COUNT(*) AS n FROM tool_jobs WHERE id = ?').get('job_demo');
  assert.equal(row.n, 1, '保护清单命中的超龄作业必须保留');
  db.close();
});

test('④ cutoff 边界：恰好等于 retentionDays 天龄的保留（严格小于才删）', () => {
  const db = makeDb();
  insertJob(db, { id: 'j_edge', status: 'completed', createdAt: NOW - 30 * DAY });
  insertJob(db, { id: 'j_older', status: 'completed', createdAt: NOW - 30 * DAY - 1 });

  const report = retentionSweep({ db, now: NOW, retentionDays: 30 });
  assert.equal(report.deleted, 1);
  assert.deepEqual(report.ids, ['j_older']);
  const row = db.prepare('SELECT COUNT(*) AS n FROM tool_jobs WHERE id = ?').get('j_edge');
  assert.equal(row.n, 1, '恰好等于窗口天龄必须保留');
  db.close();
});

test('⑤ jobsDir 提供时全局目录被清、目录外文件不动', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block136-'));
  const db = makeDb();
  try {
    const jobsDir = path.join(root, 'tool-jobs');
    fs.mkdirSync(path.join(jobsDir, 'job_old'), { recursive: true });
    fs.writeFileSync(path.join(jobsDir, 'job_old', 'out.txt'), 'x');
    fs.mkdirSync(path.join(jobsDir, 'job_demo'));
    fs.writeFileSync(path.join(root, 'stray.txt'), 'x'); // jobsDir 下非作业文件
    fs.mkdirSync(path.join(root, 'sibling'));
    fs.writeFileSync(path.join(root, 'sibling', 's.txt'), 'x'); // jobsDir 之外

    insertJob(db, { id: 'job_old', status: 'completed', createdAt: NOW - 100 * DAY });
    insertJob(db, { id: 'job_demo', status: 'completed', createdAt: NOW - 100 * DAY });

    const report = retentionSweep({
      db, now: NOW, retentionDays: 30, jobsDir, protectedJobIds: ['job_demo'],
    });
    assert.equal(report.deleted, 1);
    assert.equal(fs.existsSync(path.join(jobsDir, 'job_old')), false, '全局作业目录应级联清除');
    assert.equal(fs.existsSync(path.join(jobsDir, 'job_demo')), true, '保护作业的目录不动');
    assert.equal(fs.existsSync(path.join(root, 'stray.txt')), true, 'jobsDir 下非作业文件不动');
    assert.equal(fs.existsSync(path.join(root, 'sibling', 's.txt')), true, 'jobsDir 之外不动');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('⑥ 超过一批（200）上限时分批循环删净且 ids 收集齐全', () => {
  const db = makeDb();
  const old = NOW - 100 * DAY;
  const insert = db.prepare('INSERT INTO tool_jobs (id, user_id, tool_id, status, created_at) VALUES (?,?,?,?,?)');
  const total = 250;
  for (let i = 0; i < total; i += 1) {
    insert.run(`j_bulk_${String(i).padStart(4, '0')}`, 'u1', 'deseq2', 'completed', old);
  }

  const report = retentionSweep({ db, now: NOW, retentionDays: 30 });
  assert.equal(report.deleted, total, '分批循环必须删净全部候选');
  assert.equal(report.ids.length, total);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tool_jobs').get().n, 0);
  db.close();
});

// F2（BLOCK-136 复核）：接线段契约——env 开关唯一激活路径此前零测试，
// 拼写错/解析漂移都是静默永不生效。直接跑 runRetentionSweep（与生产线
// 同一入口）断言 env 两分支。
const ENV_KEY = 'BIOF3_TOOL_JOBS_RETENTION_DAYS';

function mkSweepDb() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE tool_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL, is_public INTEGER)");
  return db;
}

test('runRetentionSweep 接线：env 未设=disabled 零删除', () => {
  const backup = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  try {
    const db = mkSweepDb();
    db.prepare("INSERT INTO tool_jobs VALUES ('old', 'completed', 0, 0)").run();
    const report = runRetentionSweep({ db, jobsDir: null });
    assert.equal(report.deleted.tool_jobs_retention, undefined, 'disabled 不得产生删除计数');
    db.close();
  } finally {
    if (backup === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = backup;
  }
});

test('runRetentionSweep 接线：env=1 删超龄终态、保留新作业', () => {
  const backup = process.env[ENV_KEY];
  process.env[ENV_KEY] = '1';
  try {
    const db = mkSweepDb();
    const now = Date.now();
    db.prepare("INSERT INTO tool_jobs VALUES ('gone', 'completed', ?, 0)").run(now - 10 * 86400000);
    db.prepare("INSERT INTO tool_jobs VALUES ('fresh', 'completed', ?, 0)").run(now - 1000);
    db.prepare("INSERT INTO tool_jobs VALUES ('pub', 'completed', ?, 1)").run(now - 10 * 86400000);
    const report = runRetentionSweep({ db, jobsDir: null });
    assert.ok((report.deleted.tool_jobs_retention || 0) >= 1, JSON.stringify(report));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tool_jobs WHERE id='gone'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tool_jobs WHERE id='fresh'").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tool_jobs WHERE id='pub'").get().n, 1, 'F1：is_public=1 动态公开作业同口径保护');
    db.close();
  } finally {
    if (backup === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = backup;
  }
});
