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

function createResultEditPlanTool(options = {}) {
  const getToolJob = options.getToolJob || db.getToolJob;
  const getPluginManifest = options.getPluginManifest || pluginLoader.getPluginManifest;

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

    const pluginId = toolJob.tool_id || toolJob.toolId;
    const manifest = pluginId ? getPluginManifest(pluginId) : null;
    const parameterImpactRules = manifest && manifest.resultStudio
      ? manifest.resultStudio.parameterImpacts
      : {};
    return planResultEdit({
      ...args,
      projectId,
      toolJob,
      // Only trusted plugin metadata can downgrade a parameter below the
      // conservative scientific-recompute fallback. Model arguments cannot.
      parameterImpactRules,
    });
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
      preferManaged: false,
      allowExistingRepository: true,
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
    try {
      const projected = projectRevisionSource({ projectId: scoped.projectId, revision: sourceRevision }, {
        repository: scoped.repository,
        adapter: scoped.binding.adapter,
        gitPathPrefix: scoped.binding.mode === 'existing'
          ? scoped.binding.inspection?.existing?.workspaceRelativeToRepository
          : '',
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
        previewResourceEstimate: args.previewResourceEstimate || null,
        scientificConfirmed: args.scientificConfirmed === true,
        createdBy: 'agent',
      }, {
        repository: scoped.repository,
        adapter: scoped.binding.adapter,
        gitPathPrefix: scoped.binding.mode === 'existing'
          ? scoped.binding.inspection?.existing?.workspaceRelativeToRepository
          : '',
        getToolJob: dbModule.getToolJob,
        shouldCancel: () => typeof ctx.isCancelled === 'function' && ctx.isCancelled(),
        activePreviewJobs: typeof scoped.repository.listChangeSets === 'function'
          ? scoped.repository.listChangeSets({ projectId: scoped.projectId, status: 'running', limit: 500 }).length
          : 0,
        onProgress: (event) => {
          if (typeof ctx.emitResultEditProgress === 'function') ctx.emitResultEditProgress(event);
        },
        executeJob: async ({ toolId, params, materializedScriptPath, materializedScriptSha256, changeSetId }) => {
          const result = await callTool(toolId, params, {
            userId: ctx.userId || 'agent',
            projectId: scoped.projectId,
            resultStudioMaterializedScript: {
              path: materializedScriptPath,
              sha256: materializedScriptSha256,
              changeSetId,
            },
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
          gitPathPrefix: scoped.binding.mode === 'existing'
            ? scoped.binding.inspection?.existing?.workspaceRelativeToRepository
            : '',
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
          gitPathPrefix: scoped.binding.mode === 'existing'
            ? scoped.binding.inspection?.existing?.workspaceRelativeToRepository
            : '',
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
          gitPathPrefix: scoped.binding.mode === 'existing'
            ? scoped.binding.inspection?.existing?.workspaceRelativeToRepository
            : '',
          getToolJob: dbModule.getToolJob,
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
  tool_result_edit_plan,
  tool_result_changeset_create,
  tool_result_changeset_status,
  tool_result_changeset_compare,
  tool_result_changeset_adopt,
  tool_result_changeset_revert,
  tool_artifact_revision_list,
  tool_artifact_revision_restore,
};
