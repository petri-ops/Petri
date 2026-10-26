'use strict';

/**
 * src/main/computer-use-pip.js — BLOCK-264（C-38）电脑使用画中画（PiP）。
 *
 * 置顶小窗呈现自动化过程：无头 BrowserWindow 展示 sidecar 最新截帧；
 * 会话级隐藏（hideComputerUsePip 只关窗不清截帧缓存，同会话可再开）。
 *
 * 数据链：渲染侧每 1.5s 经 IPC 拉 `computer-use:pip-frame`（主进程调 host
 * screenshot verb → base64 png 内存缓存，失败返回上次帧+错误说明）；
 * 截帧是**只在 PiP 开启时**才拉的按需通道（不开窗零截屏、零开销）。
 * 复用既有 computer-use-host 单例——不新起第二采集（红线）。
 */

const { BrowserWindow } = require('electron');
const path = require('path');
const CHANNELS = require('../ipc/channels');

const FRAME_INTERVAL_MS = 1500;
let pipWindow = null;
let lastFrame = null; // { pngBase64, at, error? }

function getHost() {
  try {
    // core 侧单例（与 computer_* 工具链共享；主进程 require core 路径与 ipc 侧一致）
    const { getComputerUseHost } = require('../../core/petri-server/helpers/computer-use-host');
    return getComputerUseHost();
  } catch {
    return null;
  }
}

/** 拉一帧（带内存缓存；失败保留上次帧并附错误——不装假帧）。 */
async function pullFrame() {
  const host = getHost();
  if (!host) {
    lastFrame = { pngBase64: null, at: Date.now(), error: 'host_unavailable' };
    return lastFrame;
  }
  try {
    const shot = await host.requestWithRecovery('screenshot', {}, 8000);
    const b64 = shot && (shot.pngBase64 || shot.imageBase64 || shot.base64);
    if (typeof b64 === 'string' && b64.length > 0) {
      lastFrame = { pngBase64: b64, at: Date.now(), error: null };
    } else {
      // sidecar 返回形状不含图（如只回路径）：如实标记，不编造
      lastFrame = { pngBase64: lastFrame && lastFrame.pngBase64, at: Date.now(), error: 'frame_shape_unexpected' };
    }
  } catch (e) {
    lastFrame = { pngBase64: lastFrame && lastFrame.pngBase64, at: Date.now(), error: (e && e.code) || 'screenshot_failed' };
  }
  return lastFrame;
}

function frameForRenderer() {
  return lastFrame
    ? { ...lastFrame, intervalMs: FRAME_INTERVAL_MS }
    : { pngBase64: null, at: null, error: 'no_frame_yet', intervalMs: FRAME_INTERVAL_MS };
}

function createPipWindow() {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.show();
    pipWindow.focus();
    return pipWindow;
  }
  pipWindow = new BrowserWindow({
    width: 420,
    height: 300,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    title: '电脑使用 · 画中画',
    autoHideMenuBar: true,
    webPreferences: {
      // 单一静态页 + IPC 拉帧；无 node 集成、无远程
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'computer-use-pip-preload.js'),
    },
  });
  pipWindow.loadFile(path.join(__dirname, '..', 'resources', 'computer-use-pip.html'));
  pipWindow.on('closed', () => { pipWindow = null; });
  return pipWindow;
}

function hidePipWindow() {
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
  pipWindow = null;
}

function isPipOpen() {
  return Boolean(pipWindow && !pipWindow.isDestroyed());
}

function registerComputerUsePipIpc(ipcMain) {
  ipcMain.handle(CHANNELS.computerUsePip.open, () => {
    createPipWindow();
    return { ok: true };
  });
  ipcMain.handle(CHANNELS.computerUsePip.close, () => {
    hidePipWindow();
    return { ok: true };
  });
  ipcMain.handle(CHANNELS.computerUsePip.frame, async () => {
    if (!isPipOpen()) return { ok: false, error: 'pip_not_open' }; // 关窗即停采集
    const frame = await pullFrame();
    return { ok: true, frame };
  });
  // 设置页状态查询（不动窗口）
  ipcMain.handle(CHANNELS.computerUsePip.status, () => ({ ok: true, open: isPipOpen(), frame: frameForRenderer() }));
}

module.exports = {
  registerComputerUsePipIpc,
  createPipWindow,
  hidePipWindow,
  isPipOpen,
  pullFrame,
  frameForRenderer,
  _internals: { FRAME_INTERVAL_MS },
};
