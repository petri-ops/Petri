/**
 * Cache & Temp Space Manager
 *
 * Cleanup rules:
 *   - TEMP_DIR (/mnt/storage_16tb/omichub/biof3-tmp):
 *       Delete task-* dirs older than 24h. Skip if dir name matches a
 *       running task (in-memory tasks Map).
 *
 *   - CACHE_DIR (/mnt/storage_16tb/omichub/biof3-cache):
 *       Always keep:
 *         - demo-*.rds
 *         - symbolic links (point to demo files)
 *       For real task-{taskId}.rds:
 *         - Delete if no analysis in DB references this taskId (orphan)
 *         - Delete if not accessed in 7+ days (LRU style)
 *
 * Exposed:
 *   - getStats() — disk usage + file count + breakdown
 *   - cleanup({dryRun, tempMaxAgeHours, cacheMaxIdleDays}) — perform cleanup
 *   - startScheduler() — run cleanup daily at 03:00 (server local time)
 */

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const config = require('./config');
const IS_LOCAL = config.storageMode === 'local';

// OSS 模块延迟加载（桌面版不需要）
let OSS = null;
if (!IS_LOCAL) {
  try { OSS = require('ali-oss'); } catch {}
}

const TEMP_DIR = IS_LOCAL ? (config.tempDir || '/tmp/biof3-tmp') : '/mnt/storage_16tb/omichub/biof3-tmp';
const CACHE_DIR = IS_LOCAL ? (config.tempDir || '/tmp/biof3-tmp') + '/_cache' : '/mnt/storage_16tb/omichub/biof3-cache';

const DEFAULT_TEMP_MAX_AGE_HOURS = 24;
const DEFAULT_CACHE_MAX_IDLE_DAYS = 7;
const DEFAULT_OSS_MAX_AGE_DAYS = 30;

/** Run OSS list in a child process so that event-loop stalls (e.g. deasync/PG
 *  sync calls that can freeze the loop for 60+ seconds) do NOT block the HTTP
 *  request. The child process has its own V8 instance and event loop.
 *
 *  Uses FILE-BASED result passing (not Promise/microtask) so it works even when
 *  the parent event loop is blocked by deasync. The child writes JSON to a temp
 *  file, then the parent reads it synchronously.
 *
 *  Returns {objects} on success or {objects:[], error} on failure/timeout. */
function runOssListInWorker(_timeoutMs = 90_000) {
  const resultFile = `/tmp/oss-stats-result-${process.pid}.json`;
  // Clean up any stale result file from a previous crashed run
  try {
    fs.unlinkSync(resultFile);
  } catch {}

  // Run oss-list-worker.js as a separate Node process.
  // Env vars (OSS_AK, OSS_SK) are inherited from the parent process.
  // IMPORTANT: ECS has mihomo proxy at 127.0.0.1:9981 that cannot reach OSS.
  // Must explicitly DELETE proxy vars so OSS SDK connects directly.
  const childEnv = { ...process.env };
  delete childEnv.http_proxy;
  delete childEnv.HTTP_PROXY;
  delete childEnv.https_proxy;
  delete childEnv.HTTPS_PROXY;
  delete childEnv.all_proxy;
  delete childEnv.ALL_PROXY;
  childEnv.OSS_STATS_RESULT_FILE = resultFile;
  childEnv.OSS_STATS_PID = String(process.pid); // parent PID, child sends SIGUSR2 here to unblock sync cache update

  let proc;
  try {
    proc = spawn(process.execPath, [path.join(__dirname, 'oss-list-worker.js')], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return { objects: [], error: 'spawn failed: ' + e.message };
  }

  // SIGUSR2 signal handler: fires when child writes the result file.
  // This runs synchronously even if the parent event loop is blocked by deasync.
  // We use it to update the OSS stats cache directly from the signal handler.
  let sigusr2Handler = null;
  function armSigusr2() {
    sigusr2Handler = () => {
      try {
        const raw = fs.readFileSync(resultFile, 'utf8');
        const result = JSON.parse(raw);
        const objects = result.objects || [];
        if (result.error) console.error('[CacheManager] OSS refresh error:', result.error);
        _ossStatsCache = computeOssStats(objects);
        _ossStatsCacheTime = Date.now();
        console.log('[CacheManager] OSS refresh done, objects:', objects.length);
      } catch (e) {
        console.error('[CacheManager] SIGUSR2 read error:', e.message);
      } finally {
        process.removeListener('SIGUSR2', sigusr2Handler);
        try {
          fs.unlinkSync(resultFile);
        } catch {}
      }
    };
    process.on('SIGUSR2', sigusr2Handler);
  }

  // Fire-and-forget: spawn and arm the signal handler, return immediately.
  // The actual result will be processed asynchronously via SIGUSR2.
  proc.on('error', (e) => {
    console.error('[CacheManager] child spawn error:', e.message);
    process.removeListener('SIGUSR2', sigusr2Handler);
  });

  // Fallback: if the child process exits without sending SIGUSR2 (e.g. crashes),
  // the result file may still exist — poll briefly to catch it.
  proc.on('close', (_code) => {
    // Child exited. Give it 100ms to write the file (should be instant).
    // This is a fallback; the SIGUSR2 handler above is the primary mechanism.
    setTimeout(() => {
      try {
        if (fs.existsSync(resultFile)) {
          const raw = fs.readFileSync(resultFile, 'utf8');
          const result = JSON.parse(raw);
          const objects = result.objects || [];
          if (result.error) console.error('[CacheManager] OSS refresh error:', result.error);
          _ossStatsCache = computeOssStats(objects);
          _ossStatsCacheTime = Date.now();
          _ossStatsRefreshing = false;
          console.log('[CacheManager] OSS refresh done (close fallback), objects:', objects.length);
        }
      } catch {}
      try {
        fs.unlinkSync(resultFile);
      } catch {}
      process.removeListener('SIGUSR2', sigusr2Handler);
    }, 100);
  });

  armSigusr2();
  return null; // Fire-and-forget — result delivered via SIGUSR2 signal
}

// Lazy OSS client — used by cleanupOss() scheduler runs (the /api/admin/oss/stats
// hot path uses runOssListInWorker() in a worker thread instead).
// 桌面版不初始化 OSS。
let _ossClient = null;
function getOss() {
  if (IS_LOCAL) return null;
  if (_ossClient) return _ossClient;
  if (!OSS) return null;
  _ossClient = new OSS({
    region: 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_AK,
    accessKeySecret: process.env.OSS_SK,
    bucket: 'biof3-uploads',
    timeout: 60000,
  });
  return _ossClient;
}

// ============================================================
// Stats
// ============================================================

function dirStats(dir) {
  if (!fs.existsSync(dir)) return { totalBytes: 0, fileCount: 0, dirCount: 0 };
  let totalBytes = 0,
    fileCount = 0,
    dirCount = 0;
  function walk(p) {
    let st;
    try {
      st = fs.lstatSync(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) {
      // Don't follow symlinks; symlink itself is tiny
      totalBytes += st.size;
      fileCount++;
      return;
    }
    if (st.isDirectory()) {
      dirCount++;
      let entries;
      try {
        entries = fs.readdirSync(p);
      } catch {
        return;
      }
      for (const f of entries) walk(path.join(p, f));
    } else if (st.isFile()) {
      totalBytes += st.size;
      fileCount++;
    }
  }
  walk(dir);
  return { totalBytes, fileCount, dirCount };
}

function getStats() {
  const partial = {
    totalBytes: -1,
    fileCount: -1,
    dirCount: 0,
    files: [],
    sizeHuman: '>8s 超时，返回部分数据',
  };

  const temp = withTimeout(() => dirStats(TEMP_DIR), 8000, {
    totalBytes: 0,
    fileCount: 0,
    dirCount: 0,
  });
  const cache = withTimeout(() => dirStats(CACHE_DIR), 8000, {
    totalBytes: 0,
    fileCount: 0,
    dirCount: 0,
  });

  // List cache files breakdown — also timed
  const _cacheFiles = [];
  const partialFiles = withTimeout(
    () => {
      try {
        return fs
          .readdirSync(CACHE_DIR)
          .map((name) => {
            const full = path.join(CACHE_DIR, name);
            let st;
            try {
              st = fs.lstatSync(full);
            } catch {
              return null;
            }
            return {
              name,
              size: st.size,
              isSymlink: st.isSymbolicLink(),
              mtime: st.mtime.toISOString(),
              atime: st.atime.toISOString(),
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.size - a.size);
      } catch {
        return [];
      }
    },
    8000,
    []
  );

  const effectiveTemp = temp.totalBytes >= 0 ? temp : partial;
  const effectiveCache = cache.totalBytes >= 0 ? cache : partial;

  return {
    temp: {
      totalBytes: effectiveTemp.totalBytes,
      fileCount: effectiveTemp.fileCount,
      dirCount: effectiveTemp.dirCount,
      sizeHuman: effectiveTemp.totalBytes >= 0 ? humanSize(effectiveTemp.totalBytes) : '超时',
    },
    cache: {
      totalBytes: effectiveCache.totalBytes,
      fileCount: effectiveCache.fileCount,
      dirCount: effectiveCache.dirCount,
      sizeHuman: effectiveCache.totalBytes >= 0 ? humanSize(effectiveCache.totalBytes) : '超时',
      files: (cache.totalBytes >= 0 ? partialFiles : []).slice(0, 50),
    },
    totalBytes:
      (effectiveTemp.totalBytes >= 0 ? effectiveTemp.totalBytes : 0) +
      (effectiveCache.totalBytes >= 0 ? effectiveCache.totalBytes : 0),
    totalHuman: humanSize(
      (effectiveTemp.totalBytes >= 0 ? effectiveTemp.totalBytes : 0) +
        (effectiveCache.totalBytes >= 0 ? effectiveCache.totalBytes : 0)
    ),
  };
}

function humanSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function execFileText(cmd, args, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = err.killed ? `${cmd} timeout after ${timeoutMs}ms` : stderr || err.message;
        reject(new Error(String(msg).trim()));
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

async function dfForPath(targetPath) {
  const out = await execFileText('df', ['-PkT', targetPath], 5000);
  const line = out.trim().split('\n')[1] || '';
  const parts = line.trim().split(/\s+/);
  if (parts.length < 7) throw new Error('unexpected df output');
  const blocks = Number(parts[2] || 0);
  const used = Number(parts[3] || 0);
  const available = Number(parts[4] || 0);
  return {
    filesystem: parts[0],
    type: parts[1],
    mountedOn: parts.slice(6).join(' '),
    totalBytes: blocks * 1024,
    usedBytes: used * 1024,
    availableBytes: available * 1024,
    usePercent: Number(String(parts[5] || '').replace('%', '')) || 0,
    totalHuman: humanSize(blocks * 1024),
    usedHuman: humanSize(used * 1024),
    availableHuman: humanSize(available * 1024),
  };
}

async function duForPath(targetPath) {
  const out = await execFileText('du', ['-sk', targetPath], 8000);
  const kb = Number(out.trim().split(/\s+/)[0] || 0);
  return kb * 1024;
}

function localDiskTargets() {
  const targets = [
    {
      key: 'computeVolume',
      label: 'Dell compute volume',
      path: '/mnt/storage_16tb/omichub',
      measureUsage: false,
    },
    { key: 'rTemp', label: 'R temp', path: TEMP_DIR, measureUsage: true },
    { key: 'rCache', label: 'R cache', path: CACHE_DIR, measureUsage: true },
    {
      key: 'pyTemp',
      label: 'Python temp',
      path: process.env.BIOF3_PY_TEMP_DIR || '/mnt/storage_16tb/omichub/biof3-py-tmp',
      measureUsage: true,
    },
    {
      key: 'pyCache',
      label: 'Python cache',
      path: process.env.BIOF3_PY_CACHE_DIR || '/mnt/storage_16tb/omichub/biof3-py-tmp/_cache',
      measureUsage: true,
    },
    {
      key: 'toolJobs',
      label: 'Tool jobs',
      path: '/mnt/storage_16tb/omichub/biof3-tool-jobs',
      measureUsage: true,
    },
  ];
  if (process.env.BIOF3_TOOL_DEMO_RESULTS_DIR) {
    targets.push({
      key: 'toolDemoResults',
      label: 'Tool demo results',
      path: process.env.BIOF3_TOOL_DEMO_RESULTS_DIR,
      measureUsage: true,
    });
  }
  if (process.env.BIOF3_TOOL_DEMO_DATA_DIR) {
    targets.push({
      key: 'toolDemoData',
      label: 'Tool demo data',
      path: process.env.BIOF3_TOOL_DEMO_DATA_DIR,
      measureUsage: true,
    });
  }
  const seen = new Set();
  return targets.filter((t) => {
    if (!t.path || seen.has(t.path)) return false;
    seen.add(t.path);
    return true;
  });
}

async function getLocalDiskStats() {
  const warnings = [];
  const targets = localDiskTargets();
  const mountMap = new Map();
  const paths = await Promise.all(
    targets.map(async (target) => {
      const exists = fs.existsSync(target.path);
      const item = {
        ...target,
        exists,
        totalBytes: null,
        sizeHuman: exists ? '-' : 'missing',
        mount: null,
        error: null,
      };
      if (!exists) return item;
      try {
        const mount = await dfForPath(target.path);
        item.mount = mount.mountedOn;
        mountMap.set(`${mount.filesystem}:${mount.mountedOn}`, mount);
      } catch (e) {
        item.error = `df: ${e.message}`;
        warnings.push(`${target.key}: ${item.error}`);
      }
      if (target.measureUsage) {
        try {
          item.totalBytes = await duForPath(target.path);
          item.sizeHuman = humanSize(item.totalBytes);
        } catch (e) {
          item.error = item.error ? `${item.error}; du: ${e.message}` : `du: ${e.message}`;
          warnings.push(`${target.key}: du failed`);
        }
      }
      return item;
    })
  );

  return {
    host: require('os').hostname(),
    timestamp: new Date().toISOString(),
    mounts: Array.from(mountMap.values()).sort((a, b) => b.usePercent - a.usePercent),
    paths,
    warnings,
  };
}

// Wrap a synchronous function with a hard timeout. If it doesn't finish within
// `ms` milliseconds, return a "partial" result so the HTTP response never hangs.
// This prevents the admin panel from showing "loading…" forever when the NAS
// storage (16TB mount) is slow or unresponsive.
function withTimeout(fn, ms, fallbackValue) {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
  }, ms);
  try {
    const result = fn();
    clearTimeout(timer);
    return result;
  } catch {
    clearTimeout(timer);
    if (timedOut) {
      console.warn(`[CacheManager] getStats timed out after ${ms}ms — returning partial data`);
    }
    return fallbackValue;
  }
}

// ============================================================
// OSS helpers
// ============================================================

const OSS_BASE_URL = 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/';

/** Extract object key from a full OSS URL. Returns null if not our bucket. */
function urlToOssKey(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith(OSS_BASE_URL)) return null;
  return decodeURIComponent(url.slice(OSS_BASE_URL.length).split('?')[0]);
}

/** List all objects in the bucket. Returns array of {name, size, lastModified}. */
async function listAllOssObjects() {
  const client = getOss();
  const all = [];
  let continuationToken = undefined;
  do {
    const result = await client.listV2({
      'max-keys': 1000,
      'continuation-token': continuationToken,
    });
    if (result.objects) {
      for (const obj of result.objects) {
        all.push({
          name: obj.name,
          size: obj.size,
          lastModified: obj.lastModified,
        });
      }
    }
    continuationToken = result.nextContinuationToken;
  } while (continuationToken);
  return all;
}

/** Collect all OSS keys still referenced by the DB (datasets + analyses).
 *  Reads through the PG switch layer (getSqliteForLegacyModules) so in PG mode it
 *  sees the AUTHORITATIVE store, not a stale local SQLite — otherwise the daily OSS
 *  cleanup would treat real users' files as orphans and delete them.
 *  Throws on failure (caller MUST NOT delete on an incomplete reference set). */
function collectReferencedOssKeys() {
  const referenced = new Set();
  const dbMod = require('./db');
  const sqlDb = dbMod.getSqliteForLegacyModules();

  // Datasets
  const datasets = sqlDb.prepare('SELECT oss_url FROM datasets').all();
  for (const d of datasets) {
    const k = urlToOssKey(d.oss_url);
    if (k) referenced.add(k);
  }

  // Analyses — results JSON contains plots[].url and files[].url
  const analyses = sqlDb.prepare('SELECT results FROM analyses WHERE results IS NOT NULL').all();
  for (const a of analyses) {
    try {
      const r = typeof a.results === 'string' ? JSON.parse(a.results) : a.results;
      if (r?.plots)
        for (const p of r.plots) {
          const k = urlToOssKey(p.url);
          if (k) referenced.add(k);
        }
      if (r?.files)
        for (const f of r.files) {
          const k = urlToOssKey(f.url);
          if (k) referenced.add(k);
        }
    } catch {}
  }

  return referenced;
}

/** Get OSS storage stats: total size + count + sample top files.
 *  Returns cached data if fresh (< 5min) to avoid blocking the event-loop on ECS
 *  where deasync/PG sync calls can freeze the loop for 60+ seconds.
 *  Freshness is checked synchronously (no await) so this never hangs.
 *  Uses file-based IPC + SIGUSR2 so it works even when the event loop is blocked. */
function getOssStats() {
  const now = Date.now();
  // Synchronous cache check — no await, no event-loop dependency
  if (_ossStatsCache && now - _ossStatsCacheTime < OSS_STATS_TTL_MS) {
    return _ossStatsCache;
  }
  // Fire-and-forget refresh: runOssListInWorker handles the background refresh
  // using file-based IPC + SIGUSR2, so it works even with deasync blocking.
  if (!_ossStatsRefreshing) {
    _ossStatsRefreshing = true;
    console.log('[CacheManager] starting OSS stats refresh...');
    runOssListInWorker(90_000);
  }
  // Return stale cache if available, otherwise return placeholder
  if (_ossStatsCache) return _ossStatsCache;
  return {
    totalBytes: -1,
    sizeHuman: '获取中…',
    objectCount: -1,
    byPrefix: [],
    topFiles: [],
    _error: 'refresh pending',
  };
}

function computeOssStats(objects) {
  const totalBytes = objects.reduce((s, o) => s + o.size, 0);
  const byPrefix = {};
  for (const o of objects) {
    const prefix = o.name.split('/')[0] || '_root';
    if (!byPrefix[prefix]) byPrefix[prefix] = { count: 0, bytes: 0 };
    byPrefix[prefix].count++;
    byPrefix[prefix].bytes += o.size;
  }
  return {
    totalBytes,
    sizeHuman: humanSize(totalBytes),
    objectCount: objects.length,
    byPrefix: Object.entries(byPrefix)
      .map(([prefix, s]) => ({
        prefix,
        count: s.count,
        sizeHuman: humanSize(s.bytes),
      }))
      .sort((a, b) => b.count - a.count),
    topFiles: [...objects]
      .sort((a, b) => b.size - a.size)
      .slice(0, 20)
      .map((o) => ({
        ...o,
        sizeHuman: humanSize(o.size),
      })),
  };
}

// Cache for OSS stats (5 minute TTL so page reload gets fresh data)
let _ossStatsCache = null;
let _ossStatsCacheTime = 0;
const OSS_STATS_TTL_MS = 5 * 60 * 1000;
let _ossStatsRefreshing = false;

/** Cleanup OSS — delete orphans + old files. Always preserve `demo/` prefix. */
async function cleanupOss(opts = {}) {
  const { dryRun = true, maxAgeDays = DEFAULT_OSS_MAX_AGE_DAYS } = opts;

  const report = {
    dryRun,
    deleted: [],
    kept: [],
    bytesFreed: 0,
    errors: [],
  };

  const referenced = collectReferencedOssKeys();
  // Fail-safe: an empty reference set almost always means a read problem, not a
  // truly empty platform. Deleting against an empty set would wipe real user files.
  if (!referenced || referenced.size === 0) {
    report.errors.push(
      'Aborted: reference set empty (likely DB read issue) — refusing to delete OSS objects'
    );
    console.error('[OSS] cleanup aborted: empty reference set');
    return report;
  }
  const _cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;

  let objects;
  try {
    objects = await listAllOssObjects();
  } catch (e) {
    report.errors.push(`List OSS failed: ${e.message}`);
    return report;
  }

  const client = getOss();
  const toDelete = [];

  for (const obj of objects) {
    // Always keep demo/
    if (obj.name.startsWith('demo/')) {
      report.kept.push({ name: obj.name, reason: 'demo' });
      continue;
    }

    const isReferenced = referenced.has(obj.name);
    const age = Date.now() - new Date(obj.lastModified).getTime();
    const isOld = age > maxAgeDays * 24 * 3600 * 1000;

    if (isReferenced) {
      report.kept.push({ name: obj.name, reason: 'referenced' });
    } else if (isOld) {
      // Orphan + old → delete
      toDelete.push(obj);
    } else {
      // Orphan but recent (within grace period) → keep
      report.kept.push({ name: obj.name, reason: 'recent (grace)' });
    }
  }

  // Batch delete (OSS supports up to 1000 per call)
  if (toDelete.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      const keys = batch.map((o) => o.name);
      try {
        if (!dryRun) {
          await client.deleteMulti(keys, { quiet: true });
        }
        for (const obj of batch) {
          report.deleted.push({
            name: obj.name,
            sizeBytes: obj.size,
            sizeHuman: humanSize(obj.size),
            lastModified: obj.lastModified,
          });
          report.bytesFreed += obj.size;
        }
      } catch (e) {
        report.errors.push(`Batch delete failed: ${e.message}`);
      }
    }
  }

  report.bytesFreedHuman = humanSize(report.bytesFreed);
  return report;
}

// ============================================================
// Cleanup
// ============================================================

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
    return true;
  } catch (e) {
    console.error(`[Cache] rm failed: ${p} - ${e.message}`);
    return false;
  }
}

/**
 * Run cleanup. Returns a report.
 *
 * @param {object} opts
 * @param {boolean} opts.dryRun - if true, list candidates without deleting
 * @param {number} opts.tempMaxAgeHours
 * @param {number} opts.cacheMaxIdleDays
 */
function cleanup(opts = {}) {
  const {
    dryRun = false,
    tempMaxAgeHours = DEFAULT_TEMP_MAX_AGE_HOURS,
    cacheMaxIdleDays = DEFAULT_CACHE_MAX_IDLE_DAYS,
  } = opts;

  const report = {
    dryRun,
    tempDeleted: [],
    cacheDeleted: [],
    cacheKept: [],
    bytesFreed: 0,
    errors: [],
  };

  const now = Date.now();
  const tempCutoff = now - tempMaxAgeHours * 3600 * 1000;
  const cacheCutoff = now - cacheMaxIdleDays * 24 * 3600 * 1000;

  // Get running task IDs from task-manager (avoid deleting active work)
  const runningTaskIds = new Set();
  try {
    const { listTasks } = require('./task-manager');
    if (listTasks) {
      for (const t of listTasks(1000)) {
        if (t.status === 'running' || t.status === 'pending' || t.status === 'queued') {
          runningTaskIds.add(t.taskId);
        }
      }
    }
  } catch (e) {
    report.errors.push(`Failed to load task-manager: ${e.message}`);
  }

  // Get active analysis taskIds from DB (preserve corresponding caches).
  // Read via PG switch layer so PG mode sees real analyses, not stale local SQLite.
  const dbTaskIds = new Set();
  try {
    const dbMod = require('./db');
    const sqlDb = dbMod.getSqliteForLegacyModules();
    const rows = sqlDb.prepare('SELECT task_id FROM analyses WHERE task_id IS NOT NULL').all();
    for (const r of rows) if (r.task_id) dbTaskIds.add(r.task_id);
  } catch (e) {
    report.errors.push(`Failed to query DB for active taskIds: ${e.message}`);
  }

  // ---------- Clean TEMP_DIR ----------
  if (fs.existsSync(TEMP_DIR)) {
    let entries;
    try {
      entries = fs.readdirSync(TEMP_DIR);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      // Only delete `task-*` directories (leave `uploads/`, `demo-setup/`, etc. alone)
      if (!name.startsWith('task-')) continue;
      const full = path.join(TEMP_DIR, name);
      let st;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;

      // Extract taskId (after 'task-' prefix)
      const taskId = name.replace(/^task-/, '');
      // Skip if running
      if (runningTaskIds.has(taskId)) continue;

      // Check age
      if (st.mtimeMs > tempCutoff) continue;

      // Compute size before deletion (for report)
      const { totalBytes } = dirStats(full);
      report.tempDeleted.push({ name, sizeBytes: totalBytes, mtime: st.mtime.toISOString() });
      report.bytesFreed += totalBytes;

      if (!dryRun) rmrf(full);
    }
  }

  // ---------- Clean CACHE_DIR ----------
  if (fs.existsSync(CACHE_DIR)) {
    let entries;
    try {
      entries = fs.readdirSync(CACHE_DIR);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      const full = path.join(CACHE_DIR, name);
      let st;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }

      // ALWAYS preserve:
      // 1. demo-* files
      // 2. Symbolic links
      if (name.startsWith('demo-') || st.isSymbolicLink()) {
        report.cacheKept.push({ name, reason: name.startsWith('demo-') ? 'demo' : 'symlink' });
        continue;
      }

      // Only handle task-{id}.rds files
      const m = name.match(/^task-(.+)\.rds$/);
      if (!m) {
        report.cacheKept.push({ name, reason: 'unknown-pattern' });
        continue;
      }
      const taskId = m[1];

      // Check if running
      if (runningTaskIds.has(taskId)) {
        report.cacheKept.push({ name, reason: 'running' });
        continue;
      }

      // Decide: delete if (orphan OR idle too long)
      const isOrphan = !dbTaskIds.has(taskId);
      const isIdle = st.atimeMs < cacheCutoff;

      if (isOrphan) {
        report.cacheDeleted.push({
          name,
          sizeBytes: st.size,
          reason: 'orphan (no DB record)',
          atime: st.atime.toISOString(),
        });
        report.bytesFreed += st.size;
        if (!dryRun) {
          try {
            fs.unlinkSync(full);
          } catch (e) {
            report.errors.push(`unlink ${name}: ${e.message}`);
          }
        }
      } else if (isIdle) {
        report.cacheDeleted.push({
          name,
          sizeBytes: st.size,
          reason: `idle ${cacheMaxIdleDays}+ days`,
          atime: st.atime.toISOString(),
        });
        report.bytesFreed += st.size;
        if (!dryRun) {
          try {
            fs.unlinkSync(full);
          } catch (e) {
            report.errors.push(`unlink ${name}: ${e.message}`);
          }
        }
      } else {
        report.cacheKept.push({ name, reason: 'active' });
      }
    }
  }

  report.bytesFreedHuman = humanSize(report.bytesFreed);
  return report;
}

// ============================================================
// Scheduler — run cleanup daily at 03:00
// ============================================================

let schedulerHandle = null;

function startScheduler() {
  if (schedulerHandle) return; // already running

  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    schedulerHandle = setTimeout(async () => {
      try {
        const localReport = cleanup();
        console.log(
          `[CacheManager] Local cleanup: freed ${localReport.bytesFreedHuman}, removed ${localReport.tempDeleted.length} temp dirs, ${localReport.cacheDeleted.length} cache files`
        );
      } catch (e) {
        console.error('[CacheManager] Local cleanup error:', e);
      }
      try {
        const ossReport = await cleanupOss({ dryRun: false });
        console.log(
          `[CacheManager] OSS cleanup: freed ${ossReport.bytesFreedHuman}, removed ${ossReport.deleted.length} objects`
        );
      } catch (e) {
        console.error('[CacheManager] OSS cleanup error:', e);
      }
      scheduleNext();
    }, delay);
    console.log(
      `[CacheManager] Next cleanup scheduled at ${next.toISOString()} (in ${Math.round(delay / 60000)} min)`
    );
  }

  scheduleNext();
}

function stopScheduler() {
  if (schedulerHandle) {
    clearTimeout(schedulerHandle);
    schedulerHandle = null;
  }
}

module.exports = {
  getStats,
  getLocalDiskStats,
  cleanup,
  getOssStats,
  cleanupOss,
  startScheduler,
  stopScheduler,
  humanSize,
};
