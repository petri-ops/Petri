'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stableStringify } = require('./canonical-json');
const { isSafeRelativePath } = require('./result-studio-contracts');

const EXECUTION_PROVENANCE_VERSION = 1;

function sha256Buffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function hashFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return sha256Buffer(fs.readFileSync(filePath));
}

function executionProvenancePayload(provenance) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return null;
  const { provenanceHash: _provenanceHash, ...payload } = provenance;
  return payload;
}

function computeExecutionProvenanceHash(provenance) {
  const payload = executionProvenancePayload(provenance);
  return payload == null
    ? null
    : sha256Buffer(Buffer.from(stableStringify(payload)));
}

function verifyExecutionProvenance(provenance) {
  const actualHash = typeof provenance?.provenanceHash === 'string'
    ? provenance.provenanceHash.trim()
    : '';
  const expectedHash = computeExecutionProvenanceHash(provenance);
  return {
    ok: /^[a-f0-9]{64}$/.test(actualHash) && actualHash === expectedHash,
    actualHash: actualHash || null,
    expectedHash,
  };
}

function isContained(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function containedRegularFile(root, candidate) {
  if (!candidate) return null;
  try {
    const target = fs.realpathSync(candidate);
    return isContained(root, target) && fs.statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

function resolveExecutionInputPath({ workspaceRoot, input, sourceParams = {}, provenance = null } = {}) {
  let root;
  try { root = fs.realpathSync(workspaceRoot); } catch {
    return { path: null, source: null, reason: 'workspace_unavailable' };
  }
  const inputId = typeof input?.id === 'string' ? input.id.trim() : '';
  const relativePath = typeof input?.relativePath === 'string' ? input.relativePath.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(inputId)
      || !isSafeRelativePath(relativePath)) {
    return { path: null, source: null, reason: 'input_identity_invalid' };
  }

  const supplied = sourceParams && typeof sourceParams[inputId] === 'string'
    ? sourceParams[inputId]
    : null;
  if (supplied) {
    if (path.isAbsolute(supplied)) {
      const target = containedRegularFile(root, supplied);
      return target
        ? { path: target, source: 'explicit_parameter', reason: null }
        : { path: null, source: null, reason: 'explicit_parameter_unavailable' };
    }
    if (!isSafeRelativePath(supplied)) {
      return { path: null, source: null, reason: 'explicit_parameter_unsafe' };
    }
  }

  const logicalPath = path.resolve(root, relativePath);
  if (isContained(root, logicalPath)) {
    const target = containedRegularFile(root, logicalPath);
    if (target) return { path: target, source: 'logical_relative_path', reason: null };
  }

  const snapshot = containedRegularFile(root, provenance?.script?.snapshotPath);
  if (!snapshot) return { path: null, source: null, reason: 'snapshot_unavailable' };
  const jobRoot = path.dirname(snapshot);
  if (supplied) {
    const target = containedRegularFile(root, path.resolve(jobRoot, supplied));
    if (target) return { path: target, source: 'explicit_parameter', reason: null };
  }
  const expectedName = path.basename(relativePath);
  const fromDirectory = (directory, source) => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return null; }
    const exact = entries.find((entry) => entry.isFile() && entry.name === expectedName);
    if (exact) {
      const target = containedRegularFile(root, path.join(directory, exact.name));
      return target ? { path: target, source, reason: null } : null;
    }
    const matches = entries
      .filter((entry) => entry.isFile() && (entry.name === inputId || entry.name.startsWith(`${inputId}.`)))
      .map((entry) => containedRegularFile(root, path.join(directory, entry.name)))
      .filter(Boolean);
    if (matches.length === 1) return { path: matches[0], source, reason: null };
    if (matches.length > 1) return { path: null, source: null, reason: 'snapshot_input_ambiguous' };
    return null;
  };
  const canonical = fromDirectory(path.join(jobRoot, 'inputs', inputId), 'job_canonical_input');
  if (canonical) return canonical;
  const legacy = fromDirectory(jobRoot, 'job_compatibility_input');
  if (legacy) return legacy;
  return { path: null, source: null, reason: 'snapshot_input_missing' };
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
    lineage: input.lineage && typeof input.lineage === 'object' && !Array.isArray(input.lineage)
      ? { ...input.lineage }
      : null,
  }));
  const normalizedParams = { ...params };
  for (const input of inputSnapshots) {
    if (input.id) {
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
  return { ...record, provenanceHash: computeExecutionProvenanceHash(record) };
}

function attachProvenanceToResult(result, provenance, provenancePath = null) {
  const ref = { provenanceHash: provenance.provenanceHash, path: provenancePath, toolJobId: provenance.toolJobId };
  const artifacts = (result.artifacts || []).map((artifact) => ({ ...artifact, provenance: { ...ref, reproductionTarget: artifact.id || artifact.filename || artifact.name || null } }));
  return { ...result, executionProvenance: provenance, provenanceRef: ref, artifacts, outputs: artifacts.map((item) => ({ ...item })), files: artifacts.map((item) => ({ ...item })) };
}

module.exports = {
  EXECUTION_PROVENANCE_VERSION,
  hashFile,
  computeExecutionProvenanceHash,
  verifyExecutionProvenance,
  resolveExecutionInputPath,
  createExecutionProvenance,
  attachProvenanceToResult,
};
