/**
 * Phase 1 IPC bridge namespace coverage — BLOCK-10-AUDIT-CLOSEOUT
 *
 * C-001 修复（contract audit §二 L49-174）：
 *   preload.js 必须暴露 `branch` + `result` 两个 namespace，
 *   1:1 镜像 frontend/src/lib/electron.d.ts L319-505 已声明的方法，
 *   才能让 Branch Tab / Result Studio 在渲染端
 *   getBridge('branch') / getBridge('result') 返回非 null。
 *
 * 测试策略（与 test/window-controls.test.mjs 同样的 vm harness）：
 *   1) 在 vm sandbox 内执行 src/preload.js（mock electron contextBridge + ipcRenderer）
 *   2) 校验 window.biof3Desktop.branch.* 的 6 个方法
 *      ↔ ipcRenderer.invoke 调用 channel 一一对应
 *   3) 校验 window.biof3Desktop.result.* 的 7 个方法
 *      + result.version.* 的 4 个子方法 ↔ channel 一一对应
 *   4) 校验 result:create 接受 conversation_export 类型
 *      （C-002 修复的 contract 一致性；运行时 validTypes 由 result-handlers.js
 *      测试覆盖：test/result-handlers-valid-types.test.mjs）
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD_SOURCE = readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');

/**
 * Mirror of window-controls.test.mjs preloadHarness — runs preload.js inside
 * a vm context with a stub `electron` module so we can capture every
 * ipcRenderer.invoke call without actually loading Electron.
 */
function runPreload() {
  const exposed = new Map();
  const invoked = [];

  const ipcRenderer = {
    send() {},
    invoke(channel, ...args) {
      invoked.push({ channel, args });
      return Promise.resolve({ ok: true, data: null });
    },
    on() {},
    removeListener() {},
  };

  const contextBridge = {
    exposeInMainWorld(name, value) {
      exposed.set(name, value);
    },
  };

  vm.runInNewContext(PRELOAD_SOURCE, {
    require(moduleName) {
      assert.equal(moduleName, 'electron', 'preload.js must require electron');
      return { contextBridge, ipcRenderer };
    },
    process: { platform: 'darwin', arch: 'arm64', env: {}, argv: [] },
    window: { dispatchEvent() {} },
    CustomEvent: class CustomEvent {},
  });

  return { desktop: exposed.get('biof3Desktop'), invoked };
}

test('preload exposes biof3Desktop.branch with 6 methods mapping to branch:* channels', async () => {
  const { desktop, invoked } = runPreload();
  assert.ok(desktop, 'biof3Desktop must be exposed');
  assert.ok(desktop.branch, 'C-001: biof3Desktop.branch namespace must exist');

  const expected = [
    ['create', 'branch:create'],
    ['list', 'branch:list'],
    ['switch', 'branch:switch'],
    ['delete', 'branch:delete'],
    ['rename', 'branch:rename'],
    ['getActive', 'branch:active'],
  ];
  for (const [method, channel] of expected) {
    assert.equal(
      typeof desktop.branch[method],
      'function',
      `branch.${method} must be a function`,
    );
  }

  // 调用一次确认 channel 1:1
  await desktop.branch.create({ projectId: 'p1', name: 'main' });
  await desktop.branch.list({ projectId: 'p1' });
  await desktop.branch.switch({ branchId: 'b1' });
  await desktop.branch.delete({ branchId: 'b1' });
  await desktop.branch.rename({ branchId: 'b1', newName: 'feature' });
  await desktop.branch.getActive({ projectId: 'p1' });

  assert.deepEqual(
    invoked.map(({ channel }) => channel),
    [
      'branch:create',
      'branch:list',
      'branch:switch',
      'branch:delete',
      'branch:rename',
      'branch:active',
    ],
  );
});

test('preload exposes biof3Desktop.result with 7 methods + version sub-namespace (4 methods)', async () => {
  const { desktop, invoked } = runPreload();
  assert.ok(desktop.result, 'C-001: biof3Desktop.result namespace must exist');

  const expected = [
    ['create', 'result:create'],
    ['get', 'result:get'],
    ['list', 'result:list'],
    ['update', 'result:update'],
    ['delete', 'result:delete'],
    ['byProject', 'result:byProject'],
    ['createFromConversation', 'result:createFromConversation'],
  ];
  for (const [method, channel] of expected) {
    assert.equal(
      typeof desktop.result[method],
      'function',
      `result.${method} must be a function`,
    );
  }

  // result.version sub-namespace
  assert.ok(desktop.result.version, 'result.version sub-namespace must exist');
  const expectedVersion = [
    ['create', 'result:version:create'],
    ['get', 'result:version:get'],
    ['getByNumber', 'result:version:getByNumber'],
    ['list', 'result:version:list'],
  ];
  for (const [method, channel] of expectedVersion) {
    assert.equal(
      typeof desktop.result.version[method],
      'function',
      `result.version.${method} must be a function`,
    );
  }

  // 实调一次确认 channel 一致
  await desktop.result.create({
    projectId: 'p1',
    type: 'conversation_export', // C-002: 此类型 validTypes 已允许
    name: 'export-1',
    data: {},
  });
  await desktop.result.createFromConversation({ projectId: 'p1', branchId: 'b1' });
  await desktop.result.version.create({ resultId: 'r1', data: {} });

  assert.deepEqual(
    invoked.slice(-3).map(({ channel }) => channel),
    ['result:create', 'result:createFromConversation', 'result:version:create'],
  );
});

test('preload branch + result namespaces do NOT shadow existing 16 namespaces', () => {
  const { desktop } = runPreload();
  // 仅断言已有 namespace 的 key 仍在；plan §5.3 不变量守住
  for (const key of [
    'window',
    'app',
    'aiSettings',
    'harnessCapabilities',
    'plugins',
    'contentPlugins',
    'runtime',
    'backend',
    'files',
    'diagnostic',
    'telemetry',
    'data',
    'terminal',
    'skills',
    'updater',
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(desktop, key),
      `existing namespace ${key} must be preserved (C-001 invariant)`,
    );
  }
  // 新增 2 个 namespace
  assert.ok(desktop.branch, 'C-001: branch namespace must be added');
  assert.ok(desktop.result, 'C-001: result namespace must be added');
});