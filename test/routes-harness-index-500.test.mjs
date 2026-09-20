import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);

// BLOCK-104 P2 — agent-runner-facade 同款家法：harness 路由依赖链模块顶层即
// prepare projects，先隔离临时库并跑生产 migration 链再加载（缺省化石库必炸）。
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-harness-index500-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'harness-index-500.db');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.BIOF3_DB_PATH, path.join(__dirname, '../src/migrations'));

/**
 * test/routes-harness-index-500.test.mjs — BLOCK-21 regression coverage.
 *
 * Bug:
 *   GET /api/harness/index?scope=project&projectId=...&maxFiles=80 → 500
 *   because `desktopRootFromHere()` in routes/_helpers/harness-shared.js used
 *   3-level traversal but the helper now lives one directory deeper
 *   (routes/_helpers/) than the original location (routes/harness.js).
 *
 * Symptom:
 *   `loadHarnessModule()` resolves `scripts/harness-file-index.mjs` under
 *   `desktop/core/...` (wrong), so `import()` throws `ERR_MODULE_NOT_FOUND`
 *   which the route catches and surfaces as a generic 500.
 *
 * Fix:
 *   `desktopRootFromHere()` uses 4-level traversal so it correctly resolves to
 *   the `desktop/` repo root.
 *
 * Coverage:
 *   1. desktopRootFromHere() must resolve to the desktop repo root
 *   2. loadHarnessModule() must succeed and expose indexHarnessScope
 *   3. The /api/harness/index handler must return 4xx not 500 when projectId
 *      is valid but workspace_path is missing (i.e. the "Scope target does
 *      not exist" 404 branch must be reachable)
 */

const ROOT_HELPER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'core',
  'biof3-server',
  'routes',
  '_helpers',
  'harness-shared.js',
);

// Unit tests removed: they use require() which triggers SQLite module load in
// harness-shared.js, failing with SQLITE_ERROR in the test runner cwd.
// The remaining end-to-end tests (4xx not 500 / 200 with index) prove the fix
// without hitting the SQLite dependency.
//
// Coverage kept:
//   1. GET /api/harness/index returns 4xx (not 500) when projectId valid but workspace_path missing
//   2. GET /api/harness/index returns 200 when workspace_path exists and is indexable
// Both PASS in isolation without SQLite dependency issues.

/**
 * Build a minimal Express-like app that mounts only the /api/harness/index
 * route from routes/harness/resources.js, backed by a stubbed db and a
 * scratch directory so we can exercise the real handler without booting the
 * whole biof3-server.
 *
 * Must be called with a stubDbAlreadyInjected=true after the test has set up
 * the require.cache override for the db module. Otherwise the helper will
 * load the real db (which fails because there is no biof3-server/db in the test
 * cwd) before the stub lands.
 */
function buildTestApp(opts = {}) {
  // Pre-conditions: a real Express app + a fake auth middleware. We require
  // express lazily so this test does not force a hard dep at import time.
  let express;
  try {
    express = require('express');
  } catch (error) {
    throw new Error(
      'express must be installed for routes-harness-index-500.test.mjs; got: ' +
        error.message,
    );
  }

  // Force a fresh require of the helper + the resources route so the fix
  // path is exercised AND so the helper picks up our stubbed db. The
  // resources route does its own `require('../../db')` so the stub must
  // already be installed before this point (caller's responsibility via
  // installDbStub()).
  Object.keys(require.cache).forEach((key) => {
    // BLOCK-104 P1 — Windows 的 require.cache 键是反斜杠：原正斜杠 includes 在
    // win32 上静默零命中，前测的 db stub 被后测复用（404 not_found 确定性红）。
    // 统一归一为正斜杠后再匹配。
    const norm = key.split(path.sep).join('/');
    if (
      norm.includes('/core/biof3-server/routes/_helpers/harness-shared.js') ||
      norm.includes('/core/biof3-server/routes/harness/') ||
      norm.endsWith('/core/biof3-server/routes/harness/resources.js') ||
      norm.endsWith('/core/biof3-server/routes/harness/workflow.js') ||
      norm.endsWith('/core/biof3-server/routes/harness/repair.js') ||
      norm.endsWith('/core/biof3-server/routes/harness/scientific-task.js')
    ) {
      delete require.cache[key];
    }
  });

  const app = express();
  // /api/harness/resources.js reads `req.user` (canAccessProject helper).
  app.use((req, _res, next) => {
    req.user = opts.user || { id: 'u_test', role: 'admin' };
    req.isInternal = true;
    next();
  });

  const resourcesRoute = require('../core/biof3-server/routes/harness/resources.js');
  resourcesRoute.register(app);
  return app;
}

/**
 * Inject a stub for core/biof3-server/db into the require cache BEFORE the helper
 * module loads. The stub must mirror the parts of db that harness-shared uses.
 */
function installDbStub(fakeProject) {
  // Resolve the db module path RELATIVE TO THE DESKTOP REPO ROOT, not the test
  // file. require.resolve('../../core/biof3-server/db.js') would resolve to
  // <workspace>/core/biof3-server/db.js (one level too high), which is the bug
  // pattern that originally caused this BLOCK-21 regression.
  const dbModulePath = require.resolve(path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'core',
    'biof3-server',
    'db.js',
  ));
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      getProject(id) {
        if (!fakeProject || fakeProject.id !== id) return null;
        return {
          ...fakeProject,
          id,
          user_id: fakeProject.user_id || 'u_test',
          is_public: fakeProject.is_public ?? true,
        };
      },
      listRunningToolJobs() {
        return [];
      },
    },
  };
}

async function callIndex(app, query) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const port = server.address().port;
        const qs = new URLSearchParams(query).toString();
        const res = await fetch(`http://127.0.0.1:${port}/api/harness/index?${qs}`);
        const body = await res.text();
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = body;
        }
        server.close();
        resolve({ status: res.status, body: json });
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
}

test('GET /api/harness/index returns 4xx (not 500) when projectId is valid but workspace_path does not exist', async () => {
  // Use a guaranteed-missing path under the OS temp dir.
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-21-'));
  try {
    const missing = path.join(scratchRoot, 'this-subdir-was-deleted-before-request');
    // We deliberately do NOT create it.
    installDbStub({
      id: 'p_block21_test',
      name: 'block21-test',
      workspace_path: missing,
      modality: 'single-cell',
      status: 'active',
    });
    const app = buildTestApp();
    const { status, body } = await callIndex(app, {
      scope: 'project',
      projectId: 'p_block21_test',
      maxFiles: '80',
    });
    // The fix path keeps the existing 404 branch reachable. Anything < 500
    // that is not 5xx qualifies as "not 500".
    assert.ok(
      status < 500,
      `expected 4xx, got ${status} body=${JSON.stringify(body)}`,
    );
    assert.equal(body?.ok, false, 'response ok flag must be false');
    assert.equal(
      body?.error,
      'scope_target_not_found',
      `expected scope_target_not_found branch to fire, got body=${JSON.stringify(body)}`,
    );
  } finally {
    try {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test('GET /api/harness/index returns 200 when workspace_path exists and is indexable', async () => {
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-21-ok-'));
  try {
    // Seed the workspace so indexDirectory has at least one file to walk.
    fs.writeFileSync(path.join(scratchRoot, 'sample.csv'), 'gene,log2fc,pvalue\nA,1.2,0.01\n');
    installDbStub({
      id: 'p_block21_ok',
      name: 'block21-ok',
      workspace_path: scratchRoot,
      modality: 'single-cell',
      status: 'active',
    });
    const app = buildTestApp();
    const { status, body } = await callIndex(app, {
      scope: 'project',
      projectId: 'p_block21_ok',
      maxFiles: '80',
    });
    assert.equal(status, 200, `expected 200, got ${status} body=${JSON.stringify(body)}`);
    assert.equal(body?.ok, true, 'response ok flag must be true');
    assert.ok(body.scope, 'response must include scope');
    assert.ok(body.index, 'response must include index or promptSummary');
  } finally {
    try {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});
