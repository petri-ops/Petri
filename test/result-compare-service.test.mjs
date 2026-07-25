import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { bindProjectRepository } = require('../core/shared-backend/git-repository-binding');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const { sha256 } = require('../core/shared-backend/result-changeset-service');
const {
  ResultCompareError,
  compareJsonValues,
  compareTables,
  compareResultChangeSet,
  adoptResultChangeSet,
  revertResultChangeSet,
  restoreArtifactRevision,
} = require('../core/shared-backend/result-compare-service');

function makeFixture(context) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'biof3-rs6-'));
  context.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const db = new Database(join(workspaceRoot, 'rs6.db'));
  context.after(() => { try { db.close(); } catch { /* closed */ } });
  ensureResultStudioSchema(db);
  const repository = createResultStudioRepository(db, { ensureSchema: false });
  const binding = bindProjectRepository({ workspaceRoot, projectId: 'p_rs6' });
  const adapter = binding.adapter;
  const sourceScript = 'palette <- "red"\n';
  const candidateScript = 'palette <- "blue"\n';
  const sourceParams = '{\n  "palette": "red"\n}\n';
  const candidateParams = '{\n  "palette": "blue",\n  "labels": 10\n}\n';
  const sourceScriptPath = 'analysis/scripts/family/rev_source/artifact.R';
  const sourceParamsPath = 'analysis/scripts/family/rev_source/parameters.json';
  const base = adapter.commitVirtualFiles({
    ref: 'refs/heads/biof3/main', expectedOld: '0'.repeat(40), message: 'RS6 base',
    files: [
      { path: sourceScriptPath, content: sourceScript },
      { path: sourceParamsPath, content: sourceParams },
    ],
  });
  const sourceOutput = join(workspaceRoot, 'results/jobs/tj_source/output/table.csv');
  mkdirSync(join(sourceOutput, '..'), { recursive: true });
  writeFileSync(sourceOutput, 'gene,value\nA,1\nB,2\n');
  const sourceHash = sha256(readFileSync(sourceOutput));
  repository.createChangeSet({
    changeSetId: 'cs_source', projectId: 'p_rs6', baseCommit: base.commit,
    workingBranchRef: 'refs/heads/biof3/source', createdBy: 'agent',
  });
  repository.transitionChangeSet({ changeSetId: 'cs_source', to: 'running' });
  repository.transitionChangeSet({ changeSetId: 'cs_source', to: 'preview_ready', candidateCommit: base.commit });
  repository.appendRevision({
    revisionId: 'rev_source', projectId: 'p_rs6', artifactFamilyId: 'family', artifactId: 'table',
    parentRevisionIds: [], sourceCommit: base.commit,
    sourceScriptRef: {
      relativePath: sourceScriptPath, sha256: sha256(sourceScript), entryPoint: 'artifact.R',
      artifactId: 'table', rendererId: 'plugin:table', language: 'r', origin: 'project_materialized',
    },
    inputArtifactRefs: [], parametersRef: sourceParamsPath, parametersHash: sha256(sourceParams),
    toolJobId: 'tj_source', outputPath: 'results/jobs/tj_source/output/table.csv', outputHash: sourceHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_source',
  });
  repository.adoptChangeSet({ changeSetId: 'cs_source', candidateCommit: base.commit });

  const candidateScriptPath = 'analysis/scripts/family/rev_candidate/artifact.R';
  const candidateParamsPath = 'analysis/scripts/family/rev_candidate/parameters.json';
  const candidate = adapter.commitVirtualFiles({
    parentCommit: base.commit, ref: 'refs/heads/biof3/changeset/cs_candidate', expectedOld: '0'.repeat(40),
    message: 'RS6 candidate',
    files: [
      { path: candidateScriptPath, content: candidateScript },
      { path: candidateParamsPath, content: candidateParams },
    ],
  });
  const candidateOutput = join(workspaceRoot, 'results/jobs/tj_candidate/output/table.csv');
  mkdirSync(join(candidateOutput, '..'), { recursive: true });
  writeFileSync(candidateOutput, 'gene,value,label\nA,3,yes\nC,4,no\n');
  const candidateHash = sha256(readFileSync(candidateOutput));
  repository.createChangeSet({
    changeSetId: 'cs_candidate', projectId: 'p_rs6', baseCommit: base.commit,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_candidate', createdBy: 'agent',
    parentArtifactRefs: ['rev_source'],
  });
  repository.transitionChangeSet({ changeSetId: 'cs_candidate', to: 'running' });
  repository.appendRevision({
    revisionId: 'rev_candidate', projectId: 'p_rs6', artifactFamilyId: 'family', artifactId: 'table',
    parentRevisionIds: ['rev_source'], sourceCommit: candidate.commit,
    sourceScriptRef: {
      relativePath: candidateScriptPath, sha256: sha256(candidateScript), entryPoint: 'artifact.R',
      artifactId: 'table', rendererId: 'plugin:table', language: 'r', origin: 'project_materialized',
    },
    inputArtifactRefs: [], parametersRef: candidateParamsPath, parametersHash: sha256(candidateParams),
    toolJobId: 'tj_candidate', outputPath: 'results/jobs/tj_candidate/output/table.csv', outputHash: candidateHash,
    validationStatus: 'valid', reproducibilityStatus: 'verified', changeSetId: 'cs_candidate',
  });
  repository.transitionChangeSet({
    changeSetId: 'cs_candidate', to: 'preview_ready', candidateCommit: candidate.commit,
    changedPaths: [
      { relativePath: candidateScriptPath, changeType: 'added', beforeHash: sha256(sourceScript), afterHash: sha256(candidateScript) },
      { relativePath: candidateParamsPath, changeType: 'added', beforeHash: sha256(sourceParams), afterHash: sha256(candidateParams) },
    ],
    jobRefs: ['tj_candidate'], candidateArtifactRefs: ['rev_candidate'],
    validationSummary: { artifactTruthStatus: 'valid' },
  });
  const jobs = new Map([
    ['tj_source', {
      id: 'tj_source', project_id: 'p_rs6', status: 'completed',
      result: { artifactTruth: { status: 'valid', blocking: false } },
    }],
    ['tj_candidate', {
      id: 'tj_candidate', project_id: 'p_rs6', status: 'completed',
      result: { artifactTruth: { status: 'valid', blocking: false } },
    }],
  ]);
  return {
    workspaceRoot, db, repository, adapter, base, candidate,
    getToolJob: (id) => jobs.get(id) || null,
  };
}

test('RS6 JSON comparison is field-level, deterministic and bounded', () => {
  const result = compareJsonValues('{"palette":"red","nested":{"x":1}}', '{"palette":"blue","nested":{"x":1},"labels":10}', 'parameters.json');
  assert.equal(result.status, 'available');
  assert.deepEqual(result.changes.map((entry) => [entry.field, entry.changeType]), [
    ['labels', 'added'],
    ['palette', 'changed'],
  ]);
});

test('RS6 JSON and table comparisons report bounded truncation honestly', (context) => {
  const manyFields = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`field_${index}`, index]));
  const json = compareJsonValues('{}', JSON.stringify(manyFields), 'large.json');
  assert.equal(json.status, 'available');
  assert.equal(json.truncated, true);
  assert.equal(json.changes.length <= 500, true);

  const root = mkdtempSync(join(tmpdir(), 'biof3-rs6-large-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const before = join(root, 'before.csv');
  const after = join(root, 'after.csv');
  const row = `A,${'x'.repeat(1024)}\n`;
  writeFileSync(before, `gene,value\n${row.repeat(4100)}`);
  writeFileSync(after, `gene,value,label\n${row.repeat(4100)}`);
  const table = compareTables(before, after);
  assert.equal(table.truncated, true);
  assert.equal(table.before.rowCountIsLowerBound, true);
  assert.equal(table.after.rowCountIsLowerBound, true);
  assert.equal(table.sampleChanges.length <= 20, true);
});

test('RS6 table comparison reports schema, row and bounded sample changes', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-rs6-table-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const before = join(root, 'before.csv');
  const after = join(root, 'after.csv');
  writeFileSync(before, 'gene,value\nA,1\nB,2\n');
  writeFileSync(after, 'gene,value,label\nA,3,yes\nC,4,no\n');
  const result = compareTables(before, after);
  assert.deepEqual(result.addedColumns, ['label']);
  assert.equal(result.before.rowCount, 2);
  assert.equal(result.after.rowCount, 2);
  assert.equal(result.sampleChanges.length, 2);
});

test('RS6 compare, adopt and revert preserve one atomic current Revision', (context) => {
  const fx = makeFixture(context);
  const comparison = compareResultChangeSet({
    projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate',
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(comparison.summary.status, 'preview_ready');
  assert.equal(comparison.summary.changedFileCount, 2);
  assert.equal(comparison.artifacts[0].kind, 'table');
  assert.deepEqual(comparison.artifacts[0].table.addedColumns, ['label']);
  assert.equal(comparison.textDiff.additions > 0, true);

  const adopted = adoptResultChangeSet({
    projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate',
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob });
  assert.equal(adopted.changeSet.status, 'adopted');
  assert.equal(fx.repository.getCurrentRevision('family').revisionId, 'rev_candidate');
  assert.equal(fx.adapter.revParse('refs/heads/biof3/current/family'), fx.candidate.commit);
  assert.equal(adoptResultChangeSet({
    projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate',
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob }).idempotent, true);

  const reverted = revertResultChangeSet({ projectId: 'p_rs6', changeSetId: 'cs_candidate' }, {
    repository: fx.repository, adapter: fx.adapter,
  });
  assert.equal(reverted.changeSet.status, 'reverted');
  assert.equal(fx.repository.getCurrentRevision('family').revisionId, 'rev_source');
  assert.equal(fx.adapter.revParse('refs/heads/biof3/current/family'), fx.base.commit);
});

test('RS6 adoption fails closed when the preview parent is stale', (context) => {
  const fx = makeFixture(context);
  fx.db.prepare("UPDATE artifact_revisions SET is_current = 0 WHERE artifact_family_id = 'family'").run();
  assert.throws(
    () => adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
      repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
    }),
    (error) => error instanceof ResultCompareError && error.code === 'adoption_base_stale'
  );
  assert.equal(fx.repository.getChangeSet('cs_candidate').status, 'preview_ready');
});

test('RS6 adoption keeps SQLite unchanged when the current Git ref fails CAS', (context) => {
  const fx = makeFixture(context);
  fx.adapter.updateRefCas({
    ref: 'refs/heads/biof3/current/family',
    newCommit: fx.candidate.commit,
    expectedOld: '0'.repeat(40),
  });
  assert.throws(
    () => adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
      repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
    }),
    (error) => error instanceof ResultCompareError && error.code === 'current_git_ref_stale'
  );
  assert.equal(fx.repository.getChangeSet('cs_candidate').status, 'preview_ready');
  assert.equal(fx.repository.getCurrentRevision('family').revisionId, 'rev_source');
  assert.equal(fx.adapter.revParse('refs/heads/biof3/current/family'), fx.candidate.commit);
});

test('RS6 rejects cross-project access and root baseline revert', (context) => {
  const fx = makeFixture(context);
  for (const operation of [
    () => compareResultChangeSet({ projectId: 'p_other', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, { repository: fx.repository, adapter: fx.adapter }),
    () => adoptResultChangeSet({ projectId: 'p_other', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob }),
    () => revertResultChangeSet({ projectId: 'p_other', changeSetId: 'cs_candidate' }, { repository: fx.repository, adapter: fx.adapter }),
    () => restoreArtifactRevision({ projectId: 'p_other', workspaceRoot: fx.workspaceRoot, revisionId: 'rev_source' }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob }),
  ]) {
    assert.throws(operation, (error) => error instanceof ResultCompareError && ['change_set_not_found', 'revision_not_found'].includes(error.code));
  }
  fx.db.prepare("UPDATE scientific_change_sets SET intent_ref = 'baseline:table' WHERE change_set_id = 'cs_source'").run();
  assert.throws(
    () => revertResultChangeSet({ projectId: 'p_rs6', changeSetId: 'cs_source' }, { repository: fx.repository, adapter: fx.adapter }),
    (error) => error instanceof ResultCompareError && error.code === 'baseline_revert_forbidden'
  );
  assert.equal(fx.repository.getChangeSet('cs_source').status, 'adopted');
  assert.equal(fx.repository.getCurrentRevision('family').revisionId, 'rev_source');
});

test('RS6 discarding an unadopted preview removes only its temporary ref', (context) => {
  const fx = makeFixture(context);
  const result = revertResultChangeSet({
    projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate',
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(result.changeSet.status, 'reverted');
  assert.equal(fx.adapter.revParse('refs/heads/biof3/changeset/cs_candidate'), null);
  assert.equal(fx.repository.getCurrentRevision('family').revisionId, 'rev_source');
  assert.equal(fx.adapter.revParse('refs/heads/biof3/main'), fx.base.commit);
});

test('RS6 restores history as a new commit and Revision without rewriting the target', (context) => {
  const fx = makeFixture(context);
  adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
    repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
  });
  const restored = restoreArtifactRevision({
    projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, revisionId: 'rev_source', createdBy: 'user',
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob });
  assert.equal(restored.restored, true);
  assert.notEqual(restored.revision.revisionId, 'rev_source');
  assert.equal(restored.revision.parentRevisionIds[0], 'rev_candidate');
  assert.equal(restored.revision.outputHash, fx.repository.getRevision('rev_source').outputHash);
  assert.equal(restored.revision.isCurrent, true);
  assert.equal(restored.changeSet.status, 'adopted');
  assert.notEqual(restored.revision.sourceCommit, fx.repository.getRevision('rev_source').sourceCommit);
  const repeated = restoreArtifactRevision({
    projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, revisionId: 'rev_source', createdBy: 'user',
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.revision.revisionId, restored.revision.revisionId);
});
