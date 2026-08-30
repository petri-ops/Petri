'use strict';

/**
 * routes/_helpers/context.js — workflow-state / ai-context 共享 helper
 *
 * 抽自 `core/biof3-server/routes/result-studio.js` PHASE 2.1a 拆分 commit。
 * 类别：基于 runtime resource snapshot + active preview jobs 推导 context-bound
 * preview budget（这是连接 artifact interaction 与 ai-context 的边界函数）。
 *   - buildContextBoundPreviewBudget({ disk, activePreviewJobs }, deps)
 */

const { createRuntimeResourceSnapshot } = require('../../../shared-backend/runtime-resource-snapshot');
const { evaluatePreviewResourceBudget } = require('../../../shared-backend/result-studio-lifecycle');

function buildContextBoundPreviewBudget({ disk = null, activePreviewJobs = 0 } = {}, dependencies = {}) {
  const snapshotFactory = dependencies.createRuntimeResourceSnapshot || createRuntimeResourceSnapshot;
  const budgetEvaluator = dependencies.evaluatePreviewResourceBudget || evaluatePreviewResourceBudget;
  const active = Math.max(0, Math.floor(Number(activePreviewJobs) || 0));
  const snapshot = snapshotFactory({
    disk,
    activeJobs: active,
    estimatedMemoryBytes: null,
  });
  return {
    snapshot,
    budget: {
      ...budgetEvaluator({
        resourceSnapshot: snapshot,
        estimatedMemoryBytes: null,
        estimatedDiskBytes: null,
        activePreviewJobs: active,
      }),
      resourceEstimate: {
        estimateVersion: 1,
        available: false,
        source: 'context_bound_edit_required',
        reason: 'trusted_edit_context_unavailable',
      },
    },
  };
}

module.exports = {
  buildContextBoundPreviewBudget,
};
