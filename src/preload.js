/**
 * Electron Preload — 桌面版前端 ↔ 主进程 IPC 桥
 *
 * 通过 contextBridge 暴露安全的 API 给 webview 前端调用。
 * 前端通过 window.biof3Desktop 访问这些 API。
 *
 * 阶段 3（desktop-spa）：主窗口加载 Vite SPA，不再需要隐藏 Docusaurus
 * navbar（SPA 没有 navbar）。body padding 由 DesktopToolbar 组件自己管理。
 */

const { contextBridge, ipcRenderer } = require('electron');

// A-009: pull the r-server / py-server port fallbacks from env-coordinator
// instead of duplicating the per-port fallback defaults here. The
// Electron main process sets R_SERVER_PORT / PY_SERVER_PORT on
// process.env before preload.js runs, so the helper defaults
// (3001 / 3004) are only consulted in the rare standalone-render
// fallback path.
// A-009: getBackendPort() defaults were 3001 (r) / 3004 (python).
// Electron main process's setupDesktopEnv() injects the resolved ports
// into process.env.R_SERVER_PORT / PY_SERVER_PORT *before* preload.js
// runs (env-coordinator.js writes them at lines 285-286). Reading from
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
const _pyPort = _readPort('PY_SERVER_PORT', 3004);

const AGENT_WORKBENCH_FLAG_CHANNEL = 'biof3:agent-workbench-flags';
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
    window.dispatchEvent(new CustomEvent('biof3:soft-refresh'));
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

contextBridge.exposeInMainWorld('biof3Desktop', {
  // 平台标识
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  backendConfig: Object.freeze({
    rApiBase: `http://localhost:${_rPort}/api`,
    pythonApiBase: `http://localhost:${_pyPort}/api`,
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

  // 应用级控制 — 装完运行时后需整体重启（BIOF3_R_HOME 在 main 启动时固化，
  // 只重启 r-server 不够，必须重新解析 runtime 路径）
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

  // M2-7：py-server / plumber 按需启停（lazy，idle 5min 自动停）
  py: {
    start: () => ipcRenderer.invoke('py:start'),
    stop: () => ipcRenderer.invoke('py:stop'),
  },
  plumber: {
    start: () => ipcRenderer.invoke('plumber:start'),
    stop: () => ipcRenderer.invoke('plumber:stop'),
  },

  // 文件系统（有限暴露）
  files: {
    saveDialog: (defaultName) => ipcRenderer.invoke('file:save-dialog', defaultName),
    openDialog: (filters) => ipcRenderer.invoke('file:open-dialog', filters),
    openDirectoryDialog: () => ipcRenderer.invoke('file:open-dialog', { openDirectory: true }),
    openPath: (targetPath) => ipcRenderer.invoke('file:open-path', targetPath),
    openWorkspaceFile: (workspacePath, relativePath) =>
      ipcRenderer.invoke('file:open-workspace-file', workspacePath, relativePath),
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

  // 右侧工具栏
  terminal: {
    snapshot: () => ipcRenderer.invoke('terminal:snapshot'),
    openLogDir: () => ipcRenderer.invoke('terminal:open-log-dir'),
    openShell: (targetPath) => ipcRenderer.invoke('terminal:open-shell', targetPath),
    startSession: (targetPath) => ipcRenderer.invoke('terminal:session-start', targetPath),
    writeSession: (input) => ipcRenderer.invoke('terminal:session-write', input),
    resizeSession: (cols, rows) =>
      ipcRenderer.invoke('terminal:session-resize', { cols, rows }),
    stopSession: () => ipcRenderer.invoke('terminal:session-stop'),
    onData: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
    onExit: (callback) => {
      const handler = (_event, data) => callback(data);
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
});
