/**
 * 试用反馈④（阻断级）HK-01：全屏后无法缩小——native(Ctrl+Cmd+F) 与 simple(自绘红绿灯)
 * 两套全屏状态机混用导致 toggle 失效。决策函数必须同时识别两种全屏并统一退出。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextFullScreenAction,
  isEffectivelyFullScreen,
} from '../src/main/_fullscreen-state.js';

test('HK-01-1：非全屏 → 进入 simple 全屏（frameless Mac 体验）', () => {
  assert.deepEqual(nextFullScreenAction({ native: false, simple: false }, 'darwin'), { mode: 'simple', value: true });
  assert.deepEqual(nextFullScreenAction({ native: false, simple: false }, 'win32'), { mode: 'native', value: true });
});

test('HK-01-2：simple 全屏（红绿灯进入）→ 退出 simple', () => {
  assert.deepEqual(nextFullScreenAction({ native: false, simple: true }, 'darwin'), { mode: 'simple', value: false });
});

test('HK-01-3：native 全屏（Ctrl+Cmd+F 进入）→ 退出 native（不再误切 simple）', () => {
  assert.deepEqual(nextFullScreenAction({ native: true, simple: false }, 'darwin'), { mode: 'native', value: false });
});

test('HK-01-4：双重全屏（native+simple 都被置位）→ 先清 native 再清 simple（回归阻断态）', () => {
  assert.deepEqual(nextFullScreenAction({ native: true, simple: true }, 'darwin'), { mode: 'both', value: false });
});

test('HK-01-5：有效全屏态识别两种模式（isFullScreen 查询不再漏 native）', () => {
  assert.equal(isEffectivelyFullScreen({ native: false, simple: false }), false);
  assert.equal(isEffectivelyFullScreen({ native: true, simple: false }), true);
  assert.equal(isEffectivelyFullScreen({ native: false, simple: true }), true);
  assert.equal(isEffectivelyFullScreen({ native: true, simple: true }), true);
});
