/**
 * P2 skeleton — Copilot / analytics / feedback auxiliary tables.
 * Full PG query layer: TODO (see docs/ops-postgres-migration.md § P2).
 *
 * Env:
 *   BIOF3_PG_AUX_SQLITE_PATH — when DATABASE_URL is set, optional sidecar SQLite for
 *     modules not yet ported (memory_vectors, page_views, …). Omit for strict PG-only dev.
 *   BIOF3_PG_STRICT=1 — refuse to start if DATABASE_URL set but aux path missing and
 *     P2 modules would need SQLite (checked in server.js).
 */

const path = require('path');
const Database = require('better-sqlite3');

const P2_MODULES = [
  'routes/analytics.js',
  'routes/feedback.js',
  'helpers/memory-vectors.js',
  'helpers/user-facts.js',
  'helpers/chat-summary.js',
  'helpers/ai-usage.js',
  'helpers/act-tool.js',
  'helpers/memory-privacy.js',
  'helpers/user-progress.js',
  'helpers/review-queue.js',
  'helpers/ai-governance.js',
  'helpers/conversations.js',
  'helpers/plans.js',
];

/** PG migrations that must be applied before production DATABASE_URL */
const P2_PG_MIGRATIONS = ['002_analytics.sql', '003_copilot_ai.sql', '004_feedback.sql'];

let _auxSqlite = null;

function auxSqlitePath() {
  const explicit = process.env.BIOF3_PG_AUX_SQLITE_PATH;
  if (explicit && String(explicit).trim()) return path.resolve(explicit);
  return null;
}

/**
 * Optional SQLite sidecar for P2 tables while queries still target sqlite API.
 */
function getAuxSqlite() {
  const p = auxSqlitePath();
  if (!p) return null;
  if (!_auxSqlite) {
    _auxSqlite = new Database(p);
    _auxSqlite.pragma('journal_mode = WAL');
    console.log('[db-p2] aux SQLite for Copilot/analytics:', p);
  }
  return _auxSqlite;
}

function closeAuxSqlite() {
  if (_auxSqlite) {
    try {
      _auxSqlite.close();
    } catch {
      /* ignore */
    }
    _auxSqlite = null;
  }
}

/**
 * Run bootstrap DDL on sqlite handle (main db or aux).
 */
function sqliteBootstrap(sqlite, label, ddl) {
  if (!sqlite || typeof sqlite.exec !== 'function') {
    throw new Error(`[db-p2] ${label}: no SQLite handle (set BIOF3_PG_AUX_SQLITE_PATH or disable DATABASE_URL)`);
  }
  sqlite.exec(ddl);
}

/**
 * Call at top of P2 modules after require('../db').
 */
function bootP2Module(moduleName) {
  const dbMod = require('./db');
  if (!dbMod.isPg || !dbMod.isPg()) return {mode: 'sqlite', sqlite: dbMod.db};

  const aux = getAuxSqlite();
  if (process.env.BIOF3_PG_STRICT === '1' && !aux) {
    throw new Error(
      `[db-p2] ${moduleName}: DATABASE_URL set and BIOF3_PG_STRICT=1 but no BIOF3_PG_AUX_SQLITE_PATH. ` +
        'Apply PG migrations 002–004 and implement P2 queries, or set aux path for transition.',
    );
  }
  return {mode: 'pg', sqlite: aux, pgReady: false};
}

async function ensurePgAuxSchema() {
  const {query} = require('./db-pg');
  await query('SELECT 1 FROM site_settings LIMIT 1');
  await query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'page_views'
     ) AS ok`,
  ).then((r) => {
    if (!r.rows[0]?.ok) {
      throw new Error('P2: table page_views missing — run npm run db:pg-migrate (002–004)');
    }
  });
  await query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'memory_vectors'
     ) AS ok`,
  ).then((r) => {
    if (!r.rows[0]?.ok) {
      throw new Error('P2: table memory_vectors missing — run migrations 003');
    }
  });
}

module.exports = {
  P2_MODULES,
  P2_PG_MIGRATIONS,
  auxSqlitePath,
  getAuxSqlite,
  closeAuxSqlite,
  sqliteBootstrap,
  bootP2Module,
  ensurePgAuxSchema,
};