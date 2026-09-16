// ============================================================
// BrowserWindow Creation
//
// Extracted from src/main.js by SUB-15.1 PHASE 3.
// Original location: L146-406 (createWindow function).
//
// Creates the main BrowserWindow with all event handlers attached.
// Electron APIs (BrowserWindow / shell / session) are passed via
// parameter injection to avoid top-level dependencies.
// mainWindow is managed via getter/setter to avoid top-level shared state.
// ============================================================
const CHANNELS = require('./channels');

const fs = require("fs");
const { BRAND } = require("./brand");
const { zoomBy, zoomReset } = require("./_zoom.js");

/**
 * Create the main BrowserWindow with all event handlers attached.
 *
 * @param {object} deps
 * @param {import('electron').BrowserWindow} deps.BrowserWindow
 * @param {import('electron').shell}          deps.shell
 * @param {import('electron').session}       deps.session
 * @param {function} deps.resolveResource     - resolveResource() from core-utils
 * @param {function} deps.isDevMode          - isDevMode() from core-utils
 * @param {function} deps.rendererDevUrl     - rendererDevUrl from core-utils
 * @param {object}   deps.process            - Node.js process object (injected)
 * @param {function} deps.getMainWindow      - () => BrowserWindow|null (shared ref)
 * @param {function} deps.setMainWindow       - (BrowserWindow|null) => void (shared ref setter)
 * @param {function} deps.publishAgentWorkbenchFlags - publish fn from _agent-flags.js
 * @param {function} deps.getAgentWorkbenchFlags      - getAgentWorkbenchFlags fn
 * @param {function} deps.startSpaServer      - startSpaServer() from _spa-server.js
 * @param {function} [deps.onSpaServerReady]  - (spaServerUrl) => void; lets callers
 *                                              retain the SPA base URL for secondary
 *                                              windows (BLOCK-59 window manager)
 * @returns {Promise<BrowserWindow>}
 */
async function createWindow({
  BrowserWindow,
  shell,
  session,
  resolveResource,
  isDevMode,
  rendererDevUrl,
  process,
  getMainWindow,
  setMainWindow,
  publishAgentWorkbenchFlags,
  getAgentWorkbenchFlags,
  startSpaServer,
  onSpaServerReady,
}) {
  // ── SPA Server ───────────────────────────────────────────────
  const { spaServerUrl, spaIndexPath } = await startSpaServer({
    resolveResource,
    isDevMode,
    rendererDevUrl,
    process,
  });
  if (typeof onSpaServerReady === "function" && spaServerUrl) {
    onSpaServerReady(spaServerUrl);
  }

  // ── Window Creation ──────────────────────────────────────────
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 720,
    minHeight: 520,
    title: BRAND.APP_NAME, // BLOCK-61：品牌单一事实源
    // Self-drawn traffic-light buttons in TitleBar.tsx — see src/main.js comments
    // around setupWindowIpc() for the IPC contract (window:minimize/maximize/close).
    // Frameless on every platform so the renderer owns the window controls; on macOS
    // TitleBar draws the Cursor-style grey circular capsule (not the native OS lights),
    // on Windows/Linux it draws the square WindowControls.
    frame: false,
    backgroundColor: "#1f2330",
    // Mac fullscreen support: enable native fullscreen behavior
    // fullscreenable: true allows the green button and Cmd+Ctrl+F to enter true fullscreen
    // simpleFullScreen: false uses the native macOS fullscreen transition (hides menu bar)
    fullscreenable: true,
    fullscreen: false,
    simpleFullScreen: false,
    webPreferences: {
      preload: resolveResource("src", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Register with shared ref immediately so event handlers can use getMainWindow()
  setMainWindow(mainWindow);

  // ── Load URL ─────────────────────────────────────────────────
  // Development mode prioritizes Vite dev server with HMR;
  // production/normal launch loads the local static build.
  if (isDevMode) {
    mainWindow.loadURL(spaServerUrl);
  } else if (fs.existsSync(spaIndexPath) && spaServerUrl) {
    mainWindow.loadURL(spaServerUrl);
  } else {
    // Fallback: load Vite dev server in dev mode
    mainWindow.loadURL(rendererDevUrl);
  }

  // ── External Links → System Browser ───────────────────────────
  // All window.open calls are denied to avoid popup storms from failed
  // non-HTTP URLs. External http/https links go to system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // ── Navigation Guard ──────────────────────────────────────────
  // Only allow navigation within the local server scope to prevent
  // accidental navigation to external URLs or file:// causing white screens.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = [
      spaServerUrl?.replace(/\/$/, ""),
      rendererDevUrl.replace(/\/$/, ""),
    ].filter(Boolean);
    if (!allowed.some((a) => url.startsWith(a))) {
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        shell.openExternal(url);
      }
    }
  });

  // ── Keyboard Shortcut: Cmd/Ctrl+R Soft Refresh ────────────────
  // Intercept Cmd/Ctrl+R to do an in-app soft refresh instead of a hard
  // Electron reload which would break SSE connections and lose renderer
  // memory state. Cmd/Ctrl+Shift+R is preserved as developer hard refresh.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
    const isMacWindowShortcut =
      process.platform === "darwin" &&
      input.meta &&
      !input.control &&
      !input.alt &&
      !input.shift;

    if (isMacWindowShortcut && key === "w") {
      event.preventDefault();
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.close();
      return;
    }
    if (isMacWindowShortcut && key === "m") {
      event.preventDefault();
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.minimize();
      return;
    }

    // ── Keyboard Shortcut: Ctrl/Cmd +/-/0 page zoom ─────────────
    // The window is frameless, so the Electron View > zoomIn / zoomOut /
    // resetZoom menu roles never surface (no menu bar is rendered on
    // Windows/Linux) and their default accelerators are unreachable.
    // Re-implement them here so keyboard zoom works regardless of menu
    // visibility. Ctrl/Cmd+wheel is handled in preload.js via window:zoom-by.
    // NOTE: keep apostrophes out of comments inside this callback - the test
    // suite extracts it with a naive brace matcher that misreads quotes.
    if (
      (input.control || input.meta) &&
      !input.alt &&
      (key === "=" || key === "+" || key === "-" || key === "0")
    ) {
      event.preventDefault();
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        if (key === "0") {
          zoomReset(win);
        } else {
          zoomBy(win, key === "-" ? -1 : 1);
        }
      }
      return;
    }

    const isReloadKey =
      key === "r" &&
      (input.meta || input.control) &&
      !input.alt;
    if (!isReloadKey) return;
    event.preventDefault();
    if (input.shift) {
      console.log("[desktop] hard reload requested");
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.reloadIgnoringCache();
      }
      return;
    }
    console.log("[desktop] soft refresh requested");
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(CHANNELS.app.softRefresh);
    }
  });

  // ── DevTools ──────────────────────────────────────────────────
  if (process.env.BIOF3_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools();
  }

  // ── Renderer Console Capture ───────────────────────────────────
  mainWindow.webContents.on(
    "console-message",
    (event, level, message, line, sourceId) => {
      const tag = ["LOG", "WARN", "ERROR"][level] || "LOG";
      console.log(`[renderer:${tag}] ${message}`);
    },
  );

  // ── Load Failure Capture ───────────────────────────────────────
  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[renderer] load failed: ${errorCode} ${errorDescription} url=${validatedURL}`,
      );
    },
  );

  // ── Page Load Complete ─────────────────────────────────────────
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[renderer] page loaded");
    publishAgentWorkbenchFlags({
      getMainWindow,
      getAgentWorkbenchFlags,
    });
  });

  // ── macOS Focus Diagnostics ────────────────────────────────────
  // The dev launcher obtains the GUI session via LaunchServices.
  // Record window state only; do not delay to steal focus.
  if (process.platform === "darwin") {
    const windowForFocusDiagnostics = mainWindow;
    windowForFocusDiagnostics.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        if (!windowForFocusDiagnostics.isDestroyed()) {
          console.log(
            "[focus] isKeyWindow after load:",
            typeof windowForFocusDiagnostics.isKeyWindow === "function"
              ? windowForFocusDiagnostics.isKeyWindow()
              : "n/a",
            "isFocused:",
            windowForFocusDiagnostics.isFocused(),
          );
        }
      }, 500);
    });
  }

  // ── Window Closed ──────────────────────────────────────────────
  mainWindow.on("closed", () => {
    setMainWindow(null);
  });

  // ── Maximize/Unmaximize State → Renderer ──────────────────────
  // Forward maximize state so the self-drawn window control buttons
  // can swap their glyph (single square ↔ double square).
  const publishMaximizedState = (isMaximized) => {
    const win = getMainWindow();
    if (!win) return;
    if (
      (typeof win.isDestroyed === "function" && win.isDestroyed()) ||
      (typeof win.webContents?.isDestroyed === "function" && win.webContents.isDestroyed())
    ) {
      return;
    }
    win.webContents.send(CHANNELS.window.maximizeChanged, isMaximized);
  };
  mainWindow.on("maximize", () => publishMaximizedState(true));
  mainWindow.on("unmaximize", () => publishMaximizedState(false));

  // ── Fullscreen State → Renderer ────────────────────────────────
  // On macOS frameless windows, use simpleFullScreen mode which
  // automatically hides the Dock and menu bar for true fullscreen.
  if (process.platform === "darwin") {
    mainWindow.on("enter-simple-full-screen", () => {
      const win = getMainWindow();
      if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
      win.webContents.send(CHANNELS.window.fullscreenChanged, true);
    });
    mainWindow.on("leave-simple-full-screen", () => {
      const win = getMainWindow();
      if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
      win.webContents.send(CHANNELS.window.fullscreenChanged, false);
    });
  } else {
    mainWindow.on("enter-full-screen", () => {
      const win = getMainWindow();
      if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
      win.webContents.send(CHANNELS.window.fullscreenChanged, true);
    });
    mainWindow.on("leave-full-screen", () => {
      const win = getMainWindow();
      if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
      win.webContents.send(CHANNELS.window.fullscreenChanged, false);
    });
  }

  return mainWindow;
}

module.exports = { createWindow };
