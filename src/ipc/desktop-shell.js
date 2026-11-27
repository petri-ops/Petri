'use strict';

/**
 * ipc/desktop-shell.js — BLOCK-223 桌面外壳 IPC（通知 / 托盘 / 退出摘要）。
 *
 * 读通道（摘要/状态）与用户动作（偏好、退出决策、通知）走同一控制器；
 * 预览摘要、隐藏到托盘、恢复主窗只在 `PETRI_TEST_INSTANCE=1` 下放行
 * （沿用 window:set-always-on-top 的守卫先例：用户实例误调必须被拒）。
 */

const CHANNELS = require('./channels');
const { resolveCore } = require('../main/core-utils');
const { resolveGeneratedArtifactPath } = require(resolveCore('shared-backend/generated-artifact-path'));

function setupDesktopShellIpc({ desktopShell, isTestInstance = false }) {
  const { ipcMain, clipboard, nativeImage } = require('electron');
  const testOnly = (fn) => () => {
    if (!isTestInstance) return { ok: false, reason: 'test_instance_only' };
    return fn();
  };

  // 试用反馈⑫续：主进程剪贴板写——Electron 主进程无渲染进程权限限制，返回布尔供 UI 真反馈
  ipcMain.handle(CHANNELS.app.writeClipboard, (_event, text) => {
    if (typeof text !== 'string' || !text) return false;
    try { clipboard.writeText(text); return true; } catch { return false; }
  });
  // item 83 打磨批：产物图复制——只收 {kind,filename}，主进程用 shared-backend 单源
  // fail-closed 校验路径后读图写剪贴板，绝不信任渲染层裸绝对路径。
  ipcMain.handle(CHANNELS.app.copyImage, (_event, payload) => {
    try {
      const kind = payload && payload.kind;
      const filename = payload && payload.filename;
      const filePath = resolveGeneratedArtifactPath(kind, filename);
      if (!filePath) {
        return { ok: false, code: 'generated_image_not_found', message: '产物图片不存在或路径越界' };
      }
      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) {
        return { ok: false, code: 'generated_image_unreadable', message: '产物图片内容不可读' };
      }
      clipboard.writeImage(image);
      return { ok: true };
    } catch {
      return { ok: false, code: 'copy_image_failed', message: '复制图片失败' };
    }
  });
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
