/**
 * PostgreSQL pool for BioF3 (阶段 B).
 * Used by scripts/migrate-sqlite-to-pg.mjs and future db.js dual-driver.
 */
const {Pool} = require('pg');

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
      // statement_timeout is SERVER-side: useless if the TCP connection went
      // stale (PostgreSQL failover / NAT idle-drop) — the client never receives a
      // response NOR an error, so a synchronous deasync caller (task-store on
      // Dell) freezes the whole event loop at 0% CPU forever. Two safeguards:
      //   - query_timeout: CLIENT-side timer, rejects the query locally even
      //     when the socket is dead → deasync.loopWhile can exit with an error.
      //   - keepAlive: TCP keepalive probes detect dead peers faster.
      statement_timeout: 10_000,
      query_timeout: 12_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    // A pool 'error' on an idle client (e.g. PostgreSQL dropped the connection) is
    // emitted asynchronously; without a listener it crashes the process.
    _pool.on('error', (err) => {
      try {
        require('./logger').warn(`[db-pg] idle client error (reclaimed): ${err && err.message}`);
      } catch { /* logger optional */ }
    });
    // Pre-warm: force first connection immediately so subsequent getPool() calls
    // always get an already-connected pool (important for deasync callers like
    // claimPendingTask that block the event loop — they need the pool to already
    // have idle connections available).
    _pool.connect().then((c) => c.release()).catch(() => {});
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
    } catch (err) {
      try {
        require('./logger').warn(`[db-pg] pool end error: ${err.message}`);
      } catch {}
    }
  }
}

module.exports = {getPool, query, end};
