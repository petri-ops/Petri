'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stableStringify } = require('./scientific-task-spec');

const EXECUTION_PROVENANCE_VERSION = 1;

function sha256Buffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function hashFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return sha256Buffer(fs.readFileSync(filePath));
}

function createExecutionProvenance({
  toolJobId, projectId, scientificTask = null, plugin = {}, params = {},
  runtime = {}, runScriptPath = null, command = null, artifacts = [], inputs = [], startedAt = null, completedAt = null,
} = {}) {
  if (!toolJobId) throw new Error('provenance_tool_job_id_required');
  const scriptHash = hashFile(runScriptPath);
  const taskSpec = scientificTask?.spec || null;
  const inputSnapshots = ((taskSpec?.inputs && taskSpec.inputs.length > 0) ? taskSpec.inputs : inputs).map((input) => ({
    id: input.id || null,
    role: input.role || null,
    relativePath: input.relativePath,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    sourceArtifactRef: input.sourceArtifactRef || null,
  }));
  const normalizedParams = { ...params };
  for (const input of inputSnapshots) {
    if (input.id && Object.prototype.hasOwnProperty.call(normalizedParams, input.id)) {
      normalizedParams[input.id] = { inputRef: input.relativePath, sha256: input.sha256 };
    }
  }
  const language = plugin.language || null;
  const record = {
    executionProvenanceVersion: EXECUTION_PROVENANCE_VERSION,
    toolJobId,
    projectId: projectId || null,
    task: scientificTask ? { taskId: scientificTask.task_id, version: scientificTask.version, specHash: scientificTask.spec_hash, confirmationVersion: scientificTask.confirmation?.confirmationVersion || null } : null,
    plugin: { id: plugin.id || null, version: plugin.version || null, language, manifestFingerprint: plugin.execution?.scriptFingerprint || plugin._currentFingerprint || null, packageConstraints: plugin.packages?.[language] || {} },
    runtime: { name: runtime.name || runtime.runtime || plugin.language || null, command: runtime.command || null, version: runtime.version || plugin.builtAgainst?.[plugin.language] || null, versionSource: runtime.version ? 'runtime_probe' : plugin.builtAgainst?.[plugin.language] ? 'plugin_built_against' : null, readiness: runtime.ready ?? null },
    params: { normalized: normalizedParams, sha256: sha256Buffer(Buffer.from(stableStringify(normalizedParams))) },
    inputs: inputSnapshots,
    script: { snapshotPath: runScriptPath ? path.resolve(runScriptPath) : null, sha256: scriptHash, entryPoint: plugin.entryPoint || null },
    command: command ? { executable: command.executable || null, args: Array.isArray(command.args) ? command.args : [], cwd: command.cwd || null } : null,
    startedAt,
    completedAt,
    artifacts: (artifacts || []).map((artifact) => ({ id: artifact.id || null, filename: artifact.filename || artifact.name || null, type: artifact.type || null, sha256: hashFile(artifact.path), reproductionTarget: artifact.id || artifact.filename || artifact.name || null })),
  };
  return { ...record, provenanceHash: sha256Buffer(Buffer.from(stableStringify(record))) };
}

function attachProvenanceToResult(result, provenance, provenancePath = null) {
  const ref = { provenanceHash: provenance.provenanceHash, path: provenancePath, toolJobId: provenance.toolJobId };
  const artifacts = (result.artifacts || []).map((artifact) => ({ ...artifact, provenance: { ...ref, reproductionTarget: artifact.id || artifact.filename || artifact.name || null } }));
  return { ...result, executionProvenance: provenance, provenanceRef: ref, artifacts, outputs: artifacts.map((item) => ({ ...item })), files: artifacts.map((item) => ({ ...item })) };
}

module.exports = { EXECUTION_PROVENANCE_VERSION, hashFile, createExecutionProvenance, attachProvenanceToResult };
