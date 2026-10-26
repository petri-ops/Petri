import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// BLOCK-264（C-38）— PiP 主进程模块契约（Electron 壳不可在此加载，故只测纯函数面：
// frameForRenderer 的形状与 interval 常量；窗口面留给实机）。
// electron mock：BrowserWindow 构造即记调用（不真开窗）

const pipPath = require.resolve('../src/main/computer-use-pip.js');
const Module = require('node:module');
const created = [];
const electronMock = { BrowserWindow: class { constructor(opts) { created.push(opts); } show() {} focus() {} loadFile() {} on() {} isDestroyed() { return false; } close() {} } };
const origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.apply(this, [request, parent, isMain]);
};
let pip;
try {
  pip = require(pipPath);
} finally {
  Module._load = origLoad;
}

test('BLOCK-264 PiP — 初始帧形状（no_frame_yet + interval 常量）', () => {
  const frame = pip.frameForRenderer();
  assert.equal(frame.pngBase64, null);
  assert.equal(frame.error, 'no_frame_yet');
  assert.equal(frame.intervalMs, pip._internals.FRAME_INTERVAL_MS);
  assert.equal(pip._internals.FRAME_INTERVAL_MS, 1500);
});

test('BLOCK-264 PiP — 初始未开窗（isPipOpen false）', () => {
  assert.equal(pip.isPipOpen(), false);
});

test('BLOCK-264 PiP — IPC 注册四个通道 handler', () => {
  const handlers = {};
  const ipcMainMock = { handle: (ch, fn) => { handlers[ch] = fn; } };
  pip.registerComputerUsePipIpc(ipcMainMock);
  for (const ch of ['computer-use:pip-open', 'computer-use:pip-close', 'computer-use:pip-frame', 'computer-use:pip-status']) {
    assert.equal(typeof handlers[ch], 'function', `${ch} 应注册`);
  }
  // 关窗态拉帧拒绝（关窗即停采集——不后台截屏）
  return handlers['computer-use:pip-frame']().then((res) => {
    assert.equal(res.ok, false);
    assert.equal(res.error, 'pip_not_open');
  });
});
