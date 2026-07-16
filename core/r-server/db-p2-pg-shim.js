/**
 * Phase B: better-sqlite3-compatible sync shim over PostgreSQL (P2 tables).
 */
const {query} = require('./db-pg');

const UPSERT_PK = {
  user_heartbeats: ['user_id'],
  daily_stats: ['date'],
  chat_summaries: ['user_id'],
  copilot_settings: ['user_id'],
  user_progress: ['user_id', 'resource'],
  copilot_plan_steps: ['plan_id', 'n'],
};

function toPgSql(sql) {
  let s = sql;
  s = s.replace(/\bexcluded\./gi, 'EXCLUDED.');
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()');
  return s;
}

function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function tableFromInsert(sql) {
  const m = sql.match(/INTO\s+["']?(\w+)["']?/i);
  return m ? m[1] : null;
}

function buildUpsert(sql, params) {
  const table = tableFromInsert(sql);
  const pk = table && UPSERT_PK[table];
  const insertSql = sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');
  const pgSql0 = toPgSql(insertSql);
  if (!pk) {
    return {sql: convertPlaceholders(pgSql0), params};
  }
  const colMatch = pgSql0.match(/\(([^)]+)\)\s*VALUES/i);
  if (!colMatch) return {sql: convertPlaceholders(pgSql0), params};
  const cols = colMatch[1].split(',').map((c) => c.trim().replace(/"/g, ''));
  const pkSet = new Set(pk);
  const updates = cols.filter((c) => !pkSet.has(c)).map((c) => `"${c}" = EXCLUDED."${c}"`);
  const conflict = pk.map((c) => `"${c}"`).join(', ');
  const pgSql = `${pgSql0} ON CONFLICT (${conflict}) DO UPDATE SET ${updates.join(', ') || '"updated_at" = NOW()'}`;
  return {sql: convertPlaceholders(pgSql), params};
}

async function execAsync(sql, params) {
  const trimmed = sql.trim();
  if (/^INSERT\s+OR\s+REPLACE/i.test(trimmed)) {
    const {sql: pgSql, params: p} = buildUpsert(trimmed, params);
    return query(pgSql, p);
  }
  let pgSql = toPgSql(trimmed);
  if (/^INSERT\s+OR\s+IGNORE/i.test(pgSql)) {
    pgSql = pgSql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
  }
  return query(convertPlaceholders(pgSql), params);
}

function createSyncShim() {
  const deasync = require('deasync');
  const runSync = (fn) => {
    if (global.__biof3DeasyncActive) {
      throw new Error('[deasync-guard] concurrent sync DB call rejected (deasync.loopWhile not reentrant) — endpoint must migrate to async');
    }
    let done = false;
    let err = null;
    let result = null;
    Promise.resolve(fn())
      .then((r) => { result = r; done = true; })
      .catch((e) => { err = e; done = true; });
    const DEADLINE_MS = 25_000;
    const deadline = Date.now() + DEADLINE_MS;
    const ka = setInterval(() => {}, 250);
    global.__biof3DeasyncActive = true;
    try {
      deasync.loopWhile(() => !done && Date.now() < deadline);
    } finally {
      global.__biof3DeasyncActive = false;
      clearInterval(ka);
    }
    if (!done) {
      throw new Error('[db-p2-pg-shim] PG op exceeded ' + DEADLINE_MS + 'ms deadline (deasync backstop) — likely stale PostgreSQL connection or microtask starvation');
    }
    if (err) throw err;
    return result;
  };

  return {
    exec(ddl) {
      const parts = ddl.split(';').map((s) => s.trim()).filter(Boolean);
      for (const st of parts) {
        if (/^(CREATE|ALTER|PRAGMA|CREATE\s+INDEX)/i.test(st)) continue;
        runSync(() => execAsync(st, []));
      }
    },
    prepare(sql) {
      return {
        run(...params) {
          const res = runSync(() => execAsync(sql, params));
          return {changes: res.rowCount ?? 0};
        },
        get(...params) {
          const pgSql = convertPlaceholders(toPgSql(sql));
          const res = runSync(() => query(pgSql, params));
          return res.rows[0];
        },
        all(...params) {
          const pgSql = convertPlaceholders(toPgSql(sql));
          const res = runSync(() => query(pgSql, params));
          return res.rows;
        },
      };
    },
  };
}

/**
 * Async (Promise-based) shim over PostgreSQL for P2 tables — same SQL translation
 * as createSyncShim but WITHOUT deasync. Hot platform routes (analytics, etc.)
 * should use this + await so a stalled query can never freeze the event loop.
 * API mirrors better-sqlite3 but every method returns a Promise:
 *   db.exec(ddl) -> Promise<void>
 *   db.prepare(sql).run(...p) -> Promise<{changes}>
 *   db.prepare(sql).get(...p) -> Promise<row|undefined>
 *   db.prepare(sql).all(...p) -> Promise<row[]>
 */
function createAsyncShim() {
  return {
    async exec(ddl) {
      const parts = ddl.split(';').map((s) => s.trim()).filter(Boolean);
      for (const st of parts) {
        if (/^(CREATE|ALTER|PRAGMA|CREATE\s+INDEX)/i.test(st)) continue;
        await execAsync(st, []);
      }
    },
    prepare(sql) {
      return {
        async run(...params) {
          const res = await execAsync(sql, params);
          const out = {changes: res.rowCount ?? 0};
          // Expose RETURNING rows (e.g. INSERT ... RETURNING id) so callers can
          // extract auto-generated keys without a separate SELECT round-trip.
          if (res.rows && res.rows.length > 0) out.rows = res.rows;
          return out;
        },
        async get(...params) {
          const res = await query(convertPlaceholders(toPgSql(sql)), params);
          return res.rows[0];
        },
        async all(...params) {
          const res = await query(convertPlaceholders(toPgSql(sql)), params);
          return res.rows;
        },
      };
    },
  };
}

module.exports = {createSyncShim, createAsyncShim};
