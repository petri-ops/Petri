'use strict';

/**
 * routes/harness.js — thin facade（PHASE 2.2a）
 *
 * 历史背景：原文件 1366 行 19 端点，按 PHASE 2 调研拆分到 `routes/harness/`
 * 子目录 8 个子域文件（含 1 个 facade index.js）。本文件作为 facade：
 *
 *   1. 兼容既有 `require('./harness')(app)` 调用方（routes/index.js 第 39 行）
 *   2. 真实端点注册在 `routes/harness/index.js` 内部进行
 *
 * 重要：主文件保持"无端点"——所有 19 端点 100% 由子域模块注册。这样以后修改
 * 子域不需要修改本文件。
 *
 * 子域文件：
 *   - resources.js       (2 端点: resource-snapshot + index)
 *   - workflow.js        (3 端点: workflow/action + workflow/status + workflow/plan)
 *   - repair.js          (1 端点: repair)
 *   - scientific-task.js (8 端点: plan + confirmation-preview + confirm + 4 CRUD + delivery-manifest + replay-package)
 *   - context.js         (1 端点: context-checkpoint)
 *   - file-references.js (1 端点: file-references/resolve)
 *   - loop.js            (3 端点: loop/iterate + loop/:loopRunId + loop/snapshot)
 *
 * 共享 helper 抽到 `routes/_helpers/harness-shared.js` + `routes/_helpers/workspace-file-index.js`。
 * 共享闭包变量 `recoveryConfirmations` Map 保留在 `routes/harness/workflow.js` 闭包内部。
 */

const { register } = require('./harness/index');

/**
 * thin facade `register(app)` 函数：直接委托 index.js 的注册逻辑。
 *
 * 保留 `registerHarnessRoutes` 命名让 routes/index.js 的 try/catch 失败时日志清楚
 * 显示失败的是 "registerHarnessRoutes"。
 */
function registerHarnessRoutes(app) {
  return register(app);
}

module.exports = registerHarnessRoutes;
