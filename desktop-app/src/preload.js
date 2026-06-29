/**
 * Electron Preload — 桌面版前端 ↔ 主进程 IPC 桥
 *
 * 通过 contextBridge 暴露安全的 API 给 webview 前端调用。
 * 前端通过 window.biof3Desktop 访问这些 API。
 */

const { contextBridge, ipcRenderer } = require('electron');

// ============================================================
// 注入 process.env.BIOF3_DESKTOP = '1' 到渲染进程
// ============================================================
// 前端代码（Docusaurus build 产物）通过
//   typeof process && process.env && process.env.BIOF3_DESKTOP === '1'
// 检测桌面版，但 contextIsolation:true + nodeIntegration:false 下
// 渲染进程没有 process 对象，导致 IS_DESKTOP 永远为 false。
//
// 后果：Waline 评论、analytics 心跳等本应禁用的云端功能依然运行：
//   - Waline 尝试连接 https://biof3.com，登录时 window.open() 打开新窗口
//   - 新 Electron 窗口不继承 setWindowOpenHandler，加载失败 → SPA fallback
//     → 又加载完整应用 → 又触发 Waline → 级联弹窗直到卡死
//
// 通过 contextBridge 暴露 process 对象，让前端的 typeof process 检测通过。
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

  // AI 设置
  aiSettings: {
    get: () => ipcRenderer.invoke('ai-settings:get'),
    save: (settings) => ipcRenderer.invoke('ai-settings:save', settings),
    test: (provider, apiKey) => ipcRenderer.invoke('ai-settings:test', provider, apiKey),
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

  // Runtime 状态（R/Python 基础运行时是否已安装）
  runtime: {
    status: () => ipcRenderer.invoke('runtime:status'),
  },

  // 文件系统（有限暴露）
  files: {
    saveDialog: (defaultName) => ipcRenderer.invoke('file:save-dialog', defaultName),
    openDialog: (filters) => ipcRenderer.invoke('file:open-dialog', filters),
  },

  // 诊断日志导出
  diagnostic: {
    export: (targetPath) => ipcRenderer.invoke('diagnostic:export', targetPath),
  },

  // FigCode 包检测
  figcode: {
    checkPackages: (language, packages, cardId) =>
      ipcRenderer.invoke('figcode:check-packages', { language, packages, cardId }),
    cardStatus: (cardIds) => ipcRenderer.invoke('figcode:card-status', cardIds),
  },

  // 自动更新（electron-updater）
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
