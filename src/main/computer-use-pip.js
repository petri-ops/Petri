'use strict';

/**
 * src/main/computer-use-pip.js — BLOCK-264（C-38）电脑使用画中画（PiP）。
 *
 * 置顶小窗呈现自动化过程：无头 BrowserWindow 展示 sidecar 最新截帧；
 * 会话级隐藏（hideComputerUsePip 只关窗不清截帧缓存，同会话可再开）。
 *
 * 数据链（BLOCK-265 R5 修正）：渲染侧每 1.5s 经 IPC 拉 `computer-use:pip-frame`；
 * 主进程经本地后端 REST /api/computer-use/pip-frame 取帧（host 单例归后端——主进程
 * 禁引 core 实现 R5；不新起第二采集）。截帧**只在 PiP 开启时**才拉（不开窗零截屏）。
 */

const { BrowserWindow } = require('electron');
const path = require('path');
const CHANNELS = require('../ipc/channels');

const FRAME_INTERVAL_MS = 1500;
let pipWindow = null;
let lastFrame = null; // { pngBase64, at, error? }

/** BLOCK-265：主进程禁引 core 实现（R5）——截帧经本地后端 REST。 */
function backendBase() {
  const port = Number(process.env.R_SERVER_PORT || 3001);
  return `http://127.0.0.1:${port}`;
}

/** 拉一帧（带内存缓存；失败保留上次帧并附错误——不装假帧）。 */
async function pullFrame() {
  try {
    const resp = await fetch(`${backendBase()}/api/computer-use/pip-frame`, {
      headers: { Authorization: 'Bearer desktop-local' },
      signal: AbortSignal.timeout(9000),
    });
    const data = await resp.json();
    if (resp.ok && data.ok && data.pngBase64) {
      lastFrame = { pngBase64: data.pngBase64, at: data.at || Date.now(), error: null };
    } else {
      lastFrame = { pngBase64: lastFrame && lastFrame.pngBase64, at: Date.now(), error: (data && data.error) || `http_${resp.status}` };
    }
  } catch {
    lastFrame = { pngBase64: lastFrame && lastFrame.pngBase64, at: Date.now(), error: 'backend_unreachable' };
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
