'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isPathContained } = require('./project-run-layout');
const { stableStringify } = require('./scientific-task-spec');
const { saveResultEditCheckpoint } = require('./result-changeset-service');

const RESULT_COMPARE_SERVICE_VERSION = 1;
const ZERO_OID = '0'.repeat(40);
const MAX_PATCH_CHARS = 200000;
const MAX_JSON_FIELDS = 500;
const MAX_TABLE_BYTES = 4 * 1024 * 1024;
const MAX_TABLE_SAMPLE_ROWS = 20;

class ResultCompareError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultCompareError';
    this.code = code;
    this.detail = detail;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function stableJson(value) {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`;
}

function projectGitPath(relativePath, gitPathPrefix = '') {
  const prefix = String(gitPathPrefix || '').replace(/^\/+|\/+$/g, '');
  return prefix ? path.posix.join(prefix, relativePath) : relativePath;
}

function boundedText(value, limit = 2000) {
  const text = String(value == null ? '' : value);
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function countPatch(patch) {
  let additions = 0;
  let deletions = 0;
  for (const line of String(patch || '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

function flattenJson(value, prefix = '', output = {}, state = { truncated: false }) {
  if (Object.keys(output).length >= MAX_JSON_FIELDS) {
    state.truncated = true;
    return { fields: output, truncated: true };
  }
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((entry, index) => flattenJson(entry, `${prefix}[${index}]`, output, state));
    if (value.length > 100) state.truncated = true;
    return { fields: output, truncated: state.truncated };
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (keys.length === 0 && prefix) output[prefix] = {};
    for (const key of keys) {
      if (Object.keys(output).length >= MAX_JSON_FIELDS) { state.truncated = true; break; }
      flattenJson(value[key], prefix ? `${prefix}.${key}` : key, output, state);
    }
    return { fields: output, truncated: state.truncated };
  }
  if (prefix) output[prefix] = typeof value === 'string' ? boundedText(value, 500) : value;
  return { fields: output, truncated: state.truncated };
}

function compareJsonValues(beforeText, afterText, relativePath) {
  let before;
  let after;
  try {
    before = beforeText == null ? null : JSON.parse(beforeText);
    after = afterText == null ? null : JSON.parse(afterText);
  } catch {
    return { relativePath, status: 'unavailable', reason: 'json_parse_failed', changes: [], truncated: false };
  }
  const left = flattenJson(before);
  const right = flattenJson(after);
  const keys = [...new Set([...Object.keys(left.fields), ...Object.keys(right.fields)])].sort();
  const changes = [];
  for (const key of keys) {
    const a = left.fields[key];
    const b = right.fields[key];
    if (stableStringify(a) === stableStringify(b)) continue;
    changes.push({
      field: key,
      changeType: !(key in left.fields) ? 'added' : !(key in right.fields) ? 'removed' : 'changed',
      before: a === undefined ? null : a,
      after: b === undefined ? null : b,
    });
    if (changes.length >= MAX_JSON_FIELDS) break;
  }
  return {
    relativePath,
    status: 'available',
    changes,
    truncated: left.truncated || right.truncated || changes.length >= MAX_JSON_FIELDS,
  };
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
      continue;
    }
    if (char === delimiter && !quoted) { cells.push(current); current = ''; continue; }
    current += char;
  }
  cells.push(current);
  return cells;
}

function readTableSummary(filePath) {
  const stat = fs.statSync(filePath);
  const truncated = stat.size > MAX_TABLE_BYTES;
  const length = Math.min(stat.size, MAX_TABLE_BYTES);
  const handle = fs.openSync(filePath, 'r');
  let raw;
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(handle, buffer, 0, length, 0);
    raw = buffer.subarray(0, read).toString('utf8');
  } finally {
    fs.closeSync(handle);
  }
  if (truncated) raw = raw.slice(0, Math.max(0, raw.lastIndexOf('\n')));
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');
  const delimiter = /\.tsv$/i.test(filePath)
    ? '\t'
    : ((lines[0]?.match(/\t/g) || []).length > (lines[0]?.match(/,/g) || []).length ? '\t' : ',');
  const columns = lines[0] ? splitDelimitedLine(lines[0], delimiter).map((cell) => cell.trim()) : [];
  const rows = lines.slice(1, 1 + MAX_TABLE_SAMPLE_ROWS).map((line) => splitDelimitedLine(line, delimiter));
  return {
    columns,
    rowCount: Math.max(0, lines.length - 1),
    rowCountIsLowerBound: truncated,
    sampleRows: rows,
    bytes: stat.size,
    truncated,
  };
}

function compareTables(beforePath, afterPath) {
  const before = readTableSummary(beforePath);
  const after = readTableSummary(afterPath);
  const beforeColumns = new Set(before.columns);
  const afterColumns = new Set(after.columns);
  const sampleChanges = [];
  const limit = Math.min(MAX_TABLE_SAMPLE_ROWS, Math.max(before.sampleRows.length, after.sampleRows.length));
  for (let index = 0; index < limit; index += 1) {
    const left = before.sampleRows[index] || null;
    const right = after.sampleRows[index] || null;
    if (stableStringify(left) !== stableStringify(right)) sampleChanges.push({ row: index + 1, before: left, after: right });
  }
  return {
    status: 'available',
    before: { columns: before.columns, rowCount: before.rowCount, rowCountIsLowerBound: before.rowCountIsLowerBound, bytes: before.bytes },
    after: { columns: after.columns, rowCount: after.rowCount, rowCountIsLowerBound: after.rowCountIsLowerBound, bytes: after.bytes },
    addedColumns: after.columns.filter((column) => !beforeColumns.has(column)),
    removedColumns: before.columns.filter((column) => !afterColumns.has(column)),
    sampleChanges,
    truncated: before.truncated || after.truncated,
  };
}

function resolveRevisionFile(workspaceRoot, revision) {
  const workspace = fs.realpathSync(workspaceRoot);
  const file = fs.realpathSync(path.join(workspace, revision.outputPath));
  if (!isPathContained(workspace, file)) throw new ResultCompareError('artifact_path_escape', 'Revision Artifact escaped the project.');
  const actualHash = sha256(fs.readFileSync(file));
  if (!revision.outputHash || actualHash !== revision.outputHash) {
    throw new ResultCompareError('artifact_hash_mismatch', 'Revision Artifact hash no longer matches its immutable record.');
  }
  return file;
}

function compareResultChangeSet(input = {}, dependencies = {}) {
  const { repository, adapter } = dependencies;
  if (!repository || !adapter) throw new ResultCompareError('compare_dependencies_missing', 'Repository and Git adapter are required.');
  const changeSet = repository.getChangeSet(input.changeSetId);
  if (!changeSet || changeSet.projectId !== input.projectId) throw new ResultCompareError('change_set_not_found', 'ChangeSet was not found in the active project.');
  const revisions = repository.listRevisionsByChangeSet(changeSet.changeSetId);
  const changedPaths = changeSet.changedPaths.map((entry) => entry.relativePath).filter(Boolean);
  const gitPaths = changedPaths.map((relativePath) => projectGitPath(relativePath, dependencies.gitPathPrefix));
  let rawPatch = '';
  if (changeSet.candidateCommit && changeSet.baseCommit && gitPaths.length > 0) {
    rawPatch = adapter.diff({ paths: gitPaths, fromRef: changeSet.baseCommit, toRef: changeSet.candidateCommit }).patch;
  }
  const patchCounts = countPatch(rawPatch);
  const patchTruncated = rawPatch.length > MAX_PATCH_CHARS;
  const patch = patchTruncated ? `${rawPatch.slice(0, MAX_PATCH_CHARS)}\n…[truncated]` : rawPatch;
  const jsonDiffs = [];
  for (const relativePath of changedPaths.filter((item) => /\.json$/i.test(item))) {
    const gitPath = projectGitPath(relativePath, dependencies.gitPathPrefix);
    const before = changeSet.baseCommit ? adapter.showFile({ ref: changeSet.baseCommit, filePath: gitPath }) : null;
    const after = changeSet.candidateCommit ? adapter.showFile({ ref: changeSet.candidateCommit, filePath: gitPath }) : null;
    jsonDiffs.push(compareJsonValues(before, after, relativePath));
  }

  const artifacts = [];
  for (const revision of revisions) {
    if (revision.projectId !== input.projectId) {
      throw new ResultCompareError('revision_project_mismatch', 'ChangeSet contains a Revision from another project.');
    }
    const parent = revision.parentRevisionIds.map((id) => repository.getRevision(id)).find(Boolean) || null;
    const ext = path.extname(revision.outputPath).toLowerCase();
    const kind = ['.csv', '.tsv'].includes(ext)
      ? 'table'
      : ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext) ? 'visual' : 'binary';
    const entry = {
      artifactId: revision.artifactId,
      artifactFamilyId: revision.artifactFamilyId,
      kind,
      beforeRevisionId: parent?.revisionId || null,
      afterRevisionId: revision.revisionId,
      beforeHash: parent?.outputHash || null,
      afterHash: revision.outputHash,
      validationStatus: revision.validationStatus,
      table: null,
    };
    if (kind === 'table' && parent) {
      try {
        entry.table = compareTables(
          resolveRevisionFile(input.workspaceRoot, parent),
          resolveRevisionFile(input.workspaceRoot, revision)
        );
      } catch (error) {
        entry.table = { status: 'unavailable', reason: error.code || 'table_compare_failed' };
      }
    }
    artifacts.push(entry);
  }
  const histories = revisions.map((revision) => ({
    artifactFamilyId: revision.artifactFamilyId,
    revisions: repository.listRevisions({ artifactFamilyId: revision.artifactFamilyId, projectId: input.projectId, limit: 100 }),
    currentRevisionId: repository.getCurrentRevision(revision.artifactFamilyId, input.projectId)?.revisionId || null,
  }));
  return {
    resultCompareServiceVersion: RESULT_COMPARE_SERVICE_VERSION,
    changeSet,
    summary: {
      status: changeSet.status,
      createdBy: changeSet.createdBy,
      changedFileCount: changedPaths.length,
      additions: patchCounts.additions,
      deletions: patchCounts.deletions,
      candidateRevisionCount: revisions.length,
      validationStatus: revisions.some((revision) => revision.validationStatus === 'blocked')
        ? 'blocked'
        : revisions.some((revision) => revision.validationStatus === 'degraded') ? 'degraded' : 'valid',
    },
    textDiff: { patch, truncated: patchTruncated, ...patchCounts },
    jsonDiffs,
    artifacts,
    histories,
    git: {
      baseCommit: changeSet.baseCommit,
      candidateCommit: changeSet.candidateCommit,
      workingBranchRef: changeSet.workingBranchRef,
    },
  };
}

function verifyRevisionForAdoption({ revision, parent, workspaceRoot, adapter, gitPathPrefix, getToolJob, candidateCommit }) {
  if (!parent) throw new ResultCompareError('parent_revision_missing', 'Candidate Revision has no recoverable parent.');
  if (revision.projectId !== parent.projectId || revision.artifactFamilyId !== parent.artifactFamilyId) {
    throw new ResultCompareError('parent_revision_mismatch', 'Candidate Revision parent belongs to another project or Artifact family.');
  }
  if (!candidateCommit || revision.sourceCommit !== candidateCommit) {
    throw new ResultCompareError('candidate_source_commit_mismatch', 'Candidate Revision is not bound to the ChangeSet candidate commit.');
  }
  resolveRevisionFile(workspaceRoot, revision);
  const sourcePath = projectGitPath(revision.sourceScriptRef?.relativePath, gitPathPrefix);
  const sourceText = revision.sourceCommit && sourcePath
    ? adapter.showFile({ ref: revision.sourceCommit, filePath: sourcePath })
    : null;
  if (sourceText == null || sha256(sourceText) !== revision.sourceScriptRef?.sha256) {
    throw new ResultCompareError('candidate_script_hash_mismatch', 'Candidate script does not match its Git commit.');
  }
  const parametersPath = revision.parametersRef ? projectGitPath(revision.parametersRef, gitPathPrefix) : null;
  const parametersText = revision.sourceCommit && parametersPath
    ? adapter.showFile({ ref: revision.sourceCommit, filePath: parametersPath })
    : null;
  if (parametersText == null || !revision.parametersHash || sha256(parametersText) !== revision.parametersHash) {
    throw new ResultCompareError('candidate_parameters_hash_mismatch', 'Candidate parameters do not match their Git commit.');
  }
  const job = typeof getToolJob === 'function' ? getToolJob(revision.toolJobId) : null;
  if (!job || job.status !== 'completed' || String(job.project_id || job.projectId || '') !== revision.projectId
    || job.result?.artifactTruth?.status !== 'valid' || job.result?.artifactTruth?.blocking === true) {
    throw new ResultCompareError('candidate_job_truth_invalid', 'Candidate Job or Artifact Truth is not adoptable.');
  }
}

function updateCurrentRefs({ repository, adapter, revisions, targetCommits }) {
  const updated = [];
  try {
    for (const revision of revisions) {
      const ref = `refs/heads/biof3/current/${revision.artifactFamilyId}`;
      const existing = adapter.revParse(ref);
      const expectedCommit = targetCommits.expected(revision);
      if (existing && expectedCommit && existing !== expectedCommit) {
        throw new ResultCompareError('current_git_ref_stale', 'Current Git ref does not match the persisted Revision.', { ref });
      }
      const previous = existing || ZERO_OID;
      const next = targetCommits.next(revision);
      adapter.updateRefCas({ ref, newCommit: next, expectedOld: previous });
      updated.push({ ref, previous, next });
    }
    return updated;
  } catch (error) {
    for (const entry of updated.reverse()) {
      try {
        if (entry.previous === ZERO_OID) {
          adapter.deleteRefCas?.({ ref: entry.ref, expectedOld: entry.next });
        } else {
          adapter.updateRefCas({ ref: entry.ref, newCommit: entry.previous, expectedOld: entry.next });
        }
      } catch { /* recovery audit will surface ref drift */ }
    }
    throw error;
  }
}

function adoptResultChangeSet(input = {}, dependencies = {}) {
  const { repository, adapter, getToolJob } = dependencies;
  if (!repository || !adapter) throw new ResultCompareError('adopt_dependencies_missing', 'Repository and Git adapter are required.');
  const changeSet = repository.getChangeSet(input.changeSetId);
  if (!changeSet || changeSet.projectId !== input.projectId) throw new ResultCompareError('change_set_not_found', 'ChangeSet was not found in the active project.');
  if (changeSet.status === 'adopted') return { ...repository.adoptChangeSet({ changeSetId: changeSet.changeSetId }), currentRevisions: repository.listRevisionsByChangeSet(changeSet.changeSetId) };
  if (changeSet.status !== 'preview_ready' || !changeSet.candidateCommit) {
    throw new ResultCompareError('change_set_not_adoptable', 'Only a validated preview can be adopted.');
  }
  if (adapter.revParse(changeSet.workingBranchRef) !== changeSet.candidateCommit) {
    throw new ResultCompareError('candidate_git_ref_mismatch', 'Candidate Git ref no longer matches the ChangeSet.');
  }
  const revisions = repository.listRevisionsByChangeSet(changeSet.changeSetId);
  if (revisions.length === 0) throw new ResultCompareError('change_set_has_no_revision', 'ChangeSet has no candidate Revision.');
  const parents = new Map();
  for (const revision of revisions) {
    if (revision.projectId !== input.projectId) {
      throw new ResultCompareError('revision_project_mismatch', 'ChangeSet contains a Revision from another project.');
    }
    const parent = revision.parentRevisionIds.map((id) => repository.getRevision(id)).find(Boolean) || null;
    const current = repository.getCurrentRevision(revision.artifactFamilyId, input.projectId);
    if (!parent || !current || current.revisionId !== parent.revisionId) {
      throw new ResultCompareError('adoption_base_stale', 'Current result changed after this preview was created.');
    }
    verifyRevisionForAdoption({
      revision,
      parent,
      workspaceRoot: input.workspaceRoot,
      adapter,
      gitPathPrefix: dependencies.gitPathPrefix,
      getToolJob,
      candidateCommit: changeSet.candidateCommit,
    });
    parents.set(revision.revisionId, parent);
  }
  let refUpdates = [];
  try {
    const adopted = repository.adoptChangeSet({
      changeSetId: changeSet.changeSetId,
      candidateCommit: changeSet.candidateCommit,
      beforeCommit: ({ revisions: candidateRevisions }) => {
        refUpdates = updateCurrentRefs({
          repository,
          adapter,
          revisions: candidateRevisions,
          targetCommits: {
            expected: (revision) => parents.get(revision.revisionId)?.sourceCommit || null,
            next: () => changeSet.candidateCommit,
          },
        });
        // Checkpoint is part of the same SQLite transaction as status/current.
        // If it fails, better-sqlite3 rolls back and the outer catch restores
        // the Git refs changed above.
        saveResultEditCheckpoint({
          repository,
          projectId: changeSet.projectId,
          conversationId: changeSet.conversationId,
          changeSetId: changeSet.changeSetId,
          candidateCommit: changeSet.candidateCommit,
          stage: 'adopted',
        });
      },
    });
    const currentRevisions = revisions.map((revision) => repository.getRevision(revision.revisionId));
    return { ...adopted, currentRevisions };
  } catch (error) {
    for (const entry of refUpdates.reverse()) {
      try {
        if (entry.previous === ZERO_OID) adapter.deleteRefCas?.({ ref: entry.ref, expectedOld: entry.next });
        else adapter.updateRefCas({ ref: entry.ref, newCommit: entry.previous, expectedOld: entry.next });
      } catch { /* fail closed; reconciliation can repair a ref-only residue */ }
    }
    throw error;
  }
}

function revertResultChangeSet(input = {}, dependencies = {}) {
  const { repository, adapter } = dependencies;
  if (!repository || !adapter) throw new ResultCompareError('revert_dependencies_missing', 'Repository and Git adapter are required.');
  const changeSet = repository.getChangeSet(input.changeSetId);
  if (!changeSet || changeSet.projectId !== input.projectId) throw new ResultCompareError('change_set_not_found', 'ChangeSet was not found in the active project.');
  if (String(changeSet.intentRef || '').startsWith('baseline:')) {
    throw new ResultCompareError('baseline_revert_forbidden', 'The root baseline cannot be reverted; restore or adopt another Revision instead.');
  }
  if (changeSet.status === 'reverted') return repository.revertChangeSet({ changeSetId: changeSet.changeSetId, reason: input.reason || null });
  const revisions = repository.listRevisionsByChangeSet(changeSet.changeSetId);
  if (changeSet.status === 'adopted') {
    for (const revision of revisions) {
      const current = repository.getCurrentRevision(revision.artifactFamilyId, input.projectId);
      if (!current || current.revisionId !== revision.revisionId) {
        throw new ResultCompareError('revert_not_current', 'A newer Revision is current; restore history instead of reverting this ChangeSet.');
      }
    }
  }
  let refUpdates = [];
  try {
    const reverted = repository.revertChangeSet({
      changeSetId: changeSet.changeSetId,
      reason: input.reason || 'user_reverted',
      beforeCommit: ({ revisions: revertedRevisions, restoredRevisions }) => {
        if (changeSet.status !== 'adopted') {
          const existing = adapter.revParse(changeSet.workingBranchRef);
          if (existing && changeSet.candidateCommit && existing !== changeSet.candidateCommit) {
            throw new ResultCompareError('candidate_git_ref_mismatch', 'Candidate Git ref changed before discard.');
          }
          if (existing) {
            adapter.deleteRefCas({ ref: changeSet.workingBranchRef, expectedOld: existing });
            refUpdates.push({ ref: changeSet.workingBranchRef, previous: existing, next: ZERO_OID, deleted: true });
          }
          saveResultEditCheckpoint({
            repository,
            projectId: changeSet.projectId,
            conversationId: changeSet.conversationId,
            changeSetId: changeSet.changeSetId,
            candidateCommit: changeSet.candidateCommit,
            stage: 'reverted',
          });
          return;
        }
        const restoredByFamily = new Map(restoredRevisions.map((revision) => [revision.artifactFamilyId, revision]));
        refUpdates = updateCurrentRefs({
          repository,
          adapter,
          revisions: revertedRevisions,
          targetCommits: {
            expected: () => changeSet.candidateCommit,
            next: (revision) => {
              const restored = restoredByFamily.get(revision.artifactFamilyId);
              if (!restored?.sourceCommit) throw new ResultCompareError('restore_commit_missing', 'Previous Revision has no source commit.');
              return restored.sourceCommit;
            },
          },
        });
        saveResultEditCheckpoint({
          repository,
          projectId: changeSet.projectId,
          conversationId: changeSet.conversationId,
          changeSetId: changeSet.changeSetId,
          candidateCommit: changeSet.candidateCommit,
          stage: 'reverted',
        });
      },
    });
    if (changeSet.status !== 'adopted' && input.workspaceRoot) {
      const revisionRoot = path.join(path.resolve(input.workspaceRoot), '.biof3', 'revision');
      const staging = path.join(revisionRoot, changeSet.changeSetId);
      if (isPathContained(revisionRoot, staging)) {
        try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* RS8 GC can remove a residue */ }
      }
    }
    return reverted;
  } catch (error) {
    for (const entry of refUpdates.reverse()) {
      try {
        if (entry.deleted) adapter.updateRefCas({ ref: entry.ref, newCommit: entry.previous, expectedOld: ZERO_OID });
        else adapter.updateRefCas({ ref: entry.ref, newCommit: entry.previous, expectedOld: entry.next });
      } catch { /* audited later */ }
    }
    throw error;
  }
}

function restoreArtifactRevision(input = {}, dependencies = {}) {
  const { repository, adapter, getToolJob } = dependencies;
  if (!repository || !adapter) throw new ResultCompareError('restore_dependencies_missing', 'Repository and Git adapter are required.');
  const target = repository.getRevision(input.revisionId);
  if (!target || target.projectId !== input.projectId) throw new ResultCompareError('revision_not_found', 'Revision was not found in the active project.');
  if (target.validationStatus === 'blocked') {
    throw new ResultCompareError('revision_not_restorable', 'A blocked Revision cannot become the formal result.');
  }
  const current = repository.getCurrentRevision(target.artifactFamilyId, input.projectId);
  if (!current) throw new ResultCompareError('current_revision_missing', 'Artifact family has no current Revision.');
  if (current.revisionId === target.revisionId) return { restored: false, idempotent: true, revision: current };
  const currentChangeSet = repository.getChangeSet(current.changeSetId);
  if (currentChangeSet?.intentRef === `restore:${target.revisionId}`) {
    return { restored: false, idempotent: true, revision: current, changeSet: currentChangeSet };
  }
  resolveRevisionFile(input.workspaceRoot, target);
  const sourceGitPath = target.sourceScriptRef?.relativePath
    ? projectGitPath(target.sourceScriptRef.relativePath, dependencies.gitPathPrefix)
    : null;
  const parametersGitPath = target.parametersRef
    ? projectGitPath(target.parametersRef, dependencies.gitPathPrefix)
    : null;
  const sourceContent = target.sourceCommit && sourceGitPath
    ? adapter.showFile({ ref: target.sourceCommit, filePath: sourceGitPath })
    : null;
  const parametersContent = target.sourceCommit && parametersGitPath
    ? adapter.showFile({ ref: target.sourceCommit, filePath: parametersGitPath })
    : null;
  if (sourceContent == null || sha256(sourceContent) !== target.sourceScriptRef?.sha256
      || parametersContent == null || !target.parametersHash || sha256(parametersContent) !== target.parametersHash) {
    throw new ResultCompareError('restore_material_unavailable', 'Historical script or parameters cannot be verified in Git.');
  }
  const revisionId = randomId('rev');
  const changeSetId = randomId('cs');
  const extension = path.extname(target.sourceScriptRef.relativePath) || '.R';
  const base = path.posix.join('analysis/scripts', target.artifactFamilyId, revisionId);
  const scriptRelativePath = path.posix.join(base, `${target.artifactId}${extension}`);
  const parametersRelativePath = path.posix.join(base, 'parameters.json');
  const manifestRelativePath = path.posix.join(base, 'materialization.json');
  const manifestContent = stableJson({
    resultStudioMaterializationVersion: 1,
    restore: true,
    changeSetId,
    revisionId,
    restoredFromRevisionId: target.revisionId,
    parentRevisionId: current.revisionId,
    artifactFamilyId: target.artifactFamilyId,
    artifactId: target.artifactId,
    scriptRelativePath,
    scriptSha256: sha256(sourceContent),
    parametersRelativePath,
    parametersSha256: sha256(parametersContent),
  });
  const workingBranchRef = `refs/heads/biof3/changeset/${changeSetId}`;
  repository.createChangeSet({
    changeSetId,
    projectId: input.projectId,
    conversationId: input.conversationId || null,
    intentRef: `restore:${target.revisionId}`,
    baseCommit: current.sourceCommit,
    workingBranchRef,
    createdBy: input.createdBy === 'agent' ? 'agent' : 'user',
    parentArtifactRefs: [current.revisionId],
  });
  repository.transitionChangeSet({ changeSetId, to: 'running' });
  try {
    const files = [
      { path: scriptRelativePath, content: sourceContent },
      { path: parametersRelativePath, content: parametersContent },
      { path: manifestRelativePath, content: manifestContent },
    ].map((file) => ({ ...file, path: projectGitPath(file.path, dependencies.gitPathPrefix) }));
    const candidate = adapter.commitVirtualFiles({
      parentCommit: current.sourceCommit,
      ref: workingBranchRef,
      expectedOld: ZERO_OID,
      message: `BioF3 restore ${target.revisionId} as ${revisionId}`,
      files,
    });
    const revision = repository.appendRevision({
      revisionId,
      projectId: input.projectId,
      artifactFamilyId: target.artifactFamilyId,
      artifactId: target.artifactId,
      parentRevisionIds: [current.revisionId],
      sourceCommit: candidate.commit,
      sourceScriptRef: {
        ...target.sourceScriptRef,
        relativePath: scriptRelativePath,
        sha256: sha256(sourceContent),
        entryPoint: path.posix.basename(scriptRelativePath),
        origin: 'project_materialized',
      },
      inputArtifactRefs: target.inputArtifactRefs,
      parametersRef: parametersRelativePath,
      parametersHash: sha256(parametersContent),
      toolJobId: target.toolJobId,
      outputPath: target.outputPath,
      outputHash: target.outputHash,
      validationStatus: target.validationStatus,
      reproducibilityStatus: target.reproducibilityStatus,
      changeSetId,
    });
    repository.transitionChangeSet({
      changeSetId,
      to: 'preview_ready',
      candidateCommit: candidate.commit,
      changedPaths: [
        { relativePath: scriptRelativePath, changeType: 'added', beforeHash: current.sourceScriptRef?.sha256 || null, afterHash: revision.sourceScriptRef.sha256 },
        { relativePath: parametersRelativePath, changeType: 'added', beforeHash: current.parametersHash, afterHash: revision.parametersHash },
        { relativePath: manifestRelativePath, changeType: 'added', beforeHash: null, afterHash: sha256(manifestContent) },
      ],
      jobRefs: [target.toolJobId],
      candidateArtifactRefs: [revision.revisionId],
      validationSummary: {
        restore: true,
        restoredFromRevisionId: target.revisionId,
        artifactTruthStatus: target.validationStatus,
        intentSummary: `恢复 v${target.revisionOrdinal} 为新的正式版本`,
        impactLevel: 'version_restore',
        affectedScope: 'current_result_only',
        requiresJob: false,
        affectedNodeCount: 0,
      },
    });
    const adopted = adoptResultChangeSet({
      projectId: input.projectId,
      workspaceRoot: input.workspaceRoot,
      changeSetId,
    }, { ...dependencies, getToolJob });
    return { restored: true, idempotent: false, changeSet: adopted.changeSet, revision: repository.getRevision(revision.revisionId) };
  } catch (error) {
    const changeSet = repository.getChangeSet(changeSetId);
    if (changeSet?.status === 'running') {
      try { repository.transitionChangeSet({ changeSetId, to: 'validation_failed', reason: error.code || 'restore_failed' }); } catch { /* recovery scan */ }
    }
    throw error;
  }
}

module.exports = {
  RESULT_COMPARE_SERVICE_VERSION,
  ResultCompareError,
  countPatch,
  compareJsonValues,
  compareTables,
  compareResultChangeSet,
  adoptResultChangeSet,
  revertResultChangeSet,
  restoreArtifactRevision,
};
