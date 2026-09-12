'use strict';

/**
 * Controlled ArtifactRevision replay.
 *
 * Replay is intentionally a two-step, server-issued confirmation flow. The
 * caller may select a persisted Revision and present expectation hashes, but
 * may not supply a tool id, params, script patch, command, shell request or
 * workflow plan. Source, normalized parameters and input identities are read
 * again from Git / SQLite / Job provenance immediately before execution.
 *
 * The actual computation is delegated to createResultChangeSet(), which uses
 * the existing registered-tool -> tool_job -> Artifact Truth path and leaves a
 * non-current candidate Revision for review. This module never adopts it.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stableStringify } = require('./canonical-json');
const { isPathContained } = require('./project-run-layout');
const {
  resolveExecutionInputPath,
  verifyExecutionProvenance,
} = require('./execution-provenance');
const {
  verifyWorkflowGraphIntegrity,
  workflowGraphDigest,
} = require('./result-workflow-graph');
const { createResultChangeSet, sha256 } = require('./result-changeset-service');
const {
  ResultRevisionSourceError,
  verifyRevisionSourceMaterial,
} = require('./result-revision-source');
const {
  buildResultRevisionReplayPackage,
  relativeInside,
  validateScientificReplayPackage,
} = require('./scientific-replay-package');

const CONTROLLED_REPLAY_VERSION = 1;
const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESULT_CHANGESET_REPLAY_PACKAGE_VERSION = 1;
const REPLAY_PACKAGE_STATUSES = new Set(['complete', 'partial_history']);
const COHORT_MANIFEST_FIELDS = Object.freeze([
  'resultChangeSetReplayPackageVersion',
  'sourceChangeSetId',
  'sourceCandidateCommit',
  'selectedSourceRevisionId',
  'executionRootRevisionId',
  'workflowGraph',
  'revisions',
  'jobs',
  'packageDigest',
]);
const COHORT_WORKFLOW_FIELDS = Object.freeze([
  'contractVersion',
  'projectId',
  'validationStatus',
  'graphId',
  'sourceDigest',
  'rootToolJobId',
  'nodes',
  'edges',
]);
const COHORT_WORKFLOW_NODE_FIELDS = Object.freeze([
  'id',
  'toolJobId',
  'toolId',
  'artifactIds',
  'provenanceHash',
  'dependsOn',
]);
const COHORT_WORKFLOW_EDGE_FIELDS = Object.freeze([
  'kind',
  'fromNodeId',
  'toNodeId',
  'sourceToolJobId',
  'sourceRevisionId',
  'sourceArtifactId',
  'sourceOutputHash',
  'selectionId',
  'selectionHash',
  'inputId',
]);
const COHORT_REVISION_FIELDS = Object.freeze([
  'revisionId',
  'toolJobId',
  'artifactFamilyId',
  'artifactId',
  'outputHash',
]);
const COHORT_JOB_FIELDS = Object.freeze([
  'sourceToolJobId',
  'toolId',
  'formalArtifactIds',
  'relativePath',
  'packageDigest',
  'status',
]);
const REQUEST_FIELDS = new Set([
  'phase',
  'projectId',
  'revisionId',
  'conversationId',
  'contextToken',
  'confirmationToken',
  'expectedSourceSha256',
  'expectedParametersHash',
  'expectedInputHashes',
]);

class ResultReplayError extends Error {
  constructor(code, message, status = 409, detail = null) {
    super(message);
    this.name = 'ResultReplayError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function fail(code, message, status = 409, detail = null) {
  throw new ResultReplayError(code, message, status, detail);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableHash(value) {
  return sha256(stableStringify(value));
}

function assertAllowedReplayRequest(body) {
  if (!object(body)) fail('replay_request_invalid', 'Replay request must be an object.', 400);
  const rejected = Object.keys(body).filter((field) => !REQUEST_FIELDS.has(field)).sort();
  if (rejected.length > 0) {
    fail(
      'replay_request_field_not_allowed',
      'Replay execution does not accept caller-supplied plans, parameters, scripts or commands.',
      400,
      { rejectedFields: rejected }
    );
  }
  return body;
}

function safeIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!SAFE_ID.test(normalized)) fail(`${field}_invalid`, `${field} is invalid.`, 400);
  return normalized;
}

function expectedInputMap(value) {
  if (value == null) return null;
  if (!object(value)) fail('expected_input_hashes_invalid', 'expectedInputHashes must be an object.', 400);
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.some(([id, digest]) => !SAFE_ID.test(id) || !SHA256.test(String(digest || '')))) {
    fail('expected_input_hashes_invalid', 'expectedInputHashes must map safe input ids to sha256 digests.', 400);
  }
  return Object.fromEntries(entries);
}

function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function resolveIntactInput(workspaceRoot, input, sourceParams = {}, provenance = null) {
  const relativePath = String(input && input.relativePath || '').trim();
  const expectedHash = String(input && input.sha256 || '').trim();
  if (!relativePath || path.isAbsolute(relativePath) || !SHA256.test(expectedHash)) {
    fail('replay_input_ref_invalid', 'Replay input reference is incomplete.');
  }
  const resolved = resolveExecutionInputPath({
    workspaceRoot,
    input,
    sourceParams,
    provenance,
  });
  const target = resolved.path;
  if (!target) {
    fail('source_input_drift', 'A replay input is missing.', 409, { inputId: input.id || null });
  }
  if (hashFile(target) !== expectedHash) {
    fail('source_input_drift', 'A replay input hash changed.', 409, { inputId: input.id || null });
  }
  return target;
}

function projectSourceJobParams(sourceJob) {
  const params = object(sourceJob && sourceJob.params);
  if (params) return cloneJson(params);
  const raw = sourceJob && sourceJob.params_json;
  if (typeof raw !== 'string') fail('replay_source_params_missing', 'Source Job parameters are unavailable.');
  try {
    const parsed = JSON.parse(raw);
    if (!object(parsed)) throw new Error('not_object');
    return parsed;
  } catch {
    fail('replay_source_params_invalid', 'Source Job parameters are invalid.');
  }
}

/**
 * Rehydrate executable params without trusting an old absolute path.
 *
 * Provenance normalized every file input into {inputRef, sha256}. We derive a
 * fresh contained absolute path for execution, then normalize it back and
 * require byte-for-byte semantic equality with the parameters committed for
 * the selected Revision. This proves that no input or non-file parameter was
 * silently rebound.
 */
function buildReplayExecutionParams({ sourceJob, sourceProjection, workspaceRoot } = {}) {
  const rawValues = sourceProjection?.parameters?.rawValues;
  if (!object(rawValues)) fail('replay_parameters_missing', 'Exact persisted Revision parameters are required.');
  const runtimeParams = projectSourceJobParams(sourceJob);
  const normalized = cloneJson(runtimeParams);
  const sourceProvenance = parseJobResult(sourceJob).executionProvenance || null;
  const provenanceInputs = Array.isArray(sourceProvenance?.inputs)
    ? sourceProvenance.inputs
    : [];
  const seenIds = new Set();
  for (const input of provenanceInputs) {
    const inputId = safeIdentifier(input && input.id, 'replay_input_id');
    if (seenIds.has(inputId)) fail('replay_input_identity_ambiguous', 'Replay input identity is duplicated.');
    seenIds.add(inputId);
    const target = resolveIntactInput(workspaceRoot, input, runtimeParams, sourceProvenance);
    runtimeParams[inputId] = target;
    normalized[inputId] = { inputRef: input.relativePath, sha256: input.sha256 };
  }
  if (stableStringify(normalized) !== stableStringify(rawValues)) {
    fail('replay_parameters_drift', 'Source Job parameters no longer match the selected Revision.');
  }
  return runtimeParams;
}

function assertExpectedHashes({ sourceProjection, sourceJob, expectedSourceSha256, expectedParametersHash, expectedInputHashes }) {
  if (expectedSourceSha256 != null) {
    if (!SHA256.test(String(expectedSourceSha256)) || expectedSourceSha256 !== sourceProjection.sha256) {
      fail('replay_source_expectation_stale', 'Expected source hash does not match the selected Revision.');
    }
  }
  const actualParametersHash = sourceProjection.parameters?.sha256 || null;
  if (expectedParametersHash != null) {
    if (!SHA256.test(String(expectedParametersHash)) || expectedParametersHash !== actualParametersHash) {
      fail('replay_parameters_expectation_stale', 'Expected parameters hash does not match the selected Revision.');
    }
  }
  const expected = expectedInputMap(expectedInputHashes);
  if (expected) {
    const sourceResult = parseJobResult(sourceJob);
    const actual = Object.fromEntries(
      (sourceResult.executionProvenance?.inputs || [])
        .filter((input) => input?.id)
        .map((input) => [input.id, input.sha256])
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
    );
    if (stableStringify(expected) !== stableStringify(actual)) {
      fail('replay_inputs_expectation_stale', 'Expected input hashes do not match the selected Revision.');
    }
  }
}

function assertRevisionOutput({ revision, workspaceRoot }) {
  if (!revision?.outputPath || !SHA256.test(String(revision.outputHash || ''))) {
    fail('replay_artifact_ref_invalid', 'Revision Artifact reference is incomplete.');
  }
  let root;
  let target;
  try {
    root = fs.realpathSync(workspaceRoot);
    target = fs.realpathSync(path.join(root, revision.outputPath));
  } catch {
    fail('replay_artifact_missing', 'Revision Artifact is missing.');
  }
  if (!isPathContained(root, target) || !fs.statSync(target).isFile()) {
    fail('replay_artifact_outside_project', 'Revision Artifact escaped the project.');
  }
  if (hashFile(target) !== revision.outputHash) {
    fail('replay_artifact_hash_drift', 'Revision Artifact hash changed.');
  }
}

function parseJobResult(job) {
  if (job?.result && typeof job.result === 'object') return job.result;
  try { return JSON.parse(job?.result_json || '{}'); } catch { return {}; }
}

/**
 * Exact replay means the complete formal output cohort is byte-identical, not
 * merely that the selected preview Artifact exists. The package is the source
 * expectation and the replay Job's Artifact Truth plus physical hashes are the
 * independent observation.
 */
function verifyReplayOutputCohort({ replay, job, workspaceRoot } = {}) {
  const result = parseJobResult(job);
  const provenance = result.executionProvenance;
  if (!job || job.status !== 'completed' || result.artifactTruth?.status !== 'valid'
      || result.artifactTruth?.blocking === true || !provenance) {
    fail('replay_output_truth_invalid', 'Replay Job did not produce valid Artifact Truth.');
  }
  if (replay?.script?.sha256 !== provenance.script?.sha256) {
    fail('replay_output_script_drift', 'Replay Job did not execute the packaged script hash.');
  }
  if (replay?.plugin?.id !== provenance.plugin?.id
      || String(replay?.plugin?.version || '') !== String(provenance.plugin?.version || '')) {
    fail('replay_output_plugin_drift', 'Replay Job plugin identity differs from the ReplayPackage.');
  }
  const expected = (Array.isArray(replay?.artifacts) ? replay.artifacts : []).map((artifact) => ({
    artifactId: String(artifact?.sourceArtifactId || artifact?.artifactId || '').trim(),
    sha256: String(artifact?.expected?.sha256 || '').trim(),
  }));
  if (expected.length === 0 || expected.some((artifact) => !artifact.artifactId || !SHA256.test(artifact.sha256))) {
    fail('replay_output_expectation_invalid', 'ReplayPackage output expectations are incomplete.');
  }
  const expectedIds = new Set(expected.map((artifact) => artifact.artifactId));
  if (expectedIds.size !== expected.length) {
    fail('replay_output_expectation_ambiguous', 'ReplayPackage output identities are duplicated.');
  }
  const producedArtifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const formalArtifacts = producedArtifacts.filter((artifact) => expectedIds.has(String(artifact?.id || '').trim()));
  const formalIds = formalArtifacts.map((artifact) => String(artifact?.id || '').trim()).filter(Boolean);
  if (formalIds.length !== expected.length || new Set(formalIds).size !== formalIds.length
      || formalIds.some((artifactId) => !expectedIds.has(artifactId))) {
    fail('replay_output_cohort_mismatch', 'Replay Job formal output cohort differs from the ReplayPackage.', 409, {
      expectedArtifactIds: [...expectedIds].sort(),
      actualArtifactIds: formalIds.sort(),
    });
  }
  let realWorkspace;
  try { realWorkspace = fs.realpathSync(workspaceRoot); } catch {
    fail('replay_workspace_missing', 'Replay workspace is unavailable.');
  }
  const verified = expected.map((expectation) => {
    const artifacts = formalArtifacts.filter((artifact) => artifact?.id === expectation.artifactId);
    const provenanceArtifacts = (Array.isArray(provenance.artifacts) ? provenance.artifacts : [])
      .filter((artifact) => artifact?.id === expectation.artifactId);
    if (artifacts.length !== 1 || provenanceArtifacts.length !== 1) {
      fail('replay_output_identity_ambiguous', 'Replay output is not uniquely represented in Artifact and provenance truth.', 409, {
        artifactId: expectation.artifactId,
      });
    }
    let outputPath;
    try { outputPath = fs.realpathSync(artifacts[0].path); } catch {
      fail('replay_output_missing', 'Replay output file is unavailable.', 409, { artifactId: expectation.artifactId });
    }
    if (!isPathContained(realWorkspace, outputPath) || !fs.statSync(outputPath).isFile()) {
      fail('replay_output_outside_project', 'Replay output escaped the project.', 409, { artifactId: expectation.artifactId });
    }
    const actualHash = hashFile(outputPath);
    if (actualHash !== expectation.sha256 || provenanceArtifacts[0].sha256 !== expectation.sha256) {
      fail('replay_output_hash_mismatch', 'Replay output is not byte-identical to the packaged adopted output.', 409, {
        artifactId: expectation.artifactId,
        expectedHash: expectation.sha256,
        actualHash,
      });
    }
    return { artifactId: expectation.artifactId, sha256: actualHash, exactMatch: true };
  }).sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return {
    exactMatch: true,
    artifactCount: verified.length,
    outputCohortHash: stableHash(verified),
    outputs: verified,
  };
}

function buildRevisionReplayProofs({ sourceRevisions, replayRevisions } = {}) {
  if (!Array.isArray(sourceRevisions) || sourceRevisions.length === 0 || !Array.isArray(replayRevisions)) {
    fail('replay_revision_cohort_missing', 'Replay Revision cohorts are unavailable.');
  }
  return sourceRevisions.map((source) => {
    const matches = replayRevisions.filter((replay) => replay.artifactFamilyId === source.artifactFamilyId
      && replay.artifactId === source.artifactId
      && replay.parentRevisionIds.includes(source.revisionId));
    if (matches.length !== 1) {
      fail('replay_revision_cohort_mismatch', 'Replay Revision cohort does not map one-to-one to the adopted source cohort.', 409, {
        sourceRevisionId: source.revisionId,
        replayRevisionIds: matches.map((revision) => revision.revisionId),
      });
    }
    const replay = matches[0];
    return {
      sourceRevisionId: source.revisionId,
      replayRevisionId: replay.revisionId,
      replayToolJobId: replay.toolJobId,
      sourceOutputHash: source.outputHash,
      replayOutputHash: replay.outputHash,
    };
  });
}

function projectReplayExecutionCohort({ sourceRevisions, selectedRevision, workflowGraph, getToolJob } = {}) {
  if (!Array.isArray(sourceRevisions) || sourceRevisions.length === 0 || !selectedRevision
      || typeof getToolJob !== 'function') {
    fail('replay_source_cohort_missing', 'Replay source cohort is unavailable.');
  }
  const byJob = new Map();
  for (const revision of sourceRevisions) {
    if (!revision?.toolJobId || revision.projectId !== selectedRevision.projectId) {
      fail('replay_source_cohort_invalid', 'Replay source cohort contains an invalid Revision.');
    }
    if (!byJob.has(revision.toolJobId)) byJob.set(revision.toolJobId, []);
    byJob.get(revision.toolJobId).push(revision);
  }
  if (!sourceRevisions.some((revision) => revision.revisionId === selectedRevision.revisionId)) {
    fail('replay_source_cohort_invalid', 'Selected Revision is absent from its adopted replay cohort.');
  }
  const groupFor = (toolJobId) => {
    const revisions = (byJob.get(toolJobId) || [])
      .slice()
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
    const job = getToolJob(toolJobId);
    if (revisions.length === 0 || !job || job.status !== 'completed'
        || String(job.project_id || job.projectId || '') !== selectedRevision.projectId) {
      fail('replay_source_job_cohort_invalid', 'A ReplayPackage source Job is missing or invalid.', 409, { toolJobId });
    }
    return {
      sourceToolJobId: toolJobId,
      toolId: String(job.tool_id || job.toolId || '').trim(),
      job,
      revisions,
      formalArtifactIds: revisions.map((revision) => revision.artifactId),
    };
  };
  if (!workflowGraph || workflowGraph.validationStatus !== 'valid'
      || workflowGraph.projectId !== selectedRevision.projectId
      || !Array.isArray(workflowGraph.nodes) || !Array.isArray(workflowGraph.edges)) {
    fail('replay_workflow_graph_missing', 'Scientific replay requires its persisted authoritative workflow graph.');
  }
  const integrity = verifyWorkflowGraphIntegrity(workflowGraph);
  if (!integrity.ok) {
    fail('replay_workflow_graph_stale', 'Persisted authoritative workflow graph failed integrity validation.', 409, {
      diagnostics: integrity.diagnostics,
    });
  }
  if (workflowGraph.nodes.length !== byJob.size
      || workflowGraph.nodes.some((node) => !byJob.has(node.toolJobId))) {
    fail('replay_workflow_graph_stale', 'Persisted workflow graph no longer matches the adopted Job cohort.');
  }
  const groups = workflowGraph.nodes.map((node) => {
    const group = groupFor(node.toolJobId);
    const provenance = parseJobResult(group.job).executionProvenance || null;
    const provenanceIntegrity = verifyExecutionProvenance(provenance);
    const artifactIds = [...new Set((Array.isArray(provenance?.artifacts) ? provenance.artifacts : [])
      .map((artifact) => String(artifact?.id || '').trim())
      .filter(Boolean))].sort();
    if (!provenanceIntegrity.ok
        || provenance.provenanceHash !== node.provenanceHash
        || group.toolId !== node.toolId
        || stableStringify(artifactIds) !== stableStringify(node.artifactIds)
        || group.formalArtifactIds.some((artifactId) => !artifactIds.includes(artifactId))) {
      fail('replay_workflow_graph_stale', 'Persisted workflow graph no longer matches current Job and Artifact provenance.', 409, {
        toolJobId: node.toolJobId,
      });
    }
    return group;
  });
  const rootToolJobId = String(workflowGraph.rootToolJobId || '').trim();
  const rootNodeId = `job:${rootToolJobId}`;
  if (!byJob.has(rootToolJobId)) {
    fail('replay_workflow_graph_stale', 'Persisted workflow root is absent from the adopted Job cohort.');
  }
  if (byJob.size === 1) {
    if (workflowGraph.nodes.length !== 1 || workflowGraph.edges.length !== 0
        || selectedRevision.toolJobId !== rootToolJobId) {
      fail('replay_workflow_graph_stale', 'Single-Job replay graph no longer identifies the selected source Job.');
    }
    return {
      rootRevision: selectedRevision,
      groups,
      authoritativeSubgraph: null,
      affectedNodeIds: [rootNodeId],
    };
  }
  if (workflowGraph.nodes.length !== 2 || workflowGraph.edges.length !== 1 || byJob.size !== 2) {
    fail('replay_workflow_graph_unsupported', 'Only one verified direct affected-subgraph edge can currently be replayed exactly.');
  }
  const edge = workflowGraph.edges[0];
  const childToolJobId = String(edge?.toNodeId || '').replace(/^job:/, '');
  const childNode = workflowGraph.nodes.find((node) => node.id === edge?.toNodeId);
  const rootRevisionMatches = sourceRevisions.filter((revision) => revision.revisionId === edge?.sourceRevisionId
    && revision.toolJobId === rootToolJobId && revision.artifactId === edge?.sourceArtifactId);
  const childRevisionMatches = sourceRevisions.filter((revision) => revision.toolJobId === childToolJobId
    && revision.artifactId === 'go_bp_results');
  if (edge?.fromNodeId !== rootNodeId || edge.kind !== 'artifact' || edge.inputId !== 'deg_table'
      || edge.sourceToolJobId !== rootToolJobId || !childNode || childNode.toolId !== 'go-kegg'
      || rootRevisionMatches.length !== 1 || childRevisionMatches.length !== 1
      || !byJob.has(rootToolJobId) || !byJob.has(childToolJobId)) {
    fail('replay_workflow_graph_unsupported', 'Persisted workflow graph is not the exact supported DEG to GO/KEGG subgraph.');
  }
  const rootRevision = rootRevisionMatches[0];
  const childRevision = childRevisionMatches[0];
  if (groups[0].sourceToolJobId !== rootToolJobId || groups[1].sourceToolJobId !== childToolJobId) {
    fail('replay_workflow_graph_stale', 'Persisted workflow node order no longer follows the authoritative root.');
  }
  if (!groups[0].toolId || groups[0].toolId !== 'deseq2' || groups[1].toolId !== 'go-kegg') {
    fail('replay_workflow_tool_drift', 'Persisted workflow Jobs no longer match the supported affected subgraph.');
  }
  return {
    rootRevision,
    groups,
    affectedNodeIds: [rootNodeId, edge.toNodeId],
    authoritativeSubgraph: {
      authority: 'sqlite_job_artifact_truth',
      graphId: workflowGraph.graphId,
      sourceDigest: workflowGraph.sourceDigest,
      rootNodeId,
      rootToolJobId,
      rootRevisionId: rootRevision.revisionId,
      children: [{
        nodeId: edge.toNodeId,
        toolId: childNode.toolId,
        inputId: edge.inputId,
        edgeKind: edge.kind,
        sourceToolJobId: rootToolJobId,
        sourceRevisionId: rootRevision.revisionId,
        sourceArtifactId: rootRevision.artifactId,
        sourceOutputHash: rootRevision.outputHash,
        childToolJobId,
        childRevisionId: childRevision.revisionId,
      }],
    },
  };
}

function replayCohortFingerprint({ sourceChangeSet, sourceRevisions, workflowGraph, execution } = {}) {
  return stableHash({
    sourceChangeSetId: sourceChangeSet?.changeSetId || null,
    candidateCommit: sourceChangeSet?.candidateCommit || null,
    revisions: (sourceRevisions || []).map((revision) => ({
      revisionId: revision.revisionId,
      sourceCommit: revision.sourceCommit,
      toolJobId: revision.toolJobId,
      artifactFamilyId: revision.artifactFamilyId,
      artifactId: revision.artifactId,
      outputHash: revision.outputHash,
    })).sort((left, right) => left.revisionId.localeCompare(right.revisionId)),
    workflowGraph: workflowGraph ? {
      graphId: workflowGraph.graphId,
      sourceDigest: workflowGraph.sourceDigest,
      rootToolJobId: workflowGraph.rootToolJobId,
    } : null,
    executionRootRevisionId: execution?.rootRevision?.revisionId || null,
    executionJobIds: (execution?.groups || []).map((group) => group.sourceToolJobId),
  });
}

function hasExactFields(value, fields) {
  if (!object(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function isSafeIdentifier(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function isSafeCohortRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const segments = value.split('/');
  return !segments.some((segment) => !segment || segment === '.' || segment === '..')
    && path.posix.normalize(value) === value;
}

function isStrictlyContainedPath(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isSafeWorkflowNodeId(value) {
  return typeof value === 'string' && value.startsWith('job:') && isSafeIdentifier(value.slice(4));
}

function validUniqueIdentifiers(value, { allowEmpty = false, requireSorted = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return false;
  if (value.some((item) => !isSafeIdentifier(item))) return false;
  if (new Set(value).size !== value.length) return false;
  return !requireSorted || value.every((item, index) => index === 0 || value[index - 1].localeCompare(item) < 0);
}

function readRegularJsonInside(root, relativePath) {
  if (!isSafeCohortRelativePath(relativePath)) return null;
  const target = path.resolve(root, relativePath);
  if (!isStrictlyContainedPath(root, target)) return null;
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const realTarget = fs.realpathSync(target);
    if (!isStrictlyContainedPath(root, realTarget)) return null;
    const parsed = JSON.parse(fs.readFileSync(realTarget, 'utf8'));
    return object(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveCohortChildDirectory(root, relativePath) {
  if (!isSafeCohortRelativePath(relativePath)) return null;
  const target = path.resolve(root, relativePath);
  if (!isStrictlyContainedPath(root, target)) return null;
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
    const realTarget = fs.realpathSync(target);
    return isStrictlyContainedPath(root, realTarget) ? realTarget : null;
  } catch {
    return null;
  }
}

function validateCohortPackageRoot({ root, sourceToolJobIds, diagnostics }) {
  let rootEntries;
  try {
    rootEntries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    diagnostics.push({ code: 'replay_cohort_inventory_unreadable' });
    return;
  }
  const names = new Set(rootEntries.map((entry) => entry.name));
  for (const entry of rootEntries) {
    if (entry.name !== 'cohort-manifest.json' && entry.name !== 'jobs') {
      diagnostics.push({ code: 'replay_cohort_root_entry_unexpected', path: entry.name });
    }
    if (entry.isSymbolicLink()) diagnostics.push({ code: 'replay_cohort_root_symlink', path: entry.name });
  }
  if (!names.has('jobs')) {
    diagnostics.push({ code: 'replay_cohort_jobs_directory_missing' });
    return;
  }
  const jobsDirectory = path.join(root, 'jobs');
  try {
    const stat = fs.lstatSync(jobsDirectory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('jobs_not_directory');
    if (fs.realpathSync(jobsDirectory) !== jobsDirectory) throw new Error('jobs_symlinked_parent');
  } catch {
    diagnostics.push({ code: 'replay_cohort_jobs_directory_invalid' });
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(jobsDirectory, { withFileTypes: true });
  } catch {
    diagnostics.push({ code: 'replay_cohort_jobs_inventory_unreadable' });
    return;
  }
  const expected = new Set(sourceToolJobIds);
  for (const entry of entries) {
    if (!expected.has(entry.name)) {
      diagnostics.push({ code: 'replay_cohort_job_directory_unexpected', sourceToolJobId: entry.name });
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      diagnostics.push({ code: 'replay_cohort_job_directory_invalid', sourceToolJobId: entry.name });
    }
  }
  for (const sourceToolJobId of expected) {
    if (!entries.some((entry) => entry.name === sourceToolJobId)) {
      diagnostics.push({ code: 'replay_cohort_job_directory_missing', sourceToolJobId });
    }
  }
}

function validateCohortWorkflowGraph({ workflowGraph, jobsById, revisionsById, diagnostics }) {
  if (!hasExactFields(workflowGraph, COHORT_WORKFLOW_FIELDS)) {
    diagnostics.push({ code: 'replay_cohort_workflow_schema_invalid' });
    return;
  }
  if (workflowGraph.contractVersion !== 1 || workflowGraph.validationStatus !== 'valid'
      || !isSafeIdentifier(workflowGraph.projectId) || !isSafeIdentifier(workflowGraph.rootToolJobId)
      || !SHA256.test(workflowGraph.sourceDigest) || !isSafeIdentifier(workflowGraph.graphId)) {
    diagnostics.push({ code: 'replay_cohort_workflow_identity_invalid' });
  }
  if (workflowGraph.graphId !== `wfg_${String(workflowGraph.sourceDigest || '').slice(0, 24)}`) {
    diagnostics.push({ code: 'replay_cohort_workflow_graph_id_mismatch' });
  }
  if (!jobsById.has(workflowGraph.rootToolJobId)) {
    diagnostics.push({ code: 'replay_cohort_workflow_root_job_missing', sourceToolJobId: workflowGraph.rootToolJobId || null });
  }
  if (!Array.isArray(workflowGraph.nodes) || workflowGraph.nodes.length === 0) {
    diagnostics.push({ code: 'replay_cohort_workflow_nodes_invalid' });
    return;
  }
  if (!Array.isArray(workflowGraph.edges) || workflowGraph.edges.length === 0) {
    diagnostics.push({ code: 'replay_cohort_workflow_edges_invalid' });
    return;
  }

  const nodesById = new Map();
  for (const node of workflowGraph.nodes) {
    if (!hasExactFields(node, COHORT_WORKFLOW_NODE_FIELDS)) {
      diagnostics.push({ code: 'replay_cohort_workflow_node_schema_invalid' });
      continue;
    }
    const expectedNodeId = isSafeIdentifier(node.toolJobId) ? `job:${node.toolJobId}` : null;
    const job = jobsById.get(node.toolJobId) || null;
    if (!isSafeWorkflowNodeId(node.id) || !expectedNodeId || node.id !== expectedNodeId
        || !job || node.toolId !== job.toolId || !SHA256.test(node.provenanceHash)
        || !validUniqueIdentifiers(node.artifactIds, { requireSorted: true })
        || !Array.isArray(node.dependsOn) || node.dependsOn.some((dependency) => !isSafeWorkflowNodeId(dependency))
        || new Set(node.dependsOn).size !== node.dependsOn.length
        || !node.dependsOn.every((dependency, index) => index === 0 || node.dependsOn[index - 1].localeCompare(dependency) < 0)) {
      diagnostics.push({ code: 'replay_cohort_workflow_node_invalid', nodeId: node.id || null });
      continue;
    }
    if (nodesById.has(node.id)) {
      diagnostics.push({ code: 'replay_cohort_workflow_node_duplicate', nodeId: node.id });
      continue;
    }
    nodesById.set(node.id, node);
  }
  for (const sourceToolJobId of jobsById.keys()) {
    if (!nodesById.has(`job:${sourceToolJobId}`)) {
      diagnostics.push({ code: 'replay_cohort_workflow_job_node_missing', sourceToolJobId });
    }
  }
  if (nodesById.size !== jobsById.size) {
    diagnostics.push({ code: 'replay_cohort_workflow_node_cohort_mismatch' });
  }

  const children = new Map([...nodesById.keys()].map((nodeId) => [nodeId, new Set()]));
  const incoming = new Map([...nodesById.keys()].map((nodeId) => [nodeId, new Set()]));
  const edgeKeys = new Set();
  for (const edge of workflowGraph.edges) {
    if (!hasExactFields(edge, COHORT_WORKFLOW_EDGE_FIELDS)) {
      diagnostics.push({ code: 'replay_cohort_workflow_edge_schema_invalid' });
      continue;
    }
    const source = revisionsById.get(edge.sourceRevisionId) || null;
    const sourceNode = nodesById.get(edge.fromNodeId) || null;
    const targetNode = nodesById.get(edge.toNodeId) || null;
    const selectionValid = edge.kind === 'artifact'
      ? edge.selectionId === null && edge.selectionHash === null
      : edge.kind === 'selection' && isSafeIdentifier(edge.selectionId) && SHA256.test(edge.selectionHash);
    if (!selectionValid || !isSafeWorkflowNodeId(edge.fromNodeId) || !isSafeWorkflowNodeId(edge.toNodeId)
        || edge.fromNodeId === edge.toNodeId || !isSafeIdentifier(edge.sourceToolJobId)
        || !isSafeIdentifier(edge.sourceRevisionId) || !isSafeIdentifier(edge.sourceArtifactId)
        || !SHA256.test(edge.sourceOutputHash)
        || (edge.inputId !== null && !isSafeIdentifier(edge.inputId))
        || !sourceNode || !targetNode || !source
        || edge.sourceToolJobId !== sourceNode.toolJobId
        || source.toolJobId !== edge.sourceToolJobId
        || source.artifactId !== edge.sourceArtifactId
        || source.outputHash !== edge.sourceOutputHash) {
      diagnostics.push({ code: 'replay_cohort_workflow_edge_invalid', sourceRevisionId: edge.sourceRevisionId || null });
      continue;
    }
    const edgeKey = stableStringify(edge);
    if (edgeKeys.has(edgeKey)) {
      diagnostics.push({ code: 'replay_cohort_workflow_edge_duplicate', sourceRevisionId: edge.sourceRevisionId });
      continue;
    }
    edgeKeys.add(edgeKey);
    children.get(edge.fromNodeId).add(edge.toNodeId);
    incoming.get(edge.toNodeId).add(edge.fromNodeId);
  }

  const rootNodeId = `job:${workflowGraph.rootToolJobId}`;
  if (incoming.get(rootNodeId)?.size > 0) {
    diagnostics.push({ code: 'replay_cohort_workflow_root_has_parent', sourceToolJobId: workflowGraph.rootToolJobId });
  }
  for (const [nodeId, node] of nodesById.entries()) {
    const expectedDependencies = [...(incoming.get(nodeId) || [])].sort();
    if (stableStringify(node.dependsOn) !== stableStringify(expectedDependencies)) {
      diagnostics.push({ code: 'replay_cohort_workflow_dependencies_mismatch', nodeId });
    }
  }
  const visited = new Set();
  const visiting = new Set();
  let cyclic = false;
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) { cyclic = true; return; }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const child of children.get(nodeId) || []) visit(child);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  if (nodesById.has(rootNodeId)) visit(rootNodeId);
  if (cyclic) diagnostics.push({ code: 'replay_cohort_workflow_cycle_detected' });
  if (visited.size !== nodesById.size) diagnostics.push({ code: 'replay_cohort_workflow_disconnected' });

  const expectedDigest = workflowGraphDigest(workflowGraph);
  if (workflowGraph.sourceDigest !== expectedDigest) {
    diagnostics.push({ code: 'replay_cohort_workflow_digest_mismatch' });
  }
}

function validateCohortChildPackage({ root, entry, revisions, projectId, diagnostics }) {
  const sourceToolJobId = entry?.sourceToolJobId || null;
  const expectedPath = isSafeIdentifier(sourceToolJobId) ? `jobs/${sourceToolJobId}` : null;
  if (!expectedPath || entry.relativePath !== expectedPath) {
    diagnostics.push({ code: 'replay_cohort_job_path_noncanonical', sourceToolJobId });
    return;
  }
  const child = resolveCohortChildDirectory(root, entry.relativePath);
  if (!child) {
    diagnostics.push({ code: 'replay_cohort_job_path_invalid', sourceToolJobId });
    return;
  }
  const validation = validateScientificReplayPackage(child);
  if (!validation.ok || validation.manifest?.packageDigest !== entry.packageDigest
      || validation.manifest?.status !== entry.status) {
    diagnostics.push({ code: 'replay_cohort_job_package_invalid', sourceToolJobId });
    return;
  }
  const jobManifest = readRegularJsonInside(child, 'job-manifest.json');
  const replay = readRegularJsonInside(child, 'replay.json');
  if (!jobManifest || jobManifest.id !== sourceToolJobId || jobManifest.toolId !== entry.toolId
      || jobManifest.projectId !== projectId || !replay || !object(replay.plugin)
      || replay.plugin.id !== entry.toolId || !Array.isArray(replay.artifacts)) {
    diagnostics.push({ code: 'replay_cohort_job_binding_invalid', sourceToolJobId });
    return;
  }
  const artifactsById = new Map();
  for (const artifact of replay.artifacts) {
    const artifactId = artifact?.sourceArtifactId || artifact?.artifactId;
    const outputHash = artifact?.expected?.sha256;
    if (!isSafeIdentifier(artifactId) || !SHA256.test(outputHash) || artifactsById.has(artifactId)) {
      diagnostics.push({ code: 'replay_cohort_job_artifact_binding_invalid', sourceToolJobId, artifactId: artifactId || null });
      continue;
    }
    artifactsById.set(artifactId, outputHash);
  }
  if (artifactsById.size !== entry.formalArtifactIds.length
      || entry.formalArtifactIds.some((artifactId) => !artifactsById.has(artifactId))) {
    diagnostics.push({ code: 'replay_cohort_job_artifact_cohort_mismatch', sourceToolJobId });
  }
  for (const revision of revisions) {
    if (artifactsById.get(revision.artifactId) !== revision.outputHash) {
      diagnostics.push({
        code: 'replay_cohort_job_artifact_hash_mismatch',
        sourceToolJobId,
        revisionId: revision.revisionId,
        artifactId: revision.artifactId,
      });
    }
  }
}

function validateResultChangeSetReplayPackage(packageDir) {
  let root;
  let manifest;
  try {
    root = fs.realpathSync(packageDir);
    if (!fs.statSync(root).isDirectory()) throw new Error('not_directory');
    const manifestPath = path.join(root, 'cohort-manifest.json');
    const stat = fs.lstatSync(manifestPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('not_regular');
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return { ok: false, diagnostics: [{ code: 'replay_cohort_manifest_missing' }] };
  }

  const diagnostics = [];
  if (!hasExactFields(manifest, COHORT_MANIFEST_FIELDS)) {
    diagnostics.push({ code: 'replay_cohort_manifest_schema_invalid' });
  }
  const { packageDigest, ...payload } = object(manifest) ? manifest : {};
  if (!SHA256.test(packageDigest) || stableHash(payload) !== packageDigest) {
    diagnostics.push({ code: 'replay_cohort_manifest_hash_mismatch' });
  }
  if (!object(manifest) || manifest.resultChangeSetReplayPackageVersion !== RESULT_CHANGESET_REPLAY_PACKAGE_VERSION
      || !isSafeIdentifier(manifest.sourceChangeSetId) || !GIT_COMMIT.test(manifest.sourceCandidateCommit)
      || !isSafeIdentifier(manifest.selectedSourceRevisionId) || !isSafeIdentifier(manifest.executionRootRevisionId)) {
    diagnostics.push({ code: 'replay_cohort_manifest_identity_invalid' });
  }

  const jobsById = new Map();
  if (!Array.isArray(manifest?.jobs) || manifest.jobs.length < 2) {
    diagnostics.push({ code: 'replay_cohort_jobs_missing' });
  } else {
    for (const entry of manifest.jobs) {
      const sourceToolJobId = entry?.sourceToolJobId || null;
      if (!hasExactFields(entry, COHORT_JOB_FIELDS)
          || !isSafeIdentifier(sourceToolJobId) || !isSafeIdentifier(entry.toolId)
          || !validUniqueIdentifiers(entry.formalArtifactIds, { requireSorted: true })
          || !isSafeCohortRelativePath(entry.relativePath) || !SHA256.test(entry.packageDigest)
          || !REPLAY_PACKAGE_STATUSES.has(entry.status)) {
        diagnostics.push({ code: 'replay_cohort_job_schema_invalid', sourceToolJobId });
        continue;
      }
      if (jobsById.has(sourceToolJobId)) {
        diagnostics.push({ code: 'replay_cohort_job_duplicate', sourceToolJobId });
        continue;
      }
      jobsById.set(sourceToolJobId, entry);
    }
    if (jobsById.size !== manifest.jobs.length) {
      diagnostics.push({ code: 'replay_cohort_job_cohort_mismatch' });
    }
  }

  const revisionsById = new Map();
  const revisionsByJobArtifact = new Map();
  if (!Array.isArray(manifest?.revisions) || manifest.revisions.length === 0) {
    diagnostics.push({ code: 'replay_cohort_revisions_missing' });
  } else {
    for (const revision of manifest.revisions) {
      const revisionId = revision?.revisionId || null;
      if (!hasExactFields(revision, COHORT_REVISION_FIELDS)
          || !isSafeIdentifier(revisionId) || !isSafeIdentifier(revision.toolJobId)
          || !isSafeIdentifier(revision.artifactFamilyId) || !isSafeIdentifier(revision.artifactId)
          || !SHA256.test(revision.outputHash)) {
        diagnostics.push({ code: 'replay_cohort_revision_schema_invalid', revisionId });
        continue;
      }
      const identity = `${revision.toolJobId}\u0000${revision.artifactId}`;
      if (revisionsById.has(revisionId) || revisionsByJobArtifact.has(identity)) {
        diagnostics.push({ code: 'replay_cohort_revision_duplicate', revisionId });
        continue;
      }
      revisionsById.set(revisionId, revision);
      revisionsByJobArtifact.set(identity, revision);
    }
    if (revisionsById.size !== manifest.revisions.length) {
      diagnostics.push({ code: 'replay_cohort_revision_cohort_mismatch' });
    }
  }

  for (const [sourceToolJobId, entry] of jobsById.entries()) {
    for (const artifactId of entry.formalArtifactIds) {
      if (!revisionsByJobArtifact.has(`${sourceToolJobId}\u0000${artifactId}`)) {
        diagnostics.push({ code: 'replay_cohort_formal_artifact_revision_missing', sourceToolJobId, artifactId });
      }
    }
  }
  for (const revision of revisionsById.values()) {
    const entry = jobsById.get(revision.toolJobId) || null;
    if (!entry || !entry.formalArtifactIds.includes(revision.artifactId)) {
      diagnostics.push({
        code: 'replay_cohort_revision_formal_artifact_mismatch',
        revisionId: revision.revisionId,
        sourceToolJobId: revision.toolJobId,
        artifactId: revision.artifactId,
      });
    }
  }
  if (!revisionsById.has(manifest?.selectedSourceRevisionId)
      || !revisionsById.has(manifest?.executionRootRevisionId)) {
    diagnostics.push({ code: 'replay_cohort_selected_revision_missing' });
  }

  validateCohortWorkflowGraph({
    workflowGraph: manifest?.workflowGraph,
    jobsById,
    revisionsById,
    diagnostics,
  });
  const rootRevision = revisionsById.get(manifest?.executionRootRevisionId) || null;
  if (rootRevision && rootRevision.toolJobId !== manifest?.workflowGraph?.rootToolJobId) {
    diagnostics.push({ code: 'replay_cohort_execution_root_mismatch', revisionId: rootRevision.revisionId });
  }

  validateCohortPackageRoot({ root, sourceToolJobIds: [...jobsById.keys()], diagnostics });
  const projectId = manifest?.workflowGraph?.projectId;
  for (const [sourceToolJobId, entry] of jobsById.entries()) {
    const revisions = [...revisionsById.values()]
      .filter((revision) => revision.toolJobId === sourceToolJobId)
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
    validateCohortChildPackage({ root, entry, revisions, projectId, diagnostics });
  }

  return {
    ok: diagnostics.length === 0,
    packageDigest: packageDigest || null,
    diagnostics,
    manifest,
  };
}

async function buildSourceCohortReplayPackage({
  builder,
  execution,
  selectedRevision,
  sourceChangeSet,
  projectRoot,
  packageDir,
  workflowGraph,
} = {}) {
  if (typeof builder !== 'function' || !execution || !sourceChangeSet || !projectRoot || !packageDir) {
    fail('replay_package_dependencies_missing', 'ReplayPackage cohort builder dependencies are incomplete.', 500);
  }
  const buildGroup = async (group, targetDir) => {
    const representative = group.revisions.find((revision) => revision.revisionId === selectedRevision.revisionId)
      || group.revisions.find((revision) => revision.revisionId === execution.rootRevision.revisionId)
      || group.revisions[0];
    const built = await Promise.resolve(builder({
      revision: representative,
      changeSet: sourceChangeSet,
      job: group.job,
      projectRoot,
      packageDir: targetDir,
      workflowGraph,
      formalArtifactIds: group.formalArtifactIds,
    }));
    const validation = built?.validation?.ok
      ? built.validation
      : validateScientificReplayPackage(built?.packageDir || targetDir);
    if (!validation.ok || !SHA256.test(String(built?.packageManifest?.packageDigest || ''))) {
      fail('replay_package_invalid', 'A Result Studio ReplayPackage Job failed integrity validation.');
    }
    return { group, built, validation };
  };
  if (execution.groups.length === 1) {
    const only = await buildGroup(execution.groups[0], packageDir);
    return {
      ...only.built,
      jobs: [{
        sourceToolJobId: only.group.sourceToolJobId,
        toolId: only.group.toolId,
        formalArtifactIds: only.group.formalArtifactIds,
        replay: only.built.replay,
      }],
      cohort: false,
    };
  }

  fs.mkdirSync(packageDir, { recursive: true });
  const builtGroups = [];
  for (const group of execution.groups) {
    const jobId = safeIdentifier(group.sourceToolJobId, 'replay_source_job_id');
    builtGroups.push(await buildGroup(group, path.join(packageDir, 'jobs', jobId)));
  }
  const payload = {
    resultChangeSetReplayPackageVersion: 1,
    sourceChangeSetId: sourceChangeSet.changeSetId,
    sourceCandidateCommit: sourceChangeSet.candidateCommit,
    selectedSourceRevisionId: selectedRevision.revisionId,
    executionRootRevisionId: execution.rootRevision.revisionId,
    workflowGraph: {
      contractVersion: workflowGraph.contractVersion,
      projectId: workflowGraph.projectId,
      validationStatus: workflowGraph.validationStatus,
      graphId: workflowGraph.graphId,
      sourceDigest: workflowGraph.sourceDigest,
      rootToolJobId: workflowGraph.rootToolJobId,
      nodes: workflowGraph.nodes,
      edges: workflowGraph.edges,
    },
    revisions: execution.groups.flatMap((group) => group.revisions.map((revision) => ({
      revisionId: revision.revisionId,
      toolJobId: revision.toolJobId,
      artifactFamilyId: revision.artifactFamilyId,
      artifactId: revision.artifactId,
      outputHash: revision.outputHash,
    }))),
    jobs: builtGroups.map(({ group, built }) => ({
      sourceToolJobId: group.sourceToolJobId,
      toolId: group.toolId,
      formalArtifactIds: group.formalArtifactIds,
      relativePath: relativeInside(packageDir, built.packageDir),
      packageDigest: built.packageManifest.packageDigest,
      status: built.packageManifest.status,
    })),
  };
  const packageDigest = stableHash(payload);
  const manifest = { ...payload, packageDigest };
  fs.writeFileSync(path.join(packageDir, 'cohort-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const validation = validateResultChangeSetReplayPackage(packageDir);
  if (!validation.ok) fail('replay_package_invalid', 'Result Studio cohort ReplayPackage failed integrity validation.');
  return {
    packageDir,
    packageManifest: {
      resultChangeSetReplayPackageVersion: 1,
      status: builtGroups.every(({ built }) => built.packageManifest.status === 'complete') ? 'complete' : 'partial_history',
      packageDigest,
    },
    validation,
    jobs: builtGroups.map(({ group, built }) => ({
      sourceToolJobId: group.sourceToolJobId,
      toolId: group.toolId,
      formalArtifactIds: group.formalArtifactIds,
      replay: built.replay,
    })),
    cohort: true,
  };
}

async function verifyReplayPackageOutputJobs({
  replayPackage,
  changeSetResult,
  getToolJob,
  workspaceRoot,
  verifyReplayOutputs,
} = {}) {
  const packages = Array.isArray(replayPackage?.jobs) ? replayPackage.jobs : [];
  if (packages.length <= 1) {
    const replayJob = getToolJob(changeSetResult.toolJobId);
    return Promise.resolve(verifyReplayOutputs({
      replay: packages[0]?.replay || replayPackage?.replay,
      job: replayJob,
      workspaceRoot,
    }));
  }
  const replayJobIds = changeSetResult?.changeSet?.jobRefs;
  if (!Array.isArray(replayJobIds) || replayJobIds.length !== packages.length) {
    fail('replay_output_job_cohort_mismatch', 'Replay ChangeSet Job cohort differs from the ReplayPackage.');
  }
  const verified = [];
  for (let index = 0; index < packages.length; index += 1) {
    const packageJob = packages[index];
    const replayJob = getToolJob(replayJobIds[index]);
    if (!replayJob || String(replayJob.tool_id || replayJob.toolId || '').trim() !== packageJob.toolId) {
      fail('replay_output_job_order_drift', 'Replay Job order or plugin identity differs from the authoritative workflow.');
    }
    const result = await Promise.resolve(verifyReplayOutputs({
      replay: packageJob.replay,
      job: replayJob,
      workspaceRoot,
    }));
    if (!result?.exactMatch) fail('replay_output_hash_mismatch', 'A ReplayPackage Job did not reproduce its source output cohort.');
    verified.push({
      sourceToolJobId: packageJob.sourceToolJobId,
      replayToolJobId: replayJob.id,
      outputCohortHash: result.outputCohortHash,
      artifactCount: result.artifactCount,
    });
  }
  return {
    exactMatch: true,
    artifactCount: verified.reduce((sum, entry) => sum + Number(entry.artifactCount || 0), 0),
    outputCohortHash: stableHash(verified),
    jobs: verified,
  };
}

function assertPluginCompatibility({ sourceJob, sourceProjection, plugin }) {
  const sourcePlugin = sourceProjection.reproduction.plugin || {};
  const toolId = String(sourceJob?.tool_id || sourceJob?.toolId || '').trim();
  if (!plugin || !toolId || sourcePlugin.id !== toolId || String(plugin.id || '') !== toolId) {
    fail('replay_plugin_unavailable', 'The exact source plugin is unavailable.');
  }
  if (!sourcePlugin.version || !plugin.version || String(sourcePlugin.version) !== String(plugin.version)) {
    fail('replay_plugin_version_drift', 'The installed plugin version does not match the source Revision.');
  }
  const sourceLanguage = String(sourceProjection.language || '').toLowerCase();
  const pluginLanguage = String(plugin.language || '').toLowerCase();
  if (!sourceLanguage || sourceLanguage !== pluginLanguage) {
    fail('replay_plugin_language_drift', 'The installed plugin language does not match the source Revision.');
  }
  return { toolId, language: pluginLanguage };
}

function replayFingerprint({ projectId, revision, sourceProjection, sourceJob, executionParams, contextToken }) {
  const sourceResult = parseJobResult(sourceJob);
  const provenanceInputs = Array.isArray(sourceResult.executionProvenance?.inputs)
    ? sourceResult.executionProvenance.inputs
    : [];
  return stableHash({
    controlledReplayVersion: CONTROLLED_REPLAY_VERSION,
    projectId,
    revisionId: revision.revisionId,
    sourceCommit: revision.sourceCommit,
    sourceSha256: sourceProjection.sha256,
    parametersHash: sourceProjection.parameters?.sha256 || null,
    normalizedParameters: sourceProjection.parameters?.rawValues || null,
    inputHashes: provenanceInputs.map((input) => ({ id: input.id, relativePath: input.relativePath, sha256: input.sha256 })),
    executionParamKeys: Object.keys(executionParams).sort(),
    toolJobId: sourceJob.id,
    toolId: sourceJob.tool_id || sourceJob.toolId,
    pluginVersion: sourceProjection.reproduction.plugin?.version || null,
    contextToken: contextToken || null,
  });
}

function createReplayIntent({ token, revision, workflowGraph = null, affectedNodeIds = [] }) {
  const workflowSubgraph = workflowGraph && affectedNodeIds.length > 1;
  return {
    contractVersion: '1',
    intentId: `rei_replay_${sha256(token).slice(0, 24)}`,
    artifactRef: { artifactId: revision.artifactId, revisionId: revision.revisionId },
    requestedOutcome: '受控重放该 ArtifactRevision',
    // A byte-identical replay still recomputes scientific output.  The
    // separate confirmation phase is the explicit scientific confirmation;
    // do not downgrade the execution to a presentation-only edit merely
    // because source and parameters are unchanged.
    editClass: 'scientific_recompute',
    proposedParameterPatch: {},
    affectedNodeIds,
    affectedScope: workflowSubgraph ? 'workflow_subgraph' : 'current_result_only',
    requiresJob: true,
    requiresScientificConfirmation: true,
    classificationReason: 'controlled_revision_replay',
    ...(workflowGraph ? {
      workflowGraph: {
        graphId: workflowGraph.graphId,
        sourceDigest: workflowGraph.sourceDigest,
      },
    } : {}),
  };
}

function wrapSourceError(error) {
  if (error instanceof ResultReplayError) throw error;
  if (error instanceof ResultRevisionSourceError) {
    throw new ResultReplayError(error.code, error.message, error.status, error.detail);
  }
  throw error;
}

function resolveQualifiedReplayCohort({ repository, projectId, revision, getToolJob } = {}) {
  if (typeof repository?.resolveRestorableRevision !== 'function') {
    fail('replay_source_cohort_qualification_unavailable', 'Exact ReplayPackage proof requires Repository cohort qualification.');
  }
  let qualified;
  try {
    qualified = repository.resolveRestorableRevision({ revisionId: revision.revisionId, projectId });
  } catch (error) {
    fail(error.code || 'replay_source_cohort_invalid', error.message || 'Adopted source cohort is incomplete.', 409, error.detail || null);
  }
  if (qualified.changeSet.status !== 'adopted' || !qualified.changeSet.adoptedAt) {
    fail('replay_package_requires_adopted_revision', 'Exact ReplayPackage proof requires an adopted Revision cohort.');
  }
  const graphRef = qualified.changeSet.validationSummary?.workflowGraph || null;
  if (!graphRef?.graphId || !SHA256.test(String(graphRef.sourceDigest || ''))
      || typeof repository.getWorkflowGraph !== 'function') {
    fail('replay_workflow_graph_missing', 'Scientific replay requires a source-bound persisted workflow graph.');
  }
  let workflowGraph;
  try {
    workflowGraph = repository.getWorkflowGraph(graphRef.graphId);
  } catch (error) {
    fail('replay_workflow_graph_stale', 'Persisted workflow graph failed repository integrity validation.', 409, {
      cause: error.code || 'workflow_graph_read_failed',
    });
  }
  if (!workflowGraph) {
    fail('replay_workflow_graph_missing', 'Scientific replay workflow graph is unavailable.');
  }
  if (workflowGraph.graphId !== graphRef.graphId
      || workflowGraph.projectId !== projectId
      || workflowGraph.sourceDigest !== graphRef.sourceDigest) {
    fail('replay_workflow_graph_drift', 'Persisted workflow graph no longer matches the adopted ChangeSet.');
  }
  const execution = projectReplayExecutionCohort({
    sourceRevisions: qualified.cohort,
    selectedRevision: revision,
    workflowGraph,
    getToolJob,
  });
  return {
    sourceChangeSet: qualified.changeSet,
    sourceRevisions: qualified.cohort,
    workflowGraph,
    execution,
    fingerprint: replayCohortFingerprint({
      sourceChangeSet: qualified.changeSet,
      sourceRevisions: qualified.cohort,
      workflowGraph,
      execution,
    }),
  };
}

function createControlledReplayService(options = {}) {
  const records = options.records || new Map();
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0
    ? options.ttlMs
    : DEFAULT_CONFIRMATION_TTL_MS;
  const makeToken = typeof options.makeToken === 'function'
    ? options.makeToken
    : () => `rrc_${crypto.randomUUID().replace(/-/g, '')}`;
  const runChangeSet = options.createResultChangeSet || createResultChangeSet;
  const buildReplayPackage = options.buildResultRevisionReplayPackage || buildResultRevisionReplayPackage;
  const buildReplayCohort = options.buildSourceCohortReplayPackage || buildSourceCohortReplayPackage;
  const verifyReplayOutputs = options.verifyReplayOutputCohort || verifyReplayOutputCohort;
  const verifyReplayJobs = options.verifyReplayPackageOutputJobs || verifyReplayPackageOutputJobs;
  const mapReplayProofs = options.buildRevisionReplayProofs || buildRevisionReplayProofs;
  const persistReplayProof = options.persistReplayProof || ((repository, input) => {
    if (typeof repository?.recordReplayProofAndVerifyCohort !== 'function') {
      fail('replay_proof_repository_unavailable', 'Replay proof persistence is unavailable.', 500);
    }
    return repository.recordReplayProofAndVerifyCohort(input);
  });

  function inspect(input = {}, dependencies = {}) {
    const projectId = safeIdentifier(input.projectId, 'project_id');
    const revisionId = safeIdentifier(input.revisionId, 'revision_id');
    const repository = dependencies.repository;
    const getToolJob = dependencies.getToolJob;
    const getPlugin = dependencies.getPlugin;
    if (!repository || typeof getToolJob !== 'function' || typeof getPlugin !== 'function') {
      fail('replay_dependencies_missing', 'Replay dependencies are incomplete.', 500);
    }
    const revision = repository.getRevision(revisionId);
    if (!revision || revision.projectId !== projectId) fail('revision_not_found', 'Revision is not available in this project.', 404);
    const sourceJob = getToolJob(revision.toolJobId);
    const plugin = sourceJob ? getPlugin(sourceJob.tool_id || sourceJob.toolId) : null;
    let sourceProjection;
    try {
      sourceProjection = verifyRevisionSourceMaterial({
        projectId,
        revision,
        expectSha256: input.expectedSourceSha256 || null,
      }, {
        repository,
        adapter: dependencies.adapter,
        gitPathPrefix: dependencies.gitPathPrefix,
        workspaceRoot: dependencies.workspaceRoot,
        getToolJob,
        allowRawParameters: true,
      });
    } catch (error) {
      wrapSourceError(error);
    }
    if (!sourceProjection.reproduction.replayable) {
      fail('replay_not_available', 'Revision does not have complete replay material.');
    }
    assertExpectedHashes({
      sourceProjection,
      sourceJob,
      expectedSourceSha256: input.expectedSourceSha256,
      expectedParametersHash: input.expectedParametersHash,
      expectedInputHashes: input.expectedInputHashes,
    });
    assertRevisionOutput({ revision, workspaceRoot: dependencies.workspaceRoot });
    const { toolId, language } = assertPluginCompatibility({ sourceJob, sourceProjection, plugin });
    const executionParams = buildReplayExecutionParams({ sourceJob, sourceProjection, workspaceRoot: dependencies.workspaceRoot });
    const fingerprint = replayFingerprint({
      projectId, revision, sourceProjection, sourceJob, executionParams, contextToken: input.contextToken,
    });
    return {
      projectId,
      revisionId,
      revision,
      sourceJob,
      sourceProjection,
      toolId,
      language,
      executionParams,
      normalizedSourceParams: cloneJson(sourceProjection.parameters.rawValues),
      fingerprint,
      inputHashes: Object.fromEntries(
        (parseJobResult(sourceJob).executionProvenance?.inputs || [])
          .filter((item) => item?.id)
          .map((item) => [item.id, item.sha256])
      ),
    };
  }

  function prepare(input = {}, dependencies = {}) {
    assertAllowedReplayRequest(input.request || input);
    const material = inspect(input, dependencies);
    const qualified = resolveQualifiedReplayCohort({
      repository: dependencies.repository,
      projectId: material.projectId,
      revision: material.revision,
      getToolJob: dependencies.getToolJob,
    });
    const fingerprint = stableHash({ revision: material.fingerprint, cohort: qualified.fingerprint });
    const confirmationToken = makeToken();
    const createdAt = now();
    const record = {
      confirmationToken,
      projectId: material.projectId,
      revisionId: material.revisionId,
      conversationId: input.conversationId || null,
      contextToken: input.contextToken || null,
      fingerprint,
      createdAt,
      expiresAt: createdAt + ttlMs,
      state: 'ready',
      sourceJobId: material.sourceJob.id,
      toolId: material.toolId,
      language: material.language,
      sourceSha256: material.sourceProjection.sha256,
      parametersHash: material.sourceProjection.parameters.sha256,
      inputHashes: material.inputHashes,
      sourceChangeSetId: qualified.sourceChangeSet.changeSetId,
      sourceCohortFingerprint: qualified.fingerprint,
      executionRootRevisionId: qualified.execution.rootRevision.revisionId,
      executionJobCount: qualified.execution.groups.length,
      sourceRevisionCount: qualified.sourceRevisions.length,
      promise: null,
      result: null,
      error: null,
    };
    records.set(confirmationToken, record);
    return {
      ok: true,
      controlledReplayVersion: CONTROLLED_REPLAY_VERSION,
      status: 'confirmation_required',
      confirmationToken,
      expiresAt: record.expiresAt,
      fingerprint,
      revision: {
        revisionId: material.revisionId,
        artifactId: material.revision.artifactId,
        revisionOrdinal: material.revision.revisionOrdinal,
        sourceSha256: record.sourceSha256,
        parametersHash: record.parametersHash,
        inputCount: material.sourceProjection.reproduction.inputs.length,
      },
      execution: {
        toolId: material.toolId,
        pluginVersion: material.sourceProjection.reproduction.plugin.version,
        runtime: material.sourceProjection.reproduction.runtime,
        createsToolJob: true,
        createsCandidateRevision: true,
        adoptsCandidate: false,
        mutatesCurrentRevision: false,
        createsReplayPackage: true,
        requiresExactOutputCohort: true,
        sourceRevisionCount: qualified.sourceRevisions.length,
        affectedJobCount: qualified.execution.groups.length,
        acceptsWorkflowPlan: false,
        acceptsShell: false,
      },
    };
  }

  async function confirm(input = {}, dependencies = {}) {
    assertAllowedReplayRequest(input.request || input);
    const projectId = safeIdentifier(input.projectId, 'project_id');
    const revisionId = safeIdentifier(input.revisionId, 'revision_id');
    const confirmationToken = String(input.confirmationToken || '').trim();
    const record = records.get(confirmationToken);
    if (!confirmationToken || !record) fail('replay_confirmation_invalid', 'Replay confirmation is invalid or unavailable.', 409);
    if (record.projectId !== projectId || record.revisionId !== revisionId) {
      fail('replay_confirmation_scope_mismatch', 'Replay confirmation belongs to another project or Revision.');
    }
    if ((record.contextToken || null) !== (input.contextToken || null)) {
      fail('replay_context_stale', 'Result context changed after replay preflight.');
    }
    if (record.expiresAt <= now()) {
      record.state = 'expired';
      fail('replay_confirmation_expired', 'Replay confirmation expired; run preflight again.');
    }
    if (record.state === 'running' && record.promise) return record.promise;
    if (record.state === 'completed' && record.result) return { ...record.result, idempotent: true };
    if (record.state === 'failed' && record.error) throw record.error;
    if (record.state !== 'ready') fail('replay_confirmation_consumed', 'Replay confirmation is no longer executable.');

    const repository = dependencies.repository;
    const getToolJob = dependencies.getToolJob;
    const getPlugin = dependencies.getPlugin;
    const executeJob = dependencies.executeJob;
    if (!repository || typeof getToolJob !== 'function' || typeof getPlugin !== 'function'
      || typeof executeJob !== 'function' || !dependencies.adapter) {
      fail('replay_dependencies_missing', 'Replay execution dependencies are incomplete.', 500);
    }

    // Mark running before the first await. Concurrent duplicate confirmations
    // observe the same promise and can never create a second Job.
    record.state = 'running';
    const promise = (async () => {
      try {
        const refreshed = inspect({
          projectId,
          revisionId,
          conversationId: record.conversationId,
          contextToken: record.contextToken,
          expectedSourceSha256: record.sourceSha256,
          expectedParametersHash: record.parametersHash,
          expectedInputHashes: record.inputHashes,
        }, dependencies);
        const revision = refreshed.revision;
        if (!revision || revision.projectId !== projectId) {
          fail('replay_source_stale', 'Replay source is no longer available in this project.');
        }
        const qualified = resolveQualifiedReplayCohort({ repository, projectId, revision, getToolJob });
        const currentFingerprint = stableHash({ revision: refreshed.fingerprint, cohort: qualified.fingerprint });
        if (currentFingerprint !== record.fingerprint
            || qualified.sourceChangeSet.changeSetId !== record.sourceChangeSetId
            || qualified.execution.rootRevision.revisionId !== record.executionRootRevisionId) {
          fail('replay_material_stale', 'Replay material or authoritative workflow changed after preflight.');
        }
        const { sourceChangeSet, sourceRevisions, workflowGraph, execution } = qualified;
        const rootRevision = execution.rootRevision;
        const rootMaterial = rootRevision.revisionId === revision.revisionId
          ? refreshed
          : inspect({
              projectId,
              revisionId: rootRevision.revisionId,
              conversationId: record.conversationId,
              contextToken: record.contextToken,
            }, dependencies);
        const packageDir = path.join(
          dependencies.workspaceRoot,
          '.biof3',
          'replay-packages',
          revisionId,
          confirmationToken,
        );
        const replayPackage = await buildReplayCohort({
          builder: buildReplayPackage,
          execution,
          selectedRevision: revision,
          sourceChangeSet,
          projectRoot: dependencies.workspaceRoot,
          packageDir,
          workflowGraph,
        });
        const packageValidation = replayPackage?.validation?.ok
          ? replayPackage.validation
          : replayPackage?.cohort
            ? validateResultChangeSetReplayPackage(replayPackage?.packageDir || packageDir)
            : validateScientificReplayPackage(replayPackage?.packageDir || packageDir);
        if (!packageValidation.ok || !SHA256.test(String(replayPackage?.packageManifest?.packageDigest || ''))) {
          fail('replay_package_invalid', 'Result Studio ReplayPackage failed integrity validation.');
        }
        const changeSetResult = await runChangeSet({
          projectId,
          conversationId: record.conversationId,
          workspaceRoot: dependencies.workspaceRoot,
          intent: createReplayIntent({
            token: confirmationToken,
            revision: rootRevision,
            workflowGraph,
            affectedNodeIds: execution.affectedNodeIds,
          }),
          sourceRevision: rootRevision,
          // Use only the execution params reconstructed from intact,
          // project-contained provenance inputs. The persisted source Job row
          // remains the identity and provenance authority.
          sourceJob: { ...rootMaterial.sourceJob, params: cloneJson(rootMaterial.executionParams) },
          sourceScriptSha256: rootMaterial.sourceProjection.sha256,
          normalizedSourceParams: rootMaterial.normalizedSourceParams,
          pluginId: rootMaterial.toolId,
          language: rootMaterial.language,
          scriptPatch: [],
          scientificConfirmed: true,
          createdBy: 'user',
          authoritativeSubgraph: execution.authoritativeSubgraph,
        }, {
          repository,
          adapter: dependencies.adapter,
          gitPathPrefix: dependencies.gitPathPrefix,
          getToolJob,
          getResultStudioDescriptor: dependencies.getResultStudioDescriptor,
          executeJob,
          authoritativeSubgraphTrusted: execution.authoritativeSubgraph != null,
          activePreviewJobs: dependencies.activePreviewJobs || 0,
          onProgress: dependencies.onProgress,
          shouldCancel: dependencies.shouldCancel,
        });
        if (!changeSetResult || changeSetResult.ok !== true || changeSetResult.adopted !== false
          || changeSetResult.revision?.parentRevisionIds?.[0] !== rootRevision.revisionId) {
          fail('replay_candidate_invalid', 'Controlled replay did not create the expected isolated candidate.');
        }
        const exactOutput = await verifyReplayJobs({
          replayPackage,
          changeSetResult,
          getToolJob,
          workspaceRoot: dependencies.workspaceRoot,
          verifyReplayOutputs,
        });
        if (!exactOutput?.exactMatch) {
          fail('replay_output_hash_mismatch', 'Replay output cohort did not exactly reproduce the adopted Revision.');
        }
        const replayRevisions = repository.listRevisionsByChangeSet(changeSetResult.changeSet.changeSetId);
        const proofs = mapReplayProofs({ sourceRevisions, replayRevisions });
        const selectedProof = proofs.find((proof) => proof.sourceRevisionId === revisionId);
        if (!selectedProof) fail('replay_revision_cohort_mismatch', 'Selected Revision is absent from the exact replay proof.');
        const proofRecord = await Promise.resolve(persistReplayProof(repository, {
          projectId,
          changeSetId: sourceChangeSet.changeSetId,
          replayPackageDigest: replayPackage.packageManifest.packageDigest,
          proofs,
        }));
        const response = {
          ok: true,
          controlledReplayVersion: CONTROLLED_REPLAY_VERSION,
          status: 'preview_ready',
          replayFingerprint: record.fingerprint,
          changeSetId: changeSetResult.changeSet.changeSetId,
          toolJobId: selectedProof.replayToolJobId,
          revisionId: selectedProof.replayRevisionId,
          parentRevisionId: revisionId,
          adopted: false,
          replayPackage: {
            relativePath: relativeInside(dependencies.workspaceRoot, replayPackage.packageDir),
            packageDigest: replayPackage.packageManifest.packageDigest,
            status: replayPackage.packageManifest.status,
          },
          reproducibility: {
            exactMatch: true,
            outputCohortHash: exactOutput.outputCohortHash,
            artifactCount: exactOutput.artifactCount,
            sourceChangeSetId: sourceChangeSet.changeSetId,
            replayChangeSetId: changeSetResult.changeSet.changeSetId,
            sourceCohortVerified: proofRecord?.replayProof?.exactMatch === true,
          },
          idempotent: false,
        };
        record.state = 'completed';
        record.result = response;
        return response;
      } catch (error) {
        const wrapped = error instanceof ResultReplayError
          ? error
          : new ResultReplayError(error.code || 'replay_execution_failed', error.message || 'Controlled replay failed.', 409, error.detail || null);
        record.state = 'failed';
        record.error = wrapped;
        throw wrapped;
      }
    })();
    record.promise = promise;
    return promise;
  }

  return { prepare, confirm, records };
}

module.exports = {
  CONTROLLED_REPLAY_VERSION,
  DEFAULT_CONFIRMATION_TTL_MS,
  ResultReplayError,
  assertAllowedReplayRequest,
  buildReplayExecutionParams,
  verifyReplayOutputCohort,
  buildRevisionReplayProofs,
  projectReplayExecutionCohort,
  validateResultChangeSetReplayPackage,
  buildSourceCohortReplayPackage,
  verifyReplayPackageOutputJobs,
  createControlledReplayService,
};
