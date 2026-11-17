/**
 * UI-421 加映（用户裁决 2026-11-17「--onscreen 控制要按 Ctrl+Alt+Shift+M 太麻烦，
 * 换成一个可以解锁的按钮，点击即可」）——测试实例管理模式**一键解锁按钮**。
 *
 * 契约：
 *  1) channels/preload 双通道：window:test-manage-toggle（点击解锁/锁定）+
 *     window:test-manage-hover（锁定态徽标条 hover 窥视——点击穿透窗口里按钮
 *     要能被点到，须 hover 时临时转交互；离开回锁）；
 *  2) 主进程：锁定态 setIgnoreMouseEvents 带 forward:true（悬停事件仍达页面，
 *     徽标条 mouseenter 才能触发窥视）；unlock 稳态不带 forward；hover 窥视不改
 *     manageMode（离开未解锁即回锁）；
 *  3) 徽标条锁定态渲染「解锁」按钮（点击调 toggle）；解锁态渲染「锁定」按钮；
 *     快捷键保留不撤（双入口并存）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('通道注册：window.testManageToggle/testManageHover 在 channels 唯一注册表', () => {
  const channels = require('../src/ipc/channels.js');
  assert.equal(channels.window.testManageToggle, 'window:test-manage-toggle');
  assert.equal(channels.window.testManageHover, 'window:test-manage-hover');
});

test('preload 暴露 testManageToggle/testManageHover 两个 send 包装（与 channels 同源）', () => {
  const src = read('src/preload.js');
  assert.match(src, /testManageToggle: \(\) => ipcRenderer\.send\('window:test-manage-toggle'\)/);
  assert.match(src, /testManageHover: \(active\) => ipcRenderer\.send\('window:test-manage-hover', active === true\)/);
});

test('主进程：锁定态 forward:true（悬停达页）+ toggle/hover 双 handler + hover 窥视不改稳态', () => {
  const src = read('src/main/_window-ipc.js');
  // 锁定态带 forward:true（悬停事件必须能到徽标条，否则按钮永远点不到）
  assert.match(src, /setIgnoreMouseEvents\(!manageMode, \{ forward: true \}\)/, '锁定态须 forward:true');
  // 双 handler 注册
  assert.match(src, /ipcMain\.on\(CHANNELS\.window\.testManageToggle/, 'toggle handler 必须注册');
  assert.match(src, /ipcMain\.on\(CHANNELS\.window\.testManageHover/, 'hover handler 必须注册');
  // hover 窥视：manageMode 未解锁时 active=true → 临时全交互（setIgnoreMouseEvents(false)），
  // active=false → 回锁 forward:true；窥视不改 manageMode 稳态（守卫先行）。
  assert.match(src, /if \(manageMode\) return;[\s\S]{0,160}setIgnoreMouseEvents\(active !== true, \{ forward: !active \}\)/, 'hover 窥视=守卫在先的临时交互/回锁');
});

test('徽标组件：锁定态渲染「解锁」按钮、解锁态渲染「锁定」按钮、快捷键文案保留', () => {
  const src = read('frontend/src/components/desktop/TestInstanceBadge.tsx');
  assert.match(src, /onMouseEnter=\{manageMode \? undefined : \(\) => void peekHover\(true\)\}/, '锁定态 hover 触发窥视（解锁态不触发）');
  assert.match(src, /onMouseLeave=\{manageMode \? undefined : \(\) => void peekHover\(false\)\}/, '离开徽标条回锁（解锁态不触发）');
  assert.match(src, /解锁/, '解锁按钮文案');
  assert.match(src, /锁定/, '锁定按钮文案');
  assert.match(src, /testManageToggle/, '点击调 toggle 通道');
  assert.match(src, manageShortcutEscape, '快捷键文案保留（双入口并存）');
});

const manageShortcutEscape = /manageShortcut/;
