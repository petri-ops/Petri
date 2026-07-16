/**
 * User counts / lookups for analytics when users live in PostgreSQL (P0) but
 * page_views etc. live in aux SQLite (P2).
 *
 * 2026-06-08: ASYNC (deasync-free). The sync versions went through _runPg /
 * sync shim (deasync.loopWhile), which crashes V8 when the admin console fires
 * these concurrently with other deasync reads. All functions now return Promises.
 */
const dbMod = require('../db');

function _createdMs(row) {
  const v = row.created_at;
  if (v == null) return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  return new Date(v).getTime();
}

async function countUsersTotal() {
  if (dbMod.isPg && dbMod.isPg()) {
    const { query } = require('../db-pg');
    const res = await query('SELECT COUNT(*) AS n FROM users');
    return parseInt(res.rows[0].n, 10);
  }
  const adb = dbMod.getAsyncDbForLegacyModules();
  return (await adb.prepare('SELECT COUNT(*) AS n FROM users').get()).n;
}

async function countUsersSince(secOrMsStart) {
  const startMs =
    typeof secOrMsStart === 'number' && secOrMsStart < 1e12
      ? secOrMsStart * 1000
      : new Date(secOrMsStart).getTime();
  if (dbMod.isPg && dbMod.isPg()) {
    const { query } = require('../db-pg');
    const res = await query('SELECT COUNT(*) AS n FROM users WHERE created_at >= to_timestamp($1)', [startMs / 1000]);
    return parseInt(res.rows[0].n, 10);
  }
  const sec = Math.floor(startMs / 1000);
  const adb = dbMod.getAsyncDbForLegacyModules();
  return (await adb.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?').get(sec)).n;
}

async function countUsersBetween(startSec, endSec) {
  if (dbMod.isPg && dbMod.isPg()) {
    const { query } = require('../db-pg');
    const res = await query('SELECT COUNT(*) AS n FROM users WHERE created_at >= to_timestamp($1) AND created_at < to_timestamp($2)', [startSec, endSec]);
    return parseInt(res.rows[0].n, 10);
  }
  const adb = dbMod.getAsyncDbForLegacyModules();
  return (await adb
    .prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?')
    .get(startSec, endSec)).n;
}

async function listUserIdsBetween(startSec, endSec) {
  if (dbMod.isPg && dbMod.isPg()) {
    const { query } = require('../db-pg');
    const res = await query('SELECT id FROM users WHERE created_at >= to_timestamp($1) AND created_at < to_timestamp($2)', [startSec, endSec]);
    return res.rows.map((r) => r.id);
  }
  const adb = dbMod.getAsyncDbForLegacyModules();
  return (await adb
    .prepare('SELECT id FROM users WHERE created_at >= ? AND created_at < ?')
    .all(startSec, endSec))
    .map((r) => r.id);
}

async function usernameById(userId) {
  if (!userId) return null;
  if (dbMod.isPg && dbMod.isPg()) {
    const u = await dbMod.getUserByIdAsync(userId);
    return u ? u.username : null;
  }
  const adb = dbMod.getAsyncDbForLegacyModules();
  const r = await adb.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  return r ? r.username : null;
}

async function enrichWithUsernames(rows, userIdKey = 'user_id') {
  // OPT_USERNAME_BATCH_v1: single batch query instead of N per-row lookups.
  const ids = [...new Set(rows.map((r) => r[userIdKey]).filter(Boolean))];
  const nameMap = {};
  if (ids.length > 0) {
    if (dbMod.isPg && dbMod.isPg()) {
      const { query } = require('../db-pg');
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      const results = await query(`SELECT id, username FROM users WHERE id IN (${placeholders})`, ids);
      for (const row of results.rows) nameMap[row.id] = row.username;
    } else {
      const adb = dbMod.getAsyncDbForLegacyModules();
      const placeholders = ids.map(() => '?').join(',');
      const results = await adb.prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`).all(...ids);
      for (const row of results) nameMap[row.id] = row.username;
    }
  }
  return rows.map((r) => ({
    ...r,
    username: r.username ?? nameMap[r[userIdKey]] ?? null,
  }));
}

module.exports = {
  countUsersTotal,
  countUsersSince,
  countUsersBetween,
  listUserIdsBetween,
  usernameById,
  enrichWithUsernames,
};
