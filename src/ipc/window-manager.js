const CHANNELS = require('./channels');
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
const { windowTitle } = require("../main/brand");

const GEOMETRY_RECORD_DEBOUNCE_MS = 400;
const RAIL_CONTENT_ID = "rail:";
// 轨道窗总宽 = 预览区 336 + 条带 28。hover 卡（320px）渲染在预览区内——
// 首版窗体只有 28px 宽，卡片整体被窗体裁剪（用户反馈「展示不全/hover 无预览」
// 的根因）。预览区透明 + ignoreMouseEvents 穿透，仅条带/卡交互时收鼠标。
const RAIL_WINDOW_WIDTH = 364;
const THUMBNAIL_WIDTH = 480;

// BLOCK-59 P2 — 终端等会话型数据的受管窗口转发钩子。terminal.js 在
// mainWindow 广播之外经此把 terminal:data/exit 送达承载该会话的独立窗
// （contentId = `terminal:<sessionId>`）。setup 前调用为 no-op。
let forwardToContentWindowRef = null;
function forwardToContentWindow(contentId, channel, payload) {
  try {
    forwardToContentWindowRef?.(contentId, channel, payload);
  } catch {}
}

function setupWindowManagerIpc({
  getMainWindow,
  getSpaBaseUrl,
  resolveResource,
} = {}) {
  const statePath = () =>
    path.join(app.getPath("userData"), "window-manager-state.json");

  let exiting = false;
  // BLOCK-154 波次 2 rider — 窗口状态持久化异步化：注入的 saveState 与降格轨道
  // 写盘由同步 writeFileSync 改串行异步链（事件循环不再被磁盘 IO 阻塞；链式串行
  // 保序，防旧状态晚写覆盖新状态）。exiting 检查放链内回调：before-quit 置位后
  // 未起跑的排队写立即作废，退出最终态由 before-quit 同步写落盘（退出耐久性）。
  // 残余窗口如实：已在途的单笔 writeFile 理论上仍可能晚于同步写落地且快照略旧
  // ——窗口几何场景下次 geometry 更新自愈，不值得为它上跨进程级方案。
  let stateWriteChain = Promise.resolve();
  const persistStateAsync = (serialized) => {
    stateWriteChain = stateWriteChain.then(async () => {
      if (exiting) return;
      try {
        await fs.promises.mkdir(path.dirname(statePath()), { recursive: true });
        await fs.promises.writeFile(statePath(), JSON.stringify(serialized));
      } catch {}
    });
  };

  const core = createWindowManagerCore({
    loadState: () => {
      try {
        return JSON.parse(fs.readFileSync(statePath(), "utf8"));
      } catch {
        return null;
      }
    },
    saveState: (serialized) => {
      persistStateAsync(serialized);
    },
  });

  // contentId → { win, expectingClose, geometryTimer }
  const windows = new Map();
  // contentId → dataURL。降格瞬间（窗口仍可见）截取的内容快照，供轨道
  // hover 卡预览；隐藏状态下不重截（静态结果窗内容不变，终端/agent 卡
  // 标注「快照于降格时」）。remove/return 时清理。
  const thumbnails = new Map();

  // ── Trusted-sender scoping ────────────────────────────────────
  // Main window may act on every content id; the rail window acts
  // on all entries too (hover-restore / explicit removal are the
  // rail's duties, plan §5); any other managed pop-out may act on
  // itself only. Foreign senders are rejected fail-closed.
  const resolveSenderScope = (event) => {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed()) return null;
    const main = getMainWindow();
    if (main && !main.isDestroyed() && sender === main.webContents) {
      return { kind: "main" };
    }
    for (const [id, rec] of windows.entries()) {
      if (!rec.win.isDestroyed() && sender === rec.win.webContents) {
        return { kind: id === RAIL_CONTENT_ID ? "rail" : "managed", id };
      }
    }
    return null;
  };

  const isMutationAllowed = (scope, id) =>
    scope.kind === "main" ||
    scope.kind === "rail" ||
    (scope.kind === "managed" && scope.id === id);

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

  // BLOCK-59 加映二 —— 降格瞬间的内容快照（窗口仍可见时 capturePage 可靠；
  // 隐藏后截取会得到空帧）。失败静默：轨道卡回退纯文本展示。
  const captureThumbnail = async (rec) => {
    if (!rec || rec.win.isDestroyed()) return;
    try {
      const image = await rec.win.webContents.capturePage();
      if (!image || image.isEmpty()) return;
      const scaled = image.getSize().width > THUMBNAIL_WIDTH
        ? image.resize({ width: THUMBNAIL_WIDTH })
        : image;
      thumbnails.set(rec.id, scaled.toDataURL());
    } catch {}
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
        win.webContents.send(CHANNELS.window.stateChanged, payload);
      } catch {}
    }
  };

  core.subscribe((event) => {
    broadcast(event);
    syncRailVisibility();
  });

  // ── 边缘活动轨道容器窗（BLOCK-59 P2，plan §5）─────────────────
  // 极窄 alwaysOnTop 条带：focusable:false 不抢键盘焦点 / skipTaskbar /
  // 透明窗体 + setIgnoreMouseEvents(true, {forward:true})——条带与 hover
  // 卡之外全部点击穿透给底层 app，渲染层在 mouseenter/leave 时切换。
  // 生命周期属 app 不属主窗（plan §5）；懒创建：第一个窗口被降格才建。
  const ensureRailWindow = () => {
    let rec = windows.get(RAIL_CONTENT_ID);
    if (rec && !rec.win.isDestroyed()) return rec;
    const spaBase = typeof getSpaBaseUrl === "function" ? getSpaBaseUrl() : null;
    if (!spaBase) return null;
    const displays = currentDisplays();
    const workArea = displays[0]?.workArea || displays[0]?.bounds || null;
    const height = Math.max(240, Math.min(600, (workArea ? workArea.height : 800) - 120));
    const win = new BrowserWindow({
      width: RAIL_WINDOW_WIDTH,
      height,
      x: workArea ? workArea.x + workArea.width - RAIL_WINDOW_WIDTH : undefined,
      y: workArea ? workArea.y + Math.floor((workArea.height - height) / 2) : undefined,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: resolveResource("src", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    try {
      win.setAlwaysOnTop(true, "floating");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
      win.setIgnoreMouseEvents(true, { forward: true });
    } catch {}
    rec = { id: RAIL_CONTENT_ID, win, expectingClose: false, geometryTimer: null };
    windows.set(RAIL_CONTENT_ID, rec);
    // 轨道无 ×（plan §4.1）；任何 close 请求一律隐藏，不销毁
    win.on("close", (event) => {
      if (rec.expectingClose || exiting) return;
      event.preventDefault();
      if (!win.isDestroyed()) win.hide();
    });
    win.on("closed", () => {
      windows.delete(RAIL_CONTENT_ID);
    });
    win.loadURL(new URL("/window/rail", spaBase).toString()).catch((e) => {
      console.error("[window-manager] rail loadURL failed:", e.message);
    });
    return rec;
  };

  const syncRailVisibility = () => {
    const railedCount = core
      .getSnapshot()
      .entries.filter((e) => e.state === "railed").length;
    if (railedCount > 0) {
      const rec = ensureRailWindow();
      if (rec && !rec.win.isDestroyed()) {
        try {
          rec.win.showInactive();
        } catch {}
      }
    } else {
      const rec = windows.get(RAIL_CONTENT_ID);
      if (rec && !rec.win.isDestroyed()) {
        try {
          rec.win.hide();
        } catch {}
      }
    }
  };

  // 渲染层 hover 条带/hover 卡时切换点击穿透（P2 plan §5）
  ipcMain.on(CHANNELS.window.railMouse, (event, payload) => {
    const rec = windows.get(RAIL_CONTENT_ID);
    if (!rec || rec.win.isDestroyed() || event.sender !== rec.win.webContents) return;
    try {
      rec.win.setIgnoreMouseEvents(payload?.ignore !== false, { forward: true });
    } catch {}
  });

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
      title: windowTitle(spec.title || "窗口"),
      frame: false,
      backgroundColor: "#1f2330",
      show: false,
      webPreferences: {
        preload: resolveResource("src", "preload.js"),
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
      // 快照后降格隐藏（capturePage 需要窗口可见，串行保证顺序）
      void captureThumbnail(rec).then(() => {
        core.minimizeToRail(id);
        if (!win.isDestroyed()) win.hide();
      });
    });

    win.on("closed", () => {
      if (rec.geometryTimer) {
        clearTimeout(rec.geometryTimer);
        rec.geometryTimer = null;
      }
      windows.delete(id);
      thumbnails.delete(id);
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

  const hideDemoted = async (contentId) => {
    if (!contentId) return;
    const rec = windows.get(contentId);
    if (rec && !rec.win.isDestroyed()) {
      await captureThumbnail(rec); // 降格前快照（可见态）
      if (!rec.win.isDestroyed()) rec.win.hide();
    }
  };

  // ── IPC surface (plan §4.3, additive) ─────────────────────────

  ipcMain.handle(CHANNELS.window.popOut, (_event, payload) => {
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

  // ── UI-385 — 子智能体/结果独立窗退役后的下钻通道 ──────────────
  // 指挥中心等独立窗不再弹 result 窗：调用本 handler 把载荷转发到主窗，
  // 由主窗渲染层（preload relay → gewu:project-open-artifact）在右栏打开。
  // 只放行单一白名单事件类型（SEC-HARDEN：不做成通用事件注入通道）。
  ipcMain.handle(CHANNELS.window.openResultInMain, (_event, payload) => {
    const scope = resolveSenderScope(_event);
    if (!scope) return { ok: false, code: "sender_not_allowed" };
    const type = payload && payload.type;
    if (type !== "gewu:project-open-artifact") {  // 协议类型 tag，真源=frontend/src/lib/events.ts（SEC-HARDEN 白名单）
      return { ok: false, code: "type_not_allowed" };
    }
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return { ok: false, code: "main_window_unavailable" };
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
    main.webContents.send(CHANNELS.window.relayToMain, payload);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.window.return, (event, payload) => {
    const scope = resolveSenderScope(event);
    const id = typeof payload === "string" ? payload : payload?.id;
    if (!scope || !id || !isMutationAllowed(scope, id)) {
      return { ok: false, code: "sender_not_allowed" };
    }
    const result = core.returnToDock(id);
    if (!result.ok) return result;
    thumbnails.delete(id);
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

  ipcMain.handle(CHANNELS.window.minimize, async (event, payload) => {
    const scope = resolveSenderScope(event);
    const id = typeof payload === "string" ? payload : payload?.id;
    if (!scope || !id || !isMutationAllowed(scope, id)) {
      return { ok: false, code: "sender_not_allowed" };
    }
    const rec = windows.get(id);
    recordGeometryNow(rec); // while still popped (core enforces state)
    if (rec && !rec.win.isDestroyed()) await captureThumbnail(rec); // 降格前快照（可见态）
    const result = core.minimizeToRail(id);
    if (!result.ok) return result;
    if (rec && !rec.win.isDestroyed()) rec.win.hide();
    return result;
  });

  ipcMain.handle(CHANNELS.window.restore, (event, payload) => {
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

  ipcMain.handle(CHANNELS.window.remove, (event, payload) => {
    const scope = resolveSenderScope(event);
    const id = typeof payload === "string" ? payload : payload?.id;
    if (!scope || !id || !isMutationAllowed(scope, id)) {
      return { ok: false, code: "sender_not_allowed" };
    }
    const result = core.remove(id);
    if (!result.ok) return result;
    thumbnails.delete(id);
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
    persistStateAsync(core.serialize());
    return result;
  });

  ipcMain.handle(CHANNELS.window.snapshot, (event) => {
    if (!resolveSenderScope(event)) return { ok: false, code: "sender_not_allowed" };
    return { ok: true, snapshot: core.getSnapshot() };
  });

  ipcMain.handle(CHANNELS.window.self, (event) => {
    const scope = resolveSenderScope(event);
    if (!scope) return { ok: false, code: "sender_not_allowed" };
    return {
      ok: true,
      contentId: scope.kind === "managed" ? scope.id : null,
    };
  });

  // BLOCK-59 加映二 —— 轨道 hover 卡内容预览：降格瞬间快照（不可用时
  // ok:false，卡回退纯文本）。仅受信 sender 可读。
  ipcMain.handle(CHANNELS.window.thumbnail, (event, payload) => {
    if (!resolveSenderScope(event)) return { ok: false, code: "sender_not_allowed" };
    const id = typeof payload === "string" ? payload : payload?.id;
    const dataUrl = id ? thumbnails.get(id) : null;
    return { ok: !!dataUrl, dataUrl: dataUrl || null };
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

  forwardToContentWindowRef = (contentId, channel, payload) => {
    const rec = windows.get(contentId);
    if (!rec || rec.win.isDestroyed()) return;
    try {
      rec.win.webContents.send(channel, payload);
    } catch {}
  };
}

module.exports = { setupWindowManagerIpc, forwardToContentWindow };
