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
const { normalizeEditSubmission, explainEditImpact } = require('../../shared-backend/result-edit-controls');
const {
  tool_result_enrichment_from_revision,
  tool_result_selection_run,
} = require('./result-selection-tools');

// A context-bound intent is executable only in the Agent turn that received
// the trusted plan. The model sees the JSON intent but cannot register or
// replace this server-side copy. A restart/context change therefore requires
// a fresh plan, which is the safe failure mode.
const trustedIntentsByContext = new WeakMap();

function rememberTrustedIntent(ctx, envelope, intent) {
  if (!ctx || typeof ctx !== 'object' || !intent || typeof intent !== 'object' || !intent.intentId) return;
  let registry = trustedIntentsByContext.get(ctx);
  if (!registry) {
    registry = new Map();
    trustedIntentsByContext.set(ctx, registry);
  }
  registry.set(intent.intentId, {
    contextToken: envelope.contextToken,
    intent: JSON.parse(JSON.stringify(intent)),
  });
  while (registry.size > 8) registry.delete(registry.keys().next().value);
}

function trustedIntentFor(ctx, intentId) {
  return ctx && typeof ctx === 'object'
    ? trustedIntentsByContext.get(ctx)?.get(intentId) || null
    : null;
}

// Providers sometimes merge the plan tool's sibling projections (`source`,
// `diagnostics`, `impact`, ...) into the intent object on the next structured
// call. Authenticate every field of the sealed server-side intent and ignore
// only non-canonical additions. The downstream service receives the sealed
// copy, so an added field can never acquire execution semantics.
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

function bindCurrentSelectionAsVolcanoLabels(args, resolved, envelope) {
  if (args?.useCurrentSelectionForLabels !== true) return { ok: true, patch: null };
  const selection = resolved?.persistedSelection;
  if (envelope?.artifact?.idField !== 'gene' || !selection
      || envelope.selection?.compatibility !== 'compatible'
      || selection.entityIdsTruncated === true
      || !Array.isArray(selection.entityIds)) {
    return {
      ok: false,
      error: 'selection_label_binding_unavailable',
      message: '当前选择不是这个正式基因结果的完整兼容选择，不能据此修改火山图标签。',
    };
  }
  const entityIds = [...new Set(selection.entityIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (entityIds.length === 0 || entityIds.length > 100 || entityIds.join(',').length > 8000) {
    return {
      ok: false,
      error: 'selection_label_binding_invalid',
      message: '标签选择必须包含 1–100 个稳定 gene ID，且不能超过安全大小。',
    };
  }
  if (args.proposedParameterPatch?.label_genes != null) {
    return {
      ok: false,
      error: 'selection_label_binding_conflict',
      message: '使用当前选择标注时不能同时提交 label_genes；标签只能从当前受信选择绑定。',
    };
  }
  return { ok: true, patch: { label_genes: entityIds.join(',') } };
}

function emitProgress(ctx, stage, status) {
  if (typeof ctx.emitResultEditProgress !== 'function') return;
  ctx.emitResultEditProgress({
    resultEditProgressVersion: 1,
    changeSetId: '',
    stage,
    status,
  });
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
  const deriveEnrichment = options.resultEnrichmentFromRevision || tool_result_enrichment_from_revision;
  const deriveEnrichmentFromSelection = options.resultSelectionRun || tool_result_selection_run;

  /**
   * 只读规划：用户只说想要什么，坐标由上下文补齐。
   *
   * 规划是只读的，因此不强制 contextToken —— 第一次调用时模型还没有 token。
   */
  async function plan(args = {}, ctx = {}) {
    const guarded = guardContextOperation(ctx, args, options, { requireToken: false });
    if (!guarded.ok) return guarded.response;
    const envelope = guarded.resolved.envelope;
    emitProgress(ctx, 'intent', 'completed');
    emitProgress(ctx, 'plan', 'running');

    // G0-RS-P4：手动控件与 AI 提议共用同一个归一化闸门。任何一方提出的参数
    // 都必须先通过受信 descriptor 的类型/范围/枚举校验，未声明参数一律拒绝。
    // 归一化在 planResultEdit 之前，因此两条来源进入的是同一条编辑链。
    const selectionLabelBinding = bindCurrentSelectionAsVolcanoLabels(args, guarded.resolved, envelope);
    if (!selectionLabelBinding.ok) {
      return { ok: false, status: 'blocked', error: selectionLabelBinding.error, message: selectionLabelBinding.message, context: contextView(envelope) };
    }
    const proposedParameterPatch = {
      ...(args.proposedParameterPatch && typeof args.proposedParameterPatch === 'object' ? args.proposedParameterPatch : {}),
      ...(selectionLabelBinding.patch || {}),
    };
    let submission = null;
    if (Object.keys(proposedParameterPatch).length > 0) {
      submission = normalizeEditSubmission({
        descriptor: guarded.resolved.descriptor,
        proposedValues: proposedParameterPatch,
        origin: args.editOrigin === 'manual' ? 'manual' : 'agent',
        currentValues: guarded.resolved.currentParameters || {},
      });
      if (submission.rejected.length > 0) {
        return {
          ok: false,
          status: 'blocked',
          error: 'edit_parameters_rejected',
          message: '部分参数不在插件声明的可编辑范围内或超出允许取值，已阻断。',
          rejected: submission.rejected,
          diagnostics: submission.diagnostics,
          context: contextView(envelope),
        };
      }
      if (submission.changed.length === 0) {
        return {
          ok: false,
          status: 'blocked',
          error: 'edit_no_effective_change',
          message: '提议的参数与当前生效值相同，不创建候选版本。',
          unchanged: submission.unchanged,
          context: contextView(envelope),
        };
      }
    }

    const planned = await planTool({
      toolJobId: envelope.job.toolJobId,
      artifactId: envelope.artifact.artifactId,
      revisionId: envelope.revision.revisionId,
      requestedOutcome: args.requestedOutcome,
      requestedEditClass: args.requestedEditClass,
      proposedParameterPatch: submission ? submission.patch : args.proposedParameterPatch,
      // Never accept a DAG from model arguments.  The private context payload
      // is freshly projected from durable truth and scientific planning still
      // requires its separately persisted graph snapshot.
      workflowPlan: null,
      selectionId: envelope.selection ? envelope.selection.selectionId : undefined,
      userMessageId: args.userMessageId,
    }, {
      ...ctx,
      // The graph is built by resolveResultStudioContext from durable SQLite
      // Job/Artifact/Selection truth.  It is private tool context, never a
      // model argument and never copied into user-visible chat content.
      resultStudioWorkflowPlan: guarded.resolved.workflowPlan,
      resultStudioWorkflowGraph: guarded.resolved.workflowGraph,
    });
    emitProgress(ctx, 'plan', planned && planned.ok ? 'completed' : 'blocked');
    if (planned && planned.ok && planned.intent) rememberTrustedIntent(ctx, envelope, planned.intent);
    const blockedPlanError = planned?.ok === false && !planned.error
      ? planned.diagnostics?.find((item) => item && typeof item.code === 'string')?.code
        || 'edit_plan_blocked'
      : null;
    return {
      ...planned,
      ...(blockedPlanError ? { error: blockedPlanError } : {}),
      context: contextView(envelope),
      editOrigin: submission ? submission.origin : null,
      selectionLabelsBound: selectionLabelBinding.patch ? selectionLabelBinding.patch.label_genes.split(',').length : 0,
      // 执行前的影响说明：用户在点"生成候选"之前就能看到会不会重算科学结论。
      impact: submission
        ? explainEditImpact(submission.classification, {
          affectedNodeIds: planned.intent?.affectedNodeIds || [],
          affectedScope: planned.intent?.affectedScope || 'none',
        })
        : null,
      publicPhase: projectPublicEditPhase(planned.ok ? 'plan' : 'intent').phase,
      publicPhases: [...PUBLIC_EDIT_PHASES],
    };
  }

  /** 创建候选：必须带 token，避免把修改落到已经切换掉的结果上。 */
  async function create(args = {}, ctx = {}) {
    const guarded = guardContextOperation(ctx, args, options);
    if (!guarded.ok) return guarded.response;
    const envelope = guarded.resolved.envelope;
    const presentedIntent = args.intent;
    if (!presentedIntent || typeof presentedIntent !== 'object') {
      return { ok: false, error: 'intent_required', message: '需要 result_edit_plan_in_context 返回的 intentId。' };
    }
    // Preserve precise stale-target diagnostics when a Provider echoed those
    // optional fields. They are diagnostic only; execution still resolves the
    // sealed plan by intentId below.
    const presentedRef = presentedIntent.artifactRef || {};
    if ((presentedRef.artifactId || presentedRef.revisionId)
        && (presentedRef.artifactId !== envelope.artifact.artifactId
          || presentedRef.revisionId !== envelope.revision.revisionId)) {
      return {
        ok: false,
        error: 'context_intent_mismatch',
        message: '该修改计划不属于当前打开的结果版本；请重新规划。',
        remediation: 'result_edit_plan_in_context',
      };
    }
    const activeSelectionRef = envelope.selection ? envelope.selection.selectionId : null;
    if (Object.prototype.hasOwnProperty.call(presentedIntent, 'selectionRef')) {
      const presentedSelectionRef = typeof presentedIntent.selectionRef === 'string' && presentedIntent.selectionRef.trim()
        ? presentedIntent.selectionRef.trim()
        : null;
      if (presentedSelectionRef !== activeSelectionRef) {
        return {
          ok: false,
          error: 'context_intent_selection_mismatch',
          message: '当前选择与修改计划不一致；请基于当前结果重新规划。',
          remediation: 'result_edit_plan_in_context',
        };
      }
    }
    if (!presentedIntent.intentId) {
      return { ok: false, error: 'intent_required', message: '需要 result_edit_plan_in_context 返回的 intentId。' };
    }
    const trusted = trustedIntentFor(ctx, presentedIntent.intentId);
    if (!trusted || trusted.contextToken !== envelope.contextToken) {
      return {
        ok: false,
        error: 'context_intent_untrusted',
        message: '修改计划不是本轮由受信上下文生成的原始计划，或计划内容已变化；请重新规划。',
        remediation: 'result_edit_plan_in_context',
      };
    }
    // intentId is an opaque capability reference. Never execute the model's
    // echoed fields: resolve the exact server-sealed plan for this context.
    const intent = trusted.intent;
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
    const plannedSelectionRef = typeof intent.selectionRef === 'string' && intent.selectionRef.trim()
      ? intent.selectionRef.trim()
      : null;
    if (plannedSelectionRef !== activeSelectionRef) {
      return {
        ok: false,
        error: 'context_intent_selection_mismatch',
        message: '当前选择与修改计划不一致；请基于当前结果重新规划。',
        remediation: 'result_edit_plan_in_context',
      };
    }
    if (Array.isArray(args.scriptPatch) && args.scriptPatch.length > 0) {
      return {
        ok: false,
        error: 'context_script_patch_forbidden',
        message: '结果焦点编辑只执行插件声明的参数 Patch；脚本修改不能通过此入口提交。',
      };
    }
    // For a Result Edit drawer submission, the confirmation was captured by
    // the renderer before the provider saw the turn.  A model may describe
    // an intent, but it must not be able to promote an unchecked scientific
    // edit by supplying `scientificConfirmed: true` in its tool arguments.
    // The missing-key case deliberately preserves ordinary chat's existing
    // confirmation contract; only an explicitly projected drawer request is
    // bound here.
    const hasBoundScientificConfirmation = typeof ctx.resultStudioScientificConfirmation === 'boolean';
    if (intent.requiresScientificConfirmation === true
        && hasBoundScientificConfirmation
        && ctx.resultStudioScientificConfirmation !== true) {
      return {
        ok: false,
        error: 'scientific_confirmation_required',
        message: '此科学修改尚未在高级控件中确认；请确认后重新生成候选版本。',
      };
    }
    const created = await changeSetTools.create({
      ...args,
      intent: trusted.intent,
      ...(intent.requiresScientificConfirmation === true && hasBoundScientificConfirmation
        ? { scientificConfirmed: true }
        : {}),
    }, { ...ctx, resultStudioTrustedIntent: true });
    return {
      ...created,
      context: contextView(envelope),
      publicProgress: publicProgress(created && created.progress),
    };
  }

  /**
   * Start GO/KEGG from the exact currently viewed DEG Revision.  The public
   * arguments deliberately contain only scientific options; revision/path/
   * lineage/tool coordinates are freshly bound below and never model-owned.
   */
  async function deriveEnrichmentFromCurrentResult(args = {}, ctx = {}) {
    const guarded = guardContextOperation(ctx, args, options);
    if (!guarded.ok) return guarded.response;
    const envelope = guarded.resolved.envelope;
    const dependencies = {
      ...options,
      repository: guarded.resolved.repository,
      getProject: () => guarded.resolved.project,
    };
    const compatibleGeneSelection = envelope.selection?.entityType === 'gene'
      && envelope.selectionState?.compatibility === 'compatible'
      && guarded.resolved.persistedSelection?.selectionId === envelope.selection.selectionId;
    const result = compatibleGeneSelection
      ? await deriveEnrichmentFromSelection({
        selectionId: guarded.resolved.persistedSelection.selectionId,
        action: 'go_kegg',
        species: args.species,
        geneIdType: args.geneIdType,
        analysisType: args.analysisType,
      }, ctx, dependencies)
      : await deriveEnrichment({
        species: args.species,
        geneIdType: args.geneIdType,
        analysisType: args.analysisType,
        padjCutoff: args.padjCutoff,
        lfcCutoff: args.lfcCutoff,
        revisionId: envelope.revision.revisionId,
      }, ctx, dependencies);
    return { ...result, context: contextView(envelope) };
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
    deriveEnrichmentFromCurrentResult,
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
  tool_result_enrichment_from_context: contextEditTools.deriveEnrichmentFromCurrentResult,
  tool_result_changeset_status_in_context: contextEditTools.status,
  tool_result_changeset_compare_in_context: contextEditTools.compare,
  tool_result_changeset_adopt_in_context: contextEditTools.adopt,
  tool_result_changeset_revert_in_context: contextEditTools.revert,
  resolveResultStudioContext,
};
