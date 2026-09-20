'use strict';

// BLOCK-92 Wave C-8 — ChangeSet 回放包契约与校验/证明簇外迁
// （原 result-replay-service.js 41-981 行，纯搬运零行为变化）。

const fs = require('node:fs');
const path = require('node:path');
const { stableStringify } = require('../canonical-json');
const { isPathContained } = require('../project-run-layout');
const {
  resolveExecutionInputPath,
  verifyExecutionProvenance,
} = require('../execution-provenance');
const {
  verifyWorkflowGraphIntegrity,
  workflowGraphDigest,
} = require('../result-workflow-graph');
const { sha256 } = require('../result-changeset-service');
require('../result-revision-source');
const {
  validateScientificReplayPackage,
} = require('../scientific-replay-package');

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


module.exports = {
  SHA256,
  CONTROLLED_REPLAY_VERSION,
  DEFAULT_CONFIRMATION_TTL_MS,
  GIT_COMMIT,
  SAFE_ID,
  RESULT_CHANGESET_REPLAY_PACKAGE_VERSION,
  REPLAY_PACKAGE_STATUSES,
  COHORT_MANIFEST_FIELDS,
  COHORT_WORKFLOW_FIELDS,
  COHORT_WORKFLOW_NODE_FIELDS,
  COHORT_WORKFLOW_EDGE_FIELDS,
  COHORT_REVISION_FIELDS,
  COHORT_JOB_FIELDS,
  REQUEST_FIELDS,
  ResultReplayError,
  fail,
  object,
  cloneJson,
  stableHash,
  assertAllowedReplayRequest,
  safeIdentifier,
  expectedInputMap,
  hashFile,
  resolveIntactInput,
  projectSourceJobParams,
  buildReplayExecutionParams,
  assertExpectedHashes,
  assertRevisionOutput,
  parseJobResult,
  verifyReplayOutputCohort,
  buildRevisionReplayProofs,
  projectReplayExecutionCohort,
  replayCohortFingerprint,
  hasExactFields,
  isSafeIdentifier,
  isSafeCohortRelativePath,
  isStrictlyContainedPath,
  isSafeWorkflowNodeId,
  validUniqueIdentifiers,
  readRegularJsonInside,
  resolveCohortChildDirectory,
  validateCohortPackageRoot,
  validateCohortWorkflowGraph,
  validateCohortChildPackage,
  validateResultChangeSetReplayPackage,
};
