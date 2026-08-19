// ============================================================
// Backend process manager — central registry for the 4 backend
// child processes (gateway / r-server / py-server / plumber)
// plus their log streams and idle timers.
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 4.
// Original location: src/main.js ~lines 96-139 (log streams),
// ~lines 320-428 (startGateway / startRServer), ~lines 430-613
// (startPyServer / stopPyServer / startPlumber / stopPlumber +
//  idle timer helpers + rServerSupervisor).
//
// Design rationale:
//   - The 4 backend procs are module-level `let ChildProc`
//     variables in main.js that are shared across:
//       * startup functions (startRServer / startGateway / ...)
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
//     at boot, by setupBackendLifecycleIpc via parameter
//     injection, and by tests)
//   - getProcs() — returns a snapshot { gatewayProc, rServerProc,
//     pyServerProc, plumberProc } for IPC snapshot handlers
//   - getLogDir() / flushLogs() / readLogTail() — for
//     setupDiagnosticIpc / setupTerminalIpc
//
// The 4 backend procs remain mutable `let` variables here so
// the .on("exit") handlers can null them out as before. IPC
// handlers that need a snapshot call getProcs() at handler
// invocation time.
// ============================================================

const fs = require("fs");
const path = require("path");
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
  const dir = process.env.BIOF3_LOCAL_DATA_DIR
    ? path.join(process.env.BIOF3_LOCAL_DATA_DIR, "logs")
    : path.join(app.getPath("documents"), "BioF3-Local", "logs");
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

// ── Backend procs (4 child processes) ─────────────────────────
// Mutable let variables — the .on("exit") handlers null them
// out, same behavior as before.
let gatewayProc = null;
let rServerProc = null;
let pyServerProc = null;
let plumberProc = null;

function getProcs() {
  return { gatewayProc, rServerProc, pyServerProc, plumberProc };
}

// ── Plumber idle timer (5min auto-stop) ────────────────────────
let plumberIdleTimer = null;
const PLUMBER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function _clearPlumberIdleTimer() {
  if (plumberIdleTimer) {
    clearTimeout(plumberIdleTimer);
    plumberIdleTimer = null;
  }
}

function _resetPlumberIdleTimer() {
  _clearPlumberIdleTimer();
  plumberIdleTimer = setTimeout(() => {
    console.log("[desktop] plumber idle timeout (5min), stopping");
    stopPlumber("idle-timeout");
  }, PLUMBER_IDLE_TIMEOUT_MS);
}

// ── startGateway ───────────────────────────────────────────────
function startGateway(reason = "boot") {
  const gatewayPath = resolveCore("gateway", "server.js");
  if (!fs.existsSync(gatewayPath)) {
    console.warn("[desktop] gateway not found, skipping:", gatewayPath);
    return { ok: false, error: "gateway script not found" };
  }

  try {
    gatewayProc = spawn(NODE_BIN, [gatewayPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    console.error("[desktop] gateway spawn failed:", e.message);
    gatewayProc = null;
    return { ok: false, error: e.message };
  }

  _createLogStream("gateway");
  gatewayProc.stdout.on("data", (d) => {
    const text = d.toString().trim();
    if (text) {
      console.log(`[gateway] ${text}`);
      _writeLog("gateway", `[gateway] ${text}`);
    }
  });
  gatewayProc.stderr.on("data", (d) => {
    const text = d.toString().trim();
    if (text) {
      console.error(`[gateway] ${text}`);
      _writeLog("gateway", `[gateway:ERR] ${text}`);
    }
  });
  gatewayProc.on("exit", (code) => {
    console.log(`[desktop] gateway exited: ${code}`);
    gatewayProc = null;
  });

  console.log(
    `[desktop] gateway spawned (pid=${gatewayProc.pid}) on :${process.env.GATEWAY_PORT} — reason=${reason}`,
  );
  return { ok: true, pid: gatewayProc.pid };
}

// ── startRServer (with supervisor) ─────────────────────────────
const rServerSupervisor = createOwnedBackendSupervisor({
  name: "r-server",
  spawnProcess: () => {
    const rServerPath = resolveCore("r-server", "server.js");
    const child = spawn(NODE_BIN, [rServerPath], {
      // BLOCK-16 PHASE 3: 把 Electron userData 路径显式注入给 r-server subprocess，
      // 让 system-prompt 能读 working-tree-review/rejects/（30 天 TTL 拒绝清单）。
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        BIOF3_USER_DATA_DIR: app.getPath("userData"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    _createLogStream("r-server");
    child.stdout.on("data", (d) => {
      const text = d.toString().trim();
      if (text) {
        console.log(`[r-server] ${text}`);
        _writeLog("r-server", `[r-server] ${text}`);
      }
    });
    child.stderr.on("data", (d) => {
      const text = d.toString().trim();
      if (text) {
        console.error(`[r-server] ${text}`);
        _writeLog("r-server", `[r-server:ERR] ${text}`);
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
  if (!process.env.BIOF3_R_HOME || !fs.existsSync(process.env.BIOF3_R_HOME)) {
    console.warn("[desktop] r-server skipped — R runtime not installed");
    return { ok: false, error: "R runtime not installed" };
  }

  const rServerPath = resolveCore("r-server", "server.js");
  if (!fs.existsSync(rServerPath)) {
    console.error("[desktop] r-server not found:", rServerPath);
    return { ok: false, error: "r-server script not found" };
  }

  const result = rServerSupervisor.start(reason);

  if (result.ok && !result.alreadyRunning) {
    console.log(
      `[desktop] r-server spawned (pid=${result.pid}) on :${process.env.R_SERVER_PORT} — reason=${reason}`,
    );
  }
  return result;
}

// ── startPyServer / stopPyServer ───────────────────────────────
function startPyServer(reason = "ipc") {
  if (pyServerProc && !pyServerProc.killed) {
    return { ok: true, alreadyRunning: true, pid: pyServerProc.pid };
  }

  if (!process.env.BIOF3_PY_HOME || !fs.existsSync(process.env.BIOF3_PY_HOME)) {
    console.warn("[desktop] py-server skipped — Python runtime not installed");
    return { ok: false, error: "Python runtime not installed" };
  }

  const pyServerPath = resolveCore("py-server", "server.js");
  if (!fs.existsSync(pyServerPath)) {
    console.error("[desktop] py-server not found:", pyServerPath);
    return { ok: false, error: "py-server script not found" };
  }

  try {
    pyServerProc = spawn(NODE_BIN, [pyServerPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    console.error("[desktop] py-server spawn failed:", e.message);
    pyServerProc = null;
    return { ok: false, error: e.message };
  }

  _createLogStream("py-server");
  pyServerProc.stdout.on("data", (d) => {
    const text = d.toString().trim();
    if (text) {
      console.log(`[py-server] ${text}`);
      _writeLog("py-server", `[py-server] ${text}`);
    }
  });
  pyServerProc.stderr.on("data", (d) => {
    const text = d.toString().trim();
    if (text) {
      console.error(`[py-server] ${text}`);
      _writeLog("py-server", `[py-server:ERR] ${text}`);
    }
  });
  pyServerProc.on("exit", (code) => {
    console.log(`[desktop] py-server exited: ${code}`);
    pyServerProc = null;
  });

  console.log(
    `[desktop] py-server spawned (pid=${pyServerProc.pid}) on :${process.env.PY_SERVER_PORT} — reason=${reason}`,
  );
  return { ok: true, pid: pyServerProc.pid };
}

function stopPyServer(reason = "ipc") {
  if (!pyServerProc || pyServerProc.killed) {
    pyServerProc = null;
    return { ok: true, wasRunning: false };
  }
  try {
    pyServerProc.kill();
    console.log(`[desktop] py-server stopped — reason=${reason}`);
  } catch (e) {
    console.error("[desktop] py-server stop failed:", e.message);
  }
  return { ok: true, wasRunning: true };
}

// ── startPlumber / stopPlumber ─────────────────────────────────
const { getRuntimeBinName } = require("../platform-compat");

function startPlumber(reason = "ipc") {
  if (plumberProc && !plumberProc.killed) {
    _resetPlumberIdleTimer();
    return { ok: true, alreadyRunning: true, pid: plumberProc.pid };
  }

  if (!process.env.BIOF3_R_HOME || !fs.existsSync(process.env.BIOF3_R_HOME)) {
    console.warn("[desktop] plumber skipped — R runtime not installed");
    return { ok: false, error: "R runtime not installed" };
  }

  const rBin = path.join(
    process.env.BIOF3_R_HOME,
    "bin",
    getRuntimeBinName("r", process.platform),
  );
  if (!fs.existsSync(rBin)) {
    console.warn("[desktop] Rscript not found, plumber skipped:", rBin);
    return { ok: false, error: "Rscript not found" };
  }

  const plumberScript = resolveCore("r-server", "replot.R");
  if (!fs.existsSync(plumberScript)) {
    console.warn("[desktop] plumber script not found, replot disabled");
    return { ok: false, error: "plumber script not found" };
  }

  try {
    plumberProc = spawn(rBin, [plumberScript, "--port", process.env.PLUMBER_PORT], {
      env: { ...process.env, R_HOME: process.env.BIOF3_R_HOME },
      stdio: "pipe",
    });
  } catch (e) {
    console.error("[desktop] plumber spawn failed:", e.message);
    plumberProc = null;
    return { ok: false, error: e.message };
  }

  plumberProc.stdout.on("data", (d) =>
    console.log("[plumber]", d.toString().trim()),
  );
  plumberProc.stderr.on("data", (d) =>
    console.error("[plumber]", d.toString().trim()),
  );
  plumberProc.on("exit", (code) => {
    console.log(`[desktop] plumber exited: ${code}`);
    plumberProc = null;
    _clearPlumberIdleTimer();
  });

  _resetPlumberIdleTimer();
  console.log(`[desktop] plumber started on :${process.env.PLUMBER_PORT} — reason=${reason}`);
  return { ok: true, pid: plumberProc.pid };
}

function stopPlumber(reason = "ipc") {
  _clearPlumberIdleTimer();
  if (!plumberProc || plumberProc.killed) {
    plumberProc = null;
    return { ok: true, wasRunning: false };
  }
  try {
    plumberProc.kill();
    console.log(`[desktop] plumber stopped — reason=${reason}`);
  } catch (e) {
    console.error("[desktop] plumber stop failed:", e.message);
  }
  return { ok: true, wasRunning: true };
}

module.exports = {
  // procs / logs
  getProcs,
  getLogDir,
  flushLogs,
  readLogTail,
  // lifecycle
  startRServer,
  startGateway,
  startPyServer,
  stopPyServer,
  startPlumber,
  stopPlumber,
  // supervisor (for before-quit shutdown in main.js)
  rServerSupervisor,
};
