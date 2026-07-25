'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { assessCheckpointConsistency } = require('./result-studio-contracts');
const { isPathContained } = require('./project-run-layout');

const RESULT_STUDIO_LIFECYCLE_VERSION = 1;
const ZERO_OID = '0'.repeat(40);
const DEFAULT_GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_STORAGE_FILES = 10000;
const MAX_TABLE_PAGE_ROWS = 200;
const MAX_TABLE_PAGE_BYTES = 1024 * 1024;

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
  const revisions = repository.listProjectRevisions(projectId);
  const issues = [];
  for (const revision of revisions) {
    let actualHash = null;
    try { actualHash = hashFile(resolveWorkspaceFile(workspaceRoot, revision.outputPath)); } catch (error) {
      issues.push({ revisionId: revision.revisionId, kind: 'artifact_missing', blocking: true });
      continue;
    }
    if (!revision.outputHash || actualHash !== revision.outputHash) {
      issues.push({ revisionId: revision.revisionId, kind: 'artifact_hash_drift', blocking: true });
    }
    if (revision.sourceCommit && !adapter.revParse(revision.sourceCommit)) {
      issues.push({ revisionId: revision.revisionId, kind: 'source_commit_missing', blocking: true });
    }
    if (revision.isCurrent) {
      const ref = `refs/heads/biof3/current/${revision.artifactFamilyId}`;
      const actual = adapter.revParse(ref);
      if (actual !== revision.sourceCommit) {
        issues.push({ revisionId: revision.revisionId, kind: actual ? 'current_ref_drift' : 'current_ref_missing', blocking: !!actual, recoverable: !actual, ref });
      }
    }
  }
  return { revisionCount: revisions.length, issues, intact: issues.length === 0 };
}

function inspectResultStudioWorkspace({ repository, adapter, workspaceRoot, projectId, conversationId = null } = {}) {
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
  const interrupted = repository.findInterruptedChangeSets(projectId).map(({ changeSet: item, recovery }) => ({
    changeSetId: item.changeSetId,
    status: item.status,
    recovery,
    candidateCommit: adapter.revParse(item.workingBranchRef),
    revisionIds: repository.listRevisionsByChangeSet(item.changeSetId).map((revision) => revision.revisionId),
  }));
  const blocked = consistency.status === 'partial_adopt_detected' || consistency.status === 'checkpoint_corrupt'
    || revisionIntegrity.issues.some((issue) => issue.blocking);
  return {
    lifecycleVersion: RESULT_STUDIO_LIFECYCLE_VERSION,
    projectId,
    checkpoint: checkpoint ? {
      checkpointId: checkpoint.checkpointId,
      changeSetId: checkpoint.changeSetId,
      changeSetStatus: checkpoint.changeSetStatus,
      pendingPreview: checkpoint.pendingPreview,
      updatedAt: checkpoint.updatedAt,
    } : null,
    checkpointIntegrity,
    consistency,
    revisionIntegrity,
    interrupted,
    status: blocked ? 'blocked' : interrupted.length > 0 || revisionIntegrity.issues.some((issue) => issue.recoverable) ? 'recovery_available' : 'ready',
  };
}

function recoverResultStudioWorkspace(input = {}, dependencies = {}) {
  const { repository, adapter, getToolJob } = dependencies;
  const before = inspectResultStudioWorkspace({ ...input, repository, adapter });
  if (before.status === 'blocked') return { recovered: false, repaired: [], before, after: before };
  const repaired = [];

  for (const interrupted of before.interrupted) {
    if (interrupted.status !== 'running' || !interrupted.candidateCommit || interrupted.revisionIds.length === 0) continue;
    const changeSet = repository.getChangeSet(interrupted.changeSetId);
    const revisions = repository.listRevisionsByChangeSet(interrupted.changeSetId);
    const jobsValid = revisions.every((revision) => {
      const job = typeof getToolJob === 'function' ? getToolJob(revision.toolJobId) : null;
      return job && job.status === 'completed' && String(job.project_id || job.projectId || '') === input.projectId
        && job.result?.artifactTruth?.status === 'valid' && job.result?.artifactTruth?.blocking !== true;
    });
    if (!jobsValid || revisions.some((revision) => revision.validationStatus !== 'valid')) continue;
    repository.transitionChangeSet({
      changeSetId: changeSet.changeSetId,
      to: 'preview_ready',
      candidateCommit: interrupted.candidateCommit,
      jobRefs: revisions.map((revision) => revision.toolJobId),
      candidateArtifactRefs: revisions.map((revision) => revision.revisionId),
      validationSummary: { recoveredAfterRestart: true, artifactTruthStatus: 'valid' },
    });
    repaired.push({ changeSetId: changeSet.changeSetId, repair: 'running_to_preview_ready' });
  }

  for (const revision of repository.listCurrentRevisions(input.projectId)) {
    const ref = `refs/heads/biof3/current/${revision.artifactFamilyId}`;
    if (!adapter.revParse(ref) && revision.sourceCommit && adapter.revParse(revision.sourceCommit)) {
      adapter.updateRefCas({ ref, newCommit: revision.sourceCommit, expectedOld: ZERO_OID });
      repaired.push({ revisionId: revision.revisionId, repair: 'restored_missing_current_ref' });
    }
  }
  const after = inspectResultStudioWorkspace({ ...input, repository, adapter });
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

function executeArtifactDeduplication(input = {}, dependencies = {}) {
  const plan = planArtifactDeduplication(input, dependencies);
  if (!input.planToken || input.planToken !== plan.planToken) throw new ResultStudioLifecycleError('dedup_plan_stale', 'Deduplication plan token is missing or stale.');
  const workspaceRoot = fs.realpathSync(input.workspaceRoot);
  const objectRoot = path.join(workspaceRoot, '.biof3', 'result-objects', 'sha256');
  const linked = [];
  for (const group of plan.groups) {
    const files = group.entries.map((entry) => resolveWorkspaceFile(workspaceRoot, entry.outputPath));
    if (files.some((file) => hashFile(file) !== group.digest)) throw new ResultStudioLifecycleError('dedup_artifact_drift', 'Artifact changed after deduplication planning.');
    const objectDir = path.join(objectRoot, group.digest.slice(0, 2));
    const objectPath = path.join(objectDir, group.digest);
    if (!isPathContained(objectRoot, objectPath)) throw new ResultStudioLifecycleError('dedup_object_escape', 'Content object escaped its store.');
    fs.mkdirSync(objectDir, { recursive: true });
    if (!fs.existsSync(objectPath)) fs.linkSync(files[0], objectPath);
    if (hashFile(objectPath) !== group.digest) throw new ResultStudioLifecycleError('dedup_object_hash_mismatch', 'Content object hash mismatch.');
    const objectStat = fs.statSync(objectPath);
    for (const file of files) {
      const stat = fs.statSync(file);
      if (stat.dev === objectStat.dev && stat.ino === objectStat.ino) continue;
      const temporary = path.join(path.dirname(file), `.biof3-dedupe-${crypto.randomUUID()}`);
      try {
        fs.linkSync(objectPath, temporary);
        fs.renameSync(temporary, file);
      } finally {
        if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
      }
      if (hashFile(file) !== group.digest) throw new ResultStudioLifecycleError('dedup_postcondition_failed', 'Deduplicated Artifact failed its hash postcondition.');
      linked.push({ revisionId: group.entries[files.indexOf(file)].revisionId, outputPath: group.entries[files.indexOf(file)].outputPath, digest: group.digest });
    }
  }
  return { ...plan, mode: 'executed', linkedCount: linked.length, linked };
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
    const actual = adapter.revParse(changeSet.workingBranchRef);
    if (actual && (!changeSet.candidateCommit || actual === changeSet.candidateCommit)) {
      entries.push({ kind: 'candidate_ref', ref: changeSet.workingBranchRef, expectedCommit: actual, changeSetId: changeSet.changeSetId });
    }
  }
  return entries;
}

function planResultStudioGc(input = {}, dependencies = {}) {
  const entries = listGcEntries({ ...input, repository: dependencies.repository, adapter: dependencies.adapter });
  const reachability = dependencies.repository.analyzeRevisionReachability(input.projectId);
  const tokenPayload = entries.map((entry) => entry.kind === 'candidate_ref' ? `${entry.kind}:${entry.ref}:${entry.expectedCommit}` : `${entry.kind}:${entry.relativePath}`).sort().join('\n');
  return {
    gcPlanVersion: 1,
    projectId: input.projectId,
    mode: 'dry_run',
    entries,
    planToken: sha256(`${input.projectId}\0${tokenPayload}`),
    protectedRevisionCount: reachability.reachable.length,
    unreachableRevisionMetadataCount: reachability.gcCandidates.length,
    artifactDeletionCount: 0,
    note: 'GC never deletes Artifact files or Revision history; it removes only closed private staging and matching internal candidate refs.',
  };
}

function executeResultStudioGc(input = {}, dependencies = {}) {
  const plan = planResultStudioGc(input, dependencies);
  if (!input.planToken || input.planToken !== plan.planToken) throw new ResultStudioLifecycleError('gc_plan_stale', 'GC plan token is missing or stale.');
  const privateRoot = path.join(path.resolve(input.workspaceRoot), '.biof3', 'revision');
  const removed = [];
  for (const entry of plan.entries) {
    if (entry.kind === 'candidate_ref') {
      const actual = dependencies.adapter.revParse(entry.ref);
      if (actual !== entry.expectedCommit) throw new ResultStudioLifecycleError('gc_ref_drift', 'Candidate ref changed after GC planning.');
      dependencies.adapter.deleteRefCas({ ref: entry.ref, expectedOld: actual });
    } else {
      const absolute = path.resolve(input.workspaceRoot, entry.relativePath);
      if (!isPathContained(privateRoot, absolute)) throw new ResultStudioLifecycleError('gc_path_escape', 'GC target escaped private staging.');
      fs.rmSync(absolute, { recursive: true, force: false });
    }
    removed.push(entry);
  }
  return { ...plan, mode: 'executed', removedCount: removed.length, removed };
}

function evaluatePreviewResourceBudget({ resourceSnapshot = {}, estimatedMemoryBytes = 0, estimatedDiskBytes = 0, activePreviewJobs = 0, maxBackgroundPreviews = 2 } = {}) {
  const memory = Number(resourceSnapshot.memory?.availableBytes || 0);
  const disk = Number(resourceSnapshot.disk?.availableBytes || 0);
  const requestedMemory = Math.max(0, Number(estimatedMemoryBytes || 0));
  const requestedDisk = Math.max(0, Number(estimatedDiskBytes || 0));
  const reasons = [];
  if ((resourceSnapshot.state || resourceSnapshot.status) === 'unavailable') reasons.push('resource_snapshot_unavailable');
  if (memory > 0 && requestedMemory > memory * 0.7) reasons.push('memory_budget_exceeded');
  if (disk > 0 && requestedDisk > disk * 0.8) reasons.push('disk_budget_exceeded');
  if (activePreviewJobs >= maxBackgroundPreviews) reasons.push('preview_concurrency_saturated');
  const blocking = reasons.some((reason) => reason !== 'preview_concurrency_saturated');
  return {
    budgetVersion: 1,
    decision: blocking ? 'blocked' : reasons.length > 0 ? 'queued' : 'run_background',
    reasons,
    activePreviewJobs,
    maxBackgroundPreviews,
    scientificParametersChanged: false,
  };
}

function detectDelimiter(header, filePath) {
  if (/\.tsv$/i.test(filePath)) return '\t';
  return (header.match(/\t/g) || []).length > (header.match(/,/g) || []).length ? '\t' : ',';
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; continue; }
      quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells;
}

function readTablePage({ filePath, cursor = 0, limit = 100 } = {}) {
  const boundedLimit = Number.isInteger(limit) && limit > 0 && limit <= MAX_TABLE_PAGE_ROWS ? limit : 100;
  const boundedCursor = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
  const stat = fs.statSync(filePath);
  const headerHandle = fs.openSync(filePath, 'r');
  let header = '';
  try {
    const buffer = Buffer.alloc(Math.min(64 * 1024, stat.size));
    const read = fs.readSync(headerHandle, buffer, 0, buffer.length, 0);
    header = buffer.subarray(0, read).toString('utf8').split(/\r?\n/, 1)[0];
  } finally { fs.closeSync(headerHandle); }
  const delimiter = detectDelimiter(header, filePath);
  const columns = splitDelimitedLine(header, delimiter);
  const handle = fs.openSync(filePath, 'r');
  let raw = '';
  let read = 0;
  try {
    const buffer = Buffer.alloc(Math.min(MAX_TABLE_PAGE_BYTES, Math.max(0, stat.size - boundedCursor)));
    read = fs.readSync(handle, buffer, 0, buffer.length, boundedCursor);
    raw = buffer.subarray(0, read).toString('utf8');
  } finally { fs.closeSync(handle); }
  let startOffset = 0;
  if (boundedCursor === 0) {
    const headerEnd = raw.indexOf('\n');
    startOffset = headerEnd >= 0 ? headerEnd + 1 : raw.length;
  }
  const body = raw.slice(startOffset);
  const completeTo = boundedCursor + read < stat.size ? body.lastIndexOf('\n') : body.length;
  const completeBody = completeTo >= 0 ? body.slice(0, completeTo) : '';
  const lines = completeBody.split(/\r?\n/).filter((line) => line.length > 0);
  const pageLines = lines.slice(0, boundedLimit);
  const rows = pageLines.map((line) => splitDelimitedLine(line, delimiter));
  let consumedBodyChars = 0;
  for (let index = 0; index < pageLines.length; index += 1) {
    const newline = body.indexOf('\n', consumedBodyChars);
    consumedBodyChars = newline >= 0 ? newline + 1 : body.length;
  }
  const consumedBytes = Buffer.byteLength(raw.slice(0, startOffset + consumedBodyChars));
  const nextCursor = boundedCursor + consumedBytes < stat.size ? boundedCursor + consumedBytes : null;
  const serializedBytes = Buffer.byteLength(JSON.stringify(rows));
  if (serializedBytes > MAX_TABLE_PAGE_BYTES) throw new ResultStudioLifecycleError('table_page_too_large', 'Requested table page exceeds the bounded response budget.');
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
    caveat: 'RFC4180 multiline cells are not supported by the lightweight progressive reader.',
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
