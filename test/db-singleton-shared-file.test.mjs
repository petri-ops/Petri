/**
 * BLOCK-10 PHASE 1.1 (PR-012) — branch-db + result-db share one connection
 * when targeting the same file (desktop main + biof3-server MCP child process).
 *
 * Coverage:
 *   PR-012.1 branch + result use the same resolved file path (legacy
 *             single-file layout preserved 100%).
 *   PR-012.2 openDb('branch') and openDb('result') return the SAME
 *             Database instance when the resolved file paths match
 *             (singleton dedup; the original PR-012 bug).
 *   PR-012.3 data round-trip: openDb('branch') insert -> openDb('result')
 *             reads -> cross-role visibility (proves single shared
 *             handle, not two disconnected handles).
 *
 * 运行：cd desktop && node --test test/db-singleton-shared-file.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const coreServerRoot = path.join(root, 'core', 'biof3-server');
createRequire(path.join(coreServerRoot, 'package.json'));
const rootReq = createRequire(path.join(root, 'package.json'));

import { openDb, closeAll, _reset } from '../src/database/_db-singleton.js';
import { getDatabase, closeDatabase, getDatabasePath } from '../src/database/branch-db.js';
// PL-5a（2026-09-29）：result-db.js 已随 result:* 数据层退役删除——本文件改为
// 验证 branch 角色自身的单例去重契约（PR-012 的机制不变，实例面只剩 branch）。

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-db-shared-'));
}

test('PR-012.1 branch-db resolves the legacy single-file biof3.db path (result 侧已退役)', (t) => {
  const tmp = mkTmp();
  process.env.BIOF3_LOCAL_DATA_DIR = tmp;
  process.env.BIOF3_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.BIOF3_LOCAL_DATA_DIR;
    delete process.env.BIOF3_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  const branchPath = getDatabasePath();
  assert.ok(branchPath.endsWith('biof3.db'), 'path must keep the legacy biof3.db filename');
  assert.strictEqual(rootReq('./src/database/branch-db.js').getDatabasePath(), branchPath, '重复 require 同一单例路径');
});

test('PR-012.2 openDb 双次调用与 legacy shim 返回同一 Database 实例（去重机制）', (t) => {
  const tmp = mkTmp();
  process.env.BIOF3_LOCAL_DATA_DIR = tmp;
  process.env.BIOF3_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.BIOF3_LOCAL_DATA_DIR;
    delete process.env.BIOF3_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  const branch = openDb('branch');
  const again = openDb('branch');
  assert.strictEqual(branch, again, 'openDb 重复调用必须去重到同一实例（PR-012 机制）');
  const legacyBranch = getDatabase();
  assert.strictEqual(legacyBranch, branch, 'legacy shim must forward to the singleton');
});

test('PR-012.3 同一单例句柄上的写读一致（单共享句柄机制）', (t) => {
  const tmp = mkTmp();
  process.env.BIOF3_LOCAL_DATA_DIR = tmp;
  process.env.BIOF3_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.BIOF3_LOCAL_DATA_DIR;
    delete process.env.BIOF3_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  // Create the projects table via the branch handle (the schema the
  // legacy single-file layout relies on).
  const branchHandle = getDatabase();
  branchHandle.exec(`
    CREATE TABLE IF NOT EXISTS shared_probe (
      id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL
    )
  `);
  branchHandle.prepare('INSERT INTO shared_probe (id, payload) VALUES (?, ?)').run(1, 'via-branch-db');

  // 同一单例的第二个引用读取——若 PR-012 去重正确，行可见。
  const secondHandle = getDatabase();
  const row = secondHandle.prepare('SELECT id, payload FROM shared_probe WHERE id = ?').get(1);
  assert.ok(row, '单例第二引用必须读到第一引用写的行');
  assert.strictEqual(row.payload, 'via-branch-db');
  secondHandle.exec('DROP TABLE IF EXISTS shared_probe');
});

test('PR-012 backward-compat shims: branch-db.closeDatabase closes the singleton for both roles', (t) => {
  const tmp = mkTmp();
  process.env.BIOF3_LOCAL_DATA_DIR = tmp;
  process.env.BIOF3_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.BIOF3_LOCAL_DATA_DIR;
    delete process.env.BIOF3_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  // open via legacy shim——单例共享同一句柄。
  const resultHandle = getDatabase();
  assert.ok(resultHandle.open, 'handle must start open');

  // close via the branch shim — this must invalidate the handle because
  // PR-012 dedup means every reference is literally the same Database object.
  closeDatabase();
  assert.ok(!resultHandle.open, 'closing via branch-db shim must close the shared handle');
});