'use strict';

/**
 * G0-RS-P3 — context-bound Result Studio 编辑编排工具。
 *
 * 与 `result-edit-tools.js` 的关系：那里是 RS4～RS6 的**原始 CRUD 通道**，
 * 要求调用方精确给出 toolJobId / revisionId / changeSetId / artifactFamilyId。
 * 这里不重新实现任何编辑语义，只做两件事：
 *
 * 1. 用 `resolveResultStudioContext` 把当前 UI 状态 + 后端真相投影成
 *    ResultStudioContextEnvelope，替模型补齐全部内部 ID；
 * 2. 用 `authorizeContextOperation` 校验模型带回的 contextToken，
 *    陈旧上下文 fail-closed 拒绝，然后把参数转交给既有实现。
 *
 * 因此不存在第二套执行真相：ChangeSet / Job / Artifact / Revision 仍然只由
 * result-changeset-service 与 result-compare-service 产生。
 */

const {
  resolveResultStudioContext,
  resolveContextChangeSet,
  guardContextOperation,
} = require('./result-context-tools');
const { createResultEditPlanTool, createResultChangeSetTools } = require('./result-edit-tools');
const { projectPublicEditPhase, PUBLIC_EDIT_PHASES } = require('../../shared-backend/result-studio-context');

/** 公开进度：只暴露阶段结论，不暴露隐藏推理链或 Git 细节。 */
function publicProgress(events) {
  if (!Array.isArray(events)) return [];
  const seen = new Set();
  const phases = [];
  for (const event of events) {
    const projected = projectPublicEditPhase(event && event.stage, event && event.status);
    if (!projected.phase || seen.has(projected.phase)) continue;
    seen.add(projected.phase);
    phases.push({ phase: projected.phase, label: projected.label });
  }
  return phases;
}

function contextView(envelope) {
  return {
    contextToken: envelope.contextToken,
    artifactName: envelope.artifact.name,
    tool: envelope.job.toolId,
    revisionOrdinal: envelope.revision.revisionOrdinal,
    selectionEntityCount: envelope.selection ? envelope.selection.entityIdCount : 0,
  };
}

/**
 * 构建 context-bound 工具集合。
 *
 * @param {object} options 注入依赖（测试用）：db / getToolJob / getPluginManifest /
 *   repository / getProject / planTool / changeSetTools
 */
function createResultContextEditTools(options = {}) {
  const planTool = options.planTool || createResultEditPlanTool(options);
  const changeSetTools = options.changeSetTools || createResultChangeSetTools(options);

  /**
   * 只读规划：用户只说想要什么，坐标由上下文补齐。
   *
   * 规划是只读的，因此不强制 contextToken —— 第一次调用时模型还没有 token。
   */
  async function plan(args = {}, ctx = {}) {
    const guarded = guardContextOperation(ctx, args, options, { requireToken: false });
    if (!guarded.ok) return guarded.response;
    const envelope = guarded.resolved.envelope;
    const planned = await planTool({
      toolJobId: envelope.job.toolJobId,
      artifactId: envelope.artifact.artifactId,
      revisionId: envelope.revision.revisionId,
      requestedOutcome: args.requestedOutcome,
      requestedEditClass: args.requestedEditClass,
      proposedParameterPatch: args.proposedParameterPatch,
      workflowPlan: args.workflowPlan,
      selectionId: envelope.selection ? envelope.selection.selectionId : undefined,
      userMessageId: args.userMessageId,
    }, ctx);
    return {
      ...planned,
      context: contextView(envelope),
      publicPhase: projectPublicEditPhase(planned.ok ? 'plan' : 'intent').phase,
      publicPhases: [...PUBLIC_EDIT_PHASES],
    };
  }

  /** 创建候选：必须带 token，避免把修改落到已经切换掉的结果上。 */
  async function create(args = {}, ctx = {}) {
    const guarded = guardContextOperation(ctx, args, options);
    if (!guarded.ok) return guarded.response;
    const envelope = guarded.resolved.envelope;
    const intent = args.intent;
    if (!intent || typeof intent !== 'object') {
      return { ok: false, error: 'intent_required', message: '需要 result_edit_plan_in_context 返回的完整 intent。' };
    }
    // intent 必须仍然指向当前上下文，否则模型可能拿旧 plan 改新结果。
    const ref = intent.artifactRef || {};
    if (ref.artifactId !== envelope.artifact.artifactId || ref.revisionId !== envelope.revision.revisionId) {
      return {
        ok: false,
        error: 'context_intent_mismatch',
        message: '该修改计划不属于当前打开的结果版本；请重新规划。',
        remediation: 'result_edit_plan_in_context',
      };
    }
    const created = await changeSetTools.create(args, ctx);
    return {
      ...created,
      context: contextView(envelope),
      publicProgress: publicProgress(created && created.progress),
    };
  }

  function bindChangeSet(args, resolved) {
    return resolveContextChangeSet({
      repository: resolved.repository,
      projectId: resolved.envelope.projectId,
      artifactFamilyId: resolved.envelope.artifact.artifactFamilyId,
      changeSetId: args.changeSetId,
    });
  }

  function contextBoundChangeSetCall(delegate, { requireToken }) {
    return async function call(args = {}, ctx = {}) {
      const guarded = guardContextOperation(ctx, args, options, { requireToken });
      if (!guarded.ok) return guarded.response;
      const bound = bindChangeSet(args, guarded.resolved);
      if (!bound.ok) return bound;
      const delegated = await delegate({ ...args, changeSetId: bound.changeSet.changeSetId }, ctx);
      return {
        ...delegated,
        context: contextView(guarded.resolved.envelope),
        ...(delegated && delegated.changeSet
          ? { publicProgress: publicProgress([{ stage: 'preview', status: 'ready' }]) }
          : {}),
      };
    };
  }

  return {
    plan,
    create,
    status: contextBoundChangeSetCall((args, ctx) => changeSetTools.status(args, ctx), { requireToken: false }),
    compare: contextBoundChangeSetCall((args, ctx) => changeSetTools.compare(args, ctx), { requireToken: false }),
    adopt: contextBoundChangeSetCall((args, ctx) => changeSetTools.adopt(args, ctx), { requireToken: true }),
    revert: contextBoundChangeSetCall((args, ctx) => changeSetTools.revert(args, ctx), { requireToken: true }),
  };
}

const contextEditTools = createResultContextEditTools();

module.exports = {
  publicProgress,
  createResultContextEditTools,
  tool_result_edit_plan_in_context: contextEditTools.plan,
  tool_result_changeset_create_in_context: contextEditTools.create,
  tool_result_changeset_status_in_context: contextEditTools.status,
  tool_result_changeset_compare_in_context: contextEditTools.compare,
  tool_result_changeset_adopt_in_context: contextEditTools.adopt,
  tool_result_changeset_revert_in_context: contextEditTools.revert,
  resolveResultStudioContext,
};
