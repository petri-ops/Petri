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
const os = require('os');
const path = require('path');

// Scientific analysis runs through the tools routes and tool_job persistence.
const cacheManager = require('./cache-manager');
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

// r-server 是独立子进程，不共享 Electron 主进程的插件 Map。使用与 MCP
// 相同的 built-in / installed / development 三源发现，确保 HTTP 执行路径
// 也能拿到 requiresBundle 等完整插件契约。
try {
  const developmentDirs = String(process.env.BIOF3_DEVELOPMENT_PLUGIN_DIRS || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  require('./plugin-loader').loadPluginsFromSources({
    builtInDir:
      process.env.BIOF3_BUILT_IN_PLUGINS_DIR ||
      path.resolve(__dirname, '..', '..', 'resources', 'built-in-plugins'),
    installedDir:
      process.env.BIOF3_PLUGINS_DIR ||
      path.join(os.homedir(), 'Documents', 'BioF3-Local', 'plugins'),
    developmentDirs,
  });
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

// A desktop server restart interrupts any in-process analysis still marked active.
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

const PORT = process.env.R_SERVER_PORT || 3003;
const TEMP_DIR = config.tempDir || '/tmp/biof3-tmp';

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Desktop middleware bootstrap (CORS, JSON body, request id, local identity,
// module permissions).
const { setupBootstrap } = require('./bootstrap');
setupBootstrap(app, { db });

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

// ============================================================
// ============================================================
// AI Chat API (streaming) — helpers + globalThis bridge extracted to ai-bridge.js
// ============================================================
const { setupAiBridge } = require('./ai-bridge');
setupAiBridge({ tempDir: TEMP_DIR });

// buildSystemPrompt — moved to helpers/system-prompt.js

// /api/ai/chat — moved to routes/ai-chat.js

// ── Event-loop block monitor ───────────────────────────────────────────────
// Detect when synchronous work stalls the single-threaded event loop. The timer
// fires after the block clears and is unref'd so it never keeps the process alive.
(function startEventLoopMonitor() {
  const TICK_MS = 1000;
  const BLOCK_THRESHOLD_MS = 2000; // report blocks longer than this
  let last = Date.now();
  const t = setInterval(() => {
    const now = Date.now();
    const lag = now - last - TICK_MS;
    if (lag > BLOCK_THRESHOLD_MS) {
      console.warn(
        `[event-loop] ⚠ blocked ~${lag}ms (recovered at ${new Date(now).toISOString()})`
      );
    }
    last = now;
  }, TICK_MS);
  if (t.unref) t.unref();
})();

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🧬 BioF3 R Server running on port ${PORT}`);
  console.log(`   POST http://localhost:${PORT}/api/run`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
});
