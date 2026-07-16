// Platform admin compute-infrastructure routes.
//
// These routes cover compute health, cache, disk, asset inspection, and
// queue status. In platform mode they proxy to Dell via internal token;
// in Dell/api mode they read local state. Registered from routes/index.js
// before legacy server.js endpoints.
const cacheManager = require('../cache-manager');
const config = require('../config');

const API_TOKEN = process.env.BIOF3_API_TOKEN || 'biof3-figcode-2026';
const INTERNAL_TOKEN = process.env.BIOF3_INTERNAL_TOKEN || '';
const REQUIRE_INTERNAL_CACHE_OPS = process.env.BIOF3_REQUIRE_INTERNAL_CACHE_OPS === '1';
const DELL_INTERNAL_API_BASE = (process.env.BIOF3_DELL_INTERNAL_API_BASE || 'http://127.0.0.1:3001/api').replace(/\/+$/, '');
const DELL_PY_INTERNAL_API_BASE = (process.env.BIOF3_DELL_PY_INTERNAL_API_BASE || 'http://127.0.0.1:3002/api').replace(/\/+$/, '');
const IS_PLATFORM = config.runMode === 'platform';

function isAdmin(req) {
  if (req.isInternal) return true;
  if (req.headers['x-api-token'] === API_TOKEN) return true;
  return req.user?.role === 'admin';
}

async function proxyDellCache(req, res, suffix) {
  if (!INTERNAL_TOKEN) {
    return res.status(503).json({status: 'error', error: 'internal_token_not_configured'});
  }
  const target = `${DELL_INTERNAL_API_BASE}/admin/cache/${suffix}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-BioF3-Internal-Token': INTERNAL_TOKEN,
    'X-Request-Id': req.requestId || '',
  };
  const opts = {method: req.method, headers};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    opts.body = JSON.stringify(req.body || {});
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    opts.signal = ctrl.signal;
    const upstream = await fetch(target, opts);
    const text = await upstream.text();
    clearTimeout(timer);
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type') || '';
    if (ct) res.setHeader('Content-Type', ct);
    return res.send(text);
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'dell_cache_proxy_timeout' : e.message;
    return res.status(502).json({status: 'error', error: msg});
  }
}

async function proxyDellAdminGet(req, res, pathSuffix, timeoutMs = 30000) {
  if (!INTERNAL_TOKEN) {
    return res.status(503).json({status: 'error', error: 'internal_token_not_configured'});
  }
  const target = `${DELL_INTERNAL_API_BASE}/admin/${pathSuffix.replace(/^\/+/, '')}`;
  try {
    const upstream = await fetchJsonWithTimeout(target, timeoutMs, {
      'X-BioF3-Internal-Token': INTERNAL_TOKEN,
      'X-Request-Id': req.requestId || '',
    });
    if (!upstream.ok) {
      return res.status(upstream.statusCode || 502).json({status: 'error', error: upstream.error || upstream.data?.error || 'upstream_error', upstream});
    }
    return res.json(upstream.data);
  } catch (e) {
    return res.status(502).json({status: 'error', error: e.message});
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = 5000, headers = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {headers, signal: ctrl.signal});
    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = {raw: text.slice(0, 500)};
    }
    return {ok: r.ok, statusCode: r.status, latencyMs: Date.now() - started, data};
  } catch (e) {
    return {
      ok: false,
      statusCode: 0,
      latencyMs: Date.now() - started,
      error: e?.name === 'AbortError' ? 'timeout' : e.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCounts(rows, keyFields, valueField = 'count') {
  const result = {};
  for (const row of rows || []) {
    let cursor = result;
    for (let i = 0; i < keyFields.length; i++) {
      const key = row[keyFields[i]] || 'unknown';
      if (i === keyFields.length - 1) {
        cursor[key] = Number(row[valueField] || 0);
      } else {
        cursor[key] = cursor[key] || {};
        cursor = cursor[key];
      }
    }
  }
  return result;
}

async function getComputeQueueHealth() {
  const {query} = require('../db-pg');
  const [byEngineStatus, byWorker, recentTasks, staleRunning] = await Promise.all([
    query(
      `SELECT COALESCE(engine, 'R') AS engine, status, COUNT(*)::int AS count
       FROM tasks
       GROUP BY COALESCE(engine, 'R'), status
       ORDER BY engine, status`,
    ),
    query(
      `SELECT COALESCE(engine, 'R') AS engine, COALESCE(worker_id, '(none)') AS worker_id,
              status, COUNT(*)::int AS count, MAX(COALESCE(claimed_at, started_at, created_at)) AS last_seen
       FROM tasks
       WHERE created_at > NOW() - INTERVAL '7 days'
       GROUP BY COALESCE(engine, 'R'), COALESCE(worker_id, '(none)'), status
       ORDER BY engine, worker_id, status`,
    ),
    query(
      `SELECT id, COALESCE(engine, 'R') AS engine, type, status, progress, progress_message,
              worker_id, created_at, started_at, finished_at, claimed_at, error
       FROM tasks
       ORDER BY created_at DESC
       LIMIT 20`,
    ),
    query(
      `SELECT id, COALESCE(engine, 'R') AS engine, type, status, progress, worker_id,
              started_at, claimed_at, created_at
       FROM tasks
       WHERE status = 'running'
         AND COALESCE(started_at, claimed_at, created_at) < NOW() - INTERVAL '2 hours'
       ORDER BY COALESCE(started_at, claimed_at, created_at) ASC
       LIMIT 20`,
    ),
  ]);

  return {
    byEngineStatus: normalizeCounts(byEngineStatus.rows, ['engine', 'status']),
    byWorker: byWorker.rows.map((row) => ({
      engine: row.engine || 'R',
      workerId: row.worker_id || '(none)',
      status: row.status,
      count: Number(row.count || 0),
      lastSeen: row.last_seen || null,
    })),
    recentTasks: recentTasks.rows.map((row) => ({
      taskId: row.id,
      engine: row.engine || 'R',
      type: row.type,
      status: row.status,
      progress: row.progress,
      progressMessage: row.progress_message,
      workerId: row.worker_id || null,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      claimedAt: row.claimed_at,
      error: row.error,
    })),
    staleRunning: staleRunning.rows.map((row) => ({
      taskId: row.id,
      engine: row.engine || 'R',
      type: row.type,
      status: row.status,
      progress: row.progress,
      workerId: row.worker_id || null,
      createdAt: row.created_at,
      startedAt: row.started_at,
      claimedAt: row.claimed_at,
    })),
  };
}

module.exports = function registerAdminComputeRoutes(app) {
  app.get('/api/admin/compute/health', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({status: 'error', error: '需要管理员权限'});
    }
    try {
      const rHeaders = {};
      if (INTERNAL_TOKEN) rHeaders['X-BioF3-Internal-Token'] = INTERNAL_TOKEN;
      const pyHeaders = {'X-API-Token': API_TOKEN};
      const [rHealth, rQueue, pyHealth, pyQueue, queue] = await Promise.all([
        fetchJsonWithTimeout(`${DELL_INTERNAL_API_BASE}/health`, 5000, rHeaders),
        fetchJsonWithTimeout(`${DELL_INTERNAL_API_BASE}/queue/status`, 5000, rHeaders),
        fetchJsonWithTimeout(`${DELL_PY_INTERNAL_API_BASE}/health`, 5000, pyHeaders),
        fetchJsonWithTimeout(`${DELL_PY_INTERNAL_API_BASE}/queue-status`, 5000, pyHeaders),
        getComputeQueueHealth().then((data) => ({ok: true, data})).catch((e) => ({ok: false, error: e.message})),
      ]);

      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        platform: {
          role: IS_PLATFORM ? 'ecs-platform' : 'legacy-or-compute',
          runMode: config.runMode,
          uptime: process.uptime(),
          workerId: config.workerId,
          database: process.env.DATABASE_URL ? 'postgres' : 'sqlite',
        },
        nodes: {
          r: {baseUrl: DELL_INTERNAL_API_BASE, health: rHealth, queue: rQueue},
          python: {baseUrl: DELL_PY_INTERNAL_API_BASE, health: pyHealth, queue: pyQueue},
        },
        queue: queue.ok ? queue.data : null,
        queueError: queue.ok ? null : queue.error,
      });
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.get('/api/admin/cache/stats', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({status: 'error', error: '需要管理员权限'});
    }
    if (IS_PLATFORM) return proxyDellCache(req, res, 'stats');
    if (REQUIRE_INTERNAL_CACHE_OPS && !req.isInternal) {
      return res.status(403).json({status: 'error', error: 'internal_only'});
    }
    try {
      res.json({status: 'ok', stats: cacheManager.getStats()});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.get('/api/admin/disk/stats', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({status: 'error', error: '需要管理员权限'});
    }
    if (IS_PLATFORM) return proxyDellAdminGet(req, res, 'disk/stats', 30000);
    if (!req.isInternal) {
      return res.status(403).json({status: 'error', error: 'internal_only'});
    }
    try {
      const stats = await cacheManager.getLocalDiskStats();
      res.json({status: 'ok', stats});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.get('/api/admin/assets/inspect', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({status: 'error', error: '需要管理员权限'});
    }
    if (IS_PLATFORM) return proxyDellAdminGet(req, res, 'assets/inspect', 30000);
    if (!req.isInternal) {
      return res.status(403).json({status: 'error', error: 'internal_only'});
    }
    try {
      const {getAssetInspection} = require('../helpers/asset-inspector');
      res.json({status: 'ok', assets: getAssetInspection()});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.post('/api/admin/cache/cleanup', (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({status: 'error', error: '需要管理员权限'});
    }
    if (IS_PLATFORM) return proxyDellCache(req, res, 'cleanup');
    if (REQUIRE_INTERNAL_CACHE_OPS && !req.isInternal) {
      return res.status(403).json({status: 'error', error: 'internal_only'});
    }
    try {
      const opts = {
        dryRun: req.body?.dryRun !== false,  // default true (preview mode)
        tempMaxAgeHours: req.body?.tempMaxAgeHours,
        cacheMaxIdleDays: req.body?.cacheMaxIdleDays,
      };
      const report = cacheManager.cleanup(opts);
      res.json({status: 'ok', report});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.get('/api/queue/status', (req, res) => {
    try {
      const taskQueue = require('../task-queue');
      res.json({status: 'ok', runMode: config.runMode, queue: taskQueue.getQueueStatus()});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });
};
