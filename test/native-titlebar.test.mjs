/**
 * owner 裁决 A（msg_812fc13259da）：恢复原生顶栏。
 * HK-01：①native 配置②自绘红绿灯移除③状态机保留④迁移元素功能不丢⑤原生拖拽区。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const win = read('src/main/_window-create.js');
const left = read('frontend/src/components/desktop/titlebar/TitleBarLeftZone.tsx');
const right = read('frontend/src/components/desktop/titlebar/TitleBarRightZone.tsx');
const state = read('src/main/_fullscreen-state.js');

test('HK-01-1：native 窗口配置（frame:true + titleBarStyle 原生）', () => {
  const at = win.indexOf('frame:');
  const block = win.slice(at - 500, at + 120);
  assert.match(block, /frame:\s*true/);
  assert.match(block, /titleBarStyle:/);
  assert.match(block, /native|default/);
});

test('HK-01-2：自绘红绿灯移除（TitleBarLeftZone 不再画窗口控制）', () => {
  assert.doesNotMatch(left, /toggleMinimize|toggleMaximize|window\.close|desktopWindow\?\.close/);
  assert.doesNotMatch(left, /macTrafficBtn|WindowControls/);
});

test('HK-01-3：状态机修复保留（_fullscreen-state.js native/simple 统一）', () => {
  assert.match(state, /nextFullScreenAction/);
  assert.match(state, /mode:\s*'native'/);
  assert.match(win, /fullscreenable:\s*true/);
});

test('HK-01-4：迁移元素功能不丢（铃铛/更新/工具菜单/审阅徽章仍在）', () => {
  assert.match(right, /NotificationCenterBell/);
  assert.match(right, /UpdatePill/);
  assert.match(right, /toolMenuItems/);
  assert.match(right, /review-tab-count|reviewCount/);
  // 非 mac 自绘窗口控件也必须移除（native 标题栏接管）
  assert.doesNotMatch(right, /<WindowControls/);
});
