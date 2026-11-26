/**
 * _fullscreen-state.js — 全屏状态机统一决策（试用反馈④ + 更新 msg_21d38a84e33b）。
 *
 * Electron 有两套互不相通的全屏：
 *  - native：setFullScreen / isFullScreen / Ctrl+Cmd+F / 菜单栏（mac 标准，菜单栏隐藏而非被遮挡）
 *  - simple：setSimpleFullScreen / isSimpleFullScreen（mac 会把窗口顶到 y=0 **盖住菜单栏**）
 * 旧实现 toggle 只读 simple、isFullScreen 查询只读 native——两种模式混用时退不出来。
 * 修复：进入一律用 native（不再 simple，避免盖栏）；退出清当前实际置位的模式，
 * 兼容存量 simple 全屏窗口（双重置位都清）。
 */
'use strict';

/** 是否处于任一全屏态（供 isFullScreen 查询/UI 状态显示）。 */
function isEffectivelyFullScreen({ native, simple }) {
  return native === true || simple === true;
}

/**
 * 下一次 toggle 动作。
 * @returns {{mode:'native'|'simple'|'both', value:boolean}}
 */
function nextFullScreenAction({ native, simple }, _platform) {
  if (native && simple) return { mode: 'both', value: false };
  if (native) return { mode: 'native', value: false };
  if (simple) return { mode: 'simple', value: false };
  // 进入一律 native：Mac simpleFullScreen 会盖住菜单栏（owner msg_21d38a84e33b）
  return { mode: 'native', value: true };
}

/**
 * 对 BrowserWindow 执行动作（main 侧调用；纯函数外的唯一副作用点）。
 */
function applyFullScreenAction(win, action) {
  if (action.mode === 'both') {
    win.setFullScreen(false);
    win.setSimpleFullScreen(false);
  } else if (action.mode === 'native') {
    win.setFullScreen(action.value);
  } else {
    win.setSimpleFullScreen(action.value);
  }
}

module.exports = { isEffectivelyFullScreen, nextFullScreenAction, applyFullScreenAction };
