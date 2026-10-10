/**
 * Cache & Temp Space Manager
 *
 * Cleanup rules:
 *   - TEMP_DIR:
 *       Delete task-* dirs older than 24h. Skip if dir name matches a
 *       running task (in-memory tasks Map).
 *
 *   - CACHE_DIR:
 *       Always keep:
 *         - demo-*.rds
 *         - symbolic links (point to demo files)
 *       For real task-{taskId}.rds:
 *         - Delete if no analysis in DB references this taskId (orphan)
 *         - Delete if not accessed in 7+ days (LRU style)
 *
 * Exposed:
 *   - getStats() — disk usage + file count + breakdown
 *   - getLocalDiskStats() — df/du across configured local paths
 *   - cleanup({dryRun, tempMaxAgeHours, cacheMaxIdleDays}) — perform cleanup
 *   - startScheduler() — run cleanup daily at 03:00 (server local time)
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const config = require('./config');
const TEMP_DIR = config.tempDir || '/tmp/petri-tmp';
const CACHE_DIR = path.join(TEMP_DIR, '_cache');

const DEFAULT_TEMP_MAX_AGE_HOURS = 24;
const DEFAULT_CACHE_MAX_IDLE_DAYS = 7;

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
    { key: 'rTemp', label: 'R temp', path: TEMP_DIR, measureUsage: true },
    { key: 'rCache', label: 'R cache', path: CACHE_DIR, measureUsage: true },
  ];
  if (process.env.PETRI_PY_TEMP_DIR) {
    targets.push({
      key: 'pyTemp',
      label: 'Python temp',
      path: process.env.PETRI_PY_TEMP_DIR,
      measureUsage: true,
    });
  }
  if (process.env.PETRI_PY_CACHE_DIR) {
    targets.push({
      key: 'pyCache',
      label: 'Python cache',
      path: process.env.PETRI_PY_CACHE_DIR,
      measureUsage: true,
    });
  }
  if (process.env.PETRI_TOOL_DEMO_RESULTS_DIR) {
    targets.push({
      key: 'toolDemoResults',
      label: 'Tool demo results',
      path: process.env.PETRI_TOOL_DEMO_RESULTS_DIR,
      measureUsage: true,
    });
  }
  if (process.env.PETRI_TOOL_DEMO_DATA_DIR) {
    targets.push({
      key: 'toolDemoData',
      label: 'Tool demo data',
      path: process.env.PETRI_TOOL_DEMO_DATA_DIR,
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

  // Get active analysis taskIds from DB (preserve corresponding caches).
  const runningTaskIds = new Set();
  const dbTaskIds = new Set();
  try {
    const dbMod = require('./db');
    const sqlDb = dbMod.getDatabase();
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
    schedulerHandle = setTimeout(() => {
      try {
        const localReport = cleanup();
        console.log(
          `[CacheManager] Local cleanup: freed ${localReport.bytesFreedHuman}, removed ${localReport.tempDeleted.length} temp dirs, ${localReport.cacheDeleted.length} cache files`
        );
      } catch (e) {
        console.error('[CacheManager] Local cleanup error:', e);
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
  startScheduler,
  stopScheduler,
  humanSize,
};
