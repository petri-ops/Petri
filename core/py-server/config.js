/**
 * BioF3 Python Server — Centralized Configuration
 *
 * Mirrors r-server/config.js pattern for consistency.
 * Override via environment variables or .env file.
 */

const path = require('path');

const config = {
  // api = HTTP enqueue + /api/run pool; worker = claim PG tasks only; all = API + local drain (legacy single-node)
  runMode: (process.env.BIOF3_RUN_MODE || 'all').toLowerCase(),
  // Server
  port: parseInt(process.env.PY_SERVER_PORT || '3004', 10),
  apiToken: process.env.BIOF3_API_TOKEN || 'biof3-figcode-2026',
  workerId: process.env.BIOF3_WORKER_ID || require('os').hostname(),

  // ── 桌面版模式（与 r-server/config.js 对称）──────────────────
  // execMode: 桌面版恒为 'local'（直接调内嵌 python3，不走 docker）
  execMode: process.env.BIOF3_EXEC_MODE || 'local',
  // storageMode: 'local'（桌面版，本地文件系统）
  storageMode: process.env.BIOF3_STORAGE || 'local',
  // localMode: 桌面版跳过 JWT 验证
  localMode: process.env.BIOF3_LOCAL_MODE === '1',
  // Python Runtime 路径（桌面版内嵌 Python 的根目录）
  pyHome: process.env.BIOF3_PY_HOME || '',
  // 本地结果/上传目录（桌面版用户数据目录）
  localResultsDir: process.env.BIOF3_LOCAL_RESULTS_DIR || '',
  localUploadsDir: process.env.BIOF3_LOCAL_UPLOADS_DIR || '',
  // 桌面版标记
  desktop: process.env.BIOF3_DESKTOP === '1',

  // Paths (host-side)
  tempDir: process.env.BIOF3_PY_TEMP_DIR || '/mnt/storage_16tb/omichub/biof3-py-tmp',
  // W4-A (2026-05-28): result cache for parentTaskId reuse.
  cacheDir: process.env.BIOF3_PY_CACHE_DIR || '/mnt/storage_16tb/omichub/biof3-py-tmp/_cache',
  containerCacheDir: process.env.PY_CONTAINER_CACHE_DIR || '/app/data/biof3-py-tmp/_cache',
  dbPath: process.env.BIOF3_PY_DB_PATH || path.join(__dirname, 'pyserver.db'),

  // Canonical 执行路径根（execution-context 用于稳定的跨引用标识，非实际文件系统路径）
  containerTempDir: process.env.PY_CONTAINER_TEMP_DIR || '/app/data/biof3-py-tmp',

  // Timeouts
  // taskTimeoutMs=0 means "no timeout" — science workloads (Tangram CPU deconv,
  // cell2location, large slide spatial pipelines) routinely run 30+ min and that's
  // legitimate. Container resource limits (--memory=8g --cpus=4 --pids-limit=2000)
  // already protect against runaway processes; we don't need a hard wall clock.
  // Keep PY_TASK_TIMEOUT_MS env override for special cases (e.g. CI smoke tests).
  runTimeoutMs: parseInt(process.env.PY_RUN_TIMEOUT_MS || '30000', 10),
  taskTimeoutMs: parseInt(process.env.PY_TASK_TIMEOUT_MS || '0', 10),

  // Concurrency
  maxConcurrentTasks: parseInt(process.env.PY_MAX_CONCURRENT_TASKS || '3', 10),
  poolSize: parseInt(process.env.PY_POOL_SIZE || '2', 10),
  poolEnabled: process.env.PY_POOL_ENABLED !== 'false',

  // Rate limiting
  rateLimitPerMinute: parseInt(process.env.PY_RATE_LIMIT || '20', 10),

  // Upload
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(500 * 1024 * 1024), 10),

  // Task cleanup
  taskRetentionMs: parseInt(process.env.TASK_RETENTION_MS || String(24 * 60 * 60 * 1000), 10),
};

module.exports = config;
