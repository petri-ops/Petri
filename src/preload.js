/**
 * Electron Preload — 桌面版前端 ↔ 主进程 IPC 桥
 *
 * 通过 contextBridge 暴露安全的 API 给 webview 前端调用。
 * 前端通过 window.petriDesktop 访问这些 API。
 *
 * 阶段 3（desktop-spa）：主窗口加载 Vite SPA，不再需要隐藏 Docusaurus
 * navbar（SPA 没有 navbar）。body padding 由 DesktopToolbar 组件自己管理。
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// A-009: pull the petri-server port fallback from env-coordinator
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
// which silently strips window.petriDesktop and disables the custom
// traffic-light buttons in the title bar).
function _readPort(envName, defaultPort) {
  const raw = process.env[envName];
  if (raw == null || raw === '') return defaultPort;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPort;
}
const _rPort = _readPort('R_SERVER_PORT', 3001);

const AGENT_WORKBENCH_FLAG_CHANNEL = 'petri:agent-workbench-flags';
const AGENT_WORKBENCH_FLAGS = { extraRenderers: false };

ipcRenderer.on(AGENT_WORKBENCH_FLAG_CHANNEL, (_event, payload) => {
  if (!payload || typeof payload.extraRenderers !== 'boolean') return;
  AGENT_WORKBENCH_FLAGS.extraRenderers = payload.extraRenderers;
});

contextBridge.exposeInMainWorld('petriAgentFlags', {
  agentWorkbenchFlags: {
    // contextBridge freezes getters on the renderer side and rebinds them
    // to a frozen snapshot of the snapshot taken at first access — using a
    // plain getter causes `window.petriAgentFlags.agentWorkbenchFlags.extraRenderers`
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
    window.dispatchEvent(new CustomEvent('petri:soft-refresh'));
  } catch {}
});

// ============================================================
// 注入 process.env.PETRI_DESKTOP = '1' 到渲染进程
// ============================================================
// 前端代码通过 typeof process && process.env && process.env.PETRI_DESKTOP
// 检测桌面版，但 contextIsolation:true + nodeIntegration:false 下
// 渲染进程没有 process 对象。通过 contextBridge 暴露让其检测通过。
contextBridge.exposeInMainWorld('process', {
  env: {
    PETRI_DESKTOP: '1',
    NODE_ENV: 'production',
  },
});

// BLOCK-61 品牌桥：主全局名 petri；petriDesktop 为兼容别名（同一 surface
// 双暴露，desktopBridge 双读），过渡期后评估移除。
const desktopBridgeSurface = {
  // 平台标识
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  // BLOCK-101 P0 — 启动 timeline 桥（纯观测）：渲染层四段 marks 汇总上报 +
  // 主进程 marks 拉取（flow 用）。沙箱 preload 禁跨文件 require，通道按本文件
  // 既有家法用字面量（与 src/ipc/channels.js startup 域保持一致）。
  // preload 执行时刻改由主进程 did-start-loading 打点（timeOrigin 跨进程语义
  // 不一致曾致负天文数字——渲染层自算不可靠）。
  startup: {
    report: (payload) => ipcRenderer.send('startup:report', payload),
    marks: () => ipcRenderer.invoke('startup:marks'),
  },
  // BLOCK-100 — 测试实例标记（主进程经 webPreferences.additionalArguments 注入
  // --petri-test-instance=1）。严格 === true 判定：投影 shim 的 Proxy 属性访问
  // 返回 callable proxy（truthy 但非 true），不会误亮测试徽标。
  __testInstance: process.argv.includes('--petri-test-instance=1'),
  // UI-421 — 测试实例管理模式快捷键透传（主进程 _window-create.js 注入实际生效
  // 的组合键；默认 Ctrl+Alt+Shift+M，PETRI_TEST_MANAGE_SHORTCUT 可覆盖）。
  __testManageShortcut:
    (process.argv.find((a) => a.startsWith('--petri-test-manage-shortcut=')) || '').split('=')[1] || null,
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
    // BLOCK-100/UI-411 — 测试实例窗口管理（仅测试实例前端会调用）
    setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:set-always-on-top', flag),
    setIgnoreMouseEvents: (flag) => ipcRenderer.invoke('window:set-ignore-mouse-events', flag),
    onTestManageModeChanged: (callback) => {
      const listener = (_event, manageMode) => callback(manageMode);
      ipcRenderer.on('window:test-manage-mode-changed', listener);
      return () => ipcRenderer.removeListener('window:test-manage-mode-changed', listener);
    },

    // 页面缩放（无边框窗口：菜单 Zoom 角色不可达，故显式暴露）。
    // delta 为 zoomLevel 步长，可为小数（滚轮平滑缩放用），正数放大。
    zoomBy: (delta) => ipcRenderer.send('window:zoom-by', Number(delta) || 0),
    zoomReset: () => ipcRenderer.send('window:zoom-reset'),
    getZoomLevel: () => {
      try {
        return Promise.resolve(ipcRenderer.invoke('window:get-zoom')).then((value) =>
          typeof value === 'number' ? value : 0,
        );
      } catch (error) {
        return Promise.reject(error);
      }
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
    /** UI-385 — 独立窗下钻通道：把载荷转发到主窗（右栏打开结果/智能体）。 */
    openResultInMainWindow: (payload) => ipcRenderer.invoke('window:open-result-in-main', payload),
    /** UI-385 — 主窗接收 relay（白名单类型 → DOM CustomEvent，与 lib/events 同名）。 */
    onRelayToMain: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('window:relay-to-main', listener);
      return () => ipcRenderer.removeListener('window:relay-to-main', listener);
    },
  },

  // 应用级控制 — 装完运行时后需整体重启（PETRI_R_HOME 在 main 启动时固化，
  // 只重启 petri-server 不够，必须重新解析 runtime 路径）
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

  // Harness 能力预备 — Stage 3 M1：只读，展示已自备的运行时/包 bundle
  harnessCapabilities: {
    list: () => ipcRenderer.invoke('harness-capabilities:list'),
  },

  // 插件管理（BLOCK-158 商店面退役：仅存目录读面；安装/卸载/更新 = 领域包通道 pack:*）
  plugins: {
    listInstalled: () => ipcRenderer.invoke('plugin:list-installed'),
    listRemote: () => ipcRenderer.invoke('plugin:list-remote'),
  },

  // BLOCK-84：领域包一键装/卸桥（记录制；装/卸后需重启生效）
  // BLOCK-86 P1：卸载走契约推导编排——uninstallPlan 给确认弹层供数据（运行时
  // 回收体积/共享保留/包源），uninstall 的 options 三档显式勾选（缺省全保留）；
  // onInstallProgress 订阅运行时下载进度（main → pack:install-progress）。
  packs: {
    listInstalled: () => ipcRenderer.invoke('pack:list-installed'),
    listAvailable: () => ipcRenderer.invoke('pack:list-available'),
    installFromDialog: () => ipcRenderer.invoke('pack:install-from-dialog'),
    installPath: (packRoot) => ipcRenderer.invoke('pack:install-path', packRoot),
    uninstallPlan: (packId) => ipcRenderer.invoke('pack:uninstall-plan', packId),
    // BLOCK-158 — 运行时补装（包卡片「必需 · 缺失」补装；进度走 onInstallProgress 事件）
    installRuntime: (pluginId) => ipcRenderer.invoke('pack:install-runtime', pluginId),
    uninstall: (packId, options) => ipcRenderer.invoke('pack:uninstall', packId, options),
    // BLOCK-157 加映（UI-481）— 整包启停（停用即不接线/启用免重装；重启后生效）
    setEnabled: (packId, enabled) => ipcRenderer.invoke('pack:set-enabled', packId, enabled),
    onInstallProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('pack:install-progress', listener);
      return () => ipcRenderer.removeListener('pack:install-progress', listener);
    },
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
    // UI-400-2 — 导出/下载：主进程保存对话框 + 受限本机来源流式写盘
    downloadFromUrl: (url, name) =>
      ipcRenderer.invoke('file:download-from-url', { url, name }),
    // UI-453 加映二 — OS 拖出导出：dragstart 时请主进程接管为真文件拖拽
    // （webContents.startDrag；本地直接拖源文件=复制语义，ssh 先拉临时文件）
    startFileDrag: (payload) =>
      ipcRenderer.invoke('file:start-drag', payload),
    // UI-444 加映 — 文本另存为：原生保存对话框（用户确认位置）+ 主进程写所选路径
    saveTextFile: (defaultName, content) =>
      ipcRenderer.invoke('file:save-text-file', { defaultName, content }),
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
    startSession: (targetPath, sessionId, ssh) =>
      ipcRenderer.invoke(
        'terminal:session-start',
        ssh
          ? { sessionId, targetPath, ssh }
          : sessionId
            ? { sessionId, targetPath }
            : targetPath
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
    // BLOCK-156 D7 — 第三方技能本地目录导入（对话框一条龙；canceled=用户取消非错误）
    importDirectory: () => ipcRenderer.invoke('skills:import-directory'),
    importPath: (dir) => ipcRenderer.invoke('skills:import-path', String(dir ?? '')),
    // BLOCK-160 W2 P5（DIST-2）— MCP 配置文件导入（对话框/直路径）
    mcpConfigImportDialog: () => ipcRenderer.invoke('mcp-config:import-dialog'),
    mcpConfigImportPath: (filePath) => ipcRenderer.invoke('mcp-config:import-path', String(filePath ?? '')),
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

  // BLOCK-67 加映（UI-326）— IP+密码 引导连接（密码只在主进程内存中用于一次性装公钥，绝不存储）
  ssh: {
    registerHost: (params) => ipcRenderer.invoke('ssh:register-host', params || {}),
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
    // UI-449（C-16）— 审阅徽章 ±行数权威源
    workingTreeShortstat: (params) => ipcRenderer.invoke('git:working-tree-shortstat', params || {}),
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
    // BLOCK-176 CP-17 — 工作树 checkpoint 安全网（创建/回滚）
    checkpointCreate: (params) => ipcRenderer.invoke('git:checkpoint-create', params || {}),
    checkpointRollback: (params) => ipcRenderer.invoke('git:checkpoint-rollback', params || {}),
    remoteList: (params) => ipcRenderer.invoke('git:remote-list', params || {}),
    remoteStatus: (params) => ipcRenderer.invoke('git:remote-status', params || {}),
    push: (params) => ipcRenderer.invoke('git:push', params || {}),
    pull: (params) => ipcRenderer.invoke('git:pull', params || {}),
    // BLOCK-53 P2 — 非 git 工作区一次性引导：git init + 初始提交（幂等，已 init 时 alreadyGit）
    initRepository: (params) => ipcRenderer.invoke('git:init-repository', params || {}),
  },
  genUi: {
    // BLOCK-166 — Gen UI 卡片准备：主进程做 workspace 归属/scope 包含/1MB 校验后
    // 返回独立 origin 沙箱页 URL（petri-genui://gen-<id>/index.html）或结构化错误。
    prepare: (payload) => ipcRenderer.invoke('gen-ui:prepare', payload || {}),
    // BLOCK-166 P1 — guest 桥 RPC 中继（GenUiCard 把沙箱页 postMessage 转成这两路）：
    // set-state = widgetState 内存落主进程（≤16KiB）；open-external = 绝对 http(s) 白名单。
    setState: (payload) => ipcRenderer.invoke('gen-ui:set-state', payload || {}),
    openExternal: (payload) => ipcRenderer.invoke('gen-ui:open-external', payload || {}),
    // BLOCK-166 P2 — 复制图片：渲染层提交卡片可视区域，主进程校验后 capturePage→剪贴板。
    copyImage: (payload) => ipcRenderer.invoke('gen-ui:copy-image', payload || {}),
    // BLOCK-174 CP-13b — fragment 导出（读会话原文交渲染层另存）。
    exportFragment: (payload) => ipcRenderer.invoke('gen-ui:export', payload || {}),
    // BLOCK-174 CP-11 — artifact/job 数据面只读绑定（guest getData 中继落点）。
    getData: (payload) => ipcRenderer.invoke('gen-ui:get-data', payload || {}),
  },
};

contextBridge.exposeInMainWorld('petri', desktopBridgeSurface);
// 兼容别名：历史全局名（desktopBridge 读新优先、旧名兜底）
contextBridge.exposeInMainWorld('petriDesktop', desktopBridgeSurface);

// ── Ctrl/Cmd + 滚轮 → 页面缩放 ────────────────────────────────
// 无边框窗口没有菜单栏，Electron 的 zoomIn/zoomOut 菜单角色快捷键不可达，
// 所以在 preload 里挂全局 wheel 监听：对任何加载本脚本的窗口都生效（含
// BLOCK-59 弹出窗），且不依赖 React 路由。经 window:zoom-by 驱动主进程缩放。
// 用 requestAnimationFrame 合并同一帧内的滚轮增量，避免高频事件打爆 IPC。
(function setupCtrlWheelZoom() {
  const ZOOM_PER_100PX = 0.5; // 每 100px 滚轮增量对应的 zoomLevel 步进
  const MAX_STEP = 1;         // 单帧最大步进，防止触控板甩动导致跳变

  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return;
  }

  let pendingDelta = 0;
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    const deltaY = pendingDelta;
    pendingDelta = 0;
    if (!deltaY) return;
    const raw = (-deltaY / 100) * ZOOM_PER_100PX;
    const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, raw));
    if (step) ipcRenderer.send('window:zoom-by', step);
  };

  window.addEventListener(
    'wheel',
    (event) => {
      // 仅 Ctrl/Cmd 按住时缩放；macOS 触控板双指捏合同样会带 ctrlKey。
      if (!event.ctrlKey && !event.metaKey) return;
      // 阻止 Chromium 自身的缩放，避免与我们的步进叠加造成双倍缩放。
      event.preventDefault();
      pendingDelta += typeof event.deltaY === 'number' ? event.deltaY : 0;
      if (scheduled) return;
      scheduled = true;
      const raf =
        typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : (fn) => setTimeout(fn, 16);
      raf(flush);
    },
    // passive:false 才能 preventDefault
    { passive: false },
  );
})();
