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

const {
  getNodeLocator,
  getRuntimeBinCandidates,
  getRuntimeBinName,
  getOpenShellPlan,
  getSessionShellSpec,
  getBuiltInPluginsDir,
} = require("./platform-compat");

// SUB-15.1 PHASE 1 imports (BLOCK-9.1 style)
const { parseAgentWorkbenchFlags, AGENT_WORKBENCH_FLAG_CHANNEL, setupAgentWorkbenchFlagsIpc } = require("./ipc/workbench-flags.js");
const { resolveCoreRoot, resolveResource, resolveCore, reserveAvailablePort, isDevMode, rendererDevUrl, BASE_R_PACKAGES, BASE_PY_PACKAGES, NODE_BIN, IS_DEV, PROJECT_ROOT } = require("./main/core-utils.js");
const { setupCsp } = require("./main/csp-config.js");
const { _resolveSkillsIpcWindow } = require("./ipc/skills-window.js");

// SUB-15.1 PHASE 2 imports — medium-risk functions extracted to src/main/_*.js
const { _getSkillsSDK, _publishSkillProgress, _stopSkillsProgressPollerIfIdle, _startSkillsProgressPoller } = require("./main/_skills-runtime.js");
const { selectBackendPorts } = require("./main/_backend-ports.js");
const { loadInstalledPlugins } = require("./main/_plugin-loader.js");
const { startContentSync } = require("./main/_content-sync.js");
const { publishAgentWorkbenchFlags } = require("./main/_agent-flags.js");
const { setupWindowIpc } = require("./main/_window-ipc.js");
const { setupAppMenu } = require("./main/_app-menu.js");
const { startSpaServer } = require("./main/_spa-server.js");
const { createWindow } = require("./main/_window-create.js");

// Guard: core-utils.js requires Electron app; skip if not in Electron env
let agentWorkbenchFlags = { extraRenderers: false };
try {
  agentWorkbenchFlags = parseAgentWorkbenchFlags();
} catch { /* ignore during --check */ }

// runtimePathsModule 已不再需要（原 consumer 已移除）

// ── Path resolution helpers (re-exported from core-utils.js for local use) ──

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
// 打包模式：desktop 资源在 process.resourcesPath，core 资源在 process.resourcesPath/core
// IS_DEV / PROJECT_ROOT / resolveCoreRoot / resolveResource / resolveCore
// 已提取到 src/main/core-utils.js

// ── 解析用来跑 r-server/py-server 的 node 可执行文件 ────────────
// resolveNodeBin / NODE_BIN 已提取到 src/main/core-utils.js

// ── 基础 Runtime 自带包集合 ─────────────────────────────────────
// BASE_R_PACKAGES / BASE_PY_PACKAGES 已提取到 src/main/core-utils.js

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
// reserveAvailablePort 已提取到 src/main/core-utils.js

// selectBackendPorts moved to src/main/_backend-ports.js (SUB-15.1 PHASE 2)

// loadInstalledPlugins moved to src/main/_plugin-loader.js (SUB-15.1 PHASE 2)

// startContentSync moved to src/main/_content-sync.js (SUB-15.1 PHASE 2)

// publishAgentWorkbenchFlags moved to src/main/_agent-flags.js (SUB-15.1 PHASE 2)

// ── 主窗口（shared ref via getter/setter）──────────────────────────
let _mainWindow = null;
const getMainWindow = () => _mainWindow;
const setMainWindow = (w) => { _mainWindow = w; };
// mainWindow stays as a compatibility alias for the single-instance handler
// (PHASE 4 will handle the hasSingleInstanceLock + second-instance handler extraction)
const mainWindow = { get isDestroyed() { return _mainWindow == null || _mainWindow.isDestroyed(); }, get webContents() { return _mainWindow?.webContents; }, get isMinimized() { return _mainWindow?.isMinimized(); }, get isFocused() { return _mainWindow?.isFocused(); }, restore() { _mainWindow?.restore(); }, show() { _mainWindow?.show(); }, focus() { _mainWindow?.focus(); } };

// BioF3 owns local backend ports and must run as a single application
// instance. A repeated launch focuses the existing window instead of starting
// another R/Python service stack.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

// createWindow extracted to src/main/_window-create.js (SUB-15.1 PHASE 3)
// createWindow remains as the async entry point, delegating to the extracted module.

// setupWindowIpc moved to src/main/_window-ipc.js (SUB-15.1 PHASE 2)

// ── IPC：AI 设置 ───────────────────────────────────────────────
// ── IPC：计算执行配置 ─────────────────────────────────────────
// ── IPC：M2-3 可选错误遥测（V3）─────────────────────────────────
// 默认关闭；用户在设置页主动开启后才会上报。payload 仅含 category/version/摘要。
// ── IPC：插件管理 ──────────────────────────────────────────────


// ── M1-2：CSP 加固 ─────────────────────────────────────────────
// setupCsp 已提取到 src/main/csp-config.js

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

// Skills runtime state (SUB-15.1 PHASE 2: stays here as shared mutable refs)
const _skillsRefs = {
  skillsSDKRef: { current: null },
  activeRuntimesRef: { current: new Map() }, // executionId → SkillRuntime
  lastCheckpointCountRef: { current: new Map() }, // executionId → number
  skillsProgressTimerRef: { current: null },
};

// _getSkillsSDK / _publishSkillProgress / _stopSkillsProgressPollerIfIdle /
// _startSkillsProgressPoller moved to src/main/_skills-runtime.js (SUB-15.1 PHASE 2)

// _resolveSkillsIpcWindow already imported from src/ipc/skills-window.js (SUB-15.1 PHASE 1)

function setupSkillsIpc() {
  // Skills runtime context passed to all helpers in _skills-runtime.js
  const _skillsCtx = {
    resolveCore,
    refs: _skillsRefs,
  };

  // 规整化 bridge 返回值，保证前端 contract 严格 `{ ok, ... }`
  ipcMain.handle("skills:discover", async (event) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    try {
      const sdk = _getSkillsSDK({ ..._skillsCtx, getMainWindow: () => mainWindow });
      if (!sdk) return { ok: false, error: "skills SDK unavailable" };
      const skills = sdk.listSkills();
      return { ok: true, skills };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("skills:execute", async (event, skillId, params) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    try {
      const sdk = _getSkillsSDK({ ..._skillsCtx, getMainWindow: () => mainWindow });
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
      const { _mapSkillRuntimeStatus } = require("../_mapSkillRuntimeStatus");
      const _publish = (execId, payload) =>
        _publishSkillProgress({ getMainWindow: () => mainWindow }, execId, payload);
      const promise = runtime.execute(paramsObj, { executionId })
        .then((result) => {
          // 终态时显式 publish 一次最终快照
          const status = result && result.success ? "complete" : "failed";
          _publish(executionId, {
            status,
            checkpoints: [],
            result: result ? result.result : null,
            error: result && !result.success ? (result.error?.message || String(result.error)) : null,
          });
          // BLOCK-3 P2 A3: 终态 publish 后立即清理 activeRuntimes，
          // 不再等下个 poller tick（最坏情况节省 1s）
          _skillsRefs.activeRuntimesRef.current.delete(executionId);
          _skillsRefs.lastCheckpointCountRef.current.delete(executionId);
          _stopSkillsProgressPollerIfIdle({ refs: _skillsRefs });
          return result;
        })
        .catch((err) => {
          _publish(executionId, {
            status: "failed",
            checkpoints: [],
            error: err && err.message ? err.message : String(err),
          });
          // BLOCK-3 P2 A3: 失败终态同样立即清理
          _skillsRefs.activeRuntimesRef.current.delete(executionId);
          _skillsRefs.lastCheckpointCountRef.current.delete(executionId);
          _stopSkillsProgressPollerIfIdle({ refs: _skillsRefs });
          throw err;
        });
      promise.catch(() => {}); // 阻止未捕获 rejection
      _skillsRefs.activeRuntimesRef.current.set(executionId, runtime);
      _skillsRefs.lastCheckpointCountRef.current.set(executionId, 0);
      _startSkillsProgressPoller({ getMainWindow: () => mainWindow, refs: _skillsRefs });
      // BLOCK-5 E1-b: 立即 publish 初始 status: 'pending'（避免 poller 首次 tick
      //  1s 延迟；前端可立即在 store 标记为 running 状态）
      _publish(executionId, {
        status: 'pending',
        checkpoints: [],
      });
      return { ok: true, executionId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("skills:getExecution", async (event, executionId) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    try {
      if (!executionId) return { ok: false, error: "executionId required" };
      const runtime = _skillsRefs.activeRuntimesRef.current.get(executionId);
      if (!runtime) {
        return { ok: false, error: `Unknown execution: ${executionId}` };
      }
      const { _mapSkillRuntimeStatus } = require("../_mapSkillRuntimeStatus");
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
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, cancelled: false, error: "unauthorized" };
    try {
      if (!executionId) return { ok: false, cancelled: false, error: "executionId required" };
      const runtime = _skillsRefs.activeRuntimesRef.current.get(executionId);
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

// _mapSkillRuntimeStatus already extracted to src/_mapSkillRuntimeStatus.js

// ── IPC：Harness Capability Provisioning — Stage 3 M1 ─────────
// 只读：让设置页"计算与数据"分类展示 Harness 自备了哪些运行时/包。
// 写入动作（provision/remove）由 Harness 编排层内部完成，不通过前端 IPC
// 直接触发，以保持 D8 透明进度和 C-03 安全确认边界。
// ── 应用生命周期 ───────────────────────────────────────────────
async function main() {
  const backendPorts = await selectBackendPorts({ reserveAvailablePort, isDevMode });
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
  await loadInstalledPlugins({ require });

  // 3. 启动 Python 后端（热启动）
  await startPyServer("boot");

  // 4. 内容增量同步（后台）
  startContentSync({ require });

  // 5. 设置 IPC
  setupWindowIpc({ ipcMain, process, app, getMainWindow: () => mainWindow });
  setupAgentWorkbenchFlagsIpc({
    getMainWindow: () => mainWindow,
    getAgentWorkbenchFlags: () => agentWorkbenchFlags,
    publishAgentWorkbenchFlags,
  });
  // BLOCK-9.1 PHASE 1: low-risk setup functions moved to src/ipc/*.js
  const { setupTelemetryIpc } = require("./ipc/telemetry");
  const { setupHarnessCapabilitiesIpc } = require("./ipc/harness-capabilities");
  const { setupComputeSettingsIpc } = require("./ipc/compute-settings");
  const { setupAiSettingsIpc } = require("./ipc/ai-settings");
  const { setupFileDialogIpc } = require("./ipc/file-dialog");
  const { setupDataManagementIpc } = require("./ipc/data-management");
  const { setupBranchIpc } = require("./ipc/branch-handlers");
  const { setupResultIpc } = require("./ipc/result-handlers");
  setupAiSettingsIpc({ mainWindow: () => mainWindow });
  setupComputeSettingsIpc();
  setupTelemetryIpc();
  setupHarnessCapabilitiesIpc();
  setupFileDialogIpc({ mainWindow });
  setupDataManagementIpc();
  setupBranchIpc({ mainWindow: () => mainWindow });
  setupResultIpc({ mainWindow: () => mainWindow });
  // BLOCK-9.1 PHASE 2: mid-risk setup functions with dependency injection
  const { setupRuntimeIpc } = require("./ipc/runtime-status");
  const { setupBackendLifecycleIpc } = require("./ipc/backend-lifecycle");
  const { setupPluginIpc } = require("./ipc/plugin");
  const { setupAutoUpdateIpc } = require("./ipc/auto-update");
  setupPluginIpc({ mainWindow: () => mainWindow });
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

  // 6. CSP 加固——禁用 unsafe-eval，限制资源来源到 self + localhost（后端/SSE/dev server）
  setupCsp({ isDevMode });

  // 7. 创建窗口
  // createWindow extracted to src/main/_window-create.js (SUB-15.1 PHASE 3)
  await createWindow({
    BrowserWindow,
    shell,
    session,
    resolveResource,
    isDevMode,
    rendererDevUrl,
    process,
    getMainWindow,
    setMainWindow,
    publishAgentWorkbenchFlags,
    getAgentWorkbenchFlags: () => agentWorkbenchFlags,
    startSpaServer,
  });
}

app.whenReady().then(main);

app.on("window-all-closed", () => {
  // Product contract: closing BioF3 stops the local application and every
  // backend it owns. Do not keep R/Python services resident on macOS.
  app.quit();
});

app.on("activate", () => {
  if (!getMainWindow()) {
    createWindow({
      BrowserWindow,
      shell,
      session,
      resolveResource,
      isDevMode,
      rendererDevUrl,
      process,
      getMainWindow,
      setMainWindow,
      publishAgentWorkbenchFlags,
      getAgentWorkbenchFlags: () => agentWorkbenchFlags,
      startSpaServer,
    }).catch((err) => {
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

// setupAppMenu moved to src/main/_app-menu.js (SUB-15.1 PHASE 2)

// Initialize application menu
setupAppMenu({ app, BrowserWindow, Menu, process });
