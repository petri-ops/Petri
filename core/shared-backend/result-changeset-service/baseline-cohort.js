'use strict';

const path = require('path');
const { stableStringify } = require('../canonical-json');
const {
  buildAuthoritativeWorkflowGraph,
  verifyWorkflowGraphIntegrity,
} = require('../result-workflow-graph');
const { validateResultStudioCandidate } = require('../result-plugin-validator');
const { executeDurableRefTransaction } = require('../result-ref-transaction');
const {
  ResultChangeSetError,
  ZERO_OID,
  MAX_PARAMETERS_BYTES,
  MAX_SCRIPT_BYTES,
  deterministicId,
  exactArtifact,
  hashFile,
  id,
  projectRelativeOutput,
  resultOf,
  safeSegment,
  sha256,
  stableJson,
} = require('./internal');
const {
  resolveCandidateDescriptor,
} = require('./projections');
const {
  buildResultEditCheckpoint,
  resolveBaseCommit,
  saveResultEditCheckpoint,
  startResultEditChangeSet,
  transitionResultEditWithCheckpoint,
} = require('./checkpoints');

function isBaselineIntentRef(value) {
  const intentRef = String(value || '');
  return intentRef.startsWith('baseline:') || intentRef.startsWith('baseline-cohort:');
}

function sameIdentifierSet(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && new Set(left).size === left.length
    && left.every((value) => right.includes(value));
}

function descriptorFormalArtifactTruth(descriptor, sourceJob) {
  const descriptors = Array.isArray(descriptor?.artifacts) ? descriptor.artifacts : [];
  const artifactIds = descriptors.map((artifact) => String(artifact?.id || artifact?.artifactId || '').trim());
  if (artifactIds.length === 0 || artifactIds.some((artifactId) => !artifactId)
      || new Set(artifactIds).size !== artifactIds.length) {
    return null;
  }
  const result = resultOf(sourceJob);
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const provenanceArtifacts = Array.isArray(result.executionProvenance?.artifacts)
    ? result.executionProvenance.artifacts
    : [];
  const formalArtifacts = [];
  for (const artifactId of artifactIds) {
    const matches = artifacts.filter((artifact) => artifact?.id === artifactId);
    const provenanceMatches = provenanceArtifacts.filter((artifact) => artifact?.id === artifactId);
    const outputHash = String(provenanceMatches[0]?.sha256 || '').trim();
    if (matches.length !== 1 || provenanceMatches.length !== 1 || !/^[a-f0-9]{64}$/.test(outputHash)) {
      return null;
    }
    formalArtifacts.push({ artifactId, sha256: outputHash });
  }
  return formalArtifacts;
}

function resolveExactFormalSourceRevision({
  repository,
  projectId,
  selectedRevision,
  sourceToolJobId,
  artifactId,
} = {}) {
  const sourceChangeSet = selectedRevision?.changeSetId
    ? repository?.getChangeSet(selectedRevision.changeSetId)
    : null;
  const cohort = sourceChangeSet
    ? repository.listRevisionsByChangeSet(sourceChangeSet.changeSetId)
    : [];
  const cohortRevisionIds = cohort.map((revision) => revision.revisionId);
  const cohortJobIds = [...new Set(cohort.map((revision) => revision.toolJobId))];
  if (!sourceChangeSet || sourceChangeSet.projectId !== projectId
      || !['preview_ready', 'adopted', 'reverted'].includes(sourceChangeSet.status)
      || !sameIdentifierSet(cohortRevisionIds, sourceChangeSet.candidateArtifactRefs)
      || !sameIdentifierSet(cohortJobIds, sourceChangeSet.jobRefs)
      || !cohort.some((revision) => revision.revisionId === selectedRevision.revisionId)
      || selectedRevision.projectId !== projectId
      || selectedRevision.toolJobId !== sourceToolJobId) {
    throw new ResultChangeSetError(
      'candidate_formal_source_cohort_incomplete',
      'Formal source outputs must resolve from the selected Revision\'s exact ChangeSet cohort.'
    );
  }
  const matches = cohort.filter((revision) => revision.projectId === projectId
    && revision.toolJobId === sourceToolJobId
    && revision.artifactId === artifactId);
  if (matches.length !== 1
      || (artifactId === selectedRevision.artifactId
        && matches[0].revisionId !== selectedRevision.revisionId)) {
    throw new ResultChangeSetError(
      'candidate_formal_source_revision_missing',
      'Every produced formal output requires one exact source Revision from the selected ChangeSet cohort.',
      { toolJobId: sourceToolJobId, artifactId }
    );
  }
  return matches[0];
}

function resolveCompleteBaselineCohort({
  repository,
  changeSetId,
  projectId,
  sourceJobId,
  formalArtifacts,
  validatorId,
  allowedStatuses = ['adopted'],
}) {
  if (!changeSetId) return null;
  const changeSet = repository.getChangeSet(changeSetId);
  if (!changeSet || changeSet.projectId !== projectId
      || !allowedStatuses.includes(changeSet.status)
      || !isBaselineIntentRef(changeSet.intentRef)
      || (changeSet.status === 'adopted' && !changeSet.adoptedAt)) {
    return null;
  }
  const revisions = repository.listRevisionsByChangeSet(changeSetId);
  const revisionIds = revisions.map((revision) => revision.revisionId);
  if (!sameIdentifierSet(revisionIds, changeSet.candidateArtifactRefs)
      || revisions.length !== formalArtifacts.length) {
    return null;
  }
  const byArtifactId = new Map();
  for (const revision of revisions) {
    if (byArtifactId.has(revision.artifactId)) return null;
    byArtifactId.set(revision.artifactId, revision);
  }
  const ordered = [];
  for (const artifact of formalArtifacts) {
    const revision = byArtifactId.get(artifact.artifactId);
    if (!revision || revision.projectId !== projectId
        || revision.changeSetId !== changeSetId
        || revision.toolJobId !== sourceJobId
        || revision.outputHash !== artifact.sha256
        || revision.validationStatus === 'blocked'
        || !revision.sourceCommit
        || revision.sourceCommit !== changeSet.candidateCommit) {
      return null;
    }
    ordered.push(revision);
  }
  const validationSummary = changeSet.validationSummary || {};
  if (validationSummary.formalArtifactCount !== formalArtifacts.length
      || !sameIdentifierSet(validationSummary.validatorIds, [validatorId])) {
    return null;
  }
  const graphRef = validationSummary.workflowGraph || null;
  if (!graphRef?.graphId || !/^[a-f0-9]{64}$/.test(String(graphRef.sourceDigest || ''))) return null;
  let workflowGraph = null;
  try { workflowGraph = repository.getWorkflowGraph(graphRef.graphId); } catch { return null; }
  const graphIntegrity = workflowGraph
    ? verifyWorkflowGraphIntegrity(workflowGraph)
    : { ok: false };
  const sourceNode = workflowGraph?.nodes?.find((node) => node.toolJobId === sourceJobId) || null;
  if (!workflowGraph || !graphIntegrity.ok || workflowGraph.projectId !== projectId
      || workflowGraph.sourceDigest !== graphRef.sourceDigest
      || workflowGraph.validationStatus !== 'valid'
      || !sourceNode
      || !formalArtifacts.every((artifact) => sourceNode.artifactIds.includes(artifact.artifactId))) {
    return null;
  }
  return { changeSet, revisions: ordered };
}

/**
 * Read-only qualification used by the real interaction route before it reuses
 * an existing Job Revision.  Presence alone is insufficient: every formal
 * output must belong to the same adopted baseline ChangeSet and that exact
 * cohort must carry the descriptor's current validator/count proof.
 */
function inspectBaselineArtifactCohort(input = {}, dependencies = {}) {
  const repository = dependencies.repository;
  const projectId = String(input.projectId || '').trim();
  const sourceJob = input.sourceJob;
  const requested = String(input.artifactId || '').trim();
  const descriptor = input.pluginDescriptor?.resultStudio
    || input.pluginDescriptor
    || resolveCandidateDescriptor({
      dependencies,
      toolId: input.pluginId || sourceJob?.tool_id || sourceJob?.toolId,
    });
  const fail = (reason) => ({
    qualified: false,
    reason,
    revision: null,
    cohortRevisions: [],
  });
  if (!repository || typeof repository.findRevisionByJobArtifact !== 'function'
      || typeof repository.getChangeSet !== 'function'
      || typeof repository.listRevisionsByChangeSet !== 'function') {
    return fail('repository_unavailable');
  }
  if (!projectId || !sourceJob || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
      || sourceJob.status !== 'completed') {
    return fail('source_job_invalid');
  }
  if (!descriptor) return fail('descriptor_unavailable');
  const validatorId = String(descriptor.validator?.id || '').trim();
  if (!validatorId) return fail('validator_unavailable');
  const sourceResult = resultOf(sourceJob);
  if (sourceResult.artifactTruth?.status !== 'valid' || sourceResult.artifactTruth?.blocking === true) {
    return fail('source_artifact_truth_invalid');
  }
  const formalArtifacts = descriptorFormalArtifactTruth(descriptor, sourceJob);
  if (!formalArtifacts || !formalArtifacts.some((artifact) => artifact.artifactId === requested)) {
    return fail('formal_artifact_truth_invalid');
  }
  const revisions = formalArtifacts.map((artifact) => repository.findRevisionByJobArtifact({
    projectId,
    toolJobId: sourceJob.id,
    artifactId: artifact.artifactId,
  }));
  if (revisions.some((revision) => !revision)) return fail('formal_revision_missing');
  const changeSetIds = [...new Set(revisions.map((revision) => revision.changeSetId).filter(Boolean))];
  if (changeSetIds.length !== 1) return fail('baseline_cohort_split');
  const complete = resolveCompleteBaselineCohort({
    repository,
    changeSetId: changeSetIds[0],
    projectId,
    sourceJobId: sourceJob.id,
    formalArtifacts,
    validatorId,
  });
  if (!complete
      || !sameIdentifierSet(
        revisions.map((revision) => revision.revisionId),
        complete.revisions.map((revision) => revision.revisionId)
      )) {
    return fail('baseline_cohort_unqualified');
  }
  const revision = complete.revisions.find((candidate) => candidate.artifactId === requested) || null;
  if (!revision) return fail('requested_revision_missing');
  return {
    qualified: true,
    reason: null,
    revision,
    cohortRevisions: complete.revisions,
    changeSet: complete.changeSet,
  };
}

/**
 * Qualify a formal Job Artifact that already belongs to a normal persisted
 * candidate/restore cohort. Re-registering it as a baseline would fork the
 * artifact family when an adopted Job is reopened through its own coordinate.
 */
function inspectPersistedArtifactCohort(input = {}, dependencies = {}) {
  const repository = dependencies.repository;
  const projectId = String(input.projectId || '').trim();
  const sourceJob = input.sourceJob;
  const sourceJobId = String(sourceJob?.id || '').trim();
  const requested = String(input.artifactId || '').trim();
  const descriptor = input.pluginDescriptor?.resultStudio
    || input.pluginDescriptor
    || resolveCandidateDescriptor({
      dependencies,
      toolId: input.pluginId || sourceJob?.tool_id || sourceJob?.toolId,
    });
  const fail = (reason) => ({
    qualified: false,
    reason,
    revision: null,
    cohortRevisions: [],
  });
  if (!repository || typeof repository.findRevisionByJobArtifact !== 'function'
      || typeof repository.getChangeSet !== 'function'
      || typeof repository.listRevisionsByChangeSet !== 'function'
      || typeof repository.getWorkflowGraph !== 'function') {
    return fail('repository_unavailable');
  }
  if (!projectId || !sourceJobId
      || String(sourceJob?.project_id || sourceJob?.projectId || '') !== projectId
      || sourceJob.status !== 'completed') {
    return fail('source_job_invalid');
  }
  if (!descriptor) return fail('descriptor_unavailable');
  const validatorId = String(descriptor.validator?.id || '').trim();
  if (!validatorId) return fail('validator_unavailable');
  const sourceResult = resultOf(sourceJob);
  if (sourceResult.artifactTruth?.status !== 'valid' || sourceResult.artifactTruth?.blocking === true) {
    return fail('source_artifact_truth_invalid');
  }
  const formalArtifacts = descriptorFormalArtifactTruth(descriptor, sourceJob);
  if (!formalArtifacts || !formalArtifacts.some((artifact) => artifact.artifactId === requested)) {
    return fail('formal_artifact_truth_invalid');
  }
  const formalRevisions = formalArtifacts.map((artifact) => repository.findRevisionByJobArtifact({
    projectId,
    toolJobId: sourceJobId,
    artifactId: artifact.artifactId,
  }));
  if (formalRevisions.some((revision) => !revision)) return fail('formal_revision_missing');
  const changeSetIds = [...new Set(formalRevisions.map((revision) => revision.changeSetId).filter(Boolean))];
  if (changeSetIds.length !== 1) return fail('persisted_cohort_split');
  const changeSet = repository.getChangeSet(changeSetIds[0]);
  if (!changeSet || changeSet.projectId !== projectId || isBaselineIntentRef(changeSet.intentRef)
      || !['preview_ready', 'adopted', 'reverted'].includes(changeSet.status)
      || (changeSet.status === 'adopted' && !changeSet.adoptedAt)
      || !changeSet.candidateCommit) {
    return fail('persisted_change_set_unqualified');
  }
  const cohortRevisions = repository.listRevisionsByChangeSet(changeSet.changeSetId);
  const cohortIds = cohortRevisions.map((revision) => revision.revisionId);
  if (!sameIdentifierSet(cohortIds, changeSet.candidateArtifactRefs) || cohortRevisions.length === 0) {
    return fail('persisted_cohort_incomplete');
  }
  const cohortJobIds = [...new Set(cohortRevisions.map((revision) => revision.toolJobId).filter(Boolean))];
  if (!sameIdentifierSet(cohortJobIds, changeSet.jobRefs)
      || cohortRevisions.some((revision) => revision.projectId !== projectId
        || revision.changeSetId !== changeSet.changeSetId
        || revision.sourceCommit !== changeSet.candidateCommit
        || revision.validationStatus === 'blocked')) {
    return fail('persisted_revision_unqualified');
  }
  const validationSummary = changeSet.validationSummary || {};
  const validatorIds = validationSummary.validatorIds;
  if (validationSummary.artifactTruthStatus !== 'valid'
      || validationSummary.formalArtifactCount !== cohortRevisions.length
      || !Array.isArray(validatorIds) || validatorIds.length === 0
      || new Set(validatorIds).size !== validatorIds.length
      || validatorIds.some((value) => !String(value || '').trim())
      || !validatorIds.includes(validatorId)) {
    return fail('persisted_validation_unqualified');
  }
  const graphRef = validationSummary.workflowGraph || null;
  if (!graphRef?.graphId || !/^[a-f0-9]{64}$/.test(String(graphRef.sourceDigest || ''))) {
    return fail('persisted_graph_unavailable');
  }
  let workflowGraph = null;
  try { workflowGraph = repository.getWorkflowGraph(graphRef.graphId); } catch { return fail('persisted_graph_unavailable'); }
  const verifyGraph = dependencies.verifyWorkflowGraphIntegrity || verifyWorkflowGraphIntegrity;
  const graphIntegrity = workflowGraph ? verifyGraph(workflowGraph) : { ok: false };
  if (!workflowGraph || !graphIntegrity.ok || workflowGraph.projectId !== projectId
      || workflowGraph.sourceDigest !== graphRef.sourceDigest
      || workflowGraph.validationStatus !== 'valid'
      || cohortRevisions.some((revision) => {
        const node = workflowGraph.nodes?.find((candidate) => candidate.toolJobId === revision.toolJobId);
        return !node || !node.artifactIds?.includes(revision.artifactId);
      })) {
    return fail('persisted_graph_unqualified');
  }
  for (let index = 0; index < formalArtifacts.length; index += 1) {
    const artifact = formalArtifacts[index];
    const revision = formalRevisions[index];
    if (revision.toolJobId !== sourceJobId || revision.artifactId !== artifact.artifactId
        || revision.outputHash !== artifact.sha256 || revision.changeSetId !== changeSet.changeSetId) {
      return fail('persisted_formal_artifact_mismatch');
    }
  }
  const revision = formalRevisions.find((candidate) => candidate.artifactId === requested) || null;
  if (!revision) return fail('requested_revision_missing');
  return {
    qualified: true,
    reason: null,
    revision,
    cohortRevisions,
    changeSet,
  };
}

function adoptBaselineChangeSet({
  repository,
  adapter,
  changeSetId,
  candidateCommit,
  afterRefsApplied = null,
}) {
  const changeSet = repository.getChangeSet(changeSetId);
  if (!changeSet) {
    throw new ResultChangeSetError('baseline_change_set_missing', 'Baseline ChangeSet is unavailable for adoption.');
  }
  if (changeSet.status === 'adopted') {
    return repository.adoptChangeSet({ changeSetId, candidateCommit });
  }
  const revisions = repository.listRevisionsByChangeSet(changeSetId);
  const expectedCommits = new Map(revisions.map((revision) => [
    revision.revisionId,
    repository.getCurrentRevision(revision.artifactFamilyId, revision.projectId)?.sourceCommit || null,
  ]));
  const refUpdates = revisions.map((revision) => {
    if (!revision.sourceCommit || revision.sourceCommit !== candidateCommit) {
      throw new ResultChangeSetError(
        'baseline_candidate_commit_mismatch',
        'Baseline Revision source commit does not match its candidate commit.',
      );
    }
    const ref = `refs/heads/petri/current/${revision.artifactFamilyId}`;
    const existing = adapter.revParse(ref);
    const expected = expectedCommits.get(revision.revisionId) || null;
    if ((existing && existing !== expected) || (!expected && existing)) {
      throw new ResultChangeSetError(
        'baseline_current_git_ref_stale',
        'Baseline current Git ref does not match the persisted Revision.',
        { artifactFamilyId: revision.artifactFamilyId },
      );
    }
    return { ref, expectedOld: existing || ZERO_OID, newOid: candidateCommit };
  });
  const affectedFamilies = new Set(revisions.map((revision) => revision.artifactFamilyId));
  const targetCurrentRevisionIds = [
    ...repository.listCurrentRevisions(changeSet.projectId)
      .filter((revision) => !affectedFamilies.has(revision.artifactFamilyId))
      .map((revision) => revision.revisionId),
    ...revisions.map((revision) => revision.revisionId),
  ].sort();
  executeDurableRefTransaction({
    operationId: id('rft'),
    projectId: changeSet.projectId,
    changeSetId,
    operationKind: 'baseline_adopt',
    sourceStatus: changeSet.status,
    targetStatus: 'adopted',
    refUpdates,
    targetRevisionIds: revisions.map((revision) => revision.revisionId),
    checkpoint: buildResultEditCheckpoint({
      repository,
      projectId: changeSet.projectId,
      conversationId: changeSet.conversationId,
      changeSet,
      candidateCommit,
      changeSetStatus: 'adopted',
      currentRevisionIds: targetCurrentRevisionIds,
      stage: 'adopted',
    }),
  }, { repository, adapter, afterRefsApplied });
  return {
    changeSet: repository.getChangeSet(changeSetId),
    adoptedRevisionIds: revisions.map((revision) => revision.revisionId),
    idempotent: false,
  }
}

/**
 * Register all descriptor-declared formal outputs from one completed Job in a
 * single baseline cohort.  The legacy single-artifact path remains available
 * for plugins without a trusted Result Studio descriptor, but admitted P5
 * plugins must never make a partial cohort look like a complete source.
 */
function ensureBaselineArtifactCohort(input = {}, dependencies = {}) {
  const descriptor = resolveCandidateDescriptor({
    dependencies,
    toolId: input.pluginId || input.sourceJob?.tool_id || input.sourceJob?.toolId,
  });
  if (!descriptor) return ensureBaselineArtifactRevision(input, dependencies);
  const repository = dependencies.repository;
  const adapter = dependencies.adapter;
  if (!repository || !adapter || typeof repository.appendRevisionBatch !== 'function') {
    throw new ResultChangeSetError('baseline_cohort_dependencies_missing', 'Baseline cohort registration requires the canonical Repository batch API.');
  }
  const projectId = String(input.projectId || '').trim();
  const workspaceRoot = path.resolve(input.workspaceRoot || '');
  const sourceJob = input.sourceJob;
  if (!projectId || !sourceJob || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
      || sourceJob.status !== 'completed') {
    throw new ResultChangeSetError('baseline_source_job_invalid', 'Baseline source must be a completed Job in the active project.');
  }
  const sourceResult = resultOf(sourceJob);
  const rawParams = sourceJob.params && typeof sourceJob.params === 'object' && !Array.isArray(sourceJob.params)
    ? sourceJob.params
    : (() => {
      try { return JSON.parse(sourceJob.params_json || '{}'); } catch { return {}; }
    })();
  const validation = validateResultStudioCandidate({
    descriptor,
    job: sourceJob,
    workspaceRoot,
    expectedScriptSha256: input.sourceScriptSha256,
    rawParams,
  });
  if (!validation.ok) {
    throw new ResultChangeSetError(
      'baseline_plugin_validation_failed',
      'The admitted source Job failed its Result Studio validator.',
      { validatorId: validation.validatorId, diagnostics: validation.diagnostics }
    );
  }
  const formalArtifacts = validation.formalArtifacts;
  const requested = String(input.artifactId || '').trim();
  if (!requested || !formalArtifacts.some((artifact) => artifact.artifactId === requested)) {
    throw new ResultChangeSetError('baseline_artifact_missing', 'Requested Artifact is not a descriptor-declared formal output.');
  }
  const cohortDigest = sha256(stableStringify(formalArtifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    sha256: artifact.sha256,
  })).sort((left, right) => left.artifactId.localeCompare(right.artifactId))));
  const existingById = new Map(formalArtifacts.map((artifact) => [
    artifact.artifactId,
    repository.findRevisionByJobArtifact({ projectId, toolJobId: sourceJob.id, artifactId: artifact.artifactId }),
  ]));
  const preferredChangeSetId = deterministicId('cs', 'baseline-cohort-v2', projectId, sourceJob.id, cohortDigest);
  const reusableChangeSetIds = [
    preferredChangeSetId,
    ...new Set([...existingById.values()].filter(Boolean).map((revision) => revision.changeSetId)),
  ];
  for (const existingChangeSetId of reusableChangeSetIds) {
    const reusable = resolveCompleteBaselineCohort({
      repository,
      changeSetId: existingChangeSetId,
      projectId,
      sourceJobId: sourceJob.id,
      formalArtifacts,
      validatorId: validation.validatorId,
    });
    if (reusable) {
      return {
        revision: reusable.revisions.find((revision) => revision.artifactId === requested),
        cohortRevisions: reusable.revisions,
        created: false,
        cohort: true,
      };
    }
  }

  const artifactFamilyIds = new Map(formalArtifacts.map((artifact) => [
    artifact.artifactId,
    deterministicId('af', projectId, sourceJob.id, artifact.artifactId),
  ]));
  const currentById = new Map(formalArtifacts.map((artifact) => [
    artifact.artifactId,
    repository.getCurrentRevision(artifactFamilyIds.get(artifact.artifactId), projectId),
  ]));
  const conflictingCurrent = formalArtifacts.find((artifact) => {
    const current = currentById.get(artifact.artifactId);
    return current && (current.toolJobId !== sourceJob.id
      || current.artifactId !== artifact.artifactId
      || current.outputHash !== artifact.sha256);
  });
  if (conflictingCurrent) {
    const current = currentById.get(conflictingCurrent.artifactId);
    throw new ResultChangeSetError(
      'baseline_cohort_current_conflict',
      'A different current Revision already owns a formal baseline Artifact family.',
      { artifactId: conflictingCurrent.artifactId, currentRevisionId: current.revisionId }
    );
  }

  let changeSetId = null;
  let changeSet = null;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidateId = attempt === 0
      ? preferredChangeSetId
      : deterministicId('cs', `baseline-cohort-v2-repair-${attempt}`, projectId, sourceJob.id, cohortDigest);
    const candidate = repository.getChangeSet(candidateId);
    if (!candidate) {
      changeSetId = candidateId;
      break;
    }
    const preview = resolveCompleteBaselineCohort({
      repository,
      changeSetId: candidateId,
      projectId,
      sourceJobId: sourceJob.id,
      formalArtifacts,
      validatorId: validation.validatorId,
      allowedStatuses: ['preview_ready'],
    });
    if (preview) {
      adoptBaselineChangeSet({
        repository,
        adapter,
        changeSetId: candidateId,
        candidateCommit: preview.changeSet.candidateCommit,
        afterRefsApplied: dependencies.afterRefsApplied,
      });
      const adopted = resolveCompleteBaselineCohort({
        repository,
        changeSetId: candidateId,
        projectId,
        sourceJobId: sourceJob.id,
        formalArtifacts,
        validatorId: validation.validatorId,
      });
      if (!adopted) {
        throw new ResultChangeSetError('baseline_cohort_incoherent', 'Recovered baseline preview did not adopt as one complete cohort.');
      }
      return {
        revision: adopted.revisions.find((revision) => revision.artifactId === requested),
        cohortRevisions: adopted.revisions,
        created: false,
        cohort: true,
      };
    }
    if (['draft', 'running'].includes(candidate.status)
        && repository.listRevisionsByChangeSet(candidateId).length === 0) {
      changeSetId = candidateId;
      changeSet = candidate;
      break;
    }
  }
  if (!changeSetId) {
    throw new ResultChangeSetError(
      'baseline_cohort_registration_exhausted',
      'Unable to allocate a coherent baseline cohort after prior incomplete registrations.'
    );
  }
  const workingBranchRef = `refs/heads/petri/baseline/${changeSetId}`;
  const baseCommit = resolveBaseCommit(adapter, projectId);
  let candidateCommit = adapter.revParse(workingBranchRef);
  const language = String(input.language || '').toLowerCase() === 'python' ? 'python' : 'r';
  const extension = language === 'python' ? 'py' : 'R';
  const sourceScriptContent = input.sourceScriptContent;
  if (typeof sourceScriptContent !== 'string' || sha256(sourceScriptContent) !== input.sourceScriptSha256) {
    throw new ResultChangeSetError('baseline_script_hash_mismatch', 'Baseline script snapshot is unavailable or changed.');
  }
  const inputArtifactRefs = (sourceResult.executionProvenance?.inputs || [])
    .filter((entry) => entry && (entry.sourceArtifactRef || entry.id))
    .map((entry) => ({ artifactId: entry.sourceArtifactRef || entry.id, hash: entry.sha256 || null, role: entry.role || null }));
  const parameters = sourceResult.executionProvenance?.params?.normalized;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new ResultChangeSetError('baseline_parameters_unavailable', 'Normalized execution parameters are required for a reproducible baseline.');
  }
  const parametersContent = stableJson(parameters);
  const parametersHash = sha256(parametersContent);
  const gitPathPrefix = String(dependencies.gitPathPrefix || '').replace(/^\/+|\/+$/g, '');
  const repositoryPath = (relativePath) => (
    gitPathPrefix ? path.posix.join(gitPathPrefix, relativePath) : relativePath
  );
  const cohortRows = formalArtifacts.map((artifact) => {
    const artifactFamilyId = artifactFamilyIds.get(artifact.artifactId);
    const revisionId = deterministicId('rev', 'baseline-cohort-v2', changeSetId, artifact.artifactId, artifact.sha256);
    const managedBase = path.posix.join('analysis/scripts', artifactFamilyId, revisionId);
    const scriptRelativePath = path.posix.join(managedBase, `${safeSegment(artifact.artifactId, 'artifact_id')}.${extension}`);
    const parametersRelativePath = path.posix.join(managedBase, 'parameters.json');
    const manifestRelativePath = path.posix.join(managedBase, 'materialization.json');
    const manifestContent = stableJson({
      resultStudioMaterializationVersion: 1,
      baseline: true,
      cohortDigest,
      changeSetId,
      revisionId,
      artifactFamilyId,
      artifactId: artifact.artifactId,
      pluginId: input.pluginId || sourceJob.tool_id,
      language,
      sourceToolJobId: sourceJob.id,
      scriptRelativePath,
      scriptSha256: input.sourceScriptSha256,
      parametersRelativePath,
      parametersSha256: parametersHash,
    });
    return {
      artifact,
      revisionId,
      artifactFamilyId,
      scriptRelativePath,
      parametersRelativePath,
      manifestRelativePath,
      parametersHash,
      manifestContent,
      revision: {
        revisionId,
        projectId,
        artifactFamilyId,
        artifactId: artifact.artifactId,
        parentRevisionIds: currentById.get(artifact.artifactId)
          ? [currentById.get(artifact.artifactId).revisionId]
          : [],
        sourceCommit: null,
        sourceScriptRef: {
          relativePath: scriptRelativePath,
          sha256: input.sourceScriptSha256,
          entryPoint: path.posix.basename(scriptRelativePath),
          artifactId: artifact.artifactId,
          rendererId: `${input.pluginId || sourceJob.tool_id}:${artifact.artifactId}`,
          language,
          origin: 'project_materialized',
        },
        inputArtifactRefs,
        parametersRef: parametersRelativePath,
        parametersHash,
        toolJobId: sourceJob.id,
        outputPath: projectRelativeOutput(workspaceRoot, artifact),
        outputHash: artifact.sha256,
        validationStatus: validation.validationStatus,
        reproducibilityStatus: 'available',
        changeSetId,
      },
    };
  });

  try {
    if (!changeSet) {
      const started = startResultEditChangeSet({ repository, stage: 'change_set', changeSet: {
        changeSetId,
        projectId,
        intentRef: `baseline:${sourceJob.id}:cohort`,
        baseCommit,
        workingBranchRef,
        createdBy: 'agent',
        parentArtifactRefs: [],
      } });
      changeSet = started.changeSet;
    } else if (changeSet.status === 'draft') {
      changeSet = transitionResultEditWithCheckpoint({
        repository, projectId, conversationId: null, changeSetId, to: 'running', stage: 'change_set',
      }).changeSet;
    }
    if (changeSet.status !== 'running') {
      throw new ResultChangeSetError('baseline_cohort_status_invalid', `Cannot complete baseline cohort from status ${changeSet.status}.`);
    }
    if (!candidateCommit) {
      const gitFiles = cohortRows.flatMap((row) => [
        { path: row.scriptRelativePath, content: sourceScriptContent },
        { path: row.parametersRelativePath, content: parametersContent },
        { path: row.manifestRelativePath, content: row.manifestContent },
      ]).map((file) => ({ ...file, path: repositoryPath(file.path) }));
      candidateCommit = adapter.commitVirtualFiles({
        parentCommit: baseCommit,
        ref: workingBranchRef,
        expectedOld: '0'.repeat(40),
        message: `Petri baseline cohort ${sourceJob.id}`,
        files: gitFiles,
      }).commit;
    }
    const revisionInputs = cohortRows.map((row) => ({ ...row.revision, sourceCommit: candidateCommit }));
    const graphBuilder = dependencies.buildCandidateWorkflowGraph || buildAuthoritativeWorkflowGraph;
    const resolvedWorkflowJobs = typeof dependencies.resolveWorkflowJobs === 'function'
      ? dependencies.resolveWorkflowJobs({ projectId, sourceJob })
      : [sourceJob];
    const workflowJobsById = new Map((Array.isArray(resolvedWorkflowJobs) ? resolvedWorkflowJobs : [])
      .filter((job) => job && typeof job === 'object')
      .map((job) => [String(job.id || '').trim(), job])
      .filter(([jobId]) => jobId));
    // The source Job was reloaded from canonical Job truth by the caller.  It
    // wins over any duplicate returned while resolving its immutable parents.
    workflowJobsById.set(sourceJob.id, sourceJob);
    const baselineGraphResult = graphBuilder({
      projectId,
      sourceToolJobId: sourceJob.id,
      jobs: [...workflowJobsById.values()],
      repository,
      requiredToolJobIds: [sourceJob.id],
      stagedRevisions: revisionInputs,
    });
    if (!baselineGraphResult || baselineGraphResult.ok !== true || !baselineGraphResult.graph) {
      throw new ResultChangeSetError(
        'baseline_workflow_graph_invalid',
        'Baseline Job could not be projected into one complete authoritative workflow graph.',
        { diagnostics: baselineGraphResult?.diagnostics || [] }
      );
    }
    const baselineWorkflowGraph = baselineGraphResult.graph;
    repository.appendRevisionBatch({
      revisions: revisionInputs,
      workflowGraph: baselineWorkflowGraph,
      transition: {
        changeSetId,
        to: 'preview_ready',
        candidateCommit,
        changedPaths: cohortRows.flatMap((row) => [
          { relativePath: row.scriptRelativePath, changeType: 'added', beforeHash: null, afterHash: input.sourceScriptSha256 },
          { relativePath: row.parametersRelativePath, changeType: 'added', beforeHash: null, afterHash: row.parametersHash },
          { relativePath: row.manifestRelativePath, changeType: 'added', beforeHash: null, afterHash: sha256(row.manifestContent) },
        ]),
        jobRefs: [sourceJob.id],
        candidateArtifactRefs: revisionInputs.map((row) => row.revisionId),
        validationSummary: {
          baseline: true,
          cohort: true,
          cohortDigest,
          formalArtifactIds: formalArtifacts.map((artifact) => artifact.artifactId),
          formalArtifactCount: formalArtifacts.length,
          formalArtifactCohort: revisionInputs.map((revision) => ({
            toolJobId: revision.toolJobId,
            artifactId: revision.artifactId,
            outputHash: revision.outputHash,
          })),
          validatorId: validation.validatorId,
          validatorIds: [validation.validatorId],
          artifactTruthStatus: 'valid',
          workflowGraph: {
            graphId: baselineWorkflowGraph.graphId,
            sourceDigest: baselineWorkflowGraph.sourceDigest,
          },
        },
      },
      beforeCommit: () => {
        saveResultEditCheckpoint({
          repository,
          projectId,
          conversationId: null,
          changeSetId,
          candidateCommit,
          stage: 'preview_ready',
          recovery: 'awaiting_user_decision',
        });
      },
    });
    if (repository.getChangeSet(changeSetId)?.status === 'preview_ready') {
      adoptBaselineChangeSet({
        repository,
        adapter,
        changeSetId,
        candidateCommit,
        afterRefsApplied: dependencies.afterRefsApplied,
      });
    }
    const complete = resolveCompleteBaselineCohort({
      repository,
      changeSetId,
      projectId,
      sourceJobId: sourceJob.id,
      formalArtifacts,
      validatorId: validation.validatorId,
    });
    if (!complete) {
      throw new ResultChangeSetError('baseline_cohort_incoherent', 'Baseline registration did not produce one complete adopted cohort.');
    }
    return {
      revision: complete.revisions.find((revision) => revision.artifactId === requested),
      cohortRevisions: complete.revisions,
      created: true,
      cohort: true,
    };
  } catch (error) {
    const current = repository.getChangeSet(changeSetId);
    if (current?.status === 'running') {
      try {
        transitionResultEditWithCheckpoint({
          repository,
          projectId,
          conversationId: null,
          changeSetId,
          to: 'validation_failed',
          stage: 'failed',
          recovery: error.code || 'baseline_cohort_failed',
          transition: {
            reason: error.code || 'baseline_cohort_failed',
            validationSummary: { error: error.code || 'baseline_cohort_failed' },
          },
        });
      } catch { /* recovery scan */ }
    }
    throw error;
  }
}

/**
 * 把一个已经完成且 Artifact Truth=valid 的普通 Job 登记成 lineage 的 v1。
 *
 * 这是 RS5 的生产入口：RS2 只有表和 Repository，RS3/RS4 若没有 v1 会一直
 * 得到 null revision。登记使用确定性 id，且每个 root Job/Artifact 拥有自己的
 * family；无法证明两个普通 Job 同源时绝不擅自把它们并入同一 lineage。
 */
function ensureBaselineArtifactRevision(input = {}, dependencies = {}) {
  const repository = dependencies.repository;
  const adapter = dependencies.adapter;
  if (!repository || !adapter) {
    throw new ResultChangeSetError('baseline_dependencies_missing', 'Baseline registration requires repository and Git adapter.');
  }
  const projectId = String(input.projectId || '').trim();
  const workspaceRoot = path.resolve(input.workspaceRoot || '');
  const sourceJob = input.sourceJob;
  const artifactId = String(input.artifactId || '').trim();
  if (!projectId || !sourceJob || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
    || sourceJob.status !== 'completed') {
    throw new ResultChangeSetError('baseline_source_job_invalid', 'Baseline source must be a completed Job in the active project.');
  }
  const existing = repository.findRevisionByJobArtifact({
    projectId,
    toolJobId: sourceJob.id,
    artifactId,
  });
  if (existing) return { revision: existing, created: false };

  const result = sourceJob.result || {};
  if (!result.artifactTruth || result.artifactTruth.status !== 'valid' || result.artifactTruth.blocking === true) {
    throw new ResultChangeSetError('baseline_artifact_truth_invalid', 'Only valid non-blocking Artifact Truth can become a baseline Revision.');
  }
  const artifact = exactArtifact(result, artifactId);
  if (!artifact) throw new ResultChangeSetError('baseline_artifact_missing', 'Baseline artifact id is not uniquely present.');
  const outputPath = projectRelativeOutput(workspaceRoot, artifact);
  const outputHash = hashFile(artifact.path);
  const provenanceArtifact = (result.executionProvenance?.artifacts || [])
    .find((entry) => entry && entry.id === artifactId);
  if (!outputHash || !provenanceArtifact || provenanceArtifact.sha256 !== outputHash) {
    throw new ResultChangeSetError('baseline_artifact_hash_mismatch', 'Baseline Artifact hash does not match execution provenance.');
  }

  const sourceScriptContent = input.sourceScriptContent;
  const sourceScriptSha256 = sha256(sourceScriptContent || '');
  if (typeof sourceScriptContent !== 'string' || !input.sourceScriptSha256
    || sourceScriptSha256 !== input.sourceScriptSha256
    || Buffer.byteLength(sourceScriptContent) > MAX_SCRIPT_BYTES) {
    throw new ResultChangeSetError('baseline_script_hash_mismatch', 'Baseline script snapshot is unavailable or changed.');
  }
  const pluginId = safeSegment(input.pluginId || sourceJob.tool_id || sourceJob.toolId, 'plugin_id');
  const language = String(input.language || '').toLowerCase() === 'python' ? 'python' : 'r';
  const extension = language === 'python' ? 'py' : 'R';
  const artifactFamilyId = deterministicId('af', projectId, sourceJob.id, artifactId);
  const revisionId = deterministicId('rev', projectId, sourceJob.id, artifactId, outputHash);
  const changeSetId = deterministicId('cs', 'baseline', projectId, sourceJob.id, artifactId, outputHash);
  const workingBranchRef = `refs/heads/petri/baseline/${changeSetId}`;
  const managedBase = path.posix.join('analysis/scripts', artifactFamilyId, revisionId);
  const scriptRelativePath = path.posix.join(managedBase, `${safeSegment(artifactId, 'artifact_id')}.${extension}`);
  const parametersRelativePath = path.posix.join(managedBase, 'parameters.json');
  const manifestRelativePath = path.posix.join(managedBase, 'materialization.json');
  const parameters = result.executionProvenance?.params?.normalized;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new ResultChangeSetError('baseline_parameters_unavailable', 'Normalized execution parameters are required for a reproducible baseline.');
  }
  const parametersContent = stableJson(parameters);
  if (Buffer.byteLength(parametersContent) > MAX_PARAMETERS_BYTES) {
    throw new ResultChangeSetError('baseline_parameters_too_large', 'Normalized baseline parameters exceed 1 MiB.');
  }
  const parametersHash = sha256(parametersContent);
  const rendererId = `${pluginId}:${artifactId}`;
  const manifestContent = stableJson({
    resultStudioMaterializationVersion: 1,
    baseline: true,
    changeSetId,
    revisionId,
    artifactFamilyId,
    artifactId,
    rendererId,
    pluginId,
    language,
    sourceToolJobId: sourceJob.id,
    scriptRelativePath,
    scriptSha256: sourceScriptSha256,
    parametersRelativePath,
    parametersSha256: parametersHash,
  });
  const baseCommit = resolveBaseCommit(adapter, projectId);
  let changeSet = repository.getChangeSet(changeSetId);
  let candidateCommit = adapter.revParse(workingBranchRef);
  try {
    if (!changeSet) {
      const started = startResultEditChangeSet({ repository, stage: 'change_set', changeSet: {
        changeSetId,
        projectId,
        intentRef: `baseline:${sourceJob.id}:${artifactId}`,
        baseCommit,
        workingBranchRef,
        createdBy: 'agent',
        parentArtifactRefs: [],
      } });
      changeSet = started.changeSet;
    } else if (changeSet.status === 'draft') {
      changeSet = transitionResultEditWithCheckpoint({
        repository, projectId, conversationId: null, changeSetId, to: 'running', stage: 'change_set',
      }).changeSet;
    }
    if (!candidateCommit) {
      const gitPathPrefix = String(dependencies.gitPathPrefix || '').replace(/^\/+|\/+$/g, '');
      const files = [
        { path: scriptRelativePath, content: sourceScriptContent },
        { path: parametersRelativePath, content: parametersContent },
        { path: manifestRelativePath, content: manifestContent },
      ].map((file) => ({
        ...file,
        path: gitPathPrefix ? path.posix.join(gitPathPrefix, file.path) : file.path,
      }));
      candidateCommit = adapter.commitVirtualFiles({
        parentCommit: baseCommit,
        ref: workingBranchRef,
        expectedOld: '0'.repeat(40),
        message: `Petri baseline ${sourceJob.id}: ${artifactId}`,
        files,
      }).commit;
    }
    const inputArtifactRefs = (result.executionProvenance?.inputs || [])
      .filter((entry) => entry && (entry.sourceArtifactRef || entry.id))
      .map((entry) => ({
        artifactId: entry.sourceArtifactRef || entry.id,
        hash: entry.sha256 || null,
        role: entry.role || null,
      }));
    const revisionInput = {
      revisionId,
      projectId,
      artifactFamilyId,
      artifactId,
      parentRevisionIds: [],
      sourceCommit: candidateCommit,
      sourceScriptRef: {
        relativePath: scriptRelativePath,
        sha256: sourceScriptSha256,
        entryPoint: path.posix.basename(scriptRelativePath),
        artifactId,
        rendererId,
        language,
        origin: 'project_materialized',
      },
      inputArtifactRefs,
      parametersRef: parametersRelativePath,
      parametersHash,
      toolJobId: sourceJob.id,
      outputPath,
      outputHash,
      validationStatus: result.artifactTruth.status,
      reproducibilityStatus: 'available',
      changeSetId,
    };
    const changedPaths = [
      { relativePath: scriptRelativePath, changeType: 'added', beforeHash: null, afterHash: sourceScriptSha256 },
      { relativePath: parametersRelativePath, changeType: 'added', beforeHash: null, afterHash: parametersHash },
      { relativePath: manifestRelativePath, changeType: 'added', beforeHash: null, afterHash: sha256(manifestContent) },
    ];
    const validationSummary = {
      artifactTruthStatus: 'valid',
      baseline: true,
      outputSha256: outputHash,
      formalArtifactCount: 1,
      formalArtifactCohort: [{ toolJobId: sourceJob.id, artifactId, outputHash }],
    };
    let revision = repository.getRevision(revisionId);
    changeSet = repository.getChangeSet(changeSetId);
    if (!revision) {
      const batch = repository.appendRevisionBatch({
        revisions: [revisionInput],
        transition: {
          changeSetId,
          to: 'preview_ready',
          candidateCommit,
          changedPaths,
          jobRefs: [sourceJob.id],
          candidateArtifactRefs: [revisionId],
          validationSummary,
        },
        beforeCommit: () => {
          saveResultEditCheckpoint({
            repository,
            projectId,
            conversationId: null,
            changeSetId,
            candidateCommit,
            stage: 'preview_ready',
            recovery: 'awaiting_user_decision',
          });
        },
      });
      revision = batch.revisions[0];
      changeSet = batch.changeSet;
    } else if (changeSet.status === 'running') {
      changeSet = transitionResultEditWithCheckpoint({
        repository,
        projectId,
        conversationId: null,
        changeSetId,
        to: 'preview_ready',
        candidateCommit,
        stage: 'preview_ready',
        recovery: 'awaiting_user_decision',
        transition: {
          changedPaths,
          jobRefs: [sourceJob.id],
          candidateArtifactRefs: [revisionId],
          validationSummary,
        },
      }).changeSet;
    }
    if (changeSet.status === 'preview_ready') {
      adoptBaselineChangeSet({
        repository,
        adapter,
        changeSetId,
        candidateCommit,
        afterRefsApplied: dependencies.afterRefsApplied,
      });
    }
    return { revision: repository.getRevision(revisionId), created: true };
  } catch (error) {
    const current = repository.getChangeSet(changeSetId);
    if (current && current.status === 'running') {
      try {
        transitionResultEditWithCheckpoint({
          repository,
          projectId,
          conversationId: null,
          changeSetId,
          to: 'validation_failed',
          stage: 'failed',
          recovery: error.code || 'baseline_registration_failed',
          transition: {
            reason: error.code || 'baseline_registration_failed',
            validationSummary: { error: error.code || 'baseline_registration_failed' },
          },
        });
      } catch { /* leave the durable running record for recovery */ }
    }
    throw error;
  }
}

module.exports = {
  ensureBaselineArtifactRevision,
  inspectBaselineArtifactCohort,
  inspectPersistedArtifactCohort,
  ensureBaselineArtifactCohort,
  adoptBaselineChangeSet,
  resolveExactFormalSourceRevision,
};
