'use strict';

// IPC 通道唯一注册表（BLOCK-92 Wave D2，旧 BLOCK-9.6 候选兑现）。
// 纪律：
//  1. 值逐字节等于历史字面量；主进程 handler 一律引用本表，不再手写字符串。
//  2. src/preload.js 保持自包含字面量——sandbox 渲染进程 preload 不能 require 本地模块；
//     两侧漂移由 test/ipc-channels-registry.test.mjs 双向守护（注册表⊆preload、消费方零残留）。
//  3. 新增通道：先在本表登记，再在 preload 增同名包装。

/** @type {Record<string, Record<string, string>>} */
const CHANNELS = {
  agent: {
    taskDone: 'agent:task-done',
  },
  aiSettings: {
    get: 'ai-settings:get',
    getCredential: 'ai-settings:get-credential',
    listModels: 'ai-settings:list-models',
    save: 'ai-settings:save',
    test: 'ai-settings:test',
  },
  app: {
    relaunch: 'app:relaunch',
    softRefresh: 'app:soft-refresh',
  },
  backend: {
    status: 'backend:status',
  },
  branch: {
    active: 'branch:active',
    children: 'branch:children',
    create: 'branch:create',
    delete: 'branch:delete',
    get: 'branch:get',
    list: 'branch:list',
    projectCreate: 'branch:project:create',
    projectGet: 'branch:project:get',
    projectList: 'branch:project:list',
    projectUpdate: 'branch:project:update',
    rename: 'branch:rename',
    switch: 'branch:switch',
  },
  contentPlugin: {
    list: 'content-plugin:list',
    listDocs: 'content-plugin:list-docs',
    read: 'content-plugin:read',
  },
  data: {
    info: 'data:info',
    openDir: 'data:open-dir',
  },
  diagnostic: {
    export: 'diagnostic:export',
  },
  file: {
    listDirectory: 'file:list-directory',
    openDialog: 'file:open-dialog',
    openPath: 'file:open-path',
    openWorkspaceFile: 'file:open-workspace-file',
    downloadFromUrl: 'file:download-from-url',
    // UI-453 加映二 — OS 拖出导出：webContents.startDrag（真文件拖拽）
    startFileDrag: 'file:start-drag',
    saveDialog: 'file:save-dialog',
    saveTextFile: 'file:save-text-file',
    validateDirectory: 'file:validate-directory',
  },
  petri: {
    agentWorkbenchFlags: 'petri:agent-workbench-flags',
  },
  startup: {
    // BLOCK-101 P0 — 启动 timeline 度量：渲染层把四段 marks 汇总上报（send），
    // flow/诊断经 marks 拉取（invoke）读主进程存档。纯观测通道，无业务消费方。
    report: 'startup:report',
    marks: 'startup:marks',
  },
  git: {
    applyInverseHunk: 'git:apply-inverse-hunk',
    blame: 'git:blame',
    branchList: 'git:branch-list',
    checkoutBranch: 'git:checkout-branch',
    commitDiff: 'git:commit-diff',
    commitFileContent: 'git:commit-file-content',
    commitIndex: 'git:commit-index',
    commitLog: 'git:commit-log',
    commitReview: 'git:commit-review',
    discardFile: 'git:discard-file',
    fileHeadContent: 'git:file-head-content',
    hunkApply: 'git:hunk-apply',
    hunkRejectInverse: 'git:hunk-reject-inverse',
    initRepository: 'git:init-repository',
    listModified: 'git:list-modified',
    pull: 'git:pull',
    push: 'git:push',
    remoteList: 'git:remote-list',
    remoteStatus: 'git:remote-status',
    revertFile: 'git:revert-file',
    shortstat: 'git:working-tree-shortstat',
    splitSideDiff: 'git:split-side-diff',
    stagePaths: 'git:stage-paths',
    stashList: 'git:stash-list',
    tagList: 'git:tag-list',
    undoLastCommit: 'git:undo-last-commit',
    unstagePaths: 'git:unstage-paths',
    workingTreeDiff: 'git:working-tree-diff',
    workingTreeFileContent: 'git:working-tree-file-content',
    workingTreeRevert: 'git:working-tree-revert',
    workingTreeStatus: 'git:working-tree-status',
  },
  harnessCapabilities: {
    list: 'harness-capabilities:list',
  },
  message: {
    append: 'message:append',
    clear: 'message:clear',
    count: 'message:count',
    delete: 'message:delete',
    get: 'message:get',
    list: 'message:list',
  },
  pack: {
    installFromDialog: 'pack:install-from-dialog',
    installPath: 'pack:install-path',
    installProgress: 'pack:install-progress',
    installRuntime: 'pack:install-runtime',
    listAvailable: 'pack:list-available',
    listInstalled: 'pack:list-installed',
    setEnabled: 'pack:set-enabled',
    uninstall: 'pack:uninstall',
    uninstallPlan: 'pack:uninstall-plan',
  },
  plugin: {
    // BLOCK-158 商店面退役：仅存目录读面（listInstalled/listRemote=运行时目录投影，
    // 供包卡片运行时标题/体积）；install/uninstall/checkUpdates 随商店面移除，
    // 插件分发 = 领域包通道（pack:*），运行时安装 = 包一键内链 installPlugin。
    listInstalled: 'plugin:list-installed',
    listRemote: 'plugin:list-remote',
  },
  runtime: {
    status: 'runtime:status',
  },
  skills: {
    cancel: 'skills:cancel',
    discover: 'skills:discover',
    execute: 'skills:execute',
    getExecution: 'skills:getExecution',
    progress: 'skills:progress',
    // BLOCK-156 D7 — 第三方技能本地目录导入（对话框一条龙/直路径，复刻 pack 先例）
    importDirectory: 'skills:import-directory',
    importPath: 'skills:import-path',
  },
  // BLOCK-160 W2 P5（DIST-2）— MCP 配置文件导入（对话框/直路径；写面走 core
  // mcp-settings helper 经 CAP-2 加密落盘，读面 HTTP /api/mcp/servers 不变）
  mcpConfig: {
    importDialog: 'mcp-config:import-dialog',
    importPath: 'mcp-config:import-path',
  },
  ssh: {
    registerHost: 'ssh:register-host',
  },
  telemetry: {
    report: 'telemetry:report',
  },
  terminal: {
    data: 'terminal:data',
    exit: 'terminal:exit',
    openLogDir: 'terminal:open-log-dir',
    openShell: 'terminal:open-shell',
    sessionList: 'terminal:session-list',
    sessionResize: 'terminal:session-resize',
    sessionStart: 'terminal:session-start',
    sessionStop: 'terminal:session-stop',
    sessionWrite: 'terminal:session-write',
    snapshot: 'terminal:snapshot',
  },
  updater: {
    check: 'updater:check',
    download: 'updater:download',
    downloadProgress: 'updater:download-progress',
    error: 'updater:error',
    install: 'updater:install',
    updateAvailable: 'updater:update-available',
    updateDownloaded: 'updater:update-downloaded',
    updateNotAvailable: 'updater:update-not-available',
  },
  window: {
    close: 'window:close',
    fullscreenChanged: 'window:fullscreen-changed',
    getZoom: 'window:get-zoom',
    isFullScreen: 'window:isFullScreen',
    isMaximized: 'window:isMaximized',
    maximize: 'window:maximize',
    maximizeChanged: 'window:maximize-changed',
    minimize: 'window:minimize',
    openResultInMain: 'window:open-result-in-main',
    popOut: 'window:pop-out',
    railMouse: 'window:rail-mouse',
    relayToMain: 'window:relay-to-main',
    remove: 'window:remove',
    restore: 'window:restore',
    return: 'window:return',
    self: 'window:self',
    // BLOCK-100/UI-411 — 测试实例窗口管理（handler 有 PETRI_TEST_INSTANCE 守卫，
    // 用户实例调用恒拒绝）：置顶切换 + 鼠标穿透开关（forward:true）。
    setAlwaysOnTop: 'window:set-always-on-top',
    setIgnoreMouseEvents: 'window:set-ignore-mouse-events',
    testManageModeChanged: 'window:test-manage-mode-changed',
    snapshot: 'window:snapshot',
    stateChanged: 'window:state-changed',
    thumbnail: 'window:thumbnail',
    toggleFullScreen: 'window:toggleFullScreen',
    zoomBy: 'window:zoom-by',
    zoomReset: 'window:zoom-reset',
  },
  workspace: {
    writeTextFile: 'workspace:write-text-file',
  },
};

module.exports = CHANNELS;
