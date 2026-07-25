'use strict';

const db = require('../db');
const pluginLoader = require('../plugin-loader');
const { planResultEdit } = require('../../shared-backend/result-edit-intent');

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

module.exports = { createResultEditPlanTool, tool_result_edit_plan };
