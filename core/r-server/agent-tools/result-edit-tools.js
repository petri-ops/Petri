'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const pluginLoader = require('../plugin-loader');
const mcpRegistry = require('../mcp/registry');
const { planResultEdit } = require('../../shared-backend/result-edit-intent');
const { createResultChangeSet, inspectResultEditRecovery } = require('../../shared-backend/result-changeset-service');
const { createResultStudioRepository } = require('../../shared-backend/result-studio-repository');
const { bindProjectRepository } = require('../../shared-backend/git-repository-binding');
const { isPathContained } = require('../../shared-backend/project-run-layout');

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

  function context(ctx) {
    const projectId = String(ctx.projectId || '').trim();
    if (!projectId) return { error: 'project_context_required' };
    const project = dbModule.getProject(projectId);
    if (!authorizeProject(project, ctx.userId, dbModule)) return { error: 'source_project_mismatch' };
    const repository = makeRepository(dbModule.db || dbModule.getDatabase());
    const binding = bindRepository({
      workspaceRoot: project.workspace_path,
      projectId,
      preferManaged: false,
      allowExistingRepository: true,
    });
    if (!binding || binding.status !== 'ready' || !binding.adapter) {
      return { error: binding?.reason || binding?.status || 'repository_binding_failed', binding };
    }
    repository.saveRepositoryBinding({
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
    const scoped = context(ctx);
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
    const snapshot = sourceJob.result?.executionProvenance?.script;
    if (!snapshot?.snapshotPath || !snapshot.sha256) {
      return { ok: false, error: 'source_script_missing', message: 'Source execution script snapshot is unavailable.' };
    }
    let sourceScriptPath;
    try {
      sourceScriptPath = fs.realpathSync(snapshot.snapshotPath);
      const realWorkspace = fs.realpathSync(scoped.project.workspace_path);
      if (!isPathContained(realWorkspace, sourceScriptPath)) throw new Error('source_script_outside_project');
    } catch (error) {
      return { ok: false, error: 'source_script_unavailable', message: error.message };
    }
    const sourceScriptContent = fs.readFileSync(sourceScriptPath, 'utf8');

    try {
      return await runChangeSet({
        projectId: scoped.projectId,
        conversationId: ctx.conversationId || null,
        workspaceRoot: scoped.project.workspace_path,
        intent: args.intent,
        sourceRevision,
        sourceJob,
        sourceScriptContent,
        sourceScriptSha256: snapshot.sha256,
        pluginId,
        language: plugin.language,
        scriptPatch: args.scriptPatch || [],
        scientificConfirmed: args.scientificConfirmed === true,
        createdBy: 'agent',
      }, {
        repository: scoped.repository,
        adapter: scoped.binding.adapter,
        gitPathPrefix: scoped.binding.mode === 'existing'
          ? scoped.binding.inspection?.existing?.workspaceRelativeToRepository
          : '',
        shouldCancel: () => typeof ctx.isCancelled === 'function' && ctx.isCancelled(),
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
    const scoped = context(ctx);
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

  return { create, status };
}

const resultChangeSetTools = createResultChangeSetTools();
const tool_result_changeset_create = resultChangeSetTools.create;
const tool_result_changeset_status = resultChangeSetTools.status;

module.exports = {
  createResultEditPlanTool,
  createResultChangeSetTools,
  tool_result_edit_plan,
  tool_result_changeset_create,
  tool_result_changeset_status,
};
