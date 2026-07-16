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
  // execMode: 'docker'（web 版）| 'local'（桌面版，直接调 python3）
  execMode: process.env.BIOF3_EXEC_MODE || 'docker',
  // storageMode: 'oss'（web 版）| 'local'（桌面版，本地文件系统）
  storageMode: process.env.BIOF3_STORAGE || 'oss',
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
  // W4-A (2026-05-28): result cache for parentTaskId reuse (mirror r-server biof3-cache pattern).
  // Lives under tempDir/_cache so we don't need a new docker mount; container sees it at containerCacheDir.
  cacheDir: process.env.BIOF3_PY_CACHE_DIR || '/mnt/storage_16tb/omichub/biof3-py-tmp/_cache',
  containerCacheDir: process.env.PY_CONTAINER_CACHE_DIR || '/app/data/biof3-py-tmp/_cache',
  dbPath: process.env.BIOF3_PY_DB_PATH || path.join(__dirname, 'pyserver.db'),

  // Docker Python execution
  pyContainer: process.env.PY_CONTAINER || 'biof3_python_1',
  containerTempDir: process.env.PY_CONTAINER_TEMP_DIR || '/app/data/biof3-py-tmp',

  // 桌面版 local 模式：containerTempDir = tempDir（无容器路径转换）
  get effectiveContainerTempDir() {
    return execMode === 'local' ? this.tempDir : this.containerTempDir;
  },
  get effectiveContainerCacheDir() {
    return execMode === 'local' ? this.cacheDir : this.containerCacheDir;
  },

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

  // OSS (shared with r-server)
  oss: {
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_AK || '',
    accessKeySecret: process.env.OSS_SK || '',
    bucket: process.env.OSS_BUCKET || 'biof3-uploads',
    endpoint: process.env.OSS_ENDPOINT || 'oss-cn-hangzhou.aliyuncs.com',
  },

  // Upload
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(500 * 1024 * 1024), 10),

  // Task cleanup
  taskRetentionMs: parseInt(process.env.TASK_RETENTION_MS || String(24 * 60 * 60 * 1000), 10),
};

config.ossHost = `https://${config.oss.bucket}.${config.oss.endpoint}`;

module.exports = config;
