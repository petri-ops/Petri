// ============================================================
// Window Manager core — BLOCK-59 P0
//
// Pure state machine + content-type registry for the window
// system (docked / popped / railed / closed). No Electron
// dependency: BrowserWindow lifecycle lives in the adapter
// (src/ipc/window-manager.js), which injects persistence and
// consumes the transition events emitted here.
//
// Immutable contract (plan §3, §9): × always DEMOTES to the
// edge rail, never destroys. Destruction has exactly one path:
// explicit removal from the rail (remove()). The command
// center and rail container are singletons and intentionally
// stay OUT of the state machine (plan §4.1).
//
// All mutating ops return { ok: true, ... } or
// { ok: false, code, error } — callers must not infer state.
// ============================================================

const MAX_POPPED_WINDOWS = 4;

// Static (completed result) railed entries fade in the rail
// after 5 minutes; persistent ones (terminal/agent) never do.
// Fade is a rail-visual concern — the window stays alive and
// restorable (hidden keep-alive), so the contract is intact.
const RAIL_STATIC_FADE_MS = 5 * 60 * 1000;

// Content keys are artifact/session/task identifiers. Artifact
// names may be non-ASCII (delivery manifests are user-facing);
// safety comes from buildRouteForId running encodeURIComponent —
// the raw key only has to stay free of URL-structure and control
// characters so the encoded route stays unambiguous.
const KEY_PATTERN = /^[^\/\\?#"'\s\u0000-\u001f\u007f%]{1,128}$/;

const CONTENT_TYPES = {
  result: {
    routePrefix: "/window/result",
    closeBehavior: "rail", // × → rail
    railClass: "static", // 5min fade candidate in the rail
    restore: "route", // restore = route reload
    singleton: false,
    title: "结果",
    defaultBounds: { width: 960, height: 680 },
  },
  terminal: {
    routePrefix: "/window/terminal",
    closeBehavior: "rail",
    railClass: "persistent",
    restore: "session", // restorable while the pty session lives
    singleton: false,
    title: "终端",
    defaultBounds: { width: 880, height: 600 },
  },
  agent: {
    routePrefix: "/window/agent",
    closeBehavior: "rail",
    railClass: "persistent",
    restore: "task", // restorable while the task state lives
    singleton: false,
    title: "Agent",
    defaultBounds: { width: 960, height: 680 },
  },
  "command-center": {
    routePrefix: "/window/command-center",
    closeBehavior: "close", // stateless singleton: × = real close
    singleton: true,
    title: "指挥中心",
    defaultBounds: { width: 1200, height: 820 },
  },
  rail: {
    internal: true, // rail container: no route, no ×, adapter-only
    closeBehavior: "none",
    singleton: true,
    title: "活动轨道",
    defaultBounds: { width: 28, height: 600 },
  },
};

function isSingletonType(type) {
  const spec = CONTENT_TYPES[type];
  return !!spec && spec.singleton === true;
}

/** Fail-closed route whitelist: unknown type or malformed key is
 *  rejected here so the adapter can never receive a route to
 *  load that the registry did not declare. */
function validateContent({ type, key }) {
  const spec = CONTENT_TYPES[type];
  if (!spec || spec.internal) {
    return { ok: false, code: "route_not_allowed", error: `窗口类型不在白名单: ${String(type)}` };
  }
  if (spec.singleton) {
    if (key != null && key !== "") {
      return { ok: false, code: "invalid_key", error: "单例窗口不接受内容键" };
    }
    return { ok: true, id: `${type}:`, spec, key: "" };
  }
  if (typeof key !== "string" || key === "." || key === ".." || !KEY_PATTERN.test(key)) {
    return { ok: false, code: "invalid_key", error: `内容键不合法: ${String(key).slice(0, 32)}` };
  }
  return { ok: true, id: `${type}:${key}`, spec, key };
}

/** Build the SPA route for a content id. Only ever called with
 *  ids that passed validateContent — re-derived from the id so
 *  the route and the registry entry can never drift apart. */
function buildRouteForId(id) {
  const sep = id.indexOf(":");
  const type = id.slice(0, sep);
  const key = id.slice(sep + 1);
  const spec = CONTENT_TYPES[type];
  if (!spec || spec.internal || spec.routePrefix == null) return null;
  if (spec.singleton) return spec.routePrefix;
  return `${spec.routePrefix}/${encodeURIComponent(key)}`;
}

function isFiniteInt(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validate a geometry record { x, y, w, h, displayId? }. */
function isValidGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return false;
  if (!isFiniteInt(geometry.x) || !isFiniteInt(geometry.y)) return false;
  if (!isFiniteInt(geometry.w) || !isFiniteInt(geometry.h)) return false;
  if (geometry.w <= 0 || geometry.h <= 0) return false;
  if (geometry.displayId != null && !isFiniteInt(geometry.displayId)) return false;
  return true;
}

function clampBoundsToWorkArea(bounds, workArea) {
  if (!workArea) return bounds;
  const width = Math.min(bounds.w, workArea.width);
  const height = Math.min(bounds.h, workArea.height);
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width));
  const y = Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height));
  return { x, y, w: width, h: height };
}

/**
 * Create the window manager core.
 *
 * @param {object}  deps
 * @param {number}  [deps.maxPopped]     - popped concurrency limit (default 4)
 * @param {function} [deps.now]          - clock injection for tests
 * @param {function} [deps.loadState]    - () => raw persisted object | null
 * @param {function} [deps.saveState]    - (serialized) => void (adapter debounces)
 */
function createWindowManagerCore({ maxPopped = MAX_POPPED_WINDOWS, now = Date.now, loadState, saveState } = {}) {
  // contentId → entry. Entries exist for state-machine content
  // only (singletons are tracked by the adapter, plan §3).
  const registry = new Map();
  // contentId → { x, y, w, h, displayId } main-process-owned
  // position memory (plan §4.2 裁决 4), persisted via saveState.
  const geometryMemory = new Map();
  const subscribers = new Set();

  const publicEntry = (entry) => ({
    id: entry.id,
    type: entry.type,
    key: entry.key,
    state: entry.state,
    railClass: entry.railClass,
    fadeAfter: entry.state === "railed" && entry.railClass === "static"
      ? entry.railedAt + RAIL_STATIC_FADE_MS
      : null,
    createdAt: entry.createdAt,
    poppedAt: entry.poppedAt,
    railedAt: entry.railedAt,
  });

  const emit = (event) => {
    for (const fn of subscribers) {
      try {
        fn(event);
      } catch {}
    }
  };

  const upsertEvent = (entry) => emit({ kind: "upsert", entry: publicEntry(entry) });

  // Persistence is rate-limited by the adapter (geometry records
  // are debounced there); the core writes eagerly so the last
  // recorded position always survives.
  const persist = () => {
    if (typeof saveState !== "function") return;
    try {
      saveState(serialize());
    } catch {}
  };

  const ensureEntry = (id, type, key) => {
    let entry = registry.get(id);
    if (!entry) {
      entry = {
        id,
        type,
        key,
        state: "docked",
        railClass: CONTENT_TYPES[type].railClass,
        createdAt: now(),
        poppedAt: null,
        railedAt: null,
      };
      registry.set(id, entry);
    }
    return entry;
  };

  const poppedEntries = () =>
    [...registry.values()].filter((e) => e.state === "popped");

  /** Demote the oldest popped window to the rail. Returns the
   *  demoted entry or null (nothing popped). */
  const autoDemoteOldest = () => {
    const candidates = poppedEntries().sort((a, b) => a.poppedAt - b.poppedAt);
    const victim = candidates[0];
    if (!victim) return null;
    victim.state = "railed";
    victim.railedAt = now();
    upsertEvent(victim);
    return victim;
  };

  const enforcePopLimit = () => {
    let demoted = null;
    while (poppedEntries().length >= maxPopped) {
      const victim = autoDemoteOldest();
      if (!victim) break;
      demoted = victim;
    }
    return demoted;
  };

  // ── Hydration (geometry memory survives restart; windows do not) ──
  if (typeof loadState === "function") {
    try {
      const raw = loadState();
      if (raw && typeof raw === "object" && raw.geometry && typeof raw.geometry === "object") {
        for (const [id, geometry] of Object.entries(raw.geometry)) {
          if (typeof id === "string" && id.includes(":") && isValidGeometry(geometry)) {
            geometryMemory.set(id, {
              x: geometry.x,
              y: geometry.y,
              w: geometry.w,
              h: geometry.h,
              displayId: geometry.displayId ?? null,
            });
          }
        }
      }
    } catch {}
  }

  function serialize() {
    const geometry = {};
    for (const [id, geometry0] of geometryMemory.entries()) {
      geometry[id] = { ...geometry0 };
    }
    return { version: 1, savedAt: now(), geometry };
  }

  // ── Content resolution (route whitelist, fail-closed) ─────────

  function resolveContent(params) {
    const verdict = validateContent(params || {});
    if (!verdict.ok) return verdict;
    return { ok: true, id: verdict.id, key: verdict.key, spec: verdict.spec };
  }

  // ── State machine ops ─────────────────────────────────────────

  /** docked → popped. Same-content pop = focus existing; railed
   *  content pops back from the rail. Over-limit pops auto-demote
   *  the oldest popped window (plan §3). */
  function popOut({ type, key }) {
    const verdict = validateContent({ type, key });
    if (!verdict.ok) return verdict;
    const { id, spec } = verdict;

    if (spec.singleton) {
      return { ok: true, id, action: "singleton", spec };
    }

    const existing = registry.get(id);
    if (existing && existing.state === "popped") {
      return { ok: true, id, action: "focused" }; // 同内容禁双开
    }
    if (existing && existing.state === "railed") {
      const demoted = enforcePopLimit();
      existing.state = "popped";
      existing.poppedAt = now();
      existing.railedAt = null;
      upsertEvent(existing);
      return { ok: true, id, action: "restored", autoDemoted: demoted ? demoted.id : null };
    }

    const demoted = enforcePopLimit();
    const entry = ensureEntry(id, type, verdict.key);
    entry.state = "popped";
    entry.poppedAt = now();
    upsertEvent(entry);
    return { ok: true, id, action: "created", autoDemoted: demoted ? demoted.id : null };
  }

  /** popped → railed. The × semantics: DEMOTE, never destroy. */
  function minimizeToRail(id) {
    const entry = registry.get(id);
    if (!entry || entry.state !== "popped") {
      return { ok: false, code: "invalid_transition", error: `窗口不可降格: ${id}` };
    }
    entry.state = "railed";
    entry.railedAt = now();
    upsertEvent(entry);
    return { ok: true, id, state: "railed" };
  }

  /** railed → popped (rail hover / click restore). */
  function restoreFromRail(id) {
    const entry = registry.get(id);
    if (!entry || entry.state !== "railed") {
      return { ok: false, code: "invalid_transition", error: `窗口不可从轨道恢复: ${id}` };
    }
    const demoted = enforcePopLimit();
    entry.state = "popped";
    entry.poppedAt = now();
    entry.railedAt = null;
    upsertEvent(entry);
    return { ok: true, id, state: "popped", autoDemoted: demoted ? demoted.id : null };
  }

  /** popped → docked. The pop-out window is destroyed by the
   *  adapter; the content lives on in the main window. The entry
   *  stays (state docked) so the renderer can reconcile. */
  function returnToDock(id) {
    const entry = registry.get(id);
    if (!entry || entry.state !== "popped") {
      return { ok: false, code: "invalid_transition", error: `窗口不可收回: ${id}` };
    }
    entry.state = "docked";
    entry.poppedAt = null;
    upsertEvent(entry);
    return { ok: true, id, state: "docked" };
  }

  /** railed → closed. The ONLY destruction path (plan §3). */
  function remove(id) {
    const entry = registry.get(id);
    if (!entry || entry.state !== "railed") {
      return { ok: false, code: "invalid_transition", error: `仅轨道内窗口可移除: ${id}` };
    }
    registry.delete(id);
    emit({ kind: "remove", id });
    return { ok: true, id, state: "closed" };
  }

  // ── Geometry (main-process position memory, plan §4.2) ────────

  function recordGeometry(id, geometry) {
    const entry = registry.get(id);
    if (!entry) return { ok: false, code: "unknown_content", error: `未登记内容: ${id}` };
    if (entry.state !== "popped") return { ok: false, code: "invalid_state" };
    if (!isValidGeometry(geometry)) return { ok: false, code: "invalid_geometry" };
    geometryMemory.set(id, {
      x: Math.round(geometry.x),
      y: Math.round(geometry.y),
      w: Math.round(geometry.w),
      h: Math.round(geometry.h),
      displayId: isFiniteInt(geometry.displayId) ? geometry.displayId : null,
    });
    persist();
    return { ok: true };
  }

  function forgetGeometry(id) {
    geometryMemory.delete(id);
    persist();
  }

  /** Resolve launch bounds for a (re)spawned pop-out window.
   *  Saved geometry wins when its display still exists and the
   *  window would be reachable; otherwise fall back to a
   *  cascaded default on the primary work area (副屏失效回落,
   *  plan §4.2 裁决 4). */
  function resolveLaunchBounds(id, { displays = [], mainBounds = null } = {}) {
    const sep = id.indexOf(":");
    const spec = CONTENT_TYPES[id.slice(0, sep)] || {};
    const saved = geometryMemory.get(id);
    const savedDisplay = saved && saved.displayId != null
      ? displays.find((d) => d.id === saved.displayId)
      : null;
    if (saved && savedDisplay) {
      return { bounds: { ...saved }, reusedMemory: true, displayId: savedDisplay.id };
    }
    if (saved && saved.displayId == null && displays.length > 0) {
      const workArea = displays[0].workArea || displays[0].bounds;
      return {
        bounds: clampBoundsToWorkArea(saved, workArea),
        reusedMemory: true,
        displayId: displays[0].id,
      };
    }

    const primary = displays[0];
    const base = mainBounds || (primary ? primary.workArea || primary.bounds : null);
    const cascadeIndex = poppedEntries().length % 8;
    const fallback = {
      x: (base ? base.x : 0) + 48 + cascadeIndex * 32,
      y: (base ? base.y : 0) + 48 + cascadeIndex * 32,
      w: spec.defaultBounds ? spec.defaultBounds.width : 960,
      h: spec.defaultBounds ? spec.defaultBounds.height : 680,
    };
    const workArea = primary ? primary.workArea || primary.bounds : null;
    return {
      bounds: clampBoundsToWorkArea(fallback, workArea),
      reusedMemory: false,
      displayId: primary ? primary.id : null,
    };
  }

  // ── Snapshot / subscription (renderer hydration + multicast) ──

  function getSnapshot() {
    return {
      maxPopped,
      entries: [...registry.values()].map(publicEntry),
      singletons: {
        commandCenter: { type: "command-center", route: CONTENT_TYPES["command-center"].routePrefix },
      },
    };
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return {
    popOut,
    minimizeToRail,
    restoreFromRail,
    returnToDock,
    remove,
    resolveContent,
    buildRouteForId,
    recordGeometry,
    forgetGeometry,
    resolveLaunchBounds,
    getSnapshot,
    subscribe,
    serialize,
  };
}

module.exports = {
  createWindowManagerCore,
  validateContent,
  buildRouteForId,
  isValidGeometry,
  clampBoundsToWorkArea,
  CONTENT_TYPES,
  MAX_POPPED_WINDOWS,
  RAIL_STATIC_FADE_MS,
  KEY_PATTERN,
};
