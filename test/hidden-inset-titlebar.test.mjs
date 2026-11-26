/**
 * 顶栏精修（owner msg_681c8e528751）：hiddenInset 融合式深色标题栏。
 * HK-01：hiddenInset+trafficLightPosition（Orca 技法）+ app header 融合布局+drag+状态机保留。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const win = read('src/main/_window-create.js');
const header = read('frontend/src/components/desktop/titlebar/ColumnizedTitleBar.tsx');
const css = read('frontend/src/components/desktop/titlebar/ColumnizedTitleBar.module.css');
const state = read('src/main/_fullscreen-state.js');

test('HK-01-1：darwin hiddenInset + trafficLightPosition（保留原生红绿灯）', () => {
  assert.match(win, /titleBarStyle:\s*process\.platform === ['"]darwin['"]\s*\?\s*['"]hiddenInset['"]/);
  assert.match(win, /trafficLightPosition:\s*\{\s*x:\s*\d+,\s*y:\s*\d+/);
});

test('HK-01-2：app 顶栏融合布局——左栏 header 给红绿灯留位（isMac class）', () => {
  assert.match(header, /macTitlebar/);
  assert.match(css, /\.macTitlebar/);
  const pad = css.match(/padding-left:\s*(\d+)px/);
  assert.ok(pad && Number(pad[1]) >= 90, '左栏 header 应给红绿灯留≥90px');
});

test('HK-01-3：app header 可拖拽空白区保留（融合后拖窗）', () => {
  assert.match(css, /-webkit-app-region:\s*drag/);
});

test('HK-01-4：状态机保留（native 全屏仍统一处理）', () => {
  assert.match(state, /nextFullScreenAction/);
  assert.match(win, /fullscreenable:\s*true/);
});
