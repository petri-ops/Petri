'use strict';

/**
 * helpers/permissions-contract.js — 权限契约纯面（item 86 环解耦抽取）。
 *
 * 从 permissions.js 抽出零依赖的契约面（键表/默认值/解析/归一化），供
 * guest-permissions 与 permissions 双向共用。原状 guest-permissions → permissions
 * （拿这三个符号）与 permissions → guest-permissions（moduleGate 游客兜底）构成
 * E 族环；抽取后两边都只指向本模块，图单向化：
 *   permissions → guest-permissions → permissions-contract
 *   permissions → permissions-contract
 * 本模块禁止 require 任何业务模块（保持纯面，零 db）。
 */

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

function parsePerms(userRow) {
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
  return resolveModulePermission(parsePerms(userRow), moduleKey, DEFAULT_PERMS);
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

module.exports = {
  MODULE_KEYS,
  DEFAULT_PERMS,
  MODULE_MSG,
  resolveModulePermission,
  normalizePermissionsForStore,
  can,
  effectivePermissions,
};
