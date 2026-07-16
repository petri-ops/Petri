/**
 * BioF3 Python Server — Centralized Configuration
 *
 * Mirrors r-server/config.js pattern for consistency.
 * Override via environment variables or .env file.
 */

const path = require('path');
const tempDir = process.env.BIOF3_PY_TEMP_DIR || process.env.BIOF3_TEMP_DIR || '/tmp/biof3-py-tmp';

const config = {
  // Server
  port: parseInt(process.env.PY_SERVER_PORT || '3004', 10),
  apiToken: process.env.BIOF3_API_TOKEN || 'biof3-figcode-2026',

  // ── 桌面版模式（与 r-server/config.js 对称）──────────────────
  // storageMode: 'local'（桌面版，本地文件系统）
  storageMode: process.env.BIOF3_STORAGE || 'local',
  // localMode: 桌面版跳过 JWT 验证
  localMode: process.env.BIOF3_LOCAL_MODE === '1',
  // Python Runtime 路径（桌面版内嵌 Python 的根目录）
  pyHome: process.env.BIOF3_PY_HOME || '',
  // 本地结果/上传目录（桌面版用户数据目录）
  localResultsDir: process.env.BIOF3_LOCAL_RESULTS_DIR || '',
  localUploadsDir: process.env.BIOF3_LOCAL_UPLOADS_DIR || '',
  localDataDir: process.env.BIOF3_LOCAL_DATA_DIR || path.dirname(tempDir),
  // 桌面版标记
  desktop: process.env.BIOF3_DESKTOP === '1',

  // Paths (host-side)
  tempDir,
  // Fast-path timeout
  runTimeoutMs: parseInt(process.env.PY_RUN_TIMEOUT_MS || '30000', 10),

  // Pool concurrency
  poolSize: parseInt(process.env.PY_POOL_SIZE || '2', 10),
  poolEnabled: process.env.PY_POOL_ENABLED !== 'false',

  // Rate limiting
  rateLimitPerMinute: parseInt(process.env.PY_RATE_LIMIT || '20', 10),

  // Upload
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(500 * 1024 * 1024), 10),
};

module.exports = config;
