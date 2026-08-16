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

function setupAutoUpdateIpc({ mainWindow } = {}) {
  const isDevMode = !app.isPackaged;

  if (process.platform !== "darwin" || isDevMode || !app.isPackaged) {
    ipcMain.handle("updater:check", async () => ({
      ok: false,
      error: "auto-update is available in packaged macOS builds only",
    }));
    ipcMain.handle("updater:download", async () => ({
      ok: false,
      error: "auto-update disabled",
    }));
    ipcMain.handle("updater:install", async () => ({
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
        mainWindow.webContents.send("updater:download-progress", progress);
      }
    },
  });

  ipcMain.handle("updater:check", async () => {
    try {
      const result = await updater.check();
      _updateInfo = result.info || null;
      if (mainWindow) {
        mainWindow.webContents.send(
          result.hasUpdate
            ? "updater:update-available"
            : "updater:update-not-available",
          _updateInfo,
        );
      }
      return { ok: true, hasUpdate: result.hasUpdate, info: _updateInfo };
    } catch (e) {
      console.error("[updater] check failed:", e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("updater:download", async () => {
    try {
      await updater.download();
      if (mainWindow) mainWindow.webContents.send("updater:update-downloaded");
      return { ok: true };
    } catch (e) {
      console.error("[updater] download failed:", e.message);
      if (mainWindow) mainWindow.webContents.send("updater:error", e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("updater:install", async () => {
    try {
      await updater.install();
      return { ok: true };
    } catch (e) {
      console.error("[updater] open installer failed:", e.message);
      if (mainWindow) mainWindow.webContents.send("updater:error", e.message);
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { setupAutoUpdateIpc };
