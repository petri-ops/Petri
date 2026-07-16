// ============================================================
// Analytics module — runtime telemetry + admin dashboards.
// ============================================================
const dbMod = require('../db');
const db = dbMod.getSqliteForLegacyModules();
// Async (deasync-FREE) accessor for HOT paths (heartbeat / page-view / cleanup).
// These fire on every visitor; routing them through the sync deasync shim was
// freezing the platform event loop (2026-06-08). Admin read endpoints stay on
// the sync `db` (low-frequency, single-admin, hardened with a deadline backstop).
const adb = dbMod.getAsyncDbForLegacyModules();
const { attachGeoToRows } = require('../helpers/ip-geo');
const analyticsUsers = require('../helpers/analytics-users');

function isAdmin(req) {
  return req.user?.role === 'admin';
}
function userId(req) {
  return req.user?.id || req.user?.userId || null;
}

// Helper: ISO date string from timestamp (ms)
function isoFromMs(ms) {
  return new Date(ms).toISOString();
}
function _isoFromSec(s) {
  return new Date(s * 1000).toISOString();
}
// Heuristic: detect if a created_at is stored as ISO string or unix-seconds number.
// Different tables use different conventions.
function _tsCol(table) {
  // Most tables use ISO TEXT. ai_usage uses TEXT too. user_progress uses TEXT.
  // users.created_at is integer (seconds since epoch) per the env we observed.
  return table === 'users' ? 'sec' : 'text';
}

// Bootstrap tables
function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_heartbeats (
      user_id TEXT PRIMARY KEY,
      last_seen INTEGER NOT NULL,
      page TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_heartbeats_seen ON user_heartbeats(last_seen);

    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      ts INTEGER NOT NULL,
      path TEXT NOT NULL,
      title TEXT,
      referrer TEXT,
      session_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pv_ts ON page_views(ts);
    CREATE INDEX IF NOT EXISTS idx_pv_user ON page_views(user_id);
    CREATE INDEX IF NOT EXISTS idx_pv_path ON page_views(path);

    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      dau INTEGER DEFAULT 0,
      new_users INTEGER DEFAULT 0,
      total_users INTEGER DEFAULT 0,
      ai_messages INTEGER DEFAULT 0,
      ai_active_users INTEGER DEFAULT 0,
      page_views INTEGER DEFAULT 0,
      avg_session_pv REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  // 向后兼容：page_views.ip 是后加的列, 老库 ALTER TABLE 一次。
  // 仅 SQLite 需要：PG 模式下 schema 由 migrations 管理（002_analytics.sql 已含 ip 列），
  // 且 PRAGMA / ALTER 在 PG 上不适用（shim 会把 PRAGMA 透传给 PG 报错）。
  if (!dbMod.isPg()) {
    try {
      const cols = db.prepare('PRAGMA table_info(page_views)').all();
      if (!cols.some((c) => c.name === 'ip')) {
        db.exec('ALTER TABLE page_views ADD COLUMN ip TEXT');
        db.exec('CREATE INDEX IF NOT EXISTS idx_pv_ip ON page_views(ip)');
      }
    } catch (e) {
      console.log('[analytics] ip column migrate failed:', e.message);
    }
  }
}
ensureSchema();

// 解析客户端真实 IP (经 nginx/frp 反代时 req.ip 不准, 取 X-Forwarded-For 第一段)
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim().slice(0, 64);
  return (req.ip || req.socket?.remoteAddress || '').slice(0, 64);
}

function getActiveAIStreamCount() {
  try {
    return global._aiActiveStreams || 0;
  } catch {
    return 0;
  }
}

// Cleanup (async — deasync-free)
setInterval(
  async () => {
    try {
      await adb
        .prepare('DELETE FROM user_heartbeats WHERE last_seen < ?')
        .run(Date.now() - 10 * 60 * 1000);
    } catch {}
  },
  5 * 60 * 1000
);
setInterval(
  async () => {
    try {
      await adb
        .prepare('DELETE FROM page_views WHERE ts < ?')
        .run(Date.now() - 90 * 24 * 60 * 60 * 1000);
    } catch {}
  },
  24 * 60 * 60 * 1000
);

// --- Daily aggregation ---
async function aggregateDailyStats(forDate) {
  const date = forDate || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dayStartMs = new Date(date + 'T00:00:00').getTime();
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  const dayStartIso = isoFromMs(dayStartMs);
  const dayEndIso = isoFromMs(dayEndMs);
  const dayStartSec = Math.floor(dayStartMs / 1000);
  const dayEndSec = Math.floor(dayEndMs / 1000);

  // DAU = distinct user_id from page_views (ms timestamps) UNION conversations active that day
  const dauRows = await adb
    .prepare(
      `
    SELECT COUNT(DISTINCT user_id) AS n FROM (
      SELECT user_id FROM page_views WHERE ts >= ? AND ts < ? AND user_id IS NOT NULL
      UNION
      SELECT user_id FROM copilot_conversations
        WHERE updated_at >= ? AND updated_at < ?
    )
  `
    )
    .get(dayStartMs, dayEndMs, dayStartIso, dayEndIso);
  const dau = dauRows?.n || 0;

  const newU = { n: await analyticsUsers.countUsersBetween(dayStartSec, dayEndSec) };
  const totalU = { n: await analyticsUsers.countUsersTotal() };

  // AI messages for the day (copilot_messages.ts is ISO TEXT)
  const aiMsg = await adb
    .prepare(
      `SELECT COUNT(*) AS n FROM copilot_messages
    WHERE ts >= ? AND ts < ? AND role = 'user'`
    )
    .get(dayStartIso, dayEndIso);

  // AI active users (need JOIN through conversations)
  const aiActiveU = await adb
    .prepare(
      `
    SELECT COUNT(DISTINCT c.user_id) AS n
    FROM copilot_messages m
    JOIN copilot_conversations c ON c.id = m.conversation_id
    WHERE m.ts >= ? AND m.ts < ?
  `
    )
    .get(dayStartIso, dayEndIso);

  const pv = await adb
    .prepare('SELECT COUNT(*) AS n FROM page_views WHERE ts >= ? AND ts < ?')
    .get(dayStartMs, dayEndMs);
  const sessions = await adb
    .prepare(
      'SELECT COUNT(DISTINCT session_id) AS n FROM page_views WHERE ts >= ? AND ts < ? AND session_id IS NOT NULL'
    )
    .get(dayStartMs, dayEndMs);
  const avgPv = sessions?.n ? pv.n / sessions.n : 0;

  await adb
    .prepare(
      `
    INSERT OR REPLACE INTO daily_stats
    (date, dau, new_users, total_users, ai_messages, ai_active_users, page_views, avg_session_pv, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(date, dau, newU.n, totalU.n, aiMsg.n, aiActiveU.n, pv.n, avgPv, Date.now());

  return {
    date,
    dau,
    newUsers: newU.n,
    totalUsers: totalU.n,
    aiMessages: aiMsg.n,
    aiActiveUsers: aiActiveU.n,
    pageViews: pv.n,
  };
}

function scheduleAggregation() {
  setInterval(
    async () => {
      try {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const exist = await adb
          .prepare('SELECT date FROM daily_stats WHERE date = ?')
          .get(yesterday);
        if (!exist && new Date().getHours() >= 1) {
          await aggregateDailyStats(yesterday);
          console.log('[analytics] Aggregated', yesterday);
        }
      } catch (e) {
        console.log('[analytics] agg err:', e.message);
      }
    },
    60 * 60 * 1000
  );
}
scheduleAggregation();

module.exports = function registerAnalytics(app) {
  const express = require('express');

  app.post('/api/analytics/heartbeat', express.json({ limit: '2kb' }), async (req, res) => {
    const uid = userId(req);
    if (!uid) return res.json({ ok: true, anon: true });
    try {
      await adb
        .prepare(
          `
        INSERT INTO user_heartbeats (user_id, last_seen, page, user_agent)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen, page=excluded.page
      `
        )
        .run(
          uid,
          Date.now(),
          (req.body?.page || '').slice(0, 200),
          (req.headers['user-agent'] || '').slice(0, 200)
        );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/analytics/page-view', express.json({ limit: '4kb' }), async (req, res) => {
    const uid = userId(req);
    const { path, title, referrer, sessionId } = req.body || {};
    const ip = clientIp(req);
    if (!path) return res.status(400).json({ error: 'missing_path' });
    try {
      await adb
        .prepare(
          `
        INSERT INTO page_views (user_id, ts, path, title, referrer, session_id, ip)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          uid,
          Date.now(),
          String(path).slice(0, 500),
          String(title || '').slice(0, 200),
          String(referrer || '').slice(0, 500),
          String(sessionId || '').slice(0, 64),
          ip
        );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/realtime-stats', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    try {
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStartMs = todayStart.getTime();
      const todayStartIso = todayStart.toISOString();
      const todayStartSec = Math.floor(todayStartMs / 1000);

      const online = await adb
        .prepare('SELECT COUNT(*) AS n FROM user_heartbeats WHERE last_seen > ?')
        .get(fiveMinAgo);
      const dau = await adb
        .prepare(
          `
        SELECT COUNT(DISTINCT user_id) AS n FROM (
          SELECT user_id FROM page_views WHERE ts >= ? AND user_id IS NOT NULL
          UNION
          SELECT user_id FROM copilot_conversations WHERE updated_at >= ?
        )
      `
        )
        .get(todayStartMs, todayStartIso);
      const totalUsers = { n: await analyticsUsers.countUsersTotal() };
      const newToday = { n: await analyticsUsers.countUsersSince(todayStartSec) };
      const aiActive = getActiveAIStreamCount();

      const onlineList = await analyticsUsers.enrichWithUsernames(
        await adb
          .prepare(
            `
        SELECT h.user_id, h.last_seen, h.page
        FROM user_heartbeats h
        WHERE h.last_seen > ?
        ORDER BY h.last_seen DESC LIMIT 20
      `
          )
          .all(fiveMinAgo)
      );

      res.json({
        ok: true,
        online: online.n,
        dau: dau.n,
        totalUsers: totalUsers.n,
        newToday: newToday.n,
        aiActiveStreams: aiActive,
        onlineList,
        timestamp: Date.now(),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/dau-trend', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    try {
      const rows = await adb
        .prepare(
          `
        SELECT date, dau, new_users, ai_messages, page_views FROM daily_stats
        ORDER BY date DESC LIMIT ?
      `
        )
        .all(days);
      res.json({ ok: true, trend: rows.reverse() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/retention', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    try {
      const now = Date.now();
      const DAY = 24 * 60 * 60 * 1000;

      // FIX_RETENTION_PERF_v1: True O(1) — single query for all cohort sizes
      // instead of days × sequential queries (was causing 90 sequential DB reads).
      const sinceSec = Math.floor((now - days * DAY) / 1000);
      let allUsers;
      if (dbMod.isPg()) {
        const { query } = require('../db-pg');
        const res = await query(
          'SELECT id, created_at FROM users WHERE created_at >= to_timestamp($1)',
          [sinceSec]
        );
        allUsers = res.rows;
      } else {
        allUsers = await adb
          .prepare('SELECT id, created_at FROM users WHERE created_at >= ?')
          .all(sinceSec);
      }

      if (allUsers.length === 0) {
        return res.json({ ok: true, cohorts: [] });
      }

      // Build cohort membership map: date -> [userIds]
      const cohortMap = {};
      for (const u of allUsers) {
        const createdMs =
          u.created_at instanceof Date
            ? u.created_at.getTime()
            : typeof u.created_at === 'number'
              ? u.created_at < 1e12
                ? u.created_at * 1000
                : u.created_at
              : new Date(u.created_at).getTime();
        const cohortDay = new Date(createdMs);
        cohortDay.setHours(0, 0, 0, 0);
        const key = cohortDay.toISOString().slice(0, 10);
        if (!cohortMap[key]) cohortMap[key] = [];
        cohortMap[key].push(u.id);
      }

      // Get all relevant page_view activity for these users
      const sinceMs = now - days * DAY;
      const allIds = [...new Set(allUsers.map((u) => u.id))];
      if (allIds.length === 0) {
        return res.json({ ok: true, cohorts: [] });
      }
      const placeholders = allIds.map(() => '?').join(',');
      const pageViewsRows = await adb
        .prepare(
          `SELECT user_id, ts FROM page_views WHERE user_id IN (${placeholders}) AND ts >= ?`
        )
        .all(...allIds, sinceMs);

      // Build lookup: userId -> firstSeen (ms)
      const userFirstSeen = {};
      for (const row of pageViewsRows) {
        if (!userFirstSeen[row.user_id]) {
          userFirstSeen[row.user_id] = row.ts;
        }
      }

      const cohorts = [];
      for (let d = days; d >= 1; d--) {
        const cohortStart = new Date(now - d * DAY);
        cohortStart.setHours(0, 0, 0, 0);
        const cohortEnd = cohortStart.getTime() + DAY;
        const key = cohortStart.toISOString().slice(0, 10);
        const ids = cohortMap[key] || [];

        if (ids.length === 0) continue;

        const day1Active = ids.filter((uid) => {
          const first = userFirstSeen[uid];
          return first && first >= cohortEnd && first < cohortEnd + DAY;
        }).length;

        const day7Active = ids.filter((uid) => {
          const first = userFirstSeen[uid];
          return first && first >= cohortEnd && first < now - 7 * DAY;
        }).length;

        cohorts.push({
          date: key,
          cohortSize: ids.length,
          day1Retained: day1Active,
          day7Retained: day7Active,
          day1Rate: day1Active / ids.length,
          day7Rate: day7Active / ids.length,
        });
      }
      res.json({ ok: true, cohorts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/content-popular', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    try {
      const rows = await adb
        .prepare(
          `
        SELECT path, MAX(title) AS title, COUNT(*) AS views, COUNT(DISTINCT user_id) AS unique_users
        FROM page_views WHERE ts >= ? AND path IS NOT NULL
        GROUP BY path ORDER BY views DESC LIMIT 50
      `
        )
        .all(since);
      res.json({ ok: true, content: rows, since, days });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/funnel', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    try {
      const total = { n: await analyticsUsers.countUsersTotal() };
      const haveHeartbeat = await adb
        .prepare('SELECT COUNT(DISTINCT user_id) AS n FROM user_heartbeats')
        .get();
      const haveConv = await adb
        .prepare('SELECT COUNT(DISTINCT user_id) AS n FROM copilot_conversations')
        .get();
      const visitedDocs = await adb
        .prepare("SELECT COUNT(DISTINCT user_id) AS n FROM page_views WHERE path LIKE '/docs/%'")
        .get();
      const completedAtLeastOne = await adb
        .prepare(
          "SELECT COUNT(DISTINCT user_id) AS n FROM user_progress WHERE status = 'completed'"
        )
        .get();
      res.json({
        ok: true,
        funnel: [
          { step: '注册', count: total.n, rate: 1 },
          {
            step: '上线访问',
            count: haveHeartbeat.n,
            rate: total.n ? haveHeartbeat.n / total.n : 0,
          },
          { step: '访问 docs', count: visitedDocs.n, rate: total.n ? visitedDocs.n / total.n : 0 },
          { step: 'AI 对话', count: haveConv.n, rate: total.n ? haveConv.n / total.n : 0 },
          {
            step: '完成至少一篇',
            count: completedAtLeastOne.n,
            rate: total.n ? completedAtLeastOne.n / total.n : 0,
          },
        ],
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/aggregate-daily', express.json(), async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    try {
      const result = await aggregateDailyStats(req.body?.date);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // -------- 访客 IP 系列（A 方案: admin 可见真实 IP） --------

  // 按日聚合: page_views / page_sessions / unique_ips（默认 30 天）
  app.get('/api/admin/visitor-trend', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    try {
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      // 按本地日（Asia/Shanghai）分桶。SQLite 用 date(...'localtime')；
      // PG 用 to_timestamp + AT TIME ZONE（shim 不翻译 SQLite 的 date()/unixepoch）。
      const dateExpr = dbMod.isPg()
        ? "to_char(to_timestamp(ts/1000.0) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')"
        : "date(ts/1000, 'unixepoch', 'localtime')";
      const rows = await adb
        .prepare(
          `
        SELECT
          ${dateExpr} AS date,
          COUNT(*) AS page_views,
          COUNT(DISTINCT COALESCE(user_id, session_id)) AS page_sessions,
          COUNT(DISTINCT NULLIF(ip, '')) AS unique_ips
        FROM page_views
        WHERE ts >= ?
        GROUP BY date
        ORDER BY date ASC
      `
        )
        .all(since);
      res.json({ ok: true, trend: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // IP 排行: 按访问次数倒序, 含独立页数 / 首末访问 / 最近 UA
  // ip 是 admin-only 数据, 仅暴露给 role=admin
  app.get('/api/admin/top-ips', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    try {
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      const rows = await adb
        .prepare(
          `
        SELECT
          pv.ip,
          COUNT(*) AS visits,
          COUNT(DISTINCT pv.path) AS distinct_pages,
          COUNT(DISTINCT pv.session_id) AS distinct_sessions,
          COUNT(DISTINCT pv.user_id) AS distinct_users,
          MIN(pv.ts) AS first_seen,
          MAX(pv.ts) AS last_seen,
          MAX(pv.user_id) AS sample_user_id
        FROM page_views pv
        WHERE pv.ts >= ? AND pv.ip IS NOT NULL AND pv.ip != ''
        GROUP BY pv.ip
        ORDER BY visits DESC
        LIMIT ?
      `
        )
        .all(since, limit);
      const ips = await attachGeoToRows(rows, 'ip');
      res.json({ ok: true, days, ips });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 最近访客流水: 单条记录, 给 admin 排查"谁刚才进来了"
  app.get('/api/admin/recent-visitors', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    try {
      const rows = await analyticsUsers.enrichWithUsernames(
        await adb
          .prepare(
            `
        SELECT
          pv.id, pv.ts, pv.ip, pv.user_id, pv.session_id,
          pv.path, pv.title, pv.referrer
        FROM page_views pv
        WHERE pv.ip IS NOT NULL AND pv.ip != ''
        ORDER BY pv.id DESC
        LIMIT ?
      `
          )
          .all(limit)
      );
      const visitors = await attachGeoToRows(rows, 'ip');
      res.json({ ok: true, visitors });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
