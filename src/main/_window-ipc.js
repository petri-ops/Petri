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
const CHANNELS = require('../ipc/channels');

const { zoomBy, zoomReset } = require("./_zoom.js");

// BLOCK-100/UI-413 — 测试实例管理模式切换（全局快捷键，仅测试实例注册）。
// 设计取舍（用户实测反馈「拖拽换位置使用的不是很顺畅」）：悬停自动解锁存在
// 竞态（穿透翻转必须赶在按下之前完成，时序不稳=拖拽卡顿），改为显式双稳态——
// 解锁后窗口即普通窗口（拖顶栏移动/边缘拉伸/点按钮，零翻转竞态），锁回后完全
// 穿透。仅测试实例注册（globalShortcut 不抢用户快捷键）。
// UI-421 — 默认键改 Ctrl+Alt+Shift+M：Ctrl+Alt+M 常被第三方程序 RegisterHotKey
// 抢占且 register() 静默返回 false（2026-09-19 实机实锤，用户按键无响应）；
// 注册结果必须显式落日志，env PETRI_TEST_MANAGE_SHORTCUT 可覆盖。与
// _window-create.js 的 additionalArguments 注入处共用同一解析式。
const MANAGE_SHORTCUT =
  process.env.PETRI_TEST_MANAGE_SHORTCUT || "Control+Alt+Shift+M";

function registerTestManageModeToggle({ globalShortcut, getMainWindow }) {
  if (process.env.PETRI_TEST_INSTANCE !== "1") return;
  let manageMode = false;
  const apply = () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(!manageMode);
    // 切换后按 Electron 状态重申置顶——screen-saver 层（默认层创建期不生效，
    // 实机二分结论）
    win.setAlwaysOnTop(win.isAlwaysOnTop(), "screen-saver");
    win.webContents.send(CHANNELS.window.testManageModeChanged, manageMode);
  };
  const ok = globalShortcut.register(MANAGE_SHORTCUT, () => {
    manageMode = !manageMode;
    apply();
  });
  if (ok) {
    console.log(`[test-manage] 管理模式快捷键已注册: ${MANAGE_SHORTCUT}`);
  } else {
    console.warn(
      `[test-manage] globalShortcut.register ${MANAGE_SHORTCUT} 失败——组合键被其他程序占用，管理模式不可用；可用环境变量 PETRI_TEST_MANAGE_SHORTCUT 换键后重启测试实例`
    );
  }
  const win = getMainWindow();
  if (win) win.on("closed", () => globalShortcut.unregister(MANAGE_SHORTCUT));
}

/**
 * Register window-control IPC handlers.
 *
 * @param {object} deps
 * @param {import('electron').IpcMain} deps.ipcMain — Electron ipcMain
 * @param {object} deps.process  — global Node process object (injected)
 * @param {import('electron').app} deps.app         — Electron app
 * @param {function} deps.getMainWindow            — () => BrowserWindow|null
 */
function setupWindowIpc({ ipcMain, process, app, getMainWindow, globalShortcut }) {
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

  registerTestManageModeToggle({ globalShortcut, getMainWindow });

  // ── Window chrome controls ─────────────────────────────────
  ipcMain.on(CHANNELS.window.minimize, (event) => {
    resolveSenderWindow(event)?.minimize();
  });

  // ── BLOCK-100/UI-411 — 测试实例窗口管理 ────────────────────
  // 守卫：仅 PETRI_TEST_INSTANCE=1 的实例放行（用户实例误调会导致鼠标失效）。
  ipcMain.handle(CHANNELS.window.setAlwaysOnTop, (event, flag) => {
    if (process.env.PETRI_TEST_INSTANCE !== "1") return { ok: false, code: "test_instance_only" };
    const win = resolveSenderWindow(event);
    if (!win) return { ok: false };
    win.setAlwaysOnTop(Boolean(flag));
    return { ok: true, alwaysOnTop: win.isAlwaysOnTop() };
  });

  ipcMain.handle(CHANNELS.window.setIgnoreMouseEvents, (event, flag) => {
    if (process.env.PETRI_TEST_INSTANCE !== "1") return { ok: false, code: "test_instance_only" };
    const win = resolveSenderWindow(event);
    if (!win) return { ok: false };
    // forward:true（Windows）：穿透时仍向渲染层转发 mousemove——管理条悬停
    // 解锁检测依赖它。仅穿透真实输入；CDP 合成输入不经 OS 鼠标层。
    win.setIgnoreMouseEvents(Boolean(flag), { forward: true });
    return { ok: true };
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
  // PETRI_R_HOME env is fixed at startup; a partial petri-server restart
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
