/**
 * 方向纠正（owner msg_11d6f3f38030）：参照物=页面常驻顶层栏自绘红绿灯（非 mac 系统栏）。
 * HK-01：frame:false 自绘灯在场 + 最大化态隐藏（占位保布局）+ 状态机保留。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const left = read('frontend/src/components/desktop/titlebar/TitleBarLeftZone.tsx');
const win = read('src/main/_window-create.js');
const state = read('src/main/_fullscreen-state.js');

test('HK-01-1：frameless + 自绘红绿灯在场（A案回退）', () => {
  assert.match(win, /frame:\s*false/);
  assert.match(left, /macTrafficBtnClose/);
  assert.match(left, /aria-label="关闭窗口"/);
});

test('HK-01-2：最大化态隐藏自绘灯（占位保布局，不跳位）', () => {
  assert.match(left, /isDesktop\s*&&\s*!win\.isMaximized/);
  assert.match(left, /trafficPlaceholder/);
});

test('HK-01-3：自绘按钮点击语义保留（close/minimize/toggleFullScreen）', () => {
  assert.match(left, /onClick=\{win\.close\}/);
  assert.match(left, /onClick=\{win\.minimize\}/);
  assert.match(left, /onClick=\{win\.toggleFullScreen\}/);
});

test('HK-01-4：状态机修复保留（native/simple 统一，全屏进出不回退）', () => {
  assert.match(state, /nextFullScreenAction/);
  assert.match(win, /enter-full-screen|enter-simple-full-screen/);
});
