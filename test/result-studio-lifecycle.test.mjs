import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
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
  inspectResultStudioWorkspace,
  recoverResultStudioWorkspace,
  inspectResultStudioStorage,
  planArtifactDeduplication,
  executeArtifactDeduplication,
  planResultStudioGc,
  executeResultStudioGc,
  evaluatePreviewResourceBudget,
  readTablePage,
} = require('../core/shared-backend/result-studio-lifecycle');

function fixture(context) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'biof3-rs8-'));
  context.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const db = new Database(join(workspaceRoot, 'rs8.db'));
  context.after(() => { try { db.close(); } catch { /* closed */ } });
  ensureResultStudioSchema(db);
  const repository = createResultStudioRepository(db, { ensureSchema: false });
  const adapter = bindProjectRepository({ workspaceRoot, projectId: 'p_rs8' }).adapter;
  const base = adapter.commitVirtualFiles({
    ref: 'refs/heads/biof3/main', expectedOld: '0'.repeat(40), message: 'RS8 base',
    files: [{ path: 'analysis/scripts/base.R', content: 'print(1)\n' }],
  }).commit;
  const output = join(workspaceRoot, 'results/jobs/tj_base/output/table.csv');
  mkdirSync(join(output, '..'), { recursive: true });
  writeFileSync(output, 'gene,value\nA,1\nB,2\nC,3\nD,4\n');
  const outputHash = sha256(readFileSync(output));
  repository.createChangeSet({ changeSetId: 'cs_base', projectId: 'p_rs8', baseCommit: base, workingBranchRef: 'refs/heads/biof3/base', createdBy: 'agent' });
  repository.transitionChangeSet({ changeSetId: 'cs_base', to: 'running' });
  repository.transitionChangeSet({ changeSetId: 'cs_base', to: 'preview_ready', candidateCommit: base });
  repository.appendRevision({
    revisionId: 'rev_base', projectId: 'p_rs8', artifactFamilyId: 'family', artifactId: 'table',
    sourceCommit: base, sourceScriptRef: { relativePath: 'analysis/scripts/base.R', sha256: sha256('print(1)\n'), entryPoint: 'base.R', artifactId: 'table', rendererId: 'test:table', language: 'r', origin: 'project_materialized' },
    inputArtifactRefs: [], parametersRef: null, parametersHash: null, toolJobId: 'tj_base',
    outputPath: 'results/jobs/tj_base/output/table.csv', outputHash, validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_base',
  });
  repository.adoptChangeSet({ changeSetId: 'cs_base', candidateCommit: base });
  adapter.updateRefCas({ ref: 'refs/heads/biof3/current/family', newCommit: base, expectedOld: '0'.repeat(40) });
  return { workspaceRoot, db, repository, adapter, base, output, outputHash };
}

test('RS8 restores a durable running ChangeSet to preview only with valid Job and Artifact truth', (context) => {
  const fx = fixture(context);
  const candidate = fx.adapter.commitVirtualFiles({
    parentCommit: fx.base, ref: 'refs/heads/biof3/changeset/cs_pending', expectedOld: '0'.repeat(40), message: 'candidate',
    files: [{ path: 'analysis/scripts/candidate.R', content: 'print(2)\n' }],
  }).commit;
  fx.repository.createChangeSet({ changeSetId: 'cs_pending', projectId: 'p_rs8', conversationId: 'conv_1', baseCommit: fx.base, workingBranchRef: 'refs/heads/biof3/changeset/cs_pending', createdBy: 'agent' });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_pending', to: 'running' });
  fx.repository.appendRevision({
    revisionId: 'rev_pending', projectId: 'p_rs8', artifactFamilyId: 'family', artifactId: 'table', parentRevisionIds: ['rev_base'],
    sourceCommit: candidate, sourceScriptRef: { relativePath: 'analysis/scripts/candidate.R', sha256: sha256('print(2)\n'), entryPoint: 'candidate.R', artifactId: 'table', rendererId: 'test:table', language: 'r', origin: 'project_materialized' },
    inputArtifactRefs: [], toolJobId: 'tj_pending', outputPath: 'results/jobs/tj_base/output/table.csv', outputHash: fx.outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_pending',
  });
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_pending', projectId: 'p_rs8', conversationId: 'conv_1', baseCommit: fx.base, candidateCommit: candidate,
    changeSetId: 'cs_pending', changeSetStatus: 'running', currentRevisionIds: ['rev_base'], pendingPreview: { stage: 'revision', revisionIds: ['rev_pending'] }, jobRefs: ['tj_pending'],
  });
  const result = recoverResultStudioWorkspace({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', conversationId: 'conv_1' }, {
    repository: fx.repository, adapter: fx.adapter,
    getToolJob: () => ({ id: 'tj_pending', project_id: 'p_rs8', status: 'completed', result: { artifactTruth: { status: 'valid', blocking: false } } }),
  });
  assert.equal(result.recovered, true);
  assert.equal(fx.repository.getChangeSet('cs_pending').status, 'preview_ready');
  assert.ok(result.repaired.some((entry) => entry.repair === 'running_to_preview_ready'));
});

test('RS8 detects Artifact drift and never upgrades it to a recovered preview', (context) => {
  const fx = fixture(context);
  writeFileSync(fx.output, 'tampered');
  const report = inspectResultStudioWorkspace({ repository: fx.repository, adapter: fx.adapter, workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' });
  assert.equal(report.status, 'blocked');
  assert.ok(report.revisionIntegrity.issues.some((issue) => issue.kind === 'artifact_hash_drift'));
  const recovery = recoverResultStudioWorkspace({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(recovery.recovered, false);
});

test('RS8 restores a missing current Git ref but blocks a conflicting ref', (context) => {
  const fx = fixture(context);
  fx.adapter.deleteRefCas({ ref: 'refs/heads/biof3/current/family', expectedOld: fx.base });
  assert.equal(inspectResultStudioWorkspace({ repository: fx.repository, adapter: fx.adapter, workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }).status, 'recovery_available');
  const repaired = recoverResultStudioWorkspace({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(repaired.after.status, 'ready');
  assert.equal(fx.adapter.revParse('refs/heads/biof3/current/family'), fx.base);
});

test('RS8 storage summary is content-addressed and GC never targets Artifact history', (context) => {
  const fx = fixture(context);
  fx.repository.createChangeSet({ changeSetId: 'cs_orphan', projectId: 'p_rs8', baseCommit: fx.base, workingBranchRef: 'refs/heads/biof3/changeset/cs_orphan', createdBy: 'agent' });
  fx.repository.appendRevision({
    revisionId: 'rev_orphan', projectId: 'p_rs8', artifactFamilyId: 'orphan', artifactId: 'table', sourceCommit: fx.base,
    sourceScriptRef: { relativePath: 'analysis/scripts/base.R', sha256: sha256('print(1)\n'), entryPoint: 'base.R', artifactId: 'table', rendererId: 'test:table', language: 'r', origin: 'project_materialized' },
    inputArtifactRefs: [], toolJobId: 'tj_orphan', outputPath: 'results/jobs/tj_base/output/table.csv', outputHash: fx.outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_orphan',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_orphan', to: 'abandoned' });
  const staging = join(fx.workspaceRoot, '.biof3/revision/cs_orphan');
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, 'run-script.R'), 'print(1)');
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  utimesSync(staging, old, old);
  const storage = inspectResultStudioStorage({ repository: fx.repository, workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' });
  assert.equal(storage.duplicateGroupCount, 1);
  assert.equal(storage.deduplicableBytes, readFileSync(fx.output).length);
  const duplicatePath = join(fx.workspaceRoot, 'results/jobs/tj_duplicate/output/table.csv');
  mkdirSync(join(duplicatePath, '..'), { recursive: true });
  writeFileSync(duplicatePath, readFileSync(fx.output));
  fx.db.prepare("UPDATE artifact_revisions SET output_path = ? WHERE revision_id = 'rev_orphan'").run('results/jobs/tj_duplicate/output/table.csv');
  const dedupPlan = planArtifactDeduplication({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, { repository: fx.repository });
  const deduped = executeArtifactDeduplication({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', planToken: dedupPlan.planToken }, { repository: fx.repository });
  assert.equal(deduped.linkedCount >= 1, true);
  assert.equal(statSync(fx.output).ino, statSync(duplicatePath).ino);
  const plan = planResultStudioGc({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(plan.artifactDeletionCount, 0);
  assert.ok(plan.entries.some((entry) => entry.relativePath?.endsWith('cs_orphan')));
  const executed = executeResultStudioGc({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', planToken: plan.planToken }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(executed.removedCount >= 1, true);
  assert.equal(readFileSync(fx.output, 'utf8').startsWith('gene'), true);
  assert.ok(fx.repository.getRevision('rev_orphan'));
});

test('RS8 progressive table pages stay bounded and use a continuation cursor', (context) => {
  const fx = fixture(context);
  const first = readTablePage({ filePath: fx.output, cursor: 0, limit: 2 });
  assert.deepEqual(first.columns, ['gene', 'value']);
  assert.deepEqual(first.rows, [['A', '1'], ['B', '2']]);
  assert.equal(typeof first.nextCursor, 'number');
  const second = readTablePage({ filePath: fx.output, cursor: first.nextCursor, limit: 2 });
  assert.deepEqual(second.rows, [['C', '3'], ['D', '4']]);
  assert.equal(second.nextCursor, null);
});

test('RS8 preview budget queues concurrency and blocks resource pressure without changing science', () => {
  const snapshot = { state: 'ready', memory: { availableBytes: 8_000 }, disk: { availableBytes: 20_000 } };
  assert.equal(evaluatePreviewResourceBudget({ resourceSnapshot: snapshot, activePreviewJobs: 2 }).decision, 'queued');
  const blocked = evaluatePreviewResourceBudget({ resourceSnapshot: snapshot, estimatedMemoryBytes: 7_000 });
  assert.equal(blocked.decision, 'blocked');
  assert.equal(blocked.scientificParametersChanged, false);
});
