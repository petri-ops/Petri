/**
 * .dependency-cruiser.cjs — BLOCK-105 P3 架构规范机械化
 *
 * 把 AGENTS.md 的架构规范从「靠人守」转可执行规则。规则集：
 *   R1 渲染进程（frontend/src）禁止直接 import electron——IPC 必经 preload 暴露的
 *      desktopBridge（frontend/src/lib/desktopBridge.ts 唯一通道）；
 *   R2 渲染进程禁止直接 import node 内建模块（sandbox 渲染器无 node 上下文）；
 *   R3 后端（core/）禁止 import Electron 主进程（src/）——core 由独立 node 进程
 *      运行，反向依赖即架构破坏；
 *   R4 前端禁止 import 后端源码（core/）——前后端边界是 REST/API，不是源码共享；
 *   R5 Electron 主进程（src/）禁止 import 后端实现（core/biof3-server/**）——
 *      后端生命周期由 backend-proc-manager 独立管理（单后端收敛 BLOCK-30 承诺）。
 * D4 裁决：先 report-only 一轮清误报，然后 blocked 转门禁（npm run quality:arch）。
 */
module.exports = {
  forbidden: [
    {
      name: 'R1-renderer-no-electron-direct',
      comment: '渲染进程 IPC 必经 desktopBridge（preload 桥），禁止直连 electron',
      severity: 'error',
      from: { path: '^frontend/src' },
      to: { path: '^electron$' },
    },
    {
      name: 'R2-renderer-no-node-builtins',
      comment: 'sandbox 渲染器无 Node 上下文，禁止 node: 内建（config 文件除外）',
      severity: 'error',
      from: { path: '^frontend/src' },
      to: { path: '^node:' },
    },
    {
      name: 'R3-core-no-electron-main',
      comment: '后端独立 node 进程运行，禁止反向依赖 Electron 主进程。唯一登记桥：src/main/env-coordinator（A-009 端口单一真相，config.js/server.js 有意引用）——新桥必须登记。',
      severity: 'error',
      from: { path: '^core' },
      to: { path: '^src', pathNot: ['src/main/env-coordinator\\.js$'] },
    },
    {
      name: 'R4-frontend-no-backend-source',
      comment: '前后端边界是 REST/API，前端禁止 import 后端实现（core/biof3-server）；core/packages/** 是前后端共享层，合法。',
      severity: 'error',
      from: { path: '^frontend/src' },
      to: { path: '^core', pathNot: ['core/packages/'] },
    },
    {
      name: 'R5-main-no-backend-impl',
      comment: '后端生命周期归 backend-proc-manager，主进程禁止 import 后端实现',
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^core/biof3-server' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,

    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
