/**
 * Phase 1 IPC bridge namespace coverage — BLOCK-10-AUDIT-CLOSEOUT
 *
 * C-001 修复（contract audit §二 L49-174）：
 *   preload.js 必须暴露 `branch` namespace，1:1 镜像
 *   frontend/src/lib/electron.d.ts 已声明的方法，才能让 Branch Tab 在渲染端
 *   getBridge('branch') 返回非 null。
 *
 * 测试策略（与 test/window-controls.test.mjs 同样的 vm harness）：
 *   1) 在 vm sandbox 内执行 src/preload.js（mock electron contextBridge + ipcRenderer）
 *   2) 校验 window.petriDesktop.branch.* 的 6 个方法
 *      ↔ ipcRenderer.invoke 调用 channel 一一对应
 *   3) 校验既有 namespace 不被 shadow（C-001 不变量）
 *
 * BLOCK-375（S0）化石清理：`result` namespace 断言删除——fc3dedbd（UI-457 result
 * 卫生批）已全退役 result:* IPC 面（channels/preload namespace/result-handlers/
 * result-db 一并退役），本文件是漏删的守护化石；result 面现由 viewerRegistry/
 * ResultsSurface（BLOCK-334 宿主统一）承载，通道契约由 ipc-channels-registry 守护。
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

  return { desktop: exposed.get('petriDesktop'), invoked };
}

test('preload exposes petriDesktop.branch with 6 methods mapping to branch:* channels', async () => {
  const { desktop, invoked } = runPreload();
  assert.ok(desktop, 'petriDesktop must be exposed');
  assert.ok(desktop.branch, 'C-001: petriDesktop.branch namespace must exist');

  const expected = [
    ['create', 'branch:create'],
    ['list', 'branch:list'],
    ['switch', 'branch:switch'],
    ['delete', 'branch:delete'],
    ['rename', 'branch:rename'],
    ['getActive', 'branch:active'],
  ];
  for (const [method] of expected) {
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

test('preload branch namespace does NOT shadow existing 16 namespaces', () => {
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
  // 新增 namespace（result 已随 fc3dedbd 退役，仅 branch）
  assert.ok(desktop.branch, 'C-001: branch namespace must be added');
});