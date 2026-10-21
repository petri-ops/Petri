/**
 * helpers/permissions.js — MODULE_PERMS_v1
 *
 * Per-user feature-module authorization. Replaces the old "invite code" gate
 * with admin-controlled per-user module access.
 *
 * Modules (granularity 1 — module level):
 *   - docs        教程/文档（公开，默认开）
 *   - data        通用项目数据面（读写/计算）；单细胞/空间等历史专用键为其 legacy 别名
 *   - tools       在线分析工具 + FigCode 在线绘图
 *   - copilot     AI 助手（烧钱 → 管理员手动开）
 *
 * Storage: users.permissions is a JSON string (or NULL = use defaults).
 *   e.g. {"copilot": true, "tools": false}
 *   Only keys present override the default; missing keys fall back to DEFAULT_PERMS.
 *
 * Design notes:
 *   - Permissions are read from the DB on each gated request (NOT baked into the
 *     JWT) so an admin grant/revoke takes effect without forcing re-login.
 *   - admin role bypasses all gates.
 *   - Reserved field `tools_only` (array of toolIds) is parsed but not yet
 *     enforced — placeholder for future granularity-2 (per-tool) without a
 *     schema change.
 */

const dbMod = require('../db');

const MODULE_KEYS = [
  'docs',
  'blog',
  'figcode',
  'tools',
  'skills',
  'data',
  'single-cell',
  'spatial',
  'copilot',
];

// `data` is the generic data-plane permission; legacy domain keys stay valid
// aliases so stored permission JSON needs no migration. Any explicit true in
// the group grants `data`, mirroring the old OR gate.
const DATA_MODULE_KEYS = ['data', 'single-cell', 'spatial'];

// Default module access for users whose permissions column is NULL or omits a key.
// Decision (2026-05-31, author): copilot 改为**默认开** —— 所有用户注册后即可用 AI 助手。
// 教程/博客/FigCode 仍对所有用户和游客完全公开（PUBLIC_MODULES）；
// 工具/Skills/数据面 默认关，由管理员按用户（未来按等级）放开。
const DEFAULT_PERMS = {
  docs: true, // 教程（公开）
  blog: true, // 博客（公开）
  figcode: true, // FigCode 绘图代码集（公开浏览/复制）
  tools: false, // 在线分析工具
  skills: false, // Skills 库
  data: false, // 项目数据面（通用资源权限）
  'single-cell': false, // legacy 别名 → data
  spatial: false, // legacy 别名 → data
  copilot: true, // AI 助手（默认开放给所有登录用户）
};

// User-facing 403 / guard messages per module.
const MODULE_MSG = {
  docs: '该教程暂未对你的账号开放，如需查看请联系管理员。',
  blog: '博客暂未对你的账号开放，如需查看请联系管理员。',
  figcode: 'FigCode 暂未对你的账号开放，如需使用请联系管理员。',
  tools: '在线分析工具暂未对你的账号开放，如需使用请联系管理员。',
  skills: 'Skills 库暂未对你的账号开放，如需查看请联系管理员。',
  data: '项目数据功能暂未对你的账号开放，如需使用请联系管理员。',
  copilot: 'AI 助手功能暂未对你的账号开放，如需使用请联系管理员。',
};

function _parsePerms(userRow) {
  if (!userRow || !userRow.permissions) return {};
  try {
    const obj = JSON.parse(userRow.permissions);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

/**
 * Resolve one module key against a parsed permission map.
 * For `data`, the legacy domain keys act as aliases: any explicitly stored
 * true in the group grants access; only when none is stored do defaults apply.
 * Other keys keep the original per-key semantics (explicit wins, else default).
 */
function resolveModulePermission(perms, moduleKey, defaults = DEFAULT_PERMS) {
  const has = (key) => Object.prototype.hasOwnProperty.call(perms, key);
  if (moduleKey === 'data') {
    const explicit = DATA_MODULE_KEYS.filter(has);
    if (explicit.length > 0) return explicit.some((key) => !!perms[key]);
    return DATA_MODULE_KEYS.some((key) => defaults[key] === true);
  }
  if (has(moduleKey)) return !!perms[moduleKey];
  return defaults[moduleKey] === true;
}

/**
 * Does this user (DB row) have access to a module?
 * admin → always true. Otherwise: explicit permission wins, else DEFAULT_PERMS.
 */
function can(userRow, moduleKey) {
  if (!userRow) return false;
  if (userRow.role === 'admin') return true;
  return resolveModulePermission(_parsePerms(userRow), moduleKey, DEFAULT_PERMS);
}

/** Resolve the full effective permission map for a user row (for /auth/me + admin UI). */
function effectivePermissions(userRow) {
  const out = {};
  for (const k of MODULE_KEYS) out[k] = can(userRow, k);
  return out;
}

/**
 * Normalize a permissions input (from admin UI) into a JSON string for storage,
 * or null to reset to defaults. Accepts an object, a JSON string, or null.
 */
function normalizePermissionsForStore(input) {
  if (input === null || input === undefined) return null;
  let obj = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const clean = {};
  for (const k of MODULE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) clean[k] = !!obj[k];
  }
  // Preserve reserved per-tool whitelist if provided (granularity-2 placeholder).
  if (Array.isArray(obj.tools_only))
    clean.tools_only = obj.tools_only.filter((x) => typeof x === 'string');
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

function _userIdOf(req) {
  return (req.user && (req.user.id || req.user.userId)) || null;
}

/** Core gate: look up the live DB row and enforce module access. */
function _enforce(moduleKeys, req, res, next) {
  // admin (role or legacy X-API-Token) bypasses everything.
  if (req.user && req.user.role === 'admin') return next();
  const keys = Array.isArray(moduleKeys) ? moduleKeys : [moduleKeys];
  const primary = keys[0];
  const uid = _userIdOf(req);
  if (!uid) {
    let guestOk = false;
    try {
      const gp = require('./guest-permissions');
      guestOk = keys.some((k) => gp.canGuest(k));
    } catch {
      /* ignore */
    }
    if (guestOk) return next();
    return res.status(403).json({
      status: 'error',
      error: 'module_forbidden',
      module: primary,
      message: '该功能暂未对游客开放，请登录或联系管理员。',
    });
  }
  let row = null;
  try {
    row = dbMod.getUserById(uid);
  } catch {
    /* fall through */
  }
  if (!row) return res.status(401).json({ status: 'error', error: '未登录' });
  if (keys.some((k) => can(row, k))) return next();
  return res.status(403).json({
    status: 'error',
    error: 'module_forbidden',
    module: primary,
    message: MODULE_MSG[primary] || '该功能暂未对你的账号开放。',
  });
}

/**
 * Single centralized gate middleware. Mount once after auth, before routes.
 * Maps request paths/methods to the module they belong to, then enforces.
 *
 * NOTE on coverage (static-site architecture):
 *   - Backend can only gate API-backed operations. Static content modules
 *     (docs/blog/figcode/skills) have no server route to intercept — those are
 *     guarded on the frontend (nav hide + RouteGuard). This gate covers the
 *     cost-/data-sensitive API surface: copilot / tools / data.
 *   - /api/data is the shared data plane gated by the generic `data`
 *     permission; legacy single-cell/spatial keys resolve into the same group.
 *   - Domain compute runs locally inside petri-server（BLOCK-30 P1 前在独立 py-server，/api/py/*）,
 *     covered by this petri-server gate; add an equivalent check there when
 *     async task dispatch goes live (currently placeholder).
 */
function moduleGate(req, res, next) {
  const p = req.path;
  const m = req.method;

  const runGate = (moduleKeys) => {
    _enforce(moduleKeys, req, res, next);
  };

  // --- copilot: all /api/ai routes except health + admin ---
  if (p.startsWith('/api/ai')) {
    if (p === '/api/ai/health') return next();
    if (p.startsWith('/api/ai/admin')) return next();
    return runGate('copilot');
  }

  // --- online tool job submission → tools ---
  if (m === 'POST' && p === '/api/tools/run') {
    return runGate('tools');
  }

  // --- raw R execution (/api/run): shared by FigCode 在线绘图 + r-playground +
  //     replots. Although the FigCode *page* is public, actually RUNNING R code
  //     is a compute cost → require a compute-capable module (`data` included).
  //     (Guests / view-only users can browse + copy FigCode code, just not run.)
  if (m === 'POST' && p === '/api/run') {
    return runGate(['tools', 'data']);
  }

  // --- data plane: shared project/dataset/analysis writes (generic resource gate) ---
  if (p.startsWith('/api/data/') && (m === 'POST' || m === 'PUT' || m === 'DELETE')) {
    return runGate('data');
  }

  return next();
}

/** True if this request is subject to moduleGate (guest or logged-in perms). */
function routeRequiresModuleGate(req) {
  const p = req.path;
  const m = req.method;
  if (p.startsWith('/api/ai')) {
    if (p === '/api/ai/health') return false;
    if (p.startsWith('/api/ai/admin')) return false;
    return true;
  }
  if (m === 'POST' && p === '/api/tools/run') return true;
  if (m === 'POST' && p === '/api/run') return true;
  if (p.startsWith('/api/data/') && (m === 'POST' || m === 'PUT' || m === 'DELETE')) return true;
  return false;
}

module.exports = {
  MODULE_KEYS,
  DEFAULT_PERMS,
  can,
  resolveModulePermission,
  effectivePermissions,
  normalizePermissionsForStore,
  moduleGate,
  routeRequiresModuleGate,
};
