'use strict';

/**
 * agent-tools/harness-tools.js — harness 域工具执行面（BLOCK-346 方向2）。
 *
 * 只接「计划生成」（只读）：复用 routes/_helpers/harness-shared 的索引装配与
 * shared-backend/scientific-task-planner 的纯函数规划器，不复制一份 HTTP 调用。
 *
 * 惰性 require：harness 索引模块是 ESM（scripts/harness-file-index.mjs），
 * 且装载依赖桌面根目录存在 —— 模块加载期绑定会让工具面在脚本/测试环境直接崩。
 */

async function tool_harness_plan_task(args = {}, ctx = {}) {
  const taskSpec = args && args.taskSpec;
  if (!taskSpec || typeof taskSpec !== 'object' || Array.isArray(taskSpec)) {
    return { ok: false, error: 'missing_task_spec', message: 'taskSpec 必须是对象（至少含 projectId）' };
  }
  const projectId = String(
    (taskSpec && taskSpec.projectId) || ctx.projectId || '',
  ).trim();
  if (!projectId) {
    return { ok: false, error: 'missing_project_id', message: 'taskSpec.projectId 必填（计划需要项目范围内的资产索引）' };
  }

  try {
    const { loadHarnessModule, availableHarnessManifests } = require('../routes/_helpers/harness-shared');
    const { planScientificTaskFromIndex } = require('../../shared-backend/scientific-task-planner');

    const harness = await loadHarnessModule();
    const scoped = harness.indexHarnessScope({
      userId: ctx.userId || null,
      projectId,
      scope: 'project',
      hash: true,
    });
    const plan = planScientificTaskFromIndex({
      taskSpec,
      index: scoped.index,
      manifests: availableHarnessManifests(),
      runtime: args.runtime || null,
    });
    return { ok: true, projectId, scope: scoped.scope, plan };
  } catch (error) {
    // 诚实降级：环境缺索引模块/桌面根目录时如实报不可用，不返回空计划冒充成功
    return {
      ok: false,
      error: 'harness_unavailable',
      message: `harness 索引不可用：${error && error.message ? error.message : String(error)}`,
    };
  }
}

module.exports = { tool_harness_plan_task };
