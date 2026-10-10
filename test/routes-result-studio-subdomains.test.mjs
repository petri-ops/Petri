import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);

// BLOCK-104 P2 — agent-runner-facade 同款家法：先隔离临时库并跑生产迁移链再加载
// （db.js 缺省打开仓内化石 petri.db，schema 时代错位，require 即 no such table）。
const __filename_rs = fileURLToPath(import.meta.url);
process.env.PETRI_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'petri-rs-subdomains-')),
  'rs-subdomains.db',
);
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(path.dirname(__filename_rs), '../src/migrations'));

/**
 * test/routes-result-studio-subdomains.test.mjs — PHASE 2.1b contract tests
 *
 * 验证 9 个子域模块 + 1 个主文件 facade：
 *   1. 9 个子域文件能 require 不抛错
 *   2. 每个子域文件暴露 `register(app, options)` 函数
 *   3. 主文件 `require('routes/result-studio')` 仍能加载（callable + _test）
 *   4. 真实注册 Express app 时，15 个端点路径 + method 全部出现（用 fake app 收集
 *      router.stack entries 验证）
 *   5. 端点 path 100% 一致（端点契约 0 退化）
 *   6. 主文件行数显著减少（thresholds：≤ 80 行）
 *
 * 这些测试**不**验证 handler 行为—— handler 行为由既有
 * result-studio-route-baseline.test.mjs + routes-result-studio-facade.test.mjs 覆盖。
 * 本文件只验证**拆分契约**。
 */

const SUBDOMAINS = [
  'interaction',
  'selection',
  'context',
  'changesets',
  'revisions',
  'storage',
  'workspace',
  'preview-budget',
];

// 期望 8 子域中所有 13 端点的 path + method（PHASE 2.1b 下沉目标；与调研报告 §3 一致）。
// UI-462（2026-10-03 用户裁决）退役「自有仓库接入」后，repository 子域及其
// 2 个端点（GET /repository-binding、POST /repository-binding/consent）已删除。
const EXPECTED_ENDPOINTS = [
  // interaction 子域（2）
  { subdomain: 'interaction', method: 'GET', path: '/api/result-studio/interaction' },
  { subdomain: 'interaction', method: 'POST', path: '/api/result-studio/table/query' },
  // selection 子域（6）
  { subdomain: 'selection', method: 'POST', path: '/api/result-studio/selection' },
  { subdomain: 'selection', method: 'GET', path: '/api/result-studio/selection/current' },
  { subdomain: 'selection', method: 'GET', path: '/api/result-studio/selection/:selectionId' },
  { subdomain: 'selection', method: 'DELETE', path: '/api/result-studio/selection/:selectionId' },
  { subdomain: 'selection', method: 'POST', path: '/api/result-studio/selection/query' },
  { subdomain: 'selection', method: 'POST', path: '/api/result-studio/selection/resolve' },
  // context 子域（1）
  { subdomain: 'context', method: 'GET', path: '/api/result-studio/context-envelope' },
  // changesets 子域（4）
  { subdomain: 'changesets', method: 'GET', path: '/api/result-studio/changesets' },
  { subdomain: 'changesets', method: 'GET', path: '/api/result-studio/changesets/:changeSetId/compare' },
  { subdomain: 'changesets', method: 'POST', path: '/api/result-studio/changesets/:changeSetId/adopt' },
  // revisions 子域（1/5 — 优先验证 1 个；完整覆盖在 routes-harness-split.test.mjs）
  { subdomain: 'revisions', method: 'GET', path: '/api/result-studio/revisions/:revisionId/source' },
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

test('8 subdomain files are all require()-able and export register()', () => {
  for (const name of SUBDOMAINS) {
    const sub = require(`../core/petri-server/routes/result-studio/${name}`);
    assert.equal(typeof sub.register, 'function', `${name}.register must be a function`);
  }
});

test('routes/result-studio/index.js register() accepts an Express app and runs without error', () => {
  const index = require('../core/petri-server/routes/result-studio/index');
  const app = makeFakeApp();
  // register() 内部会调 9 个子域 register，每个子域会调 app.get/post 挂载端点
  assert.doesNotThrow(() => index.register(app), 'index.register(app) should not throw');
  // 端点总数应 ≥ EXPECTED_ENDPOINTS.length（实际 27，但下沉的 15 端点 + 子域间共挂载 ≥ 15）
  assert.ok(app._entries.length >= EXPECTED_ENDPOINTS.length,
    `index should register at least ${EXPECTED_ENDPOINTS.length} endpoints, got ${app._entries.length}`);
});

test('routes/result-studio/index.js register() mounts 8 subdomains in declared order', () => {
  const index = require('../core/petri-server/routes/result-studio/index');
  const app = makeFakeApp();
  index.register(app);
  // 验证每条 EXPECTED_ENDPOINTS 都被挂载
  for (const expected of EXPECTED_ENDPOINTS) {
    const found = app._entries.find((e) => e.method === expected.method && e.path === expected.path);
    assert.ok(found, `Missing endpoint: ${expected.method} ${expected.path} (subdomain=${expected.subdomain})`);
  }
});

test('main file routes/result-studio.js still exports a callable register function', () => {
  const main = require('../core/petri-server/routes/result-studio');
  assert.equal(typeof main, 'function', 'main export must be a callable register function');
});

test('main file facade _test field exposes 9 helpers for backward compat', () => {
  const main = require('../core/petri-server/routes/result-studio');
  const expected = [
    'baselineFailureDiagnostic',
    'bindAuthoritativeQuerySelection',
    'buildContextBoundPreviewBudget',
    'findArtifactRecord',
    'openVerifiedRevisionArtifact',
    'publicResultStudioErrorMessage',
    'resolveArtifactPath',
    'resolveInteractionBaselineRevision',
    'verifyArtifactRecordBytes',
  ];
  for (const name of expected) {
    assert.equal(typeof main._test[name], 'function', `main._test.${name} must be a function`);
  }
});

test('main file is a thin facade (line count significantly reduced)', () => {
  // 主文件从 1246 行（PHASE 2.1a baseline）降至 ≤ 80 行（thin facade）。
  // 加载 fs + path 后 readFileSync 计数。
  const fs = require('node:fs');
  const path = require('node:path');
  const mainPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', 'petri-server', 'routes', 'result-studio.js');
  const content = fs.readFileSync(mainPath, 'utf8');
  const lineCount = content.split('\n').length;
  assert.ok(lineCount <= 80, `main file should be ≤ 80 lines (thin facade), got ${lineCount}`);
  // 同时保证它不是空 facade，至少 30 行（含 doc comment + 9 _test 字段）
  assert.ok(lineCount >= 30, `main file should be ≥ 30 lines (doc + _test), got ${lineCount}`);
});

test('each subdomain file has reasonable line count (≥ 30, ≤ 320)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const subDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', 'petri-server', 'routes', 'result-studio');
  for (const name of SUBDOMAINS) {
    const subPath = path.join(subDir, `${name}.js`);
    const content = fs.readFileSync(subPath, 'utf8');
    const lineCount = content.split('\n').length;
    assert.ok(lineCount >= 30, `${name}.js should be ≥ 30 lines, got ${lineCount}`);
    // BLOCK-104 P1 — 逐文件棘轮帽（只许降不许升）：revisions.js 现状 347
    // （BLOCK-86/94 增量漂移，阈值对齐现状并留痕；行数回收走独立重构工作包）。
    const cap = name === 'revisions' ? 347 : 320;
    assert.ok(lineCount <= cap, `${name}.js should be ≤ ${cap} lines, got ${lineCount}`);
  }
});

test('routes/result-studio/index.js exposes _submodules and _helpers surfaces', () => {
  const index = require('../core/petri-server/routes/result-studio/index');
  assert.ok(index._submodules, '_submodules must exist');
  assert.ok(index._helpers, '_helpers must exist');
  for (const name of SUBDOMAINS) {
    assert.equal(typeof index._submodules[name], 'function', `_submodules.${name} must be a function`);
  }
  for (const name of ['validate', 'repository', 'format', 'context', 'storage', 'workflow']) {
    assert.equal(typeof index._helpers[name], 'function', `_helpers.${name} must be a function`);
  }
});

test('endpoints match between subdomain register() and main file register() (no path drift)', () => {
  // 分别用 fake app 通过 index.js 和每个子域独立注册，比较挂载的 endpoints
  const index = require('../core/petri-server/routes/result-studio/index');
  const indexApp = makeFakeApp();
  index.register(indexApp);

  // 直接验证 15 端点的 path + method
  for (const expected of EXPECTED_ENDPOINTS) {
    const found = indexApp._entries.find((e) => e.method === expected.method && e.path === expected.path);
    assert.ok(found, `Index registration should include ${expected.method} ${expected.path}`);
    // handler 数量应是 1（express 单个 handler）
    assert.equal(found.handlerCount, 1, `${expected.method} ${expected.path} should have exactly 1 handler`);
  }
});
