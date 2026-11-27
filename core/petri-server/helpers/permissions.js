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

// item 86 环解耦 — 纯契约面（键表/默认值/解析/归一化）已抽到 permissions-contract.js，
// 本模块与 guest-permissions 都指向它，E 族环（双向 require）消亡。
// 行为零变化：下方 re-export 保持原导入路径兼容。
const {
  MODULE_KEYS,
  DEFAULT_PERMS,
  MODULE_MSG,
  resolveModulePermission,
  normalizePermissionsForStore,
  can,
  effectivePermissions,
} = require('./permissions-contract');

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
