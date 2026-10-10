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
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ISOLATED_PATH_ENV,
  REQUIRED_RS_TABLES,
  assertIsolated,
  capture,
  createCaptureEnv,
  inspectTables,
} from '../scripts/g0-rs-p4r-capture.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DB = path.join(REPO_ROOT, 'core', 'petri-server', 'petri.db');

/**
 * Paths that fall back to ~/Documents/Petri-Local — the real user data root,
 * holding the live database and 150 project directories — when their variable
 * is unset. The first version of this harness redirected four paths and
 * guarded the same four, silently leaving these three pointing at real data.
 */
const MUST_BE_ISOLATED = [
  'PETRI_DB_PATH',
  'PETRI_TEMP_DIR',
  'PETRI_LOCAL_RESULTS_DIR',
  'PETRI_LOCAL_UPLOADS_DIR',
  'PETRI_LOCAL_DATA_DIR',
  'PETRI_PLUGINS_DIR',
  'PETRI_HARNESS_LOCAL_ROOT',
];

test('every path that can reach the real user data root is redirected and guarded', () => {
  // Regression: these three defaulted to ~/Documents/Petri-Local, which holds
  // the live database and 150 project directories.
  for (const key of MUST_BE_ISOLATED) {
    assert.ok(key in ISOLATED_PATH_ENV, `${key} must be redirected into the disposable root`);
  }

  const { root, env } = createCaptureEnv({ port: 1 });
  try {
    for (const key of MUST_BE_ISOLATED) {
      assert.ok(env[key]?.startsWith(root + path.sep), `${key} must point inside the capture root`);
    }
    // Guarding must be derived from the same list, not restated — that drift is
    // exactly what let the three escape.
    for (const key of MUST_BE_ISOLATED) {
      assert.throws(
        () => assertIsolated({ ...env, [key]: path.join(homedir(), 'Documents', 'Petri-Local') }, root),
        /capture isolation/,
        `${key} pointing at the real data root must abort the run`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isolation fails closed when a path escapes the disposable root', () => {
  const root = '/tmp/petri-capture-root';
  const good = Object.fromEntries(
    Object.entries(ISOLATED_PATH_ENV).map(([key, leaf]) => [key, path.join(root, leaf)]),
  );
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
    () => assertIsolated({ ...good, PETRI_TEMP_DIR: path.join(root, '..', 'elsewhere') }, root),
    /resolves outside the disposable root/,
  );
});

test('isolation refuses to capture against the repository database', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'petri-capture-guard-'));
  try {
    assert.throws(
      () => assertIsolated({
        PETRI_DB_PATH: REPO_DB,
        PETRI_TEMP_DIR: path.join(root, 'tmp'),
        PETRI_LOCAL_RESULTS_DIR: path.join(root, 'results'),
        PETRI_LOCAL_UPLOADS_DIR: path.join(root, 'uploads'),
      }, root),
      /refusing to capture against the repository database/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a built environment points every writable path into its own root', () => {
  const { root, env, paths } = createCaptureEnv({ port: 12345 });
  try {
    for (const key of ['PETRI_DB_PATH', 'PETRI_TEMP_DIR', 'PETRI_LOCAL_RESULTS_DIR', 'PETRI_LOCAL_UPLOADS_DIR']) {
      assert.ok(env[key].startsWith(root + path.sep), `${key} must live under the disposable root`);
    }
    assert.equal(env.PETRI_PERF_PROBE, '1', 'the probe must be armed for a capture run');
    assert.equal(env.R_SERVER_PORT, '12345');
    for (const [key, value] of Object.entries(paths)) {
      if (key !== 'PETRI_DB_PATH') assert.ok(statSync(value).isDirectory(), `${key} must be created`);
    }
    assert.notEqual(path.resolve(env.PETRI_DB_PATH), path.resolve(REPO_DB));
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
    assert.deepEqual(inspectTables(path.join(result.root, 'petri.db')).missing, []);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});
