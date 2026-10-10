/**
 * BLOCK-10 PHASE 1.1 (A-007) — DB singleton test.
 *
 * Coverage:
 *   A-007.1 openDb('branch') 单例（多次调用返回同一对象）
 *   A-007.2 openDb('result') 单例（不同 role 不同 connection key）
 *   A-007.3 closeDb + 重新 openDb 拿到新连接
 *   A-007.4 closeAll 关闭所有
 *   A-007.5 busy_timeout 来自 getBusyTimeout()（mock config 改值验证）
 *   A-007.6 WAL 模式验证
 *   A-007.7 未知 role 抛错
 *   A-007.8 foreign_keys ON 验证
 *
 * 运行：cd desktop && node --test test/db-singleton.test.mjs
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
const coreServerRoot = path.join(root, 'core', 'petri-server');
const req = createRequire(path.join(coreServerRoot, 'package.json'));

// Core's better-sqlite3 — the migration-runner paths and singleton both
// point here when PETRI_BETTER_SQLITE3_ROOT is set.
req('better-sqlite3');

import { openDb, closeDb, closeAll, _reset } from '../src/database/_db-singleton.js';
import configHelper from '../core/shared-backend/config-helper.js';
const { getBusyTimeout, setDbConfig, getDbConfig } = configHelper;

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-db-singleton-'));
  return dir;
}

// Better-sqlite3 PRAGMA returns the *current* journal_mode setting.
function readJournalMode(db) {
  return db.pragma('journal_mode', { simple: true });
}

function readBusyTimeout(db) {
  return db.pragma('busy_timeout', { simple: true });
}

function readForeignKeys(db) {
  return db.pragma('foreign_keys', { simple: true });
}

test('A-007.1 openDb(branch) returns the same instance on repeated calls', (t) => {
  const tmp = mkTmp();
  process.env.PETRI_LOCAL_DATA_DIR = tmp;
  process.env.PETRI_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.PETRI_LOCAL_DATA_DIR;
    delete process.env.PETRI_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  const a = openDb('branch');
  const b = openDb('branch');
  assert.strictEqual(a, b, 'openDb(branch) must return the same Database instance (singleton)');
});

test('A-007.2 openDb(result) returns the same instance on repeated calls', (t) => {
  const tmp = mkTmp();
  process.env.PETRI_LOCAL_DATA_DIR = tmp;
  process.env.PETRI_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.PETRI_LOCAL_DATA_DIR;
    delete process.env.PETRI_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  const a = openDb('result');
  const b = openDb('result');
  assert.strictEqual(a, b, 'openDb(result) must return the same Database instance (singleton)');
});

test('A-007.3 closeDb + reopen yields a brand new connection', (t) => {
  const tmp = mkTmp();
  process.env.PETRI_LOCAL_DATA_DIR = tmp;
  process.env.PETRI_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.PETRI_LOCAL_DATA_DIR;
    delete process.env.PETRI_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  const before = openDb('branch');
  assert.ok(before.open, 'first connection must be open');
  closeDb('branch');
  // closeDb removes from cache; the old handle is now closed (better-sqlite3
  // throws if you call .prepare on it after close, but identity stays).
  const after = openDb('branch');
  assert.notStrictEqual(after, before, 'after closeDb, reopen must hand back a fresh Database');
  assert.ok(after.open, 'reopened connection must be open');
  // pragma-set state must persist across reopen — journal_mode stays WAL
  assert.strictEqual(readJournalMode(after), 'wal');
});

test('A-007.4 closeAll closes every cached connection', (t) => {
  const tmp = mkTmp();
  process.env.PETRI_LOCAL_DATA_DIR = tmp;
  process.env.PETRI_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.PETRI_LOCAL_DATA_DIR;
    delete process.env.PETRI_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  const branch = openDb('branch');
  const result = openDb('result');
  assert.ok(branch.open && result.open, 'both connections should start open');

  closeAll();

  // closeAll closes every cached handle; reopen must produce new objects.
  const branchAgain = openDb('branch');
  const resultAgain = openDb('result');
  assert.notStrictEqual(branchAgain, branch, 'branch reopen must yield a new instance');
  assert.notStrictEqual(resultAgain, result, 'result reopen must yield a new instance');
  assert.ok(branchAgain.open && resultAgain.open, 'reopened connections must be open');
});

test('A-007.5 busy_timeout reflects getBusyTimeout() override', (t) => {
  const tmp = mkTmp();
  process.env.PETRI_LOCAL_DATA_DIR = tmp;
  process.env.PETRI_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    // restore default config so other suites are not affected
    setDbConfig({ busyTimeoutMs: 10000 });
    delete process.env.PETRI_LOCAL_DATA_DIR;
    delete process.env.PETRI_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  // default value from config-helper
  const defaultBusy = getBusyTimeout();
  assert.strictEqual(defaultBusy, 10000, 'default busyTimeoutMs must be 10000');

  // override and reopen to verify the override flows through
  setDbConfig({ busyTimeoutMs: 25000 });
  assert.strictEqual(getBusyTimeout(), 25000, 'getBusyTimeout must read the override');
  const db = openDb('branch');
  assert.strictEqual(
    readBusyTimeout(db),
    25000,
    'openDb must apply busy_timeout from getBusyTimeout() at open time',
  );
});

test('A-007.6 WAL journal mode is applied at open time', (t) => {
  const tmp = mkTmp();
  process.env.PETRI_LOCAL_DATA_DIR = tmp;
  process.env.PETRI_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.PETRI_LOCAL_DATA_DIR;
    delete process.env.PETRI_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  const db = openDb('result');
  assert.strictEqual(readJournalMode(db), 'wal', 'openDb must enable journal_mode = WAL');
});

test('A-007.7 openDb throws on unknown role', (t) => {
  const tmp = mkTmp();
  process.env.PETRI_LOCAL_DATA_DIR = tmp;
  process.env.PETRI_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.PETRI_LOCAL_DATA_DIR;
    delete process.env.PETRI_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  assert.throws(() => openDb('not-a-role'), /Unknown db role/);
  // Sanity: known roles open without throwing.
  assert.doesNotThrow(() => openDb('branch'));
  assert.doesNotThrow(() => openDb('result'));
});

test('A-007.8 foreign_keys is enabled by openDb', (t) => {
  const tmp = mkTmp();
  process.env.PETRI_LOCAL_DATA_DIR = tmp;
  process.env.PETRI_BETTER_SQLITE3_ROOT = coreServerRoot;
  _reset();

  t.after(() => {
    closeAll();
    _reset();
    delete process.env.PETRI_LOCAL_DATA_DIR;
    delete process.env.PETRI_BETTER_SQLITE3_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  const db = openDb('branch');
  assert.strictEqual(readForeignKeys(db), 1, 'openDb must enable foreign_keys = ON');
});

// Sanity check that getDbConfig still works (config-helper Proxy contract).
test('config-helper exposes getDbConfig() with the expected shape', () => {
  const cfg = getDbConfig();
  assert.strictEqual(cfg.busyTimeoutMs, 10000);
  assert.strictEqual(cfg.journalMode, 'WAL');
  assert.ok(cfg.schemaVersion);
});