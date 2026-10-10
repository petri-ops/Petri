// ============================================================
// Backend process manager — central registry for the backend
// child process (petri-server；BLOCK-30 P1 起 py-server 已摘除，
// BLOCK-51 P3 起 plumber 空壳已清理——R 为 tools-executor 单轨)
// plus its log streams and supervisor.
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 4.
// Original location: src/main.js ~lines 96-139 (log streams),
// ~lines 320-428 (startGateway / startRServer；gateway 部分随 BLOCK-30 P2 摘除), ~lines 430-613
// (startPyServer / stopPyServer +
//  idle timer helpers + rServerSupervisor).
//
// Design rationale:
//   - The backend procs are module-level `let ChildProc`
//     variables in main.js that are shared across:
//       * startup functions (startRServer / ...)
//       * setupRuntimeIpc / setupTerminalIpc / setupDiagnosticIpc
//         (IPC handlers that read procs for status snapshots)
//       * before-quit / app lifecycle hooks
//   - Centralizing them in backend-proc-manager.js means IPC
//     modules import them via `getProcs()` or accept them as
//     parameters from main.js's setup* call sites.
//   - The log stream registry (_logStreams) is similarly shared
//     between startup hooks and setupDiagnosticIpc, so it lives
//     here too (worker report recommendation §5.3 option B).
//
// Exports:
//   - module-level start/stop functions (consumed by main.js
//     at boot, and by tests)
//   - getProcs() — returns a snapshot { rServerProc }
//     for IPC snapshot handlers
//   - getLogDir() / flushLogs() / readLogTail() — for
//     setupDiagnosticIpc / setupTerminalIpc
//
// The backend proc remains a mutable `let` variable here so
// the .on("exit") handlers can null it out as before. IPC
// handlers that need a snapshot call getProcs() at handler
// invocation time.
// ============================================================

const fs = require("fs");
const path = require("path");
const { resolveLocalDirName } = require("./brand");
const { spawn } = require("child_process");
const { app } = require("electron");
const { createOwnedBackendSupervisor } = require("../owned-backend-supervisor");

// ── Path resolution (mirror of main.js:147-169) ─────────────────
const IS_DEV = !app.isPackaged;
const PROJECT_ROOT = IS_DEV ? path.join(__dirname, "..", "..") : process.resourcesPath;

function resolveCoreRoot() {
  if (IS_DEV) {
    return path.join(PROJECT_ROOT, "core");
  }
  return path.join(process.resourcesPath, "core");
}

function resolveCore(...parts) {
  return path.join(resolveCoreRoot(), ...parts);
}

// ── Node bin resolution (mirror of main.js:178-220) ────────────
// Used by all 4 spawn() calls below.
const { getNodeLocator } = require("../platform-compat");

function resolveNodeBinLocal() {
  if (!IS_DEV) {
    if (process.platform === "darwin") {
      const helperName = `${path.basename(process.execPath)} Helper`;
      const helperBin = path.join(
        path.dirname(process.execPath),
        "..",
        "Frameworks",
        `${helperName}.app`,
        "Contents",
        "MacOS",
        helperName,
      );
      if (fs.existsSync(helperBin)) return helperBin;
    }
    return process.execPath;
  }
  try {
    const { execFileSync } = require("child_process");
    const locator = getNodeLocator(process.platform);
    const bin = execFileSync(locator, ["node"], {
      encoding: "utf-8",
      timeout: 3000,
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (bin && fs.existsSync(bin)) return bin;
  } catch {
    /* fallback */
  }
  return "node";
}

const NODE_BIN = resolveNodeBinLocal();

// ── Log streams registry (mirror of main.js:94-139) ───────────
const _logStreams = {};

function getLogDir() {
  const dir = process.env.PETRI_LOCAL_DATA_DIR
    ? path.join(process.env.PETRI_LOCAL_DATA_DIR, "logs")
    : path.join(app.getPath("documents"), resolveLocalDirName(app), "logs");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

function _createLogStream(name) {
  const dir = getLogDir();
  const file = path.join(dir, `${name}.log`);
  const stream = fs.createWriteStream(file, { flags: "a" });
  _logStreams[name] = stream;
  stream.write(`\n=== ${new Date().toISOString()} — session start ===\n`);
  return stream;
}

function _writeLog(name, text) {
  const stream = _logStreams[name];
  if (stream) {
    try {
      stream.write(text + "\n");
    } catch {}
  }
}

function flushLogs() {
  for (const s of Object.values(_logStreams)) {
    try {
      s.write("");
    } catch {}
  }
}

function readLogTail(filePath, maxLines = 120) {
  try {
    if (!fs.existsSync(filePath)) return "";
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    return lines
      .slice(Math.max(0, lines.length - maxLines))
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

// ── Backend procs (1 child process; BLOCK-30 P1 removed py-server,
//    BLOCK-51 P3 removed plumber shell) ──
// Mutable let variables — the .on("exit") handlers null them
// out, same behavior as before.
let rServerProc = null;

function getProcs() {
  return { rServerProc };
}

// BLOCK-100 P1 — 测试实例 attach 模式：后端进程由主 dev 栈持有，本实例不 spawn。
// 登记 attached 桩（backend-health.isProcAlive = !!proc && !proc.killed → 视为
// 存活），使 backend:status 走真实 HTTP health 探测，而非因缺子进程误报
// 「本地分析服务未运行，正在重启…」。桩无 exit 事件 → 不会触发 supervisor 重启。
function markBackendAttached(port) {
  rServerProc = { attached: true, killed: false, exitCode: null };
  console.log(`[desktop] test instance: backend attached at :${port} (no local spawn)`);
}

// ── startRServer (with supervisor) ─────────────────────────────
const rServerSupervisor = createOwnedBackendSupervisor({
  name: "petri-server",
  spawnProcess: () => {
    const rServerPath = resolveCore("petri-server", "server.js");
    const child = spawn(NODE_BIN, [rServerPath], {
      // BLOCK-16 PHASE 3: 把 Electron userData 路径显式注入给 petri-server subprocess，
      // 让 system-prompt 能读 working-tree-review/rejects/（30 天 TTL 拒绝清单）。
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PETRI_USER_DATA_DIR: app.getPath("userData"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    _createLogStream("petri-server");
    child.stdout.on("data", (d) => {
      const text = d.toString().trim();
      if (text) {
        console.log(`[petri-server] ${text}`);
        _writeLog("petri-server", `[petri-server] ${text}`);
      }
    });
    child.stderr.on("data", (d) => {
      const text = d.toString().trim();
      if (text) {
        console.error(`[petri-server] ${text}`);
        _writeLog("petri-server", `[petri-server:ERR] ${text}`);
      }
    });
    return child;
  },
  onProcessChange: (child) => {
    rServerProc = child;
  },
  log: console.log,
  warn: console.warn,
});

function startRServer(reason = "boot") {
  // BLOCK-66 P1 — R 硬门摘除：petri-server 是纯 Node 进程，不依赖 R；
  // R 缺失照常启动，R 类插件执行时由 tools-executor runtime preflight
  // 诚实失败 + 商店指引（详见 docs/block-66-runtime-decouple-plan.md）。
  // 函数名 startRServer 为历史遗留（plumber/py-server 时代），保留以减 diff。
  if (!process.env.PETRI_R_HOME) {
    console.log(
      "[desktop] petri-server starting without R runtime — R analysis features unavailable until installed",
    );
  }

  const rServerPath = resolveCore("petri-server", "server.js");
  if (!fs.existsSync(rServerPath)) {
    console.error("[desktop] petri-server not found:", rServerPath);
    return { ok: false, error: "petri-server script not found" };
  }

  const result = rServerSupervisor.start(reason);

  if (result.ok && !result.alreadyRunning) {
    console.log(
      `[desktop] petri-server spawned (pid=${result.pid}) on :${process.env.R_SERVER_PORT} — reason=${reason}`,
    );
  }
  return result;
}

// ── startPyServer / stopPyServer ───────────────────────────────
// BLOCK-30 P1: removed with the py-server HTTP service. Python tool
// execution runs inside petri-server via the shared-backend executor
// registry (spawn 内嵌 python)，无需独立 Python 后端进程。
//
// ── startPlumber / stopPlumber ─────────────────────────────────
// BLOCK-51 P3: removed with the plumber shell. replot.R 从未存在于
// git 历史，plumber 进程从未启动；R 实际单轨 = tools-executor 每任务
// 独立 Rscript 子进程。交互式重绘已由 Result Studio 版本化编辑取代。

module.exports = {
  // procs / logs
  getProcs,
  markBackendAttached,
  getLogDir,
  flushLogs,
  readLogTail,
  // lifecycle
  startRServer,
  // supervisor (for before-quit shutdown in main.js)
  rServerSupervisor,
};
