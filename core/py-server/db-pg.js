/**
 * PostgreSQL pool for BioF3 py-server.
 * Used when BIOF3_P2_PG=1 — py tasks go to shared PG tasks queue.
 */
const { Pool } = require('pg');

let _pool = null;

function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!_pool) {
    _pool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      statement_timeout: 10_000,
    });
    _pool
      .connect()
      .then((c) => c.release())
      .catch(() => {});
  }
  return _pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function end() {
  if (_pool) {
    const p = _pool;
    _pool = null;
    try {
      await p.end();
    } catch {
      // logger might not exist in py-server, ignore gracefully
    }
  }
}

module.exports = { getPool, query, end };
