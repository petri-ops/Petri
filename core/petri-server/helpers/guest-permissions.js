/**
 * Guest (未登录游客) module permissions — stored in site_settings.
 * Admins configure via /admin → 用户管理 → 游客权限.
 *
 * Reads use an in-process TTL cache (30s). Writes invalidate cache immediately.
 */

const dbMod = require('../db');
const { MODULE_KEYS, normalizePermissionsForStore, resolveModulePermission } = require('./permissions');

const SITE_KEY = 'guest_permissions';

/** Default for guests: only public content; no compute-heavy modules. */
const GUEST_DEFAULT_PERMS = {
  docs: true,
  blog: true,
  figcode: true,
  tools: false,
  skills: false,
  data: false,
  'single-cell': false,
  spatial: false,
  copilot: false,
};

const CACHE_TTL_MS = 30_000;
const _cache = { perms: null, ts: 0 };

function _invalidateCache() {
  _cache.perms = null;
  _cache.ts = 0;
}

function _parseStored(json) {
  if (!json) return {};
  try {
    const obj = JSON.parse(json);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

/** Sync read with a 30s in-process cache. */
function effectiveGuestPermissions() {
  if (_cache.perms && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.perms;
  }
  let raw = null;
  try {
    raw = getGuestPermissionsRaw();
  } catch {
    /* fall through */
  }
  const overrides = _parseStored(raw);
  const out = {};
  for (const k of MODULE_KEYS) {
    out[k] = resolveModulePermission(overrides, k, GUEST_DEFAULT_PERMS);
  }
  _cache.perms = out;
  _cache.ts = Date.now();
  return out;
}

function getGuestPermissionsRaw() {
  try {
    const row = dbMod.getSiteSetting(SITE_KEY);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

/** Effective map for all MODULE_KEYS (for API + frontend). */
function effectiveGuestPermissionsForApi() {
  return effectiveGuestPermissions();
}

/** Async read for the copilot permission gate. */
async function effectiveGuestPermissionsAsync() {
  let raw = null;
  try {
    if (dbMod.getSiteSettingAsync) {
      const row = await dbMod.getSiteSettingAsync(SITE_KEY);
      raw = row ? row.value : null;
    } else {
      raw = getGuestPermissionsRaw();
    }
  } catch {
    raw = null;
  }
  const overrides = _parseStored(raw);
  const out = {};
  for (const k of MODULE_KEYS) {
    out[k] = resolveModulePermission(overrides, k, GUEST_DEFAULT_PERMS);
  }
  return out;
}

async function canGuestAsync(moduleKey) {
  const perms = await effectiveGuestPermissionsAsync();
  return !!perms[moduleKey];
}

function canGuest(moduleKey) {
  const perms = effectiveGuestPermissions();
  return !!perms[moduleKey];
}

function setGuestPermissions(input) {
  _invalidateCache();
  const normalized = normalizePermissionsForStore(input);
  try {
    dbMod.setSiteSetting(SITE_KEY, normalized);
  } catch (e) {
    console.warn(`[guest-perms] setSiteSetting failed: ${e.message}`);
  }
  return effectiveGuestPermissions();
}

async function getGuestPermissionsRawAsync() {
  try {
    if (dbMod.getSiteSettingAsync) {
      const row = await dbMod.getSiteSettingAsync(SITE_KEY);
      return row ? row.value : null;
    }
    return getGuestPermissionsRaw();
  } catch {
    return null;
  }
}

async function setGuestPermissionsAsync(input) {
  _invalidateCache();
  const normalized = normalizePermissionsForStore(input);
  try {
    if (dbMod.setSiteSettingAsync) {
      await dbMod.setSiteSettingAsync(SITE_KEY, normalized);
    } else {
      dbMod.setSiteSetting(SITE_KEY, normalized);
    }
  } catch (e) {
    console.warn(`[guest-perms] setSiteSetting failed: ${e.message}`);
  }
  return effectiveGuestPermissionsAsync();
}

module.exports = {
  SITE_KEY,
  GUEST_DEFAULT_PERMS,
  MODULE_KEYS,
  getGuestPermissionsRaw,
  getGuestPermissionsRawAsync,
  effectiveGuestPermissions,
  effectiveGuestPermissionsForApi,
  canGuest,
  canGuestAsync,
  effectiveGuestPermissionsAsync,
  setGuestPermissions,
  setGuestPermissionsAsync,
};
