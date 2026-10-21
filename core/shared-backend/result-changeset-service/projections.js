'use strict';

const fs = require('fs');
const { stableStringify } = require('../canonical-json');
const { verifyRevisionSourceMaterial } = require('../result-revision-source');
const { validateResultStudioCandidate } = require('../result-plugin-validator');
const { loadRerunProfile } = require('../result-scientific-rerun');
const { resolveExecutionInputPath, verifyExecutionProvenance } = require('../execution-provenance');
const {
  ResultChangeSetError,
  cloneJsonObject,
  exactArtifact,
  hashFile,
  resolveExistingProjectFile,
  resultOf,
  safeSegment,
} = require('./internal');

function resolveCandidateDescriptor({ dependencies, toolId }) {
  if (typeof dependencies.getResultStudioDescriptor === 'function') {
    const descriptor = dependencies.getResultStudioDescriptor(toolId);
    if (descriptor) return descriptor.resultStudio || descriptor;
  }
  return null;
}

function validateCandidateJob({ dependencies, toolId, job, workspaceRoot, expectedScriptSha256, rawParams }) {
  const validation = validateResultStudioCandidate({
    descriptor: resolveCandidateDescriptor({ dependencies, toolId }),
    job,
    workspaceRoot,
    expectedScriptSha256,
    rawParams,
  });
  if (!validation.ok) {
    throw new ResultChangeSetError(
      'candidate_plugin_validation_failed',
      `Candidate Job failed the admitted ${toolId} Result Studio validator.`,
      { toolId, validatorId: validation.validatorId, diagnostics: validation.diagnostics }
    );
  }
  return validation;
}

function sourceJobParameters(sourceJob) {
  if (sourceJob?.params && typeof sourceJob.params === 'object' && !Array.isArray(sourceJob.params)) {
    return cloneJsonObject(sourceJob.params, 'source_parameters_unavailable');
  }
  try {
    return cloneJsonObject(JSON.parse(sourceJob?.params_json || '{}'), 'source_parameters_unavailable');
  } catch (error) {
    if (error instanceof ResultChangeSetError) throw error;
    throw new ResultChangeSetError('source_parameters_unavailable', 'Source Job parameters are unavailable.');
  }
}

/**
 * Rebuild executable parameters from the immutable normalized parameters in
 * the Revision commit. The mutable Job row contributes only verified physical
 * file locations; every scientific/display scalar comes from Git.
 */
function buildTrustedExecutionParams({ sourceJob, sourceProjection, workspaceRoot, parameterPatch = {} }) {
  const normalized = cloneJsonObject(
    sourceProjection?.parameters?.rawValues || sourceProjection?.parameters?.values,
    'source_parameters_unavailable'
  );
  const raw = sourceJobParameters(sourceJob);
  const runtime = cloneJsonObject(normalized, 'source_parameters_unavailable');
  const sourceResult = resultOf(sourceJob);
  const sourceProvenance = sourceResult.executionProvenance || null;
  const provenanceInputs = Array.isArray(sourceProvenance?.inputs)
    ? sourceProvenance.inputs
    : [];
  const seen = new Set();
  let realWorkspace;
  try { realWorkspace = fs.realpathSync(workspaceRoot); } catch {
    throw new ResultChangeSetError('source_workspace_unavailable', 'Project workspace is unavailable.');
  }
  for (const input of provenanceInputs) {
    const inputId = safeSegment(input?.id, 'source_input_id');
    if (seen.has(inputId)) {
      throw new ResultChangeSetError('source_input_identity_ambiguous', 'Source input identity is duplicated.');
    }
    seen.add(inputId);
    const committed = normalized[inputId];
    if (!committed || typeof committed !== 'object' || Array.isArray(committed)
        || committed.inputRef !== input.relativePath || committed.sha256 !== input.sha256) {
      throw new ResultChangeSetError('source_input_binding_mismatch', 'Source input no longer matches the immutable Revision parameters.');
    }
    const resolved = resolveExecutionInputPath({
      workspaceRoot: realWorkspace,
      input,
      sourceParams: raw,
      provenance: sourceProvenance,
    });
    const physical = resolved.path;
    if (!physical) {
      throw new ResultChangeSetError('source_input_drift', 'A source input is missing.');
    }
    if (hashFile(physical) !== input.sha256) {
      throw new ResultChangeSetError('source_input_drift', 'A source input changed or escaped the project.');
    }
    runtime[inputId] = physical;
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.inputRef && !seen.has(key)) {
      throw new ResultChangeSetError('source_input_provenance_missing', 'An immutable file input lacks execution provenance.');
    }
  }
  return { normalized, runtime: { ...runtime, ...parameterPatch } };
}

function exactProvenanceArtifact(result, artifactId) {
  const matches = (Array.isArray(result?.executionProvenance?.artifacts) ? result.executionProvenance.artifacts : [])
    .filter((artifact) => artifact && artifact.id === artifactId);
  return matches.length === 1 ? matches[0] : null;
}

function inheritServerIssuedInputLineage(sourceResult) {
  const provenance = sourceResult?.executionProvenance || null;
  const inputs = Array.isArray(provenance?.inputs) ? provenance.inputs : [];
  const lineageInputs = inputs.filter((input) => input?.lineage != null);
  if (lineageInputs.length === 0) {
    return { inputLineage: null, expectations: [] };
  }
  if (!verifyExecutionProvenance(provenance).ok) {
    throw new ResultChangeSetError(
      'source_input_lineage_untrusted',
      'Source input lineage is not backed by intact server-issued execution provenance.'
    );
  }
  const inputLineage = {};
  const expectations = [];
  for (const input of lineageInputs) {
    const inputId = safeSegment(input?.id, 'source_input_id');
    if (Object.prototype.hasOwnProperty.call(inputLineage, inputId)) {
      throw new ResultChangeSetError('source_input_identity_ambiguous', 'Source input identity is duplicated.');
    }
    const lineage = cloneJsonObject(input.lineage, 'source_input_lineage_invalid');
    inputLineage[inputId] = cloneJsonObject(lineage, 'source_input_lineage_invalid');
    expectations.push({ inputId, sha256: input.sha256 || null, lineage });
  }
  return { inputLineage, expectations };
}

function assertInheritedCandidateInputLineage(candidateResult, inherited) {
  const inputs = Array.isArray(candidateResult?.executionProvenance?.inputs)
    ? candidateResult.executionProvenance.inputs
    : [];
  const expectations = inherited?.expectations || [];
  const expectedIds = new Set(expectations.map((entry) => entry.inputId));
  const lineageInputs = inputs.filter((input) => input?.lineage != null);
  if (lineageInputs.length !== expectations.length
      || lineageInputs.some((input) => !expectedIds.has(String(input?.id || '')))) {
    throw new ResultChangeSetError(
      'candidate_input_lineage_drift',
      'Candidate Job input lineage differs from the server-issued source lineage.'
    );
  }
  for (const expected of expectations) {
    const matches = inputs.filter((input) => input && input.id === expected.inputId);
    if (matches.length !== 1 || matches[0].sha256 !== expected.sha256
        || stableStringify(matches[0].lineage) !== stableStringify(expected.lineage)) {
      throw new ResultChangeSetError(
        'candidate_input_lineage_drift',
        'Candidate Job input hash or lineage differs from the server-issued source lineage.',
        { inputId: expected.inputId }
      );
    }
  }
}

function resolveLineageAncestorJobs({ inherited, getToolJob }) {
  if (typeof getToolJob !== 'function') return [];
  const queue = (inherited?.expectations || [])
    .map((entry) => String(entry.lineage?.sourceToolJobId || '').trim())
    .filter(Boolean);
  const visited = new Set();
  const jobs = [];
  while (queue.length > 0) {
    const toolJobId = queue.shift();
    if (visited.has(toolJobId)) continue;
    visited.add(toolJobId);
    let job = null;
    try { job = getToolJob(toolJobId); } catch { job = null; }
    if (!job || String(job.id || '').trim() !== toolJobId) continue;
    jobs.push(job);
    const inputs = resultOf(job).executionProvenance?.inputs;
    for (const input of Array.isArray(inputs) ? inputs : []) {
      const parentJobId = String(input?.lineage?.sourceToolJobId || '').trim();
      if (parentJobId && !visited.has(parentJobId)) queue.push(parentJobId);
    }
  }
  return jobs;
}

/**
 * Normalize the bounded affected subgraph P6 can replay today.  The caller
 * cannot submit a plan: the context-bound agent tool rebuilds it from the
 * durable graph and passes this server-private projection.  This service
 * nevertheless rechecks every revision/job/hash before executing it.
 *
 * The deliberately narrow contract is one current DEG table feeding at most
 * one direct current Job for each admitted child tool via exact artifact
 * edges. Selection/transformed bytes, duplicate tools, multi-parent branches
 * and arbitrary descendants stay unavailable rather than receiving a guessed
 * rerun.
 */
function resolveAuthoritativeDownstreamPlan({ input, dependencies, projectId, workspaceRoot, sourceRevision, sourceOutputHash }) {
  const subgraph = input.authoritativeSubgraph;
  if (!subgraph) return [];
  if (dependencies.authoritativeSubgraphTrusted !== true) {
    throw new ResultChangeSetError('authoritative_subgraph_untrusted', 'Affected-subgraph execution requires a context-bound server projection.');
  }
  if (!subgraph || subgraph.authority !== 'sqlite_job_artifact_truth'
      || subgraph.graphId !== input.intent?.workflowGraph?.graphId
      || subgraph.sourceDigest !== input.intent?.workflowGraph?.sourceDigest
      || subgraph.rootNodeId !== `job:${sourceRevision.toolJobId}`
      || subgraph.rootToolJobId !== sourceRevision.toolJobId
      || subgraph.rootRevisionId !== sourceRevision.revisionId
      || !Array.isArray(subgraph.children)) {
    throw new ResultChangeSetError('authoritative_subgraph_invalid', 'Affected-subgraph projection no longer matches the trusted intent.');
  }
  if (subgraph.children.length === 0) return [];
  const { rootArtifactId, directChildPrimaryArtifacts } = dependencies.rerunProfile || loadRerunProfile();
  if (!rootArtifactId || Object.keys(directChildPrimaryArtifacts).length === 0) {
    throw new ResultChangeSetError('downstream_profile_missing', 'No installed pack declares an admitted direct-child rerun profile.');
  }
  if (sourceRevision.artifactId !== rootArtifactId) {
    throw new ResultChangeSetError('downstream_root_unsupported', 'Only the declared root Artifact can currently drive an affected direct-child rerun.');
  }
  const maximumChildren = Object.keys(directChildPrimaryArtifacts).length;
  if (subgraph.children.length > maximumChildren) {
    throw new ResultChangeSetError('downstream_subgraph_unsupported', 'The affected subgraph exceeds the admitted direct DEG child set.');
  }
  const repository = dependencies.repository;
  const getToolJob = dependencies.getToolJob;
  if (!repository || typeof repository.getRevision !== 'function'
      || typeof repository.getCurrentRevision !== 'function' || typeof getToolJob !== 'function') {
    throw new ResultChangeSetError('downstream_dependencies_missing', 'Downstream replay cannot resolve durable Job and Revision truth.');
  }
  const seenNodeIds = new Set();
  const seenToolIds = new Set();
  const seenToolJobIds = new Set();
  const seenRevisionIds = new Set();
  const children = [...subgraph.children].sort((left, right) => (
    String(left?.nodeId || '').localeCompare(String(right?.nodeId || ''))
  ));
  return children.map((childRef) => {
    const expectedArtifactId = directChildPrimaryArtifacts[childRef?.toolId];
    if (!childRef || !expectedArtifactId || childRef.inputId !== rootArtifactId
        || childRef.edgeKind !== 'artifact' || childRef.sourceToolJobId !== sourceRevision.toolJobId
        || childRef.sourceRevisionId !== sourceRevision.revisionId
        || childRef.sourceArtifactId !== sourceRevision.artifactId
        || childRef.sourceOutputHash !== sourceOutputHash
        || typeof childRef.nodeId !== 'string' || typeof childRef.childToolJobId !== 'string'
        || childRef.nodeId !== `job:${childRef.childToolJobId}`
        || typeof childRef.childRevisionId !== 'string') {
      throw new ResultChangeSetError('downstream_lineage_unsupported', 'Downstream lineage is not an admitted exact direct DEG artifact hand-off.');
    }
    if (seenNodeIds.has(childRef.nodeId) || seenToolIds.has(childRef.toolId)
        || seenToolJobIds.has(childRef.childToolJobId) || seenRevisionIds.has(childRef.childRevisionId)) {
      throw new ResultChangeSetError('downstream_subgraph_unsupported', 'The affected subgraph contains a duplicate direct child identity.');
    }
    seenNodeIds.add(childRef.nodeId);
    seenToolIds.add(childRef.toolId);
    seenToolJobIds.add(childRef.childToolJobId);
    seenRevisionIds.add(childRef.childRevisionId);

    const sourceRevisionForChild = repository.getRevision(childRef.childRevisionId);
    const sourceJob = getToolJob(childRef.childToolJobId);
    const currentRevision = sourceRevisionForChild
      ? repository.getCurrentRevision(sourceRevisionForChild.artifactFamilyId, projectId)
      : null;
    if (!sourceRevisionForChild || sourceRevisionForChild.projectId !== projectId
        || sourceRevisionForChild.toolJobId !== childRef.childToolJobId
        || sourceRevisionForChild.artifactId !== expectedArtifactId
        || !currentRevision || currentRevision.revisionId !== sourceRevisionForChild.revisionId
        || !sourceJob || sourceJob.status !== 'completed'
        || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
        || (sourceJob.tool_id || sourceJob.toolId) !== childRef.toolId) {
      throw new ResultChangeSetError('downstream_revision_missing', 'A direct descendant lacks its exact current durable source Revision.');
    }
    const sourceResult = resultOf(sourceJob);
    const sourceArtifact = exactArtifact(sourceResult, sourceRevisionForChild.artifactId);
    const sourceProvenanceArtifact = exactProvenanceArtifact(sourceResult, sourceRevisionForChild.artifactId);
    if (sourceResult.artifactTruth?.status !== 'valid' || sourceResult.artifactTruth?.blocking === true
        || !sourceArtifact || !sourceProvenanceArtifact) {
      throw new ResultChangeSetError('downstream_artifact_truth_invalid', 'A direct descendant no longer has valid Artifact Truth.');
    }
    const sourceOutputPath = resolveExistingProjectFile(workspaceRoot, sourceRevisionForChild.outputPath, 'downstream_artifact_hash_mismatch');
    if (!sourceRevisionForChild.outputHash || hashFile(sourceOutputPath) !== sourceRevisionForChild.outputHash
        || sourceProvenanceArtifact.sha256 !== sourceRevisionForChild.outputHash) {
      throw new ResultChangeSetError('downstream_artifact_hash_mismatch', 'A direct descendant source Artifact changed before rerun.');
    }
    let sourceProjection;
    try {
      sourceProjection = verifyRevisionSourceMaterial({ projectId, revision: sourceRevisionForChild }, {
        repository,
        adapter: dependencies.adapter,
        gitPathPrefix: dependencies.gitPathPrefix,
        workspaceRoot,
        getToolJob,
      });
    } catch (error) {
      if (error && error.code) throw new ResultChangeSetError(error.code, error.message, error.detail);
      throw error;
    }
    const normalizedParams = cloneJsonObject(sourceProjection.parameters?.values, 'downstream_parameters_unavailable');
    const rawParams = cloneJsonObject(normalizedParams, 'downstream_parameters_unavailable');
    const originalInput = normalizedParams.deg_table;
    if (!originalInput || typeof originalInput !== 'object' || Array.isArray(originalInput)
        || typeof originalInput.inputRef !== 'string'
        || originalInput.sha256 !== sourceOutputHash) {
      throw new ResultChangeSetError('downstream_parameters_unavailable', 'A direct descendant source does not preserve the exact DEG input binding.');
    }
    return {
      ...childRef,
      sourceRevision: sourceRevisionForChild,
      sourceJob,
      sourceOutputPath,
      sourceOutputHash: sourceRevisionForChild.outputHash,
      sourceScriptContent: sourceProjection.content,
      sourceScriptSha256: sourceProjection.sha256,
      normalizedSourceParams: normalizedParams,
      rawSourceParams: rawParams,
      language: sourceRevisionForChild.sourceScriptRef.language,
    };
  });
}

module.exports = {
  resolveCandidateDescriptor,
  validateCandidateJob,
  sourceJobParameters,
  buildTrustedExecutionParams,
  exactProvenanceArtifact,
  inheritServerIssuedInputLineage,
  assertInheritedCandidateInputLineage,
  resolveLineageAncestorJobs,
  resolveAuthoritativeDownstreamPlan,
};
