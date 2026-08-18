'use strict';

/**
 * routes/result-studio/index.js — 子域注册中心
 *
 * PHASE 2.1a：仅占位聚合 9 个子域 stub + 重新 export 共享 helpers。
 * PHASE 2.1b：会把 9 子域下沉的真端点（27 个）按 declared 顺序注册，
 *   并把 routes/result-studio.js 主文件降为 thin facade。
 *
 * 顺序约束（与调研报告 §2.1 / 端点声明顺序一致）：
 *   repository → interaction → selection → context → changesets
 *   → revisions → storage → workspace → preview-budget
 */

module.exports = {
  /**
   * PHASE 2.1a：占位 register 函数，不真正挂任何路由。
   * 主文件 routes/result-studio.js 仍负责 27 个端点的注册。
   */
  register(app /* , options */) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/index register requires an Express app');
    }
    // 子模块注册（顺序与原 routes/result-studio.js 端点声明顺序一致）
    // PHASE 2.1b 才会真正调用每个 module.register(app, options)；
    // 这里仅 require 触发加载 + 拓扑验证，不传 app 到 stub。
    require('./repository');
    require('./interaction');
    require('./selection');
    require('./context');
    require('./changesets');
    require('./revisions');
    require('./storage');
    require('./workspace');
    require('./preview-budget');
  },

  // 子模块引用（PHASE 2.1b 主文件降 thin facade 后会用到）
  _submodules: {
    repository: () => require('./repository'),
    interaction: () => require('./interaction'),
    selection: () => require('./selection'),
    context: () => require('./context'),
    changesets: () => require('./changesets'),
    revisions: () => require('./revisions'),
    storage: () => require('./storage'),
    workspace: () => require('./workspace'),
    'preview-budget': () => require('./preview-budget'),
  },

  // 共享 helpers（兼容既有测试 + PHASE 2.1b 主文件 facade 拉取）
  _helpers: {
    validate: () => require('../_helpers/validate'),
    repository: () => require('../_helpers/repository'),
    format: () => require('../_helpers/format'),
    context: () => require('../_helpers/context'),
    storage: () => require('../_helpers/storage'),
    workflow: () => require('../_helpers/workflow'),
  },
};
