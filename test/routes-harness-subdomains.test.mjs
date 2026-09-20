import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BLOCK-104 P2 — agent-runner-facade 同款家法：harness 子域依赖链模块顶层即
// prepare projects（db.js facade 模块级语句），先隔离临时库并跑生产 migration
// 链再加载；否则缺省打开仓内化石 biof3.db（schema 时代错位）必然 SQLITE_ERROR。
const require = createRequire(import.meta.url);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-harness-subdomains-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'harness-subdomains.db');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.BIOF3_DB_PATH, path.join(__dirname, '../src/migrations'));

/**
 * test/routes-harness-subdomains.test.mjs — PHASE 2.2a contract tests
 *
 * 验证 7 个子域模块 + 1 个主文件 facade：
 *   1. 7 个子域文件能 require 不抛错
 *   2. 每个子域文件暴露 `register(app)` 函数（object with .register key）
 *   3. 主文件 `require('routes/harness')` 仍能加载（callable function）
 *   4. 真实注册 Express app 时，19 个端点路径 + method 全部出现
 *   5. 端点 path 100% 一致（端点契约 0 退化）
 *   6. 主文件行数显著减少（thresholds：≤ 80 行）
 *
 * 这些测试**不**验证 handler 行为—— handler 行为由既有
 * chat-file-references-route.cjs / loop-api-route.test.mjs / loop-iterate-route.test.mjs
 * / harness-workflow-recovery.test.mjs 覆盖。
 * 本文件只验证**拆分契约**。
 */

const SUBDOMAINS = [
  'resources',
  'workflow',
  'repair',
  'scientific-task',
  'context',
  'file-references',
  'loop',
];

// 期望 7 子域中所有 19 端点的 path + method（PHASE 2.2a 下沉目标；与调研报告 §3 一致）
const EXPECTED_ENDPOINTS = [
  // resources 子域（2 端点）
  { subdomain: 'resources', method: 'GET', path: '/api/harness/resource-snapshot' },
  { subdomain: 'resources', method: 'GET', path: '/api/harness/index' },
  // workflow 子域（3 端点）
  { subdomain: 'workflow', method: 'POST', path: '/api/harness/workflow/action/:jobId' },
  { subdomain: 'workflow', method: 'GET', path: '/api/harness/workflow/status/:jobId' },
  { subdomain: 'workflow', method: 'POST', path: '/api/harness/workflow/plan' },
  // repair 子域（1 端点）
  { subdomain: 'repair', method: 'POST', path: '/api/harness/repair' },
  // scientific-task 子域（8 端点）
  { subdomain: 'scientific-task', method: 'POST', path: '/api/harness/scientific-task/plan' },
  { subdomain: 'scientific-task', method: 'POST', path: '/api/harness/scientific-task/confirmation-preview' },
  { subdomain: 'scientific-task', method: 'POST', path: '/api/harness/scientific-task/confirm' },
  { subdomain: 'scientific-task', method: 'GET', path: '/api/harness/scientific-task/:taskId' },
  { subdomain: 'scientific-task', method: 'GET', path: '/api/harness/scientific-task-by-job/:toolJobId' },
  { subdomain: 'scientific-task', method: 'GET', path: '/api/harness/scientific-task-by-job/:toolJobId/script' },
  { subdomain: 'scientific-task', method: 'POST', path: '/api/harness/scientific-task/:taskId/bind-job' },
  { subdomain: 'scientific-task', method: 'POST', path: '/api/harness/scientific-task/:taskId/delivery-manifest' },
  // context 子域（1 端点）
  { subdomain: 'context', method: 'POST', path: '/api/harness/context-checkpoint' },
  // scientific-task (续) / replay 子域（1 端点）
  { subdomain: 'scientific-task', method: 'POST', path: '/api/harness/scientific-task-by-job/:toolJobId/replay-package' },
  // file-references 子域（1 端点）
  { subdomain: 'file-references', method: 'POST', path: '/api/harness/file-references/resolve' },
  // project-storage 子域（BLOCK-78 P2，1 端点）
  { subdomain: 'project-storage', method: 'GET', path: '/api/harness/project-storage' },
  // notices 子域（1+1 端点）
  { subdomain: 'notices', method: 'GET', path: '/api/harness/notices' },
  { subdomain: 'notices', method: 'POST', path: '/api/harness/notices/seen' },
  // loop（HLE-1）子域（3 端点）
  { subdomain: 'loop', method: 'POST', path: '/api/loop/iterate' },
  { subdomain: 'loop', method: 'GET', path: '/api/loop/:loopRunId' },
  { subdomain: 'loop', method: 'POST', path: '/api/loop/snapshot' },
];

/**
 * 构造 fake Express app：仅记录 app.get/post/put/delete 调用，不真正执行 handler。
 */
function makeFakeApp() {
  const entries = [];
  const handler = (method) => (path, ...args) => {
    // For app.get/post/..., args can include handlers. Take the first fn only.
    const fns = args.filter((a) => typeof a === 'function');
    entries.push({ method: method.toUpperCase(), path, handlerCount: fns.length });
  };
  return {
    get: handler('get'),
    post: handler('post'),
    put: handler('put'),
    delete: handler('delete'),
    patch: handler('patch'),
    _entries: entries,
  };
}

test('7 subdomain files are all require()-able and export register()', () => {
  for (const name of SUBDOMAINS) {
    const sub = require(`../core/biof3-server/routes/harness/${name}`);
    assert.equal(typeof sub.register, 'function', `${name}.register must be a function`);
  }
});

test('routes/harness/index.js register() accepts an Express app and runs without error', () => {
  const index = require('../core/biof3-server/routes/harness/index');
  const app = makeFakeApp();
  // register() 内部会调 7 个子域 register，每个子域会调 app.get/post 挂载端点
  assert.doesNotThrow(() => index.register(app), 'index.register(app) should not throw');
  // 端点总数应 === EXPECTED_ENDPOINTS.length（19 端点全部下沉）
  assert.equal(
    app._entries.length,
    EXPECTED_ENDPOINTS.length,
    `index should register exactly ${EXPECTED_ENDPOINTS.length} endpoints, got ${app._entries.length}`,
  );
});

test('routes/harness/index.js register() mounts 19 endpoints with correct method + path', () => {
  const index = require('../core/biof3-server/routes/harness/index');
  const app = makeFakeApp();
  index.register(app);
  // 验证每条 EXPECTED_ENDPOINTS 都被挂载
  for (const expected of EXPECTED_ENDPOINTS) {
    const found = app._entries.find((e) => e.method === expected.method && e.path === expected.path);
    assert.ok(found, `Missing endpoint: ${expected.method} ${expected.path} (subdomain=${expected.subdomain})`);
  }
});

test('main file routes/harness.js still exports a callable register function', () => {
  const main = require('../core/biof3-server/routes/harness');
  assert.equal(typeof main, 'function', 'main export must be a callable register function');
});

test('main file is a thin facade (line count significantly reduced)', () => {
  // 主文件从 1366 行（拆分前 baseline）降至 ≤ 80 行（thin facade）。
  const fs = require('node:fs');
  const path = require('node:path');
  const mainPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'core',
    'biof3-server',
    'routes',
    'harness.js',
  );
  const content = fs.readFileSync(mainPath, 'utf8');
  const lineCount = content.split('\n').length;
  assert.ok(lineCount <= 80, `main file should be ≤ 80 lines (thin facade), got ${lineCount}`);
  // 同时保证它不是空 facade，至少 25 行（含 doc comment + register 包装）
  assert.ok(lineCount >= 25, `main file should be ≥ 25 lines (doc + register), got ${lineCount}`);
});

test('each subdomain file has reasonable line count (≥ 30, ≤ 500)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const subDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'core',
    'biof3-server',
    'routes',
    'harness',
  );
  for (const name of SUBDOMAINS) {
    const subPath = path.join(subDir, `${name}.js`);
    const content = fs.readFileSync(subPath, 'utf8');
    const lineCount = content.split('\n').length;
    assert.ok(lineCount >= 30, `${name}.js should be ≥ 30 lines, got ${lineCount}`);
    assert.ok(lineCount <= 500, `${name}.js should be ≤ 500 lines, got ${lineCount}`);
  }
});

test('routes/harness/index.js exposes _submodules surface with all 7 subdomains', () => {
  const index = require('../core/biof3-server/routes/harness/index');
  assert.ok(index._submodules, '_submodules must exist');
  // Map subdomain name → JS identifier (scientific-task has hyphen → camelCase)
  const NAME_MAP = {
    'resources': 'resources',
    'workflow': 'workflow',
    'repair': 'repair',
    'scientific-task': 'scientificTask',
    'context': 'context',
    'file-references': 'fileReferences',
    'loop': 'loop',
  };
  for (const name of SUBDOMAINS) {
    // Each submodule exports `{ register(app) {...} }`, not a callable function.
    // The test verifies the .register function is callable.
    const sub = index._submodules[NAME_MAP[name]];
    assert.ok(sub && typeof sub.register === 'function', `_submodules.${NAME_MAP[name]}.register must be a function`);
  }
});

test('endpoints match between subdomain register() and main file register() (no path drift)', () => {
  // 分别用 fake app 通过 index.js 和主文件 facade 注册，比较挂载的 endpoints
  const index = require('../core/biof3-server/routes/harness/index');
  const main = require('../core/biof3-server/routes/harness');

  const indexApp = makeFakeApp();
  index.register(indexApp);

  const mainApp = makeFakeApp();
  main(mainApp);

  // index 与 facade 应挂载完全相同的端点
  assert.equal(
    indexApp._entries.length,
    mainApp._entries.length,
    `index and main facade must register the same number of endpoints (got ${indexApp._entries.length} vs ${mainApp._entries.length})`,
  );

  // 排序 + 比较 path + method
  const sortKey = (e) => `${e.method} ${e.path}`;
  const indexSorted = indexApp._entries.map(sortKey).sort();
  const mainSorted = mainApp._entries.map(sortKey).sort();
  assert.deepEqual(indexSorted, mainSorted, 'index and main facade must register identical endpoints');
});

test('_helpers/harness-shared.js and _helpers/workspace-file-index.js are require()-able', () => {
  const harnessShared = require('../core/biof3-server/routes/_helpers/harness-shared');
  const workspaceFileIndex = require('../core/biof3-server/routes/_helpers/workspace-file-index');
  // 关键 helper 存在性
  assert.equal(typeof harnessShared.authorizeAndResolveOptions, 'function', 'authorizeAndResolveOptions must exist');
  assert.equal(typeof harnessShared.canAccessProject, 'function', 'canAccessProject must exist');
  assert.equal(typeof harnessShared.canAccessJob, 'function', 'canAccessJob must exist');
  assert.equal(typeof harnessShared.parseJsonMaybe, 'function', 'parseJsonMaybe must exist');
  assert.equal(typeof harnessShared.loadHarnessModule, 'function', 'loadHarnessModule must exist');
  assert.equal(typeof workspaceFileIndex.buildWorkspaceFileNameIndex, 'function', 'buildWorkspaceFileNameIndex must exist');
  assert.equal(typeof workspaceFileIndex.findUniqueWorkspaceFileByName, 'function', 'findUniqueWorkspaceFileByName must exist');
});
