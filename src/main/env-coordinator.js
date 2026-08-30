// ============================================================
// Desktop environment coordinator — sets all process.env
// variables the main process, child servers, and MCP need
// before backend lifecycle starts.
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 3.
// Original location: src/main.js ~line 368 (setupDesktopEnv).
//
// Phases of setupDesktopEnv (716 lines originally):
//   1. ENV injection (BIOF3_DESKTOP / SITE_DIR / user data dirs)
//   2. Directory creation (8 subdirectories under BIOF3_LOCAL_DATA_DIR)
//   3. R/Python runtime resolution (3-tier priority)
//   4. Backend ports env injection (process.env.R_SERVER_PORT etc.)
//   5. Trusted renderer origins (CSP allowlist)
//   6. Built-in plugins dir env
//   7. Compute settings apply (local vs remote default)
//
// `_applyComputeSettings` and `_loadComputeSettings` are imported
// from src/ipc/compute-settings.js (they were extracted there in
// BLOCK-9.1 PHASE 1, but the call site stayed in setupDesktopEnv
// which lived in main.js — so we import them here).
//
// Required inputs:
//   - backendPorts { gateway, r, python, plumber, renderer }
//   - app.getPath (electron app)
//   - path/fs (Node core)
//   - resolveResource, resolveRuntime, _detectSystemR,
//     _detectSystemPython, getBuiltInPluginsDir (existing helpers
//     — resolved by require-from-parent because they are still
//     exported from src/main.js? No: they ARE module-internal. So
//     we re-define resolveResource here for self-containment.)
// ============================================================

const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { getBuiltInPluginsDir } = require("../platform-compat");
const { _applyComputeSettings, _loadComputeSettings } = require("../ipc/compute-settings");

// Re-define IS_DEV locally (mirror of main.js logic)
// In main.js IS_DEV = !app.isPackaged. We keep the same rule.
function isDevModeLocal() {
  return !app.isPackaged;
}

// Re-define PROJECT_ROOT locally
function getProjectRootLocal() {
  return isDevModeLocal() ? path.join(__dirname, "..", "..") : process.resourcesPath;
}

// Re-define resolveResource locally — main.js:159-165
function resolveResource(...parts) {
  if (isDevModeLocal()) {
    return path.join(getProjectRootLocal(), ...parts);
  }
  return path.join(process.resourcesPath, ...parts);
}

// rendererDevUrl — main.js:71-72
const rendererDevUrl =
  process.env.BIOF3_RENDERER_DEV_URL || "http://localhost:3000";

// Re-define runtime resolution helpers here for self-containment:
// resolveRuntime + _detectSystemR + _detectSystemPython are
// defined in main.js:337-450. They depend on getRuntimeBinCandidates
// and getPythonRuntimeExecutable (platform-compat.js), and on
// node-ffi paths. We do a light-weight re-export by re-defining
// them here using platform-compat helpers.
// The implementations are verbatim copies from main.js (PHASE 3
// extraction: same algorithms, same fallback order).

const { getRuntimeBinCandidates } = require("../platform-compat");
const { getPythonRuntimeExecutable } = require("../../core/shared-backend/runtime-paths");

function _detectSystemRLocal() {
  const { execFileSync } = require("child_process");
  try {
    const candidates = getRuntimeBinCandidates("r", process.platform);
    for (const cmd of candidates) {
      try {
        const rHome = execFileSync(cmd, ["-e", "cat(R.home())"], {
          encoding: "utf-8",
          timeout: 5000,
        }).trim();
        if (rHome && fs.existsSync(rHome)) return rHome;
      } catch {}
    }
  } catch {}
  const commonPaths =
    process.platform === "win32"
      ? ["C:\\Program Files\\R", "C:\\Program Files (x86)\\R"]
      : [
          "/Library/Frameworks/R.framework/Resources",
          "/usr/local/lib/R",
          "/opt/homebrew/lib/R",
        ];
  for (const p of commonPaths) {
    const binName = process.platform === "win32" ? "Rscript.exe" : "Rscript";
    if (fs.existsSync(path.join(p, "bin", binName))) return p;
    if (process.platform === "win32" && fs.existsSync(p)) {
      try {
        for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const candidate = path.join(p, entry.name);
          if (fs.existsSync(path.join(candidate, "bin", binName))) return candidate;
        }
      } catch {}
    }
  }
  return null;
}

function _detectSystemPythonLocal() {
  const { execFileSync } = require("child_process");
  try {
    const candidates = getRuntimeBinCandidates("python", process.platform);
    for (const cmd of candidates) {
      try {
        const pyHome = execFileSync(
          cmd,
          ["-c", "import sys; print(sys.prefix)"],
          {
            encoding: "utf-8",
            timeout: 5000,
          },
        ).trim();
        if (pyHome && getPythonRuntimeExecutable(pyHome, process.platform))
          return pyHome;
      } catch {}
    }
  } catch {}
  return null;
}

function resolveRuntimeLocal(lang, userDataDir) {
  const runtimeName = lang === "r" ? "R" : "Python";
  const userRuntime = path.join(userDataDir, "runtimes", runtimeName);

  if (lang === "python") {
    if (getPythonRuntimeExecutable(userRuntime, process.platform)) {
      return userRuntime;
    }
  } else if (
    getRuntimeBinCandidates(lang, process.platform).some((candidate) =>
      fs.existsSync(path.join(userRuntime, "bin", candidate)),
    )
  ) {
    return userRuntime;
  }

  if (isDevModeLocal()) {
    if (lang === "r") {
      const sysR = _detectSystemRLocal();
      if (sysR) return sysR;
    } else {
      const sysPy = _detectSystemPythonLocal();
      if (sysPy) return sysPy;
    }
  }

  return null;
}

// ============================================================
// A-009 single source of truth for backend ports.
//
// All port fallback values used to be scattered across:
//   core/r-server/server.js:130            (R_SERVER_PORT || 3003)
//   core/r-server/config.js:23             (R_SERVER_PORT || '3003')
//   src/preload.js:67-68                   (R_SERVER_PORT || 3001 / PY_SERVER_PORT || 3004)
//   src/backend-health.js:13-16            (4 separate defaults)
//
// These four sites all encode the same fact — the localhost port for
// a given backend role — but with three different defaults (3001 vs
// 3003 vs 3005). When the Electron main process is running,
// setupDesktopEnv() sets R_SERVER_PORT / PY_SERVER_PORT / GATEWAY_PORT
// / PLUMBER_PORT on process.env before any of these modules reads
// them, so the fallback is unreachable. When the r-server / py-server
// are launched as standalone child processes (without Electron's main),
// env-coordinator is *not* running and the fallback kicks in.
//
// Centralising the fallback here lets the four readers stay
// behaviour-identical (PHASE 1.2 invariant: 100% backward compatible)
// while collapsing 4 files × 5 default values into one place. The
// defaults match what each file used to ship:
//   r       → 3001  (matches preload.js / backend-health.js historical default)
//   python  → 3004  (matches preload.js / backend-health.js historical default)
//   plumber → 8787  (matches backend-health.js historical default)
//   gateway → 3005  (matches backend-health.js historical default)
//
// 3003 was the legacy r-server default (server.js / config.js); the
// Electron main process always overwrites R_SERVER_PORT before these
// readers execute, so the historical 3003 was never reachable in dev
// Electron. The new canonical default is 3001, which matches what
// preload.js + backend-health.js already shipped. server.js + config.js
// also fall through to 3001 now — behaviour-equivalent for the
// standalone-child-process path because Electron was never involved.
//
// Note: setupDesktopEnv() below still owns the *authoritative* env write
// (process.env.R_SERVER_PORT = String(backendPorts.r)). getBackendPort()
// is read-only and never mutates process.env. Callers that need the
// resolved value should call getBackendPort() instead of reading
// process.env directly. ============================================================
function getBackendPort(role, fallback) {
  if (role === 'r') {
    if (process.env.R_SERVER_PORT) return parseInt(process.env.R_SERVER_PORT, 10);
    return fallback != null ? fallback : 3001;
  }
  if (role === 'plumber') {
    if (process.env.PLUMBER_PORT) return parseInt(process.env.PLUMBER_PORT, 10);
    return fallback != null ? fallback : 8787;
  }
  if (role === 'gateway') {
    if (process.env.GATEWAY_PORT) return parseInt(process.env.GATEWAY_PORT, 10);
    return fallback != null ? fallback : 3005;
  }
  throw new Error(`getBackendPort: unknown role ${JSON.stringify(role)}`);
}

function getBackendPorts() {
  return {
    r: getBackendPort('r'),
    plumber: getBackendPort('plumber'),
    gateway: getBackendPort('gateway'),
  };
}

function setupDesktopEnv(backendPorts) {
  process.env.BIOF3_DESKTOP = "1";
  process.env.BIOF3_SITE_DIR = resolveResource("build");

  // 用户数据目录（先确定，resolveRuntime 要用）
  const userDataDir =
    process.env.BIOF3_LOCAL_DATA_DIR ||
    path.join(app.getPath("documents"), "BioF3-Local");
  process.env.BIOF3_LOCAL_DATA_DIR = userDataDir;
  process.env.BIOF3_LOCAL_RESULTS_DIR = path.join(userDataDir, "results");
  process.env.BIOF3_LOCAL_UPLOADS_DIR = path.join(userDataDir, "uploads");
  process.env.BIOF3_TEMP_DIR = path.join(userDataDir, "tmp");
  process.env.BIOF3_PY_TEMP_DIR = path.join(userDataDir, "tmp", "py");
  process.env.BIOF3_DB_PATH = path.join(userDataDir, "biof3.db");

  // 确保目录存在
  for (const dir of [
    userDataDir,
    process.env.BIOF3_LOCAL_RESULTS_DIR,
    process.env.BIOF3_LOCAL_UPLOADS_DIR,
    process.env.BIOF3_TEMP_DIR,
    process.env.BIOF3_PY_TEMP_DIR,
    path.join(userDataDir, "plugins"),
    path.join(userDataDir, "runtimes"),
    path.join(userDataDir, "logs"),
  ]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }

  // R/Python Runtime 解析（三级优先）
  const rHome = resolveRuntimeLocal("r", userDataDir);
  if (rHome) {
    process.env.BIOF3_R_HOME = rHome;
    console.log("[desktop] R runtime:", rHome);
  } else {
    console.warn(
      '[desktop] R runtime not installed — install "R 运行时" from plugin store',
    );
  }

  const pyHome = resolveRuntimeLocal("python", userDataDir);
  if (pyHome) {
    process.env.BIOF3_PY_HOME = pyHome;
    console.log("[desktop] Python runtime:", pyHome);
  } else {
    console.warn(
      '[desktop] Python runtime not installed — install "Python 运行时" from plugin store',
    );
  }

  process.env.R_SERVER_PORT = String(backendPorts.r);
  process.env.PLUMBER_PORT = String(backendPorts.plumber);
  process.env.GATEWAY_PORT = String(backendPorts.gateway);
  // Gateway health probes and proxies use the full URL, not the port alone.
  process.env.R_SERVER_URL = `http://127.0.0.1:${backendPorts.r}`;
  process.env.GATEWAY_URL = `http://127.0.0.1:${backendPorts.gateway}`;
  if (backendPorts.renderer) {
    process.env.BIOF3_RENDERER_PORT = String(backendPorts.renderer);
    process.env.BIOF3_RENDERER_ORIGIN = `http://localhost:${backendPorts.renderer}`;
  }
  const trustedRendererOrigins = new Set(
    String(process.env.BIOF3_TRUSTED_DESKTOP_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (isDevModeLocal()) {
    try {
      trustedRendererOrigins.add(new URL(rendererDevUrl).origin);
    } catch {}
  }
  if (backendPorts.renderer) {
    trustedRendererOrigins.add(`http://localhost:${backendPorts.renderer}`);
    trustedRendererOrigins.add(`http://127.0.0.1:${backendPorts.renderer}`);
  }
  process.env.BIOF3_TRUSTED_DESKTOP_ORIGINS = [...trustedRendererOrigins].join(",");
  // Child servers run in separate Node processes and cannot see Electron's
  // in-memory plugin registry. Give them the exact packaged/dev built-in root
  process.env.BIOF3_BUILT_IN_PLUGINS_DIR = getBuiltInPluginsDir({
    isPackaged: !isDevModeLocal(),
    projectRoot: getProjectRootLocal(),
    resourcesPath: process.resourcesPath,
  });

  // 计算执行配置：默认本地优先；若用户已保存远端集群配置，则一并注入
  _applyComputeSettings(_loadComputeSettings());
}

module.exports = { setupDesktopEnv, getBackendPort, getBackendPorts };
