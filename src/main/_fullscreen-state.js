/**
 * _fullscreen-state.js — 全屏状态机统一决策（试用反馈④阻断级修复）。
 *
 * Electron 有两套互不相通的全屏：
 *  - native：setFullScreen / isFullScreen / Ctrl+Cmd+F / 菜单栏
 *  - simple：setSimpleFullScreen / isSimpleFullScreen / 自绘红绿灯（frameless Mac）
 * 旧实现 toggle 只读 simple、isFullScreen 查询只读 native——两种模式混用时
 * 按钮反复点都退不出来（owner 卡在全屏）。本模块把决策抽成纯函数：
 * 进入统一用 simple（frameless Mac 体验），退出清当前实际置位的模式，双重置位都清。
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
function nextFullScreenAction({ native, simple }, platform) {
  const isMac = platform === 'darwin';
  if (native && simple) return { mode: 'both', value: false };
  if (native) return { mode: 'native', value: false };
  if (simple) return { mode: 'simple', value: false };
  return { mode: isMac ? 'simple' : 'native', value: true };
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
