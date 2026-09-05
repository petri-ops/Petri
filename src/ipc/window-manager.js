// ============================================================
// IPC handlers: window:pop-out, window:return, window:minimize,
//               window:restore, window:remove, window:snapshot,
//               window:self  (7 handlers)
//
// BLOCK-59 P0 — Electron adapter for the window manager core
// (src/main/_window-manager.js). The core owns the state
// machine and the route whitelist; this module owns
// BrowserWindow lifecycle, geometry persistence
// (userData/window-manager-state.json) and the
// window:state-changed multicast to every alive window.
//
// Immutable contract (plan §3): the renderer's × on a popped
// window DEMOTES it to the edge rail (close is intercepted and
// turned into hide). Real destruction happens only through
// window:remove from the rail, or at app quit.
// ============================================================

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const {
  createWindowManagerCore,
  CONTENT_TYPES,
} = require("../main/_window-manager");

const GEOMETRY_RECORD_DEBOUNCE_MS = 400;

function setupWindowManagerIpc({
  getMainWindow,
  getSpaBaseUrl,
  resolveResource,
} = {}) {
  const statePath = () =>
    path.join(app.getPath("userData"), "window-manager-state.json");

  const core = createWindowManagerCore({
    loadState: () => {
      try {
        return JSON.parse(fs.readFileSync(statePath(), "utf8"));
      } catch {
        return null;
      }
    },
    saveState: (serialized) => {
      try {
        fs.mkdirSync(path.dirname(statePath()), { recursive: true });
        fs.writeFileSync(statePath(), JSON.stringify(serialized));
      } catch {}
    },
  });

  // contentId → { win, expectingClose, geometryTimer }
  const windows = new Map();
  let exiting = false;

  // ── Trusted-sender scoping ────────────────────────────────────
  // Main window may act on every content id; a managed pop-out may
  // act on itself only. Anything else (webview / foreign sender)
  // is rejected fail-closed.
  const resolveSenderScope = (event) => {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed()) return null;
    const main = getMainWindow();
    if (main && !main.isDestroyed() && sender === main.webContents) {
      return { kind: "main" };
    }
    for (const [id, rec] of windows.entries()) {
      if (!rec.win.isDestroyed() && sender === rec.win.webContents) {
        return { kind: "managed", id };
      }
    }
    return null;
  };

  const isMutationAllowed = (scope, id) =>
    scope.kind === "main" || (scope.kind === "managed" && scope.id === id);

  // ── Display / bounds helpers ──────────────────────────────────

  const currentDisplays = () => {
    try {
      const primary = screen.getPrimaryDisplay();
      const all = screen.getAllDisplays();
      return [primary, ...all.filter((d) => d.id !== primary.id)].map((d) => ({
        id: d.id,
        bounds: d.bounds,
        workArea: d.workArea,
      }));
    } catch {
      return [];
    }
  };

  const getMainBounds = () => {
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return null;
    try {
      return typeof main.getNormalBounds === "function"
        ? main.getNormalBounds()
        : main.getBounds();
    } catch {
      return null;
    }
  };

  const displayIdForBounds = (bounds) => {
    try {
      return screen.getDisplayMatching(bounds)?.id ?? null;
    } catch {
      return null;
    }
  };

  const recordGeometryNow = (rec) => {
    if (!rec || rec.win.isDestroyed()) return;
    try {
      const bounds = rec.win.getBounds();
      core.recordGeometry(rec.id, {
        x: bounds.x,
        y: bounds.y,
        w: bounds.width,
        h: bounds.height,
        displayId: displayIdForBounds(bounds),
      });
    } catch {}
  };

  const scheduleGeometryRecord = (rec) => {
    if (!rec || rec.geometryTimer) return;
    rec.geometryTimer = setTimeout(() => {
      rec.geometryTimer = null;
      recordGeometryNow(rec);
    }, GEOMETRY_RECORD_DEBOUNCE_MS);
  };

  // ── Window factory ────────────────────────────────────────────

  const broadcast = (payload) => {
    const targets = [];
    const main = getMainWindow();
    if (main && !main.isDestroyed()) targets.push(main);
    for (const rec of windows.values()) {
      if (!rec.win.isDestroyed()) targets.push(rec.win);
    }
    for (const win of targets) {
      try {
        win.webContents.send("window:state-changed", payload);
      } catch {}
    }
  };

  core.subscribe(broadcast);

  const showAndFocus = (rec) => {
    if (!rec || rec.win.isDestroyed()) return;
    try {
      if (rec.win.isMinimized()) rec.win.restore();
      rec.win.show();
      rec.win.focus();
    } catch {}
  };

  const createContentWindow = (id, spec, bounds) => {
    const spaBase = typeof getSpaBaseUrl === "function" ? getSpaBaseUrl() : null;
    if (!spaBase) {
      return { ok: false, code: "spa_server_unavailable", error: "SPA 服务未就绪，无法创建窗口" };
    }
    const route = core.buildRouteForId(id);
    if (!route) {
      return { ok: false, code: "route_not_allowed", error: `路由未登记: ${id}` };
    }
    let url;
    try {
      url = new URL(route, spaBase).toString();
    } catch {
      return { ok: false, code: "route_not_allowed", error: "路由解析失败" };
    }

    const win = new BrowserWindow({
      width: bounds.w,
      height: bounds.h,
      x: bounds.x,
      y: bounds.y,
      minWidth: 480,
      minHeight: 360,
      title: `BioF3 — ${spec.title || "窗口"}`,
      frame: false,
      backgroundColor: "#1f2330",
      show: false,
      webPreferences: {
        preload: resolveResource("preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    const rec = { id, win, expectingClose: false, geometryTimer: null };
    windows.set(id, rec);

    // Same guards as the main window: pop-outs load only the local
    // SPA origin, external links go to the system browser.
    const allowedBase = spaBase.replace(/\/$/, "");
    win.webContents.on("will-navigate", (event, target) => {
      if (!target.startsWith(allowedBase)) {
        event.preventDefault();
      }
    });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (target.startsWith("http://") || target.startsWith("https://")) {
        require("electron").shell.openExternal(target).catch(() => {});
      }
      return { action: "deny" };
    });
    win.webContents.on("did-fail-load", (_event, code, desc, validated) => {
      console.error(`[window-manager] load failed (${id}): ${code} ${desc} ${validated}`);
    });

    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) win.show();
    });

    win.on("move", () => scheduleGeometryRecord(rec));
    win.on("resize", () => scheduleGeometryRecord(rec));

    // Immutable contract: a close request on a popped window is a
    // DEMOTE, not a destroy (plan §3 / §9). Singletons with
    // closeBehavior 'close' close for real.
    win.on("close", (event) => {
      if (rec.expectingClose || exiting) return;
      if (spec.closeBehavior !== "rail") return;
      event.preventDefault();
      recordGeometryNow(rec);
      core.minimizeToRail(id);
      if (!win.isDestroyed()) win.hide();
    });

    win.on("closed", () => {
      if (rec.geometryTimer) {
        clearTimeout(rec.geometryTimer);
        rec.geometryTimer = null;
      }
      windows.delete(id);
      if (rec.expectingClose || exiting) return;
      // Unexpected destroy (crash / destroy()): reconcile the
      // registry so the content stays recoverable from the rail.
      if (core.getSnapshot().entries.some((e) => e.id === id && e.state === "popped")) {
        core.minimizeToRail(id);
      }
    });

    win.loadURL(url).catch((e) => {
      console.error(`[window-manager] loadURL failed (${id}):`, e.message);
    });

    return { ok: true, id };
  };

  const ensureSingletonWindow = (id, spec) => {
    const rec = windows.get(id);
    if (rec && !rec.win.isDestroyed()) {
      showAndFocus(rec);
      return { ok: true, id, action: "focused" };
    }
    if (rec) windows.delete(id);
    const bounds = core.resolveLaunchBounds(id, {
      displays: currentDisplays(),
      mainBounds: getMainBounds(),
    });
    const created = createContentWindow(id, spec, bounds.bounds);
    return created.ok ? { ok: true, id, action: "created" } : created;
  };

  const ensurePoppedWindow = (id, spec, result) => {
    const rec = windows.get(id);
    if (rec && !rec.win.isDestroyed()) {
      showAndFocus(rec);
      return result;
    }
    if (rec) windows.delete(id);
    const bounds = core.resolveLaunchBounds(id, {
      displays: currentDisplays(),
      mainBounds: getMainBounds(),
    });
    const created = createContentWindow(id, spec, bounds.bounds);
    return created.ok ? result : created;
  };

  const hideDemoted = (contentId) => {
    if (!contentId) return;
    const rec = windows.get(contentId);
    if (rec && !rec.win.isDestroyed()) rec.win.hide();
  };

  // ── IPC surface (plan §4.3, additive) ─────────────────────────

  ipcMain.handle("window:pop-out", (_event, payload) => {
    const scope = resolveSenderScope(_event);
    if (!scope) return { ok: false, code: "sender_not_allowed" };
    const verdict = core.resolveContent(payload || {});
    if (!verdict.ok) return verdict;
    const { id, spec } = verdict;

    if (spec.singleton) {
      return ensureSingletonWindow(id, spec);
    }
    const result = core.popOut({ type: payload.type, key: payload.key });
    if (!result.ok) return result;
    hideDemoted(result.autoDemoted);
    if (result.action === "focused") {
      const rec = windows.get(id);
      if (rec) showAndFocus(rec);
      return result;
    }
    if (result.action === "restored") {
      const rec = windows.get(id);
      if (rec && !rec.win.isDestroyed()) {
        const bounds = core.resolveLaunchBounds(id, {
          displays: currentDisplays(),
          mainBounds: getMainBounds(),
        });
        try {
          rec.win.setBounds({
            x: bounds.bounds.x,
            y: bounds.bounds.y,
            width: bounds.bounds.w,
            height: bounds.bounds.h,
          });
        } catch {}
      }
      return ensurePoppedWindow(id, spec, result);
    }
    // created
    const bounds = core.resolveLaunchBounds(id, {
      displays: currentDisplays(),
      mainBounds: getMainBounds(),
    });
    const created = createContentWindow(id, spec, bounds.bounds);
    return created.ok ? result : created;
  });

  ipcMain.handle("window:return", (event, payload) => {
    const scope = resolveSenderScope(event);
    const id = typeof payload === "string" ? payload : payload?.id;
    if (!scope || !id || !isMutationAllowed(scope, id)) {
      return { ok: false, code: "sender_not_allowed" };
    }
    const result = core.returnToDock(id);
    if (!result.ok) return result;
    const rec = windows.get(id);
    if (rec) {
      rec.expectingClose = true;
      if (rec.geometryTimer) {
        clearTimeout(rec.geometryTimer);
        rec.geometryTimer = null;
      }
      if (!rec.win.isDestroyed()) rec.win.close();
      windows.delete(id);
    }
    return result;
  });

  ipcMain.handle("window:minimize", (event, payload) => {
    const scope = resolveSenderScope(event);
    const id = typeof payload === "string" ? payload : payload?.id;
    if (!scope || !id || !isMutationAllowed(scope, id)) {
      return { ok: false, code: "sender_not_allowed" };
    }
    const rec = windows.get(id);
    recordGeometryNow(rec); // while still popped (core enforces state)
    const result = core.minimizeToRail(id);
    if (!result.ok) return result;
    if (rec && !rec.win.isDestroyed()) rec.win.hide();
    return result;
  });

  ipcMain.handle("window:restore", (event, payload) => {
    const scope = resolveSenderScope(event);
    const id = typeof payload === "string" ? payload : payload?.id;
    if (!scope || !id || !isMutationAllowed(scope, id)) {
      return { ok: false, code: "sender_not_allowed" };
    }
    const entry = core.getSnapshot().entries.find((e) => e.id === id);
    const spec = entry ? CONTENT_TYPES[entry.type] : null;
    const result = core.restoreFromRail(id);
    if (!result.ok) return result;
    return ensurePoppedWindow(id, spec, result);
  });

  ipcMain.handle("window:remove", (event, payload) => {
    const scope = resolveSenderScope(event);
    const id = typeof payload === "string" ? payload : payload?.id;
    if (!scope || !id || !isMutationAllowed(scope, id)) {
      return { ok: false, code: "sender_not_allowed" };
    }
    const result = core.remove(id);
    if (!result.ok) return result;
    const rec = windows.get(id);
    if (rec) {
      rec.expectingClose = true;
      if (rec.geometryTimer) {
        clearTimeout(rec.geometryTimer);
        rec.geometryTimer = null;
      }
      if (!rec.win.isDestroyed()) rec.win.destroy();
      windows.delete(id);
    }
    try {
      fs.writeFileSync(statePath(), JSON.stringify(core.serialize()));
    } catch {}
    return result;
  });

  ipcMain.handle("window:snapshot", (event) => {
    if (!resolveSenderScope(event)) return { ok: false, code: "sender_not_allowed" };
    return { ok: true, snapshot: core.getSnapshot() };
  });

  ipcMain.handle("window:self", (event) => {
    const scope = resolveSenderScope(event);
    if (!scope) return { ok: false, code: "sender_not_allowed" };
    return {
      ok: true,
      contentId: scope.kind === "managed" ? scope.id : null,
    };
  });

  app.once("before-quit", () => {
    exiting = true;
    for (const rec of windows.values()) {
      try {
        if (rec.geometryTimer) clearTimeout(rec.geometryTimer);
        if (!rec.win.isDestroyed()) rec.win.destroy();
      } catch {}
    }
    windows.clear();
    try {
      fs.writeFileSync(statePath(), JSON.stringify(core.serialize()));
    } catch {}
  });
}

module.exports = { setupWindowManagerIpc };
