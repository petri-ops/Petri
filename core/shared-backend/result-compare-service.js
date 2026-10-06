'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isPathContained } = require('./project-run-layout');
const { stableStringify } = require('./canonical-json');
const { buildResultEditCheckpoint } = require('./result-changeset-service');
const { compareScientificTables } = require('./result-scientific-compare');
const { buildResultStudioTaskResourceSummary } = require('./result-studio-resource-summary');
const { executeDurableRefTransaction } = require('./result-ref-transaction');
const { removePrivatePathSync } = require('./result-studio-private-path');
const {
  validateRestoreWorkflowScope,
  rebindWorkflowGraphForEquivalentRestore,
} = require('./result-workflow-graph');

const RESULT_COMPARE_SERVICE_VERSION = 1;
const ZERO_OID = '0'.repeat(40);
const MAX_PATCH_CHARS = 200000;
const MAX_JSON_FIELDS = 500;
const MAX_TABLE_BYTES = 4 * 1024 * 1024;
const MAX_TABLE_SAMPLE_ROWS = 20;
const PUBLIC_INTERNAL_ID = /^(?:rev|cs|tj|sel|conv|p)_[a-z0-9_-]{6,}$/i;
const PUBLIC_INTERNAL_ID_EMBEDDED = /\b(?:rev|cs|tj|sel|conv|p)_[a-z0-9_-]{6,}\b/gi;
const PUBLIC_SENSITIVE_FIELD = /(?:api.?key|access.?token|secret|password|credential|private.?key)/i;

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

function publicComparisonValue(value, field = '') {
  if (PUBLIC_SENSITIVE_FIELD.test(field)) return '[redacted]';
  if (typeof value === 'string') {
    if (path.isAbsolute(value)) return '[project file]';
    if (PUBLIC_INTERNAL_ID.test(value)) return '[internal reference]';
    return value.replace(PUBLIC_INTERNAL_ID_EMBEDDED, '[internal reference]');
  }
  if (Array.isArray(value)) return value.map((item) => publicComparisonValue(item, field));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, publicComparisonValue(child, key)]));
  }
  return value;
}

function redactWindowsCoordinates(value) {
  let output = '';
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    const startsCoordinate = ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
      && value[index + 1] === ':' && value.charCodeAt(index + 2) === 92;
    if (!startsCoordinate) {
      output += value[index];
      index += 1;
      continue;
    }
    const quote = index > 0 && (value[index - 1] === '"' || value[index - 1] === "'")
      ? value[index - 1]
      : null;
    let end = index + 3;
    while (end < value.length) {
      const character = value[end];
      if (character === '\r' || character === '\n'
          || (quote ? character === quote : /\s|["'`<>]/.test(character))) break;
      end += 1;
    }
    output += '[project file]';
    index = end;
  }
  return output;
}

function publicPatch(rawPatch) {
  return redactWindowsCoordinates(String(rawPatch || '')
    .replace(/^diff --git a\/(.+) b\/(.+)$/gm,
      (_line, before, after) => `diff ${path.posix.basename(before)} -> ${path.posix.basename(after)}`)
    .replace(/^--- (?:a\/)?(.+)$/gm, (_line, file) => `--- ${path.posix.basename(file)}`)
    .replace(/^\+\+\+ (?:b\/)?(.+)$/gm, (_line, file) => `+++ ${path.posix.basename(file)}`)
    .replace(/(["'])(?:\/Users\/|\/home\/)[^"'\r\n]*\1/g, '$1[project file]$1')
    .replace(/(?:\/Users\/|\/home\/)[^\s"'`<>]*/g, '[project file]')
    .replace(PUBLIC_INTERNAL_ID_EMBEDDED, '[internal reference]'));
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
      before: a === undefined ? null : publicComparisonValue(a, key),
      after: b === undefined ? null : publicComparisonValue(b, key),
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

function revisionParametersForComparison(revision, adapter, gitPathPrefix) {
  if (!revision?.sourceCommit || !revision.parametersRef || !revision.parametersHash) return null;
  const text = adapter.showFile({
    ref: revision.sourceCommit,
    filePath: projectGitPath(revision.parametersRef, gitPathPrefix),
  });
  if (text == null || sha256(text) !== revision.parametersHash) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function compareResultChangeSet(input = {}, dependencies = {}) {
  const { repository, adapter } = dependencies;
  if (!repository || !adapter) throw new ResultCompareError('compare_dependencies_missing', 'Repository and Git adapter are required.');
  const changeSet = repository.getChangeSet(input.changeSetId);
  if (!changeSet || changeSet.projectId !== input.projectId) throw new ResultCompareError('change_set_not_found', 'ChangeSet was not found in the active project.');
  const revisions = repository.listRevisionsByChangeSet(changeSet.changeSetId);
  const changedPaths = changeSet.changedPaths.map((entry) => entry.relativePath).filter(Boolean);
  // Structured JSON changes are projected below with path/identifier
  // redaction. Keeping their raw Git patch would duplicate that view and leak
  // staged absolute input coordinates into the ordinary Compare surface.
  const gitPaths = changedPaths
    .filter((relativePath) => !/\.json$/i.test(relativePath))
    .map((relativePath) => projectGitPath(relativePath, dependencies.gitPathPrefix));
  let rawPatch = '';
  if (changeSet.candidateCommit && changeSet.baseCommit && gitPaths.length > 0) {
    rawPatch = adapter.diff({ paths: gitPaths, fromRef: changeSet.baseCommit, toRef: changeSet.candidateCommit }).patch;
  }
  const patchCounts = countPatch(rawPatch);
  const safePatch = publicPatch(rawPatch);
  const patchTruncated = safePatch.length > MAX_PATCH_CHARS;
  const patch = patchTruncated ? `${safePatch.slice(0, MAX_PATCH_CHARS)}\n…[truncated]` : safePatch;
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
      scientific: null,
    };
    if (kind === 'table' && parent) {
      try {
        const beforePath = resolveRevisionFile(input.workspaceRoot, parent);
        const afterPath = resolveRevisionFile(input.workspaceRoot, revision);
        entry.table = compareTables(
          beforePath,
          afterPath
        );
        if (['deg_table', 'classified_table', 'go_bp_results', 'kegg_results'].includes(revision.artifactId)) {
          entry.scientific = compareScientificTables({
            artifactId: revision.artifactId,
            beforePath,
            afterPath,
            beforeParameters: revisionParametersForComparison(parent, adapter, dependencies.gitPathPrefix),
            afterParameters: revisionParametersForComparison(revision, adapter, dependencies.gitPathPrefix),
          });
        }
      } catch (error) {
        entry.table = { status: 'unavailable', reason: error.code || 'table_compare_failed' };
        if (['deg_table', 'classified_table', 'go_bp_results', 'kegg_results'].includes(revision.artifactId)) {
          entry.scientific = { status: 'unavailable', kind: 'unavailable', reason: error.code || 'scientific_compare_failed' };
        }
      }
    }
    artifacts.push(entry);
  }
  const histories = revisions.map((revision) => ({
    artifactFamilyId: revision.artifactFamilyId,
    revisions: repository.listRevisions({ artifactFamilyId: revision.artifactFamilyId, projectId: input.projectId, limit: 100 }),
    currentRevisionId: repository.getCurrentRevision(revision.artifactFamilyId, input.projectId)?.revisionId || null,
  }));
  const jobs = [...new Set(changeSet.jobRefs || [])]
    .map((jobId) => typeof dependencies.getToolJob === 'function' ? dependencies.getToolJob(jobId) : null)
    .filter((job) => job && String(job.project_id || job.projectId || '') === input.projectId);
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
    resourceSummary: buildResultStudioTaskResourceSummary({ jobs }),
    git: {
      baseCommit: changeSet.baseCommit,
      candidateCommit: changeSet.candidateCommit,
      workingBranchRef: changeSet.workingBranchRef,
    },
  };
}

function verifyRevisionForAdoption({ revision, parent, familyFirst = false, workspaceRoot, adapter, gitPathPrefix, getToolJob, candidateCommit }) {
  // BLOCK-143：family 首版（无父链、family 尚无 current）合法——parent 匹配校验仅在
  // 有 parent 时适用；文件存在/candidate commit/Job truth 校验与 parent 无关，照常。
  if (!parent && !familyFirst) throw new ResultCompareError('parent_revision_missing', 'Candidate Revision has no recoverable parent.');
  if (parent && (revision.projectId !== parent.projectId || revision.artifactFamilyId !== parent.artifactFamilyId)) {
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

function planCurrentRefUpdates({ adapter, revisions, expectedCommit, nextCommit }) {
  return revisions.map((revision) => {
    const ref = `refs/heads/biof3/current/${revision.artifactFamilyId}`;
    const existing = adapter.revParse(ref);
    const expected = expectedCommit(revision);
    if (existing && expected && existing !== expected) {
      throw new ResultCompareError(
        'current_git_ref_stale',
        'Current Git ref does not match the persisted Revision.',
        { ref },
      );
    }
    const newOid = nextCommit(revision);
    if (!newOid) {
      throw new ResultCompareError('current_git_ref_target_missing', 'Target Revision has no source commit.');
    }
    return { ref, expectedOld: existing || ZERO_OID, newOid };
  });
}

function currentRevisionIdsAfter({ repository, projectId, targetRevisions }) {
  const affectedFamilies = new Set(targetRevisions.map((revision) => revision.artifactFamilyId));
  return [
    ...repository.listCurrentRevisions(projectId)
      .filter((revision) => !affectedFamilies.has(revision.artifactFamilyId))
      .map((revision) => revision.revisionId),
    ...targetRevisions.map((revision) => revision.revisionId),
  ].sort();
}

function durableTransitionCheckpoint({
  repository,
  changeSet,
  targetStatus,
  targetCurrentRevisionIds,
}) {
  return buildResultEditCheckpoint({
    repository,
    projectId: changeSet.projectId,
    conversationId: changeSet.conversationId,
    changeSet,
    candidateCommit: changeSet.candidateCommit,
    changeSetStatus: targetStatus,
    currentRevisionIds: targetCurrentRevisionIds,
    stage: targetStatus,
    recovery: null,
  });
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === left.length
    && rightSet.size === right.length
    && [...leftSet].every((value) => rightSet.has(value));
}

function assertAdoptedCohortIsCurrent({ repository, changeSet, projectId }) {
  const revisions = repository.listRevisionsByChangeSet(changeSet.changeSetId);
  const revisionIds = revisions.map((revision) => revision.revisionId);
  const candidateArtifactRefs = changeSet.candidateArtifactRefs;
  if (revisions.length === 0
      || !Array.isArray(candidateArtifactRefs)
      || (candidateArtifactRefs.length > 0
        && !sameStringSet(candidateArtifactRefs, revisionIds))) {
    throw new ResultCompareError(
      'adoption_cohort_incoherent',
      'The adopted ChangeSet no longer resolves to one complete candidate Revision cohort.',
      {
        changeSetId: changeSet.changeSetId,
        candidateArtifactRefs,
        persistedRevisionIds: revisionIds,
      }
    );
  }
  const stale = revisions.filter((revision) => {
    const current = repository.getCurrentRevision(revision.artifactFamilyId, projectId);
    return !revision.isCurrent || !current || current.revisionId !== revision.revisionId;
  });
  if (stale.length > 0) {
    throw new ResultCompareError(
      'adoption_not_current',
      'The adopted ChangeSet has been superseded and cannot be adopted idempotently.',
      {
        changeSetId: changeSet.changeSetId,
        staleRevisionIds: stale.map((revision) => revision.revisionId),
        currentRevisionIds: revisions.map((revision) => (
          repository.getCurrentRevision(revision.artifactFamilyId, projectId)?.revisionId || null
        )),
      }
    );
  }
  return revisions;
}

function adoptResultChangeSet(input = {}, dependencies = {}) {
  const { repository, adapter, getToolJob } = dependencies;
  if (!repository || !adapter) throw new ResultCompareError('adopt_dependencies_missing', 'Repository and Git adapter are required.');
  const changeSet = repository.getChangeSet(input.changeSetId);
  if (!changeSet || changeSet.projectId !== input.projectId) throw new ResultCompareError('change_set_not_found', 'ChangeSet was not found in the active project.');
  if (changeSet.status === 'adopted') {
    const revisions = assertAdoptedCohortIsCurrent({ repository, changeSet, projectId: input.projectId });
    return { ...repository.adoptChangeSet({ changeSetId: changeSet.changeSetId }), currentRevisions: revisions };
  }
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
    // BLOCK-143：family 首版（parent 空）且 family 尚无 current —— preview 即首个
    // current，adopt 合法（F1 链形成点注册的 pending revisions 即此形态）；
    // family 已有 current 而 preview 的 parent 与之不符才判 stale（既有语义不变）。
    if (current && (!parent || current.revisionId !== parent.revisionId)) {
      throw new ResultCompareError('adoption_base_stale', 'Current result changed after this preview was created.');
    }
    const familyFirst = !parent && !current;
    verifyRevisionForAdoption({
      revision,
      parent,
      familyFirst,
      workspaceRoot: input.workspaceRoot,
      adapter,
      gitPathPrefix: dependencies.gitPathPrefix,
      getToolJob,
      candidateCommit: changeSet.candidateCommit,
    });
    parents.set(revision.revisionId, parent);
  }
  const refUpdates = planCurrentRefUpdates({
    adapter,
    revisions,
    expectedCommit: (revision) => parents.get(revision.revisionId)?.sourceCommit || null,
    nextCommit: () => changeSet.candidateCommit,
  });
  const targetCurrentRevisionIds = currentRevisionIdsAfter({
    repository,
    projectId: input.projectId,
    targetRevisions: revisions,
  });
  executeDurableRefTransaction({
    operationId: randomId('rft'),
    projectId: changeSet.projectId,
    changeSetId: changeSet.changeSetId,
    operationKind: 'adopt',
    sourceStatus: 'preview_ready',
    targetStatus: 'adopted',
    refUpdates,
    targetRevisionIds: revisions.map((revision) => revision.revisionId),
    checkpoint: durableTransitionCheckpoint({
      repository,
      changeSet,
      targetStatus: 'adopted',
      targetCurrentRevisionIds,
    }),
  }, {
    repository,
    adapter,
    afterRefsApplied: dependencies.afterRefsApplied,
  });
  const currentRevisions = revisions.map((revision) => repository.getRevision(revision.revisionId));
  return {
    changeSet: repository.getChangeSet(changeSet.changeSetId),
    adoptedRevisionIds: revisions.map((revision) => revision.revisionId),
    idempotent: false,
    currentRevisions,
  };
}

function revertResultChangeSet(input = {}, dependencies = {}) {
  const { repository, adapter } = dependencies;
  if (!repository || !adapter) throw new ResultCompareError('revert_dependencies_missing', 'Repository and Git adapter are required.');
  const changeSet = repository.getChangeSet(input.changeSetId);
  if (!changeSet || changeSet.projectId !== input.projectId) throw new ResultCompareError('change_set_not_found', 'ChangeSet was not found in the active project.');
  const intentRef = String(changeSet.intentRef || '');
  if (intentRef.startsWith('baseline:') || intentRef.startsWith('baseline-cohort:')) {
    throw new ResultCompareError('baseline_revert_forbidden', 'The root baseline cannot be reverted; restore or adopt another Revision instead.');
  }
  if (changeSet.status === 'reverted') return repository.revertChangeSet({ changeSetId: changeSet.changeSetId, reason: input.reason || null });
  const revisions = repository.listRevisionsByChangeSet(changeSet.changeSetId);
  let restoredRevisions = [];
  if (changeSet.status === 'adopted') {
    for (const revision of revisions) {
      const current = repository.getCurrentRevision(revision.artifactFamilyId, input.projectId);
      if (!current || current.revisionId !== revision.revisionId) {
        throw new ResultCompareError('revert_not_current', 'A newer Revision is current; restore history instead of reverting this ChangeSet.');
      }
      const sameFamilyParents = revision.parentRevisionIds
        .map((revisionId) => repository.getRevision(revisionId))
        .filter((parent) => parent
          && parent.projectId === revision.projectId
          && parent.artifactFamilyId === revision.artifactFamilyId
          && parent.validationStatus !== 'blocked');
      if (sameFamilyParents.length !== 1 || !sameFamilyParents[0].sourceCommit) {
        throw new ResultCompareError(
          'revert_parent_unavailable',
          'Revert requires exactly one valid same-family parent with a source commit.',
          { revisionId: revision.revisionId },
        );
      }
      restoredRevisions.push(sameFamilyParents[0]);
    }
  }
  const targetCurrentRevisionIds = changeSet.status === 'adopted'
    ? currentRevisionIdsAfter({
      repository,
      projectId: input.projectId,
      targetRevisions: restoredRevisions,
    })
    : repository.listCurrentRevisions(input.projectId).map((revision) => revision.revisionId).sort();
  const checkpoint = durableTransitionCheckpoint({
    repository,
    changeSet,
    targetStatus: 'reverted',
    targetCurrentRevisionIds,
  });
  if (changeSet.status === 'adopted') {
    const restoredByFamily = new Map(
      restoredRevisions.map((revision) => [revision.artifactFamilyId, revision]),
    );
    executeDurableRefTransaction({
      operationId: randomId('rft'),
      projectId: changeSet.projectId,
      changeSetId: changeSet.changeSetId,
      operationKind: 'revert_adopted',
      sourceStatus: 'adopted',
      targetStatus: 'reverted',
      refUpdates: planCurrentRefUpdates({
        adapter,
        revisions,
        expectedCommit: () => changeSet.candidateCommit,
        nextCommit: (revision) => restoredByFamily.get(revision.artifactFamilyId)?.sourceCommit || null,
      }),
      targetRevisionIds: restoredRevisions.map((revision) => revision.revisionId),
      checkpoint,
      statusReason: input.reason || 'user_reverted',
    }, {
      repository,
      adapter,
      afterRefsApplied: dependencies.afterRefsApplied,
    });
  } else {
    const existing = adapter.revParse(changeSet.workingBranchRef);
    if (existing && changeSet.candidateCommit && existing !== changeSet.candidateCommit) {
      throw new ResultCompareError('candidate_git_ref_mismatch', 'Candidate Git ref changed before discard.');
    }
    if (existing) {
      executeDurableRefTransaction({
        operationId: randomId('rft'),
        projectId: changeSet.projectId,
        changeSetId: changeSet.changeSetId,
        operationKind: 'discard_preview',
        sourceStatus: changeSet.status,
        targetStatus: 'reverted',
        refUpdates: [{ ref: changeSet.workingBranchRef, expectedOld: existing, newOid: ZERO_OID }],
        targetRevisionIds: [],
        checkpoint,
        statusReason: input.reason || 'user_reverted',
      }, {
        repository,
        adapter,
        afterRefsApplied: dependencies.afterRefsApplied,
      });
    } else {
      repository.transitionChangeSetWithCheckpoint({
        transition: {
          changeSetId: changeSet.changeSetId,
          to: 'reverted',
          reason: input.reason || 'user_reverted',
        },
        checkpoint,
      });
    }
  }
  if (changeSet.status !== 'adopted' && input.workspaceRoot) {
    try {
      removePrivatePathSync(
        input.workspaceRoot,
        ['.biof3', 'revision', changeSet.changeSetId],
        { recursive: true, force: true, kind: 'directory' },
      );
    } catch { /* unsafe or changed staging is preserved for RS8 lifecycle inspection */ }
  }
  return {
    changeSet: repository.getChangeSet(changeSet.changeSetId),
    restoredRevisionIds: restoredRevisions.map((revision) => revision.revisionId),
    idempotent: false,
  };
}

function restoreArtifactRevision(input = {}, dependencies = {}) {
  const { repository, adapter, getToolJob } = dependencies;
  if (!repository || !adapter) throw new ResultCompareError('restore_dependencies_missing', 'Repository and Git adapter are required.');
  if (typeof repository.resolveRestorableRevision !== 'function') {
    throw new ResultCompareError('restore_qualification_unavailable', 'Historical restore qualification is unavailable.');
  }
  let resolved;
  try {
    resolved = repository.resolveRestorableRevision({
      revisionId: input.revisionId,
      projectId: input.projectId,
    });
  } catch (error) {
    throw new ResultCompareError(
      error.code || 'revision_not_restorable',
      error.message || 'Revision is not eligible for historical restore.',
      error.detail || null,
    );
  }
  const target = resolved.revision;
  const sourceCohort = [...resolved.cohort]
    .sort((left, right) => `${left.artifactFamilyId}:${left.artifactId}`.localeCompare(`${right.artifactFamilyId}:${right.artifactId}`));
  const validationSummary = resolved.changeSet.validationSummary || {};
  if (!Number.isInteger(validationSummary.formalArtifactCount)
      || validationSummary.formalArtifactCount !== sourceCohort.length) {
    throw new ResultCompareError(
      'restore_formal_artifact_count_mismatch',
      'Historical restore requires an exact formal Artifact count for the source cohort.',
      { expected: sourceCohort.length, actual: validationSummary.formalArtifactCount ?? null },
    );
  }
  const sourceToolJobIds = [...new Set(sourceCohort.map((revision) => revision.toolJobId))];
  const rawValidatorIds = validationSummary.validatorIds;
  const sourceValidatorIds = Array.isArray(rawValidatorIds)
    ? rawValidatorIds.map((value) => typeof value === 'string' ? value.trim() : '')
    : [];
  if (!Array.isArray(rawValidatorIds) || sourceValidatorIds.length === 0
      || sourceValidatorIds.length !== sourceToolJobIds.length
      || sourceValidatorIds.some((value, index) => !value || value !== rawValidatorIds[index])
      || new Set(sourceValidatorIds).size !== sourceValidatorIds.length
      || (Object.prototype.hasOwnProperty.call(validationSummary, 'validatorId')
        && (sourceValidatorIds.length !== 1 || validationSummary.validatorId !== sourceValidatorIds[0]))) {
    throw new ResultCompareError(
      'restore_validator_proof_missing',
      'Historical restore requires unique, nonblank validator proof for every source Job.'
    );
  }
  const sourceFamilyIds = sourceCohort.map((revision) => revision.artifactFamilyId);
  if (new Set(sourceFamilyIds).size !== sourceFamilyIds.length) {
    throw new ResultCompareError('restore_cohort_family_duplicate', 'Historical ChangeSet contains more than one Revision for an Artifact family.');
  }
  const sourceGraphRef = resolved.changeSet.validationSummary?.workflowGraph || null;
  let sourceWorkflowGraph = null;
  const hasSourceGraphRef = Boolean(sourceGraphRef?.graphId || sourceGraphRef?.sourceDigest);
  if (hasSourceGraphRef) {
    if (!sourceGraphRef?.graphId || !sourceGraphRef?.sourceDigest || typeof repository.getWorkflowGraph !== 'function') {
      throw new ResultCompareError(
        'restore_workflow_graph_invalid',
        'Historical replay metadata does not identify one complete authoritative workflow graph.'
      );
    }
    sourceWorkflowGraph = repository.getWorkflowGraph(sourceGraphRef.graphId);
    if (!sourceWorkflowGraph || sourceWorkflowGraph.projectId !== input.projectId
        || sourceWorkflowGraph.sourceDigest !== sourceGraphRef.sourceDigest
        || sourceWorkflowGraph.validationStatus !== 'valid') {
      throw new ResultCompareError(
        'restore_workflow_graph_invalid',
        'Historical workflow graph is missing, stale, or not valid for this project.'
      );
    }
    const graphScope = validateRestoreWorkflowScope({
      graph: sourceWorkflowGraph,
      sourceRevisions: sourceCohort,
    });
    if (!graphScope.ok) {
      throw new ResultCompareError(
        graphScope.diagnostic?.code || 'restore_workflow_graph_scope_mismatch',
        graphScope.diagnostic?.message || 'Historical workflow graph does not cover the source cohort and only its immutable ancestors.',
        graphScope.diagnostic?.detail || null,
      );
    }
  } else if (sourceToolJobIds.length > 1) {
    throw new ResultCompareError(
      'restore_workflow_graph_missing',
      'A multi-Job historical cohort cannot be restored without its persisted authoritative workflow graph.'
    );
  }
  if (typeof dependencies.getResultStudioDescriptor === 'function') {
    const expectedValidatorIds = sourceToolJobIds.map((toolJobId) => {
      const graphNode = sourceWorkflowGraph?.nodes.find((node) => node.toolJobId === toolJobId) || null;
      const job = typeof getToolJob === 'function' ? getToolJob(toolJobId) : null;
      const toolId = graphNode?.toolId || job?.tool_id || job?.toolId || null;
      const rawDescriptor = toolId ? dependencies.getResultStudioDescriptor(toolId) : null;
      const descriptor = rawDescriptor?.resultStudio || rawDescriptor;
      return typeof descriptor?.validator?.id === 'string' ? descriptor.validator.id.trim() : '';
    });
    if (expectedValidatorIds.some((value) => !value)
        || !sameStringSet(sourceValidatorIds, expectedValidatorIds)) {
      throw new ResultCompareError(
        'restore_validator_proof_mismatch',
        'Historical validator proof does not match the currently trusted plugin descriptors.',
        { sourceToolJobIds },
      );
    }
  }
  const currentByFamily = new Map();
  for (const sourceRevision of sourceCohort) {
    if (sourceRevision.validationStatus === 'blocked') {
      throw new ResultCompareError('revision_not_restorable', 'A blocked Revision cannot become the formal result.');
    }
    const current = repository.getCurrentRevision(sourceRevision.artifactFamilyId, input.projectId);
    if (!current || current.projectId !== input.projectId) {
      throw new ResultCompareError('current_revision_missing', 'Every historical Artifact family must have an exact current Revision.');
    }
    currentByFamily.set(sourceRevision.artifactFamilyId, current);
  }
  const selectedCurrent = currentByFamily.get(target.artifactFamilyId);
  if (sourceCohort.every((revision) => currentByFamily.get(revision.artifactFamilyId)?.revisionId === revision.revisionId)) {
    return { restored: false, idempotent: true, revision: target, cohortRevisions: sourceCohort };
  }
  const restoreIntentRef = `restore:cohort:${resolved.changeSet.changeSetId}`;
  const currentChangeSetIds = new Set([...currentByFamily.values()].map((revision) => revision.changeSetId));
  if (currentChangeSetIds.size === 1) {
    const [currentChangeSetId] = currentChangeSetIds;
    const currentChangeSet = repository.getChangeSet(currentChangeSetId);
    const restoredCohort = currentChangeSet?.status === 'adopted' && currentChangeSet.intentRef === restoreIntentRef
      ? repository.listRevisionsByChangeSet(currentChangeSetId)
      : [];
    const restoredFamilies = new Set(restoredCohort.map((revision) => revision.artifactFamilyId));
    if (restoredCohort.length === sourceCohort.length
        && restoredFamilies.size === sourceCohort.length
        && sourceFamilyIds.every((familyId) => restoredFamilies.has(familyId))
        && restoredCohort.every((revision) => currentByFamily.get(revision.artifactFamilyId)?.revisionId === revision.revisionId)) {
      return {
        restored: false,
        idempotent: true,
        revision: restoredCohort.find((revision) => revision.artifactFamilyId === target.artifactFamilyId),
        cohortRevisions: restoredCohort,
        changeSet: currentChangeSet,
      };
    }
  }

  const changeSetId = randomId('cs');
  const cohortRevisionIds = sourceCohort.map((revision) => revision.revisionId);
  const rows = sourceCohort.map((sourceRevision) => {
    const current = currentByFamily.get(sourceRevision.artifactFamilyId);
    resolveRevisionFile(input.workspaceRoot, sourceRevision);
    const sourceGitPath = sourceRevision.sourceScriptRef?.relativePath
      ? projectGitPath(sourceRevision.sourceScriptRef.relativePath, dependencies.gitPathPrefix)
      : null;
    const parametersGitPath = sourceRevision.parametersRef
      ? projectGitPath(sourceRevision.parametersRef, dependencies.gitPathPrefix)
      : null;
    const sourceContent = sourceRevision.sourceCommit && sourceGitPath
      ? adapter.showFile({ ref: sourceRevision.sourceCommit, filePath: sourceGitPath })
      : null;
    const parametersContent = sourceRevision.sourceCommit && parametersGitPath
      ? adapter.showFile({ ref: sourceRevision.sourceCommit, filePath: parametersGitPath })
      : null;
    if (sourceContent == null || sha256(sourceContent) !== sourceRevision.sourceScriptRef?.sha256
        || parametersContent == null || !sourceRevision.parametersHash
        || sha256(parametersContent) !== sourceRevision.parametersHash) {
      throw new ResultCompareError('restore_material_unavailable', 'Every historical script and parameter snapshot must verify in Git.');
    }
    const revisionId = randomId('rev');
    const extension = path.extname(sourceRevision.sourceScriptRef.relativePath) || '.R';
    const base = path.posix.join('analysis/scripts', sourceRevision.artifactFamilyId, revisionId);
    const scriptRelativePath = path.posix.join(base, `run-script${extension}`);
    const parametersRelativePath = path.posix.join(base, 'parameters.json');
    const manifestRelativePath = path.posix.join(base, 'materialization.json');
    const scriptHash = sha256(sourceContent);
    const parametersHash = sha256(parametersContent);
    const manifestContent = stableJson({
      resultStudioMaterializationVersion: 1,
      restore: true,
      cohort: true,
      changeSetId,
      revisionId,
      restoredFromChangeSetId: resolved.changeSet.changeSetId,
      restoredFromRevisionId: sourceRevision.revisionId,
      restoredCohortRevisionIds: cohortRevisionIds,
      selectedSourceRevisionId: target.revisionId,
      parentRevisionId: current.revisionId,
      artifactFamilyId: sourceRevision.artifactFamilyId,
      artifactId: sourceRevision.artifactId,
      scriptRelativePath,
      scriptSha256: scriptHash,
      parametersRelativePath,
      parametersSha256: parametersHash,
    });
    return {
      sourceRevision,
      current,
      revisionId,
      sourceContent,
      parametersContent,
      scriptRelativePath,
      parametersRelativePath,
      manifestRelativePath,
      manifestContent,
      scriptHash,
      parametersHash,
    };
  });
  const workingBranchRef = `refs/heads/biof3/changeset/${changeSetId}`;
  repository.createChangeSet({
    changeSetId,
    projectId: input.projectId,
    conversationId: input.conversationId || null,
    intentRef: restoreIntentRef,
    baseCommit: selectedCurrent.sourceCommit,
    workingBranchRef,
    createdBy: input.createdBy === 'agent' ? 'agent' : 'user',
    parentArtifactRefs: rows.map((row) => row.current.revisionId),
  });
  repository.transitionChangeSet({ changeSetId, to: 'running' });
  try {
    const files = rows.flatMap((row) => [
      { path: row.scriptRelativePath, content: row.sourceContent },
      { path: row.parametersRelativePath, content: row.parametersContent },
      { path: row.manifestRelativePath, content: row.manifestContent },
    ]).map((file) => ({ ...file, path: projectGitPath(file.path, dependencies.gitPathPrefix) }));
    const candidate = adapter.commitVirtualFiles({
      parentCommit: selectedCurrent.sourceCommit,
      ref: workingBranchRef,
      expectedOld: ZERO_OID,
      message: `BioF3 restore cohort ${resolved.changeSet.changeSetId} (${rows.length} outputs)`,
      files,
    });
    const revisionInputs = rows.map((row) => ({
      revisionId: row.revisionId,
      projectId: input.projectId,
      artifactFamilyId: row.sourceRevision.artifactFamilyId,
      artifactId: row.sourceRevision.artifactId,
      parentRevisionIds: [row.current.revisionId],
      sourceCommit: candidate.commit,
      sourceScriptRef: {
        ...row.sourceRevision.sourceScriptRef,
        relativePath: row.scriptRelativePath,
        sha256: row.scriptHash,
        entryPoint: path.posix.basename(row.scriptRelativePath),
        origin: 'project_materialized',
      },
      inputArtifactRefs: row.sourceRevision.inputArtifactRefs,
      parametersRef: row.parametersRelativePath,
      parametersHash: row.parametersHash,
      toolJobId: row.sourceRevision.toolJobId,
      outputPath: row.sourceRevision.outputPath,
      outputHash: row.sourceRevision.outputHash,
      validationStatus: row.sourceRevision.validationStatus,
      reproducibilityStatus: 'available',
      changeSetId,
    }));
    let restoredWorkflowGraph = null;
    if (sourceWorkflowGraph) {
      const rebound = rebindWorkflowGraphForEquivalentRestore({
        graph: sourceWorkflowGraph,
        sourceRevisions: sourceCohort,
        restoredRevisions: revisionInputs,
        resolveRevision: (revisionId) => repository.getRevision(revisionId),
        resolveSelection: (selectionId) => repository.getSelection(selectionId),
      });
      if (!rebound.ok || !rebound.graph) {
        throw new ResultCompareError(
          rebound.diagnostic?.code || 'restore_workflow_graph_invalid',
          rebound.diagnostic?.message || 'Historical workflow graph cannot be rebound to the restored cohort.',
          rebound.diagnostic?.detail || null,
        );
      }
      restoredWorkflowGraph = rebound.graph;
    }
    const batch = repository.appendRevisionBatch({
      revisions: revisionInputs,
      workflowGraph: restoredWorkflowGraph,
      transition: {
        changeSetId,
        to: 'preview_ready',
        candidateCommit: candidate.commit,
        changedPaths: rows.flatMap((row) => [
          { relativePath: row.scriptRelativePath, changeType: 'added', beforeHash: row.current.sourceScriptRef?.sha256 || null, afterHash: row.scriptHash },
          { relativePath: row.parametersRelativePath, changeType: 'added', beforeHash: row.current.parametersHash, afterHash: row.parametersHash },
          { relativePath: row.manifestRelativePath, changeType: 'added', beforeHash: null, afterHash: sha256(row.manifestContent) },
        ]),
        jobRefs: [...new Set(rows.map((row) => row.sourceRevision.toolJobId))],
        candidateArtifactRefs: revisionInputs.map((revision) => revision.revisionId),
        validationSummary: {
          restore: true,
          cohort: true,
          restoredFromChangeSetId: resolved.changeSet.changeSetId,
          restoredFromRevisionId: target.revisionId,
          restoredCohortRevisionIds: cohortRevisionIds,
          artifactTruthStatus: rows.some((row) => row.sourceRevision.validationStatus === 'degraded') ? 'degraded' : 'valid',
          intentSummary: `恢复历史结果组（${rows.length} 个正式产物）为新的正式版本`,
          impactLevel: 'version_restore',
          affectedScope: rows.length === 1 ? 'current_result_only' : 'historical_changeset_cohort',
          requiresJob: false,
          affectedNodeCount: 0,
          formalArtifactCount: rows.length,
          validatorIds: sourceValidatorIds,
          workflowGraph: restoredWorkflowGraph
            ? { graphId: restoredWorkflowGraph.graphId, sourceDigest: restoredWorkflowGraph.sourceDigest }
            : null,
          sourceWorkflowGraph: sourceWorkflowGraph
            ? { graphId: sourceWorkflowGraph.graphId, sourceDigest: sourceWorkflowGraph.sourceDigest }
            : null,
          restoredWorkflowGraph: restoredWorkflowGraph
            ? { graphId: restoredWorkflowGraph.graphId, sourceDigest: restoredWorkflowGraph.sourceDigest }
            : null,
        },
      },
    });
    const adopted = adoptResultChangeSet({
      projectId: input.projectId,
      workspaceRoot: input.workspaceRoot,
      changeSetId,
    }, { ...dependencies, getToolJob });
    const cohortRevisions = batch.revisions.map((revision) => repository.getRevision(revision.revisionId));
    return {
      restored: true,
      idempotent: false,
      changeSet: adopted.changeSet,
      revision: cohortRevisions.find((revision) => revision.artifactFamilyId === target.artifactFamilyId),
      cohortRevisions,
    };
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
