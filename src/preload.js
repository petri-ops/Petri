/**
 * Electron Preload — 桌面版前端 ↔ 主进程 IPC 桥
 *
 * 通过 contextBridge 暴露安全的 API 给 webview 前端调用。
 * 前端通过 window.biof3Desktop 访问这些 API。
 *
 * 阶段 3（desktop-spa）：主窗口加载 Vite SPA，不再需要隐藏 Docusaurus
 * navbar（SPA 没有 navbar）。body padding 由 DesktopToolbar 组件自己管理。
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// A-009: pull the biof3-server port fallback from env-coordinator
// instead of duplicating the per-port fallback defaults here. The
// Electron main process sets R_SERVER_PORT on
// process.env before preload.js runs, so the helper default
// (3001) is only consulted in the rare standalone-render
// fallback path.
// A-009: getBackendPort() default was 3001 (r).
// Electron main process's setupDesktopEnv() injects the resolved port
// into process.env.R_SERVER_PORT *before* preload.js
// runs (env-coordinator.js writes it in setupDesktopEnv). Reading from
// process.env directly is therefore equivalent to calling the helper,
// and avoids the cross-file require which is forbidden when
// BrowserWindow is launched with sandbox: true (the require here
// otherwise throws "module not found" and aborts the entire preload,
// which silently strips window.biof3Desktop and disables the custom
// traffic-light buttons in the title bar).
function _readPort(envName, defaultPort) {
  const raw = process.env[envName];
  if (raw == null || raw === '') return defaultPort;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPort;
}
const _rPort = _readPort('R_SERVER_PORT', 3001);

const AGENT_WORKBENCH_FLAG_CHANNEL = 'gewu:agent-workbench-flags';
const AGENT_WORKBENCH_FLAGS = { extraRenderers: false };

ipcRenderer.on(AGENT_WORKBENCH_FLAG_CHANNEL, (_event, payload) => {
  if (!payload || typeof payload.extraRenderers !== 'boolean') return;
  AGENT_WORKBENCH_FLAGS.extraRenderers = payload.extraRenderers;
});

contextBridge.exposeInMainWorld('biof3', {
  agentWorkbenchFlags: {
    // contextBridge freezes getters on the renderer side and rebinds them
    // to a frozen snapshot of the snapshot taken at first access — using a
    // plain getter causes `window.biof3.agentWorkbenchFlags.extraRenderers`
    // to permanently read `false` even after the user flips the toggle in
    // packaged Electron. Expose a synchronous method instead so each call
    // returns the live value from the closure.
    getExtraRenderers: () => AGENT_WORKBENCH_FLAGS.extraRenderers,
    set: (value) => ipcRenderer.invoke(AGENT_WORKBENCH_FLAG_CHANNEL, value === true),
    onChange: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => {
        if (payload && typeof payload.extraRenderers === 'boolean') callback(payload.extraRenderers);
      };
      ipcRenderer.on(AGENT_WORKBENCH_FLAG_CHANNEL, listener);
      return () => ipcRenderer.removeListener(AGENT_WORKBENCH_FLAG_CHANNEL, listener);
    },
  },
});

ipcRenderer.on('app:soft-refresh', () => {
  try {
    window.dispatchEvent(new CustomEvent('gewu:soft-refresh'));
  } catch {}
});

// ============================================================
// 注入 process.env.BIOF3_DESKTOP = '1' 到渲染进程
// ============================================================
// 前端代码通过 typeof process && process.env && process.env.BIOF3_DESKTOP
// 检测桌面版，但 contextIsolation:true + nodeIntegration:false 下
// 渲染进程没有 process 对象。通过 contextBridge 暴露让其检测通过。
contextBridge.exposeInMainWorld('process', {
  env: {
    BIOF3_DESKTOP: '1',
    NODE_ENV: 'production',
  },
});

// BLOCK-61 品牌桥：主全局名 gewu；biof3Desktop 为兼容别名（同一 surface
// 双暴露，desktopBridge 双读），过渡期后评估移除。
const desktopBridgeSurface = {
  // 平台标识
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  backendConfig: Object.freeze({
    rApiBase: `http://localhost:${_rPort}/api`,
  }),

  // 窗口控制（配合 frame:false 自定义标题栏）
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => {
      try {
        return Promise.resolve(ipcRenderer.invoke('window:isMaximized')).then(
          (value) => value === true,
        );
      } catch (error) {
        return Promise.reject(error);
      }
    },
    onMaximizeChanged: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, isMaximized) => callback(isMaximized === true);
      ipcRenderer.on('window:maximize-changed', listener);
      return () => ipcRenderer.removeListener('window:maximize-changed', listener);
    },
    // Mac fullscreen support
    isFullScreen: () => {
      try {
        return Promise.resolve(ipcRenderer.invoke('window:isFullScreen')).then(
          (value) => value === true,
        );
      } catch (error) {
        return Promise.reject(error);
      }
    },
    toggleFullScreen: () => ipcRenderer.send('window:toggleFullScreen'),
    onFullScreenChanged: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, isFullScreen) => callback(isFullScreen === true);
      ipcRenderer.on('window:fullscreen-changed', listener);
      return () => ipcRenderer.removeListener('window:fullscreen-changed', listener);
    },
  },

  // BLOCK-59 窗口系统 — 弹出窗 / 边缘轨道 / 指挥中心。
  // × 永远是降格（minimizeToRail），销毁只有轨道显式 remove（plan §3 契约）。
  windowManager: {
    popOut: (type, key) => ipcRenderer.invoke('window:pop-out', { type, key }),
    returnToDock: (id) => ipcRenderer.invoke('window:return', { id }),
    minimizeToRail: (id) => ipcRenderer.invoke('window:minimize', { id }),
    restore: (id) => ipcRenderer.invoke('window:restore', { id }),
    remove: (id) => ipcRenderer.invoke('window:remove', { id }),
    snapshot: () => ipcRenderer.invoke('window:snapshot'),
    /** 当前窗口的内容身份：主窗为 null，弹出窗为 'type:key'。 */
    self: () => ipcRenderer.invoke('window:self'),
    /** 轨道 hover 卡内容预览：降格瞬间快照（无快照返回 ok:false）。 */
    thumbnail: (id) => ipcRenderer.invoke('window:thumbnail', { id }),
    /** 轨道容器窗专用：hover 条带/卡时切换点击穿透（仅轨道窗 sender 生效）。 */
    setRailMouseIgnore: (ignore) => ipcRenderer.send('window:rail-mouse', { ignore }),
    onStateChanged: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('window:state-changed', listener);
      return () => ipcRenderer.removeListener('window:state-changed', listener);
    },
  },

  // 应用级控制 — 装完运行时后需整体重启（BIOF3_R_HOME 在 main 启动时固化，
  // 只重启 biof3-server 不够，必须重新解析 runtime 路径）
  app: {
    relaunch: () => ipcRenderer.invoke('app:relaunch'),
  },

  // AI 设置
  aiSettings: {
    get: () => ipcRenderer.invoke('ai-settings:get'),
    save: (settings) => ipcRenderer.invoke('ai-settings:save', settings),
    getCredential: (credentialId) => ipcRenderer.invoke('ai-settings:get-credential', credentialId),
    test: (providerOrProfile, apiKey) => ipcRenderer.invoke('ai-settings:test', providerOrProfile, apiKey),
    listModels: (providerOrProfile, apiKey) => ipcRenderer.invoke('ai-settings:list-models', providerOrProfile, apiKey),
  },

  // 计算执行配置
  computeSettings: {
    get: () => ipcRenderer.invoke('compute-settings:get'),
    save: (settings) => ipcRenderer.invoke('compute-settings:save', settings),
  },

  // Harness 能力预备 — Stage 3 M1：只读，展示已自备的运行时/包 bundle
  harnessCapabilities: {
    list: () => ipcRenderer.invoke('harness-capabilities:list'),
  },

  // 插件管理
  plugins: {
    listInstalled: () => ipcRenderer.invoke('plugin:list-installed'),
    listRemote: () => ipcRenderer.invoke('plugin:list-remote'),
    install: (pluginId, onProgress) => {
      // Progress is passed through the invoke result or a callback (IPC event channel
      // plugin:install-progress is not currently wired on the main side; progress
      // callbacks are passed directly). Kept for future main-side send wiring.
      void onProgress;
      return ipcRenderer.invoke('plugin:install', pluginId);
    },
    uninstall: (pluginId) => ipcRenderer.invoke('plugin:uninstall', pluginId),
    checkUpdates: () => ipcRenderer.invoke('plugin:check-updates'),
  },

  // M2-9：content-plugin 文档桥（docs.tsx 运行时拉取已装教程插件）
  contentPlugins: {
    list: () => ipcRenderer.invoke('content-plugin:list'),
    listDocs: (pluginId) => ipcRenderer.invoke('content-plugin:list-docs', pluginId),
    read: (pluginId, relativePath) =>
      ipcRenderer.invoke('content-plugin:read', pluginId, relativePath),
  },

  // Runtime 状态（R/Python 基础运行时是否已安装）
  runtime: {
    status: () => ipcRenderer.invoke('runtime:status'),
  },

  // M1-1：后端就绪感知（聚合 runtime + health + 子进程存活）
  backend: {
    status: () => ipcRenderer.invoke('backend:status'),
  },

  // BLOCK-51 P3: py / plumber 按需启停通道已随 py-server（BLOCK-30 P1）
  // 与 plumber 空壳（BLOCK-51 P3）摘除。

  // 文件系统（有限暴露）
  files: {
    saveDialog: (defaultName) => ipcRenderer.invoke('file:save-dialog', defaultName),
    openDialog: (filters) => ipcRenderer.invoke('file:open-dialog', filters),
    openDirectoryDialog: () => ipcRenderer.invoke('file:open-dialog', { openDirectory: true }),
    validateDirectory: (targetPath) => ipcRenderer.invoke('file:validate-directory', targetPath),
    listDirectory: (dirPath) => ipcRenderer.invoke('file:list-directory', dirPath),
    openPath: (targetPath) => ipcRenderer.invoke('file:open-path', targetPath),
    openWorkspaceFile: (workspacePath, relativePath) =>
      ipcRenderer.invoke('file:open-workspace-file', workspacePath, relativePath),
    // BLOCK-53 P1 — 拖拽目录直达创建：把拖入窗口的 File 对象解析为磁盘绝对路径。
    // webUtils.getPathForFile 是 Electron 官方通道（File.path 自 32 起移除）；沙箱
    // 环境或非文件拖入时兜底 file.path（Electron 30 仍可用），都拿不到返回 null。
    pathForFile: (file) => {
      try {
        const p = webUtils.getPathForFile(file);
        if (p) return p;
      } catch { /* fall through */ }
      return (file && typeof file.path === 'string' && file.path) || null;
    },
  },

  // BLOCK-19 — workspace 文件写（仅限当前项目的 workspaceDir 边界内文本覆盖）
  workspace: {
    writeTextFile: (workspacePath, relativePath, content) =>
      ipcRenderer.invoke('workspace:write-text-file', workspacePath, relativePath, content),
  },

  // 诊断日志导出
  diagnostic: {
    export: (targetPath) => ipcRenderer.invoke('diagnostic:export', targetPath),
  },

  // M2-3：可选错误遥测（默认关闭，用户主动开启后才会上报）
  telemetry: {
    report: (payload) => ipcRenderer.invoke('telemetry:report', payload),
  },

  // 数据目录管理（卸载数据保留）
  data: {
    info: () => ipcRenderer.invoke('data:info'),
    openDir: () => ipcRenderer.invoke('data:open-dir'),
  },

  // 右侧工具栏。BLOCK-54 P2 多 Tab：session 形通道全量 additive——
  // 可选 sessionId 形参（不传 = 旧单会话 default tab，主进程归一兼容）；
  // terminal:data / terminal:exit 事件 payload 为 { sessionId, ... }（渲染端按 tab 路由）。
  terminal: {
    snapshot: () => ipcRenderer.invoke('terminal:snapshot'),
    openLogDir: () => ipcRenderer.invoke('terminal:open-log-dir'),
    openShell: (targetPath) => ipcRenderer.invoke('terminal:open-shell', targetPath),
    startSession: (targetPath, sessionId) =>
      ipcRenderer.invoke(
        'terminal:session-start',
        sessionId ? { sessionId, targetPath } : targetPath
      ),
    writeSession: (input, sessionId) =>
      ipcRenderer.invoke(
        'terminal:session-write',
        sessionId ? { sessionId, text: input } : input
      ),
    resizeSession: (cols, rows, sessionId) =>
      ipcRenderer.invoke(
        'terminal:session-resize',
        sessionId ? { cols, rows, sessionId } : { cols, rows }
      ),
    stopSession: (sessionId) => ipcRenderer.invoke('terminal:session-stop', sessionId),
    listSessions: () => ipcRenderer.invoke('terminal:session-list'),
    onData: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
    onExit: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    },
  },

  // BLOCK-4: 对齐 frontend/src/lib/electron.d.ts L114-218（PHASE 1 落地后 d.ts
  // 扩展为 ADDITIVE +2 字段 cancel + onProgress，C3 修正原注释 L114-169 偏差）
  // 主进程 SkillsSDK 单例负责真正调用 core/shared-backend/skills-sdk.js；
  // progress 通过 ipcRenderer.on('skills:progress') 推送（替代 useSkillStore 旧 2s 轮询）
  skills: {
    discover: () => ipcRenderer.invoke('skills:discover'),
    execute: (skillId, params) =>
      ipcRenderer.invoke('skills:execute', String(skillId ?? ''), params && typeof params === 'object' ? params : {}),
    getExecution: (executionId) =>
      ipcRenderer.invoke('skills:getExecution', String(executionId ?? '')),
    cancel: (executionId) =>
      ipcRenderer.invoke('skills:cancel', String(executionId ?? '')),
    onProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      // BLOCK-4 B5: callback 抛错 try/catch 隔离，避免污染后续 progress 事件链
      const handler = (_event, payload) => {
        try {
          callback(payload);
        } catch (e) {
          if (typeof console !== 'undefined' && console.error) {
            console.error('[preload] skills:progress callback error:', e && e.message);
          }
        }
      };
      ipcRenderer.on('skills:progress', handler);
      return () => ipcRenderer.removeListener('skills:progress', handler);
    },
  },

  // PHASE 1: Branch Tab UI — branch namespace 1:1 镜像 electron.d.ts L319-350
  //（不暴露 branch-handlers.js 里的 project/message 通道；d.ts 契约仅含以下 6 个）
  branch: {
    create: (params) => ipcRenderer.invoke('branch:create', params),
    list: (params) => ipcRenderer.invoke('branch:list', params),
    switch: (params) => ipcRenderer.invoke('branch:switch', params),
    delete: (params) => ipcRenderer.invoke('branch:delete', params),
    rename: (params) => ipcRenderer.invoke('branch:rename', params),
    getActive: (params) => ipcRenderer.invoke('branch:active', params),
  },

  // PHASE 1: Result Studio — result namespace 1:1 镜像 electron.d.ts L353-505
  //（validTypes 在 result-handlers.js 已包含 conversation_export：见 C-002 修复）
  result: {
    create: (params) => ipcRenderer.invoke('result:create', params),
    get: (params) => ipcRenderer.invoke('result:get', params),
    list: (params) => ipcRenderer.invoke('result:list', params),
    update: (params) => ipcRenderer.invoke('result:update', params),
    delete: (params) => ipcRenderer.invoke('result:delete', params),
    byProject: (params) => ipcRenderer.invoke('result:byProject', params),
    createFromConversation: (params) =>
      ipcRenderer.invoke('result:createFromConversation', params),
    version: {
      create: (params) => ipcRenderer.invoke('result:version:create', params),
      get: (params) => ipcRenderer.invoke('result:version:get', params),
      getByNumber: (params) => ipcRenderer.invoke('result:version:getByNumber', params),
      list: (params) => ipcRenderer.invoke('result:version:list', params),
    },
  },

  // macOS 小团队更新（OSS 清单 + DMG）
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    // 事件监听（前端订阅更新通知）
    onUpdateAvailable: (cb) => {
      const handler = (_e, info) => cb(info);
      ipcRenderer.on('updater:update-available', handler);
      return () => ipcRenderer.removeListener('updater:update-available', handler);
    },
    onUpdateNotAvailable: (cb) => {
      const handler = () => cb();
      ipcRenderer.on('updater:update-not-available', handler);
      return () => ipcRenderer.removeListener('updater:update-not-available', handler);
    },
    onDownloadProgress: (cb) => {
      const handler = (_e, progress) => cb(progress);
      ipcRenderer.on('updater:download-progress', handler);
      return () => ipcRenderer.removeListener('updater:download-progress', handler);
    },
    onUpdateDownloaded: (cb) => {
      const handler = () => cb();
      ipcRenderer.on('updater:update-downloaded', handler);
      return () => ipcRenderer.removeListener('updater:update-downloaded', handler);
    },
    onError: (cb) => {
      const handler = (_e, msg) => cb(msg);
      ipcRenderer.on('updater:error', handler);
      return () => ipcRenderer.removeListener('updater:error', handler);
    },
  },

  // BLOCK-16 — Working Tree Review Mode
  // BLOCK-20 — Code Review Panel: add listModified / fileHeadContent / splitSideDiff / revertFile / applyInverseHunk
  // BLOCK-20 — per-hunk reject via applyInverseHunk: 前端组装正向 unified diff patch,
  // 主进程内部 invert + apply 回退 working tree；reject 清单写入与 BLOCK-16 schema 对齐。
  workingTreeReview: {
    // BLOCK-32 — 全方法 params 可携带 projectId（项目级审阅隔离，additive）
    status: (params) => ipcRenderer.invoke('git:working-tree-status', params || {}),
    diff: (params) => ipcRenderer.invoke('git:working-tree-diff', params || {}),
    fileContent: (params) => ipcRenderer.invoke('git:working-tree-file-content', params || {}),
    applyHunk: (params) => ipcRenderer.invoke('git:hunk-apply', params || {}),
    rejectHunkByInverseHunk: (params) => ipcRenderer.invoke('git:hunk-reject-inverse', params || {}),
    revert: (params) => ipcRenderer.invoke('git:working-tree-revert', params || {}),
    onTaskDone: (cb) => {
      const handler = (_e, info) => cb(info);
      ipcRenderer.on('agent:task-done', handler);
      return () => ipcRenderer.removeListener('agent:task-done', handler);
    },
    // BLOCK-20 — 新增 5 方法
    listModified: (params) => ipcRenderer.invoke('git:list-modified', params || {}),
    fileHeadContent: (params) => ipcRenderer.invoke('git:file-head-content', params || {}),
    splitSideDiff: (params) => ipcRenderer.invoke('git:split-side-diff', params || {}),
    revertFile: (params) => ipcRenderer.invoke('git:revert-file', params || {}),
    applyInverseHunk: (params) => ipcRenderer.invoke('git:apply-inverse-hunk', params || {}),
    // BLOCK-20 — Commit Review
    commitReview: (params) => ipcRenderer.invoke('git:commit-review', params || {}),
    // BLOCK-29 — 提交历史（审阅面板「历史」分区，只读）
    commitLog: (params) => ipcRenderer.invoke('git:commit-log', params || {}),
    commitDiff: (params) => ipcRenderer.invoke('git:commit-diff', params || {}),
    commitFileContent: (params) => ipcRenderer.invoke('git:commit-file-content', params || {}),
    // BLOCK-29.5 — 本地分支列表（历史分区选择器，只读）
    branchList: (params) => ipcRenderer.invoke('git:branch-list', params || {}),
    // BLOCK-29.5 — 逐行归属（文件视图第四态，只读）
    blame: (params) => ipcRenderer.invoke('git:blame', params || {}),
    // BLOCK-29.5 — stash/标签列表（只读）
    stashList: (params) => ipcRenderer.invoke('git:stash-list', params || {}),
    tagList: (params) => ipcRenderer.invoke('git:tag-list', params || {}),
    // BLOCK-29.2 — git 工具二期（前端确认后调用）
    discardFile: (params) => ipcRenderer.invoke('git:discard-file', params || {}),
    undoLastCommit: (params) => ipcRenderer.invoke('git:undo-last-commit', params || {}),
    // BLOCK-41 — git 写操作三期（暂存两栏 / 分支切换 / push-pull）
    stagePaths: (params) => ipcRenderer.invoke('git:stage-paths', params || {}),
    unstagePaths: (params) => ipcRenderer.invoke('git:unstage-paths', params || {}),
    commitIndex: (params) => ipcRenderer.invoke('git:commit-index', params || {}),
    checkoutBranch: (params) => ipcRenderer.invoke('git:checkout-branch', params || {}),
    remoteList: (params) => ipcRenderer.invoke('git:remote-list', params || {}),
    remoteStatus: (params) => ipcRenderer.invoke('git:remote-status', params || {}),
    push: (params) => ipcRenderer.invoke('git:push', params || {}),
    pull: (params) => ipcRenderer.invoke('git:pull', params || {}),
    // BLOCK-53 P2 — 非 git 工作区一次性引导：git init + 初始提交（幂等，已 init 时 alreadyGit）
    initRepository: (params) => ipcRenderer.invoke('git:init-repository', params || {}),
  },
};

contextBridge.exposeInMainWorld('gewu', desktopBridgeSurface);
// 兼容别名：历史全局名（desktopBridge 读新优先、旧名兜底）
contextBridge.exposeInMainWorld('biof3Desktop', desktopBridgeSurface);
