'use strict';

/**
 * G0-RS-P3 — Result Studio 上下文解析与 context-bound Agent 工具。
 *
 * 这里是"用户只表达目标"的落地点：模型不再手写 toolJobId / artifactId /
 * revisionId / artifactFamilyId / changeSetId / selectionId，所有工程坐标由
 * 当前 UI 状态 + 后端真相重新投影。
 *
 * 不可协商的边界：
 * - 前端传来的 activeArtifact 只当**线索**，每个字段都要用 SQLite / tool_jobs /
 *   artifact_revisions / 插件 descriptor 重新确认；客户端不能声明自己的身份。
 * - 写操作必须带 `contextToken`，且必须与当前真相重新投影出的 token 一致；
 *   陈旧上下文 fail-closed 拒绝，不改写成"最近的那个"目标。
 * - 只有 compatible 选择进入 Agent 上下文；stale/invalid 只回报可行动状态。
 * - 归因只能到 Job（缺 per-artifact 脚本）时诚实阻断，不伪造脚本坐标。
 */

const dbMod = require('../db');
const pluginLoader = require('../plugin-loader');
const { createResultStudioRepository } = require('../../shared-backend/result-studio-repository');
const { ensureChainRevisions } = require('../../shared-backend/result-changeset-service');
const {
  assessSelectionCompatibility,
  summarizeSelection,
} = require('../../shared-backend/result-studio-contracts');
const {
  buildResultStudioContextEnvelope,
  authorizeContextOperation,
  summarizeContextForAgent,
  PUBLIC_EDIT_PHASES,
} = require('../../shared-backend/result-studio-context');
const { buildEditControlSchema } = require('../../shared-backend/result-edit-controls');
const { buildAuthoritativeWorkflowGraph } = require('../../shared-backend/result-workflow-graph');

const OPERATOR_LABELS = Object.freeze({
  eq: '=', ne: '≠', lt: '<', lte: '≤', gt: '>', gte: '≥', in: '∈', contains: '包含',
});

/**
 * 有界的 filter 说明。
 *
 * 故意在这里本地实现，而不是复用前端 `describeFilter`：
 * `artifact-interaction.js` 并不导出它，import 会静默变成 undefined。
 * 只输出字段名与运算符，不输出完整取值集合，避免结果值进入 Agent 上下文。
 */
function describeFilterExpression(filterExpression) {
  if (!filterExpression || typeof filterExpression !== 'object') return null;
  const clauses = Array.isArray(filterExpression.clauses) ? filterExpression.clauses : [];
  if (clauses.length === 0) return null;
  const joiner = filterExpression.logic === 'or' ? ' 或 ' : ' 且 ';
  return clauses
    .filter((clause) => clause && typeof clause.field === 'string' && clause.field.trim())
    .slice(0, 6)
    .map((clause) => {
      const operator = OPERATOR_LABELS[clause.op] || String(clause.op || '');
      if (clause.op === 'in') return `${clause.field.trim()} ${operator} 集合(${Array.isArray(clause.value) ? clause.value.length : 1})`;
      const value = clause.value == null || typeof clause.value === 'object' ? '…' : String(clause.value).slice(0, 24);
      return `${clause.field.trim()} ${operator} ${value}`;
    })
    .join(joiner) || null;
}

/** ChangeSet 未定局状态。context-bound 解析只允许命中唯一一个。 */
const OPEN_CHANGE_SET_STATUSES = Object.freeze(['draft', 'running', 'preview_ready', 'validation_failed']);

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function authorizeProject(project, userId, dbModule) {
  if (!project) return false;
  if (!userId || project.user_id === userId || project.is_public === 1) return true;
  try {
    return dbModule.getUserById(userId)?.role === 'admin';
  } catch {
    return false;
  }
}

function parseJobResult(job) {
  if (!job) return {};
  if (job.result && typeof job.result === 'object') return job.result;
  try {
    return JSON.parse(job.result_json || '{}');
  } catch {
    return {};
  }
}

/**
 * 把插件 descriptor 的可编辑参数投影成有界列表。
 *
 * 只有插件**显式声明**过 impact 的参数才允许出现；未声明的参数不在这里
 * 变成"看起来可以安全改"的控件，交由 result_edit_plan 的保守分级处理。
 */
function projectEditableParameters(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return [];
  const parameters = descriptor.parameters && typeof descriptor.parameters === 'object' ? descriptor.parameters : {};
  const impacts = descriptor.parameterImpacts && typeof descriptor.parameterImpacts === 'object'
    ? descriptor.parameterImpacts
    : {};
  return Object.keys(parameters)
    .filter((name) => trimmed(impacts[name]))
    .sort()
    .map((name) => ({
      name,
      type: trimmed(parameters[name] && parameters[name].type) || null,
      impact: trimmed(impacts[name]),
      default: parameters[name] && parameters[name].default !== undefined ? parameters[name].default : null,
    }));
}

/**
 * 从当前 UI 状态 + 后端真相解析 ResultStudioContextEnvelope。
 *
 * @param {object} ctx Agent tool context（projectId / conversationId / activeArtifact）
 * @param {object} dependencies 可注入依赖，便于单测固定契约
 * @returns {{ ok: boolean, envelope: object|null, diagnostics: Array, repository: object|null, project: object|null }}
 */
function resolveResultStudioContext(ctx = {}, dependencies = {}) {
  const dbModule = dependencies.db || dbMod;
  const projectId = trimmed(ctx.projectId);
  if (!projectId) {
    return {
      ok: false,
      envelope: null,
      repository: null,
      project: null,
      diagnostics: [{ code: 'context_project_required', message: '需要一个当前项目才能读取结果上下文。' }],
    };
  }
  const project = dependencies.getProject ? dependencies.getProject(projectId) : dbModule.getProject(projectId);
  if (!authorizeProject(project, ctx.userId, dbModule)) {
    return {
      ok: false,
      envelope: null,
      repository: null,
      project: null,
      diagnostics: [{ code: 'context_project_forbidden', message: '当前身份无权访问该项目。' }],
    };
  }
  const repository = dependencies.repository
    || createResultStudioRepository(dbModule.db || dbModule.getDatabase());

  // 客户端线索：只用来定位候选 Revision，不作为身份来源。
  const hint = ctx.activeArtifact && typeof ctx.activeArtifact === 'object' ? ctx.activeArtifact : {};
  const hintRevisionId = trimmed(hint.revisionId);
  const hintJobId = trimmed(hint.jobId);

  let revision = hintRevisionId ? repository.getRevision(hintRevisionId) : null;
  if (revision && revision.projectId !== projectId) revision = null;
  if (!revision && hintJobId) {
    const job = dependencies.getToolJob ? dependencies.getToolJob(hintJobId) : dbModule.getToolJob(hintJobId);
    const result = parseJobResult(job);
    const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
    const name = trimmed(hint.name);
    const matches = artifacts.filter((artifact) => artifact
      && (artifact.name === name || artifact.filename === name
        || String(artifact.path || '').split('/').pop() === name));
    if (matches.length === 1 && matches[0].id) {
      revision = repository.findRevisionByJobArtifact({
        projectId,
        toolJobId: hintJobId,
        artifactId: matches[0].id,
      });
      if (!revision) {
        // BLOCK-138 §9 方向 1（F1）：selection 链形成点——裸 job 产物首次被打开时，
        // 经既有 changeset 管线注册 pending ChangeSet+preview revisions（幂等、
        // 绝不自动 adopt；AUDIT-LOG 🟡 2026-10-02 blocker B1/attempt-3 的拒开点），
        // 使 context 可建立、selection 可锚定、血缘边可解析。注册失败保持既有
        // context_artifact_not_open fail-closed 行为。唯一 sanctioned 例外：
        // 上方“打开结果不写 SQLite”不变量针对工作流快照投影，不覆盖本信任层注册。
        try {
          const chain = ensureChainRevisions({
            projectId,
            toolJobId: hintJobId,
            artifactId: matches[0].id,
            workspaceRoot: project.workspace_path,
          }, {
            repository,
            getToolJob: dependencies.getToolJob
              ? dependencies.getToolJob
              : (toolJobId) => dbModule.getToolJob(toolJobId),
            listProjectToolJobs: (id) => dbModule.listProjectToolJobsForWorkflow(id),
          });
          if (chain && chain.ok) {
            revision = repository.findRevisionByJobArtifact({
              projectId,
              toolJobId: hintJobId,
              artifactId: matches[0].id,
            });
          }
        } catch { /* 注册失败 → 维持既有 fail-closed 上下文拒绝 */ }
      }
    }
  }
  if (!revision) {
    return {
      ok: false,
      envelope: null,
      repository,
      project,
      diagnostics: [{
        code: 'context_artifact_not_open',
        message: '当前没有已建立正式版本的结果处于打开状态；请先让用户在主画布打开一个结果。',
      }],
    };
  }

  const job = dependencies.getToolJob ? dependencies.getToolJob(revision.toolJobId) : dbModule.getToolJob(revision.toolJobId);
  const result = parseJobResult(job);
  const artifactRecord = (Array.isArray(result.artifacts) ? result.artifacts : [])
    .find((artifact) => artifact && artifact.id === revision.artifactId) || null;
  const pluginId = job && (job.tool_id || job.toolId) || null;
  const manifest = pluginId
    ? (dependencies.getPluginManifest ? dependencies.getPluginManifest(pluginId) : pluginLoader.getPluginManifest(pluginId))
    : null;
  const descriptor = manifest && manifest.resultStudio ? manifest.resultStudio : null;
  const mapping = descriptor && Array.isArray(descriptor.interactionMappings)
    ? descriptor.interactionMappings.find((item) => item && item.artifactId === revision.artifactId) || null
    : null;
  const currentRevision = repository.getCurrentRevision(revision.artifactFamilyId);
  const listProjectToolJobsForWorkflow = dependencies.listProjectToolJobsForWorkflow
    || dbModule.listProjectToolJobsForWorkflow;
  const workflowProjection = typeof listProjectToolJobsForWorkflow === 'function'
    ? buildAuthoritativeWorkflowGraph({
      projectId,
      sourceToolJobId: revision.toolJobId,
      jobs: listProjectToolJobsForWorkflow(projectId),
      repository,
    })
    : { ok: false, diagnostics: [{ code: 'workflow_truth_unavailable', message: '无法读取项目 Job 真相以投影工作流。' }] };
  // Context projection itself is read-only.  A graph becomes durable only
  // when an admitted downstream execution explicitly snapshots it; merely
  // opening a result must not grant scientific-edit authority or write SQLite.
  const workflowSnapshot = workflowProjection.ok && typeof repository.findWorkflowGraph === 'function'
    ? repository.findWorkflowGraph({ projectId, sourceDigest: workflowProjection.graph.sourceDigest })
    : null;
  // 选择：从 SQLite 权威恢复，再按用户正在查看的 Revision 判定兼容性。
  // 历史查看不能借 current 的 selection，也不能把历史版本自己的 selection
  // 错判为 stale；contextToken 必须绑定 viewed revision，而不是正式 current。
  const persistedSelection = repository.findLatestSelection({
    projectId,
    conversationId: trimmed(ctx.conversationId) || null,
    artifactId: revision.artifactId,
  });
  let selectionInput = null;
  if (persistedSelection) {
    const compatibility = assessSelectionCompatibility({
      selection: persistedSelection,
      projectId,
      artifactId: revision.artifactId,
      revisionId: revision.revisionId,
      selectionDurable: persistedSelection.displayState?.durable !== false,
    });
    const summary = summarizeSelection(persistedSelection);
    selectionInput = {
      selectionId: persistedSelection.selectionId,
      entityType: summary.entityType,
      entityIdCount: summary.entityIdCount,
      truncated: summary.truncated,
      entityIdsHash: summary.entityIdsHash,
      filterHash: summary.filterHash,
      fields: Array.isArray(persistedSelection.displayState?.fields)
        ? persistedSelection.displayState.fields
        : [],
      sort: summary.sort,
      updatedAt: persistedSelection.updatedAt,
      sampleEntityIds: summary.sampleEntityIds,
      hasFilter: summary.hasFilter,
      filterDescription: describeFilterExpression(persistedSelection.filterExpression),
      compatibility: compatibility.status,
      compatibilityReason: compatibility.reason,
    };
  }

  const built = buildResultStudioContextEnvelope({
    projectId,
    conversationId: trimmed(ctx.conversationId) || null,
    artifact: {
      artifactId: revision.artifactId,
      artifactFamilyId: revision.artifactFamilyId,
      name: artifactRecord && (artifactRecord.name || artifactRecord.filename) || null,
      kind: artifactRecord && artifactRecord.type || null,
      entityType: mapping && mapping.entityType || null,
      idField: mapping && (mapping.idField || mapping.rowIdField) || null,
      interactionMode: mapping && mapping.mode || null,
    },
    job: {
      toolJobId: revision.toolJobId,
      projectId: job && (job.project_id || job.projectId) || null,
      toolId: pluginId,
      status: job && job.status || null,
      artifactTruthStatus: result.artifactTruth && result.artifactTruth.status || null,
    },
    revision: {
      revisionId: revision.revisionId,
      currentRevisionId: currentRevision ? currentRevision.revisionId : null,
      revisionOrdinal: revision.revisionOrdinal,
      isCurrent: !!currentRevision && currentRevision.revisionId === revision.revisionId,
      validationStatus: revision.validationStatus,
      reproducibilityStatus: revision.reproducibilityStatus,
    },
    script: {
      relativePath: revision.sourceScriptRef && revision.sourceScriptRef.relativePath || null,
      sha256: revision.sourceScriptRef && revision.sourceScriptRef.sha256 || null,
      language: revision.sourceScriptRef && revision.sourceScriptRef.language || null,
      origin: revision.sourceScriptRef && revision.sourceScriptRef.origin || null,
      parametersRef: revision.parametersRef,
      parametersHash: revision.parametersHash,
    },
    plugin: {
      pluginId,
      descriptorVersion: descriptor && Number.isInteger(descriptor.descriptorVersion)
        ? descriptor.descriptorVersion
        : null,
      editableParameters: projectEditableParameters(descriptor),
      actions: descriptor && Array.isArray(descriptor.actions) ? descriptor.actions : [],
    },
    selection: selectionInput,
    workflow: workflowProjection.ok
      ? {
        graphId: workflowProjection.graph.graphId,
        sourceDigest: workflowProjection.graph.sourceDigest,
        snapshotStatus: workflowSnapshot && workflowSnapshot.graphId === workflowProjection.graph.graphId
          ? 'persisted'
          : 'not_persisted',
        nodeId: `job:${revision.toolJobId}`,
        stepCount: workflowProjection.workflowPlan.steps.length,
        downstreamNodeIds: workflowProjection.workflowPlan.steps
          .filter((step) => Array.isArray(step.dependsOn) && step.dependsOn.includes(`job:${revision.toolJobId}`))
          .map((step) => step.id),
      }
      : null,
  });

  // G0-RS-P4：当前生效参数取自该 Job 的执行 provenance 归一化参数，
  // 用于剔除"提交了但与现状相同"的改动，避免生成空 ChangeSet。
  // 不回退到 descriptor 默认值：默认值不等于这次运行真正用过的值。
  const currentParameters = result.executionProvenance
    && result.executionProvenance.params
    && typeof result.executionProvenance.params.normalized === 'object'
    && result.executionProvenance.params.normalized !== null
    ? result.executionProvenance.params.normalized
    : {};

  return {
    ok: built.ok,
    envelope: built.envelope,
    diagnostics: built.diagnostics,
    repository,
    project,
    revision,
    job,
    descriptor,
    currentParameters,
    // Private server-side selection material.  It is intentionally not put in
    // the ContextEnvelope: model-visible context only receives a bounded
    // summary.  A narrowly declared presentation action may bind these stable
    // IDs itself, never by accepting a model-supplied label list.
    persistedSelection,
    workflowPlan: workflowProjection.ok ? workflowProjection.workflowPlan : null,
    workflowGraph: workflowProjection.ok ? workflowProjection.graph : null,
    workflowSnapshot: workflowSnapshot && workflowSnapshot.graphId === workflowProjection.graph?.graphId
      ? workflowSnapshot
      : null,
    workflowDiagnostics: workflowProjection.ok ? [] : workflowProjection.diagnostics || [],
  };
}

/**
 * 解析 context-bound ChangeSet。
 *
 * 优先使用当前 Artifact family 下唯一未定局的 ChangeSet；存在多个时不猜，
 * 让 Agent 显式确认，避免把用户的"采用"落到另一个候选上。
 */
function resolveContextChangeSet({ repository, projectId, artifactFamilyId, changeSetId = null }) {
  if (trimmed(changeSetId)) {
    const explicit = repository.getChangeSet(trimmed(changeSetId));
    if (!explicit || explicit.projectId !== projectId) {
      return { ok: false, error: 'change_set_not_found', message: '该修改在当前项目中不存在。' };
    }
    return { ok: true, changeSet: explicit };
  }
  const open = repository.listChangeSets({ projectId, limit: 200 })
    .filter((changeSet) => OPEN_CHANGE_SET_STATUSES.includes(changeSet.status))
    .filter((changeSet) => {
      if (!artifactFamilyId) return true;
      const revisions = repository.listRevisionsByChangeSet(changeSet.changeSetId);
      if (revisions.length === 0) return changeSet.status === 'draft' || changeSet.status === 'running';
      return revisions.some((revision) => revision.artifactFamilyId === artifactFamilyId);
    });
  if (open.length === 0) {
    return { ok: false, error: 'context_change_set_absent', message: '当前结果没有进行中的修改。' };
  }
  if (open.length > 1) {
    return {
      ok: false,
      error: 'context_change_set_ambiguous',
      message: '当前结果存在多个进行中的修改，请先确认要操作哪一个。',
      detail: { openCount: open.length },
    };
  }
  return { ok: true, changeSet: open[0] };
}

/**
 * 只读上下文工具：把当前结果坐标交给模型。
 */
function createResultStudioContextTool(options = {}) {
  return async function tool_result_studio_context(_args = {}, ctx = {}) {
    const resolved = resolveResultStudioContext(ctx, options);
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.diagnostics[0]?.code || 'context_unavailable',
        message: resolved.diagnostics[0]?.message || '无法读取当前结果上下文。',
        diagnostics: resolved.diagnostics,
        publicPhases: [...PUBLIC_EDIT_PHASES],
      };
    }
    const changeSet = resolveContextChangeSet({
      repository: resolved.repository,
      projectId: resolved.envelope.projectId,
      artifactFamilyId: resolved.envelope.artifact.artifactFamilyId,
    });
    // G0-RS-P4：控件 schema 与 Agent 看到的可编辑参数出自同一 descriptor 投影，
    // 手动面板和 AI 意图因此不可能看到两套不同的参数契约。
    const controlSchema = buildEditControlSchema(resolved.descriptor);
    return {
      ok: true,
      context: summarizeContextForAgent(resolved.envelope),
      editControls: {
        controlsVersion: controlSchema.controlsVersion,
        groups: controlSchema.groups,
        controls: controlSchema.controls,
      },
      pendingChange: changeSet.ok
        ? { status: changeSet.changeSet.status, hasCandidate: !!changeSet.changeSet.candidateCommit }
        : null,
      workflowDiagnostics: resolved.workflowDiagnostics || [],
    };
  };
}

/**
 * context-bound 写操作闸门。
 *
 * 每个写工具都先走这里：重新投影真相 → 校验模型带回的 token → 才允许继续。
 */
function guardContextOperation(ctx, args, options, { requireToken = true } = {}) {
  const resolved = resolveResultStudioContext(ctx, options);
  if (!resolved.ok) {
    return {
      ok: false,
      response: {
        ok: false,
        error: resolved.diagnostics[0]?.code || 'context_unavailable',
        message: resolved.diagnostics[0]?.message || '无法读取当前结果上下文。',
        diagnostics: resolved.diagnostics,
      },
    };
  }
  const authorized = authorizeContextOperation({
    envelope: resolved.envelope,
    presentedToken: args && args.contextToken,
    requireToken,
  });
  if (!authorized.ok) {
    return {
      ok: false,
      response: {
        ok: false,
        error: authorized.diagnostics[0].code,
        message: authorized.diagnostics[0].message,
        diagnostics: authorized.diagnostics,
        remediation: 'result_studio_context',
      },
    };
  }
  return { ok: true, resolved };
}

module.exports = {
  OPEN_CHANGE_SET_STATUSES,
  projectEditableParameters,
  resolveResultStudioContext,
  resolveContextChangeSet,
  createResultStudioContextTool,
  guardContextOperation,
  tool_result_studio_context: createResultStudioContextTool(),
};
