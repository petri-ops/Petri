// Tools module — job submission + execution + results.
// Route registration is delegated to three submodules:
//   - tools-metadata:   PG-only reads/writes (status, history, job name/public)
//   - tools-platform:   public routes that auth then proxy to Dell or run local
//   - tools-internal:   Dell-only internal-token execution/file/cancel/delete
const fs = require('fs');
const path = require('path');
const dbMod = require('../db');
const config = require('../config');
const notify = require('../notify-feishu');
const {
  PUBLIC_DEMO_JOB_IDS,
  safeJoinUnder,
  createToolsAssetHandlers,
} = require('../helpers/tools-assets');
const {createToolsExecutor} = require('../helpers/tools-executor');
const {createToolsInternalRoutes} = require('./tools-internal');
const {createToolsMetadataRoutes} = require('./tools-metadata');
const {createToolsPlatformRoutes} = require('./tools-platform');

// PG bridge: when BIOF3_P2_PG=1 (ECS platform), use PostgreSQL via shim;
// when running on Dell without PG, falls back to local SQLite.
// tool_jobs table must exist (006_tool_jobs.sql migration).
const db = dbMod.getAsyncDbForLegacyModules();

// 桌面版（execMode=local）：job 目录放本地用户数据目录下；
// web 版（docker）：Dell 宿主机路径，挂载到容器 /app/data/biof3-tool-jobs
const JOBS_DIR = config.execMode === 'local'
  ? path.join(config.localResultsDir || path.join(require('os').homedir(), 'Documents', 'BioF3-Local', 'results'), 'tool-jobs')
  : '/mnt/storage_16tb/omichub/biof3-tool-jobs';
const SCRIPTS_DIR = path.join(__dirname, '..', 'tool-scripts');
/** Legacy static demo dirs — off by default (BIOF3_TOOL_DEMO_DISABLED=1). Demo = tool_jobs.is_public. */
const TOOL_DEMO_RESULTS_DIR = config.toolDemoResultsDir || '';
const TOOL_DEMO_DATA_DIR = config.toolDemoDataDir || '';
const STATIC_DEMO_ENABLED =
  !config.toolDemoDisabled &&
  !!(
    TOOL_DEMO_RESULTS_DIR &&
    TOOL_DEMO_DATA_DIR &&
    fs.existsSync(TOOL_DEMO_RESULTS_DIR)
  );

try { fs.mkdirSync(JOBS_DIR, {recursive: true}); } catch {}
try { fs.mkdirSync(SCRIPTS_DIR, {recursive: true}); } catch {}

function requireInternal(req, res) {
  if (req.isInternal) return true;
  res.status(403).json({error: 'internal_only'});
  return false;
}

function userId(req) { return req.user && (req.user.id || req.user.userId) || null; }

function canAccessToolJob(req, job) {
  const uid = userId(req);
  return job && (job.user_id === uid || (req.user && req.user.role === 'admin'));
}

function isCancellableJob(job) {
  return job && (job.status === 'pending' || job.status === 'running');
}

/**
 * Detect smoke-test requests by validating the X-BioF3-Smoke-Test header
 * against the SMOKE_TEST_TOKEN env var. Returns true only when the header
 * is present and matches. Used to isolate automated test traffic from
 * real-user analytics.
 */
function isSmokeTestRequest(req) {
  const expected = process.env.SMOKE_TEST_TOKEN;
  if (!expected) return false; // Disabled when token not set
  const got = req.headers['x-biof3-smoke-test'];
  return typeof got === 'string' && got === expected;
}

const {
  handlePublicDemo,
  handlePublicFile,
  handleDemoData,
  handleLegacyDemoFile,
  handleLegacyDemoList,
} = createToolsAssetHandlers({
  db,
  jobsDir: JOBS_DIR,
  toolDemoResultsDir: TOOL_DEMO_RESULTS_DIR,
  toolDemoDataDir: TOOL_DEMO_DATA_DIR,
  staticDemoEnabled: STATIC_DEMO_ENABLED,
});

const {
  handleToolRun,
  handlePrivateFileRead,
  handlePrivateFileWrite,
  handleGenerateFinalReport,
  killLocalToolJob,
  cleanupLocalToolJobDir,
} = createToolsExecutor({
  db,
  dbMod,
  config,
  notify,
  jobsDir: JOBS_DIR,
  scriptsDir: SCRIPTS_DIR,
  publicDemoJobIds: PUBLIC_DEMO_JOB_IDS,
  safeJoinUnder,
  getUserId: userId,
  isSmokeTestRequest,
});

const registerToolsMetadata = createToolsMetadataRoutes({db, getUserId: userId, jobsDir: JOBS_DIR});
const registerToolsInternal = createToolsInternalRoutes({
  requireInternal,
  handleToolRun,
  handlePublicDemo,
  handlePublicFile,
  handleDemoData,
  handleLegacyDemoFile,
  handleLegacyDemoList,
  handlePrivateFileRead,
  handlePrivateFileWrite,
  handleGenerateFinalReport,
  killLocalToolJob,
  cleanupLocalToolJobDir,
  isSmokeTestRequest,
  notify,
});
const registerToolsPlatform = createToolsPlatformRoutes({
  db,
  getUserId: userId,
  canAccessToolJob,
  isCancellableJob,
  handleToolRun,
  handlePrivateFileRead,
  handlePrivateFileWrite,
  handleGenerateFinalReport,
  killLocalToolJob,
  cleanupLocalToolJobDir,
  handlePublicDemo,
  handlePublicFile,
  handleDemoData,
  handleLegacyDemoFile,
  handleLegacyDemoList,
});

module.exports = function registerTools(app) {
  registerToolsMetadata(app);
  registerToolsInternal(app);
  registerToolsPlatform(app);
};
