/**
 * G0-RS-P4R-0 capture environment.
 *
 * The isolation assertions matter more than the happy path here: the whole
 * reason this environment exists is that the developer database holds real
 * projects, so a capture that writes to the wrong place is the failure worth
 * testing against.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_RS_TABLES,
  assertIsolated,
  capture,
  createCaptureEnv,
  inspectTables,
} from '../scripts/g0-rs-p4r-capture.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DB = path.join(REPO_ROOT, 'core', 'r-server', 'biof3.db');

test('isolation fails closed when a path escapes the disposable root', () => {
  const root = '/tmp/biof3-capture-root';
  const good = {
    BIOF3_DB_PATH: path.join(root, 'biof3.db'),
    BIOF3_TEMP_DIR: path.join(root, 'tmp'),
    BIOF3_LOCAL_RESULTS_DIR: path.join(root, 'results'),
    BIOF3_LOCAL_UPLOADS_DIR: path.join(root, 'uploads'),
  };
  assert.equal(assertIsolated(good, root), true);

  for (const key of Object.keys(good)) {
    assert.throws(
      () => assertIsolated({ ...good, [key]: '/var/somewhere-else' }, root),
      /resolves outside the disposable root/,
      `${key} escaping the root must abort the run`,
    );
    assert.throws(
      () => assertIsolated({ ...good, [key]: '' }, root),
      /must be set explicitly/,
      `${key} must never be left to a default`,
    );
  }

  // A traversal that lands outside the root is still outside it.
  assert.throws(
    () => assertIsolated({ ...good, BIOF3_TEMP_DIR: path.join(root, '..', 'elsewhere') }, root),
    /resolves outside the disposable root/,
  );
});

test('isolation refuses to capture against the repository database', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'biof3-capture-guard-'));
  try {
    assert.throws(
      () => assertIsolated({
        BIOF3_DB_PATH: REPO_DB,
        BIOF3_TEMP_DIR: path.join(root, 'tmp'),
        BIOF3_LOCAL_RESULTS_DIR: path.join(root, 'results'),
        BIOF3_LOCAL_UPLOADS_DIR: path.join(root, 'uploads'),
      }, root),
      /refusing to capture against the repository database/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a built environment points every writable path into its own root', () => {
  const { root, env, dirs } = createCaptureEnv({ port: 12345 });
  try {
    for (const key of ['BIOF3_DB_PATH', 'BIOF3_TEMP_DIR', 'BIOF3_LOCAL_RESULTS_DIR', 'BIOF3_LOCAL_UPLOADS_DIR']) {
      assert.ok(env[key].startsWith(root + path.sep), `${key} must live under the disposable root`);
    }
    assert.equal(env.BIOF3_PERF_PROBE, '1', 'the probe must be armed for a capture run');
    assert.equal(env.R_SERVER_PORT, '12345');
    for (const dir of Object.values(dirs)) assert.ok(statSync(dir).isDirectory());
    assert.notEqual(path.resolve(env.BIOF3_DB_PATH), path.resolve(REPO_DB));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('capture migrates, boots the probe and tears the root down', { timeout: 120000 }, async () => {
  const devDbBefore = existsSync(REPO_DB) ? statSync(REPO_DB).mtimeMs : null;

  const result = await capture();

  assert.deepEqual(result.tables.missing, [], 'every Result Studio table must exist before sampling');
  assert.equal(result.tables.present.length, REQUIRED_RS_TABLES.length);
  assert.equal(result.snapshot.enabled, true, 'the probe must be live inside a real server');
  assert.ok(Array.isArray(result.snapshot.requests));
  assert.equal(existsSync(result.root), false, 'a capture run must not leave its root behind');

  // Serving requests must never write to the developer database.
  const devDbAfter = existsSync(REPO_DB) ? statSync(REPO_DB).mtimeMs : null;
  assert.equal(devDbAfter, devDbBefore, 'the developer database must be untouched by a capture run');
});

test('--keep leaves an inspectable root with a fully migrated database', { timeout: 120000 }, async () => {
  const result = await capture({ keep: true });
  try {
    assert.equal(existsSync(result.root), true);
    assert.deepEqual(inspectTables(path.join(result.root, 'biof3.db')).missing, []);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});
