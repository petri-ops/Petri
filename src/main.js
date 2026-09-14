/**
 * Electron 主进程入口 — Gewu 本地桌面版
 *
 * 职责：
 * 1. 设置桌面版本地存储、运行时和用户数据环境变量
 * 2. 启动 biof3-server（子进程 spawn，避免原生模块 V8 版本冲突；BLOCK-30 P1 起
 *    无独立 py-server，Python 工具由 biof3-server 经执行器注册表本地执行；
 *    BLOCK-51 P3 起 plumber 空壳也已摘除，R 为 tools-executor 单轨）
 * 3. 加载已安装插件
 * 4. 内容增量同步（后台）
 * 5. 创建 webview 窗口加载内嵌静态站
 * 6. 外部链接走系统浏览器
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
//   - core 资源（biof3-server, shared-backend）内嵌在 desktop 仓根 core/ 下
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
//   1. 用户安装的独立 Runtime（~/Documents/Gewu-Local/runtimes/{R|Python}）— 最高优先
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

// Gewu owns local backend ports and must run as a single application
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
// （BLOCK-30 P1：py:start/py:stop 已随 py-server 摘除；
//   BLOCK-51 P3：plumber:start/plumber:stop 已随 plumber 空壳摘除。）
// ── IPC：macOS 小团队更新（OSS 清单 + 已校验 DMG）─────────────
// ── IPC：文件对话框（preload 暴露的 files.saveDialog/openDialog）─────────
// ── IPC：诊断日志导出 / 数据备份（M2-8）─────────────────────────

// ── IPC：数据目录管理（卸载数据保留）──────────────────────────
// 用户可能在操作系统卸载应用后仍想保留 ~/Documents/Gewu-Local/ 数据，
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

  // SEC-HARDEN 清单 #5：权限默认拒绝（Electron 未装 handler 时是「自动批准一切」）。
  // 必须晚于 setupDesktopEnv——受信渲染 origin 由它写入 BIOF3_TRUSTED_DESKTOP_ORIGINS。
  // 传 app 是为了用 'session-created' 覆盖分区 session（webview 的 persist:gewu-browser
  // 不共享 defaultSession，只装默认 session 会漏掉 guest）。
  try {
    applyPermissionPolicy({ session, app, log: console });
  } catch (error) {
    console.warn("[security] 权限策略装配失败（继续启动，但权限策略未生效）:", error?.message || error);
  }

  // M1-4 (H3)：启动 biof3-server 前跑 db migration，防升级 schema 错乱。
  // Migration must use the same selected Node boundary as biof3-server. Loading
  // better-sqlite3 inside Electron would require a different native ABI and
  // would break the system-Node copy used by Harness/backend processes.
  try {
    const migDir = path.join(__dirname, "migrations");
    const dbPath = process.env.BIOF3_DB_PATH;
    if (dbPath) {
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
        migrationEnv.BIOF3_BETTER_SQLITE3_ROOT = resolveCore("biof3-server");
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
    // 不阻断启动——biof3-server 的 initSchema() 仍会兜底建表
  }

  // 1. 启动后端服务
  // biof3-server 常驻（BLOCK-30 P1/P2：唯一业务后端，Python 工具经执行器注册表
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
  await startRServer();

  // 2. 加载已安装插件
  await loadInstalledPlugins({ require });

  // 3. 内容增量同步（后台）
  startContentSync({ require });

  // 5. 设置 IPC
  // TLS/Proxy fix: 渲染进程(Chromium)默认继承系统代理，会把 localhost 的
  // biof3-server 请求也塞进系统代理，导致
  // "Client network socket disconnected before secure TLS connection was
  // established"。只绕开本地回环，外网仍走原代理（避免 blanket direct://
  // 误伤需要代理才能访问的外网 LLM）。注意：biof3-server 出站 LLM 走 Node
  // fetch/https，本就不吃系统代理，此设置不影响它。
  try {
    session.defaultSession.setProxy({
      proxyBypassRules: "localhost;127.0.0.1;<-loopback>",
    });
  } catch (e) {
    console.warn("[desktop] setProxy failed:", e.message);
  }

  setupWindowIpc({ ipcMain, process, app, getMainWindow });
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
  const { setupResultIpc } = require("./ipc/result-handlers");
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
  setupResultIpc({ mainWindow: () => mainWindow });
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
}

// Dev-only: enable Chrome DevTools remote debugging on port 9222 so the main
// agent (and humans) can inspect the renderer via /json/list while developing.
// Guarded by the --dev flag dev-electron.js always passes; production builds
// never set this flag and the switch is a no-op for end users.
if (process.argv.includes("--dev")) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
}

app.whenReady().then(main);

// 必须在任何 webContents 创建前注册（模块加载期同步执行；main() 在 whenReady 后才创建窗口）。
applyWebContentsHardening({ app, shell, log: console });

app.on("window-all-closed", () => {
  // Product contract: closing Gewu stops the local application and every
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
