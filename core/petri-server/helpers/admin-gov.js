/**
 * helpers/admin-gov.js — ADMIN_AI_GOV_v1 (global pause helpers)
 *
 * Extracted from server.js. Pure module: depends only on ../db.
 *
 * Public API:
 *   isAgentGloballyPaused() → bool
 *   isAgentGloballyPausedAsync() → Promise<bool>
 *   setAgentGlobalPause(paused, byAdminId)
 *   setAgentGlobalPauseAsync(paused, byAdminId)
 */

const dbMod = require('../db');
const db = dbMod.getDatabase();
const adb = dbMod.getAsyncDatabase ? dbMod.getAsyncDatabase() : null;

let pauseCache = {value: false, ts: 0};
const PAUSE_CACHE_MS = 30_000;

// One-time idempotent table creation.
db.exec(`
  CREATE TABLE IF NOT EXISTS copilot_global_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  );
`);

function isAgentGloballyPaused() {
  if (Date.now() - pauseCache.ts < PAUSE_CACHE_MS) return pauseCache.value;
  try {
    const row = db.prepare("SELECT value FROM copilot_global_settings WHERE key='agent_paused'").get();
    pauseCache = {value: !!(row && row.value === '1'), ts: Date.now()};
    return pauseCache.value;
  } catch { return pauseCache.value || false; }
}

async function isAgentGloballyPausedAsync() {
  if (Date.now() - pauseCache.ts < PAUSE_CACHE_MS) return pauseCache.value;
  try {
    const handle = adb || dbMod.getAsyncDatabase();
    const row = await handle.prepare("SELECT value FROM copilot_global_settings WHERE key='agent_paused'").get();
    pauseCache = {value: !!(row && row.value === '1'), ts: Date.now()};
    return pauseCache.value;
  } catch {
    return pauseCache.value || false;
  }
}

function setAgentGlobalPause(paused, byAdminId) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO copilot_global_settings(key, value, updated_at) VALUES ('agent_paused', ?, ?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(paused ? '1' : '0', now);
  pauseCache = {value: !!paused, ts: Date.now()};
  console.log('[admin] agent_global_pause=' + (paused ? 'on' : 'off') + ' by ' + (byAdminId || 'unknown'));
}

async function setAgentGlobalPauseAsync(paused, byAdminId) {
  const now = new Date().toISOString();
  const handle = adb || dbMod.getAsyncDatabase();
  await handle.prepare(`INSERT INTO copilot_global_settings(key, value, updated_at) VALUES ('agent_paused', ?, ?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(paused ? '1' : '0', now);
  pauseCache = {value: !!paused, ts: Date.now()};
  console.log('[admin] agent_global_pause=' + (paused ? 'on' : 'off') + ' by ' + (byAdminId || 'unknown'));
}

module.exports = {
  isAgentGloballyPaused,
  isAgentGloballyPausedAsync,
  setAgentGlobalPause,
  setAgentGlobalPauseAsync,
};
