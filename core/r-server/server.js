/**
 * BioF3 R Execution Server
 *
 * A lightweight Express server that accepts R code via POST,
 * executes it in a child Rscript process, and returns stdout + plot images.
 *
 * Usage:
 *   cd r-server && npm install && npm start
 *
 * API:
 *   POST /api/run
 *   Body: { "code": "print(1+1)" }
 *   Response: { "status": "success", "stdout": "...", "images": ["data:image/png;base64,..."] }
 */

const express = require('express');

const fs = require('fs');
const OSS = require('ali-oss');

const taskQueue = require('./task-queue');
const { generateRScript } = require('./task-manager');
taskQueue.setScriptGenerator(generateRScript);
const cacheManager = require('./cache-manager');
const backupManager = require('./backup-manager');
const db = require('./db');
const config = require('./config');
const { logError } = require('./helpers/error-log');

// 桌面版：注册执行器 + 存储适配器（必须在路由之前）
try {
  require('../shared-backend/init').initSharedBackend();
} catch (e) {
  console.warn('[server] shared-backend init failed:', e.message);
}

// 断点1（分仓前置）：把 r-server 自己的 config + ai-usage 实现注入 shared-backend。
// 这样执行器/storage 读 config-helper.getConfig() 拿到真 config（不走 env fallback），
// llm-providers 调 aiUsageHelper.recordAiUsage() 能真正写库。
// 注意：require('../shared-backend') 走相对路径解析到 barrel（Step 1 建的 index.js）；
// 不能用 require('shared-backend')——package name 是 biof3-shared-backend，解析不到。
// 分仓后此处改成 require('@biof3/shared-backend')。
try {
  require('../shared-backend').configure({
    getConfig: () => require('./config'),
    recordAiUsage: require('./helpers/ai-usage').recordAiUsage,
  });
} catch (e) {
  console.warn('[server] shared-backend configure failed:', e.message);
}

// 桌面版：从磁盘加载已装插件（r-server 是独立子进程，不共享 Electron 主进程
// 的 globalThis._biof3Plugins，必须自己扫 ~/Documents/BioF3-Local/plugins/）
try {
  require('./plugin-loader').loadPluginsFromDisk();
} catch (e) {
  console.warn('[server] plugin-loader init failed:', e.message);
}

const app = express();

// Catch unhandled errors
process.on('unhandledRejection', (reason, _promise) => {
  logError('unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  logError('uncaughtException', err);
  // Don't exit — let pm2 decide
});

// === Legacy all-in-one recovery ===
// In platform/api/worker split mode, restarting an HTTP node does not mean a
// compute task died. Only the old single-process mode may mark analyses failed
// on server startup.
if (config.runMode === 'all') {
  try {
    const dbMod = require('./db');
    const stalled = dbMod.listStalledAnalyses();
    if (stalled.length > 0) {
      console.log('[Recovery] Marking ' + stalled.length + ' stalled tasks as failed');
      const errMsg = '服务重启时此任务被中断，请重新提交';
      const finishedAt = new Date().toISOString();
      for (const a of stalled) {
        dbMod.updateAnalysis(a.id, { status: 'failed', error: errMsg, finishedAt });
      }
    }
  } catch (e) {
    console.error('[Recovery] Failed:', e.message);
  }
}

const PORT = process.env.R_SERVER_PORT || 3003;
const TEMP_DIR = config.execMode === 'local'
  ? (config.tempDir || '/tmp/biof3-tmp')
  : '/mnt/storage_16tb/omichub/biof3-tmp'; // Shared with Docker container

// OSS client for uploading results（桌面版 storageMode='local' 时跳过）
let ossClient = null;
if (config.storageMode !== 'local') {
  ossClient = new OSS({
    region: 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_AK,
    accessKeySecret: process.env.OSS_SK,
    bucket: 'biof3-uploads',
  });
}

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Simple API token authentication
const API_TOKEN = process.env.BIOF3_API_TOKEN || 'biof3-figcode-2026';
const INTERNAL_TOKEN = process.env.BIOF3_INTERNAL_TOKEN || '';

// Shared middleware bootstrap (CORS, JSON body, request-id, auth routes,
// combinedAuth, module gate). Extracted to r-server/bootstrap.js so
// platform-server can mount the same stack without duplicating inline defs.
const { setupBootstrap } = require('./bootstrap');
const { _rateLimiters } = setupBootstrap(app, {
  db,
  apiToken: API_TOKEN,
  internalToken: INTERNAL_TOKEN,
});

// MODULES_PRECEDENCE_v1 — modular routes register here, BEFORE all legacy
// endpoints below. Express uses first-match-wins, so new versions automatically
// supersede old code in routes/ without needing to comment out the legacy.
try {
  require('./routes')(app);
} catch (e) {
  console.warn('[modules] route registry failed to load:', e && e.message);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start cache cleanup scheduler (runs daily at 03:00)
try {
  cacheManager.startScheduler();
} catch (e) {
  console.error('cache scheduler error:', e.message);
}
try {
  backupManager.startScheduler();
} catch (e) {
  console.error('backup scheduler error:', e.message);
}

// ============================================================
// ============================================================
// AI Chat API (streaming) — helpers + globalThis bridge extracted to ai-bridge.js
// ============================================================
const { setupAiBridge } = require('./ai-bridge');
setupAiBridge({ tempDir: TEMP_DIR, ossClient });

// buildSystemPrompt — moved to helpers/system-prompt.js

// /api/ai/chat — moved to routes/ai-chat.js

if (config.runMode === 'worker') {
  console.log(
    '[BioF3] BIOF3_RUN_MODE=worker — use node worker.js for compute; server.js not started.'
  );
  process.exit(0);
}

// ── Event-loop block monitor ───────────────────────────────────────────────
// Detects when the single-threaded event loop is stalled (e.g. a synchronous
// deasync→PG bridge blocking on a stale PostgreSQL socket). Fires AFTER the block
// clears, logging how long it was wedged + wall-clock time, so freezes that
// cause 504s become visible in pm2 logs instead of silent hangs. .unref() so
// it never keeps the process alive on its own.
(function startEventLoopMonitor() {
  const TICK_MS = 1000;
  const BLOCK_THRESHOLD_MS = 2000; // report blocks longer than this
  let last = Date.now();
  const t = setInterval(() => {
    const now = Date.now();
    const lag = now - last - TICK_MS;
    if (lag > BLOCK_THRESHOLD_MS) {
      console.warn(
        `[event-loop] ⚠ blocked ~${lag}ms (recovered at ${new Date(now).toISOString()}, runMode=${config.runMode}) — check for synchronous deasync/PG stalls`
      );
    }
    last = now;
  }, TICK_MS);
  if (t.unref) t.unref();
})();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧬 BioF3 R Server running on port ${PORT} (runMode=${config.runMode})`);
  console.log(`   POST http://localhost:${PORT}/api/run`);
  console.log(`   POST http://localhost:${PORT}/api/task`);
  console.log(`   GET  http://localhost:${PORT}/api/task/:id`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  if (config.runMode === 'platform') {
    console.log('   Platform control plane — R/Python on Dell compute nodes');
  } else if (config.runMode === 'all') {
    console.log('   Local worker: draining task queue on this node');
  } else if (config.runMode === 'api') {
    console.log('   Tasks enqueue only — start worker.js on compute node(s)');
  }
});
