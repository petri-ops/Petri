/**
 * Electron 主进程入口 — BioF3 本地桌面版
 *
 * 职责：
 * 1. 设置桌面版本地存储、运行时和用户数据环境变量
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
  net,
  Menu,
} = require("electron");
const path = require("path");
const fs = require("fs");
const nodeNet = require("net");
const { spawn, spawnSync } = require("child_process");

const AGENT_WORKBENCH_FLAG_CHANNEL = "biof3:agent-workbench-flags";
const AGENT_WORKBENCH_FLAG_NAME = "extraRenderers";

function parseAgentWorkbenchFlags(argv = process.argv, env = process.env) {
  const cliValue = argv.find((arg) => arg.startsWith("--agent-workbench-flags="));
  const raw = cliValue
    ? cliValue.slice("--agent-workbench-flags=".length)
    : String(env.BIOF3_AGENT_WORKBENCH_FLAGS || "");
  const enabled = raw
    .split(",")
    .map((value) => value.trim())
    .includes(AGENT_WORKBENCH_FLAG_NAME);
  return { extraRenderers: enabled };
}

const agentWorkbenchFlags = parseAgentWorkbenchFlags();
const { createOwnedBackendSupervisor } = require("./owned-backend-supervisor");
const { createMacOssUpdater } = require("./macos-oss-updater");
const { redactSensitiveText } = require("./diagnostic-redaction");
// BLOCK-3 PHASE 2 G6: _mapSkillRuntimeStatus 提取到独立模块以便单测
// （main.js 在 module-eval 阶段读 app.isPackaged 等 Electron-only 状态，
//  无法被 plain Node 干净 require）。共享实现见 src/_mapSkillRuntimeStatus.js。
const { _mapSkillRuntimeStatus } = require("./_mapSkillRuntimeStatus");
const {
  getNodeLocator,
  getRuntimeBinCandidates,
  getRuntimeBinName,
  getOpenShellPlan,
  getSessionShellSpec,
  getBuiltInPluginsDir,
} = require("./platform-compat");
const runtimePathsModule = app.isPackaged
  ? path.join(process.resourcesPath, "core", "shared-backend", "runtime-paths.js")
  : path.join(__dirname, "..", "core", "shared-backend", "runtime-paths.js");
const {
  getPythonRuntimeExecutable,
} = require(runtimePathsModule);

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

// ── 日志收集（诊断包用）──────────────────────────────────────
// _logStreams + _getLogDir + _createLogStream + _writeLog +
// _readLogTail moved to src/main/backend-proc-manager.js by
// BLOCK-9.1 PHASE 4. They are imported back as needed by
// setupDiagnosticIpc / setupTerminalIpc via parameter injection.
// (No remaining consumer in src/main.js after the extraction.)

// ── 路径解析（开发模式 vs 打包模式）────────────────────────────
// 去 submodule 后（core 内嵌）：
//   - desktop 自己的资源（frontend/dist, build, resources/）在 desktop 仓根
//   - core 资源（r-server, py-server, shared-backend）内嵌在 desktop 仓根 core/ 下
// 开发模式：PROJECT_ROOT = desktop 仓根（src/..），CORE_ROOT = PROJECT_ROOT/core
// 打包模式：desktop 资源在 process.resourcesPath，core 资源在 process.resourcesPath/core（electron-builder extraResources）
const IS_DEV = !app.isPackaged;
const PROJECT_ROOT = IS_DEV ? path.join(__dirname, "..") : process.resourcesPath;

// core 根（去 submodule 后内嵌在 desktop 仓根）。dev: core/；pack: resourcesPath/core
function resolveCoreRoot() {
  if (IS_DEV) {
    return path.join(PROJECT_ROOT, "core");
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
// 开发模式：用系统 Node，并让各子进程从 Core 的独立 node_modules
// 加载原生依赖，避免与 electron-builder 重建后的根 ABI 混用。
// PATH 查找不可靠（Electron 子进程 PATH 不含用户自定义 node 路径），
// 所以用 execFileSync('which node') 拿绝对路径。
// 打包模式：macOS 必须使用 Helper 可执行文件。直接 spawn 主应用可执行文件会
// 再次加载 app.asar，递归启动整套桌面进程，而不是进入 Node 子进程模式。
function resolveNodeBin() {
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
// _detectSystemR / _detectSystemPython / resolveRuntime were
// moved to src/main/env-coordinator.js by BLOCK-9.1 PHASE 3.
// setupDesktopEnv lives there now and uses them.
// (Intentionally not re-exported from main.js — there's no
// other consumer in src/main.js after the extraction.)


// ── 环境变量（桌面版模式）──────────────────────────────────────

// Runtime 解析两级优先：
//   1. 用户安装的独立 Runtime（~/Documents/BioF3-Local/runtimes/{R|Python}）— 最高优先
//   2. 开发模式：检测系统 R/Python（仅 dev，打包模式不检测，保持独立）
//   3. 都没有 → 返回 null，R/Python 功能不可用，提示从插件商店安装
function reserveAvailablePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const tryListen = (port) => {
      const server = nodeNet.createServer();
      server.unref();
      server.once("error", (error) => {
        if (port === preferredPort && error.code === "EADDRINUSE") {
          tryListen(0);
          return;
        }
        reject(error);
      });
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        const address = server.address();
        const selectedPort = typeof address === "object" && address ? address.port : port;
        server.close((error) => (error ? reject(error) : resolve(selectedPort)));
      });
    };
    tryListen(preferredPort);
  });
}

async function selectBackendPorts() {
  const gateway = await reserveAvailablePort(3005);
  const r = await reserveAvailablePort(3001);
  const python = await reserveAvailablePort(3004);
  const plumber = await reserveAvailablePort(8787);
  const renderer = isDevMode ? null : await reserveAvailablePort(3002);
  if (gateway !== 3005) console.warn(`[desktop] port 3005 occupied; using ${gateway} for gateway`);
  if (r !== 3001) console.warn(`[desktop] port 3001 occupied; using ${r} for r-server`);
  if (python !== 3004) console.warn(`[desktop] port 3004 occupied; using ${python} for py-server`);
  if (plumber !== 8787) console.warn(`[desktop] port 8787 occupied; using ${plumber} for plumber`);
  if (renderer && renderer !== 3002) console.warn(`[desktop] port 3002 occupied; using ${renderer} for renderer`);
  return { gateway, r, python, plumber, renderer };
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

function publishAgentWorkbenchFlags() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(AGENT_WORKBENCH_FLAG_CHANNEL, {
    extraRenderers: agentWorkbenchFlags.extraRenderers === true,
  });
}

// BioF3 owns local backend ports and must run as a single application
// instance. A repeated launch focuses the existing window instead of starting
// another R/Python service stack.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

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
        port: Number(process.env.BIOF3_RENDERER_PORT || 3002),
        baseUrl: "/",
        label: "spa-server",
        spaFallback: true,
        fallbackToRandomPort: false,
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
    // Self-drawn traffic-light buttons in TitleBar.tsx — see src/main.js comments
    // around setupWindowIpc() for the IPC contract (window:minimize/maximize/close).
    // Frameless on every platform so the renderer owns the window controls; on macOS
    // TitleBar draws the Cursor-style grey circular capsule (not the native OS lights),
    // on Windows/Linux it draws the square WindowControls.
    frame: false,
    backgroundColor: "#1f2330",
    // Mac fullscreen support: enable native fullscreen behavior
    // fullscreenable: true allows the green button and Cmd+Ctrl+F to enter true fullscreen
    // simpleFullScreen: false uses the native macOS fullscreen transition (hides menu bar)
    fullscreenable: true,
    fullscreen: false,
    simpleFullScreen: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: true,
      webSecurity: true,
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
    const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
    const isMacWindowShortcut =
      process.platform === "darwin" &&
      input.meta &&
      !input.control &&
      !input.alt &&
      !input.shift;

    if (isMacWindowShortcut && key === "w") {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      return;
    }
    if (isMacWindowShortcut && key === "m") {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
      return;
    }

    const isReloadKey =
      key === "r" &&
      (input.meta || input.control) &&
      !input.alt;
    if (!isReloadKey) return;
    event.preventDefault();
    if (input.shift) {
      console.log("[desktop] hard reload requested");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
      }
      return;
    }
    console.log("[desktop] soft refresh requested");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("app:soft-refresh");
    }
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
    publishAgentWorkbenchFlags();
  });

  // macOS 焦点诊断。开发启动器通过 LaunchServices 获取 GUI 会话；这里只
  // 记录窗口状态，不能延迟抢焦点，否则用户已切到其他应用时会被强制拉回。
  if (process.platform === "darwin") {
    const windowForFocusDiagnostics = mainWindow;
    windowForFocusDiagnostics.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        if (!windowForFocusDiagnostics.isDestroyed()) {
          console.log(
            "[focus] isKeyWindow after load:",
            typeof windowForFocusDiagnostics.isKeyWindow === "function"
              ? windowForFocusDiagnostics.isKeyWindow()
              : "n/a",
            "isFocused:",
            windowForFocusDiagnostics.isFocused(),
          );
        }
      }, 500);
    });
  }

  const windowForEvents = mainWindow;
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Forward maximize/unmaximize state to the renderer so the self-drawn
  // window control buttons can swap their glyph (single square ↔ double square).
  const publishMaximizedState = (isMaximized) => {
    if (
      (typeof windowForEvents.isDestroyed === "function" &&
        windowForEvents.isDestroyed()) ||
      (typeof windowForEvents.webContents?.isDestroyed === "function" &&
        windowForEvents.webContents.isDestroyed())
    ) {
      return;
    }
    windowForEvents.webContents.send(
      "window:maximize-changed",
      isMaximized,
    );
  };
  windowForEvents.on("maximize", () => publishMaximizedState(true));
  windowForEvents.on("unmaximize", () => publishMaximizedState(false));

  // Mac fullscreen event handlers — sync state to renderer for UI consistency
  windowForEvents.on("enter-full-screen", () => {
    if (!windowForEvents.isDestroyed() && windowForEvents.webContents && !windowForEvents.webContents.isDestroyed()) {
      windowForEvents.webContents.send("window:fullscreen-changed", true);
    }
  });
  windowForEvents.on("leave-full-screen", () => {
    if (!windowForEvents.isDestroyed() && windowForEvents.webContents && !windowForEvents.webContents.isDestroyed()) {
      windowForEvents.webContents.send("window:fullscreen-changed", false);
    }
  });
}

function setupAgentWorkbenchFlagsIpc() {
  ipcMain.handle(AGENT_WORKBENCH_FLAG_CHANNEL, (event, value) => {
    if (event?.sender !== mainWindow?.webContents) return { ok: false, extraRenderers: agentWorkbenchFlags.extraRenderers, error: 'unauthorized' };
    agentWorkbenchFlags.extraRenderers = value === true;
    publishAgentWorkbenchFlags();
    return { ok: true, extraRenderers: agentWorkbenchFlags.extraRenderers };
  });
}

// ── IPC：窗口控制（配合 frame:false 自定义标题栏）──────────────
function setupWindowIpc() {
  const resolveWindowForSender = (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    return event?.sender === mainWindow.webContents ? mainWindow : null;
  };

  ipcMain.on("window:minimize", (event) => {
    resolveWindowForSender(event)?.minimize();
  });
  ipcMain.on("window:maximize", (event) => {
    const targetWindow = resolveWindowForSender(event);
    if (!targetWindow) return;
    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
  });
  ipcMain.on("window:close", (event) => {
    resolveWindowForSender(event)?.close();
  });
  ipcMain.handle("window:isMaximized", (event) => {
    const targetWindow = resolveWindowForSender(event);
    return targetWindow ? targetWindow.isMaximized() === true : false;
  });

  // Fullscreen IPC (Mac fullscreen support)
  ipcMain.handle("window:isFullScreen", (event) => {
    const targetWindow = resolveWindowForSender(event);
    return targetWindow ? targetWindow.isFullScreen() : false;
  });
  ipcMain.on("window:toggleFullScreen", (event) => {
    const targetWindow = resolveWindowForSender(event);
    if (targetWindow) {
      targetWindow.setFullScreen(!targetWindow.isFullScreen());
    }
  });

  // 重启应用 —— 装完 R/Python 运行时后必须整体重启才生效：
  // BIOF3_R_HOME 等 env 在启动阶段（resolveRuntime）就固化了，
  // 单独重启 r-server 子进程仍会读到旧的空值。
  ipcMain.handle("app:relaunch", async () => {
    try {
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC：AI 设置 ───────────────────────────────────────────────
// ── IPC：计算执行配置 ─────────────────────────────────────────
// ── IPC：M2-3 可选错误遥测（V3）─────────────────────────────────
// 默认关闭；用户在设置页主动开启后才会上报。payload 仅含 category/version/摘要。
// ── IPC：插件管理 ──────────────────────────────────────────────


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
    // dev mode also allows 127.0.0.1:* so renderer health probes to
    // gateway(:3005) / py-server(:3004) / r-server(:3001) hit BOTH
    // `localhost` and `127.0.0.1` forms without CSP violations.
    const localNet = isDevMode
      ? "http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* "
      : "http://localhost:* ws://localhost:* ";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
            scriptSrc +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob: http://localhost:* ; " +
            "connect-src 'self' " + localNet + "; " +
            "frame-src 'self' " + localNet + "; " +
            "font-src 'self' data: ; " +
            "worker-src 'self' blob: ; " +
            "object-src 'none';",
        ],
      },
    });
  });
  console.log(
    isDevMode
      ? "[desktop] CSP dev mode (Vite React refresh inline preamble allowed; 127.0.0.1:* whitelisted)"
      : "[desktop] CSP hardened (unsafe-eval disabled)",
  );
}

// ── IPC：Runtime 状态查询 ──────────────────────────────────────
// ── IPC：M2-7 按需启停 py-server / plumber ──────────────────────
// 前端在用 Python 工具前调 biof3Desktop.py.start()，用完调 .stop()；
// plumber 在重绘前调 .start()。未调用时 5min idle 自动 stop。
// ── IPC：macOS 小团队更新（OSS 清单 + 已校验 DMG）─────────────
// ── IPC：文件对话框（preload 暴露的 files.saveDialog/openDialog）─────────
// ── IPC：诊断日志导出 / 数据备份（M2-8）─────────────────────────

// ── IPC：数据目录管理（卸载数据保留）──────────────────────────
// 用户可能在操作系统卸载应用后仍想保留 ~/Documents/BioF3-Local/ 数据，
// 或主动清理。这里提供查看数据目录大小 + 在文件管理器中打开的能力。
// ── IPC：终端/日志面板 ───────────────────────────────────────

// ── IPC：Skills 工作流页面（UI-157 PHASE 1 桥接）─────────────────
// 委托 core/shared-backend/skills-sdk.js 的 SkillsSDK 单例，
// 同时维护一份 executionId → SkillRuntime 引用 + 最近一次 checkpoint
// 快照，通过 setInterval(1000) diff 合成 skills:progress 推送。
// （workflow-engine.js / skill-runtime.js 零 EventEmitter，
//   合成 progress 必须在 main 进程侧做。）
// BLOCK-4 H3：SkillRuntime 9 状态 → UI 4 状态（pending/running/completed/failed）
//   状态映射表见 src/_mapSkillRuntimeStatus.js（独立模块，便于 plain Node 单测）；
//   cancelled 简化为 failed（4 状态枚举硬约束）；UI 区分"取消"vs"失败"由
//   下游组件按 status + cancelledFlag 渲染。
let skillsSDK = null;
const _activeSkillRuntimes = new Map(); // executionId → SkillRuntime
const _lastCheckpointCount = new Map(); // executionId → number
let _skillsProgressTimer = null;

function _getSkillsSDK() {
  if (skillsSDK) return skillsSDK;
  try {
    const sdkMod = require(resolveCore("shared-backend", "skills-sdk.js"));
    const engineMod = require(resolveCore("shared-backend", "workflow-engine.js"));
    // BLOCK-4 C2 注释：createDefaultSDK 是 skills-sdk.js 顶层高层封装（可能含发现 +
    // registry 默认植入），createSkillsSDK 是低层工厂（纯 construct 不预填）。
    // 当前优先用 createDefaultSDK（已在 v1.0 PHASE 1 验证）；createSkillsSDK 是 fallback。
    // 两个函数的最终"基线 SDK 实例"都基于 CoreSDK；但 pluginManager / workflowEngine
    // 等扩展字段由本函数手工注入（见下文 `sdk.workflowEngine = ...`），与 core 内部
    // 工件无关。
    const { createSkillsSDK, createDefaultSDK } = sdkMod;
    const { createWorkflowEngine } = engineMod;
    const base = createDefaultSDK ? createDefaultSDK() : createSkillsSDK();
    const sdk = base;
    sdk.workflowEngine = createWorkflowEngine({ sdk: base });
    skillsSDK = sdk;
    console.log("[desktop] skills SDK initialized");
    return skillsSDK;
  } catch (e) {
    console.warn("[desktop] skills SDK init failed:", e.message);
    return null;
  }
}

function _publishSkillProgress(executionId, payload) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  try {
    mainWindow.webContents.send("skills:progress", { executionId, ...payload });
  } catch (e) {
    // BLOCK-3 P2 B2: webContents.send 抛错（如主窗口正关闭）不应冒泡到 poller tick
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[desktop] skills progress publish failed for ${executionId}:`, e && e.message);
    }
  }
}

function _stopSkillsProgressPollerIfIdle() {
  // BLOCK-3 P2 A2: 最后一个 execution 终止后停止 poller，避免空转
  if (_skillsProgressTimer && _activeSkillRuntimes.size === 0) {
    clearInterval(_skillsProgressTimer);
    _skillsProgressTimer = null;
  }
}

function _startSkillsProgressPoller() {
  if (_skillsProgressTimer) return;
  _skillsProgressTimer = setInterval(() => {
    for (const [executionId, runtime] of _activeSkillRuntimes.entries()) {
      try {
        const execCtx = typeof runtime.getExecutionStatus === "function"
          ? runtime.getExecutionStatus(executionId)
          : null;
        if (!execCtx) continue;
        const checkpoints = Array.isArray(execCtx.checkpoints) ? execCtx.checkpoints : [];
        const lastCount = _lastCheckpointCount.get(executionId) || 0;
        if (checkpoints.length !== lastCount) {
          _lastCheckpointCount.set(executionId, checkpoints.length);
          _publishSkillProgress(executionId, {
            status: _mapSkillRuntimeStatus(execCtx.status),
            checkpoints: checkpoints.slice(),
          });
        }
        // 终态自清
        if (["complete", "failed", "cancelled"].includes(execCtx.status)) {
          _activeSkillRuntimes.delete(executionId);
          _lastCheckpointCount.delete(executionId);
        }
      } catch {}
    }
    // BLOCK-3 P2 A2: 每 tick 检查是否需要停止
    _stopSkillsProgressPollerIfIdle();
  }, 1000);
}

function _resolveSkillsIpcWindow(event) {
  // BLOCK-3 P1 B1/F1: 守 sender，对齐 setupAgentWorkbenchFlagsIpc L1162 模式
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return event?.sender === mainWindow.webContents ? mainWindow : null;
}

function setupSkillsIpc() {
  // 规整化 bridge 返回值，保证前端 contract 严格 `{ ok, ... }`
  ipcMain.handle("skills:discover", async (event) => {
    if (!_resolveSkillsIpcWindow(event)) return { ok: false, error: "unauthorized" };
    try {
      const sdk = _getSkillsSDK();
      if (!sdk) return { ok: false, error: "skills SDK unavailable" };
      const skills = sdk.listSkills();
      return { ok: true, skills };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("skills:execute", async (event, skillId, params) => {
    if (!_resolveSkillsIpcWindow(event)) return { ok: false, error: "unauthorized" };
    try {
      const sdk = _getSkillsSDK();
      if (!sdk) return { ok: false, error: "skills SDK unavailable" };
      const runtimeMod = require(resolveCore("shared-backend", "skill-runtime.js"));
      const { createSkillRuntime } = runtimeMod;
      // 取得 manifest
      const skill = sdk.getSkill(skillId);
      if (!skill) return { ok: false, error: `Skill not found: ${skillId}` };
      const runtime = createSkillRuntime(skill, {
        registry: sdk.registry,
        pluginManager: sdk.pluginManager,
        workflowRuntime: sdk.workflowEngine,
        capabilityProvisioning: sdk.capabilityProvisioning,
      });
      // 启动后台执行（不 await），把 runtime 登记到 _activeSkillRuntimes
      // 让 poller 能通过 getExecutionStatus 拉快照
      const executionId = `sre_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const paramsObj = (params && typeof params === "object") ? params : {};
      const promise = runtime.execute(paramsObj, { executionId })
        .then((result) => {
          // 终态时显式 publish 一次最终快照
          const status = result && result.success ? "complete" : "failed";
          _publishSkillProgress(executionId, {
            status,
            checkpoints: [],
            result: result ? result.result : null,
            error: result && !result.success ? (result.error?.message || String(result.error)) : null,
          });
          // BLOCK-3 P2 A3: 终态 publish 后立即清理 activeRuntimes，
          // 不再等下个 poller tick（最坏情况节省 1s）
          _activeSkillRuntimes.delete(executionId);
          _lastCheckpointCount.delete(executionId);
          _stopSkillsProgressPollerIfIdle();
          return result;
        })
        .catch((err) => {
          _publishSkillProgress(executionId, {
            status: "failed",
            checkpoints: [],
            error: err && err.message ? err.message : String(err),
          });
          // BLOCK-3 P2 A3: 失败终态同样立即清理
          _activeSkillRuntimes.delete(executionId);
          _lastCheckpointCount.delete(executionId);
          _stopSkillsProgressPollerIfIdle();
          throw err;
        });
      promise.catch(() => {}); // 阻止未捕获 rejection
      _activeSkillRuntimes.set(executionId, runtime);
      _lastCheckpointCount.set(executionId, 0);
      _startSkillsProgressPoller();
      // BLOCK-5 E1-b: 立即 publish 初始 status: 'pending'（避免 poller 首次 tick
      //  1s 延迟；前端可立即在 store 标记为 running 状态）
      _publishSkillProgress(executionId, {
        status: 'pending',
        checkpoints: [],
      });
      return { ok: true, executionId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("skills:getExecution", async (event, executionId) => {
    if (!_resolveSkillsIpcWindow(event)) return { ok: false, error: "unauthorized" };
    try {
      if (!executionId) return { ok: false, error: "executionId required" };
      const runtime = _activeSkillRuntimes.get(executionId);
      if (!runtime) {
        return { ok: false, error: `Unknown execution: ${executionId}` };
      }
      const execCtx = runtime.getExecutionStatus(executionId);
      if (!execCtx) {
        return { ok: false, error: `Execution not found: ${executionId}` };
      }
      return {
        ok: true,
        execution: {
          executionId: execCtx.executionId,
          skillId: execCtx.skillId,
          status: _mapSkillRuntimeStatus(execCtx.status),
          startedAt: execCtx.startedAt,
          completedAt: execCtx.completedAt,
          result: execCtx.result,
          error: execCtx.error
            ? (execCtx.error.message || String(execCtx.error))
            : undefined,
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("skills:cancel", async (event, executionId) => {
    if (!_resolveSkillsIpcWindow(event)) return { ok: false, cancelled: false, error: "unauthorized" };
    try {
      if (!executionId) return { ok: false, cancelled: false, error: "executionId required" };
      const runtime = _activeSkillRuntimes.get(executionId);
      if (!runtime) {
        return { ok: false, cancelled: false, error: `Unknown execution: ${executionId}` };
      }
      runtime.cancel(executionId);
      // 终态自清在下一个 poller tick 自然发生
      return { ok: true, cancelled: true };
    } catch (e) {
      return { ok: false, cancelled: false, error: e.message };
    }
  });
}

// _mapSkillRuntimeStatus 已提取到 src/_mapSkillRuntimeStatus.js（G6 单测需要）。

// ── IPC：Harness Capability Provisioning — Stage 3 M1 ─────────
// 只读：让设置页"计算与数据"分类展示 Harness 自备了哪些运行时/包。
// 写入动作（provision/remove）由 Harness 编排层内部完成，不通过前端 IPC
// 直接触发，以保持 D8 透明进度和 C-03 安全确认边界。
// ── 应用生命周期 ───────────────────────────────────────────────
async function main() {
  const backendPorts = await selectBackendPorts();
  // BLOCK-9.1 PHASE 3: setupDesktopEnv moved to src/main/env-coordinator.js
  const { setupDesktopEnv } = require("./main/env-coordinator");
  setupDesktopEnv(backendPorts);

  // M1-4 (H3)：启动 r-server 前跑 db migration，防升级 schema 错乱。
  // Migration must use the same selected Node boundary as r-server. Loading
  // better-sqlite3 inside Electron would require a different native ABI and
  // would break the system-Node copy used by Harness/backend processes.
  try {
    const migDir = path.join(__dirname, "migrations");
    const dbPath = process.env.BIOF3_DB_PATH;
    if (dbPath) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const migrationEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
      if (IS_DEV) {
        migrationEnv.BIOF3_BETTER_SQLITE3_ROOT = resolveCore("r-server");
      } else {
        delete migrationEnv.BIOF3_BETTER_SQLITE3_ROOT;
      }
      const migration = spawnSync(
        NODE_BIN,
        [path.join(__dirname, "migration-runner.js"), dbPath, migDir],
        {
          cwd: PROJECT_ROOT,
          encoding: "utf8",
          timeout: 30000,
          env: migrationEnv,
        },
      );
      if (migration.error) throw migration.error;
      if (migration.status !== 0) {
        throw new Error((migration.stderr || migration.stdout || "migration child failed").trim());
      }
      const migrationOutput = String(migration.stdout || "").trim();
      if (migrationOutput) console.log(migrationOutput);
    }
  } catch (e) {
    console.error("[desktop] migration failed:", e.message);
    // 不阻断启动——r-server 的 initSchema() 仍会兜底建表
  }

  // 1. 启动后端服务
  // r-server 常驻；py-server 也在应用启动时预热，减少首次使用等待。
  // Gateway 协调层统一入口，在 r-server 之后启动。
  // BLOCK-9.1 PHASE 4: startRServer/startGateway/startPyServer moved
  // to src/main/backend-proc-manager.js. main.js orchestrates via
  // named imports.
  const {
    startRServer,
    startGateway,
    startPyServer,
    stopPyServer,
    startPlumber,
    stopPlumber,
    getProcs,
    getLogDir,
    flushLogs,
    readLogTail,
  } = require("./main/backend-proc-manager");
  await startRServer();
  await startGateway();
  // plumber 仍按需启停 - 只在 FigCode 重绘时通过 IPC plumber:start 触发

  // 2. 加载已安装插件
  await loadInstalledPlugins();

  // 3. 启动 Python 后端（热启动）
  await startPyServer("boot");

  // 4. 内容增量同步（后台）
  startContentSync();

  // 5. 设置 IPC
  setupWindowIpc();
  setupAgentWorkbenchFlagsIpc();
  // BLOCK-9.1 PHASE 1: low-risk setup functions moved to src/ipc/*.js
  const { setupTelemetryIpc } = require("./ipc/telemetry");
  const { setupHarnessCapabilitiesIpc } = require("./ipc/harness-capabilities");
  const { setupComputeSettingsIpc } = require("./ipc/compute-settings");
  const { setupAiSettingsIpc } = require("./ipc/ai-settings");
  const { setupFileDialogIpc } = require("./ipc/file-dialog");
  const { setupDataManagementIpc } = require("./ipc/data-management");
  const { setupBranchIpc } = require("./ipc/branch-handlers");
  const { setupResultIpc } = require("./ipc/result-handlers");
  setupAiSettingsIpc();
  setupComputeSettingsIpc();
  setupTelemetryIpc();
  setupHarnessCapabilitiesIpc();
  setupFileDialogIpc({ mainWindow });
  setupDataManagementIpc();
  setupBranchIpc();
  setupResultIpc();
  // BLOCK-9.1 PHASE 2: mid-risk setup functions with dependency injection
  const { setupRuntimeIpc } = require("./ipc/runtime-status");
  const { setupBackendLifecycleIpc } = require("./ipc/backend-lifecycle");
  const { setupPluginIpc } = require("./ipc/plugin");
  const { setupAutoUpdateIpc } = require("./ipc/auto-update");
  setupPluginIpc();
  // Capture procs as a snapshot — IPC handlers fetch a fresh
  // snapshot at invocation time via getProcs() from backend-proc-manager.
  const _procsSnapshot = getProcs();
  setupRuntimeIpc(_procsSnapshot);
  setupBackendLifecycleIpc({ startPyServer, stopPyServer, startPlumber, stopPlumber });
  // BLOCK-9.1 PHASE 4: high-risk setup functions with log/proc injection
  const { setupTerminalIpc } = require("./ipc/terminal");
  const { setupDiagnosticIpc } = require("./ipc/diagnostic");
  setupTerminalIpc({
    mainWindow,
    getProcs,
    getLogDir,
    readLogTail,
  });
  setupAutoUpdateIpc({ mainWindow });
  setupDiagnosticIpc({ mainWindow, getLogDir, flushLogs });
  if (typeof setupFigcodeIpc === "function") {
    setupFigcodeIpc();
  }
  setupSkillsIpc();

  // 6. 创建窗口
  // M1-2：CSP 加固——禁用 unsafe-eval，限制资源来源到 self + localhost（后端/SSE/dev server）
  setupCsp();

  // 7. 创建窗口
  await createWindow();
}

app.whenReady().then(main);

app.on("window-all-closed", () => {
  // Product contract: closing BioF3 stops the local application and every
  // backend it owns. Do not keep R/Python services resident on macOS.
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow().catch((err) => {
      console.error("[desktop] window recreation failed:", err);
    });
  }
});

app.on("before-quit", () => {
  // BLOCK-9.1 PHASE 4: backend proc handles moved to
  // src/main/backend-proc-manager.js. Import them here for the
  // before-quit shutdown sequence.
  const { getProcs } = require("./main/backend-proc-manager");
  const { rServerSupervisor, stopPlumber } = require("./main/backend-proc-manager");
  stopPlumber("app-quit");
  rServerSupervisor.shutdown("app-quit");
  const { gatewayProc, pyServerProc, plumberProc } = getProcs();
  for (const proc of [gatewayProc, pyServerProc, plumberProc]) {
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
  }
});

// ── Application Menu with Fullscreen Support ──────────────────
function setupAppMenu() {
  if (process.platform !== "darwin") return;

  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Enter Full Screen",
          accelerator: "Cmd+Ctrl+F",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.setFullScreen(!win.isFullScreen());
            }
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Initialize application menu
setupAppMenu();
