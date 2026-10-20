/**
 * Electron 主进程入口 — Petri 本地桌面版
 *
 * 职责：
 * 1. 设置桌面版本地存储、运行时和用户数据环境变量
 * 2. 启动 petri-server（子进程 spawn，避免原生模块 V8 版本冲突；BLOCK-30 P1 起
 *    无独立 py-server，Python 工具由 petri-server 经执行器注册表本地执行；
 *    BLOCK-51 P3 起 plumber 空壳也已摘除，R 为 tools-executor 单轨）
 * 3. 加载已安装插件
 * 4. 内容增量同步（后台）
 * 5. 创建 webview 窗口加载内嵌静态站
 * 6. 外部链接走系统浏览器
 */
const CHANNELS = require('./ipc/channels');
// BLOCK-101 P0 — 启动 timeline：进程起点锚点必须在主进程模块加载期冻结（main()
// 内懒 require 会把 mainReady 锚点推迟数秒得到 mainReady≈0 的假数字）。
const { PROCESS_START } = require('./ipc/startup-timeline');
void PROCESS_START;

const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  session,
  Menu,
  globalShortcut,
} = require("electron");

// UI-400-1 抓真（2026-09-17）——Windows 原生窗口遮挡追踪对无边框窗口（frame:false）
// 会误报「已遮挡」→ document.visibilityState=hidden → Chromium PDF 查看器在
// hidden frame 冻结渲染（用户实拍 PDF 预览整块空白；窗口明明在前台）。
// VS Code 同款正解：禁用 CalculateNativeWinOcclusion。仅 Windows 生效。
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

require("./platform-compat");

// SUB-15.1 PHASE 1 imports (BLOCK-9.1 style)
const { parseAgentWorkbenchFlags, setupAgentWorkbenchFlagsIpc } = require("./ipc/workbench-flags.js");
const { resolveResource, resolveCore, reserveAvailablePort, isDevMode, rendererDevUrl, NODE_BIN, PROJECT_ROOT } = require("./main/core-utils.js");
const { setupCsp } = require("./main/csp-config.js");
const { _resolveSkillsIpcWindow } = require("./ipc/skills-window.js");
// BLOCK-223 — 退出摘要的终端会话语义（只读计数；模块加载无副作用）
const { getActiveTerminalSessionCount } = require("./ipc/terminal");

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
// SEC-HARDEN — 安全专项收口（AUDIT-LOG 代码复审余项 ③ 附带项）：
// webview 加固（清单 #11/#12）+ 权限默认收紧（清单 #5）。模块加载期即注册
// web-contents-created（必须在任何 webContents 创建之前）；权限策略在
// main() 内 setupDesktopEnv() 之后（受信 origin 环境变量此时才写入）。
const {
  applyPermissionPolicy,
  applyWebContentsHardening,
} = require("./main/security-hardening.js");

// Guard: core-utils.js requires Electron app; skip if not in Electron env
let agentWorkbenchFlags = { extraRenderers: false };
try {
  agentWorkbenchFlags = parseAgentWorkbenchFlags();
} catch { /* ignore during --check */ }

// runtimePathsModule 已不再需要（原 consumer 已移除）

// ── Path resolution helpers (re-exported from core-utils.js for local use) ──

if (process.env.PETRI_ELECTRON_USER_DATA_DIR) {
  try {
    app.setPath("userData", process.env.PETRI_ELECTRON_USER_DATA_DIR);
  } catch (e) {
    console.warn("[desktop] failed to override userData path:", e.message);
  }
}

// BLOCK-100 P1 — 测试实例标记（由 scripts/start-test-instance.sh 注入）：
// 独立 userData 绕单实例锁与用户窗口共存；零 fork 后端、零 migration
// （数据同源 :3001，主实例拥有 DB 生命周期）；窗口离屏可见 + `?test=1` 标记。
const IS_TEST_INSTANCE = process.env.PETRI_TEST_INSTANCE === "1";

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
//   - core 资源（petri-server, shared-backend）内嵌在 desktop 仓根 core/ 下
//     （BLOCK-30 P1：py-server / gateway 已摘除）
// 开发模式：PROJECT_ROOT = desktop 仓根（src/..），CORE_ROOT = PROJECT_ROOT/core
// 打包模式：desktop 资源在 process.resourcesPath，core 资源在 process.resourcesPath/core
// IS_DEV / PROJECT_ROOT / resolveCoreRoot / resolveResource / resolveCore
// 已提取到 src/main/core-utils.js

// ── 解析用来跑后端子进程的 node 可执行文件 ──────────────────────
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
//   1. 用户安装的独立 Runtime（~/Documents/Petri-Local/runtimes/{R|Python}）— 最高优先
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
// BLOCK-51 修复：isDestroyed 由 getter（返回 boolean）改为方法——对齐 Electron BrowserWindow
// API 形态。此前 terminal.js / skills-window.js / diagnostic.js 等按真窗口的
// `isDestroyed()` 方法形式调用，getter 求值得到 boolean 后被当函数调用，
// 抛 "mainWindow.isDestroyed is not a function"（终端场景在 pty onData 异步
// 回调中无 catch，直接导致主进程 Uncaught Exception）。
const mainWindow = { isDestroyed() { return _mainWindow == null || _mainWindow.isDestroyed(); }, get webContents() { return _mainWindow?.webContents; }, isMinimized() { return _mainWindow?.isMinimized(); }, isFocused() { return _mainWindow?.isFocused(); }, restore() { _mainWindow?.restore(); }, show() { _mainWindow?.show(); }, focus() { _mainWindow?.focus(); } };

// Petri owns local backend ports and must run as a single application
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

// ── BLOCK-223 桌面外壳（通知 / 托盘 / 退出摘要）────────────────────
// 退出守卫必须**先于**下方既有 before-quit 消费者注册：否则 preventDefault 之前
// 后端 supervisor / 终端会话已经被关掉，用户点「取消」也回不到运行态。
const { createDesktopShell } = require("./main/desktop-shell");
const desktopShell = createDesktopShell({
  app,
  getMainWindow,
  isTestInstance: IS_TEST_INSTANCE,
  getTerminalSessionCount: getActiveTerminalSessionCount,
  resolveResource,
});
desktopShell.installQuitGuard();

// setupWindowIpc moved to src/main/_window-ipc.js (SUB-15.1 PHASE 2)

// ── IPC：AI 设置 ───────────────────────────────────────────────
// ── IPC：计算执行配置 ─────────────────────────────────────────
// ── IPC：M2-3 可选错误遥测（V3）─────────────────────────────────
// 默认关闭；用户在设置页主动开启后才会上报。payload 仅含 category/version/摘要。
// ── IPC：插件管理 ──────────────────────────────────────────────


// ── M1-2：CSP 加固 ─────────────────────────────────────────────
// setupCsp 已提取到 src/main/csp-config.js

// ── IPC：Runtime 状态查询 ──────────────────────────────────────
// （BLOCK-30 P1：py:start/py:stop 已随 py-server 摘除；
//   BLOCK-51 P3：plumber:start/plumber:stop 已随 plumber 空壳摘除。）
// ── IPC：macOS 小团队更新（OSS 清单 + 已校验 DMG）─────────────
// ── IPC：文件对话框（preload 暴露的 files.saveDialog/openDialog）─────────
// ── IPC：诊断日志导出 / 数据备份（M2-8）─────────────────────────

// ── IPC：数据目录管理（卸载数据保留）──────────────────────────
// 用户可能在操作系统卸载应用后仍想保留 ~/Documents/Petri-Local/ 数据，
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
  ipcMain.handle(CHANNELS.skills.discover, async (event) => {
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

  // BLOCK-177 — 技能治理四通道（停用/卸载/安装信息/重装；动作经 SDK 落 skill-prefs 审计）
  ipcMain.handle(CHANNELS.skills.setDisabled, async (event, args = {}) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    try {
      const sdk = _getSkillsSDK({ ..._skillsCtx, getMainWindow: () => mainWindow });
      if (!sdk) return { ok: false, error: "skills SDK unavailable" };
      const { skillId, disabled, reason } = args || {};
      if (!skillId || typeof skillId !== "string") return { ok: false, error: "skill_id_required" };
      return sdk.setSkillDisabled(skillId, disabled === true, typeof reason === "string" ? reason : undefined);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.skills.uninstall, async (event, args = {}) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    try {
      const sdk = _getSkillsSDK({ ..._skillsCtx, getMainWindow: () => mainWindow });
      if (!sdk) return { ok: false, error: "skills SDK unavailable" };
      const { skillId } = args || {};
      if (!skillId || typeof skillId !== "string") return { ok: false, error: "skill_id_required" };
      return sdk.uninstallSkill(skillId);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.skills.getInstallInfo, async (event, args = {}) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    try {
      const sdk = _getSkillsSDK({ ..._skillsCtx, getMainWindow: () => mainWindow });
      if (!sdk) return { ok: false, error: "skills SDK unavailable" };
      const { skillId } = args || {};
      if (!skillId || typeof skillId !== "string") return { ok: false, error: "skill_id_required" };
      return sdk.getInstallInfo(skillId);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.skills.reinstall, async (event, args = {}) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    try {
      const sdk = _getSkillsSDK({ ..._skillsCtx, getMainWindow: () => mainWindow });
      if (!sdk) return { ok: false, error: "skills SDK unavailable" };
      const { skillId } = args || {};
      if (!skillId || typeof skillId !== "string") return { ok: false, error: "skill_id_required" };
      return sdk.reinstallFromSource(skillId);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // BLOCK-156 D7 — 第三方技能本地目录导入（复刻 pack installFromDialog 先例：主进程对话框+安装一条龙）
  ipcMain.handle(CHANNELS.skills.importDirectory, async (event) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    const result = await dialog.showOpenDialog({
      title: "选择技能目录（含 skill.json）",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }
    const { installSkillFromDir } = require(resolveCore("shared-backend", "skill-registry.js"));
    return installSkillFromDir(result.filePaths[0]);
  });

  // 直路径安装（测试/探针通道；与 importDirectory 共用同一安装函数）
  ipcMain.handle(CHANNELS.skills.importPath, async (event, dir) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    if (!dir || typeof dir !== "string") return { ok: false, error: "dir_required" };
    const { installSkillFromDir } = require(resolveCore("shared-backend", "skill-registry.js"));
    return installSkillFromDir(dir);
  });

  // BLOCK-160 W2 P5（DIST-2）— MCP 配置文件导入（对话框/直路径；逐条 upsert 经
  // CAP-2 加密落盘；坏条目 skipped 诚实列出，不阻断整批）
  ipcMain.handle(CHANNELS.mcpConfig.importDialog, async (event) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    const result = await dialog.showOpenDialog({
      title: "选择 MCP 配置文件（JSON）",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }
    const { importMcpConfigFile } = require(resolveCore("petri-server", "helpers", "mcp-config-import.js"));
    return importMcpConfigFile(result.filePaths[0]);
  });

  ipcMain.handle(CHANNELS.mcpConfig.importPath, async (event, filePath) => {
    if (!_resolveSkillsIpcWindow(() => mainWindow, event)) return { ok: false, error: "unauthorized" };
    if (!filePath || typeof filePath !== "string") return { ok: false, error: "file_path_required" };
    const { importMcpConfigFile } = require(resolveCore("petri-server", "helpers", "mcp-config-import.js"));
    return importMcpConfigFile(filePath);
  });

  ipcMain.handle(CHANNELS.skills.execute, async (event, skillId, params) => {
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

  ipcMain.handle(CHANNELS.skills.getExecution, async (event, executionId) => {
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

  ipcMain.handle(CHANNELS.skills.cancel, async (event, executionId) => {
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
// BLOCK-100 P1 — 测试实例后端就绪轮询：每 1s 探测 /api/health，超时返回 false
//（调用方 fail-fast 弹窗退出，不留「半死测试实例」假通过）。
async function waitForBackendHealthy(port, timeoutMs) {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ok = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) {
        console.log(`[desktop] test instance: backend healthy at :${port}`);
        return true;
      }
    } catch {
      // 探测失败继续轮询
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

// ── 应用生命周期 ───────────────────────────────────────────────
async function main() {
  // BLOCK-101 P0 — D1 口径第二段：whenReady resolve 即 mainReady（进程起点→事件循环就绪）
  require("./ipc/startup-timeline").markStartup("mainReady");
  // CK-10 — 漏斗事件示范接线（fire-and-forget，遥测默认关零开销）
  try { require("./telemetry").reportEvent("app_started").catch(() => {}); } catch { /* 遥测永不阻塞启动 */ }
  // BLOCK-100 P1 — 测试实例直连既有后端，不做端口抢占：主实例已占 3001，
  // reserveAvailablePort(3001) 会误选 3002 指错后端。端口以 R_SERVER_PORT 为准。
  const backendPorts = IS_TEST_INSTANCE
    ? { r: Number(process.env.R_SERVER_PORT) || 3001, renderer: null }
    : await selectBackendPorts({ reserveAvailablePort, isDevMode });
  // BLOCK-9.1 PHASE 3: setupDesktopEnv moved to src/main/env-coordinator.js
  const { setupDesktopEnv } = require("./main/env-coordinator");
  setupDesktopEnv(backendPorts);

  // SEC-HARDEN 清单 #5：权限默认拒绝（Electron 未装 handler 时是「自动批准一切」）。
  // 必须晚于 setupDesktopEnv——受信渲染 origin 由它写入 PETRI_TRUSTED_DESKTOP_ORIGINS。
  // 传 app 是为了用 'session-created' 覆盖分区 session（webview 的 persist:petri-browser
  // 不共享 defaultSession，只装默认 session 会漏掉 guest）。
  try {
    applyPermissionPolicy({ session, app, log: console });
  } catch (error) {
    // BLOCK-102 P1 — fail-open consequence must be LOUD: without the policy,
    // permission requests default to auto-approve.
    console.error("[security] 权限策略装配失败（继续启动，权限请求将被自动批准——安全策略未生效）:", error?.message || error);
  }

  // M1-4 (H3)：启动 petri-server 前跑 db migration，防升级 schema 错乱。
  // Migration must use the same selected Node boundary as petri-server. Loading
  // better-sqlite3 inside Electron would require a different native ABI and
  // would break the system-Node copy used by Harness/backend processes.
  // BLOCK-100 P1 — 测试实例跳过：主实例拥有 DB 生命周期，migration 已由其执行。
  // BLOCK-154 波次 2 — spawnSync → 异步 spawn：迁移期间主进程事件循环不再被同步
  // 阻塞（同步形态最坏 30s timeout 全冻结窗口/IPC；BK-08 缺陷类第二现，由
  // test/block154-startup-async.test.mjs 机械门禁守护 main.js 零同步子进程）。
  // 时序不变：startRServer 前仍 await 完成态；失败仍不阻断启动（initSchema 兜底）。
  const migrationPromise = (async () => {
    const migDir = path.join(__dirname, "migrations");
    const dbPath = process.env.PETRI_DB_PATH;
    if (!dbPath || IS_TEST_INSTANCE) return;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const migrationEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    // Dev: migration child runs under the *system* Node (ABI 137), so it must load
    // Core's better-sqlite3 (Node-ABI copy), not root's electron-rebuilt copy.

    // Packaged: the child runs under Electron's embedded Node (ABI 145), so it must load the
    // root copy (which afterPack rebuilt against Electron); delete the override to restore default.
    // NOTE: read `app.isPackaged` at runtime here — do NOT trust the module-load-time
    // `IS_DEV` constant: since Electron 41, `require("electron").app` can be undefined
    // during module evaluation, which silently degrades IS_DEV to false and skips this branch.

    if (!app.isPackaged) {
      migrationEnv.PETRI_BETTER_SQLITE3_ROOT = resolveCore("petri-server");
    } else {
      delete migrationEnv.PETRI_BETTER_SQLITE3_ROOT;
    }
    await new Promise((resolve, reject) => {
      const migration = spawn(
        NODE_BIN,
        [path.join(__dirname, "migration-runner.js"), dbPath, migDir],
        { cwd: PROJECT_ROOT, env: migrationEnv, timeout: 30000 },
      );
      let stdoutText = "";
      let stderrText = "";
      migration.stdout.on("data", (chunk) => { stdoutText += chunk; });
      migration.stderr.on("data", (chunk) => { stderrText += chunk; });
      migration.on("error", reject);
      migration.on("close", (code) => {
        if (code !== 0) {
          reject(new Error((stderrText || stdoutText || "migration child failed").trim()));
          return;
        }
        const migrationOutput = stdoutText.trim();
        if (migrationOutput) console.log(migrationOutput);
        resolve();
      });
    });
  })();

  // 1. 启动后端服务
  // petri-server 常驻（BLOCK-30 P1/P2：唯一业务后端，Python 工具经执行器注册表
  // 本地执行；gateway 协调层已摘除）。
  // BLOCK-9.1 PHASE 4: startRServer moved to src/main/backend-proc-manager.js.
  // main.js orchestrates via named imports.
  const {
    startRServer,
    getProcs,
    getLogDir,
    flushLogs,
    readLogTail,
  } = require("./main/backend-proc-manager");
  // BLOCK-100 P1 — 测试实例 attach 模式：后端由主 dev 栈持有，本实例不 spawn、
  // 只等就绪（缺席 fail-fast 诚实报错并退出，防「半死测试实例」假通过）。
  if (IS_TEST_INSTANCE) {
    const backendPort = backendPorts.r;
    const { markBackendAttached } = require("./main/backend-proc-manager");
    markBackendAttached(backendPort);
    const backendHealthy = await waitForBackendHealthy(backendPort, 90_000);
    if (!backendHealthy) {
      dialog.showErrorBox(
        "格物测试实例",
        `后端 :${backendPort} 未就绪（等待 90s 超时）。\n请先启动主 dev 栈（npm run dev 或 restart-dev-stack.sh）再启动测试实例。`,
      );
      app.quit();
      return;
    }
  } else {
    // BLOCK-154 波次 2 — migration 完成态在此收口（时序不变：schema 先于后端打开 DB）；
    // 失败不阻断启动——petri-server 的 initSchema() 仍会兜底建表。
    try {
      await migrationPromise;
    } catch (e) {
      console.error("[desktop] migration failed:", e?.message || e);
    }
    await startRServer();
  }

  // 2. 加载已安装插件
  await loadInstalledPlugins({ require });

  // 3. 内容增量同步（后台）——测试实例跳过（减少足迹，同步职责归主实例）
  if (!IS_TEST_INSTANCE) {
    startContentSync({ require });
  }

  // 5. 设置 IPC
  // TLS/Proxy fix: 渲染进程(Chromium)默认继承系统代理，会把 localhost 的
  // petri-server 请求也塞进系统代理，导致
  // "Client network socket disconnected before secure TLS connection was
  // established"。只绕开本地回环，外网仍走原代理（避免 blanket direct://
  // 误伤需要代理才能访问的外网 LLM）。注意：petri-server 出站 LLM 走 Node
  // fetch/https，本就不吃系统代理，此设置不影响它。
  try {
    session.defaultSession.setProxy({
      proxyBypassRules: "localhost;127.0.0.1;<-loopback>",
    });
  } catch (e) {
    console.warn("[desktop] setProxy failed:", e.message);
  }

  setupWindowIpc({ ipcMain, process, app, getMainWindow, globalShortcut, mainWindow });
  // BLOCK-101 P0 — 启动 timeline 度量 IPC（纯观测；flow 经 startup:marks 拉取）
  const { setupStartupTimelineIpc } = require("./ipc/startup-timeline");
  setupStartupTimelineIpc({ ipcMain });
  setupAgentWorkbenchFlagsIpc({
    getMainWindow,
    getAgentWorkbenchFlags: () => agentWorkbenchFlags,
    publishAgentWorkbenchFlags,
  });
  // BLOCK-9.1 PHASE 1: low-risk setup functions moved to src/ipc/*.js
  const { setupTelemetryIpc } = require("./ipc/telemetry");
  const { setupHarnessCapabilitiesIpc } = require("./ipc/harness-capabilities");
  const { setupAiSettingsIpc } = require("./ipc/ai-settings");
  const { setupFileDialogIpc } = require("./ipc/file-dialog");
  const { setupDataManagementIpc } = require("./ipc/data-management");
  const { setupBranchIpc } = require("./ipc/branch-handlers");
  const { setupWorkingTreeReviewIpc } = require("./ipc/working-tree-review");
  setupAiSettingsIpc({ mainWindow: () => mainWindow });
  setupTelemetryIpc();
  setupHarnessCapabilitiesIpc();
  setupFileDialogIpc({ mainWindow });
  setupDataManagementIpc();
  setupBranchIpc({ mainWindow: () => mainWindow });
  // BLOCK-51 修复：working-tree-review 内部（L858 notifyAgentTaskDone）按对象用法消费
  // options.mainWindow（isDestroyed()/webContents.send），此前传 thunk 函数导致
  // 调用时 "options.mainWindow.isDestroyed is not a function"。sender-guard 双形态兼容。
  setupWorkingTreeReviewIpc({ mainWindow });
  // BLOCK-9.1 PHASE 2: mid-risk setup functions with dependency injection
   const { setupRuntimeIpc } = require("./ipc/runtime-status");
   // BLOCK-51 回归修复：plumber 清理时误删了本 require 但保留了 L465 调用，
   // dev Electron 启动即崩 "setupPluginIpc is not defined"（窗口不创建）。
   const { setupPluginIpc } = require("./ipc/plugin");
   const { setupAutoUpdateIpc } = require("./ipc/auto-update");
  setupPluginIpc({ mainWindow: () => mainWindow });
   // BLOCK-84：领域包一键装/卸 IPC（记录制；boot 接线由 server 启动消费）
   const { registerPackIpc } = require("./ipc/pack");
   registerPackIpc();
  // Capture procs as a snapshot — IPC handlers fetch a fresh
  // snapshot at invocation time via getProcs() from backend-proc-manager.
  const _procsSnapshot = getProcs();
  setupRuntimeIpc(_procsSnapshot);
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
  // BLOCK-67 加映（UI-326）— IP+密码 引导连接（装公钥 + 写 ssh config 别名）
  const { setupSshHostIpc } = require("./ipc/ssh-host");
  setupSshHostIpc();
  setupSkillsIpc();

  // BLOCK-166 — Gen UI 沙箱宿主与 IPC（prepare 通道；协议 handler 读文件/拼壳/CSP/vendor）
  const { setupGenUiProtocol } = require("./main/gen-ui/scheme");
  const { setupGenUiIpc } = require("./ipc/gen-ui");
  setupGenUiProtocol();
  setupGenUiIpc();

  // BLOCK-216 Q5 — 领域包视图独立 origin 宿主（petri-pack://<packId>）
  const { setupPackProtocol } = require("./main/pack-ui/scheme");
  setupPackProtocol();

  // 6. CSP 加固——禁用 unsafe-eval，限制资源来源到 self + localhost（后端/SSE/dev server）
  setupCsp({ isDevMode });

  // 6.5 BLOCK-223 — 桌面外壳 IPC 必须在建窗前注册：渲染进程首帧就会推偏好镜像。
  const { setupDesktopShellIpc } = require("./ipc/desktop-shell");
  setupDesktopShellIpc({ desktopShell, isTestInstance: IS_TEST_INSTANCE });

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
    onSpaServerReady: noteSpaServerUrl,
  });

  // 8. 窗口系统 IPC（BLOCK-59 P0）——必须在 createWindow 之后装配：
  //    SPA base URL 已就绪，主窗口 webContents 已存在可供多播。
  const { setupWindowManagerIpc } = require("./ipc/window-manager.js");
  setupWindowManagerIpc({
    getMainWindow,
    getSpaBaseUrl: () => windowManagerSpaBaseUrl,
    resolveResource,
  });

  // 9. BLOCK-223 — 主窗关窗守卫（closeToTray / 退出摘要）；IPC 已在建窗前注册
  desktopShell.attachMainWindow(getMainWindow());
  app.once("will-quit", () => desktopShell.dispose());
}

// Dev-only: enable Chrome DevTools remote debugging on port 9222 so the main
// agent (and humans) can inspect the renderer via /json/list while developing.
// Guarded by the --dev flag dev-electron.js always passes; production builds
// never set this flag and the switch is a no-op for end users.
// BLOCK-100 P1 — hasSwitch 守卫：argv 已显式带 --remote-debugging-port（如测试
// 实例的 9223）时不覆盖——appendSwitch 会压过 argv 值，曾致测试实例去抢主实例
// 的 9222 → DevTools HTTP bind 0x2740 失败（实机抓真两次复现）。
if (process.argv.includes("--dev") && !app.commandLine.hasSwitch("remote-debugging-port")) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
}

// BLOCK-166 — Gen UI 沙箱 scheme：privileged 注册必须在 app ready 前完成。
const { registerGenUiSchemePrivileges } = require("./main/gen-ui/scheme");
registerGenUiSchemePrivileges();

// BLOCK-216 Q5 — 领域包视图 scheme（独立 origin，privileged 注册须在 ready 前）。
const { registerPackSchemePrivileges } = require("./main/pack-ui/scheme");
registerPackSchemePrivileges();

app.whenReady().then(main);

// 必须在任何 webContents 创建前注册（模块加载期同步执行；main() 在 whenReady 后才创建窗口）。
applyWebContentsHardening({ app, shell, log: console });

app.on("window-all-closed", () => {
  // Product contract: closing Petri stops the local application and every
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
      onSpaServerReady: noteSpaServerUrl,
    }).catch((err) => {
      console.error("[desktop] window recreation failed:", err);
    });
  }
});

app.on("before-quit", () => {
  // BLOCK-9.1 PHASE 4: backend proc handles moved to
  // src/main/backend-proc-manager.js. Import them here for the
  // before-quit shutdown sequence.
  const { rServerSupervisor } = require("./main/backend-proc-manager");
  rServerSupervisor.shutdown("app-quit");
});

// setupAppMenu moved to src/main/_app-menu.js (SUB-15.1 PHASE 2)

// Initialize application menu
setupAppMenu({ app, BrowserWindow, Menu, process });

// ── BLOCK-59 窗口系统 ─────────────────────────────────────────
// createWindow() 内部启动的 SPA 服务地址需要让弹出窗复用（同一 SPA 走
// 路由，不建第二套前端，plan §4.2），经 onSpaServerReady 回调留存。
let windowManagerSpaBaseUrl = null;
function noteSpaServerUrl(url) {
  windowManagerSpaBaseUrl = url;
}
