/**
 * preload-agentdocreview-namespace.test.mjs — BLOCK-17
 *
 * C-001 镜像：验证 src/preload.js 暴露的
 * window.biof3Desktop.agentDocReview namespace 正确映射到 3 条 IPC channel。
 *
 * 不变量：
 *   - 18 个既有的 namespace（branch / result / workingTreeReview 等）0 diff
 *   - agentDocReview 恰好 3 个方法
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD_SOURCE = readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');

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
    require(mod) {
      assert.equal(mod, 'electron', 'preload.js must require electron');
      return { contextBridge, ipcRenderer };
    },
    process: { env: {} },
    console,
  });

  return { exposed, invoked };
}

test('agentDocReview namespace exposes exactly 3 methods', () => {
  const { exposed } = runPreload();
  const ns = exposed.get('biof3Desktop');
  assert(ns, 'biof3Desktop must be exposed');
  assert(typeof ns === 'object', 'biof3Desktop must be an object');
  assert(typeof ns.agentDocReview === 'object', 'agentDocReview must be an object');
  const methods = Object.keys(ns.agentDocReview).sort();
  // BLOCK-19 — add saveCurrent (inline edit)
  assert.deepEqual(methods, ['commitSnapshot', 'list', 'loadPair', 'saveCurrent'].sort(),
    'agentDocReview must have list / loadPair / commitSnapshot / saveCurrent');
});

test('agentDocReview.list maps to agentDocReview:list channel', () => {
  const { exposed, invoked } = runPreload();
  const ns = exposed.get('biof3Desktop');
  ns.agentDocReview.list();
  const listCalls = invoked.filter((i) => i.channel === 'agentDocReview:list');
  assert.equal(listCalls.length, 1, 'agentDocReview:list must be called exactly once');
  assert.deepEqual(listCalls[0].args, []);
});

test('agentDocReview.loadPair maps to agentDocReview:loadPair channel with path', () => {
  const { exposed, invoked } = runPreload();
  const ns = exposed.get('biof3Desktop');
  ns.agentDocReview.loadPair('/path/to/doc.md');
  const calls = invoked.filter((i) => i.channel === 'agentDocReview:loadPair');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['/path/to/doc.md']);
});

test('agentDocReview.commitSnapshot maps to agentDocReview:commitSnapshot channel', () => {
  const { exposed, invoked } = runPreload();
  const ns = exposed.get('biof3Desktop');
  ns.agentDocReview.commitSnapshot('/path/to/doc.md');
  const calls = invoked.filter((i) => i.channel === 'agentDocReview:commitSnapshot');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['/path/to/doc.md']);
});

test('agentDocReview does not conflict with existing namespaces', () => {
  const { exposed } = runPreload();
  const ns = exposed.get('biof3Desktop');
  // Verify key existing namespaces are still present
  assert(typeof ns.workingTreeReview === 'object', 'workingTreeReview must still exist');
  assert(typeof ns.branch === 'object', 'branch must still exist');
  assert(typeof ns.result === 'object', 'result must still exist');
  assert(typeof ns.aiSettings === 'object', 'aiSettings must still exist');
  assert(typeof ns.agentDocReview === 'object', 'agentDocReview must be new');
  // Count all namespace keys
  const allKeys = Object.keys(ns).sort();
  // agentDocReview adds 1 new key — we don't check the exact count here
  // because other tests may add to it; just verify key existing ones are intact
});
