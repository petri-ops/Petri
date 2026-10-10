'use strict';

const { getResultStudioRuntimeLease } = require('../result-studio-runtime-lease');
const { inspectPrivateDirectory, inspectPrivateEntry } = require('../result-studio-private-path');
const {
  ResultChangeSetError,
  resultChangeSetPrivatePathError,
  deterministicId,
  stableJson,
} = require('./internal');

function resolveBaseCommit(adapter, projectId) {
  const state = adapter.repositoryState();
  if (state.headCommit) return state.headCommit;
  const managedMain = adapter.revParse('refs/heads/petri/main');
  if (managedMain) return managedMain;
  return adapter.commitVirtualFiles({
    ref: 'refs/heads/petri/main',
    expectedOld: '0'.repeat(40),
    message: `Petri Result Studio baseline for ${projectId}`,
    files: [{
      path: 'analysis/workflows/result-studio-baseline.json',
      content: stableJson({ resultStudioBaselineVersion: 1, projectId }),
    }],
  }).commit;
}

function buildResultEditCheckpoint({
  repository,
  projectId,
  conversationId,
  changeSet,
  candidateCommit = null,
  changeSetStatus = null,
  currentRevisionIds: currentRevisionIdsOverride = null,
  stage,
  recovery = null,
}) {
  const revisionIds = repository.listRevisionsByChangeSet(changeSet.changeSetId).map((revision) => revision.revisionId);
  const currentRevisionIds = Array.isArray(currentRevisionIdsOverride)
    ? [...currentRevisionIdsOverride]
    : repository.listCurrentRevisions(projectId).map((revision) => revision.revisionId);
  return {
    checkpointId: deterministicId('rscp', projectId, conversationId || '', changeSet.changeSetId),
    projectId,
    conversationId: conversationId || null,
    baseCommit: changeSet.baseCommit,
    candidateCommit: candidateCommit || changeSet.candidateCommit || null,
    changeSetId: changeSet.changeSetId,
    changeSetStatus: changeSetStatus || changeSet.status,
    currentRevisionIds,
    pendingPreview: {
      stage,
      revisionIds,
      recovery,
      runtimeLease: getResultStudioRuntimeLease(),
    },
    jobRefs: changeSet.jobRefs,
  };
}

function startResultEditChangeSet({ repository, changeSet, stage, maxConcurrentPreviews = null }) {
  if (!repository || typeof repository.startChangeSetWithCheckpoint !== 'function') {
    throw new ResultChangeSetError('checkpoint_start_unavailable', 'Atomic ChangeSet start is unavailable.');
  }
  const checkpoint = buildResultEditCheckpoint({
    repository,
    projectId: changeSet.projectId,
    conversationId: changeSet.conversationId,
    changeSet: { ...changeSet, status: 'draft', candidateCommit: null, jobRefs: [] },
    changeSetStatus: 'running',
    stage,
  });
  return repository.startChangeSetWithCheckpoint({
    changeSet,
    checkpoint,
    previewSlot: Number.isInteger(maxConcurrentPreviews) && maxConcurrentPreviews > 0
      ? { projectId: changeSet.projectId, maxConcurrentPreviews }
      : null,
  });
}

function transitionResultEditWithCheckpoint({
  repository,
  projectId,
  conversationId,
  changeSetId,
  to,
  candidateCommit = null,
  stage,
  recovery = null,
  transition = {},
}) {
  const changeSet = repository.getChangeSet(changeSetId);
  if (!changeSet) return null;
  const targetCandidateCommit = candidateCommit || changeSet.candidateCommit || null;
  const checkpoint = buildResultEditCheckpoint({
    repository,
    projectId,
    conversationId,
    changeSet,
    candidateCommit: targetCandidateCommit,
    changeSetStatus: to,
    stage,
    recovery,
  });
  return repository.transitionChangeSetWithCheckpoint({
    transition: {
      ...transition,
      changeSetId,
      to,
      candidateCommit: targetCandidateCommit || undefined,
    },
    checkpoint,
  });
}

function saveResultEditCheckpoint({ repository, projectId, conversationId, changeSetId, candidateCommit = null, stage, recovery = null }) {
  if (!repository || typeof repository.saveCheckpoint !== 'function') return null;
  const changeSet = repository.getChangeSet(changeSetId);
  if (!changeSet) return null;
  return repository.saveCheckpoint(buildResultEditCheckpoint({
    repository,
    projectId,
    conversationId,
    changeSet,
    candidateCommit,
    stage,
    recovery,
  }));
}

function inspectResultEditRecovery({ repository, adapter, workspaceRoot, projectId } = {}) {
  if (!repository || !adapter || !workspaceRoot || !projectId) {
    throw new ResultChangeSetError('recovery_dependencies_missing', 'Recovery inspection requires repository, adapter, workspaceRoot and projectId.');
  }
  return repository.findInterruptedChangeSets(projectId).map((entry) => {
    const changeSet = entry.changeSet;
    const candidateCommit = adapter.revParse(changeSet.workingBranchRef);
    let materializationPresent = false;
    try {
      const components = ['.petri', 'revision', changeSet.changeSetId];
      if (inspectPrivateDirectory(workspaceRoot, components, { allowMissing: true })) {
        materializationPresent = inspectPrivateEntry(
          workspaceRoot,
          [...components, 'materialization.json'],
          { allowMissing: true, kind: 'file' },
        ) !== null;
      }
    } catch (error) {
      throw resultChangeSetPrivatePathError(error);
    }
    let recovery = entry.recovery;
    if (changeSet.status === 'running') {
      recovery = materializationPresent && candidateCommit
        ? 'resume_from_materialized_candidate'
        : 'restart_materialization_required';
    }
    return {
      changeSet,
      recovery,
      materializationPresent,
      candidateCommit,
      safeToAdopt: false,
    };
  });
}

module.exports = {
  resolveBaseCommit,
  buildResultEditCheckpoint,
  startResultEditChangeSet,
  transitionResultEditWithCheckpoint,
  saveResultEditCheckpoint,
  inspectResultEditRecovery,
};
