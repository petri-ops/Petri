/**
 * BioF3 R Server — Centralized Configuration
 *
 * All environment-dependent paths and settings in one place.
 * Override via environment variables or .env file.
 */

const path = require('path');

const config = {
  // platform = ECS control plane only (auth, data, copilot, tools enqueue; no R docker)
  // api = HTTP enqueue tasks, no local drain (Dell workers consume PG tasks)
  // worker = poll queue + run R only (no HTTP server)
  // all = API + local worker (single-node / Dell legacy)
  runMode: (process.env.BIOF3_RUN_MODE || 'all').toLowerCase(),
  workerId: process.env.BIOF3_WORKER_ID || require('os').hostname(),

  // ── 桌面版模式（Electron 本地运行）──────────────────────────
  // execMode: 桌面版恒为 'local'（直接调内嵌 Rscript，不走 docker）
  execMode: process.env.BIOF3_EXEC_MODE || 'local',
  // storageMode: 'local'（桌面版，本地文件系统）
  storageMode: process.env.BIOF3_STORAGE || 'local',
  // localMode: 桌面版跳过 JWT 验证，返回固定 local-user
  localMode: process.env.BIOF3_LOCAL_MODE === '1',
  // R Runtime 路径（桌面版内嵌 R 的根目录）
  rHome: process.env.BIOF3_R_HOME || '',
  // 本地结果/上传目录（桌面版用户数据目录）
  localResultsDir: process.env.BIOF3_LOCAL_RESULTS_DIR || '',
  localUploadsDir: process.env.BIOF3_LOCAL_UPLOADS_DIR || '',
  // AI LLM Provider（桌面版用户可切换 deepseek/openai/ollama）
  llmProvider: process.env.BIOF3_LLM_PROVIDER || 'deepseek',
  embedProvider: process.env.BIOF3_EMBED_PROVIDER || 'dashscope',
  // 桌面版标记（前端通过构建时环境变量感知）
  desktop: process.env.BIOF3_DESKTOP === '1',

  // Server
  port: parseInt(process.env.R_SERVER_PORT || '3003', 10),
  apiToken: process.env.BIOF3_API_TOKEN || 'biof3-figcode-2026',

  // Paths (host-side)
  tempDir: process.env.BIOF3_TEMP_DIR || '/mnt/storage_16tb/omichub/biof3-tmp',
  dbPath: process.env.BIOF3_DB_PATH || path.join(__dirname, 'biof3.db'),

  // Canonical 执行路径根（execution-context 用于稳定的跨引用标识，非实际文件系统路径）
  containerTempDir: process.env.CONTAINER_TEMP_DIR || '/app/data/biof3-tmp',

  // Timeouts
  runTimeoutMs: parseInt(process.env.R_RUN_TIMEOUT_MS || '30000', 10),
  taskTimeoutMs: parseInt(process.env.R_TASK_TIMEOUT_MS || '600000', 10), // 10 min

  // Concurrency — how many R tasks can run in parallel
  maxConcurrentTasks: parseInt(process.env.R_MAX_CONCURRENT_TASKS || '3', 10),

  // R Pool (warm workers for /api/run)
  poolSize: parseInt(process.env.R_POOL_SIZE || '2', 10),
  poolEnabled: process.env.R_POOL_ENABLED !== 'false', // enabled by default

  // Rate limiting
  rateLimitPerMinute: parseInt(process.env.R_RATE_LIMIT || '20', 10),

  // Upload
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(500 * 1024 * 1024), 10),

  // Task cleanup
  taskRetentionMs: parseInt(process.env.TASK_RETENTION_MS || String(24 * 60 * 60 * 1000), 10),

  // FigCode static tool demos (legacy dirs under r-server). Production: leave unset + BIOF3_TOOL_DEMO_DISABLED=1
  toolDemoDisabled: process.env.BIOF3_TOOL_DEMO_DISABLED === '1',
  toolDemoDataDir: process.env.BIOF3_TOOL_DEMO_DATA_DIR || '',
  toolDemoResultsDir: process.env.BIOF3_TOOL_DEMO_RESULTS_DIR || '',
};

/**
 * Create a directory (recursive). Kept as a named helper for the call sites that
 * previously needed docker-sandbox permission tweaks; on desktop it's a plain mkdir.
 *
 * @param {string} dirPath - absolute path
 */
config.mkdirSandbox = function mkdirSandbox(dirPath) {
  const fs = require('fs');
  fs.mkdirSync(dirPath, {recursive: true});
};

module.exports = config;

