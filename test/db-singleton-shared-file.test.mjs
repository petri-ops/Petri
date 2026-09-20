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
import { getDatabase, closeDatabase } from '../src/database/branch-db.js';
import { getDatabase as getResultDatabase } from '../src/database/result-db.js';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-db-shared-'));
}

test('PR-012.1 branch-db.getDatabasePath() === result-db.getDatabasePath() under legacy single-file layout', (t) => {
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

  // Both modules must agree on the same legacy file path so PR-012 dedup
  // can collapse them into a single handle.
  const branchPath = rootReq('./src/database/branch-db.js').getDatabasePath();
  const resultPath = rootReq('./src/database/result-db.js').getDatabasePath();
  assert.strictEqual(branchPath, resultPath, 'branch + result must resolve to the same biof3.db path');
  assert.ok(branchPath.endsWith('biof3.db'), 'path must keep the legacy biof3.db filename');
});

test('PR-012.2 openDb(branch) and openDb(result) return the same Database instance', (t) => {
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
  const result = openDb('result');
  assert.strictEqual(
    branch,
    result,
    'openDb(branch) and openDb(result) must dedup to the same Database (PR-012 fix)',
  );

  // The legacy public shims from branch-db / result-db must agree too —
  // otherwise biof3-server/mcp/branch-context.js would still see two distinct
  // handles via the legacy API surface.
  const legacyBranch = getDatabase();
  const legacyResult = getResultDatabase();
  assert.strictEqual(legacyBranch, legacyResult, 'branch-db.getDatabase === result-db.getDatabase');
  assert.strictEqual(legacyBranch, branch, 'legacy shim must forward to the singleton');
});

test('PR-012.3 writes via branch-db are visible to result-db (single shared handle)', (t) => {
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

  // Read it back from the result handle. If PR-012 dedup is correct,
  // both handles point at the same connection and the row is visible.
  const resultHandle = getResultDatabase();
  const row = resultHandle.prepare('SELECT id, payload FROM shared_probe WHERE id = ?').get(1);
  assert.ok(row, 'row written via branch-db handle must be visible via result-db handle');
  assert.strictEqual(row.payload, 'via-branch-db');

  // Cleanup the probe table so we don't leave schema behind for the
  // real schema-migration test suites.
  resultHandle.exec('DROP TABLE IF EXISTS shared_probe');
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

  // open via result (any role) — both roles share the same handle.
  const resultHandle = getResultDatabase();
  assert.ok(resultHandle.open, 'result handle must start open');

  // close via the branch shim — this should also invalidate the result
  // handle because PR-012 dedup means they're literally the same
  // Database object.
  closeDatabase();
  assert.ok(!resultHandle.open, 'closing via branch-db shim must also close the result handle');
});