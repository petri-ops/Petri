'use strict';

/**
 * ipc/desktop-shell.js — BLOCK-223 桌面外壳 IPC（通知 / 托盘 / 退出摘要）。
 *
 * 读通道（摘要/状态）与用户动作（偏好、退出决策、通知）走同一控制器；
 * 预览摘要、隐藏到托盘、恢复主窗只在 `PETRI_TEST_INSTANCE=1` 下放行
 * （沿用 window:set-always-on-top 的守卫先例：用户实例误调必须被拒）。
 */

const CHANNELS = require('./channels');

function setupDesktopShellIpc({ desktopShell, isTestInstance = false }) {
  const { ipcMain } = require('electron');
  const testOnly = (fn) => () => {
    if (!isTestInstance) return { ok: false, reason: 'test_instance_only' };
    return fn();
  };

  ipcMain.handle(CHANNELS.app.getActivitySummary, () => desktopShell.getActivitySummary());
  ipcMain.handle(CHANNELS.app.getShellStatus, () => desktopShell.getStatus());
  ipcMain.handle(CHANNELS.app.setShellPrefs, (_event, payload) => desktopShell.updatePrefs(payload));
  ipcMain.handle(CHANNELS.app.notify, (_event, payload) => desktopShell.notify(payload));
  ipcMain.handle(CHANNELS.app.quitDecision, (_event, action) => desktopShell.respondQuit(action));
  ipcMain.handle(CHANNELS.app.previewQuitSummary, testOnly(() => desktopShell.previewQuitSummary()));
  ipcMain.handle(CHANNELS.app.hideToTray, testOnly(() => desktopShell.hideToTray()));
  ipcMain.handle(CHANNELS.app.showMain, testOnly(() => desktopShell.showMainWindow()));
}

module.exports = { setupDesktopShellIpc };
