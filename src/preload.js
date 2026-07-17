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
    rApiBase: `http://localhost:${process.env.R_SERVER_PORT || 3001}/api`,
    pythonApiBase: `http://localhost:${process.env.PY_SERVER_PORT || 3004}/api`,
  }),

  // 窗口控制（配合 frame:false 自定义标题栏）
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  // AI 设置
  aiSettings: {
    get: () => ipcRenderer.invoke('ai-settings:get'),
    save: (settings) => ipcRenderer.invoke('ai-settings:save', settings),
    test: (providerOrProfile, apiKey) => ipcRenderer.invoke('ai-settings:test', providerOrProfile, apiKey),
  },

  // 计算执行配置
  computeSettings: {
    get: () => ipcRenderer.invoke('compute-settings:get'),
    save: (settings) => ipcRenderer.invoke('compute-settings:save', settings),
  },

  // 插件管理
  plugins: {
    listInstalled: () => ipcRenderer.invoke('plugin:list-installed'),
    listRemote: () => ipcRenderer.invoke('plugin:list-remote'),
    install: (pluginId, onProgress) => {
      // 进度通过事件流推送（可选回调）
      const handler = onProgress ? (_event, data) => onProgress(data) : null;
      if (handler) ipcRenderer.on('plugin:install-progress', handler);
      const promise = ipcRenderer.invoke('plugin:install', pluginId);
      // 安装结束后清理 listener
      if (handler) {
        promise.finally(() => ipcRenderer.removeListener('plugin:install-progress', handler));
      }
      return promise;
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
