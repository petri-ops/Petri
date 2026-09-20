/**
 * BLOCK-10-ARCHITECTURE PHASE 1.2 (A-010) — 6 core desktop env reads
 * centralised through config-helper.getCoreEnv() / getEnv().
 *
 * Coverage:
 *   A-010.1 getCoreEnv() default busyTimeoutMs === 10000
 *   A-010.2 getCoreEnv() returns all 6 documented fields
 *   A-010.3 env override flows through (BIOF3_R_HOME → coreEnv.rHome)
 *   A-010.4 getCoreEnv() snapshot is frozen (cannot be mutated by caller)
 *   A-010.5 getEnv(KEY, fallback) falls back to literal when env unset
 *   A-010.6 getEnv treats empty-string env as unset (returns fallback)
 *   A-010.7 6 core env reads in core/biof3-server/config.js no longer hit
 *             process.env directly
 *
 * 运行：cd desktop && node --test test/config-helper-centralized.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// config-helper is a CJS module exporting a Proxy via `module.exports = new Proxy(...)`.
// Importing it from an ESM test requires interop: `import pkg from '...'; const h = pkg.default ?? pkg;`.
const configHelperModule = (
  await import(pathToFileURL(path.join(root, 'core/shared-backend/config-helper.js')).href)
).default;
const configHelper = configHelperModule && configHelperModule.default
  ? configHelperModule.default
  : configHelperModule;

const { getEnv, getCoreEnv, getBusyTimeout } = configHelper;

// createRequire is needed so we can `require()` the CJS config.js inside a
// sync test body (top-level await works for the config-helper import above,
// but not from within a sync `test()` callback).
const req = createRequire(path.join(root, 'package.json'));

// 6 core env keys the helper owns. Save + restore around every test.
const CORE_ENV_KEYS = [
  'BIOF3_R_HOME',
  'BIOF3_LOCAL_RESULTS_DIR',
  'BIOF3_LOCAL_UPLOADS_DIR',
  'BIOF3_TEMP_DIR',
  'BIOF3_DB_PATH',
];

function snapshotEnv() {
  const saved = {};
  for (const key of CORE_ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved) {
  for (const key of CORE_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  // restore default busy_timeout after potential override.
  configHelper.setDbConfig({ busyTimeoutMs: 10000 });
}

test('A-010.1 getCoreEnv() default busyTimeoutMs === 10000', () => {
  const saved = snapshotEnv();
  restoreEnv({}); // wipe everything for a clean baseline
  assert.strictEqual(getCoreEnv().busyTimeoutMs, 10000);
  assert.strictEqual(getBusyTimeout(), 10000);
  restoreEnv(saved);
});

test('A-010.2 getCoreEnv() returns all 6 documented fields', () => {
  const core = getCoreEnv();
  for (const key of [
    'busyTimeoutMs',
    'rHome',
    'localResultsDir',
    'localUploadsDir',
    'tempDir',
    'dbPath',
  ]) {
    assert.ok(key in core, `getCoreEnv() must include \`${key}\``);
  }
  assert.strictEqual(core.tempDir, '/tmp/biof3-tmp', 'tempDir fallback must match');
});

test('A-010.3 env override flows through getCoreEnv()', () => {
  const saved = snapshotEnv();
  process.env.BIOF3_R_HOME = '/custom/R';
  process.env.BIOF3_DB_PATH = '/custom/biof3.db';
  process.env.BIOF3_TEMP_DIR = '/custom/tmp';
  process.env.BIOF3_LOCAL_RESULTS_DIR = '/custom/results';
  process.env.BIOF3_LOCAL_UPLOADS_DIR = '/custom/uploads';
  const core = getCoreEnv();
  assert.strictEqual(core.rHome, '/custom/R');
  assert.strictEqual(core.dbPath, '/custom/biof3.db');
  assert.strictEqual(core.tempDir, '/custom/tmp');
  assert.strictEqual(core.localResultsDir, '/custom/results');
  assert.strictEqual(core.localUploadsDir, '/custom/uploads');
  restoreEnv(saved);
});

test('A-010.4 getCoreEnv() snapshot is frozen', () => {
  const core = getCoreEnv();
  assert.ok(Object.isFrozen(core), 'getCoreEnv() must return a frozen snapshot');
  assert.throws(() => { core.rHome = '/mutated'; }, TypeError);
  assert.throws(() => { core.tempDir = '/mutated'; }, TypeError);
});

test('A-010.5 getEnv(KEY, fallback) returns literal when env unset', () => {
  const saved = snapshotEnv();
  delete process.env.BIOF3_R_HOME;
  assert.strictEqual(getEnv('BIOF3_R_HOME', '[fallback]'), '[fallback]');
  restoreEnv(saved);
});

test('A-010.6 getEnv treats empty-string env as unset', () => {
  process.env.BIOF3_R_HOME = '';
  try {
    assert.strictEqual(
      getEnv('BIOF3_R_HOME', '[fallback]'),
      '[fallback]',
      'empty-string env must not silently win against the documented fallback',
    );
  } finally {
    delete process.env.BIOF3_R_HOME;
  }
});

test('A-010.7 6 core env reads in core/biof3-server/config.js no longer hit process.env directly', () => {
  // The 6 fields routed through getCoreEnv() in config.js must no longer
  // read process.env.X directly. We assert source-text against the new
  // pattern: `rHome: _coreEnv.rHome` (or similar). The legacy literal
  // `process.env.BIOF3_R_HOME || ''` must be gone.
  const configSource = fs.readFileSync(
    path.join(root, 'core/biof3-server/config.js'),
    'utf8',
  );

  // Positive: the helper is referenced.
  assert.ok(
    configSource.includes('getCoreEnv'),
    'core/biof3-server/config.js must read core env through config-helper.getCoreEnv()',
  );

  // Negative: the 6 directly-read env fields must no longer appear in
  // the form `process.env.<KEY> ||`. Comments that reference the previous
  // behaviour are fine (they describe the migration), but executable code
  // must route through the helper.
  const legacyReadPatterns = [
    /process\.env\.BIOF3_R_HOME\s*\|\|/,
    /process\.env\.BIOF3_LOCAL_RESULTS_DIR\s*\|\|/,
    /process\.env\.BIOF3_LOCAL_UPLOADS_DIR\s*\|\|/,
    /process\.env\.BIOF3_TEMP_DIR\s*\|\|/,
    /process\.env\.BIOF3_DB_PATH\s*\|\|/,
  ];
  for (const re of legacyReadPatterns) {
    assert.ok(
      !re.test(configSource),
      `core/biof3-server/config.js must not carry legacy \`${re}\``,
    );
  }

  // Sanity: the helper-backed fields are still observable through the
  // config object. We require() the CJS config.js fresh so the new env
  // values are picked up at module load time.
  process.env.BIOF3_R_HOME = '/sanity/R';
  process.env.BIOF3_TEMP_DIR = '/sanity/tmp';
  process.env.BIOF3_DB_PATH = '/sanity/biof3.db';
  try {
    // Bust the require cache so config.js re-evaluates with the new env.
    const configPath = req.resolve(
      path.join(root, 'core/biof3-server/config.js'),
    );
    delete req.cache[configPath];
    const freshConfig = req(configPath);
    assert.strictEqual(freshConfig.rHome, '/sanity/R');
    assert.strictEqual(freshConfig.tempDir, '/sanity/tmp');
    assert.strictEqual(freshConfig.dbPath, '/sanity/biof3.db');
  } finally {
    delete process.env.BIOF3_R_HOME;
    delete process.env.BIOF3_TEMP_DIR;
    delete process.env.BIOF3_DB_PATH;
  }
});