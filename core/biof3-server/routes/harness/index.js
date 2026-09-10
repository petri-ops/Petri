'use strict';

/**
 * routes/harness/index.js — 子域注册中心（PHASE 2.2a）
 *
 * 汇总 8 个子域文件的 register(app) 函数，按原 routes/harness.js 端点声明顺序调用：
 *   resources → workflow → repair → scientific-task → context → file-references → loop
 *
 * 端点声明顺序敏感性：
 *   - 必须在 AI Loop API 之后（routes/index.js 第 38-39 行），避免被 ai-loop catch-all
 *     吞掉 GET /api/loop/:loopRunId
 *   - 必须在 Tools/ResultStudio 之前（routes/index.js 第 39-41 行），保持既有 mount 顺序
 *
 * 共享闭包变量：
 *   - `recoveryConfirmations` Map（TTL 5min）保留在 `routes/harness/workflow.js`
 *     闭包内部，跨 workflow/action 与 workflow/status 两端点共享
 *
 * 共享 helper 抽到 `routes/_helpers/harness-shared.js` + `routes/_helpers/workspace-file-index.js`。
 */

const resources = require('./resources');
const workflow = require('./workflow');
const repair = require('./repair');
const scientificTask = require('./scientific-task');
const context = require('./context');
const fileReferences = require('./file-references');
const loop = require('./loop');
const projectStorage = require('./project-storage');

module.exports = {
  register(app) {
    if (typeof app.get !== 'function') {
      throw new Error('routes/harness/index register requires an Express app');
    }
    // 端点声明顺序与原 routes/harness.js 完全一致（resources → workflow → repair →
    // scientific-task → context → file-references → loop）；保证 Express first-match
    // 行为不变（route order sensitivity）。project-storage 为 BLOCK-78 P2-③
    // 新增端点，无既有顺序约束。
    resources.register(app);
    workflow.register(app);
    repair.register(app);
    scientificTask.register(app);
    context.register(app);
    fileReferences.register(app);
    loop.register(app);
    projectStorage.register(app);
  },

  // 子模块 surface（方便测试与子域调试；非注册中心运行时使用）
  _submodules: {
    resources,
    workflow,
    repair,
    scientificTask,
    context,
    fileReferences,
    loop,
    projectStorage,
  },
};
