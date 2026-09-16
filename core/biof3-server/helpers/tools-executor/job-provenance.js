'use strict';

const fs = require('fs');
const path = require('path');
const { scriptExtensionFor } = require('../../../shared-backend/script-host-languages');
const { createExecutionProvenance, collectExecutionInputs } = require('../../../shared-backend/execution-provenance');

function buildJobProvenance({
  jobId,
  job,
  toolId,
  cfg,
  jobDir,
  runtimeCommand,
  runtimeReady,
  runtimeVersion,
  runCmd,
  startedAt,
  artifacts = [],
  executionTarget = null,
}) {
  const dbMod = require('../db');
  const pluginLoader = require('../plugin-loader');
  const toolDefinition = pluginLoader.getToolDefinition(toolId) || {};
  const pluginManifest = pluginLoader.getPluginManifest(toolId) || cfg;
  const scientificTask = typeof dbMod.getScientificTaskByToolJob === 'function' ? dbMod.getScientificTaskByToolJob(jobId) : null;
  const provenance = createExecutionProvenance({
    toolJobId: jobId,
    projectId: job.project_id || null,
    scientificTask,
    plugin: pluginManifest,
    params: job.params || {},
    inputs: collectExecutionInputs({
      inputDefinitions: Array.isArray(toolDefinition.inputs) ? toolDefinition.inputs : [],
      params: job.params || {},
      jobDir,
    }),
    runtime: { name: cfg.lang || null, command: runtimeCommand, version: runtimeVersion, ready: runtimeReady?.ready },
    runScriptPath: path.join(jobDir, 'run-script.' + scriptExtensionFor(cfg.lang)),
    command: { executable: runCmd[0], args: runCmd.slice(1), cwd: jobDir },
    artifacts,
    startedAt,
    completedAt: new Date().toISOString(),
  });
  if (executionTarget) {
    provenance.executionTarget = executionTarget;
  }
  const provenancePath = path.join(jobDir, 'provenance.json');
  fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));
  return { provenance, provenancePath, pluginManifest };
}


module.exports = { buildJobProvenance };
