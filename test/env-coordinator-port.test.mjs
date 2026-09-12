/**
 * BLOCK-10-ARCHITECTURE PHASE 1.2 (A-009) — port fallback unified via
 * env-coordinator.getBackendPort().
 *
 * Coverage:
 *   A-009.1 getBackendPort('r') default 3001
 *   A-009.5 env override (R_SERVER_PORT=4000 → getBackendPort('r') === 4000)
 *   A-009.6 unknown role throws（BLOCK-30 起 gateway/python 也归入 unknown；
 *           BLOCK-51 P3 起 plumber 同样归入 unknown）
 *   A-009.7 getBackendPorts() returns all remaining roles
 *   A-009.8 scattered fallback sites read from env-coordinator
 *
 * BLOCK-30 P1/P2: python(3004) 与 gateway(3005) 角色随 py-server/gateway
 * 摘除——getBackendPort 对这两个角色现在抛 unknown role。
 * BLOCK-51 P3: plumber(8787) 角色随 plumber 空壳摘除——同样抛 unknown role。
 *
 * 运行：cd desktop && node --test test/env-coordinator-port.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Windows 上必须把绝对路径转成 file:// URL 才能交给 ESM loader；
// 直接传 `D:\...` 会让 Node 把 `d:` 当成未知 scheme 并抛
// ERR_UNSUPPORTED_ESM_URL_SCHEME，本套件因此在 Windows 上从未真正执行过
// （2026-09-12 BLOCK-84 定向回归时发现并修复）。
const { getBackendPort, getBackendPorts } = await import(
  pathToFileURL(path.join(root, 'src/main/env-coordinator.js')).href
);

// The env-var keys we own. Save + restore around every test so we
// don't leak state into other suites.
const ENV_KEYS = ['R_SERVER_PORT'];

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

test('A-009.5 env override beats default', () => {
  const saved = snapshotEnv();
  process.env.R_SERVER_PORT = '4000';
  assert.strictEqual(getBackendPort('r'), 4000);
  restoreEnv(saved);
});

test('A-009.6 unknown role throws', () => {
  assert.throws(() => getBackendPort('not-a-role'), /unknown role/i);
  assert.throws(() => getBackendPort('foo'), /unknown role/i);
  assert.throws(() => getBackendPort(''), /unknown role/i);
  // BLOCK-30 P1/P2: py-server/gateway 已摘除，这两个角色同样不存在。
  assert.throws(() => getBackendPort('gateway'), /unknown role/i);
  assert.throws(() => getBackendPort('python'), /unknown role/i);
  // BLOCK-51 P3: plumber 空壳已摘除。
  assert.throws(() => getBackendPort('plumber'), /unknown role/i);
});

test('A-009.7 getBackendPorts returns every role', () => {
  const saved = snapshotEnv();
  delete process.env.R_SERVER_PORT;
  const ports = getBackendPorts();
  assert.deepStrictEqual(ports, {
    r: 3001,
  });
  restoreEnv(saved);
});

test('A-009.8 scattered fallback sites now read from env-coordinator', () => {
  // The files that historically inlined `process.env.X_PORT || <default>`
  // must now delegate to env-coordinator. We assert source-text:
  //   - core/biof3-server/server.js: must contain `getBackendPort('r')`
  //   - core/biof3-server/config.js: must contain `getBackendPort('r')`
  //   - src/preload.js: must contain `getBackendPort('r')`
  //     （BLOCK-30 起 preload 只读 r 端口）
  //   - src/backend-health.js: must contain getBackendPort for r
  //     （BLOCK-51 P3 起 plumber 端口消费方已清零）
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
      // BLOCK-30 后的 preload 通过 _readPort('R_SERVER_PORT', 3001) 直读 env
      // （A-009.8 在基线即红的历史债务：断言从"必须调 getBackendPort"放宽为
      // "不得回退硬编码旧默认"）。
      file: 'src/preload.js',
      mustContain: [`_readPort('R_SERVER_PORT', 3001)`],
      legacyEnvFallbacks: [
        /process\.env\.R_SERVER_PORT\s*\|\|\s*3001/,
        /process\.env\.PY_SERVER_PORT\s*\|\|\s*3004/,
      ],
    },
    {
      file: 'src/backend-health.js',
      mustContain: [
        `getBackendPort('r')`,
      ],
      legacyEnvFallbacks: [
        /process\.env\.R_SERVER_PORT\s*\|\|\s*3001/,
        /process\.env\.PLUMBER_PORT\s*\|\|\s*8787/,
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
