/**
 * BLOCK-511 S1.2 HK-01 — cache-manager 清理 fail-open 修复契约。
 *
 * 病灶（修复前）：
 *  - runningTaskIds 声明后从未填充 → 运行中任务的缓存被当 orphan 删除；
 *  - 查库抛错只记 errors 继续 → dbTaskIds 为空 → 全部缓存判 orphan 删除。
 * 修复后：查库失败即中止本轮（report.aborted、零删除）；
 *  runningTaskIds 用 analyses.status 的未终态（running/pending/queued）填充。
 *
 * 三例：①查库抛错零删除 ②运行中任务缓存保留 ③孤儿且闲置缓存删除。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 每个用例独立临时目录 + 独立 SQLite（模块级 TEMP_DIR/CACHE_DIR 在 require 时定死，
// 用 require.cache 清理 + 动态重新 require 保证隔离）。
function freshModule({ activeStatuses = [] } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b511-cache-'));
  const tempDir = path.join(tempRoot, 'tmp');
  const cacheDir = path.join(tempDir, '_cache');
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const dbPath = path.join(tempRoot, 'petri.db');
  process.env.PETRI_TEMP_DIR = tempDir;
  process.env.PETRI_DB_PATH = dbPath;

  // 初始化最小 analyses 表
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, task_id TEXT, status TEXT, created_at TEXT)');
  for (const [taskId, status] of activeStatuses) {
    db.prepare('INSERT INTO analyses (id, task_id, status, created_at) VALUES (?, ?, ?, ?)')
      .run(`a-${taskId}`, taskId, status, new Date().toISOString());
  }

  // 清掉 config / env-coordinator / db / cache-manager 的缓存以读取新 env
  for (const rel of [
    'core/petri-server/cache-manager.js',
    'core/petri-server/config.js',
    'core/petri-server/db.js',
    'src/main/env-coordinator.js',
  ]) {
    const abs = path.join(root, rel);
    delete require.cache[require.resolve(abs)];
  }
  const cm = require(path.join(root, 'core/petri-server/cache-manager.js'));
  return {
    cm, tempDir, cacheDir, db,
    cleanup: () => {
      try { db.close(); } catch { /* handle */ }
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* win handle */ }
    },
  };
}

const OLD = Date.now() - 30 * 24 * 3600 * 1000;

function seedTempTask(tempDir, taskId, mtimeMs = OLD) {
  const dir = path.join(tempDir, `task-${taskId}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'blob'), 'x');
  fs.utimesSync(dir, new Date(mtimeMs), new Date(mtimeMs));
  return dir;
}
function seedCache(cacheDir, taskId, atimeMs = OLD) {
  const file = path.join(cacheDir, `task-${taskId}.rds`);
  fs.writeFileSync(file, 'rds');
  fs.utimesSync(file, new Date(atimeMs), new Date(atimeMs));
  return file;
}

test('①查库抛错即中止本轮清理：临时目录与缓存零删除，report 标 aborted', () => {
  const ctx = freshModule();
  try {
    const tempTask = seedTempTask(ctx.tempDir, 'failcase');
    const cache = seedCache(ctx.cacheDir, 'failcase');
    const report = ctx.cm.cleanup({ getDatabase: () => { throw new Error('synthetic DB query failure'); } });
    assert.equal(report.aborted, true, '查库失败必须标 aborted');
    assert.equal(fs.existsSync(tempTask), true, '临时目录不得删除');
    assert.equal(fs.existsSync(cache), true, '缓存不得删除');
    assert.deepEqual(report.tempDeleted, []);
    assert.deepEqual(report.cacheDeleted, []);
  } finally {
    ctx.cleanup();
  }
});

test('②运行中任务（未终态 status）的缓存与临时目录保留', () => {
  const ctx = freshModule({ activeStatuses: [['runner-1', 'running'], ['queue-1', 'queued'], ['pending-1', 'pending']] });
  try {
    const dirs = ['runner-1', 'queue-1', 'pending-1'].map((id) => seedTempTask(ctx.tempDir, id));
    const files = ['runner-1', 'queue-1', 'pending-1'].map((id) => seedCache(ctx.cacheDir, id));
    const report = ctx.cm.cleanup({ getDatabase: () => ctx.db });
    assert.notEqual(report.aborted, true);
    for (const d of dirs) assert.equal(fs.existsSync(d), true, `运行中临时目录 ${d} 必须保留`);
    for (const f of files) assert.equal(fs.existsSync(f), true, `运行中缓存 ${f} 必须保留`);
    assert.deepEqual(report.cacheKept.filter((k) => k.reason === 'running').map((k) => k.name).sort(),
      ['task-pending-1.rds', 'task-queue-1.rds', 'task-runner-1.rds']);
  } finally {
    ctx.cleanup();
  }
});

test('③孤儿且闲置的缓存删除（无 DB 记录且 atime 超过阈值）', () => {
  const ctx = freshModule();
  try {
    const orphan = seedCache(ctx.cacheDir, 'orphan-idle');
    const report = ctx.cm.cleanup({ getDatabase: () => ctx.db });
    assert.notEqual(report.aborted, true);
    assert.equal(fs.existsSync(orphan), false, '孤儿且闲置缓存应删除');
    assert.ok(report.cacheDeleted.some((d) => d.name === 'task-orphan-idle.rds'));
  } finally {
    ctx.cleanup();
  }
});
