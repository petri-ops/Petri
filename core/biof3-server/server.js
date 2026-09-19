/**
 * BioF3 R Execution Server
 *
 * A lightweight Express server that accepts R code via POST,
 * executes it in a child Rscript process, and returns stdout + plot images.
 *
 * Usage:
 *   cd biof3-server && npm install && npm start
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
// BLOCK-10 retention + lifecycle 闭包期望 better-sqlite3 实例（.prepare / .close），
// 而 db.js 默认导出是 wrapper 对象（{...exports, db, getDatabase}）。两者解构出来
// 不一致会让 retention-purge 全部失败 + lifecycle.db.close silently no-op。
// 统一通过 destructure 取底层 better-sqlite3 实例。
const { db } = require('./db');
const config = require('./config');
const { logError } = require('./helpers/error-log');

// A-009: pull the biof3-server port fallback from env-coordinator instead of
// duplicating the literal default here. setupDesktopEnv() in the Electron
// main process always overwrites R_SERVER_PORT before this module is
// reached, so the canonical default (3001) is only consulted when biof3-server
// is launched as a standalone child process.
const { getBackendPort } = require('../../src/main/env-coordinator');

// 桌面版：注册执行器 + 存储适配器（必须在路由之前）
try {
  require('../shared-backend/init').initSharedBackend();
} catch (e) {
  console.error('[server] shared-backend init FAILED — storage/executor adapters unavailable (BLOCK-102 P1):', e.message);
}

// 断点1（分仓前置）：把 biof3-server 自己的 config + ai-usage 实现注入 shared-backend。
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
  console.error('[server] shared-backend configure FAILED — ai-usage/config injection broken (BLOCK-102 P1):', e.message);
}

// biof3-server 是独立子进程，不共享 Electron 主进程的插件 Map。使用与 MCP
// 相同的 built-in / installed / development 三源发现，确保 HTTP 执行路径
// 也能拿到 requiresBundle 等完整插件契约。
try {
  const developmentDirs = String(process.env.BIOF3_DEVELOPMENT_PLUGIN_DIRS || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  const packSourcesFromPacks = [];
  // BLOCK-84：已装领域包接线——packs 记录的每个包追加为 installed 插件源 + 工具注册文件（零包=零行为 additive）。
  try {
    const packRegistryModule = require(path.join(__dirname, '..', 'shared-backend', 'pack-registry.js'));
    const dataDir = process.env.BIOF3_LOCAL_DATA_DIR;
    if (dataDir) {
      const toolRegistryModule = require('./tool-registry');
      for (const installedPack of packRegistryModule.readInstalledPacks(dataDir)) {
        const packPluginsDir = path.join(installedPack.packRoot, 'plugins');
        if (fs.existsSync(path.join(packPluginsDir, 'installed.json'))) {
          console.log('[pack-registry] wiring installed pack: ' + installedPack.packId);
          packSourcesFromPacks.push({ type: 'installed', root: packPluginsDir, required: false });
        }
        toolRegistryModule.registerDomainToolsFile(path.join(installedPack.packRoot, 'registry', 'tool-registry.json'));
      }
    }
  } catch (e) {
    console.warn('[pack-registry] pack wiring failed:', e.message);
  }

  // BLOCK-84：三源 + 已装领域包源 = 单次多源装载（避免多次调用互相清除）
  require('./plugin-loader').loadFromSourcesArray([
    { type: 'builtin', root:
      process.env.BIOF3_BUILT_IN_PLUGINS_DIR ||
      path.resolve(__dirname, '..', '..', 'resources', 'built-in-plugins') },
    { type: 'installed', root:
      process.env.BIOF3_PLUGINS_DIR ||
      path.join(os.homedir(), 'Documents', 'BioF3-Local', 'plugins') },
    ...developmentDirs.map((root) => ({ type: 'development', root })),
    ...packSourcesFromPacks,
  ]);
} catch (e) {
  console.error('[server] plugin-loader init FAILED — plugins unavailable (BLOCK-102 P1):', e.message);
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
  const stalledToolJobs = typeof dbMod.markStalledToolJobsRecovery === 'function'
    ? dbMod.markStalledToolJobsRecovery()
    : [];
  if (stalled.length > 0) {
    console.log('[Recovery] Marking ' + stalled.length + ' stalled tasks as failed');
    const errMsg = '服务重启时此任务被中断，请重新提交';
    const finishedAt = new Date().toISOString();
    for (const a of stalled) {
      dbMod.updateAnalysis(a.id, { status: 'failed', error: errMsg, finishedAt });
    }
  }
  if (stalledToolJobs.length > 0) {
    console.log('[Recovery] Preserved ' + stalledToolJobs.length + ' interrupted tool jobs as recovery_required');
  }
  // HLE-C5: Recover running LoopRuns from previous session
  try {
    const runningLoopRuns = dbMod.listRunningLoopRuns();
    if (runningLoopRuns.length > 0) {
      console.log('[Recovery] Found ' + runningLoopRuns.length + ' running LoopRun(s) from previous session');
      for (const run of runningLoopRuns) {
        // Update status to 'failed' with recovery_required since we can't safely resume mid-session
        // The LoopRun was interrupted by server restart — log it for manual review
        console.log('[Recovery] LoopRun ' + run.loopRunId + ' (project=' + run.projectId + ') marked as recovery_required');
        try {
          const statusJson = run.loopStatusJson ? JSON.parse(run.loopStatusJson) : {};
          dbMod.updateLoopRunStatus(run.loopRunId, {
            loopStatus: 'failed',
            hash: run.loopStatusHash,
            json: JSON.stringify({ ...statusJson, recovery_required: true, recovery_reason: 'server_restart_during_active_loop' }),
            updatedAt: new Date().toISOString(),
          });
          console.log('[Recovery] LoopRun ' + run.loopRunId + ' → failed (recovery_required=true)');
        } catch (err) {
          console.error('[Recovery] Failed to update LoopRun ' + run.loopRunId + ':', err.message);
        }
      }
    }
  } catch (e) {
    console.error('[Recovery] LoopRun recovery failed:', e.message);
  }
} catch (e) {
  console.error('[Recovery] Failed:', e.message);
}

// A-009: single source of truth via env-coordinator.getBackendPort('r').
// Behaviour-equivalent: previously this site hardcoded a fallback default
// (3003); now reads env-coordinator's canonical helper, which returns 3001
// by default (the same value preload.js + backend-health.js already used as
// fallback). Electron's main process always sets process.env.R_SERVER_PORT
// before this module is reached, so the default is only hit in standalone
// mode.
const PORT = getBackendPort('r');
const TEMP_DIR = config.tempDir || '/tmp/biof3-tmp';

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Desktop middleware bootstrap (CORS, JSON body, request id, local identity,
// module permissions).
const { setupBootstrap } = require('./bootstrap');
setupBootstrap(app, { db });

// ============================================================
// Backend exit lifecycle (E-017 + PR-006 closeout for biof3-server side).
//
// biof3-server is a long-running child process spawned by Electron's
// backend-proc-manager. When the host sends SIGINT / SIGTERM / SIGHUP, or
// Node fires beforeExit / exit, we must:
//   1. close the better-sqlite3 connection (releases the WAL handle so the
//      file can be checkpointed cleanly by the next process),
//   2. flush in-flight writes (best-effort — better-sqlite3 is synchronous
//      so any pending transaction has already committed),
//   3. remove our own listeners so a second signal cannot re-enter the
//      teardown path and recurse.
//
// This is deliberately scoped to biof3-server only. Electron's main.js and the
// backend-proc-manager have their own lifecycle hooks; we do not touch them.
// ============================================================
let backendExitLifecycleInstalled = false;
function installBackendExitLifecycle({ db, log = console.log, logWarn = console.warn } = {}) {
  if (backendExitLifecycleInstalled) return;
  backendExitLifecycleInstalled = true;

  const teardown = (signal) => {
    const handler = () => {
      try {
        if (db && typeof db.close === 'function') {
          try {
            db.close();
            log(`[lifecycle] db closed on ${signal}`);
          } catch (e) {
            logWarn(`[lifecycle] db.close failed on ${signal}: ${e && e.message ? e.message : e}`);
          }
        }
      } finally {
        // Remove this very listener so a re-entrant signal does not loop.
        try {
          process.removeListener(signal, handler);
        } catch (e) {
          logWarn(`[lifecycle] removeListener failed on ${signal}: ${e && e.message ? e.message : e}`);
        }
      }
    };
    return handler;
  };

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    try {
      const handler = teardown(signal);
      process.on(signal, handler);
    } catch (e) {
      // Some signals are not listenable on every platform; ignore silently.
      logWarn(`[lifecycle] cannot install ${signal}: ${e && e.message ? e.message : e}`);
    }
  }

  // beforeExit / exit run synchronously after Node decides to leave. close
  // the db if it is still open. Note: 'exit' cannot await, so we only do
  // the synchronous db.close().
  const beforeExitHandler = () => {
    try {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch {}
      }
    } finally {
      try { process.removeListener('beforeExit', beforeExitHandler); } catch {}
    }
  };
  const exitHandler = () => {
    try {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch {}
      }
    } finally {
      try { process.removeListener('exit', exitHandler); } catch {}
    }
  };
  process.on('beforeExit', beforeExitHandler);
  process.on('exit', exitHandler);
}

installBackendExitLifecycle({ db });

// ============================================================
// Retention sweeper (PR-001 closeout). Same scheduling shape as
// cacheManager (recursive setTimeout, unref'd). Failures are logged via
// console.warn — never swallowed — and re-tried on the next tick.
// ============================================================
try {
  const { scheduleRetentionSweep } = require('./jobs/retention-sweeper');
  scheduleRetentionSweep({ db });
} catch (e) {
  console.warn('[retention] scheduler not started:', e && e.message ? e.message : e);
}

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
  const perfProbe = require('./helpers/perf-probe');
  perfProbe.enableProbe();
  let last = Date.now();
  const t = setInterval(() => {
    const now = Date.now();
    const lag = now - last - TICK_MS;
    if (lag > 0) perfProbe.observeBlock(lag);
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

// ── BLOCK-70：手机远程同步 mobile-gateway（additive，默认关闭）────────────
// 配置/环境双开关（BIOF3_MOBILE_ENABLED / <dataDir>/mobile/gateway.json）。
// 关闭态零行为：不监听、不建实例；启动失败不影响主后端。
try {
  const { startMobileGateway } = require('./mobile-gateway');
  const { getTunnelManager } = require('./mobile-gateway/tunnel');
  const mobileDataDir = process.env.BIOF3_LOCAL_DATA_DIR;
  if (mobileDataDir) {
    const gatewayRoutes = (mobileApp) => {
      require('./routes/ai-conversations')(mobileApp);
      require('./routes/ai-agent')(mobileApp);
      require('./routes/tools')(mobileApp);
    };
    const gateway = startMobileGateway({ dataDir: mobileDataDir, mountRoutes: gatewayRoutes });
    if (!gateway.started) console.log('[mobile-gateway] disabled (default off)');
    // P3：反向隧道按持久化配置自恢复（enabled 才拉起；断线退避重连在管理器内）。
    const tunnelStatus = getTunnelManager(mobileDataDir).startIfEnabled();
    if (tunnelStatus.enabled) console.log(`[mobile-tunnel] ${tunnelStatus.state} → ${tunnelStatus.host}:${tunnelStatus.remotePort}`);
  } else {
    console.log('[mobile-gateway] skipped: BIOF3_LOCAL_DATA_DIR not set');
  }
} catch (e) {
  console.error('[mobile-gateway] FAILED TO START — mobile/federation doors down (BLOCK-102 P1):', e && e.message);
}
