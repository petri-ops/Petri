/**
 * Petri R Server — Centralized Configuration
 *
 * All environment-dependent paths and settings in one place.
 * Override via environment variables or .env file.
 */

const path = require('path');

// A-009: pull the port from env-coordinator's single source of truth
// instead of duplicating the petri-server default literal here.
const { getBackendPort } = require('../../src/main/env-coordinator');

// A-010: pull the 6 core desktop env keys (busyTimeout + rHome +
// localResultsDir + localUploadsDir + tempDir + dbPath) through
// config-helper.getCoreEnv(). Behaviour-identical to the previous
// process.env.X || default reads (PHASE 1.2 invariant), but a
// single mutation point — env-coordinator → config-helper.getCoreEnv()
// → here — replaces 6 separate process.env lookups.
const { getCoreEnv } = require('../shared-backend/config-helper');

const _coreEnv = getCoreEnv();

const config = {
  // R Runtime 路径（桌面版内嵌 R 的根目录）
  // A-010: previously read process.env.PETRI_R_HOME directly with empty-string
  // fallback. Now sourced from config-helper.getCoreEnv().rHome.
  rHome: _coreEnv.rHome,
  // 本地结果/上传目录（桌面版用户数据目录）
  // A-010: previously read process.env.PETRI_LOCAL_RESULTS_DIR directly.
  localResultsDir: _coreEnv.localResultsDir,
  // A-010: previously read process.env.PETRI_LOCAL_UPLOADS_DIR directly.
  localUploadsDir: _coreEnv.localUploadsDir,
  // AI LLM Provider（桌面版用户可切换 deepseek/openai/ollama）
  llmProvider: process.env.PETRI_LLM_PROVIDER || 'deepseek',
  embedProvider: process.env.PETRI_EMBED_PROVIDER || 'dashscope',
  // 桌面版标记（前端通过构建时环境变量感知）
  desktop: process.env.PETRI_DESKTOP === '1',

  // Server
  // A-009: delegates to env-coordinator.getBackendPort('r') which falls
  // back to 3001 (matches preload.js / backend-health.js historical
  // defaults). Electron's main process always overwrites process.env
  // before this module is reached.
  port: getBackendPort('r'),
  // Paths (host-side)
  // A-010: previously read process.env.PETRI_TEMP_DIR directly.
  tempDir: _coreEnv.tempDir,
  // A-010: previously read process.env.PETRI_DB_PATH directly. The previous
  // default was an petri-server-relative path; preserved here as the
  // empty-string fallback is later defaulted in db.js if the env var
  // is unset (matches the historical contract — db.js handles the actual
  // filesystem fallback so callers can override with absolute paths).
  dbPath: _coreEnv.dbPath || path.join(__dirname, 'petri.db'),

  // Timeouts
  runTimeoutMs: parseInt(process.env.R_RUN_TIMEOUT_MS || '30000', 10),

  // R Pool (warm workers for /api/run)
  poolSize: parseInt(process.env.R_POOL_SIZE || '2', 10),
  poolEnabled: process.env.R_POOL_ENABLED !== 'false', // enabled by default

  // Rate limiting
  rateLimitPerMinute: parseInt(process.env.R_RATE_LIMIT || '20', 10),

  // Upload
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(500 * 1024 * 1024), 10),

  // FigCode static tool demos (legacy dirs under petri-server). Production: leave unset + PETRI_TOOL_DEMO_DISABLED=1
  toolDemoDisabled: process.env.PETRI_TOOL_DEMO_DISABLED === '1',
  toolDemoDataDir: process.env.PETRI_TOOL_DEMO_DATA_DIR || '',
  toolDemoResultsDir: process.env.PETRI_TOOL_DEMO_RESULTS_DIR || '',
};

/**
 * Create a local directory recursively.
 *
 * @param {string} dirPath - absolute path
 */
config.mkdirSandbox = function mkdirSandbox(dirPath) {
  const fs = require('fs');
  fs.mkdirSync(dirPath, {recursive: true});
};

module.exports = config;
