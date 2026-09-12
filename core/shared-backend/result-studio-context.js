'use strict';

/**
 * G0-RS-P3 — ResultStudioContextEnvelope v1
 *
 * 目的：用户只表达目标，Harness 自己补齐工程坐标。模型不再手写
 * toolJobId / artifactId / revisionId / changeSetId / artifactFamilyId /
 * selectionId 这些内部 ID —— 它们必须由后端真相投影出来。
 *
 * 设计边界（与 RS0～RS2 的既有真相保持一条链，不建第二套状态）：
 * - Envelope 只是**投影**：每个字段都能追到 tool_jobs / artifact_revisions /
 *   result_selection_contexts / 插件 descriptor 之一，本模块不发明任何 ID。
 * - `contextToken` 绑定当前 Revision 与选择证据。陈旧上下文上的写操作
 *   必须 fail-closed 拒绝，而不是"尽力猜"一个新目标。
 * - 只有 `compatible` 选择进入 Envelope；stale/invalid 只保留状态与原因，
 *   让 Agent 得到可行动的修复路径，而不是把旧行号映射到新结果。
 * - 归因只能到 Job（没有 per-artifact 脚本/来源）时诚实阻断，不伪造脚本坐标。
 */

const crypto = require('crypto');
const { stableStringify } = require('./canonical-json');

const RESULT_STUDIO_CONTEXT_VERSION = 1;

/**
 * 对外公开的编辑阶段词表。
 *
 * 产品层只允许展示这五个阶段结论，不展示模型隐藏推理链，也不把
 * Git/staging 这类工程细节当作主线进度。
 */
const PUBLIC_EDIT_PHASES = Object.freeze([
  'understand_intent',
  'assess_impact',
  'execute_or_recompute',
  'validate',
  'candidate_comparable',
]);

const PUBLIC_EDIT_PHASE_LABELS = Object.freeze({
  understand_intent: '理解意图',
  assess_impact: '判断影响',
  execute_or_recompute: '执行/重算',
  validate: '验证',
  candidate_comparable: '候选可比较',
});

/**
 * 工程阶段 → 公开阶段。
 *
 * `result-changeset-service` 内部仍然使用 change_set/materialize/commit/job/
 * revision/preview 这套精确工程词表（恢复扫描依赖它）。这里只做**投影**，
 * 不改写内部阶段，也不为公开层新增一套持久状态。
 */
const ENGINEERING_STAGE_TO_PUBLIC_PHASE = Object.freeze({
  intent: 'understand_intent',
  plan: 'assess_impact',
  change_set: 'assess_impact',
  materialize: 'execute_or_recompute',
  commit: 'execute_or_recompute',
  job: 'execute_or_recompute',
  revision: 'validate',
  preview: 'candidate_comparable',
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SELECTION_COMPATIBILITIES = Object.freeze(['compatible', 'stale', 'invalid']);

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableTrimmed(value) {
  return trimmed(value) || null;
}

function diagnostic(code, message, detail = null) {
  return { code, message, ...(detail == null ? {} : { detail }) };
}

/**
 * 把内部工程阶段投影成公开阶段。未知阶段不猜测。
 *
 * @param {string} stage 内部阶段名
 * @param {string} [status] 内部状态（running/completed/ready/terminal）
 * @returns {{ phase: string|null, label: string|null, terminal: boolean }}
 */
function projectPublicEditPhase(stage, status = null) {
  const normalizedStage = trimmed(stage);
  const normalizedStatus = trimmed(status);
  if (normalizedStage === 'failed' || normalizedStage === 'cancelled' || normalizedStatus === 'terminal') {
    return { phase: null, label: null, terminal: true };
  }
  const phase = ENGINEERING_STAGE_TO_PUBLIC_PHASE[normalizedStage] || null;
  return {
    phase,
    label: phase ? PUBLIC_EDIT_PHASE_LABELS[phase] : null,
    terminal: false,
  };
}

/**
 * 计算 contextToken。
 *
 * 覆盖：契约版本、项目/会话、Artifact 身份、当前 Revision、来源 Job、
 * 脚本与参数摘要、选择证据。任意一项变化都会让旧 token 失效。
 */
function computeContextToken(envelope) {
  return sha256Hex(stableStringify({
    contextVersion: envelope.contextVersion,
    projectId: envelope.projectId,
    conversationId: envelope.conversationId,
    artifactId: envelope.artifact && envelope.artifact.artifactId,
    artifactFamilyId: envelope.artifact && envelope.artifact.artifactFamilyId,
    revisionId: envelope.revision && envelope.revision.revisionId,
    currentRevisionId: envelope.revision && envelope.revision.currentRevisionId,
    toolJobId: envelope.job && envelope.job.toolJobId,
    sourceScriptSha256: envelope.script && envelope.script.sha256,
    parametersHash: envelope.script && envelope.script.parametersHash,
    selectionId: envelope.selection && envelope.selection.selectionId,
    selectionEntityIdsHash: envelope.selection && envelope.selection.entityIdsHash,
    selectionFilterHash: envelope.selection && envelope.selection.filterHash,
    selectionFields: envelope.selection && envelope.selection.fields,
    selectionSort: envelope.selection && envelope.selection.sort,
    selectionUpdatedAt: envelope.selection && envelope.selection.updatedAt,
    workflowGraphId: envelope.workflow && envelope.workflow.graphId,
    workflowSourceDigest: envelope.workflow && envelope.workflow.sourceDigest,
  }));
}

/**
 * 规范化并校验一个 Envelope 投影。
 *
 * 调用方必须提供已经从真实后端读出的字段；本函数不访问数据库，
 * 因此可以在纯单测中固定契约。
 *
 * @returns {{ ok: boolean, diagnostics: Array, envelope: object|null }}
 */
function buildResultStudioContextEnvelope(input = {}) {
  const diagnostics = [];
  const projectId = trimmed(input.projectId);
  if (!projectId) diagnostics.push(diagnostic('context_project_required', 'An active project is required to build a Result Studio context.'));

  const artifactInput = input.artifact || {};
  const jobInput = input.job || {};
  const revisionInput = input.revision || {};
  const scriptInput = input.script || {};
  const selectionInput = input.selection || null;
  const workflowInput = input.workflow || null;
  const pluginInput = input.plugin || {};

  const artifactId = trimmed(artifactInput.artifactId);
  const toolJobId = trimmed(jobInput.toolJobId);
  const revisionId = trimmed(revisionInput.revisionId);
  if (!artifactId) diagnostics.push(diagnostic('context_artifact_required', 'No result artifact is open; ask the user to open a result first.'));
  if (!toolJobId) diagnostics.push(diagnostic('context_job_required', 'The open artifact is not bound to a real tool job.'));
  if (!revisionId) {
    diagnostics.push(diagnostic('context_revision_missing', 'The open artifact has no persisted ArtifactRevision yet.'));
  }
  if (trimmed(jobInput.projectId) && trimmed(jobInput.projectId) !== projectId) {
    diagnostics.push(diagnostic('context_project_mismatch', 'The open artifact belongs to another project.'));
  }
  if (jobInput.status && jobInput.status !== 'completed') {
    diagnostics.push(diagnostic('context_job_not_completed', `Source job status is ${jobInput.status}.`));
  }
  if (jobInput.artifactTruthStatus && jobInput.artifactTruthStatus !== 'valid') {
    diagnostics.push(diagnostic('context_artifact_truth_invalid', 'The open artifact does not have valid artifact truth.'));
  }

  // 归因只能到 Job：没有 per-artifact 脚本坐标时诚实阻断。
  const scriptSha256 = trimmed(scriptInput.sha256);
  const scriptRelativePath = trimmed(scriptInput.relativePath);
  if (!scriptSha256 || !scriptRelativePath) {
    diagnostics.push(diagnostic(
      'context_attribution_job_only',
      'Attribution reaches only the job: this artifact has no reproducible per-artifact script reference, so an edit cannot be planned.'
    ));
  } else if (!SHA256_PATTERN.test(scriptSha256)) {
    diagnostics.push(diagnostic('context_script_hash_invalid', 'Source script hash must be a lowercase sha256 digest.'));
  }

  let selection = null;
  if (selectionInput) {
    const compatibility = trimmed(selectionInput.compatibility);
    if (!SELECTION_COMPATIBILITIES.includes(compatibility)) {
      diagnostics.push(diagnostic('context_selection_compatibility_invalid', 'Selection compatibility must be compatible, stale or invalid.'));
    } else if (compatibility === 'compatible') {
      selection = {
        selectionId: trimmed(selectionInput.selectionId),
        entityType: trimmed(selectionInput.entityType) || null,
        entityIdCount: Number.isInteger(selectionInput.entityIdCount) ? selectionInput.entityIdCount : 0,
        truncated: selectionInput.truncated === true,
        entityIdsHash: nullableTrimmed(selectionInput.entityIdsHash),
        filterHash: nullableTrimmed(selectionInput.filterHash),
        fields: Array.isArray(selectionInput.fields)
          ? selectionInput.fields.map((item) => trimmed(item)).filter(Boolean)
          : [],
        sort: Array.isArray(selectionInput.sort)
          ? selectionInput.sort
            .filter((item) => item && trimmed(item.field))
            .map((item) => ({ field: trimmed(item.field), direction: item.direction === 'desc' ? 'desc' : 'asc' }))
          : [],
        updatedAt: nullableTrimmed(selectionInput.updatedAt),
        sampleEntityIds: Array.isArray(selectionInput.sampleEntityIds)
          ? selectionInput.sampleEntityIds.slice(0, 12).map((item) => trimmed(item)).filter(Boolean)
          : [],
        hasFilter: selectionInput.hasFilter === true,
        filterDescription: nullableTrimmed(selectionInput.filterDescription),
        compatibility: 'compatible',
        compatibilityReason: nullableTrimmed(selectionInput.compatibilityReason),
      };
      if (!selection.selectionId) {
        diagnostics.push(diagnostic('context_selection_identity_missing', 'A compatible selection must carry a persisted selectionId.'));
        selection = null;
      }
    }
    // stale/invalid 选择不进入 Agent 上下文，只作为可行动状态回报。
  }
  const selectionState = selectionInput
    ? {
      present: true,
      compatibility: trimmed(selectionInput.compatibility) || 'invalid',
      reason: nullableTrimmed(selectionInput.compatibilityReason),
      usableByAgent: selection !== null,
    }
    : { present: false, compatibility: null, reason: null, usableByAgent: false };

  const envelope = {
    contextVersion: RESULT_STUDIO_CONTEXT_VERSION,
    projectId,
    conversationId: nullableTrimmed(input.conversationId),
    artifact: {
      artifactId,
      artifactFamilyId: nullableTrimmed(artifactInput.artifactFamilyId),
      name: nullableTrimmed(artifactInput.name),
      kind: nullableTrimmed(artifactInput.kind),
      entityType: nullableTrimmed(artifactInput.entityType),
      idField: nullableTrimmed(artifactInput.idField),
      interactionMode: nullableTrimmed(artifactInput.interactionMode),
    },
    job: {
      toolJobId,
      toolId: nullableTrimmed(jobInput.toolId),
      status: nullableTrimmed(jobInput.status),
      artifactTruthStatus: nullableTrimmed(jobInput.artifactTruthStatus),
    },
    revision: {
      revisionId,
      currentRevisionId: nullableTrimmed(revisionInput.currentRevisionId),
      revisionOrdinal: Number.isInteger(revisionInput.revisionOrdinal) ? revisionInput.revisionOrdinal : null,
      isCurrent: revisionInput.isCurrent === true,
      validationStatus: nullableTrimmed(revisionInput.validationStatus),
      reproducibilityStatus: nullableTrimmed(revisionInput.reproducibilityStatus),
    },
    script: {
      relativePath: scriptRelativePath || null,
      sha256: scriptSha256 || null,
      language: nullableTrimmed(scriptInput.language),
      origin: nullableTrimmed(scriptInput.origin),
      parametersRef: nullableTrimmed(scriptInput.parametersRef),
      parametersHash: nullableTrimmed(scriptInput.parametersHash),
    },
    plugin: {
      pluginId: nullableTrimmed(pluginInput.pluginId),
      descriptorVersion: Number.isInteger(pluginInput.descriptorVersion) ? pluginInput.descriptorVersion : null,
      editableParameters: Array.isArray(pluginInput.editableParameters)
        ? pluginInput.editableParameters
          .filter((item) => item && trimmed(item.name))
          .map((item) => ({
            name: trimmed(item.name),
            type: nullableTrimmed(item.type),
            impact: nullableTrimmed(item.impact),
            default: item.default === undefined ? null : item.default,
          }))
        : [],
      actions: Array.isArray(pluginInput.actions) ? pluginInput.actions.map((item) => trimmed(item)).filter(Boolean) : [],
    },
    selection,
    selectionState,
    workflow: workflowInput
      ? {
        available: true,
        graphId: nullableTrimmed(workflowInput.graphId),
        sourceDigest: nullableTrimmed(workflowInput.sourceDigest),
        snapshotStatus: ['persisted', 'not_persisted'].includes(workflowInput.snapshotStatus)
          ? workflowInput.snapshotStatus
          : 'not_persisted',
        nodeId: nullableTrimmed(workflowInput.nodeId),
        stepCount: Number.isInteger(workflowInput.stepCount) ? workflowInput.stepCount : null,
        downstreamNodeIds: Array.isArray(workflowInput.downstreamNodeIds)
          ? workflowInput.downstreamNodeIds.map((item) => trimmed(item)).filter(Boolean)
          : [],
      }
      : { available: false, graphId: null, sourceDigest: null, snapshotStatus: 'not_persisted', nodeId: null, stepCount: null, downstreamNodeIds: [] },
    validation: {
      artifactTruthStatus: nullableTrimmed(jobInput.artifactTruthStatus),
      revisionValidationStatus: nullableTrimmed(revisionInput.validationStatus),
    },
    reproducibility: {
      status: nullableTrimmed(revisionInput.reproducibilityStatus),
      scriptAvailable: !!scriptSha256,
    },
    publicPhases: [...PUBLIC_EDIT_PHASES],
    capturedAt: nullableTrimmed(input.capturedAt) || new Date().toISOString(),
  };

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics, envelope: null };
  }
  envelope.contextToken = computeContextToken(envelope);
  return { ok: true, diagnostics: [], envelope };
}

/**
 * 校验一个已经构造好的 Envelope 是否结构完整且 token 自洽。
 */
function validateResultStudioContextEnvelope(envelope) {
  const diagnostics = [];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, diagnostics: [diagnostic('context_envelope_missing', 'A Result Studio context envelope is required.')] };
  }
  if (envelope.contextVersion !== RESULT_STUDIO_CONTEXT_VERSION) {
    diagnostics.push(diagnostic('context_version_unsupported', 'Only Result Studio context envelope v1 is trusted.'));
  }
  for (const [path, message] of [
    ['projectId', 'projectId is required.'],
    ['artifact.artifactId', 'artifact.artifactId is required.'],
    ['job.toolJobId', 'job.toolJobId is required.'],
    ['revision.revisionId', 'revision.revisionId is required.'],
    ['script.sha256', 'script.sha256 is required.'],
  ]) {
    const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), envelope);
    if (!trimmed(value)) diagnostics.push(diagnostic('context_envelope_incomplete', message, { field: path }));
  }
  if (!trimmed(envelope.contextToken) || !SHA256_PATTERN.test(trimmed(envelope.contextToken))) {
    diagnostics.push(diagnostic('context_token_invalid', 'contextToken must be a lowercase sha256 digest.'));
  } else {
    const { contextToken, ...rest } = envelope;
    if (computeContextToken(rest) !== contextToken) {
      diagnostics.push(diagnostic('context_token_invalid', 'contextToken does not match the envelope contents.'));
    }
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

/**
 * 服务端上下文闸门。
 *
 * 用于每一次 context-bound 写操作：模型带回来的 token 必须与当前真相
 * 重新投影出的 Envelope 一致，否则拒绝。这样"用户切了结果/结果被重算/
 * 选择被清空"之后的陈旧调用不会落到错误实体上。
 *
 * @param {object} params
 * @param {object} params.envelope 当前真相重新投影出的 Envelope
 * @param {string|null} params.presentedToken 模型/前端带来的 token
 * @param {boolean} [params.requireToken] 写操作必须带 token
 * @returns {{ ok: boolean, diagnostics: Array }}
 */
function authorizeContextOperation({ envelope, presentedToken = null, requireToken = true } = {}) {
  const structural = validateResultStudioContextEnvelope(envelope);
  if (!structural.ok) return structural;
  const token = trimmed(presentedToken);
  if (!token) {
    if (!requireToken) return { ok: true, diagnostics: [] };
    return {
      ok: false,
      diagnostics: [diagnostic('context_token_required', 'This operation requires the contextToken returned by result_studio_context.')],
    };
  }
  if (token !== envelope.contextToken) {
    return {
      ok: false,
      diagnostics: [diagnostic(
        'context_token_stale',
        'The current result, revision or selection changed after this context was captured; re-read result_studio_context and re-plan before retrying.'
      )],
    };
  }
  return { ok: true, diagnostics: [] };
}

/**
 * 给 Agent 的紧凑上下文视图。
 *
 * 有界：不含完整实体 ID 列表、绝对路径、URL 或结果值。
 */
function summarizeContextForAgent(envelope) {
  if (!envelope) return null;
  return {
    contextVersion: envelope.contextVersion,
    contextToken: envelope.contextToken || null,
    artifact: {
      name: envelope.artifact.name,
      kind: envelope.artifact.kind,
      entityType: envelope.artifact.entityType,
      interactionMode: envelope.artifact.interactionMode,
    },
    tool: envelope.job.toolId,
    revisionOrdinal: envelope.revision.revisionOrdinal,
    isCurrent: envelope.revision.isCurrent,
    validation: envelope.validation,
    reproducibility: envelope.reproducibility,
    selection: envelope.selection
      ? {
        entityType: envelope.selection.entityType,
        entityIdCount: envelope.selection.entityIdCount,
        truncated: envelope.selection.truncated,
        sampleEntityIds: envelope.selection.sampleEntityIds,
        hasFilter: envelope.selection.hasFilter,
        filterDescription: envelope.selection.filterDescription,
        fields: envelope.selection.fields,
        sort: envelope.selection.sort,
      }
      : null,
    selectionState: envelope.selectionState,
    editableParameters: envelope.plugin.editableParameters.map((item) => ({
      name: item.name,
      type: item.type,
      impact: item.impact,
    })),
    actions: envelope.plugin.actions,
    workflow: envelope.workflow,
    publicPhases: envelope.publicPhases,
  };
}

module.exports = {
  RESULT_STUDIO_CONTEXT_VERSION,
  PUBLIC_EDIT_PHASES,
  PUBLIC_EDIT_PHASE_LABELS,
  ENGINEERING_STAGE_TO_PUBLIC_PHASE,
  projectPublicEditPhase,
  computeContextToken,
  buildResultStudioContextEnvelope,
  validateResultStudioContextEnvelope,
  authorizeContextOperation,
  summarizeContextForAgent,
};
