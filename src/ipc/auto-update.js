const CHANNELS = require('./channels');
// ============================================================
// IPC handlers: updater:check, updater:download, updater:install
// (3 handlers + 3 disabled stubs for non-darwin/dev mode)
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 2.
// Original location: src/main.js ~line 1363 (setupAutoUpdateIpc).
//
// macOS-only — early-returns when not darwin / dev mode / not packaged.
// Uses mainWindow parameter for webContents.send progress events.
// The `isDevMode` and `app` references are looked up via the
// `electron` module to keep this file self-contained.
// ============================================================

const { ipcMain, app, shell, net } = require("electron");
const { createMacOssUpdater } = require("../macos-oss-updater");

// BLOCK-453：主进程常驻轮询（架构修正）——渲染层 hook 只在设置页挂载，
// 用户不开设置页就永不检查；轮询/通知必须由主进程持有（天然常驻、与 UI 无关）。
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 空闲 15 分钟
const FOCUS_MIN_GAP_MS = 5 * 60 * 1000; // 窗口聚焦触发的最小间隔（防抖）
const STARTUP_DELAY_MS = 5000; // 等窗口就绪

function setupAutoUpdateIpc({ mainWindow, desktopShell } = {}) {
  const isDevMode = !app.isPackaged;

  if (process.platform !== "darwin" || isDevMode || !app.isPackaged) {
    // UI-705 — demo 档（PETRI_UPDATE_DEMO=1，仅此未打包 dev 分支内）：测试实例
    // 演示更新 pill 全流转（出现→下载进度→安装就绪）。packaged 链路零触碰——
    // 演示档在 disabled stub 分支内、真实 createMacOssUpdater 不受影响。
    if (process.env.PETRI_UPDATE_DEMO === "1") {
      let demoDownloaded = false;
      ipcMain.handle(CHANNELS.updater.check, async () => {
        const info = { version: "9.9.9-demo" };
        if (mainWindow) mainWindow.webContents.send(CHANNELS.updater.updateAvailable, info);
        return { ok: true, hasUpdate: true, info };
      });
      ipcMain.handle(CHANNELS.updater.download, async () => {
        for (const ratio of [0.2, 0.5, 0.8, 1]) {
          if (mainWindow) mainWindow.webContents.send(CHANNELS.updater.downloadProgress, { ratio, percent: ratio * 100 });
          await new Promise((r) => setTimeout(r, 400));
        }
        demoDownloaded = true;
        if (mainWindow) mainWindow.webContents.send(CHANNELS.updater.updateDownloaded);
        return { ok: true };
      });
      ipcMain.handle(CHANNELS.updater.install, async () => ({ ok: demoDownloaded, error: demoDownloaded ? undefined : "nothing downloaded" }));
      return;
    }
    ipcMain.handle(CHANNELS.updater.check, async () => ({
      ok: false,
      error: "auto-update is available in packaged macOS builds only",
    }));
    ipcMain.handle(CHANNELS.updater.download, async () => ({
      ok: false,
      error: "auto-update disabled",
    }));
    ipcMain.handle(CHANNELS.updater.install, async () => ({
      ok: false,
      error: "auto-update disabled",
    }));
    return;
  }

  let _updateInfo = null;
  const updater = createMacOssUpdater({
    currentVersion: app.getVersion(),
    downloadsDir: app.getPath("downloads"),
    fetchImpl: (url, options) => net.fetch(url, options),
    openPath: (target) => shell.openPath(target),
    onProgress: (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send(CHANNELS.updater.downloadProgress, progress);
      }
    },
  });

  ipcMain.handle(CHANNELS.updater.check, async () => {
    try {
      const result = await updater.check();
      _updateInfo = result.info || null;
      if (mainWindow) {
        mainWindow.webContents.send(
          result.hasUpdate
            ? CHANNELS.updater.updateAvailable
            : CHANNELS.updater.updateNotAvailable,
          _updateInfo,
        );
      }
      return { ok: true, hasUpdate: result.hasUpdate, info: _updateInfo };
    } catch (e) {
      console.error("[updater] check failed:", e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.updater.download, async () => {
    try {
      await updater.download();
      if (mainWindow) mainWindow.webContents.send(CHANNELS.updater.updateDownloaded);
      return { ok: true };
    } catch (e) {
      console.error("[updater] download failed:", e.message);
      if (mainWindow) mainWindow.webContents.send(CHANNELS.updater.error, e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.updater.install, async () => {
    try {
      await updater.install();
      return { ok: true };
    } catch (e) {
      console.error("[updater] open installer failed:", e.message);
      if (mainWindow) mainWindow.webContents.send(CHANNELS.updater.error, e.message);
      return { ok: false, error: e.message };
    }
  });

  // ── BLOCK-453：主进程常驻后台轮询 + 系统通知（不依赖渲染层是否挂载设置页）──
  let lastCheckAt = 0;
  let notifiedVersion = "";

  function sendToRenderer(channel, payload) {
    const win = mainWindow && (typeof mainWindow === "function" ? mainWindow() : mainWindow);
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send(channel, payload);
    } catch {
      /* 窗口销毁竞态：忽略 */
    }
  }

  async function backgroundCheck(reason) {
    const now = Date.now();
    // 聚焦触发的 check 做最小间隔防抖，避免频繁切窗打请求
    if (reason === "focus" && now - lastCheckAt < FOCUS_MIN_GAP_MS) return;
    lastCheckAt = now;
    try {
      const result = await updater.check();
      _updateInfo = result.info || null;
      sendToRenderer(
        result.hasUpdate ? CHANNELS.updater.updateAvailable : CHANNELS.updater.updateNotAvailable,
        _updateInfo,
      );
      if (!result.hasUpdate) return;
      const version = (_updateInfo && _updateInfo.version) || "";
      if (!version || notifiedVersion === version) return;
      notifiedVersion = version;
      // 复用 Q9 app:notify 通道（不新增通道）；前台可见也弹由主进程 allowWhenFocused 保证
      if (desktopShell && typeof desktopShell.notify === "function") {
        try {
          desktopShell.notify({ kind: "update_available", label: version, dedupeKey: version });
        } catch (e) {
          console.error("[updater] notify failed:", e && e.message);
        }
      }
    } catch (e) {
      // 后台检查失败静默（网络抖动不该打扰用户）；手动检查仍会展示错误
      console.error("[updater] background check failed:", e && e.message);
    }
  }

  setTimeout(() => {
    void backgroundCheck("startup");
  }, STARTUP_DELAY_MS);

  setInterval(() => {
    void backgroundCheck("poll");
  }, POLL_INTERVAL_MS);

  // 窗口重新获得焦点时补一次（用户切回来看时最可能注意到更新）
  app.on("browser-window-focus", () => {
    void backgroundCheck("focus");
  });
}

module.exports = { setupAutoUpdateIpc };
