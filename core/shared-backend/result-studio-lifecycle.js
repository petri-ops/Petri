'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { assessCheckpointConsistency, isSafeRelativePath } = require('./result-studio-contracts');
const { isPathContained } = require('./project-run-layout');
const {
  getResultStudioRuntimeLease,
  isResultStudioRuntimeLease,
  isResultStudioRuntimeLeaseOwnerAlive,
} = require('./result-studio-runtime-lease');

const RESULT_STUDIO_LIFECYCLE_VERSION = 1;
const ZERO_OID = '0'.repeat(40);
const DEFAULT_GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const GC_SOURCE_REF_PREFIX = 'refs/heads/biof3/result-sources/';
const GC_CHANGESET_REF_PREFIX = 'refs/heads/biof3/changeset/';
const SAFE_CHANGESET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_STORAGE_FILES = 10000;
const MAX_TABLE_PAGE_ROWS = 200;
const MAX_TABLE_PAGE_BYTES = 1024 * 1024;
const DEFAULT_MAX_PREVIEW_MEMORY_BYTES = 4 * 1024 * 1024 * 1024;
const DARWIN_APFS_FS_TYPE = 26;
const INTERNAL_RECOVERY_ITEMS = Symbol('resultStudioRecoveryItems');

class ResultStudioLifecycleError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultStudioLifecycleError';
    this.code = code;
    this.detail = detail;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function expectedGcChangeSetRef(changeSetId) {
  const normalized = String(changeSetId || '').trim();
  return SAFE_CHANGESET_ID_PATTERN.test(normalized)
    ? `${GC_CHANGESET_REF_PREFIX}${normalized}`
    : null;
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let read;
    do {
      read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (read > 0) hash.update(buffer.subarray(0, read));
    } while (read > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function resolveWorkspaceFile(workspaceRoot, relativePath, { mustExist = true } = {}) {
  const root = fs.realpathSync(workspaceRoot);
  const target = path.resolve(root, String(relativePath || ''));
  if (!isPathContained(root, target)) throw new ResultStudioLifecycleError('path_escape', 'Result Studio path escaped the project workspace.');
  if (mustExist && !fs.existsSync(target)) throw new ResultStudioLifecycleError('file_missing', 'Result Studio file is missing.');
  if (!mustExist) return target;
  const real = fs.realpathSync(target);
  if (!isPathContained(root, real)) throw new ResultStudioLifecycleError('symlink_escape', 'Result Studio file resolves outside the project workspace.');
  return real;
}

function inspectRevisionIntegrity({ repository, adapter, workspaceRoot, projectId }) {
  const revisions = typeof repository.listAllProjectRevisions === 'function'
    ? repository.listAllProjectRevisions(projectId)
    : repository.listProjectRevisions(projectId);
  const issues = [];
  const expectedRevisionCount = typeof repository.countProjectRevisions === 'function'
    ? repository.countProjectRevisions(projectId)
    : revisions.length;
  if (!Number.isInteger(expectedRevisionCount)
      || expectedRevisionCount < 0
      || expectedRevisionCount !== revisions.length) {
    issues.push({
      revisionId: null,
      kind: 'revision_inventory_incomplete',
      blocking: true,
      expectedRevisionCount: Number.isInteger(expectedRevisionCount) ? expectedRevisionCount : null,
      inspectedRevisionCount: revisions.length,
    });
  }

  // 两次常量开销的子进程，替代每 revision 一到两次 revParse。
  // 逐个解析时实测约 20ms/revision，使该函数随项目历史线性增长并在约
  // 10 个 revision 处撞破 250ms 事件循环预算；上限是 5000 个 revision
  // （result-studio-repository.js:413-414），最坏情况约一万次 fork。
  const sourceCommits = adapter.resolveManyRefs(
    revisions.map((revision) => revision.sourceCommit).filter(Boolean),
  );
  const currentRefs = adapter.listRefs('refs/heads/biof3/current/');

  for (const revision of revisions) {
    let actualHash = null;
    try { actualHash = hashFile(resolveWorkspaceFile(workspaceRoot, revision.outputPath)); } catch (error) {
      issues.push({ revisionId: revision.revisionId, kind: 'artifact_missing', blocking: true });
      continue;
    }
    if (!revision.outputHash || actualHash !== revision.outputHash) {
      issues.push({ revisionId: revision.revisionId, kind: 'artifact_hash_drift', blocking: true });
    }
    if (revision.sourceCommit && !sourceCommits.get(revision.sourceCommit)) {
      issues.push({ revisionId: revision.revisionId, kind: 'source_commit_missing', blocking: true });
    }
    if (revision.isCurrent) {
      const ref = `refs/heads/biof3/current/${revision.artifactFamilyId}`;
      // listRefs 只返回存在的 ref；缺失即为 null，与 revParse 语义一致。
      const actual = currentRefs.get(ref) || null;
      if (actual !== revision.sourceCommit) {
        issues.push({ revisionId: revision.revisionId, kind: actual ? 'current_ref_drift' : 'current_ref_missing', blocking: !!actual, recoverable: !actual, ref });
      }
    }
  }
  return {
    revisionCount: Number.isInteger(expectedRevisionCount) && expectedRevisionCount >= 0
      ? expectedRevisionCount
      : revisions.length,
    inspectedRevisionCount: revisions.length,
    issues,
    intact: issues.length === 0,
  };
}

function sameStringSet(left, right) {
  const a = [...new Set((left || []).filter(Boolean))].sort();
  const b = [...new Set((right || []).filter(Boolean))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isStaleRuntimeCheckpoint(checkpoint, runtimeLease) {
  if (!checkpoint || !isResultStudioRuntimeLease(runtimeLease)) return false;
  const checkpointLease = checkpoint.pendingPreview?.runtimeLease;
  if (isResultStudioRuntimeLease(checkpointLease)
      && checkpointLease.instanceId === runtimeLease.instanceId) return false;
  if (isResultStudioRuntimeLease(checkpointLease)) {
    const ownerAlive = isResultStudioRuntimeLeaseOwnerAlive(checkpointLease);
    if (ownerAlive === true) return false;
    if (ownerAlive === false) return true;
  }
  const checkpointTime = Date.parse(checkpoint.updatedAt || '');
  const runtimeStart = Date.parse(runtimeLease.startedAt || '');
  return Number.isFinite(checkpointTime) && Number.isFinite(runtimeStart) && checkpointTime < runtimeStart;
}

function runtimeCheckpointOwnership(checkpoint, runtimeLease) {
  if (!checkpoint) return 'missing';
  if (!isResultStudioRuntimeLease(runtimeLease)) return 'unproven';
  const checkpointLease = checkpoint.pendingPreview?.runtimeLease;
  if (isResultStudioRuntimeLease(checkpointLease)) {
    if (checkpointLease.instanceId === runtimeLease.instanceId) return 'current';
    return isStaleRuntimeCheckpoint(checkpoint, runtimeLease) ? 'stale' : 'external';
  }
  return isStaleRuntimeCheckpoint(checkpoint, runtimeLease) ? 'stale' : 'unproven';
}

function revisionGitPath(relativePath, gitPathPrefix = '') {
  if (!isSafeRelativePath(relativePath)) return null;
  const prefix = String(gitPathPrefix || '').replace(/^\/+|\/+$/g, '');
  return prefix ? path.posix.join(prefix, relativePath) : relativePath;
}

function sourceMaterialProvesRevision(adapter, revision, gitPathPrefix = '') {
  const sourceRef = revision.sourceScriptRef;
  const sourcePath = revisionGitPath(sourceRef?.relativePath, gitPathPrefix);
  const parametersPath = revisionGitPath(revision.parametersRef, gitPathPrefix);
  if (!sourcePath || !sourceRef?.sha256 || sourceRef.artifactId !== revision.artifactId
      || !parametersPath || !revision.parametersHash) return false;
  try {
    const source = adapter.showFile({ ref: revision.sourceCommit, filePath: sourcePath });
    const parameters = adapter.showFile({ ref: revision.sourceCommit, filePath: parametersPath });
    return typeof source === 'string'
      && typeof parameters === 'string'
      && sha256(source) === sourceRef.sha256
      && sha256(parameters) === revision.parametersHash;
  } catch {
    return false;
  }
}

function formalCohortMatches(revisions, validationSummary) {
  const actual = revisions.map((revision) => ({
    toolJobId: revision.toolJobId,
    artifactId: revision.artifactId,
    outputHash: revision.outputHash,
  })).sort((left, right) => `${left.toolJobId}\0${left.artifactId}`.localeCompare(`${right.toolJobId}\0${right.artifactId}`));
  const declared = Array.isArray(validationSummary?.formalArtifactCohort)
    ? validationSummary.formalArtifactCohort.map((entry) => ({
      toolJobId: entry?.toolJobId,
      artifactId: entry?.artifactId,
      outputHash: entry?.outputHash,
    })).sort((left, right) => `${left.toolJobId}\0${left.artifactId}`.localeCompare(`${right.toolJobId}\0${right.artifactId}`))
    : [];
  return actual.length > 0 && actual.length === declared.length
    && actual.every((entry, index) => entry.toolJobId === declared[index].toolJobId
      && entry.artifactId === declared[index].artifactId
      && entry.outputHash === declared[index].outputHash);
}

function jobProvesRevision(job, revision, projectId) {
  if (!job || !['completed', 'done'].includes(String(job.status || '').toLowerCase())
      || String(job.id || '') !== revision.toolJobId
      || String(job.project_id || job.projectId || '') !== projectId
      || job.result?.artifactTruth?.status !== 'valid'
      || job.result?.artifactTruth?.blocking === true) return false;
  const executionProvenance = job.result?.executionProvenance;
  if (executionProvenance?.toolJobId !== revision.toolJobId
      || String(executionProvenance?.projectId || '') !== projectId
      || executionProvenance?.script?.sha256 !== revision.sourceScriptRef?.sha256) return false;
  const artifacts = (job.result?.artifacts || []).filter((item) => item?.id === revision.artifactId);
  const provenance = (executionProvenance?.artifacts || [])
    .filter((item) => item?.id === revision.artifactId);
  return artifacts.length === 1
    && provenance.length === 1
    && artifacts[0].sha256 === revision.outputHash
    && provenance[0].sha256 === revision.outputHash;
}

function qualifyPendingPreview({ item, revisions, candidateCommit, projectId, getToolJob, adapter, gitPathPrefix }) {
  const revisionIds = revisions.map((revision) => revision.revisionId);
  const jobIds = revisions.map((revision) => revision.toolJobId);
  const reasons = [];
  if (!candidateCommit || candidateCommit !== item.candidateCommit) reasons.push('candidate_ref_incomplete');
  if (revisions.length === 0 || !sameStringSet(revisionIds, item.candidateArtifactRefs)) reasons.push('revision_cohort_incomplete');
  if (revisions.some((revision) => revision.sourceCommit !== candidateCommit)) reasons.push('revision_source_commit_incomplete');
  if (!sameStringSet(jobIds, item.jobRefs)) reasons.push('job_cohort_incomplete');
  if (Number(item.validationSummary?.formalArtifactCount) !== revisions.length) reasons.push('formal_artifact_count_incomplete');
  if (!formalCohortMatches(revisions, item.validationSummary)) reasons.push('formal_artifact_cohort_incomplete');
  if (revisions.some((revision) => revision.validationStatus !== 'valid')) reasons.push('revision_validation_incomplete');
  if (revisions.some((revision) => !sourceMaterialProvesRevision(adapter, revision, gitPathPrefix))) {
    reasons.push('revision_source_material_incomplete');
  }
  if (typeof getToolJob !== 'function'
      || revisions.some((revision) => !jobProvesRevision(getToolJob(revision.toolJobId), revision, projectId))) {
    reasons.push('job_artifact_truth_incomplete');
  }
  return { qualified: reasons.length === 0, reasons };
}

function qualifyRunningRecovery({ item, revisions, candidateCommit, checkpoint, projectId, getToolJob, adapter, gitPathPrefix }) {
  if (revisions.length === 0) {
    return { complete: false, contradictory: false, reasons: ['candidate_revision_absent'] };
  }
  const revisionIds = revisions.map((revision) => revision.revisionId);
  const jobIds = [...new Set(revisions.map((revision) => revision.toolJobId))];
  const reasons = [];
  if (!candidateCommit) reasons.push('recovery_candidate_ref_missing');
  if (!checkpoint?.candidateCommit || checkpoint.candidateCommit !== candidateCommit) reasons.push('recovery_candidate_checkpoint_drift');
  if (item.candidateCommit && item.candidateCommit !== candidateCommit) reasons.push('recovery_candidate_change_set_drift');
  if (!sameStringSet(checkpoint?.pendingPreview?.revisionIds, revisionIds)) reasons.push('recovery_revision_cohort_drift');
  if (!sameStringSet(checkpoint?.jobRefs, jobIds)) reasons.push('recovery_job_cohort_drift');
  if (revisions.some((revision) => revision.sourceCommit !== candidateCommit)) reasons.push('recovery_revision_source_drift');
  if (revisions.some((revision) => revision.validationStatus !== 'valid')) reasons.push('recovery_revision_validation_drift');
  if (revisions.some((revision) => !sourceMaterialProvesRevision(adapter, revision, gitPathPrefix))) {
    reasons.push('recovery_revision_source_material_drift');
  }
  if (typeof getToolJob !== 'function'
      || revisions.some((revision) => !jobProvesRevision(getToolJob(revision.toolJobId), revision, projectId))) {
    reasons.push('recovery_job_artifact_truth_drift');
  }
  return { complete: reasons.length === 0, contradictory: reasons.length > 0, reasons };
}

function checkpointMatchesPreview({ checkpoint, item, revisionIds }) {
  return checkpoint?.changeSetStatus === 'preview_ready'
    && checkpoint.candidateCommit === item.candidateCommit
    && checkpoint.pendingPreview?.stage === 'preview_ready'
    && sameStringSet(checkpoint.pendingPreview?.revisionIds, revisionIds)
    && sameStringSet(checkpoint.jobRefs, item.jobRefs);
}

function publicCheckpointProjection(checkpoint) {
  if (!checkpoint) return null;
  return {
    changeSetStatus: checkpoint.changeSetStatus,
    pendingPreview: checkpoint.pendingPreview ? {
      stage: checkpoint.pendingPreview.stage || null,
      recovery: checkpoint.pendingPreview.recovery || null,
      revisionCount: Array.isArray(checkpoint.pendingPreview.revisionIds)
        ? checkpoint.pendingPreview.revisionIds.length
        : 0,
    } : null,
    updatedAt: checkpoint.updatedAt,
  };
}

function inspectResultStudioWorkspace({
  repository,
  adapter,
  workspaceRoot,
  projectId,
  conversationId = null,
  runtimeLease = getResultStudioRuntimeLease(),
  getToolJob = null,
  gitPathPrefix = '',
} = {}) {
  if (!repository || !adapter || !workspaceRoot || !projectId) {
    throw new ResultStudioLifecycleError('lifecycle_dependencies_missing', 'Repository, adapter, workspace and project are required.');
  }
  const checkpoint = repository.getLatestCheckpoint({ projectId, conversationId });
  const checkpointIntegrity = checkpoint
    ? repository.verifyCheckpointIntegrity(checkpoint.checkpointId)
    : { status: 'unavailable', matches: false };
  const changeSet = checkpoint?.changeSetId ? repository.getChangeSet(checkpoint.changeSetId) : null;
  const candidateRef = changeSet ? adapter.revParse(changeSet.workingBranchRef) : null;
  const currentRevisionIds = repository.listCurrentRevisions(projectId).map((revision) => revision.revisionId);
  const consistency = checkpointIntegrity.matches
    ? assessCheckpointConsistency({
      checkpoint,
      gitHeadCommit: candidateRef,
      changeSetStatus: changeSet?.status || null,
      currentRevisionIds,
    })
    : { status: checkpoint ? 'checkpoint_corrupt' : 'unavailable', drift: [], recoverable: false };
  const revisionIntegrity = inspectRevisionIntegrity({ repository, adapter, workspaceRoot, projectId });
  const checkpointByChangeSet = new Map();
  for (const item of repository.listProjectCheckpoints(projectId)) {
    if (item.changeSetId && !checkpointByChangeSet.has(item.changeSetId)) {
      checkpointByChangeSet.set(item.changeSetId, item);
    }
  }
  const pending = repository.findInterruptedChangeSets(projectId).map(({ changeSet: item, recovery }) => {
    const itemCheckpoint = checkpointByChangeSet.get(item.changeSetId) || null;
    const revisions = repository.listRevisionsByChangeSet(item.changeSetId);
    const revisionIds = revisions.map((revision) => revision.revisionId);
    const candidateCommit = adapter.revParse(item.workingBranchRef);
    const runtimeOwnership = runtimeCheckpointOwnership(itemCheckpoint, runtimeLease);
    const staleRuntime = runtimeOwnership === 'stale';
    const itemCheckpointIntegrity = itemCheckpoint
      ? repository.verifyCheckpointIntegrity(itemCheckpoint.checkpointId)
      : { status: 'unavailable', matches: false };
    const previewQualification = item.status === 'preview_ready'
      ? qualifyPendingPreview({ item, revisions, candidateCommit, projectId, getToolJob, adapter, gitPathPrefix })
      : null;
    const runningQualification = item.status === 'running'
      ? qualifyRunningRecovery({ item, revisions, candidateCommit, checkpoint: itemCheckpoint, projectId, getToolJob, adapter, gitPathPrefix })
      : null;
    const itemConsistency = itemCheckpointIntegrity.matches
      ? assessCheckpointConsistency({
        checkpoint: itemCheckpoint,
        gitHeadCommit: candidateCommit,
        changeSetStatus: item.status,
        currentRevisionIds,
      })
      : { status: itemCheckpoint ? 'checkpoint_corrupt' : 'unavailable', drift: [], recoverable: false };
    const previewCheckpointComplete = item.status === 'preview_ready'
      && checkpointMatchesPreview({ checkpoint: itemCheckpoint, item, revisionIds });
    const previewNeedsCheckpointReconciliation = item.status === 'preview_ready'
      && previewQualification.qualified
      && itemCheckpointIntegrity.matches
      && staleRuntime
      && !previewCheckpointComplete;
    return {
      changeSetId: item.changeSetId,
      status: item.status,
      recovery,
      candidateCommit,
      revisionIds,
      checkpointStage: itemCheckpoint?.pendingPreview?.stage || null,
      preservedRevisionCount: revisionIds.length,
      staleRuntime,
      runtimeOwnership,
      checkpoint: itemCheckpoint,
      checkpointIntegrity: itemCheckpointIntegrity,
      checkpointConsistency: itemConsistency,
      previewQualification,
      runningQualification,
      previewCheckpointComplete,
      previewNeedsCheckpointReconciliation,
    };
  });
  // A valid preview is durable product state awaiting an explicit user choice,
  // not a crash interruption. Mixing these states left the recovery button
  // permanently visible even after a successful repair.
  const interrupted = pending.filter((item) => (
    item.status !== 'preview_ready' && item.staleRuntime
  ) || item.previewNeedsCheckpointReconciliation);
  const activeOperations = pending.filter((item) => (
    item.status !== 'preview_ready' && ['current', 'external'].includes(item.runtimeOwnership)
  ) || (
    item.status === 'preview_ready'
      && item.previewQualification.qualified
      && item.checkpointIntegrity.matches
      && !item.previewCheckpointComplete
      && !item.staleRuntime
  ));
  const pendingDecisions = pending.filter((item) => item.status === 'preview_ready'
    && item.previewQualification.qualified
    && item.previewCheckpointComplete);
  const pendingIssues = pending
    .filter((item) => item.status === 'preview_ready' && !item.previewQualification.qualified)
    .flatMap((item) => item.previewQualification.reasons.map((kind) => ({ kind })));
  for (const item of pending) {
    if (!item.checkpointIntegrity.matches) {
      pendingIssues.push({
        kind: item.checkpoint
          ? item.status === 'preview_ready' ? 'preview_checkpoint_corrupt' : 'recovery_checkpoint_corrupt'
          : item.status === 'preview_ready' ? 'preview_checkpoint_missing' : 'recovery_checkpoint_missing',
      });
    }
    if (item.checkpointIntegrity.matches && item.runtimeOwnership === 'unproven') {
      pendingIssues.push({ kind: 'recovery_runtime_ownership_unproven' });
    }
    const dangerousCheckpointDrift = item.checkpointConsistency?.drift?.some(
      (drift) => drift.kind === 'git_commit_drift' || drift.kind === 'revision_set_drift'
    );
    if (dangerousCheckpointDrift) pendingIssues.push({ kind: 'recovery_checkpoint_state_drift' });
    if (item.status === 'running' && item.staleRuntime && item.runningQualification?.contradictory) {
      pendingIssues.push(...item.runningQualification.reasons.map((kind) => ({ kind })));
    }
  }
  const uniquePendingIssues = [...new Map(pendingIssues.map((issue) => [issue.kind, issue])).values()];
  const blocked = consistency.status === 'partial_adopt_detected' || consistency.status === 'checkpoint_corrupt'
    || revisionIntegrity.issues.some((issue) => issue.blocking)
    || uniquePendingIssues.length > 0;
  const projectPending = (items) => items.map((item) => ({
    status: item.status,
    recovery: item.recovery,
    checkpointStage: item.checkpointStage,
    preservedRevisionCount: item.preservedRevisionCount,
  }));
  const report = {
    lifecycleVersion: RESULT_STUDIO_LIFECYCLE_VERSION,
    projectId,
    checkpoint: publicCheckpointProjection(checkpoint),
    checkpointIntegrity: { status: checkpointIntegrity.status, matches: checkpointIntegrity.matches },
    consistency: {
      status: consistency.status,
      recoverable: consistency.recoverable,
      drift: (consistency.drift || []).map((item) => ({ kind: item.kind })),
    },
    revisionIntegrity: {
      revisionCount: revisionIntegrity.revisionCount,
      intact: revisionIntegrity.intact,
      issues: revisionIntegrity.issues.map((item) => ({
        kind: item.kind,
        blocking: item.blocking === true,
        recoverable: item.recoverable === true,
      })),
    },
    interrupted: projectPending(interrupted),
    activeOperations: projectPending(activeOperations),
    pendingDecisions: projectPending(pendingDecisions),
    pendingIssues: uniquePendingIssues,
    status: blocked ? 'blocked' : interrupted.length > 0 || revisionIntegrity.issues.some((issue) => issue.recoverable) ? 'recovery_available' : 'ready',
  };
  Object.defineProperty(report, INTERNAL_RECOVERY_ITEMS, { value: pending });
  return report;
}

function applyRecoveredTransition({ repository, input, interrupted, changeSet, transition, stage, recovery, revisionIds = [] }) {
  const checkpoint = interrupted.checkpoint
    || repository.listProjectCheckpoints(input.projectId).find((item) => item.changeSetId === changeSet.changeSetId);
  if (!checkpoint || !interrupted.checkpointIntegrity?.matches) {
    throw new ResultStudioLifecycleError('recovery_checkpoint_unavailable', 'Recovery checkpoint is unavailable or corrupt.');
  }
  const candidateCommit = transition.candidateCommit === undefined
    ? changeSet.candidateCommit
    : transition.candidateCommit;
  const jobRefs = transition.jobRefs === undefined ? changeSet.jobRefs : transition.jobRefs;
  return repository.applyRecoveryTransition({
    transition,
    expectedChangeSetStatus: changeSet.status,
    expectedCheckpointHash: checkpoint.checkpointHash,
    checkpoint: {
      checkpointId: checkpoint.checkpointId,
      projectId: input.projectId,
      conversationId: checkpoint.conversationId || input.conversationId || null,
      baseCommit: changeSet.baseCommit,
      candidateCommit: candidateCommit || null,
      changeSetId: changeSet.changeSetId,
      changeSetStatus: transition.to,
      currentRevisionIds: repository.listCurrentRevisions(input.projectId).map((revision) => revision.revisionId),
      selectionId: checkpoint.selectionId || null,
      pendingPreview: {
        stage,
        recovery,
        revisionIds,
        runtimeLease: input.runtimeLease,
      },
      jobRefs,
      loopRefs: checkpoint.loopRefs,
    },
  });
}

function recoverResultStudioWorkspace(input = {}, dependencies = {}) {
  const { repository, adapter, getToolJob } = dependencies;
  const runtimeLease = isResultStudioRuntimeLease(input.runtimeLease)
    ? input.runtimeLease
    : getResultStudioRuntimeLease();
  const recoveryInput = { ...input, runtimeLease };
  const before = inspectResultStudioWorkspace({ ...recoveryInput, repository, adapter, getToolJob });
  if (before.status === 'blocked') return { recovered: false, repaired: [], before, after: before };
  const repaired = [];
  const interruptedItems = (before[INTERNAL_RECOVERY_ITEMS] || []).filter((item) => (
    item.status !== 'preview_ready' && item.staleRuntime
  ) || item.previewNeedsCheckpointReconciliation);

  for (const interrupted of interruptedItems) {
    const changeSet = repository.getChangeSet(interrupted.changeSetId);
    if (!changeSet) continue;
    if (interrupted.status === 'preview_ready') {
      const revisions = repository.listRevisionsByChangeSet(interrupted.changeSetId);
      applyRecoveredTransition({
        repository, input: recoveryInput,
        interrupted,
        changeSet,
        transition: { changeSetId: changeSet.changeSetId, to: 'preview_ready' },
        stage: 'preview_ready',
        recovery: 'awaiting_user_decision',
        revisionIds: revisions.map((revision) => revision.revisionId),
      });
      repaired.push({ repair: 'preview_checkpoint_reconciled' });
      continue;
    }
    if (interrupted.status === 'draft') {
      const transition = {
        changeSetId: changeSet.changeSetId,
        to: 'abandoned',
        reason: 'restart_before_execution',
        candidateCommit: interrupted.candidateCommit || undefined,
        validationSummary: {
          recovery: 'draft_closed_after_restart',
          checkpointStage: interrupted.checkpointStage,
          preservedRevisionCount: interrupted.preservedRevisionCount,
        },
      };
      applyRecoveredTransition({
        repository, input: recoveryInput,
        interrupted,
        changeSet,
        transition,
        stage: 'abandoned',
        recovery: 'draft_closed_after_restart',
      });
      repaired.push({ repair: 'draft_to_abandoned' });
      continue;
    }
    if (interrupted.status !== 'running') continue;
    const revisions = repository.listRevisionsByChangeSet(interrupted.changeSetId);
    const previewComplete = interrupted.runningQualification?.complete === true;
    if (previewComplete) {
      const transition = {
        changeSetId: changeSet.changeSetId,
        to: 'preview_ready',
        candidateCommit: interrupted.candidateCommit,
        jobRefs: [...new Set(revisions.map((revision) => revision.toolJobId))],
        candidateArtifactRefs: revisions.map((revision) => revision.revisionId),
        validationSummary: {
          recoveredAfterRestart: true,
          artifactTruthStatus: 'valid',
          formalArtifactCount: revisions.length,
          formalArtifactCohort: revisions.map((revision) => ({
            toolJobId: revision.toolJobId,
            artifactId: revision.artifactId,
            outputHash: revision.outputHash,
          })),
        },
      };
      applyRecoveredTransition({
        repository, input: recoveryInput,
        interrupted,
        changeSet,
        transition,
        stage: 'preview_ready',
        recovery: 'awaiting_user_decision',
        revisionIds: revisions.map((revision) => revision.revisionId),
      });
      repaired.push({ repair: 'running_to_preview_ready' });
      continue;
    }
    const transition = {
      changeSetId: changeSet.changeSetId,
      to: 'validation_failed',
      reason: 'restart_without_complete_preview',
      candidateCommit: interrupted.candidateCommit || undefined,
      validationSummary: {
        recovery: 'incomplete_attempt_closed_after_restart',
        checkpointStage: interrupted.checkpointStage,
        preservedRevisionCount: revisions.length,
        candidateCommitPresent: !!interrupted.candidateCommit,
        checkpointCohortComplete: false,
        completedArtifactTruth: false,
      },
    };
    applyRecoveredTransition({
      repository, input: recoveryInput,
      interrupted,
      changeSet,
      transition,
      stage: 'failed',
      recovery: 'incomplete_attempt_closed_after_restart',
      revisionIds: revisions.map((revision) => revision.revisionId),
    });
    repaired.push({ repair: 'running_to_validation_failed' });
  }

  for (const revision of repository.listCurrentRevisions(input.projectId)) {
    const ref = `refs/heads/biof3/current/${revision.artifactFamilyId}`;
    if (!adapter.revParse(ref) && revision.sourceCommit && adapter.revParse(revision.sourceCommit)) {
      adapter.updateRefCas({ ref, newCommit: revision.sourceCommit, expectedOld: ZERO_OID });
      repaired.push({ repair: 'restored_missing_current_ref' });
    }
  }
  const after = inspectResultStudioWorkspace({ ...recoveryInput, repository, adapter, getToolJob });
  return { recovered: repaired.length > 0, repaired, before, after };
}

function walkSize(root, maxFiles = MAX_STORAGE_FILES) {
  if (!fs.existsSync(root)) return { bytes: 0, files: 0, truncated: false };
  const stack = [root];
  let bytes = 0;
  let files = 0;
  while (stack.length > 0 && files < maxFiles) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) { bytes += fs.statSync(full).size; files += 1; }
      if (files >= maxFiles) break;
    }
  }
  return { bytes, files, truncated: stack.length > 0 || files >= maxFiles };
}

function inspectResultStudioStorage({ repository, workspaceRoot, projectId } = {}) {
  if (!repository || !workspaceRoot || !projectId) throw new ResultStudioLifecycleError('storage_dependencies_missing', 'Repository, workspace and project are required.');
  const revisions = repository.listProjectRevisions(projectId);
  const groups = new Map();
  let logicalArtifactBytes = 0;
  for (const revision of revisions) {
    try {
      const file = resolveWorkspaceFile(workspaceRoot, revision.outputPath);
      const stat = fs.statSync(file);
      const digest = revision.outputHash || hashFile(file);
      logicalArtifactBytes += stat.size;
      const group = groups.get(digest) || { sha256: digest, bytes: stat.size, revisionIds: [], paths: [] };
      group.revisionIds.push(revision.revisionId);
      group.paths.push(revision.outputPath);
      groups.set(digest, group);
    } catch { /* integrity report owns missing files */ }
  }
  const duplicateGroups = [...groups.values()].filter((group) => group.paths.length > 1);
  const uniqueArtifactBytes = [...groups.values()].reduce((sum, group) => sum + group.bytes, 0);
  const privateStorage = walkSize(path.join(path.resolve(workspaceRoot), '.biof3', 'revision'));
  return {
    storageSummaryVersion: 1,
    revisionCount: revisions.length,
    contentObjectCount: groups.size,
    logicalArtifactBytes,
    uniqueArtifactBytes,
    deduplicableBytes: Math.max(0, logicalArtifactBytes - uniqueArtifactBytes),
    duplicateGroupCount: duplicateGroups.length,
    duplicateGroups: duplicateGroups.slice(0, 100).map((group) => ({ sha256: group.sha256, bytes: group.bytes, revisionCount: group.revisionIds.length })),
    privateStorage,
    gitTextStorage: 'git_object_database_content_addressed',
  };
}

function planArtifactDeduplication(input = {}, dependencies = {}) {
  const summary = inspectResultStudioStorage({ repository: dependencies.repository, workspaceRoot: input.workspaceRoot, projectId: input.projectId });
  const revisions = dependencies.repository.listProjectRevisions(input.projectId);
  const byHash = new Map();
  for (const revision of revisions) {
    if (!revision.outputHash) continue;
    const group = byHash.get(revision.outputHash) || [];
    group.push({ revisionId: revision.revisionId, outputPath: revision.outputPath });
    byHash.set(revision.outputHash, group);
  }
  const groups = [...byHash.entries()].filter(([, entries]) => entries.length > 1).map(([digest, entries]) => ({ digest, entries }));
  const token = sha256(`${input.projectId}\0${groups.map((group) => `${group.digest}:${group.entries.map((entry) => entry.outputPath).sort().join(',')}`).sort().join('\n')}`);
  return {
    dedupPlanVersion: 1,
    projectId: input.projectId,
    mode: 'dry_run',
    planToken: token,
    groups,
    deduplicableBytes: summary.deduplicableBytes,
    sourceDataTouched: false,
    artifactContentChanged: false,
  };
}

function isSameDarwinApfsVolume(sourcePath, targetPath) {
  if (process.platform !== 'darwin' || typeof fs.statfsSync !== 'function') return false;
  const sourceStat = fs.statSync(sourcePath);
  const targetDirectoryStat = fs.statSync(path.dirname(targetPath));
  const sourceFs = fs.statfsSync(sourcePath);
  const targetFs = fs.statfsSync(path.dirname(targetPath));
  return sourceStat.dev === targetDirectoryStat.dev
    && sourceFs.type === DARWIN_APFS_FS_TYPE
    && targetFs.type === DARWIN_APFS_FS_TYPE;
}

function copyFileCopyOnWrite(sourcePath, targetPath) {
  const cloneFlag = fs.constants.COPYFILE_FICLONE_FORCE;
  if (typeof cloneFlag === 'number') {
    try {
      fs.copyFileSync(sourcePath, targetPath, cloneFlag);
      return 'copyfile_ficlone_force';
    } catch (error) {
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
      if (error?.code !== 'ENOSYS') {
        throw new ResultStudioLifecycleError(
          'dedup_copy_on_write_unavailable',
          'Safe copy-on-write deduplication is unavailable on this filesystem.',
          { platform: process.platform, causeCode: error?.code || 'copyfile_ficlone_force_failed' },
        );
      }
    }
  }
  // Darwin's Node binding exposes FORCE but currently returns ENOSYS. On a
  // proven same-volume APFS target, the non-force flag maps to clonefile(2).
  const apfsCloneFlag = fs.constants.COPYFILE_FICLONE;
  if (typeof apfsCloneFlag === 'number' && isSameDarwinApfsVolume(sourcePath, targetPath)) {
    try {
      fs.copyFileSync(sourcePath, targetPath, apfsCloneFlag);
      return 'copyfile_ficlone_apfs';
    } catch (error) {
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
      throw new ResultStudioLifecycleError(
        'dedup_copy_on_write_unavailable',
        'Safe copy-on-write deduplication is unavailable on this APFS volume.',
        { platform: process.platform, causeCode: error?.code || 'copyfile_ficlone_apfs_failed' },
      );
    }
  }
  throw new ResultStudioLifecycleError(
    'dedup_copy_on_write_unavailable',
    'Safe copy-on-write deduplication is unavailable on this platform or filesystem.',
    { platform: process.platform, causeCode: 'copy_on_write_clone_not_supported' },
  );
}

function sameFileIdentity(leftPath, rightPath) {
  const left = fs.statSync(leftPath);
  const right = fs.statSync(rightPath);
  return left.dev === right.dev && left.ino === right.ino;
}

function executeArtifactDeduplication(input = {}, dependencies = {}) {
  const plan = planArtifactDeduplication(input, dependencies);
  if (!input.planToken || input.planToken !== plan.planToken) throw new ResultStudioLifecycleError('dedup_plan_stale', 'Deduplication plan token is missing or stale.');
  const workspaceRoot = fs.realpathSync(input.workspaceRoot);
  const objectRoot = path.join(workspaceRoot, '.biof3', 'result-objects', 'sha256');
  const cloned = [];
  const clonePrimitives = new Set();
  for (const group of plan.groups) {
    const files = group.entries.map((entry) => resolveWorkspaceFile(workspaceRoot, entry.outputPath));
    if (files.some((file) => hashFile(file) !== group.digest)) throw new ResultStudioLifecycleError('dedup_artifact_drift', 'Artifact changed after deduplication planning.');
    const objectDir = path.join(objectRoot, group.digest.slice(0, 2));
    const objectPath = path.join(objectDir, group.digest);
    if (!isPathContained(objectRoot, objectPath)) throw new ResultStudioLifecycleError('dedup_object_escape', 'Content object escaped its store.');
    fs.mkdirSync(objectDir, { recursive: true });
    if (!fs.existsSync(objectPath) || files.some((file) => sameFileIdentity(file, objectPath))) {
      const temporaryObject = path.join(objectDir, `.biof3-object-${crypto.randomUUID()}`);
      try {
        clonePrimitives.add(copyFileCopyOnWrite(files[0], temporaryObject));
        if (hashFile(temporaryObject) !== group.digest) throw new ResultStudioLifecycleError('dedup_object_hash_mismatch', 'Content object hash mismatch.');
        fs.renameSync(temporaryObject, objectPath);
      } finally {
        if (fs.existsSync(temporaryObject)) fs.rmSync(temporaryObject, { force: true });
      }
    }
    if (hashFile(objectPath) !== group.digest) throw new ResultStudioLifecycleError('dedup_object_hash_mismatch', 'Content object hash mismatch.');
    const staged = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const temporary = path.join(path.dirname(file), `.biof3-dedupe-${crypto.randomUUID()}`);
        clonePrimitives.add(copyFileCopyOnWrite(objectPath, temporary));
        if (hashFile(temporary) !== group.digest) throw new ResultStudioLifecycleError('dedup_postcondition_failed', 'Deduplicated Artifact failed its hash postcondition.');
        if (sameFileIdentity(objectPath, temporary)) throw new ResultStudioLifecycleError('dedup_inode_alias', 'Copy-on-write clone unexpectedly reused the content object inode.');
        if (staged.some((entry) => sameFileIdentity(entry.temporary, temporary))) throw new ResultStudioLifecycleError('dedup_inode_alias', 'Copy-on-write clones unexpectedly share an inode.');
        staged.push({
          file,
          temporary,
          revisionId: group.entries[index].revisionId,
          outputPath: group.entries[index].outputPath,
        });
      }
      for (const entry of staged) {
        fs.renameSync(entry.temporary, entry.file);
        if (hashFile(entry.file) !== group.digest) throw new ResultStudioLifecycleError('dedup_postcondition_failed', 'Deduplicated Artifact failed its hash postcondition.');
        cloned.push({ revisionId: entry.revisionId, outputPath: entry.outputPath, digest: group.digest });
      }
    } finally {
      for (const entry of staged) {
        if (fs.existsSync(entry.temporary)) fs.rmSync(entry.temporary, { force: true });
      }
    }
  }
  return {
    ...plan,
    mode: 'executed',
    strategy: 'copy_on_write_clone',
    clonePrimitives: [...clonePrimitives].sort(),
    clonedCount: cloned.length,
    cloned,
    hardLinkCount: 0,
    linkedCount: cloned.length,
    linked: cloned,
  };
}

function listGcEntries({ repository, adapter, workspaceRoot, projectId, minAgeMs = DEFAULT_GC_MIN_AGE_MS, now = Date.now() }) {
  const privateRoot = path.join(path.resolve(workspaceRoot), '.biof3', 'revision');
  const changes = repository.listChangeSets({ projectId, limit: 500 });
  const byId = new Map(changes.map((changeSet) => [changeSet.changeSetId, changeSet]));
  const entries = [];
  if (fs.existsSync(privateRoot)) {
    for (const dirent of fs.readdirSync(privateRoot, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const full = path.join(privateRoot, dirent.name);
      if (!isPathContained(privateRoot, full)) continue;
      const ageMs = Math.max(0, now - fs.statSync(full).mtimeMs);
      const changeSet = byId.get(dirent.name);
      const temp = dirent.name.startsWith('.tmp-');
      const closed = changeSet && ['validation_failed', 'reverted', 'abandoned'].includes(changeSet.status);
      if (ageMs >= minAgeMs && (temp || closed)) {
        entries.push({ kind: 'private_staging', relativePath: path.relative(workspaceRoot, full).split(path.sep).join('/'), changeSetId: changeSet?.changeSetId || null, ageMs });
      }
    }
  }
  for (const changeSet of changes) {
    if (!['validation_failed', 'reverted', 'abandoned'].includes(changeSet.status)) continue;
    const expectedRef = expectedGcChangeSetRef(changeSet.changeSetId);
    if (!expectedRef || changeSet.workingBranchRef !== expectedRef) continue;
    const actual = adapter.revParse(expectedRef);
    if (actual && (!changeSet.candidateCommit || actual === changeSet.candidateCommit)) {
      entries.push({ kind: 'candidate_ref', ref: expectedRef, expectedCommit: actual, changeSetId: changeSet.changeSetId });
    }
  }
  return entries;
}

function buildGcSourceProtection({ repository, adapter, projectId }) {
  const reachability = repository.analyzeRevisionReachability(projectId);
  const revisions = repository.listProjectRevisions(projectId, { limit: 10000 });
  if (revisions.length !== reachability.total) {
    throw new ResultStudioLifecycleError(
      'gc_revision_inventory_incomplete',
      'GC cannot continue without the complete persisted Revision inventory.',
      { listedRevisionCount: revisions.length, reachabilityRevisionCount: reachability.total },
    );
  }

  const reachableById = new Map(
    reachability.reachable.map((entry) => [entry.revisionId, entry.reasons]),
  );
  const gcCandidateIds = new Set(reachability.gcCandidates.map((entry) => entry.revisionId));
  const sourceBindings = revisions.map((revision) => ({
    revisionId: revision.revisionId,
    sourceCommit: revision.sourceCommit,
    sourcePath: revision.sourceScriptRef?.relativePath || null,
    sourceHash: revision.sourceScriptRef?.sha256 || null,
    parametersPath: revision.parametersRef || null,
    parametersHash: revision.parametersHash || null,
    reachability: reachableById.has(revision.revisionId)
      ? { state: 'reachable', reasons: [...reachableById.get(revision.revisionId)].sort() }
      : gcCandidateIds.has(revision.revisionId)
        ? { state: 'gc_candidate', reasons: [] }
        : { state: 'unclassified', reasons: [] },
  })).sort((left, right) => left.revisionId.localeCompare(right.revisionId));

  const invalid = sourceBindings.filter((entry) => !/^[a-f0-9]{40}$/.test(String(entry.sourceCommit || '')));
  if (invalid.length > 0) {
    throw new ResultStudioLifecycleError(
      'gc_revision_source_invalid',
      'GC cannot continue while a persisted Revision has no canonical source commit.',
      { revisionIds: invalid.map((entry) => entry.revisionId) },
    );
  }

  const sourceCommits = [...new Set(sourceBindings.map((entry) => entry.sourceCommit))].sort();
  const resolved = adapter.resolveManyRefs(sourceCommits.map((commit) => `${commit}^{commit}`));
  const missing = sourceCommits.filter((commit) => resolved.get(`${commit}^{commit}`) !== commit);
  if (missing.length > 0) {
    throw new ResultStudioLifecycleError(
      'gc_revision_source_missing',
      'GC cannot continue while a persisted Revision source commit is unavailable.',
      { sourceCommits: missing },
    );
  }

  const bindingsByCommit = new Map();
  for (const binding of sourceBindings) {
    if (!bindingsByCommit.has(binding.sourceCommit)) bindingsByCommit.set(binding.sourceCommit, []);
    bindingsByCommit.get(binding.sourceCommit).push(binding);
  }
  const protectedSourceRefs = sourceCommits.map((sourceCommit) => {
    const ref = `${GC_SOURCE_REF_PREFIX}${sourceCommit}`;
    const currentCommit = adapter.revParse(ref);
    if (currentCommit && currentCommit !== sourceCommit) {
      throw new ResultStudioLifecycleError(
        'gc_source_ref_conflict',
        'A protected Result Studio source ref points to a different commit.',
        { ref, expectedCommit: sourceCommit, actualCommit: currentCommit },
      );
    }
    const bindings = bindingsByCommit.get(sourceCommit);
    return {
      ref,
      sourceCommit,
      currentCommit,
      action: currentCommit === sourceCommit ? 'verify' : 'create_before_cleanup',
      revisionIds: bindings.map((entry) => entry.revisionId),
      reachableRevisionCount: bindings.filter((entry) => entry.reachability.state === 'reachable').length,
      historicalRevisionCount: bindings.length,
    };
  });
  const revisionSourceDigest = sha256(JSON.stringify(sourceBindings));
  const protectedSourceRefDigest = sha256(JSON.stringify(protectedSourceRefs.map((entry) => ({
    ref: entry.ref,
    sourceCommit: entry.sourceCommit,
    revisionIds: entry.revisionIds,
  }))));
  const protectionStateDigest = sha256(JSON.stringify(protectedSourceRefs.map((entry) => ({
    ref: entry.ref,
    currentCommit: entry.currentCommit,
    action: entry.action,
  }))));
  return {
    reachability,
    sourceBindings,
    revisionSourceDigest,
    protectedSourceRefs,
    protectedSourceRefDigest,
    protectionStateDigest,
  };
}

function attachGcSourceProtection(entries, protectedSourceRefs, adapter) {
  const byCommit = new Map(protectedSourceRefs.map((entry) => [entry.sourceCommit, entry]));
  const candidateRefs = new Set(
    entries.filter((entry) => entry.kind === 'candidate_ref').map((entry) => entry.ref),
  );
  const deletableEntries = [];
  const protectedCandidateRefs = [];
  for (const entry of entries) {
    if (entry.kind !== 'candidate_ref') {
      deletableEntries.push(entry);
      continue;
    }
    const expectedRef = expectedGcChangeSetRef(entry.changeSetId);
    if (!expectedRef || entry.ref !== expectedRef) {
      throw new ResultStudioLifecycleError(
        'gc_candidate_ref_contract_mismatch',
        'GC refuses to inspect or delete a ref that is not the exact server-derived ChangeSet candidate ref.',
        { changeSetId: entry.changeSetId, expectedRef, actualRef: entry.ref },
      );
    }
    const sourceProtection = byCommit.get(entry.expectedCommit);
    const containing = adapter.run([
      'for-each-ref',
      '--format=%(refname)',
      `--contains=${entry.expectedCommit}`,
    ], { allowFailure: true, readOnly: true });
    if (!containing.ok) {
      throw new ResultStudioLifecycleError(
        'gc_ref_reachability_unavailable',
        'GC cannot prove independent candidate commit reachability.',
        { changeSetId: entry.changeSetId, code: containing.code, status: containing.status },
      );
    }
    const independentExistingRefCount = new Set(containing.stdout.split('\n')
      .map((ref) => ref.trim())
      .filter((ref) => ref && !candidateRefs.has(ref))).size;
    const projectedIndependentRefCount = independentExistingRefCount + (
      sourceProtection && sourceProtection.action === 'create_before_cleanup' ? 1 : 0
    );
    const annotated = {
      ...entry,
      sourceRevisionIds: sourceProtection?.revisionIds || [],
      independentSourceRef: sourceProtection?.ref || null,
      independentlyReachableAfterPlan: projectedIndependentRefCount > 0,
      independentReachabilityCount: projectedIndependentRefCount,
    };
    if (annotated.independentlyReachableAfterPlan) deletableEntries.push(annotated);
    else protectedCandidateRefs.push({
      ...annotated,
      reason: 'candidate_commit_has_no_independent_ref',
    });
  }
  return { entries: deletableEntries, protectedCandidateRefs };
}

function planResultStudioGc(input = {}, dependencies = {}) {
  if (!dependencies.repository || !dependencies.adapter || !input.workspaceRoot || !input.projectId) {
    throw new ResultStudioLifecycleError('gc_dependencies_missing', 'Repository, adapter, workspace and project are required for GC.');
  }
  const sourceProtection = buildGcSourceProtection({
    repository: dependencies.repository,
    adapter: dependencies.adapter,
    projectId: input.projectId,
  });
  const candidateClassification = attachGcSourceProtection(
    listGcEntries({ ...input, repository: dependencies.repository, adapter: dependencies.adapter }),
    sourceProtection.protectedSourceRefs,
    dependencies.adapter,
  );
  const { entries, protectedCandidateRefs } = candidateClassification;
  const tokenPayload = JSON.stringify({
    gcPlanVersion: 2,
    projectId: input.projectId,
    entries: entries.map((entry) => entry.kind === 'candidate_ref'
      ? {
        kind: entry.kind,
        ref: entry.ref,
        expectedCommit: entry.expectedCommit,
        changeSetId: entry.changeSetId,
        independentSourceRef: entry.independentSourceRef,
      }
      : {
        kind: entry.kind,
        relativePath: entry.relativePath,
        changeSetId: entry.changeSetId,
      }),
    revisionSourceDigest: sourceProtection.revisionSourceDigest,
    protectedSourceRefDigest: sourceProtection.protectedSourceRefDigest,
    protectionStateDigest: sourceProtection.protectionStateDigest,
    protectedCandidateRefs: protectedCandidateRefs.map((entry) => ({
      ref: entry.ref,
      expectedCommit: entry.expectedCommit,
      changeSetId: entry.changeSetId,
      reason: entry.reason,
    })),
  });
  return {
    gcPlanVersion: 2,
    projectId: input.projectId,
    mode: 'dry_run',
    entries,
    planToken: sha256(`${input.projectId}\0${tokenPayload}`),
    protectedRevisionCount: sourceProtection.reachability.reachable.length,
    unreachableRevisionMetadataCount: sourceProtection.reachability.gcCandidates.length,
    sourceRevisionCount: sourceProtection.sourceBindings.length,
    sourceCommitCount: sourceProtection.protectedSourceRefs.length,
    revisionSourceDigest: sourceProtection.revisionSourceDigest,
    protectedSourceRefDigest: sourceProtection.protectedSourceRefDigest,
    protectedSourceRefs: sourceProtection.protectedSourceRefs,
    protectedCandidateRefs,
    sourceProtectionCreateCount: sourceProtection.protectedSourceRefs
      .filter((entry) => entry.action === 'create_before_cleanup').length,
    artifactDeletionCount: 0,
    note: 'GC never deletes Artifact files or Revision history; every persisted Revision source commit is protected by an independent internal ref before closed private staging or matching candidate refs are removed.',
  };
}

function executeGcRefTransaction(plan, adapter) {
  const candidateRefs = plan.entries.filter((entry) => entry.kind === 'candidate_ref');
  if (plan.protectedSourceRefs.length === 0 && candidateRefs.length === 0) return;
  const commands = ['start'];
  for (const entry of plan.protectedSourceRefs) {
    commands.push(entry.action === 'create_before_cleanup'
      ? `create ${entry.ref} ${entry.sourceCommit}`
      : `verify ${entry.ref} ${entry.sourceCommit}`);
  }
  for (const entry of candidateRefs) {
    const expectedRef = expectedGcChangeSetRef(entry.changeSetId);
    if (!expectedRef || entry.ref !== expectedRef) {
      throw new ResultStudioLifecycleError(
        'gc_candidate_ref_contract_mismatch',
        'GC refuses to delete a ref that is not the exact server-derived ChangeSet candidate ref.',
        { changeSetId: entry.changeSetId, expectedRef, actualRef: entry.ref },
      );
    }
    commands.push(`delete ${entry.ref} ${entry.expectedCommit}`);
  }
  commands.push('prepare', 'commit');
  const result = adapter.run(['update-ref', '--stdin'], {
    allowFailure: true,
    input: `${commands.join('\n')}\n`,
  });
  if (!result.ok) {
    throw new ResultStudioLifecycleError(
      'gc_ref_transaction_failed',
      'Protected source refs and candidate ref cleanup could not be committed atomically.',
      { code: result.code, status: result.status, stderr: result.stderr },
    );
  }
}

function executeResultStudioGc(input = {}, dependencies = {}) {
  const plan = planResultStudioGc(input, dependencies);
  if (!input.planToken || input.planToken !== plan.planToken) throw new ResultStudioLifecycleError('gc_plan_stale', 'GC plan token is missing or stale.');
  const privateRoot = path.join(path.resolve(input.workspaceRoot), '.biof3', 'revision');
  const removed = [];
  executeGcRefTransaction(plan, dependencies.adapter);
  for (const entry of plan.entries) {
    if (entry.kind === 'candidate_ref') {
      removed.push(entry);
    } else {
      const absolute = path.resolve(input.workspaceRoot, entry.relativePath);
      if (!isPathContained(privateRoot, absolute)) throw new ResultStudioLifecycleError('gc_path_escape', 'GC target escaped private staging.');
      fs.rmSync(absolute, { recursive: true, force: false });
      removed.push(entry);
    }
  }
  for (const entry of plan.protectedSourceRefs) {
    if (dependencies.adapter.revParse(entry.ref) !== entry.sourceCommit) {
      throw new ResultStudioLifecycleError(
        'gc_source_protection_postcondition_failed',
        'A protected source ref failed its postcondition after GC.',
        { ref: entry.ref, expectedCommit: entry.sourceCommit },
      );
    }
  }
  return {
    ...plan,
    mode: 'executed',
    removedCount: removed.length,
    removed,
    createdProtectedSourceRefCount: plan.sourceProtectionCreateCount,
    protectedSourceRefs: plan.protectedSourceRefs.map((entry) => ({
      ...entry,
      currentCommit: entry.sourceCommit,
      action: 'protected',
    })),
  };
}

function evaluatePreviewResourceBudget({ resourceSnapshot = {}, estimatedMemoryBytes = null, estimatedDiskBytes = null, activePreviewJobs = 0, maxBackgroundPreviews = 2, maxPreviewMemoryBytes = DEFAULT_MAX_PREVIEW_MEMORY_BYTES } = {}) {
  const measured = (value) => {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  const memory = measured(resourceSnapshot.memory?.availableBytes);
  const disk = measured(resourceSnapshot.disk?.availableBytes);
  const requestedMemory = measured(estimatedMemoryBytes);
  const requestedDisk = measured(estimatedDiskBytes);
  const active = Math.max(0, Math.floor(Number(activePreviewJobs) || 0));
  const maximum = Math.max(1, Math.floor(Number(maxBackgroundPreviews) || 0));
  const policyMemoryLimit = measured(maxPreviewMemoryBytes);
  const reasons = [];
  if ((resourceSnapshot.state || resourceSnapshot.status) === 'unavailable') reasons.push('resource_snapshot_unavailable');
  if (memory == null) reasons.push('memory_measurement_unavailable');
  if (disk == null) reasons.push('disk_measurement_unavailable');
  if (requestedMemory == null || requestedDisk == null) reasons.push('resource_estimate_unavailable');
  if (memory != null && requestedMemory != null
      && requestedMemory > Math.min(memory * 0.7, policyMemoryLimit || Number.POSITIVE_INFINITY)) {
    reasons.push('memory_budget_exceeded');
  }
  if (disk != null && requestedDisk != null && requestedDisk > disk * 0.8) reasons.push('disk_budget_exceeded');
  if (active >= maximum) reasons.push('preview_concurrency_saturated');
  const blocking = reasons.some((reason) => reason !== 'preview_concurrency_saturated');
  return {
    budgetVersion: 1,
    decision: blocking ? 'blocked' : reasons.length > 0 ? 'queued' : 'run_background',
    reasons,
    activePreviewJobs: active,
    maxBackgroundPreviews: maximum,
    estimatedMemoryBytes: requestedMemory,
    estimatedDiskBytes: requestedDisk,
    limits: {
      availableMemoryBudgetBytes: memory == null ? null : Math.min(memory * 0.7, policyMemoryLimit || Number.POSITIVE_INFINITY),
      availableDiskBudgetBytes: disk == null ? null : disk * 0.8,
      maxPreviewMemoryBytes: policyMemoryLimit,
    },
    scientificParametersChanged: false,
  };
}

function detectDelimiter(header, filePath) {
  if (/\.tsv$/i.test(filePath)) return '\t';
  let quoted = false;
  let atFieldStart = true;
  let commaCount = 0;
  let tabCount = 0;
  for (let index = 0; index < header.length; index += 1) {
    const char = header[index];
    if (quoted) {
      if (char !== '"') continue;
      if (header[index + 1] === '"') { index += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
      continue;
    }
    if (char === ',' || char === '\t') {
      if (char === ',') commaCount += 1;
      else tabCount += 1;
      atFieldStart = true;
      continue;
    }
    atFieldStart = false;
  }
  return tabCount > commaCount ? '\t' : ',';
}

function splitDelimitedLine(line, delimiter, errorPrefix = 'table_record') {
  const cells = [];
  let current = '';
  let quoted = false;
  let closedQuote = false;
  let atFieldStart = true;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char !== '"') { current += char; continue; }
      if (line[index + 1] === '"') { current += '"'; index += 1; continue; }
      quoted = false;
      closedQuote = true;
      continue;
    }
    if (closedQuote) {
      if (char === delimiter) {
        cells.push(current);
        current = '';
        closedQuote = false;
        atFieldStart = true;
        continue;
      }
      throw new ResultStudioLifecycleError(
        `${errorPrefix}_invalid_quoted_field`,
        'A closing quote must be followed by a delimiter or the end of the record.',
      );
    }
    if (char === delimiter) {
      cells.push(current);
      current = '';
      atFieldStart = true;
      continue;
    }
    if (char === '"') {
      if (!atFieldStart) {
        throw new ResultStudioLifecycleError(
          `${errorPrefix}_invalid_quote`,
          'A quote in an unquoted field is not valid RFC4180 data.',
        );
      }
      quoted = true;
      atFieldStart = false;
      continue;
    }
    if (char === '\r' || char === '\n') {
      throw new ResultStudioLifecycleError(
        `${errorPrefix}_invalid_line_ending`,
        'Record separators are only valid inside quoted fields or between records.',
      );
    }
    current += char;
    atFieldStart = false;
  }
  if (quoted) {
    throw new ResultStudioLifecycleError(
      `${errorPrefix}_incomplete_quoted_record`,
      'The delimited record ended before its quoted field was closed.',
    );
  }
  cells.push(current);
  return cells;
}

const TABLE_READ_CHUNK_BYTES = 64 * 1024;
const MAX_TABLE_HEADER_BYTES = 256 * 1024;
const MAX_TABLE_RECORD_BYTES = MAX_TABLE_PAGE_BYTES;

function scanDelimitedRecord(buffer, delimiter = null) {
  let quoted = false;
  let atFieldStart = true;
  const isDelimiter = (byte) => byte === 0x2c || byte === 0x09;
  const selectedDelimiter = delimiter === '\t' ? 0x09 : delimiter === ',' ? 0x2c : null;
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (quoted) {
      if (byte !== 0x22) continue;
      if (buffer[index + 1] === 0x22) { index += 1; continue; }
      quoted = false;
      continue;
    }
    if (byte === 0x22 && atFieldStart) {
      quoted = true;
      atFieldStart = false;
      continue;
    }
    const delimiterMatch = selectedDelimiter === null ? isDelimiter(byte) : byte === selectedDelimiter;
    if (delimiterMatch) {
      atFieldStart = true;
      continue;
    }
    if (byte === 0x0a) {
      const contentEnd = index > 0 && buffer[index - 1] === 0x0d ? index - 1 : index;
      return { complete: true, contentEnd, consumedBytes: index + 1, quoted: false };
    }
    atFieldStart = false;
  }
  return { complete: false, contentEnd: buffer.length, consumedBytes: buffer.length, quoted };
}

function readDelimitedRecord(handle, { startOffset, fileSize, maxBytes, delimiter = null, errorPrefix }) {
  if (startOffset >= fileSize) return null;
  let raw = Buffer.alloc(0);
  while (raw.length < maxBytes + 2 && startOffset + raw.length < fileSize) {
    const remaining = Math.min(
      TABLE_READ_CHUNK_BYTES,
      maxBytes + 2 - raw.length,
      fileSize - startOffset - raw.length,
    );
    const chunk = Buffer.alloc(remaining);
    const bytesRead = fs.readSync(handle, chunk, 0, remaining, startOffset + raw.length);
    if (bytesRead <= 0) break;
    raw = Buffer.concat([raw, chunk.subarray(0, bytesRead)]);
    const scanned = scanDelimitedRecord(raw, delimiter);
    if (scanned.complete) {
      if (scanned.contentEnd > maxBytes) {
        throw new ResultStudioLifecycleError(
          `${errorPrefix}_too_large`,
          `The delimited ${errorPrefix === 'table_header' ? 'header' : 'record'} exceeds its bounded byte budget.`,
        );
      }
      return {
        buffer: raw.subarray(0, scanned.contentEnd),
        nextOffset: startOffset + scanned.consumedBytes,
      };
    }
  }
  const scanned = scanDelimitedRecord(raw, delimiter);
  if (raw.length > maxBytes) {
    throw new ResultStudioLifecycleError(
      `${errorPrefix}_too_large`,
      `The delimited ${errorPrefix === 'table_header' ? 'header' : 'record'} exceeds its bounded byte budget.`,
    );
  }
  if (scanned.quoted) {
    throw new ResultStudioLifecycleError(
      `${errorPrefix}_incomplete_quoted_record`,
      'The delimited record ended before its quoted field was closed.',
    );
  }
  return { buffer: raw, nextOffset: startOffset + raw.length };
}

function decodeDelimitedRecord(buffer, errorPrefix) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ResultStudioLifecycleError(
      `${errorPrefix}_invalid_utf8`,
      'The delimited record is not valid UTF-8.',
    );
  }
}

function readTablePage({ filePath, cursor = 0, limit = 100 } = {}) {
  const boundedLimit = Number.isInteger(limit) && limit > 0 && limit <= MAX_TABLE_PAGE_ROWS ? limit : 100;
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new ResultStudioLifecycleError('table_cursor_invalid', 'The table cursor must be a non-negative byte offset.');
  }
  const boundedCursor = cursor;
  const stat = fs.statSync(filePath);
  if (boundedCursor > stat.size) {
    throw new ResultStudioLifecycleError('table_cursor_invalid', 'The table cursor is beyond the end of the file.');
  }
  const handle = fs.openSync(filePath, 'r');
  let headerRecord;
  try {
    headerRecord = readDelimitedRecord(handle, {
      startOffset: 0,
      fileSize: stat.size,
      maxBytes: MAX_TABLE_HEADER_BYTES,
      errorPrefix: 'table_header',
    });
  } finally { fs.closeSync(handle); }
  if (!headerRecord) {
    throw new ResultStudioLifecycleError('table_header_missing', 'The table does not contain a header record.');
  }
  const header = decodeDelimitedRecord(headerRecord.buffer, 'table_header');
  const delimiter = detectDelimiter(header, filePath);
  const columns = splitDelimitedLine(header, delimiter, 'table_header');
  const bodyStart = headerRecord.nextOffset;
  if (boundedCursor !== 0 && boundedCursor < bodyStart) {
    throw new ResultStudioLifecycleError('table_cursor_invalid', 'The table cursor points inside the header record.');
  }
  if (boundedCursor !== 0 && boundedCursor < stat.size) {
    const cursorHandle = fs.openSync(filePath, 'r');
    const previousByte = Buffer.alloc(1);
    try { fs.readSync(cursorHandle, previousByte, 0, 1, boundedCursor - 1); }
    finally { fs.closeSync(cursorHandle); }
    if (previousByte[0] !== 0x0a) {
      throw new ResultStudioLifecycleError('table_cursor_invalid', 'The table cursor is not positioned at a complete record boundary.');
    }
  }
  const rows = [];
  let recordCursor = boundedCursor === 0 ? bodyStart : boundedCursor;
  let nextCursor = null;
  const bodyHandle = fs.openSync(filePath, 'r');
  try {
    while (rows.length < boundedLimit && recordCursor < stat.size) {
      const recordStart = recordCursor;
      const record = readDelimitedRecord(bodyHandle, {
        startOffset: recordStart,
        fileSize: stat.size,
        maxBytes: MAX_TABLE_RECORD_BYTES,
        delimiter,
        errorPrefix: 'table_record',
      });
      if (!record) break;
      const parsed = splitDelimitedLine(
        decodeDelimitedRecord(record.buffer, 'table_record'),
        delimiter,
        'table_record',
      );
      const candidateRows = [...rows, parsed];
      const candidateBytes = Buffer.byteLength(JSON.stringify({ columns, rows: candidateRows }));
      if (candidateBytes > MAX_TABLE_PAGE_BYTES) {
        if (rows.length === 0) {
          throw new ResultStudioLifecycleError('table_page_too_large', 'A single table record exceeds the bounded response budget.');
        }
        nextCursor = recordStart;
        break;
      }
      rows.push(parsed);
      recordCursor = record.nextOffset;
      nextCursor = recordCursor < stat.size ? recordCursor : null;
    }
  } finally {
    fs.closeSync(bodyHandle);
  }
  return {
    tablePageVersion: 1,
    columns,
    rows,
    cursor: boundedCursor,
    nextCursor,
    limit: boundedLimit,
    totalRows: null,
    totalRowsIsUnknown: true,
    virtualized: nextCursor !== null,
    caveat: 'RFC4180 records are parsed within bounded header, record, and response byte budgets; total row count remains unknown until the final page.',
  };
}

module.exports = {
  RESULT_STUDIO_LIFECYCLE_VERSION,
  ResultStudioLifecycleError,
  inspectResultStudioWorkspace,
  recoverResultStudioWorkspace,
  inspectResultStudioStorage,
  planArtifactDeduplication,
  executeArtifactDeduplication,
  planResultStudioGc,
  executeResultStudioGc,
  evaluatePreviewResourceBudget,
  readTablePage,
};
