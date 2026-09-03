'use strict';

/**
 * BLOCK-51 回归测试 — mainWindow 兼容对象形态契约。
 *
 * 背景：src/main.js 的 mainWindow 兼容别名对象的 `isDestroyed` 原为 getter
 * （求值返回 boolean），而 terminal.js L45 / skills-window.js L13 /
 * working-tree-review.js L858 等全部按 Electron BrowserWindow 的方法形式调用
 * `isDestroyed()` → "mainWindow.isDestroyed is not a function"（终端场景在
 * pty onData 异步回调中无 catch → 主进程 Uncaught Exception）。
 *
 * 本测试锁定两件事：
 *  1. 静态契约：main.js 兼容对象定义中 isDestroyed/isMinimized/isFocused
 *     必须是方法（`name()`），不得回退为 `get name`。
 *  2. 行为契约：方法形态的兼容对象在下游消费方（_sender-guard /
 *     _resolveSkillsIpcWindow）下按方法调用正常工作。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAIN_JS = path.join(__dirname, '..', 'src', 'main.js');

// ── 1. 静态形态契约（防 main.js 回退为 getter）─────────────────

test('main.js 兼容对象：isDestroyed 必须是方法（不得为 getter）', () => {
  const source = fs.readFileSync(MAIN_JS, 'utf8');
  const defLine = source.split('\n').find((l) => l.includes('const mainWindow = {'));
  assert.ok(defLine, 'main.js 必须仍定义 mainWindow 兼容别名对象');
  assert.match(defLine, /\bisDestroyed\(\)\s*\{/, 'isDestroyed 须为方法形态');
  assert.doesNotMatch(defLine, /get\s+isDestroyed\b/, 'isDestroyed 不得回退为 getter');
});

test('main.js 兼容对象：isMinimized / isFocused 必须是方法', () => {
  const source = fs.readFileSync(MAIN_JS, 'utf8');
  const defLine = source.split('\n').find((l) => l.includes('const mainWindow = {'));
  assert.match(defLine, /\bisMinimized\(\)\s*\{/);
  assert.match(defLine, /\bisFocused\(\)\s*\{/);
  assert.doesNotMatch(defLine, /get\s+isMinimized\b|get\s+isFocused\b/);
});

// ── 2. 行为契约（下游消费方按方法调用）─────────────────────────

// 与 main.js 修复后同款的兼容对象形态（不含 webContents 语义，仅形态）。
function buildCompatWindow(underlying) {
  return {
    isDestroyed() { return underlying == null || underlying.isDestroyed(); },
    get webContents() { return underlying?.webContents; },
    isMinimized() { return underlying?.isMinimized(); },
  };
}

test('兼容对象 isDestroyed() 方法调用形态与真窗口一致', () => {
  const alive = { isDestroyed: () => false, webContents: { id: 1 }, isMinimized: () => false };
  const dead = { isDestroyed: () => true, webContents: null, isMinimized: () => false };
  assert.equal(buildCompatWindow(alive).isDestroyed(), false);
  assert.equal(buildCompatWindow(dead).isDestroyed(), true);
  assert.equal(buildCompatWindow(null).isDestroyed(), true); // _mainWindow 未建
});

test('_sender-guard 在兼容对象（方法形态）下正常判定', () => {
  const { createSenderGuard } = require('../src/ipc/_sender-guard');
  const webContents = { isDestroyed: () => false, id: 7 };
  const underlying = { isDestroyed: () => false, webContents };
  const compat = buildCompatWindow(underlying);
  const guard = createSenderGuard(compat);
  assert.equal(guard({ sender: webContents }), null, '主窗口 sender 应通过');
  const rejected = guard({ sender: { isDestroyed: () => false, id: 99 } });
  assert.equal(rejected && rejected.ok, false, '外来 sender 应拒绝');
});

test('_resolveSkillsIpcWindow 在兼容对象 thunk 下正常解析', () => {
  const { _resolveSkillsIpcWindow } = require('../src/ipc/skills-window');
  const webContents = { id: 5 };
  const compat = buildCompatWindow({ isDestroyed: () => false, webContents });
  const resolved = _resolveSkillsIpcWindow(() => compat, { sender: webContents });
  assert.equal(resolved, compat, '受信 sender 应解析回窗口');
  const rejected = _resolveSkillsIpcWindow(() => compat, { sender: { id: 6 } });
  assert.equal(rejected, null, '非受信 sender 应返回 null');
});
