'use strict';

/**
 * routes/result-studio.js — thin facade（PHASE 2.1b）
 *
 * 历史背景：原文件 1246 行 27 端点，按 PHASE 2 调研拆分到 `routes/result-studio/`
 * 子目录 9 个子域文件。本文件作为 facade：
 *
 *   1. 兼容既有 `require('./result-studio')(app)` 调用方（routes/index.js 第 41 行）
 *   2. 兼容既有 `route._test.<helper>` 测试（result-studio-route-baseline.test.mjs
 *      + routes-result-studio-facade.test.mjs）—— 纯转发到 `routes/_helpers/*`
 *   3. 真实端点注册在 `routes/result-studio/index.js` 内部进行
 *
 * 重要：主文件保持"无端点"——所有 27 端点 100% 由子域模块注册。这样以后修改
 * 子域不需要修改本文件，PHASE 2.2/2.3 拆分 harness / ai-agent 时本 facade 模式
 * 可直接复用。
 */

const { register } = require('./result-studio/index');

/**
 * thin facade `register(app)` 函数：直接委托 index.js 的注册逻辑。
 *
 * 之所以包一层而不是 `module.exports = register`，是因为 `routes/index.js` 第 41
 * 行按 `require('./result-studio')(app)` 调用，如果 export 直接是 `register`,
 * `module.exports = register` 后 `_test` 必须 attach 到函数本身。两种方式都 OK，
 * 但保留 `registerResultStudioRoutes` 命名更显式：让 routes/index.js 的 try/catch
 * 失败时日志清楚显示失败的是 "registerResultStudioRoutes"。
 */
function registerResultStudioRoutes(app) {
  return register(app);
}

// 兼容既有测试：test/result-studio-route-baseline.test.mjs:13-26 + facade.test.mjs:9-25
require('./_helpers/validate');
const repository = require('./_helpers/repository');
const format = require('./_helpers/format');
const context = require('./_helpers/context');
const storage = require('./_helpers/storage');
const workflow = require('./_helpers/workflow');

module.exports = registerResultStudioRoutes;
module.exports._test = {
  attachExistingRepositoryWithExplicitConsent: workflow.attachExistingRepositoryWithExplicitConsent,
  baselineFailureDiagnostic: workflow.baselineFailureDiagnostic,
  bindAuthoritativeQuerySelection: workflow.bindAuthoritativeQuerySelection,
  buildContextBoundPreviewBudget: context.buildContextBoundPreviewBudget,
  findArtifactRecord: repository.findArtifactRecord,
  openVerifiedRevisionArtifact: storage.openVerifiedRevisionArtifact,
  publicResultStudioErrorMessage: format.publicResultStudioErrorMessage,
  resolveArtifactPath: workflow.resolveArtifactPath,
  resolveInteractionBaselineRevision: workflow.resolveInteractionBaselineRevision,
  verifyArtifactRecordBytes: repository.verifyArtifactRecordBytes,
};
