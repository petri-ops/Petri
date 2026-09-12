'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isPathContained } = require('./project-run-layout');
const { isSafeRelativePath } = require('./result-studio-contracts');
const { stableStringify } = require('./canonical-json');
const { resolveExecutionInputPath } = require('./execution-provenance');

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_PARAMETERS_BYTES = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SENSITIVE_KEY = /(?:api.?key|access.?token|secret|password|credential|private.?key)/i;

class ResultRevisionSourceError extends Error {
  constructor(code, message, status = 409, detail = null) {
    super(message);
    this.name = 'ResultRevisionSourceError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fail(code, message, status = 409, detail = null) {
  throw new ResultRevisionSourceError(code, message, status, detail);
}

function safeRef(value, field, required = false) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized && !required) return null;
  if (!normalized || !isSafeRelativePath(normalized)) {
    fail(`${field}_invalid`, `${field} is not a safe project-relative path.`);
  }
  return normalized;
}

function parseJsonObject(text, code) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, 'Parameters must be a JSON object.');
    return value;
  } catch (error) {
    if (error instanceof ResultRevisionSourceError) throw error;
    fail(code, 'Parameters JSON is invalid.');
  }
}

function sanitizeValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string' && path.isAbsolute(value)) return '[redacted-path]';
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeValue(child, childKey)]));
  }
  return value;
}

function parseResult(job) {
  if (!job) return {};
  if (job.result && typeof job.result === 'object') return job.result;
  try { return JSON.parse(job.result_json || '{}'); } catch { return {}; }
}

function exactArtifact(result, artifactId) {
  const matches = (Array.isArray(result?.artifacts) ? result.artifacts : [])
    .filter((artifact) => artifact && artifact.id === artifactId);
  return matches.length === 1 ? matches[0] : null;
}

function projectGitPath(relativePath, gitPathPrefix = '') {
  const safe = safeRef(relativePath, 'sourceScriptRef.relativePath', true);
  const prefix = String(gitPathPrefix || '').replace(/^\/+|\/+$/g, '');
  return prefix ? path.posix.join(prefix, safe) : safe;
}

function verifyCommit(adapter, sourceCommit) {
  if (!COMMIT.test(String(sourceCommit || ''))) fail('source_commit_invalid', 'Revision source commit is invalid.');
  // `git rev-parse --verify <40-hex>` accepts a syntactically complete object
  // id even when the object is absent. Peeling to a commit forces the object
  // lookup, so an expired/pruned Revision cannot fall through to a generic
  // missing-file response or, worse, a nearby worktree fallback.
  if (adapter.revParse(`${sourceCommit}^{commit}`) !== sourceCommit) {
    fail('source_commit_unavailable', 'Revision source commit is unavailable.');
  }
}

function classifyScope(sourceScriptRef) {
  if (sourceScriptRef?.origin === 'project_materialized') return 'artifact_specific_materialization';
  if (sourceScriptRef?.origin === 'execution_snapshot') return 'job_shared_execution_snapshot';
  if (sourceScriptRef?.origin === 'canonical_plugin') return 'canonical_plugin_shared';
  return 'unknown_legacy';
}

function inputStatus({ workspaceRoot, inputs, params = {}, provenance = null }) {
  const statuses = [];
  for (const input of Array.isArray(inputs) ? inputs : []) {
    let status = 'unavailable';
    try {
      safeRef(input?.relativePath, 'input.relativePath', true);
      const resolved = resolveExecutionInputPath({
        workspaceRoot,
        input,
        sourceParams: params,
        provenance,
      });
      if (!resolved.path) status = 'missing';
      else status = sha256(fs.readFileSync(resolved.path)) === input.sha256 ? 'intact' : 'hash_drift';
    } catch {
      status = 'missing';
    }
    statuses.push({ artifactId: input?.sourceArtifactRef || input?.id || null, role: input?.role || null, sha256: input?.sha256 || null, status });
  }
  return statuses;
}

function projectRevisionSource(input = {}, dependencies = {}) {
  const projectId = String(input.projectId || '').trim();
  const repository = dependencies.repository;
  const adapter = dependencies.adapter;
  const getToolJob = dependencies.getToolJob;
  if (!projectId || !repository || !adapter || typeof getToolJob !== 'function') fail('projection_dependencies_missing', 'Revision source projection dependencies are incomplete.', 500);
  const revision = input.revision || repository.getRevision(String(input.revisionId || '').trim());
  if (!revision || revision.projectId !== projectId) fail('revision_not_found', 'Revision is not available in this project.', 404);
  const changeSet = revision.changeSetId ? repository.getChangeSet(revision.changeSetId) : null;
  if (!changeSet || changeSet.projectId !== projectId || changeSet.candidateCommit !== revision.sourceCommit) {
    fail('revision_lineage_invalid', 'Revision lineage is not bound to this project and source commit.');
  }
  const sourceRef = revision.sourceScriptRef;
  if (!sourceRef || !sourceRef.relativePath || !SHA256.test(sourceRef.sha256 || '')
    || sourceRef.artifactId !== revision.artifactId || !sourceRef.rendererId || !sourceRef.language) {
    fail('source_ref_invalid', 'Revision source reference is incomplete.');
  }
  const sourcePath = projectGitPath(sourceRef.relativePath, dependencies.gitPathPrefix);
  verifyCommit(adapter, revision.sourceCommit);
  let content;
  try {
    content = adapter.showFile({ ref: revision.sourceCommit, filePath: sourcePath });
  } catch {
    fail('source_unavailable', 'Revision source content is unavailable or exceeds the safe limit.');
  }
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_SOURCE_BYTES || content.includes('\0')) {
    fail('source_unavailable', 'Revision source content is unavailable or exceeds the safe limit.');
  }
  if (sha256(content) !== sourceRef.sha256) fail('source_hash_mismatch', 'Revision source content does not match its recorded hash.');
  if (input.expectSha256 && (!SHA256.test(input.expectSha256) || input.expectSha256 !== sourceRef.sha256)) {
    fail('source_expectation_stale', 'The requested source hash no longer matches this Revision.');
  }

  const parametersPath = safeRef(revision.parametersRef, 'parametersRef');
  let parameters = null;
  if (parametersPath) {
    if (!SHA256.test(revision.parametersHash || '')) fail('parameters_hash_invalid', 'Revision parameters hash is invalid.');
    let parametersText;
    try {
      parametersText = adapter.showFile({ ref: revision.sourceCommit, filePath: projectGitPath(parametersPath, dependencies.gitPathPrefix) });
    } catch {
      fail('parameters_unavailable', 'Revision parameters are unavailable or too large.');
    }
    if (typeof parametersText !== 'string' || Buffer.byteLength(parametersText) > MAX_PARAMETERS_BYTES) fail('parameters_unavailable', 'Revision parameters are unavailable or too large.');
    if (sha256(parametersText) !== revision.parametersHash) fail('parameters_hash_mismatch', 'Revision parameters do not match their recorded hash.');
    parameters = { text: parametersText, values: parseJsonObject(parametersText, 'parameters_invalid'), sha256: revision.parametersHash, relativePath: parametersPath };
  }

  const job = getToolJob(revision.toolJobId);
  const result = parseResult(job);
  const provenance = result.executionProvenance;
  if (!job || String(job.project_id || job.projectId || '') !== projectId || job.status !== 'completed') fail('source_job_invalid', 'Revision is not backed by a completed Job in this project.');
  if (!provenance || provenance.toolJobId !== job.id || String(provenance.projectId || '') !== projectId) fail('source_provenance_invalid', 'Revision execution provenance is not bound to its Job and project.');
  if (provenance.script?.sha256 !== sourceRef.sha256) fail('source_provenance_script_mismatch', 'Job provenance does not match the Revision source hash.');
  if (result.artifactTruth?.status !== 'valid' || result.artifactTruth.blocking === true) fail('source_artifact_truth_invalid', 'Revision Job has invalid Artifact Truth.');
  const artifact = exactArtifact(result, revision.artifactId);
  const provenanceArtifact = (Array.isArray(provenance.artifacts) ? provenance.artifacts : []).filter((item) => item?.id === revision.artifactId);
  if (!artifact || provenanceArtifact.length !== 1 || (revision.outputHash && provenanceArtifact[0].sha256 !== revision.outputHash)) fail('source_artifact_provenance_invalid', 'Revision Artifact is not uniquely bound by Job provenance.');

  const inputs = inputStatus({
    workspaceRoot: dependencies.workspaceRoot,
    inputs: provenance.inputs,
    params: job.params,
    provenance,
  });
  const inputDrift = inputs.filter((item) => item.status !== 'intact');
  let openableRelativePath = null;
  if (sourceRef.origin === 'project_materialized' && dependencies.workspaceRoot) {
    try {
      const root = fs.realpathSync(dependencies.workspaceRoot);
      const target = fs.realpathSync(path.join(root, sourceRef.relativePath));
      if (isPathContained(root, target) && fs.statSync(target).isFile() && sha256(fs.readFileSync(target)) === sourceRef.sha256) openableRelativePath = sourceRef.relativePath;
    } catch { /* Virtual Git sources normally have no worktree file. */ }
  }
  const runtime = provenance.runtime || {};
  return {
    revisionId: revision.revisionId,
    artifactId: revision.artifactId,
    revisionOrdinal: revision.revisionOrdinal,
    relativePath: sourceRef.relativePath,
    entryPoint: sourceRef.entryPoint || path.posix.basename(sourceRef.relativePath),
    language: sourceRef.language,
    origin: sourceRef.origin || 'unknown_legacy',
    rendererId: sourceRef.rendererId,
    scope: classifyScope(sourceRef),
    content,
    sha256: sourceRef.sha256,
    openableRelativePath,
    parameters: parameters ? {
      relativePath: parameters.relativePath,
      sha256: parameters.sha256,
      values: sanitizeValue(parameters.values),
      // Only trusted in-process execution services may request the exact
      // persisted values. The HTTP source projection never sets this flag, so
      // absolute paths and secret-shaped values remain absent from ordinary
      // Code/Result responses.
      ...(dependencies.allowRawParameters === true ? { rawValues: parameters.values } : {}),
    } : null,
    reproduction: {
      status: inputDrift.length === 0 ? revision.reproducibilityStatus : 'unavailable',
      requiresConfirmation: true,
      inputDrift,
      inputs,
      runtime: { name: runtime.name || null, version: runtime.version || null, readiness: runtime.readiness ?? null },
      plugin: { id: provenance.plugin?.id || job.tool_id || null, version: provenance.plugin?.version || null, language: provenance.plugin?.language || sourceRef.language, packageConstraints: sanitizeValue(provenance.plugin?.packageConstraints || {}) },
      replayable: inputDrift.length === 0 && Boolean(parameters),
    },
  };
}

function verifyRevisionSourceMaterial(input, dependencies) {
  const projection = projectRevisionSource(input, dependencies);
  if (projection.reproduction.inputDrift.length > 0) fail('source_input_drift', 'One or more reproducibility inputs changed or are unavailable.');
  return projection;
}

module.exports = { MAX_SOURCE_BYTES, ResultRevisionSourceError, projectRevisionSource, verifyRevisionSourceMaterial, sha256 };
