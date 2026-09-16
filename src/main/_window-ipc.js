// ============================================================
// Window IPC — minimizes, maximizes, closes, fullscreen state
//
// Extracted from src/main.js by SUB-15.1 PHASE 2.
// Original location: L451-507 (setupWindowIpc).
//
// Registers all window-control IPC handlers.
// BrowserWindow is passed via parameter injection so the module
// has no top-level Electron dependency.
// ============================================================
const CHANNELS = require('./channels');

const { zoomBy, zoomReset } = require("./_zoom.js");

/**
 * Register window-control IPC handlers.
 *
 * @param {object} deps
 * @param {import('electron').IpcMain} deps.ipcMain — Electron ipcMain
 * @param {object} deps.process  — global Node process object (injected)
 * @param {import('electron').app} deps.app         — Electron app
 * @param {function} deps.getMainWindow            — () => BrowserWindow|null
 */
function setupWindowIpc({ ipcMain, process, app, getMainWindow }) {
  // Chrome controls (min/max/close) must resolve the *owning* window of the
  // sender webContents — not just the main window. A second main-class window
  // (or any window rendering the same chrome) would otherwise have dead
  // minimize/maximize/close buttons: the IPC resolves to null and the click
  // is silently dropped (user-visible as an unclosable window).
  // Zoom must work in pop-out windows too, so resolve the *owning* window of the
  // sender webContents instead of restricting to the main window.
  const resolveSenderWindow = (event) => {
    const win = event?.sender?.getOwnerBrowserWindow?.();
    return win && !win.isDestroyed() ? win : null;
  };

  // ── Window chrome controls ─────────────────────────────────
  ipcMain.on(CHANNELS.window.minimize, (event) => {
    resolveSenderWindow(event)?.minimize();
  });

  ipcMain.on(CHANNELS.window.maximize, (event) => {
    const targetWindow = resolveSenderWindow(event);
    if (!targetWindow) return;
    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
  });

  ipcMain.on(CHANNELS.window.close, (event) => {
    resolveSenderWindow(event)?.close();
  });

  ipcMain.handle(CHANNELS.window.isMaximized, (event) => {
    const targetWindow = resolveSenderWindow(event);
    return targetWindow ? targetWindow.isMaximized() === true : false;
  });

  // ── Fullscreen (macOS simpleFullScreen / cross-platform) ────
  ipcMain.handle(CHANNELS.window.isFullScreen, (event) => {
    const targetWindow = resolveSenderWindow(event);
    return targetWindow ? targetWindow.isFullScreen() : false;
  });

  ipcMain.on(CHANNELS.window.toggleFullScreen, (event) => {
    const targetWindow = resolveSenderWindow(event);
    if (!targetWindow) return;
    // For frameless windows on macOS, use simpleFullScreen mode which
    // automatically hides the Dock and menu bar
    if (process.platform === "darwin") {
      targetWindow.setSimpleFullScreen(!targetWindow.isSimpleFullScreen());
    } else {
      targetWindow.setFullScreen(!targetWindow.isFullScreen());
    }
  });

  // ── Page zoom (frameless: menu accelerators unreachable) ─────
  // Driven by the Ctrl/Cmd+wheel listener registered in preload.js, and by the
  // Ctrl/Cmd +/-/0 accelerator in _window-create.js. `delta` is a (possibly
  // fractional) zoomLevel step — positive zooms in.
  ipcMain.on(CHANNELS.window.zoomBy, (event, delta) => {
    const targetWindow = resolveSenderWindow(event);
    if (targetWindow) zoomBy(targetWindow, delta);
  });

  ipcMain.on(CHANNELS.window.zoomReset, (event) => {
    const targetWindow = resolveSenderWindow(event);
    if (targetWindow) zoomReset(targetWindow);
  });

  ipcMain.handle(CHANNELS.window.getZoom, (event) => {
    const targetWindow = resolveSenderWindow(event);
    return targetWindow ? targetWindow.webContents.getZoomLevel() : 0;
  });

  // ── App relaunch (for runtime install / env refresh) ────────
  // BIOF3_R_HOME env is fixed at startup; a partial biof3-server restart
  // would still read stale values — require full app relaunch.
  ipcMain.handle(CHANNELS.app.relaunch, async () => {
    try {
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { setupWindowIpc };
