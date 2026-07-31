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
  ensureResultWorkflowGraphSchema,
  workflowGraphDigest,
} = require('../core/shared-backend/result-workflow-graph');
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
  ensureResultWorkflowGraphSchema(db);
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
  const sourceSummaryOutput = join(workspaceRoot, 'results/jobs/tj_source/output/summary.csv');
  mkdirSync(join(sourceOutput, '..'), { recursive: true });
  writeFileSync(sourceOutput, 'gene,value\nA,1\nB,2\n');
  writeFileSync(sourceSummaryOutput, 'metric,value\nrows,2\n');
  const sourceHash = sha256(readFileSync(sourceOutput));
  const sourceSummaryHash = sha256(readFileSync(sourceSummaryOutput));
  const sourceGraphNodes = [{
    id: 'job:tj_source',
    toolJobId: 'tj_source',
    toolId: 'fixture-tool',
    artifactIds: ['summary', 'table'],
    provenanceHash: sha256('tj_source_provenance'),
    dependsOn: [],
  }];
  const sourceGraphDigest = workflowGraphDigest({
    projectId: 'p_rs6',
    rootToolJobId: 'tj_source',
    nodes: sourceGraphNodes,
    edges: [],
  });
  const sourceWorkflowGraph = {
    graphId: `wfg_${sourceGraphDigest.slice(0, 24)}`,
    contractVersion: 1,
    projectId: 'p_rs6',
    rootToolJobId: 'tj_source',
    sourceDigest: sourceGraphDigest,
    nodes: sourceGraphNodes,
    edges: [],
    validationStatus: 'valid',
  };
  repository.createChangeSet({
    changeSetId: 'cs_source', projectId: 'p_rs6', baseCommit: base.commit,
    workingBranchRef: 'refs/heads/biof3/source', createdBy: 'agent',
  });
  repository.transitionChangeSet({ changeSetId: 'cs_source', to: 'running' });
  repository.appendRevisionBatch({
    revisions: [
      {
        revisionId: 'rev_source', projectId: 'p_rs6', artifactFamilyId: 'family', artifactId: 'table',
        parentRevisionIds: [], sourceCommit: base.commit,
        sourceScriptRef: {
          relativePath: sourceScriptPath, sha256: sha256(sourceScript), entryPoint: 'artifact.R',
          artifactId: 'table', rendererId: 'plugin:table', language: 'r', origin: 'project_materialized',
        },
        inputArtifactRefs: [], parametersRef: sourceParamsPath, parametersHash: sha256(sourceParams),
        toolJobId: 'tj_source', outputPath: 'results/jobs/tj_source/output/table.csv', outputHash: sourceHash,
        validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_source',
      },
      {
        revisionId: 'rev_source_summary', projectId: 'p_rs6', artifactFamilyId: 'family_summary', artifactId: 'summary',
        parentRevisionIds: [], sourceCommit: base.commit,
        sourceScriptRef: {
          relativePath: sourceScriptPath, sha256: sha256(sourceScript), entryPoint: 'artifact.R',
          artifactId: 'summary', rendererId: 'plugin:summary', language: 'r', origin: 'project_materialized',
        },
        inputArtifactRefs: [], parametersRef: sourceParamsPath, parametersHash: sha256(sourceParams),
        toolJobId: 'tj_source', outputPath: 'results/jobs/tj_source/output/summary.csv', outputHash: sourceSummaryHash,
        validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_source',
      },
    ],
    workflowGraph: sourceWorkflowGraph,
    transition: {
      changeSetId: 'cs_source', to: 'preview_ready', candidateCommit: base.commit,
      jobRefs: ['tj_source'], candidateArtifactRefs: ['rev_source', 'rev_source_summary'],
      validationSummary: {
        artifactTruthStatus: 'valid',
        formalArtifactCount: 2,
        validatorId: 'fixture-validator',
        validatorIds: ['fixture-validator'],
        workflowGraph: {
          graphId: sourceWorkflowGraph.graphId,
          sourceDigest: sourceWorkflowGraph.sourceDigest,
        },
      },
    },
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
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_candidate',
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
      id: 'tj_source', project_id: 'p_rs6', tool_id: 'fixture-tool', status: 'completed',
      result: { artifactTruth: { status: 'valid', blocking: false } },
    }],
    ['tj_candidate', {
      id: 'tj_candidate', project_id: 'p_rs6', tool_id: 'fixture-tool', status: 'completed',
      result: { artifactTruth: { status: 'valid', blocking: false } },
    }],
  ]);
  return {
    workspaceRoot, db, repository, adapter, base, candidate,
    sourceWorkflowGraph,
    getToolJob: (id) => jobs.get(id) || null,
  };
}

function installSourceAncestorGraph(fx) {
  const sourceRevision = fx.repository.getRevision('rev_source');
  fx.repository.createChangeSet({
    changeSetId: 'cs_parent', projectId: 'p_rs6', baseCommit: fx.base.commit,
    workingBranchRef: 'refs/heads/biof3/parent', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_parent', to: 'running' });
  fx.repository.appendRevision({
    revisionId: 'rev_parent', projectId: 'p_rs6', artifactFamilyId: 'family_parent', artifactId: 'input_table',
    parentRevisionIds: [], sourceCommit: fx.base.commit,
    sourceScriptRef: {
      ...sourceRevision.sourceScriptRef,
      artifactId: 'input_table',
      rendererId: 'plugin:input_table',
    },
    inputArtifactRefs: [], parametersRef: sourceRevision.parametersRef, parametersHash: sourceRevision.parametersHash,
    toolJobId: 'tj_parent', outputPath: sourceRevision.outputPath, outputHash: sourceRevision.outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_parent',
  });
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_parent', to: 'preview_ready', candidateCommit: fx.base.commit,
    jobRefs: ['tj_parent'], candidateArtifactRefs: ['rev_parent'],
    validationSummary: { artifactTruthStatus: 'valid' },
  });
  fx.repository.adoptChangeSet({ changeSetId: 'cs_parent', candidateCommit: fx.base.commit });

  const nodes = [
    {
      id: 'job:tj_parent', toolJobId: 'tj_parent', toolId: 'parent-tool',
      artifactIds: ['input_table'], provenanceHash: sha256('tj_parent_provenance'), dependsOn: [],
    },
    {
      ...fx.sourceWorkflowGraph.nodes[0],
      dependsOn: ['job:tj_parent'],
    },
  ];
  const edges = [{
    kind: 'artifact',
    fromNodeId: 'job:tj_parent',
    toNodeId: 'job:tj_source',
    sourceToolJobId: 'tj_parent',
    sourceRevisionId: 'rev_parent',
    sourceArtifactId: 'input_table',
    sourceOutputHash: sourceRevision.outputHash,
    selectionId: null,
    selectionHash: null,
    inputId: 'input_table',
  }];
  const sourceDigest = workflowGraphDigest({
    projectId: 'p_rs6', rootToolJobId: 'tj_parent', nodes, edges,
  });
  const graph = fx.repository.saveWorkflowGraph({
    graphId: `wfg_${sourceDigest.slice(0, 24)}`,
    contractVersion: 1,
    projectId: 'p_rs6',
    rootToolJobId: 'tj_parent',
    sourceDigest,
    nodes,
    edges,
    validationStatus: 'valid',
  });
  const sourceChangeSet = fx.repository.getChangeSet('cs_source');
  fx.db.prepare('UPDATE scientific_change_sets SET validation_summary_json = ? WHERE change_set_id = ?')
    .run(JSON.stringify({
      ...sourceChangeSet.validationSummary,
      workflowGraph: { graphId: graph.graphId, sourceDigest: graph.sourceDigest },
    }), 'cs_source');
  return graph;
}

test('RS6 JSON comparison is field-level, deterministic and bounded', () => {
  const result = compareJsonValues('{"palette":"red","nested":{"x":1}}', '{"palette":"blue","nested":{"x":1},"labels":10}', 'parameters.json');
  assert.equal(result.status, 'available');
  assert.deepEqual(result.changes.map((entry) => [entry.field, entry.changeType]), [
    ['labels', 'added'],
    ['palette', 'changed'],
  ]);

  const publicProjection = compareJsonValues(
    '{"input":"/Users/private/source.csv","job":"tj_private123","api_key":"old"}',
    '{"input":"/Users/private/candidate.csv","job":"tj_private456","api_key":"new"}',
    'parameters.json',
  );
  assert.deepEqual(publicProjection.changes.map((entry) => [entry.field, entry.before, entry.after]), [
    ['api_key', '[redacted]', '[redacted]'],
    ['input', '[project file]', '[project file]'],
    ['job', '[internal reference]', '[internal reference]'],
  ]);
  assert.doesNotMatch(JSON.stringify(publicProjection), /\/Users\/|tj_private|"old"|"new"/);
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
  assert.doesNotMatch(comparison.textDiff.patch, /rev_(?:source|candidate)/);
  assert.match(comparison.textDiff.patch, /diff artifact\.R -> artifact\.R/);

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

test('P5 adopted ChangeSet refuses stale idempotency after its cohort is no longer current', (context) => {
  const fx = makeFixture(context);
  adoptResultChangeSet({
    projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate',
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob });

  fx.db.prepare("UPDATE artifact_revisions SET is_current = 0 WHERE revision_id = 'rev_candidate'").run();
  fx.db.prepare("UPDATE artifact_revisions SET is_current = 1 WHERE revision_id = 'rev_source'").run();

  assert.throws(
    () => adoptResultChangeSet({
      projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate',
    }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob }),
    (error) => error instanceof ResultCompareError && error.code === 'adoption_not_current'
  );
  assert.equal(fx.repository.getCurrentRevision('family', 'p_rs6').revisionId, 'rev_source');
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

test('P4R-4 checkpoint failure rolls back adopt and revert across SQLite and Git', (context) => {
  const fx = makeFixture(context);
  const saveCheckpoint = fx.repository.saveCheckpoint;
  fx.repository.saveCheckpoint = () => { throw new Error('checkpoint_fault'); };
  assert.throws(
    () => adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
      repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
    }),
    /checkpoint_fault/
  );
  assert.equal(fx.repository.getChangeSet('cs_candidate').status, 'preview_ready');
  assert.equal(fx.repository.getCurrentRevision('family').revisionId, 'rev_source');
  assert.equal(fx.adapter.revParse('refs/heads/biof3/current/family'), null);

  fx.repository.saveCheckpoint = saveCheckpoint;
  adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
    repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
  });
  const checkpointBefore = fx.repository.getLatestCheckpoint({ projectId: 'p_rs6' });
  fx.repository.saveCheckpoint = () => { throw new Error('checkpoint_fault'); };
  assert.throws(
    () => revertResultChangeSet({ projectId: 'p_rs6', changeSetId: 'cs_candidate' }, {
      repository: fx.repository, adapter: fx.adapter,
    }),
    /checkpoint_fault/
  );
  assert.equal(fx.repository.getChangeSet('cs_candidate').status, 'adopted');
  assert.equal(fx.repository.getCurrentRevision('family').revisionId, 'rev_candidate');
  assert.equal(fx.adapter.revParse('refs/heads/biof3/current/family'), fx.candidate.commit);
  assert.equal(fx.repository.getLatestCheckpoint({ projectId: 'p_rs6' }).checkpointHash, checkpointBefore.checkpointHash);
});

test('P4R-4 adoption rejects source and parameter version drift', (context) => {
  const fx = makeFixture(context);
  const originalParametersHash = fx.repository.getRevision('rev_candidate').parametersHash;
  fx.db.prepare("UPDATE artifact_revisions SET parameters_hash = ? WHERE revision_id = 'rev_candidate'")
    .run('f'.repeat(64));
  assert.throws(
    () => adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
      repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
    }),
    (error) => error instanceof ResultCompareError && error.code === 'candidate_parameters_hash_mismatch'
  );
  fx.db.prepare("UPDATE artifact_revisions SET parameters_hash = ?, source_commit = ? WHERE revision_id = 'rev_candidate'")
    .run(originalParametersHash, fx.base.commit);
  assert.throws(
    () => adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
      repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
    }),
    (error) => error instanceof ResultCompareError && error.code === 'candidate_source_commit_mismatch'
  );
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
  for (const intentRef of ['baseline:table', 'baseline-cohort:tj_legacy']) {
    fx.db.prepare('UPDATE scientific_change_sets SET intent_ref = ? WHERE change_set_id = ?')
      .run(intentRef, 'cs_source');
    assert.throws(
      () => revertResultChangeSet({ projectId: 'p_rs6', changeSetId: 'cs_source' }, { repository: fx.repository, adapter: fx.adapter }),
      (error) => error instanceof ResultCompareError && error.code === 'baseline_revert_forbidden'
    );
  }
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
  assert.equal(restored.cohortRevisions.length, 2);
  assert.equal(restored.cohortRevisions.every((revision) => revision.isCurrent), true);
  assert.equal(restored.cohortRevisions.every((revision) => revision.reproducibilityStatus === 'available'), true);
  assert.equal(
    restored.cohortRevisions.find((revision) => revision.artifactFamilyId === 'family_summary').parentRevisionIds[0],
    'rev_source_summary',
  );
  assert.equal(restored.changeSet.status, 'adopted');
  assert.deepEqual(restored.changeSet.validationSummary.validatorIds, ['fixture-validator']);
  assert.deepEqual(restored.changeSet.validationSummary.sourceWorkflowGraph, {
    graphId: fx.sourceWorkflowGraph.graphId,
    sourceDigest: fx.sourceWorkflowGraph.sourceDigest,
  });
  assert.deepEqual(
    restored.changeSet.validationSummary.restoredWorkflowGraph,
    restored.changeSet.validationSummary.workflowGraph,
  );
  const restoredGraph = fx.repository.getWorkflowGraph(restored.changeSet.validationSummary.workflowGraph.graphId);
  assert.ok(restoredGraph);
  assert.equal(restoredGraph.rootToolJobId, 'tj_source');
  assert.deepEqual(restoredGraph.nodes.map((node) => node.toolJobId), ['tj_source']);
  assert.notEqual(restored.revision.sourceCommit, fx.repository.getRevision('rev_source').sourceCommit);
  const changeSetCount = fx.db.prepare('SELECT COUNT(*) AS count FROM scientific_change_sets').get().count;
  const repeated = restoreArtifactRevision({
    projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, revisionId: 'rev_source_summary', createdBy: 'user',
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob });
  assert.equal(repeated.idempotent, true);
  assert.equal(
    repeated.revision.revisionId,
    restored.cohortRevisions.find((revision) => revision.artifactFamilyId === 'family_summary').revisionId,
  );
  assert.deepEqual(
    repeated.cohortRevisions.map((revision) => revision.revisionId).sort(),
    restored.cohortRevisions.map((revision) => revision.revisionId).sort(),
  );
  assert.equal(fx.db.prepare('SELECT COUNT(*) AS count FROM scientific_change_sets').get().count, changeSetCount);
});

test('P6 restores a downstream baseline cohort without rewriting its immutable ancestor graph', (context) => {
  const fx = makeFixture(context);
  const sourceGraph = installSourceAncestorGraph(fx);
  adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
    repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
  });
  const restored = restoreArtifactRevision({
    projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, revisionId: 'rev_source', createdBy: 'user',
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob });
  assert.equal(restored.restored, true);
  const restoredGraph = fx.repository.getWorkflowGraph(restored.changeSet.validationSummary.workflowGraph.graphId);
  assert.deepEqual(restoredGraph.nodes.map((node) => node.toolJobId), ['tj_parent', 'tj_source']);
  assert.deepEqual(restoredGraph.edges, sourceGraph.edges);
  assert.equal(restoredGraph.edges[0].sourceRevisionId, 'rev_parent');
});

test('P5 historical restore fails closed without source validator proof', (context) => {
  const fx = makeFixture(context);
  adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
    repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
  });
  fx.db.prepare('UPDATE scientific_change_sets SET validation_summary_json = ? WHERE change_set_id = ?')
    .run(JSON.stringify({ artifactTruthStatus: 'valid', formalArtifactCount: 2 }), 'cs_source');
  assert.throws(
    () => restoreArtifactRevision({
      projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, revisionId: 'rev_source', createdBy: 'user',
    }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob }),
    (error) => error instanceof ResultCompareError && error.code === 'restore_validator_proof_missing',
  );
});

test('P6 historical restore rejects tampered formal counts and malformed validator cohorts', (context) => {
  const cases = [
    {
      name: 'wrong formal count',
      summary: { artifactTruthStatus: 'valid', formalArtifactCount: 1, validatorIds: ['fixture-validator'] },
      code: 'restore_formal_artifact_count_mismatch',
    },
    {
      name: 'duplicate validator ids',
      summary: { artifactTruthStatus: 'valid', formalArtifactCount: 2, validatorIds: ['fixture-validator', 'fixture-validator'] },
      code: 'restore_validator_proof_missing',
    },
    {
      name: 'blank validator id',
      summary: { artifactTruthStatus: 'valid', formalArtifactCount: 2, validatorIds: [' '] },
      code: 'restore_validator_proof_missing',
    },
  ];
  for (const entry of cases) {
    const fx = makeFixture(context);
    adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
      repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
    });
    fx.db.prepare('UPDATE scientific_change_sets SET validation_summary_json = ? WHERE change_set_id = ?')
      .run(JSON.stringify(entry.summary), 'cs_source');
    assert.throws(
      () => restoreArtifactRevision({
        projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, revisionId: 'rev_source', createdBy: 'user',
      }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob }),
      (error) => error instanceof ResultCompareError && error.code === entry.code,
      entry.name,
    );
  }
});

test('P6 historical restore cross-checks validator ids when trusted descriptors are available', (context) => {
  const fx = makeFixture(context);
  adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
    repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
  });
  const sourceChangeSet = fx.repository.getChangeSet('cs_source');
  fx.db.prepare('UPDATE scientific_change_sets SET validation_summary_json = ? WHERE change_set_id = ?')
    .run(JSON.stringify({
      ...sourceChangeSet.validationSummary,
      validatorId: 'forged-validator',
      validatorIds: ['forged-validator'],
    }), 'cs_source');
  assert.throws(
    () => restoreArtifactRevision({
      projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, revisionId: 'rev_source', createdBy: 'user',
    }, {
      repository: fx.repository,
      adapter: fx.adapter,
      getToolJob: fx.getToolJob,
      getResultStudioDescriptor: () => ({ validator: { id: 'fixture-validator' } }),
    }),
    (error) => error instanceof ResultCompareError && error.code === 'restore_validator_proof_mismatch',
  );
});

test('P4R-4 restore rejects historical parameter hash drift', (context) => {
  const fx = makeFixture(context);
  adoptResultChangeSet({ projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_candidate' }, {
    repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob,
  });
  fx.db.prepare("UPDATE artifact_revisions SET parameters_hash = ? WHERE revision_id = 'rev_source'")
    .run('f'.repeat(64));
  assert.throws(
    () => restoreArtifactRevision({
      projectId: 'p_rs6', workspaceRoot: fx.workspaceRoot, revisionId: 'rev_source', createdBy: 'user',
    }, { repository: fx.repository, adapter: fx.adapter, getToolJob: fx.getToolJob }),
    (error) => error instanceof ResultCompareError && error.code === 'restore_material_unavailable'
  );
});
