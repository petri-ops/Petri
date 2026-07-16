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
  // execMode: 'docker'（web 版，走 docker exec）| 'local'（桌面版，直接调 Rscript）
  execMode: process.env.BIOF3_EXEC_MODE || 'docker',
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

  // Docker R execution
  rContainer: process.env.R_CONTAINER || 'omichub_react_backend_1',
  containerTempDir: process.env.CONTAINER_TEMP_DIR || '/app/data/biof3-tmp',
  // Sandbox: docker exec --user value (e.g. "nobody:nogroup"). Empty = run as container default (root).
  // Enable in production for ε-test by setting R_EXEC_USER=nobody:nogroup.
  // Pre-requisite: container temp dir must be writable by the chosen user.
  rExecUser: process.env.R_EXEC_USER || '',

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
 * Build the prefix args for `docker exec ... <command>`.
 * Returns ['exec', '<container>'] or ['exec', '-u', '<user>', '-e', 'HOME=/tmp', '<container>'].
 *
 * @param {object|boolean} opts - {interactive, container} or boolean for legacy `interactive` flag.
 * @returns {string[]}
 *
 * Usage:
 *   spawn('docker', [...config.dockerExecArgs(), 'Rscript', ...])
 *   spawn('docker', [...config.dockerExecArgs({interactive: true}), 'Rscript', ...])
 *   spawn('docker', [...config.dockerExecArgs({container: 'biof3_python_1'}), 'python3', ...])
 *
 * Note on HOME: when running as 'nobody' (whose home is /nonexistent), R will fail to
 * read/write ~/.RData ~/.Renviron etc. We force HOME=/tmp (writable for everyone) when
 * a sandbox user is set, so R initializes cleanly without polluting any user dir.
 *
 * Note on BLAS threads: OpenBLAS by default tries to spawn N=cpu_count threads.
 * Combined with the container's --pids-limit cgroup, a single R process can hit the
 * pid quota and crash with "pthread_create failed: Resource temporarily unavailable".
 * We cap BLAS at 2 threads in sandbox mode — sufficient for the workloads we run
 * and well below any reasonable pids-limit.
 */
config.dockerExecArgs = function dockerExecArgs(opts = {}) {
  // Legacy: dockerExecArgs(true) means interactive=true
  if (opts === true) opts = {interactive: true};
  const interactive = !!opts.interactive;
  const container = opts.container || config.rContainer;
  // Sandbox user is only applied to the R container (Python container has its own setup)
  const applyUser = config.rExecUser && container === config.rContainer;

  const args = ['exec'];
  if (interactive) args.push('-i');
  if (applyUser) {
    args.push('-u', config.rExecUser);
    args.push('-e', 'HOME=/tmp');
    // Cap BLAS threads to stay well under --pids-limit
    args.push('-e', 'OPENBLAS_NUM_THREADS=2');
    args.push('-e', 'OMP_NUM_THREADS=2');
    args.push('-e', 'MKL_NUM_THREADS=2');
  }
  args.push(container);
  return args;
};

/**
 * Create a directory and (when sandbox is enabled) make it world-writable with sticky bit (1777).
 * Used for any directory that the sandboxed R process needs to write into:
 *   - /api/run session dirs
 *   - tool job dirs (and their output/ subdirs)
 *   - long-running task work dirs
 *
 * Behavior is identical to fs.mkdirSync({recursive:true}) when R_EXEC_USER is empty —
 * so non-sandbox installations see no permission change.
 *
 * @param {string} dirPath - absolute path
 */
config.mkdirSandbox = function mkdirSandbox(dirPath) {
  const fs = require('fs');
  fs.mkdirSync(dirPath, {recursive: true});
  if (config.rExecUser) {
    try { fs.chmodSync(dirPath, 0o1777); } catch {}
  }
};

module.exports = config;

