'use strict';

/**
 * item88 子任务隔离（设计稿 §4.2①）。选型=git worktree（治理档 active），
 * 目录副本/cp 被治理禁止；合并只出 diff 交既有评审面，不自动 merge。
 */

function safeTaskId(taskId) {
  return String(taskId == null ? '' : taskId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function deriveTaskWorktree({ dataDir, taskId } = {}) {
  const id = safeTaskId(taskId);
  if (!id) throw new Error('workbench_task_id_required');
  const root = require('node:path').join(String(dataDir || ''), 'worktrees', `wb-${id}`);
  return { root, branch: `workbench/${id}`, taskId };
}

/** 重复 root/branch 一律拒绝（fail-closed），对应 worktree-contract 的 checkContract 语义。 */
function checkTaskWorktreeConflict(registry, request) {
  const violations = [];
  for (const item of registry || []) {
    if (!item || !request) continue;
    if (item.root === request.root) violations.push('duplicate_root');
    if (item.branch === request.branch) violations.push('duplicate_branch');
  }
  return violations;
}

module.exports = { safeTaskId, deriveTaskWorktree, checkTaskWorktreeConflict };
