/**
 * Electron 主进程入口 — BioF3 本地桌面版
 *
 * 职责：
 * 1. 设置桌面版环境变量（BIOF3_EXEC_MODE=local 等）
 * 2. 启动 r-server + py-server（子进程 spawn，避免原生模块 V8 版本冲突）
 * 3. 启动 R plumber replot 服务（spawn 子进程）
 * 4. 加载已安装插件
 * 5. 内容增量同步（后台）
 * 6. 创建 webview 窗口加载内嵌静态站
 * 7. 外部链接走系统浏览器
 */

const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  session,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const {
  getNodeLocator,
  getRuntimeBinCandidates,
  getRuntimeBinName,
  getOpenShellPlan,
  getSessionShellSpec,
} = require("./platform-compat");
const {
  getPythonRuntimeExecutable,
} = require("../vendor/biof3-core/shared-backend/runtime-paths");

const isDevMode =
  process.argv.includes("--dev") ||
  process.env.ELECTRON_IS_DEV === "1" ||
  process.env.NODE_ENV === "development";
const rendererDevUrl =
  process.env.BIOF3_RENDERER_DEV_URL || "http://localhost:3000";

if (process.env.BIOF3_ELECTRON_USER_DATA_DIR) {
  try {
    app.setPath("userData", process.env.BIOF3_ELECTRON_USER_DATA_DIR);
  } catch (e) {
    console.warn("[desktop] failed to override userData path:", e.message);
  }
}

// ── EPIPE / stdout 兜底 ─────────────────────────────────────
// console.log 写 stdout 时若管道已关（子进程退出/重定向）会抛 EPIPE，
// 被当 Uncaught Exception 弹对话框。吞掉 EPIPE，不让它中断主进程。
process.stdout?.on?.("error", (err) => {
  if (err && err.code === "EPIPE") return;
  throw err;
});
process.stderr?.on?.("error", (err) => {
  if (err && err.code === "EPIPE") return;
  throw err;
});

// ── 自动更新（electron-updater）─────────────────────────────
// 打包模式下加载 electron-updater；开发模式下跳过（npm start 无打包元数据）
let autoUpdater = null;
if (!isDevMode && app.isPackaged) {
  try {
    autoUpdater = require("electron-updater");
    if (autoUpdater.autoUpdater) autoUpdater = autoUpdater.autoUpdater;
  } catch (e) {
    console.warn(
      "[desktop] electron-updater not installed — auto-update disabled",
    );
  }
}

// ── 日志收集（诊断包用）──────────────────────────────────────
// 子进程 stdout/stderr 同时写入 logs/ 下的滚动日志文件
const _logStreams = {}; // { r-server: WriteStream, py-server: WriteStream, main: WriteStream }

function _getLogDir() {
  const dir = process.env.BIOF3_LOCAL_DATA_DIR
    ? path.join(process.env.BIOF3_LOCAL_DATA_DIR, "logs")
    : path.join(app.getPath("documents"), "BioF3-Local", "logs");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

function _createLogStream(name) {
  const dir = _getLogDir();
  const file = path.join(dir, `${name}.log`);
  const stream = fs.createWriteStream(file, { flags: "a" });
  _logStreams[name] = stream;
  // 写入分隔线标记新会话
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

function _readLogTail(filePath, maxLines = 120) {
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

const DEFAULT_COMPUTE_SETTINGS = {
  computeMode: "local",
  remoteComputeUrl: "",
  remoteComputeToken: "",
  remoteComputeName: "",
};

function _getSettingsDir() {
  return (
    process.env.BIOF3_LOCAL_DATA_DIR ||
    path.join(app.getPath("documents"), "BioF3-Local")
  );
}

function _getComputeSettingsFile() {
  return path.join(_getSettingsDir(), "compute-settings.json");
}

function _normalizeComputeSettings(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const computeMode = String(raw.computeMode || raw.compute_mode || "local").toLowerCase();
  const normalizedMode = computeMode === "remote" ? "remote" : "local";
  return {
    ...DEFAULT_COMPUTE_SETTINGS,
    computeMode: normalizedMode,
    remoteComputeUrl: String(raw.remoteComputeUrl || raw.remote_compute_url || "").trim(),
    remoteComputeToken: String(raw.remoteComputeToken || raw.remote_compute_token || ""),
    remoteComputeName: String(raw.remoteComputeName || raw.remote_compute_name || "").trim(),
  };
}

function _loadComputeSettings() {
  try {
    const filePath = _getComputeSettingsFile();
    if (!fs.existsSync(filePath)) return { ...DEFAULT_COMPUTE_SETTINGS };
    return _normalizeComputeSettings(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return { ...DEFAULT_COMPUTE_SETTINGS };
  }
}

function _saveComputeSettings(settings) {
  const normalized = _normalizeComputeSettings(settings);
  const dir = _getSettingsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  fs.writeFileSync(_getComputeSettingsFile(), JSON.stringify(normalized, null, 2));
  return normalized;
}

function _applyComputeSettings(settings) {
  const normalized = _normalizeComputeSettings(settings);
  process.env.BIOF3_COMPUTE_MODE = normalized.computeMode;
  process.env.BIOF3_REMOTE_COMPUTE_URL = normalized.remoteComputeUrl;
  process.env.BIOF3_REMOTE_COMPUTE_TOKEN = normalized.remoteComputeToken;
  process.env.BIOF3_REMOTE_COMPUTE_NAME = normalized.remoteComputeName;
  return normalized;
}

// ── 路径解析（开发模式 vs 打包模式）────────────────────────────
// desktop 仓分仓后（断点5）：
//   - desktop 自己的资源（frontend/dist, build, resources/）在 desktop 仓根
//   - core 资源（r-server, py-server, shared-backend）在 git submodule vendor/biof3-core/
// 开发模式：PROJECT_ROOT = desktop 仓根（src/..），CORE_ROOT = PROJECT_ROOT/vendor/biof3-core
// 打包模式：desktop 资源在 process.resourcesPath，core 资源在 process.resourcesPath/core（electron-builder extraResources）
// 注意：分仓前 main.js 在 desktop-app/src/main.js，往上两层到仓库根；
//       分仓后 main.js 在 src/main.js，只需往上一层到 desktop 仓根。
const PROJECT_ROOT = path.join(__dirname, "..");
const IS_DEV = !app.isPackaged;

// core 仓根（submodule）。dev: vendor/biof3-core；pack: resourcesPath/core
function resolveCoreRoot() {
  if (IS_DEV) {
    return path.join(PROJECT_ROOT, "vendor", "biof3-core");
  }
  return path.join(process.resourcesPath, "core");
}

// desktop 自己的资源（frontend/dist 等）
function resolveResource(...parts) {
  if (IS_DEV) {
    return path.join(PROJECT_ROOT, ...parts);
  }
  return path.join(process.resourcesPath, ...parts);
}

// core 仓的资源（r-server/py-server/shared-backend）
function resolveCore(...parts) {
  return path.join(resolveCoreRoot(), ...parts);
}

// ── 解析用来跑 r-server/py-server 的 node 可执行文件 ────────────
// 开发模式：用系统 node（如 v23），避免 Electron 内置 node（v20/131）
// 与 better-sqlite3（按系统 node 编译，137）版本不匹配导致崩溃。
// PATH 查找不可靠（Electron 子进程 PATH 不含用户自定义 node 路径），
// 所以用 execFileSync('which node') 拿绝对路径。
// 打包模式：用 Electron 自带 node（better-sqlite3 在打包时按 Electron node 重编译）。
function resolveNodeBin() {
  if (!IS_DEV) return process.execPath;
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
  return "node"; // 兜底走 PATH（可能命中 Electron node，但至少不崩 spawn）
}
const NODE_BIN = resolveNodeBin();

// ── 基础 Runtime 自带包集合 ─────────────────────────────────────
const BASE_R_PACKAGES = new Set([
  "ggplot2",
  "dplyr",
  "tidyr",
  "reshape2",
  "data.table",
  "pheatmap",
  "ggrepel",
  "RColorBrewer",
  "patchwork",
  "cowplot",
  "plotly",
  "igraph",
  "ggraph",
  "tidygraph",
  "circlize",
  "ComplexHeatmap",
  "UpSetR",
  "ggalluvial",
  "treemap",
  "networkD3",
  "Seurat",
  "SingleCellExperiment",
  "MOFA2",
  "CellChat",
  "WGCNA",
  "maftools",
  "clusterProfiler",
  "enrichplot",
  "DOSE",
  "org.Hs.eg.db",
  "survival",
  "survminer",
  "rms",
  "pROC",
  "glmnet",
  "caret",
  "timeROC",
  "PRROC",
  "dcurves",
  "scatterpie",
  "Rtsne",
  "STRINGdb",
  "gganimate",
]);
const BASE_PY_PACKAGES = new Set([
  "matplotlib",
  "numpy",
  "pandas",
  "scanpy",
  "anndata",
  "scikit-learn",
  "seaborn",
  "scipy",
]);

// ── 系统检测：开发模式下找系统安装的 R / Python ────────────────
function _detectSystemR() {
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

function _detectSystemPython() {
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

// ── 环境变量（桌面版模式）──────────────────────────────────────

// Runtime 解析两级优先：
//   1. 用户安装的独立 Runtime（~/Documents/BioF3-Local/runtimes/{R|Python}）— 最高优先
//   2. 开发模式：检测系统 R/Python（仅 dev，打包模式不检测，保持独立）
//   3. 都没有 → 返回 null，R/Python 功能不可用，提示从插件商店安装
function resolveRuntime(lang, userDataDir) {
  const runtimeName = lang === "r" ? "R" : "Python";

  // 1. 用户安装的独立 Runtime
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

  // 2. 开发模式：检测系统 R/Python（仅 dev，打包模式不检测，保持独立）
  if (IS_DEV) {
    if (lang === "r") {
      const sysR = _detectSystemR();
      if (sysR) return sysR;
    } else {
      const sysPy = _detectSystemPython();
      if (sysPy) return sysPy;
    }
  }

  return null;
}

function setupDesktopEnv() {
  process.env.BIOF3_EXEC_MODE = "local";
  process.env.BIOF3_STORAGE = "local";
  process.env.BIOF3_LOCAL_MODE = "1";
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
  const rHome = resolveRuntime("r", userDataDir);
  if (rHome) {
    process.env.BIOF3_R_HOME = rHome;
    console.log("[desktop] R runtime:", rHome);
  } else {
    console.warn(
      '[desktop] R runtime not installed — install "R 运行时" from plugin store',
    );
  }

  const pyHome = resolveRuntime("python", userDataDir);
  if (pyHome) {
    process.env.BIOF3_PY_HOME = pyHome;
    console.log("[desktop] Python runtime:", pyHome);
  } else {
    console.warn(
      '[desktop] Python runtime not installed — install "Python 运行时" from plugin store',
    );
  }

  // 端口（避免和 web 版开发端口冲突）
  process.env.R_SERVER_PORT = "3001";
  process.env.PY_SERVER_PORT = "3004";

  // 计算执行配置：默认本地优先；若用户已保存远端集群配置，则一并注入
  _applyComputeSettings(_loadComputeSettings());
}

// ── 启动 r-server（子进程 spawn，避免原生模块 V8 版本冲突）─────
let rServerProc = null;
function startRServer() {
  // Runtime 未安装时跳过启动（不崩溃，前端会提示安装）
  if (!process.env.BIOF3_R_HOME || !fs.existsSync(process.env.BIOF3_R_HOME)) {
    console.warn("[desktop] r-server skipped — R runtime not installed");
    return;
  }

  const rServerPath = resolveCore("r-server", "server.js");
  if (!fs.existsSync(rServerPath)) {
    console.error("[desktop] r-server not found:", rServerPath);
    return;
  }

  rServerProc = spawn(NODE_BIN, [rServerPath], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  _createLogStream("r-server");
  rServerProc.stdout.on("data", (d) => {
    const text = d.toString().trim();
    if (text) {
      console.log(`[r-server] ${text}`);
      _writeLog("r-server", `[r-server] ${text}`);
    }
  });
  rServerProc.stderr.on("data", (d) => {
    const text = d.toString().trim();
    if (text) {
      console.error(`[r-server] ${text}`);
      _writeLog("r-server", `[r-server:ERR] ${text}`);
    }
  });
  rServerProc.on("exit", (code) => {
    console.log(`[desktop] r-server exited: ${code}`);
    rServerProc = null;
  });

  console.log(
    "[desktop] r-server spawned (pid=" + rServerProc.pid + ") on :3001",
  );
}

// ── 启动 py-server（子进程 spawn，应用启动即热）───────────────
let pyServerProc = null;

/**
 * 启动 py-server（若已运行则不重复 spawn）。
 * @param {string} reason - 调用来源（'ipc' / 'manual' 等，仅日志）
 * @returns {{ ok: boolean, alreadyRunning?: boolean, error?: string, pid?: number }}
 */
function startPyServer(reason = "ipc") {
  // 已在运行，直接返回
  if (pyServerProc && !pyServerProc.killed) {
    return { ok: true, alreadyRunning: true, pid: pyServerProc.pid };
  }

  // Runtime 未安装时跳过启动（不崩溃，前端会提示安装）
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
      env: { ...process.env },
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
    `[desktop] py-server spawned (pid=${pyServerProc.pid}) on :3004 — reason=${reason}`,
  );
  return { ok: true, pid: pyServerProc.pid };
}

/**
 * 停止 py-server（kill 子进程，清 idle 计时）。
 * @param {string} reason - 调用来源（'ipc' / 'idle-timeout' / 'shutdown' 等）
 * @returns {{ ok: boolean, wasRunning?: boolean }}
 */
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
  // 注意：exit handler 会把 pyServerProc 置 null，这里不重复清
  return { ok: true, wasRunning: true };
}

// ── 启动 R plumber replot 服务（按需启停）──────────────────────
// M2-7：plumber 改为 lazy——仅在重绘时通过 IPC plumber:start 启动。
let plumberProc = null;
let plumberIdleTimer = null;
const PLUMBER_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟无调用自动停

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

/**
 * 启动 plumber（若已运行则不重复 spawn）。
 * @param {string} reason - 调用来源（仅日志）
 * @returns {{ ok: boolean, alreadyRunning?: boolean, error?: string, pid?: number }}
 */
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

  // plumber 脚本路径（r-server 里有 replot 服务脚本）
  const plumberScript = resolveCore("r-server", "replot.R");
  if (!fs.existsSync(plumberScript)) {
    console.warn("[desktop] plumber script not found, replot disabled");
    return { ok: false, error: "plumber script not found" };
  }

  try {
    plumberProc = spawn(rBin, [plumberScript, "--port", "8787"], {
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
  console.log(`[desktop] plumber started on :8787 — reason=${reason}`);
  return { ok: true, pid: plumberProc.pid };
}

/**
 * 停止 plumber。
 * @param {string} reason - 调用来源
 * @returns {{ ok: boolean, wasRunning?: boolean }}
 */
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

// ── 加载已安装插件 ─────────────────────────────────────────────
async function loadInstalledPlugins() {
  try {
    const { loadAllPlugins } = require("./plugin-manager");
    await loadAllPlugins();
    console.log("[desktop] plugins loaded");
  } catch (e) {
    console.warn("[desktop] plugin load failed:", e.message);
  }
}

// ── 内容增量同步（后台，不阻塞启动）────────────────────────────
function startContentSync() {
  try {
    const { syncContent } = require("./content-sync");
    // 启动后 5 秒开始首次同步
    setTimeout(() => {
      syncContent().catch((e) =>
        console.warn("[desktop] content sync failed:", e.message),
      );
    }, 5000);
    // 每 4 小时同步一次
    setInterval(
      () => {
        syncContent().catch((e) =>
          console.warn("[desktop] content sync failed:", e.message),
        );
      },
      4 * 60 * 60 * 1000,
    );
  } catch (e) {
    console.warn("[desktop] content sync module not available:", e.message);
  }
}

// ── 主窗口 ─────────────────────────────────────────────────────
let mainWindow = null;

async function createWindow() {
  // 阶段 3（desktop-spa）：主窗口加载 Vite SPA build 产物
  // Vite SPA 在 frontend/dist，base '/'，无 baseUrl 前缀
  const spaBuildDir = resolveResource("frontend", "dist");
  const spaIndexPath = path.join(spaBuildDir, "index.html");
  let spaServerUrl = isDevMode ? rendererDevUrl : null;

  // Docusaurus build 产物（docs/blog iframe 过渡用）
  // 桌面端已移除教程入口，docs-server 不再启动。
  // 原生渲染组件（pages/docs.tsx 等）保留在代码库中，如需恢复取消下面注释即可。
  // const docusaurusBuildDir = resolveResource('build');
  // const docusaurusServerUrl = 'http://localhost:3003/BioF3/';

  if (!isDevMode) {
    // 启动 Vite SPA 静态服务器。若默认端口已被占用，回退到系统分配的
    // 空闲端口，并在服务真正开始监听后再加载窗口。
    try {
      const { startStaticServer } = require("./static-server");
      const spaServer = await startStaticServer(spaBuildDir, {
        port: 3002,
        baseUrl: "/",
        label: "spa-server",
        spaFallback: true,
        fallbackToRandomPort: true,
      });
      const address = spaServer?.address();
      if (typeof address === "object" && address) {
        spaServerUrl = `http://localhost:${address.port}/`;
      }
    } catch (e) {
      console.warn("[desktop] SPA static server failed:", e.message);
    }
  }

  // 启动 Docusaurus 静态服务器（:3003，baseUrl=/BioF3/，供 docs/blog iframe）
  // 桌面端已移除教程入口，docs-server 不再启动。如需恢复取消下面注释即可。
  /*
  if (fs.existsSync(docusaurusBuildDir)) {
    try {
      const { startStaticServer } = require('./static-server');
      startStaticServer(docusaurusBuildDir, {
        port: 3003,
        baseUrl: '/BioF3/',
        label: 'docs-server',
        spaFallback: true,
      });
    } catch (e) {
      console.warn('[desktop] docs static server failed:', e.message);
    }
  }
  */

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 720,
    minHeight: 520,
    title: "BioF3",
    frame: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 6 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // 开发模式优先加载 Vite dev server，启用 React/Vite HMR；
  // 生产/普通启动加载本地静态构建产物。
  if (isDevMode) {
    mainWindow.loadURL(spaServerUrl);
  } else if (fs.existsSync(spaIndexPath) && spaServerUrl) {
    mainWindow.loadURL(spaServerUrl);
  } else {
    // 开发模式：加载 Vite dev server
    mainWindow.loadURL(rendererDevUrl);
  }

  // 外部链接走系统浏览器；所有 window.open 一律 deny，避免 Electron 创建
  // 新原生窗口（非 http URL 用 allow 会导致弹窗风暴：新窗口不继承 handler，
  // 加载失败后 SPA fallback 又加载完整应用，级联弹窗直到卡死）。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    // 非 http URL（相对路径、blob:、about:blank 等）全部 deny
    return { action: "deny" };
  });

  // 拦截主窗口导航：只允许在本地服务器范围内跳转，防止意外导航到
  // 外部 URL 或 file:// 导致白屏/弹窗
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = [
      spaServerUrl?.replace(/\/$/, ""),
      rendererDevUrl.replace(/\/$/, ""),
    ].filter(Boolean);
    if (!allowed.some((a) => url.startsWith(a))) {
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        shell.openExternal(url);
      }
    }
  });

  // 桌面稳定性：拦截 Cmd/Ctrl+R，避免 Electron 硬 reload 断开 SSE、丢失
  // renderer 内存状态，并造成“前端刷新后后端像断开”的体感。
  // Cmd/Ctrl+R 改为应用内软刷新；Cmd/Ctrl+Shift+R 保留为开发者硬刷新。
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isReloadKey =
      input.key &&
      input.key.toLowerCase() === "r" &&
      (input.meta || input.control) &&
      !input.alt;
    if (!isReloadKey) return;
    event.preventDefault();
    if (input.shift) {
      console.log("[desktop] hard reload requested");
      mainWindow.webContents.reloadIgnoringCache();
      return;
    }
    console.log("[desktop] soft refresh requested");
    mainWindow.webContents.send("app:soft-refresh");
  });

  // DevTools 仅在显式需要时打开，避免日常启动打断工作台。
  if (process.env.BIOF3_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools();
  }

  // 捕获渲染进程 console 消息（调试用）
  mainWindow.webContents.on(
    "console-message",
    (event, level, message, line, sourceId) => {
      const tag = ["LOG", "WARN", "ERROR"][level] || "LOG";
      console.log(`[renderer:${tag}] ${message}`);
    },
  );

  // 捕获页面加载失败
  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[renderer] load failed: ${errorCode} ${errorDescription} url=${validatedURL}`,
      );
    },
  );

  // 页面加载完成
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[renderer] page loaded");
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── IPC：窗口控制（配合 frame:false 自定义标题栏）──────────────
function setupWindowIpc() {
  ipcMain.on("window:minimize", () => {
    if (mainWindow) mainWindow.minimize();
  });
  ipcMain.on("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on("window:close", () => {
    if (mainWindow) mainWindow.close();
  });
  ipcMain.handle("window:isMaximized", () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });
}

// ── IPC：AI 设置 ───────────────────────────────────────────────
function setupAiSettingsIpc() {
  ipcMain.handle("ai-settings:get", async () => {
    try {
      const { getAiSettings } = require(
        resolveCore("r-server", "helpers", "ai-settings.js"),
      );
      return getAiSettings();
    } catch (e) {
      return {};
    }
  });

  ipcMain.handle("ai-settings:save", async (event, settings) => {
    try {
      const { saveAiSettings } = require(
        resolveCore("r-server", "helpers", "ai-settings.js"),
      );
      saveAiSettings(settings);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("ai-settings:test", async (event, provider, apiKey) => {
    try {
      const { testApiKey } = require(
        resolveCore("r-server", "helpers", "ai-settings.js"),
      );
      return await testApiKey(provider, apiKey);
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });
}

// ── IPC：计算执行配置 ─────────────────────────────────────────
function setupComputeSettingsIpc() {
  ipcMain.handle("compute-settings:get", async () => {
    try {
      return _loadComputeSettings();
    } catch (e) {
      return { ...DEFAULT_COMPUTE_SETTINGS, error: e.message };
    }
  });

  ipcMain.handle("compute-settings:save", async (_event, settings) => {
    try {
      const normalized = _saveComputeSettings(settings);
      _applyComputeSettings(normalized);
      return { ok: true, settings: normalized, restartRequired: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC：M2-3 可选错误遥测（V3）─────────────────────────────────
// 默认关闭；用户在设置页主动开启后才会上报。payload 仅含 category/version/摘要。
function setupTelemetryIpc() {
  ipcMain.handle("telemetry:report", async (_event, payload) => {
    try {
      const { reportError } = require("./telemetry");
      return await reportError(payload);
    } catch (e) {
      // 遥测自身异常绝不能影响业务——静默
      return { ok: false, reason: "internal" };
    }
  });
}

// ── IPC：插件管理 ──────────────────────────────────────────────
function setupPluginIpc() {
  ipcMain.handle("plugin:list-installed", async () => {
    try {
      const { getInstalledPlugins } = require("./plugin-manager");
      return getInstalledPlugins();
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle("plugin:list-remote", async () => {
    try {
      const { getRemoteManifest } = require("./plugin-manager");
      return await getRemoteManifest();
    } catch (e) {
      return { plugins: {} };
    }
  });

  ipcMain.handle("plugin:install", async (event, pluginId) => {
    try {
      const { installPlugin } = require("./plugin-manager");
      // 下载进度通过 event.sender.send 实时推给渲染进程
      const onProgress = (ratio, received, total) => {
        try {
          event.sender.send("plugin:install-progress", {
            pluginId,
            ratio,
            received,
            total,
          });
        } catch {}
      };
      await installPlugin(pluginId, onProgress);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("plugin:uninstall", async (event, pluginId) => {
    try {
      const { uninstallPlugin } = require("./plugin-manager");
      await uninstallPlugin(pluginId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("plugin:check-updates", async () => {
    try {
      const { checkUpdates } = require("./plugin-manager");
      return await checkUpdates();
    } catch (e) {
      return [];
    }
  });

  // ── M2-9：content-plugin 文档桥 ──────────────────────────────
  // docs.tsx 运行时通过这些 IPC 拉取已装 content-plugin 的文档树与正文
  ipcMain.handle("content-plugin:list", async () => {
    try {
      const { listAllContentPlugins } = require("./plugin-manager");
      return listAllContentPlugins();
    } catch (e) {
      console.warn("[desktop] content-plugin:list failed:", e.message);
      return [];
    }
  });

  ipcMain.handle("content-plugin:list-docs", async (_event, pluginId) => {
    try {
      const { listContentPluginDocs } = require("./plugin-manager");
      return listContentPluginDocs(pluginId);
    } catch (e) {
      console.warn("[desktop] content-plugin:list-docs failed:", e.message);
      return [];
    }
  });

  ipcMain.handle(
    "content-plugin:read",
    async (_event, pluginId, relativePath) => {
      try {
        const { readContentPluginDoc } = require("./plugin-manager");
        return {
          ok: true,
          content: readContentPluginDoc(pluginId, relativePath),
        };
      } catch (e) {
        console.warn("[desktop] content-plugin:read failed:", e.message);
        return { ok: false, error: e.message };
      }
    },
  );
}

// ── M1-2：CSP 加固 ─────────────────────────────────────────────
// 禁用 unsafe-eval，限制资源来源。connect-src 放开 localhost:* 覆盖
// r-server(3001)/py-server(3004)/plumber(8787)/dev server(3000)/SSE。
// frame-src 放开 localhost:* 供本地可视化嵌入用。
// 不回退 unsafe-eval——Vite 生产构建已无 eval 需求。
function setupCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const scriptSrc = isDevMode
      ? "script-src 'self' 'unsafe-inline'; "
      : "script-src 'self'; ";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
            scriptSrc +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob: http://localhost:* ; " +
            "connect-src 'self' http://localhost:* ws://localhost:* ; " +
            "frame-src 'self' http://localhost:* ; " +
            "font-src 'self' data: ; " +
            "worker-src 'self' blob: ; " +
            "object-src 'none';",
        ],
      },
    });
  });
  console.log(
    isDevMode
      ? "[desktop] CSP dev mode (Vite React refresh inline preamble allowed)"
      : "[desktop] CSP hardened (unsafe-eval disabled)",
  );
}

// ── IPC：Runtime 状态查询 ──────────────────────────────────────
function setupRuntimeIpc() {
  ipcMain.handle("runtime:status", async () => {
    try {
      const { getRuntimeStatus } = require("./plugin-manager");
      return getRuntimeStatus();
    } catch (e) {
      return { r: { installed: false }, python: { installed: false } };
    }
  });

  // M1-1：后端就绪感知层——聚合 runtime:status + health 探测 + 子进程存活
  // 渲染进程通过 window.biof3Desktop.backend.status() 调用，5s 轮询
  ipcMain.handle("backend:status", async () => {
    try {
      const { getRuntimeStatus } = require("./plugin-manager");
      const { getBackendStatus } = require("./backend-health");
      return await getBackendStatus({
        runtimeStatus: getRuntimeStatus(),
        procs: {
          rServer: rServerProc,
          pyServer: pyServerProc,
          plumber: plumberProc,
        },
      });
    } catch (e) {
      return { isReady: false, downReason: "状态查询失败: " + e.message };
    }
  });
}

// ── IPC：M2-7 按需启停 py-server / plumber ──────────────────────
// 前端在用 Python 工具前调 biof3Desktop.py.start()，用完调 .stop()；
// plumber 在重绘前调 .start()。未调用时 5min idle 自动 stop。
function setupBackendLifecycleIpc() {
  ipcMain.handle("py:start", async () => {
    try {
      return startPyServer("ipc");
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("py:stop", async () => {
    try {
      return stopPyServer("ipc");
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("plumber:start", async () => {
    try {
      return startPlumber("ipc");
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("plumber:stop", async () => {
    try {
      return stopPlumber("ipc");
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC：自动更新（electron-updater）──────────────────────────
function setupAutoUpdateIpc() {
  if (!autoUpdater) {
    // 打包时未安装 electron-updater：所有 IPC 返回 disabled
    ipcMain.handle("updater:check", async () => ({
      ok: false,
      error: "auto-update disabled",
    }));
    ipcMain.handle("updater:download", async () => ({
      ok: false,
      error: "auto-update disabled",
    }));
    ipcMain.handle("updater:install", async () => ({
      ok: false,
      error: "auto-update disabled",
    }));
    return;
  }

  autoUpdater.autoDownload = false; // 手动控制下载（用户点"下载"才下）
  autoUpdater.autoInstallOnAppQuit = true;

  let _updateInfo = null;

  autoUpdater.on("update-available", (info) => {
    _updateInfo = info;
    if (mainWindow)
      mainWindow.webContents.send("updater:update-available", {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
  });

  autoUpdater.on("update-not-available", () => {
    if (mainWindow) mainWindow.webContents.send("updater:update-not-available");
  });

  autoUpdater.on("download-progress", (progress) => {
    if (mainWindow)
      mainWindow.webContents.send("updater:download-progress", {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      });
  });

  autoUpdater.on("update-downloaded", () => {
    if (mainWindow) mainWindow.webContents.send("updater:update-downloaded");
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] error:", err.message);
    if (mainWindow) mainWindow.webContents.send("updater:error", err.message);
  });

  ipcMain.handle("updater:check", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, hasUpdate: !!_updateInfo, info: _updateInfo };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("updater:download", async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("updater:install", async () => {
    try {
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC：文件对话框（preload 暴露的 files.saveDialog/openDialog）─────────
function setupFileDialogIpc() {
  ipcMain.handle("file:save-dialog", async (event, defaultName) => {
    if (!mainWindow) return null;
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName,
      });
      return canceled ? null : filePath;
    } catch (e) {
      console.error("[desktop] save dialog failed:", e.message);
      return null;
    }
  });

  ipcMain.handle("file:open-dialog", async (event, optionsOrFilters) => {
    if (!mainWindow) return null;
    try {
      const isOptions =
        optionsOrFilters &&
        typeof optionsOrFilters === "object" &&
        !Array.isArray(optionsOrFilters);
      const filters = isOptions ? optionsOrFilters.filters : optionsOrFilters;
      const properties =
        isOptions && optionsOrFilters.openDirectory
          ? ["openDirectory", "createDirectory"]
          : ["openFile"];
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        filters: Array.isArray(filters) ? filters : [],
        properties,
      });
      return canceled ? null : filePaths[0];
    } catch (e) {
      console.error("[desktop] open dialog failed:", e.message);
      return null;
    }
  });

  ipcMain.handle("file:open-path", async (_event, targetPath) => {
    try {
      if (!targetPath || typeof targetPath !== "string") {
        return { ok: false, error: "invalid path" };
      }
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      const error = await shell.openPath(targetPath);
      return error ? { ok: false, error } : { ok: true };
    } catch (e) {
      console.error("[desktop] open path failed:", e.message);
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC：诊断日志导出 / 数据备份（M2-8）─────────────────────────
function setupDiagnosticIpc() {
  // 导出包：收集 r-server/py-server/main 日志 + 系统信息 + 整个数据目录
  // （db + results + uploads），打包成 zip 供用户备份。
  ipcMain.handle("diagnostic:export", async (event, targetPath) => {
    try {
      const logDir = _getLogDir();
      const { createWriteStream } = fs;
      const zlib = require("zlib");

      // M2-8 备份/导出闭环：默认保存对话框提示用户选导出路径
      let outPath = targetPath;
      if (!outPath && mainWindow) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
          title: "导出我的数据",
          defaultPath: `biof3-backup-${ts}.zip`,
          filters: [{ name: "ZIP", extensions: ["zip"] }],
        });
        if (canceled) return { ok: false, error: "cancelled" };
        outPath = filePath;
      }
      if (!outPath) return { ok: false, error: "no output path" };

      // M2-8：数据目录（db + results + uploads）
      const dataDir =
        process.env.BIOF3_LOCAL_DATA_DIR ||
        path.join(app.getPath("documents"), "BioF3-Local");

      // 先 flush 日志流
      for (const s of Object.values(_logStreams)) {
        try {
          s.write("");
        } catch {}
      }

      // 收集系统信息
      const sysInfo = {
        platform: process.platform,
        arch: process.arch,
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        timestamp: new Date().toISOString(),
        rHome: process.env.BIOF3_R_HOME || "(not set)",
        pyHome: process.env.BIOF3_PY_HOME || "(not set)",
        dataDir: process.env.BIOF3_LOCAL_DATA_DIR || "(not set)",
      };

      // 用简单的方式打包：逐文件写入 zip（避免额外依赖）
      // 如果有 archiver 就用，没有就用 tar.gz
      let usedArchiver = false;
      try {
        const archiver = require("archiver");
        const output = createWriteStream(outPath);
        const archive = archiver("zip", { zlib: { level: 6 } });
        output.on("close", () => {});
        archive.pipe(output);

        // 添加日志文件
        for (const name of ["r-server", "py-server"]) {
          const logFile = path.join(logDir, `${name}.log`);
          if (fs.existsSync(logFile)) {
            archive.file(logFile, { name: `${name}.log` });
          }
        }
        // 添加系统信息
        archive.append(JSON.stringify(sysInfo, null, 2), {
          name: "system-info.json",
        });
        // 添加 installed plugins
        try {
          const { getInstalledPlugins } = require("./plugin-manager");
          archive.append(JSON.stringify(getInstalledPlugins(), null, 2), {
            name: "installed-plugins.json",
          });
        } catch {}

        // M2-8 备份/导出闭环：打包整个数据目录（db + results + uploads）
        // 跳过 tmp 目录避免打包临时文件
        if (fs.existsSync(dataDir)) {
          try {
            for (const entry of fs.readdirSync(dataDir, {
              withFileTypes: true,
            })) {
              if (entry.name === "tmp") continue; // 临时目录不打包
              const full = path.join(dataDir, entry.name);
              if (entry.isDirectory()) {
                archive.directory(full, entry.name);
              } else if (entry.isFile()) {
                archive.file(full, { name: entry.name });
              }
            }
          } catch (e) {
            console.warn("[diagnostic] add data dir failed:", e.message);
          }
        }

        await archive.finalize();
        usedArchiver = true;
      } catch {
        // archiver 不可用 — 用 tar.gz fallback
      }

      if (!usedArchiver) {
        // fallback: 写一个简单的 .txt 包（日志拼接 + 系统信息）
        const lines = [];
        lines.push("=== BioF3 Diagnostic Package ===");
        lines.push(JSON.stringify(sysInfo, null, 2));
        lines.push("");
        for (const name of ["r-server", "py-server"]) {
          const logFile = path.join(logDir, `${name}.log`);
          lines.push(`\n=== ${name}.log ===`);
          try {
            lines.push(fs.readFileSync(logFile, "utf8").slice(-5000)); // 最后 5000 字符
          } catch {
            lines.push("(log file not found)");
          }
        }
        try {
          const { getInstalledPlugins } = require("./plugin-manager");
          lines.push("\n=== installed-plugins.json ===");
          lines.push(JSON.stringify(getInstalledPlugins(), null, 2));
        } catch {}
        lines.push("\n=== data-dir note ===");
        lines.push(
          `数据目录位于 ${dataDir}（archiver 不可用，未打包；请手动复制该目录进行备份）`,
        );
        fs.writeFileSync(outPath, lines.join("\n"));
      }

      return { ok: true, path: outPath };
    } catch (e) {
      console.error("[diagnostic] export failed:", e.message);
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC：数据目录管理（卸载数据保留）──────────────────────────
// 用户可能在操作系统卸载应用后仍想保留 ~/Documents/BioF3-Local/ 数据，
// 或主动清理。这里提供查看数据目录大小 + 在文件管理器中打开的能力。
function setupDataManagementIpc() {
  // 递归计算目录大小（字节）
  function getDirSize(dir) {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    const walk = (d) => {
      try {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isSymbolicLink()) continue; // 跳过符号链接避免循环
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) {
            try {
              total += fs.statSync(full).size;
            } catch {}
          }
        }
      } catch {}
    };
    walk(dir);
    return total;
  }

  // 返回数据目录路径 + 各子目录大小（runtimes / plugins / results / uploads / logs / db）
  ipcMain.handle("data:info", async () => {
    try {
      const dataDir = process.env.BIOF3_LOCAL_DATA_DIR;
      if (!dataDir) return { ok: false, error: "数据目录未配置" };
      const breakdown = {};
      const subdirs = [
        "runtimes",
        "plugins",
        "results",
        "uploads",
        "logs",
        "tmp",
      ];
      for (const sub of subdirs) {
        const subPath = path.join(dataDir, sub);
        if (fs.existsSync(subPath)) breakdown[sub] = getDirSize(subPath);
      }
      // biof3.db 单独算
      const dbPath = path.join(dataDir, "biof3.db");
      if (fs.existsSync(dbPath)) {
        try {
          breakdown["biof3.db"] = fs.statSync(dbPath).size;
        } catch {}
      }
      // ai-settings.json 等
      const aiPath = path.join(dataDir, "ai-settings.json");
      if (fs.existsSync(aiPath)) {
        try {
          breakdown["ai-settings.json"] = fs.statSync(aiPath).size;
        } catch {}
      }
      const computePath = path.join(dataDir, "compute-settings.json");
      if (fs.existsSync(computePath)) {
        try {
          breakdown["compute-settings.json"] = fs.statSync(computePath).size;
        } catch {}
      }
      const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
      return { ok: true, dataDir, total, breakdown };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 在系统文件管理器中打开数据目录
  ipcMain.handle("data:open-dir", async () => {
    try {
      const dataDir = process.env.BIOF3_LOCAL_DATA_DIR;
      if (!dataDir) return { ok: false, error: "数据目录未配置" };
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      await shell.openPath(dataDir);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC：终端/日志面板 ───────────────────────────────────────
function setupTerminalIpc() {
  let shellProc = null;
  let disposeShellData = null;
  let disposeShellExit = null;

  const sendTerminalEvent = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  ipcMain.handle("terminal:snapshot", async () => {
    try {
      const logDir = _getLogDir();
      const processes = [
        {
          id: "r-server",
          label: "R 后端",
          command: `${NODE_BIN} ${resolveCore("r-server", "server.js")}`,
          status: rServerProc && !rServerProc.killed ? "running" : "stopped",
          pid: rServerProc?.pid || null,
          logPath: path.join(logDir, "r-server.log"),
          output: _readLogTail(path.join(logDir, "r-server.log")),
        },
        {
          id: "py-server",
          label: "Python 后端",
          command: `${NODE_BIN} ${resolveCore("py-server", "server.js")}`,
          status: pyServerProc && !pyServerProc.killed ? "running" : "stopped",
          pid: pyServerProc?.pid || null,
          logPath: path.join(logDir, "py-server.log"),
          output: _readLogTail(path.join(logDir, "py-server.log")),
        },
        {
          id: "plumber",
          label: "R plumber",
          command: process.env.BIOF3_R_HOME
            ? `${path.join(process.env.BIOF3_R_HOME, "bin", "Rscript")} ${resolveCore(
                "r-server",
                "replot.R",
              )} --port 8787`
            : "Rscript replot.R --port 8787",
          status: plumberProc && !plumberProc.killed ? "running" : "stopped",
          pid: plumberProc?.pid || null,
          logPath: path.join(logDir, "plumber.log"),
          output: _readLogTail(path.join(logDir, "plumber.log")),
        },
      ];
      return {
        ok: true,
        logDir,
        dataDir: process.env.BIOF3_LOCAL_DATA_DIR || null,
        processes,
      };
    } catch (e) {
      return { ok: false, error: e.message, processes: [] };
    }
  });

  ipcMain.handle("terminal:open-log-dir", async () => {
    try {
      const logDir = _getLogDir();
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const error = await shell.openPath(logDir);
      return error ? { ok: false, error } : { ok: true, path: logDir };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("terminal:open-shell", async (_event, targetPath) => {
    try {
      const cwd =
        typeof targetPath === "string" && targetPath.trim()
          ? targetPath.trim()
          : process.env.BIOF3_LOCAL_DATA_DIR || PROJECT_ROOT;
      const plan = getOpenShellPlan(cwd, process.platform);
      if (plan.type === "osascript") {
        spawn(plan.command, plan.args, {
          detached: plan.detached,
          stdio: plan.stdio,
        }).unref();
        return { ok: true, path: cwd };
      }
      if (plan.type === "cmd") {
        spawn(plan.command, plan.args, {
          detached: plan.detached,
          stdio: plan.stdio,
          windowsHide: plan.windowsHide,
        }).unref();
        return { ok: true, path: cwd };
      }
      for (const terminal of plan.candidates) {
        try {
          spawn(terminal, plan.args, {
            detached: plan.detached,
            stdio: plan.stdio,
          }).unref();
          return { ok: true, path: cwd };
        } catch {}
      }
      return { ok: false, error: "未找到可用的系统终端" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("terminal:session-start", async (_event, targetPath) => {
    try {
      if (shellProc) {
        return { ok: true, pid: shellProc.pid, reused: true };
      }
      const requestedCwd =
        typeof targetPath === "string" && targetPath.trim()
          ? targetPath.trim()
          : "";
      const cwd =
        requestedCwd && fs.existsSync(requestedCwd)
          ? requestedCwd
          : process.env.BIOF3_LOCAL_DATA_DIR || PROJECT_ROOT;
      const { shellPath, args } = getSessionShellSpec(process.env, process.platform);
      const pty = require("node-pty");
      shellProc = pty.spawn(shellPath, args, {
        name: "xterm-256color",
        cols: 100,
        rows: 28,
        cwd,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      disposeShellData = shellProc.onData((data) =>
        sendTerminalEvent("terminal:data", data),
      );
      disposeShellExit = shellProc.onExit(({ exitCode, signal }) => {
        sendTerminalEvent("terminal:exit", { code: exitCode, signal });
        disposeShellData?.dispose();
        disposeShellExit?.dispose();
        disposeShellData = null;
        disposeShellExit = null;
        shellProc = null;
      });
      return { ok: true, pid: shellProc.pid, cwd, shell: shellPath };
    } catch (e) {
      shellProc = null;
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("terminal:session-write", async (_event, input) => {
    if (!shellProc) {
      return { ok: false, error: "终端会话未启动" };
    }
    const text = typeof input === "string" ? input : "";
    if (text.length > 32_768) return { ok: false, error: "输入内容过长" };
    shellProc.write(text);
    return { ok: true };
  });

  ipcMain.handle("terminal:session-resize", async (_event, dimensions) => {
    if (!shellProc) return { ok: false, error: "终端会话未启动" };
    const cols = Math.max(2, Math.min(500, Number(dimensions?.cols) || 80));
    const rows = Math.max(1, Math.min(200, Number(dimensions?.rows) || 24));
    shellProc.resize(cols, rows);
    return { ok: true };
  });

  ipcMain.handle("terminal:session-stop", async () => {
    if (!shellProc) return { ok: true, wasRunning: false };
    shellProc.kill();
    shellProc = null;
    return { ok: true, wasRunning: true };
  });

  app.once("before-quit", () => {
    try {
      shellProc?.kill();
    } catch {}
  });
}

// ── 应用生命周期 ───────────────────────────────────────────────
async function main() {
  setupDesktopEnv();

  // M1-4 (H3)：启动 r-server 前跑 db migration，防升级 schema 错乱
  try {
    const { runMigrations, getAppliedVersion } = require("./migration-runner");
    const migDir = path.join(__dirname, "migrations");
    const dbPath = process.env.BIOF3_DB_PATH;
    if (dbPath) {
      // 确保 db 目录存在
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const ver = await runMigrations(dbPath, migDir);
      console.log("[desktop] migrations applied, version =", ver);
    }
  } catch (e) {
    console.error("[desktop] migration failed:", e.message);
    // 不阻断启动——r-server 的 initSchema() 仍会兜底建表
  }

  // 1. 启动后端服务
  // r-server 常驻；py-server 也在应用启动时预热，减少首次使用等待。
  await startRServer();
  // plumber 仍按需启停 — 只在 FigCode 重绘时通过 IPC plumber:start 触发

  // 2. 加载已安装插件
  await loadInstalledPlugins();

  // 3. 启动 Python 后端（热启动）
  await startPyServer("boot");

  // 4. 内容增量同步（后台）
  startContentSync();

  // 5. 设置 IPC
  setupWindowIpc();
  setupAiSettingsIpc();
  setupComputeSettingsIpc();
  setupPluginIpc();
  setupRuntimeIpc();
  setupBackendLifecycleIpc();
  setupFileDialogIpc();
  setupTerminalIpc();
  setupAutoUpdateIpc();
  setupDiagnosticIpc();
  setupFigcodeIpc();
  setupDataManagementIpc();
  setupTelemetryIpc();

  // 6. 创建窗口
  // M1-2：CSP 加固——禁用 unsafe-eval，限制资源来源到 self + localhost（后端/SSE/dev server）
  setupCsp();

  // 7. 创建窗口
  await createWindow();
}

app.whenReady().then(main);

app.on("window-all-closed", () => {
  // macOS 关闭最后一个窗口后应用仍驻留，后端也应继续在线；否则从 Dock
  // 重新打开时只会重建前端窗口，形成“前端在、后端断开”的状态。
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow().catch((err) => {
      console.error("[desktop] window recreation failed:", err);
    });
  }
});

app.on("before-quit", () => {
  _clearPlumberIdleTimer();
  for (const proc of [rServerProc, pyServerProc, plumberProc]) {
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
  }
});
