/**
 * BLOCK-10-ARCHITECTURE PHASE 1.2 (A-009) — port fallback unified via
 * env-coordinator.getBackendPort().
 *
 * Coverage:
 *   A-009.1 getBackendPort('r') default 3001
 *   A-009.2 getBackendPort('gateway') default 3005
 *   A-009.3 getBackendPort('python') default 3004
 *   A-009.4 getBackendPort('plumber') default 8787
 *   A-009.5 env override (BIOF3_R_PORT=4000 → getBackendPort('r') === 4000)
 *   A-009.6 unknown role throws
 *   A-009.7 getBackendPorts() returns all 4 roles
 *   A-009.8 4 scattered sites no longer carry hardcoded fallback defaults
 *
 * 运行：cd desktop && node --test test/env-coordinator-port.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const { getBackendPort, getBackendPorts } = await import(
  path.join(root, 'src/main/env-coordinator.js')
);

// The 4 env-var keys we own. Save + restore around every test so we
// don't leak state into other suites.
const ENV_KEYS = ['R_SERVER_PORT', 'PY_SERVER_PORT', 'PLUMBER_PORT', 'GATEWAY_PORT'];

function snapshotEnv() {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

test('A-009.1 getBackendPort("r") default 3001', () => {
  const saved = snapshotEnv();
  delete process.env.R_SERVER_PORT;
  assert.strictEqual(getBackendPort('r'), 3001);
  restoreEnv(saved);
});

test('A-009.2 getBackendPort("gateway") default 3005', () => {
  const saved = snapshotEnv();
  delete process.env.GATEWAY_PORT;
  assert.strictEqual(getBackendPort('gateway'), 3005);
  restoreEnv(saved);
});

test('A-009.3 getBackendPort("python") default 3004', () => {
  const saved = snapshotEnv();
  delete process.env.PY_SERVER_PORT;
  assert.strictEqual(getBackendPort('python'), 3004);
  restoreEnv(saved);
});

test('A-009.4 getBackendPort("plumber") default 8787', () => {
  const saved = snapshotEnv();
  delete process.env.PLUMBER_PORT;
  assert.strictEqual(getBackendPort('plumber'), 8787);
  restoreEnv(saved);
});

test('A-009.5 env override beats default', () => {
  const saved = snapshotEnv();
  process.env.R_SERVER_PORT = '4000';
  assert.strictEqual(getBackendPort('r'), 4000);
  // string-coerced numeric env (e.g. "4001") should also round-trip.
  process.env.PY_SERVER_PORT = '4001';
  assert.strictEqual(getBackendPort('python'), 4001);
  restoreEnv(saved);
});

test('A-009.6 unknown role throws', () => {
  assert.throws(() => getBackendPort('not-a-role'), /unknown role/i);
  assert.throws(() => getBackendPort('foo'), /unknown role/i);
  assert.throws(() => getBackendPort(''), /unknown role/i);
});

test('A-009.7 getBackendPorts returns every role', () => {
  const saved = snapshotEnv();
  delete process.env.R_SERVER_PORT;
  delete process.env.PY_SERVER_PORT;
  delete process.env.PLUMBER_PORT;
  delete process.env.GATEWAY_PORT;
  const ports = getBackendPorts();
  assert.deepStrictEqual(ports, {
    r: 3001,
    python: 3004,
    plumber: 8787,
    gateway: 3005,
  });
  restoreEnv(saved);
});

test('A-009.8 4 scattered fallback sites now read from env-coordinator', () => {
  // The 4 files that historically inlined `process.env.X_PORT || <default>`
  // must now delegate to env-coordinator. We assert source-text:
  //   - core/biof3-server/server.js: must contain `getBackendPort('r')`
  //   - core/biof3-server/config.js: must contain `getBackendPort('r')`
  //   - src/preload.js: must contain `getBackendPort('r')` and
  //     `getBackendPort('python')`
  //   - src/backend-health.js: must contain getBackendPort for all 4 roles
  //
  // For "must not contain legacy fallback", we look for the *executable*
  // pattern (`process.env.X_PORT || ` followed by a digit) — not for the
  // number appearing inside comments. Comments that describe the previous
  // behaviour are fine.
  const sites = [
    {
      file: 'core/biof3-server/server.js',
      mustContain: [`getBackendPort('r')`],
      legacyEnvFallbacks: [/process\.env\.R_SERVER_PORT\s*\|\|\s*3003/],
    },
    {
      file: 'core/biof3-server/config.js',
      mustContain: [`getBackendPort('r')`],
      legacyEnvFallbacks: [/process\.env\.R_SERVER_PORT\s*\|\|\s*['"]?3003/],
    },
    {
      file: 'src/preload.js',
      mustContain: [`getBackendPort('r')`, `getBackendPort('python')`],
      legacyEnvFallbacks: [
        /process\.env\.R_SERVER_PORT\s*\|\|\s*3001/,
        /process\.env\.PY_SERVER_PORT\s*\|\|\s*3004/,
      ],
    },
    {
      file: 'src/backend-health.js',
      mustContain: [
        `getBackendPort('r')`,
        `getBackendPort('python')`,
        `getBackendPort('plumber')`,
        `getBackendPort('gateway')`,
      ],
      legacyEnvFallbacks: [
        /process\.env\.R_SERVER_PORT\s*\|\|\s*3001/,
        /process\.env\.PY_SERVER_PORT\s*\|\|\s*3004/,
        /process\.env\.PLUMBER_PORT\s*\|\|\s*8787/,
        /process\.env\.GATEWAY_PORT\s*\|\|\s*3005/,
      ],
    },
  ];

  for (const { file, mustContain, legacyEnvFallbacks } of sites) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const needle of mustContain) {
      assert.ok(
        source.includes(needle),
        `${file} must contain \`${needle}\` after A-009 port unification`,
      );
    }
    for (const re of legacyEnvFallbacks) {
      assert.ok(
        !re.test(source),
        `${file} must no longer carry legacy fallback \`${re}\``,
      );
    }
  }
});