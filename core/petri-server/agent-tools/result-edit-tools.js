'use strict';

const db = require('../db');
const pluginLoader = require('../plugin-loader');
const mcpRegistry = require('../mcp/registry');
const { planResultEdit } = require('../../shared-backend/result-edit-intent');
const { createResultChangeSet, inspectResultEditRecovery } = require('../../shared-backend/result-changeset-service');
const {
  compareResultChangeSet,
  adoptResultChangeSet,
  revertResultChangeSet,
  restoreArtifactRevision,
} = require('../../shared-backend/result-compare-service');
const { createResultStudioRepository } = require('../../shared-backend/result-studio-repository');
const { bindProjectRepository } = require('../../shared-backend/git-repository-binding');
const { projectRevisionSource } = require('../../shared-backend/result-revision-source');
const { buildAuthoritativeWorkflowGraph } = require('../../shared-backend/result-workflow-graph');
const {
  DEG_DIRECT_CHILD_PRIMARY_ARTIFACTS = Object.freeze({}),
} = require('../../shared-backend/result-scientific-rerun');

function scientificEditClass(editClass) {
  return ['data_transform', 'scientific_recompute', 'workflow_replan'].includes(editClass);
}

function persistedWorkflowGraph(repository, graph) {
  if (!graph || !graph.ok || !graph.graph || !repository || typeof repository.findWorkflowGraph !== 'function') return null;
  const snapshot = repository.findWorkflowGraph({
    projectId: graph.graph.projectId,
    sourceDigest: graph.graph.sourceDigest,
  });
  return snapshot
    && snapshot.graphId === graph.graph.graphId
    && snapshot.rootToolJobId === graph.graph.rootToolJobId
    && snapshot.validationStatus === 'valid'
    ? snapshot
    : null;
}

/**
 * A scientific plan is an explicit Result Studio action, so it may make the
 * server-projected graph durable.  The caller never supplies graph nodes or
 * edges: `graph` has just been rebuilt from completed Job + Artifact Truth.
 * Opening a result remains read-only; raw/caller-provided WorkflowPlans are
 * still rejected before this point.
 */
function persistAuthoritativeWorkflowGraph(repository, graph) {
  const existing = persistedWorkflowGraph(repository, graph);
  if (existing) return { ok: true, graph: existing, persisted: false, diagnostics: [] };
  if (!graph || !graph.ok || !graph.graph || graph.graph.validationStatus !== 'valid') {
    return {
      ok: false,
      diagnostics: [{
        code: 'workflow_graph_projection_invalid',
        message: '当前 Job/Artifact Truth 无法投影为有效工作流图。',
      }],
    };
  }
  if (!repository || typeof repository.saveWorkflowGraph !== 'function') {
    return {
      ok: false,
      diagnostics: [{
        code: 'workflow_graph_repository_unavailable',
        message: '权威工作流图存储不可用，不能授权科学、数据或流程编辑。',
      }],
    };
  }
  try {
    const saved = repository.saveWorkflowGraph(graph.graph);
    if (!saved
        || saved.graphId !== graph.graph.graphId
        || saved.sourceDigest !== graph.graph.sourceDigest
        || saved.rootToolJobId !== graph.graph.rootToolJobId
        || saved.validationStatus !== 'valid') {
      return {
        ok: false,
        diagnostics: [{
          code: 'workflow_graph_persistence_mismatch',
          message: '持久化的工作流图未能精确匹配当前 Job/Artifact Truth 投影。',
        }],
      };
    }
    return { ok: true, graph: saved, persisted: true, diagnostics: [] };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [{
        code: error?.code || 'workflow_graph_persistence_failed',
        message: error?.message || '权威工作流图持久化失败。',
      }],
    };
  }
}

/**
 * P6's executable affected subgraph remains fully server-projected: a current
 * DEG Artifact may feed one or more explicitly admitted direct child Jobs
 * using exact Artifact bytes.  The model never provides node ids, parameters,
 * files, or lineage.  Unsupported shapes remain blocked until a later graph
 * executor can reproduce every edge without inference.
 */
function projectDirectEnrichmentSubgraph({ graph, intent, sourceRevision, repository, getToolJob }) {
  const workflow = graph && graph.graph;
  if (!workflow || !intent || !sourceRevision || !repository || typeof getToolJob !== 'function') {
    return { ok: false, error: 'workflow_subgraph_context_missing', message: '权威工作流子图缺少必要的持久事实。' };
  }
  if (intent.workflowGraph?.graphId !== workflow.graphId || intent.workflowGraph?.sourceDigest !== workflow.sourceDigest) {
    return { ok: false, error: 'workflow_graph_stale_or_unpersisted', message: '编辑意图与当前权威工作流图不一致。' };
  }
  const rootNodeId = `job:${sourceRevision.toolJobId}`;
  const root = (workflow.nodes || []).find((node) => node && node.id === rootNodeId);
  if (!root || root.toolJobId !== sourceRevision.toolJobId) {
    return { ok: false, error: 'workflow_root_unverified', message: '当前 Revision 不再是权威工作流图的根节点。' };
  }
  const affected = Array.isArray(intent.affectedNodeIds) ? intent.affectedNodeIds : [];
  if (new Set(affected).size !== affected.length
      || !affected.includes(rootNodeId)
      || affected.some((nodeId) => !(workflow.nodes || []).some((node) => node.id === nodeId))) {
    return { ok: false, error: 'workflow_affected_nodes_invalid', message: '受影响节点不再匹配当前权威工作流图。' };
  }
  const children = affected.filter((nodeId) => nodeId !== rootNodeId);
  if (children.length === 0) {
    return {
      ok: true,
      subgraph: {
        authority: 'sqlite_job_artifact_truth', graphId: workflow.graphId, sourceDigest: workflow.sourceDigest,
        rootNodeId, rootToolJobId: sourceRevision.toolJobId, rootRevisionId: sourceRevision.revisionId, children: [],
      },
    };
  }
  if (sourceRevision.artifactId !== 'deg_table') {
    return { ok: false, error: 'workflow_subgraph_unsupported', message: '当前只支持从正式 DEG 表向已准入的直接下游节点重跑。' };
  }
  if (children.length > Object.keys(DEG_DIRECT_CHILD_PRIMARY_ARTIFACTS).length) {
    return { ok: false, error: 'workflow_subgraph_unsupported', message: '受影响子图超出已准入的直接 DEG 下游集合。' };
  }
  if (typeof repository.listCurrentRevisions !== 'function') {
    return { ok: false, error: 'workflow_subgraph_context_missing', message: '当前 Revision 真值不可用，不能投影下游重跑。' };
  }
  let currentRevisions;
  try {
    currentRevisions = repository.listCurrentRevisions(sourceRevision.projectId);
  } catch {
    return { ok: false, error: 'downstream_revision_missing', message: '当前下游 Revision 真值读取失败，不能猜测性重跑。' };
  }
  if (!Array.isArray(currentRevisions)) {
    return { ok: false, error: 'downstream_revision_missing', message: '当前下游 Revision 真值无效，不能猜测性重跑。' };
  }

  const projectedChildren = [];
  const seenChildJobs = new Set();
  const seenChildTools = new Set();
  for (const childNodeId of [...children].sort()) {
    const childNodes = (workflow.nodes || []).filter((node) => node && node.id === childNodeId);
    const childNode = childNodes.length === 1 ? childNodes[0] : null;
    const primaryArtifactId = childNode
      ? DEG_DIRECT_CHILD_PRIMARY_ARTIFACTS[childNode.toolId]
      : null;
    const childJob = childNode && getToolJob(childNode.toolJobId);
    const childJobToolId = String(childJob?.tool_id || childJob?.toolId || '');
    const childJobId = String(childJob?.id || '');
    if (!childNode || !primaryArtifactId || !childJob
        || childNode.id !== `job:${childNode.toolJobId}`
        || childJobId !== childNode.toolJobId
        || childJobToolId !== childNode.toolId
        || String(childJob.project_id || childJob.projectId || '') !== sourceRevision.projectId
        || childJob.status !== 'completed'
        || seenChildJobs.has(childJobId)
        || seenChildTools.has(childNode.toolId)) {
      return { ok: false, error: 'workflow_subgraph_unsupported', message: '下游包含重复、缺失或未准入的直接 Job。' };
    }
    seenChildJobs.add(childJobId);
    seenChildTools.add(childNode.toolId);

    const edges = (workflow.edges || []).filter((edge) => edge
      && edge.fromNodeId === rootNodeId && edge.toNodeId === childNode.id);
    if (edges.length !== 1) {
      return { ok: false, error: 'workflow_subgraph_unsupported', message: '下游 Job 必须由唯一的直接 DEG Artifact 边驱动。' };
    }
    const edge = edges[0];
    if (edge.kind !== 'artifact' || edge.inputId !== 'deg_table'
        || edge.selectionId != null || edge.selectionHash != null
        || edge.sourceToolJobId !== sourceRevision.toolJobId
        || edge.sourceRevisionId !== sourceRevision.revisionId
        || edge.sourceArtifactId !== sourceRevision.artifactId
        || edge.sourceOutputHash !== sourceRevision.outputHash) {
      return { ok: false, error: 'workflow_downstream_lineage_drift', message: '直接下游不再使用当前 DEG Revision 的精确 Artifact 字节。' };
    }

    const matchingCurrentRevisions = currentRevisions.filter((revision) => revision
      && revision.projectId === sourceRevision.projectId
      && revision.toolJobId === childJobId
      && revision.artifactId === primaryArtifactId
      && revision.isCurrent === true);
    if (matchingCurrentRevisions.length !== 1 || !matchingCurrentRevisions[0].revisionId) {
      return { ok: false, error: 'downstream_revision_missing', message: '直接下游没有唯一的当前正式 Revision，不能猜测性重跑。' };
    }
    const childRevision = matchingCurrentRevisions[0];
    projectedChildren.push({
      nodeId: childNode.id,
      toolId: childNode.toolId,
      inputId: 'deg_table',
      edgeKind: 'artifact',
      sourceToolJobId: sourceRevision.toolJobId,
      sourceRevisionId: sourceRevision.revisionId,
      sourceArtifactId: sourceRevision.artifactId,
      sourceOutputHash: sourceRevision.outputHash,
      childToolJobId: childJobId,
      childRevisionId: childRevision.revisionId,
    });
  }
  return {
    ok: true,
    subgraph: {
      authority: 'sqlite_job_artifact_truth', graphId: workflow.graphId, sourceDigest: workflow.sourceDigest,
      rootNodeId, rootToolJobId: sourceRevision.toolJobId, rootRevisionId: sourceRevision.revisionId,
      children: projectedChildren,
    },
  };
}

function createResultEditPlanTool(options = {}) {
  const getToolJob = options.getToolJob || db.getToolJob;
  const getPluginManifest = options.getPluginManifest || pluginLoader.getPluginManifest;
  const listProjectToolJobsForWorkflow = options.listProjectToolJobsForWorkflow
    || db.listProjectToolJobsForWorkflow;
  const makeRepository = options.createResultStudioRepository || createResultStudioRepository;
  const buildWorkflowGraph = options.buildAuthoritativeWorkflowGraph || buildAuthoritativeWorkflowGraph;

  return async function tool_result_edit_plan(args = {}, ctx = {}) {
    const projectId = String(ctx.projectId || '').trim();
    if (!projectId) {
      return { ok: false, error: 'project_context_required', message: 'Result edit planning requires an active project.' };
    }
    const toolJob = getToolJob(args.toolJobId);
    if (!toolJob) {
      return { ok: false, error: 'source_job_not_found', message: 'Source tool job was not found.' };
    }
    const jobProjectId = String(toolJob.project_id || toolJob.projectId || '').trim();
    if (jobProjectId !== projectId) {
      return { ok: false, error: 'source_project_mismatch', message: 'Source job does not belong to the active project.' };
    }
    if (args.workflowPlan != null) {
      return {
        ok: false,
        error: 'workflow_plan_forbidden',
        message: '科学编辑只能使用服务端从 SQLite/Job/Artifact Truth 投影的工作流图，不能提交 workflowPlan。',
      };
    }

    const pluginId = toolJob.tool_id || toolJob.toolId;
    const manifest = pluginId ? getPluginManifest(pluginId) : null;
    const parameterImpactRules = manifest && manifest.resultStudio
      ? manifest.resultStudio.parameterImpacts
      : {};
    const repository = options.repository || makeRepository(options.sqlite || db.db || db.getDatabase());
    // Do not consume ctx.resultStudioWorkflowPlan here.  Context-bound tools
    // may carry a fresh projection as an optimization for their own response,
    // but plan authorization must independently rebuild the graph from the
    // durable source of truth so neither a model nor an arbitrary caller can
    // recover authority by injecting a previously-shaped graph object.
    const graph = buildWorkflowGraph({
      projectId,
      sourceToolJobId: toolJob.id,
      jobs: typeof listProjectToolJobsForWorkflow === 'function'
        ? listProjectToolJobsForWorkflow(projectId)
        : [toolJob],
      repository,
    });
    const planned = planResultEdit({
      ...args,
      projectId,
      toolJob,
      // Only trusted plugin metadata can downgrade a parameter below the
      // conservative scientific-recompute fallback. Model arguments cannot.
      parameterImpactRules,
      workflowPlan: graph.ok ? graph.workflowPlan : null,
    });
    if (!graph.ok) return { ...planned, diagnostics: [...(graph.diagnostics || []), ...(planned.diagnostics || [])] };
    if (planned.ok && scientificEditClass(planned.intent?.editClass)) {
      const snapshot = persistAuthoritativeWorkflowGraph(repository, graph);
      if (!snapshot.ok) {
        return {
          ...planned,
          ok: false,
          status: 'blocked',
          diagnostics: [
            ...(planned.diagnostics || []),
            ...snapshot.diagnostics,
          ],
        };
      }
    }
    return planned;
  };
}

const tool_result_edit_plan = createResultEditPlanTool();

function authorizeProject(project, userId, dbModule) {
  if (!project) return false;
  if (!userId || project.user_id === userId || project.is_public === 1) return true;
  try {
    return dbModule.getUserById(userId)?.role === 'admin';
  } catch {
    return false;
  }
}

function createResultChangeSetTools(options = {}) {
  const dbModule = options.db || db;
  const loadPlugin = options.getPlugin || pluginLoader.getPlugin;
  const getResultStudioDescriptor = options.getResultStudioDescriptor || ((toolId) => {
    const manifest = pluginLoader.getPluginManifest(toolId);
    return manifest && manifest.resultStudio ? manifest.resultStudio : null;
  });
  const callTool = options.callTool || mcpRegistry.callTool;
  const bindRepository = options.bindProjectRepository || bindProjectRepository;
  const makeRepository = options.createResultStudioRepository || createResultStudioRepository;
  const runChangeSet = options.createResultChangeSet || createResultChangeSet;
  const inspectRecovery = options.inspectResultEditRecovery || inspectResultEditRecovery;
  const compareChangeSet = options.compareResultChangeSet || compareResultChangeSet;
  const adoptChangeSet = options.adoptResultChangeSet || adoptResultChangeSet;
  const revertChangeSet = options.revertResultChangeSet || revertResultChangeSet;
  const restoreRevision = options.restoreArtifactRevision || restoreArtifactRevision;

  function context(ctx, { write = false, git = write } = {}) {
    const projectId = String(ctx.projectId || '').trim();
    if (!projectId) return { error: 'project_context_required' };
    const project = dbModule.getProject(projectId);
    if (!authorizeProject(project, ctx.userId, dbModule)) return { error: 'source_project_mismatch' };
    const repository = makeRepository(dbModule.db || dbModule.getDatabase());
    if (!git) return { projectId, project, repository, binding: null };
    const binding = bindRepository({
      workspaceRoot: project.workspace_path,
      projectId,
      createManagedIfMissing: write,
    });
    if (!binding?.adapter || (write && binding.status !== 'ready')) {
      return { error: binding?.reason || binding?.status || 'repository_binding_failed', binding };
    }
    if (write) repository.saveRepositoryBinding({
        projectId,
        mode: binding.mode,
        workspaceRoot: binding.workspaceRoot,
        gitDir: binding.adapter.gitDir,
        workTree: binding.adapter.workTree,
        managedPaths: binding.managedPaths,
        status: binding.status,
        reason: binding.reason,
        gitVersion: binding.inspection?.runtime?.versionRaw || null,
      });
    return { projectId, project, repository, binding };
  }

  async function create(args = {}, ctx = {}) {
    const scoped = context(ctx, { write: true });
    if (scoped.error) return { ok: false, error: scoped.error, message: 'Result Studio project or Git binding is unavailable.' };
    const revisionId = args.intent && args.intent.artifactRef && args.intent.artifactRef.revisionId;
    const sourceRevision = scoped.repository.getRevision(revisionId);
    if (!sourceRevision || sourceRevision.projectId !== scoped.projectId) {
      return { ok: false, error: 'source_revision_not_found', message: 'Source ArtifactRevision was not found in the active project.' };
    }
    const sourceJob = dbModule.getToolJob(sourceRevision.toolJobId);
    if (!sourceJob || String(sourceJob.project_id || '') !== scoped.projectId) {
      return { ok: false, error: 'source_job_not_found', message: 'Source tool_job was not found in the active project.' };
    }
    const pluginId = sourceJob.tool_id;
    const plugin = loadPlugin(pluginId);
    if (!plugin) return { ok: false, error: 'source_plugin_not_found', message: `Plugin is unavailable: ${pluginId}` };
    let authoritativeSubgraph = null;
    if (scientificEditClass(args.intent?.editClass)) {
      // Raw model arguments cannot manufacture a scientific ChangeSet.  The
      // context-bound path verifies the same-turn intent before setting this
      // private marker; legacy/raw callers remain limited to non-scientific
      // presentation work until they adopt the focused Result Studio flow.
      if (ctx.resultStudioTrustedIntent !== true) {
        return {
          ok: false,
          error: 'context_bound_scientific_intent_required',
          message: '科学、数据和流程修改必须先通过当前结果的 context-bound 规划与确认。',
        };
      }
      const jobs = typeof dbModule.listProjectToolJobsForWorkflow === 'function'
        ? dbModule.listProjectToolJobsForWorkflow(scoped.projectId)
        : [];
      const graph = buildAuthoritativeWorkflowGraph({
        projectId: scoped.projectId,
        sourceToolJobId: sourceRevision.toolJobId,
        jobs,
        repository: scoped.repository,
      });
      const snapshot = persistedWorkflowGraph(scoped.repository, graph);
      if (!graph.ok || !snapshot
          || args.intent?.workflowGraph?.graphId !== graph.graph.graphId
          || args.intent?.workflowGraph?.sourceDigest !== graph.graph.sourceDigest) {
        return {
          ok: false,
          error: 'workflow_graph_stale_or_unpersisted',
          message: '权威工作流图不存在、已漂移或未持久化；请重新从当前结果规划科学修改。',
          diagnostics: graph.ok ? [] : graph.diagnostics || [],
        };
      }
      const projection = projectDirectEnrichmentSubgraph({
        graph,
        intent: args.intent,
        sourceRevision,
        repository: scoped.repository,
        getToolJob: dbModule.getToolJob,
      });
      if (!projection.ok) {
        return { ok: false, error: projection.error, message: projection.message };
      }
      authoritativeSubgraph = projection.subgraph;
    }
    try {
      const projected = projectRevisionSource({ projectId: scoped.projectId, revision: sourceRevision }, {
        repository: scoped.repository,
        adapter: scoped.binding.adapter,
        gitPathPrefix: '',
        workspaceRoot: scoped.project.workspace_path,
        getToolJob: dbModule.getToolJob,
      });
      if (!projected.parameters?.values) return { ok: false, error: 'source_parameters_missing', message: 'Exact Revision parameters are unavailable.' };
      return await runChangeSet({
        projectId: scoped.projectId,
        conversationId: ctx.conversationId || null,
        workspaceRoot: scoped.project.workspace_path,
        intent: args.intent,
        sourceRevision,
        sourceJob,
        sourceScriptContent: projected.content,
        sourceScriptSha256: projected.sha256,
        normalizedSourceParams: projected.parameters.values,
        pluginId,
        language: plugin.language,
        scriptPatch: args.scriptPatch || [],
        scientificConfirmed: args.scientificConfirmed === true,
        authoritativeSubgraph,
        createdBy: 'agent',
      }, {
        repository: scoped.repository,
        adapter: scoped.binding.adapter,
        gitPathPrefix: '',
        getToolJob: dbModule.getToolJob,
        getResultStudioDescriptor,
        authoritativeSubgraphTrusted: authoritativeSubgraph !== null,
        shouldCancel: () => typeof ctx.isCancelled === 'function' && ctx.isCancelled(),
        onProgress: (event) => {
          if (typeof ctx.emitResultEditProgress === 'function') ctx.emitResultEditProgress(event);
        },
        executeJob: async ({
          toolId, params, materializedScriptPath, materializedScriptSha256, changeSetId, resultStudioInputLineage = null,
        }) => {
          const result = await callTool(toolId, params, {
            userId: ctx.userId || 'agent',
            projectId: scoped.projectId,
            conversationId: ctx.conversationId || null,
            resultStudioMaterializedScript: {
              path: materializedScriptPath,
              sha256: materializedScriptSha256,
              changeSetId,
            },
            resultStudioInputLineage,
          });
          const toolJobId = result && result.toolJobId;
          return { result, toolJobId, job: toolJobId ? dbModule.getToolJob(toolJobId) : null };
        },
      });
    } catch (error) {
      return {
        ok: false,
        error: error.code || 'result_changeset_failed',
        message: error.message,
        detail: error.detail || null,
      };
    }
  }

  async function status(args = {}, ctx = {}) {
    const scoped = context(ctx, { git: true });
    if (scoped.error) return { ok: false, error: scoped.error };
    const changeSet = scoped.repository.getChangeSet(args.changeSetId);
    if (!changeSet || changeSet.projectId !== scoped.projectId) return { ok: false, error: 'change_set_not_found' };
    const recovery = inspectRecovery({
      repository: scoped.repository,
      adapter: scoped.binding.adapter,
      workspaceRoot: scoped.project.workspace_path,
      projectId: scoped.projectId,
    }).find((entry) => entry.changeSet.changeSetId === changeSet.changeSetId) || null;
    return {
      ok: true,
      changeSet,
      revisions: scoped.repository.listRevisionsByChangeSet(changeSet.changeSetId),
      recovery,
    };
  }

  async function compare(args = {}, ctx = {}) {
    const scoped = context(ctx, { git: true });
    if (scoped.error) return { ok: false, error: scoped.error };
    const changeSet = scoped.repository.getChangeSet(args.changeSetId);
    if (!changeSet || changeSet.projectId !== scoped.projectId) return { ok: false, error: 'change_set_not_found' };
    try {
      return {
        ok: true,
        comparison: compareChangeSet({
          projectId: scoped.projectId,
          workspaceRoot: scoped.project.workspace_path,
          changeSetId: changeSet.changeSetId,
        }, {
          repository: scoped.repository,
          adapter: scoped.binding.adapter,
          gitPathPrefix: '',
        }),
      };
    } catch (error) {
      return { ok: false, error: error.code || 'compare_failed', message: error.message };
    }
  }

  async function adopt(args = {}, ctx = {}) {
    const scoped = context(ctx, { write: true });
    if (scoped.error) return { ok: false, error: scoped.error };
    try {
      return {
        ok: true,
        ...adoptChangeSet({
          projectId: scoped.projectId,
          workspaceRoot: scoped.project.workspace_path,
          changeSetId: args.changeSetId,
        }, {
          repository: scoped.repository,
          adapter: scoped.binding.adapter,
          gitPathPrefix: '',
          getToolJob: dbModule.getToolJob,
        }),
      };
    } catch (error) {
      return { ok: false, error: error.code || 'adopt_failed', message: error.message };
    }
  }

  async function revert(args = {}, ctx = {}) {
    const scoped = context(ctx, { write: true });
    if (scoped.error) return { ok: false, error: scoped.error };
    try {
      return {
        ok: true,
        ...revertChangeSet({
          projectId: scoped.projectId,
          workspaceRoot: scoped.project.workspace_path,
          changeSetId: args.changeSetId,
          reason: args.reason || 'agent_reverted',
        }, { repository: scoped.repository, adapter: scoped.binding.adapter }),
      };
    } catch (error) {
      return { ok: false, error: error.code || 'revert_failed', message: error.message };
    }
  }

  async function listRevisions(args = {}, ctx = {}) {
    const scoped = context(ctx);
    if (scoped.error) return { ok: false, error: scoped.error };
    const revisions = scoped.repository.listRevisions({ artifactFamilyId: args.artifactFamilyId, projectId: scoped.projectId, limit: 100 });
    return {
      ok: true,
      revisions,
      currentRevision: scoped.repository.getCurrentRevision(args.artifactFamilyId, scoped.projectId),
    };
  }

  async function restore(args = {}, ctx = {}) {
    const scoped = context(ctx, { write: true });
    if (scoped.error) return { ok: false, error: scoped.error };
    try {
      return {
        ok: true,
        ...restoreRevision({
          projectId: scoped.projectId,
          workspaceRoot: scoped.project.workspace_path,
          revisionId: args.revisionId,
          conversationId: ctx.conversationId || null,
          createdBy: 'agent',
        }, {
          repository: scoped.repository,
          adapter: scoped.binding.adapter,
          gitPathPrefix: '',
          getToolJob: dbModule.getToolJob,
          getResultStudioDescriptor,
        }),
      };
    } catch (error) {
      return { ok: false, error: error.code || 'restore_failed', message: error.message };
    }
  }

  return { create, status, compare, adopt, revert, listRevisions, restore };
}

const resultChangeSetTools = createResultChangeSetTools();
const tool_result_changeset_create = resultChangeSetTools.create;
const tool_result_changeset_status = resultChangeSetTools.status;
const tool_result_changeset_compare = resultChangeSetTools.compare;
const tool_result_changeset_adopt = resultChangeSetTools.adopt;
const tool_result_changeset_revert = resultChangeSetTools.revert;
const tool_artifact_revision_list = resultChangeSetTools.listRevisions;
const tool_artifact_revision_restore = resultChangeSetTools.restore;

module.exports = {
  createResultEditPlanTool,
  createResultChangeSetTools,
  projectDirectEnrichmentSubgraph,
  tool_result_edit_plan,
  tool_result_changeset_create,
  tool_result_changeset_status,
  tool_result_changeset_compare,
  tool_result_changeset_adopt,
  tool_result_changeset_revert,
  tool_artifact_revision_list,
  tool_artifact_revision_restore,
};
