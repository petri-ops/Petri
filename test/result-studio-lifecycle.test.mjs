import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { bindProjectRepository } = require('../core/shared-backend/git-repository-binding');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { ensureResultRefTransactionSchema } = require('../core/shared-backend/result-ref-transaction-schema');
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

const PREVIOUS_RUNTIME_LEASE = Object.freeze({
  instanceId: '1'.repeat(32),
  startedAt: '2026-01-01T00:00:00.000Z',
  // A prior runtime is stale because its owner is observably gone, not because
  // this test happened to finish within an arbitrary wall-clock window.
  ownerPid: 2_147_483_647,
});
const CURRENT_RUNTIME_LEASE = Object.freeze({
  instanceId: '2'.repeat(32),
  startedAt: new Date(Date.now() + 60_000).toISOString(),
});

function validJob(projectId, toolJobId, artifactId, digest, sourceSha256) {
  return {
    id: toolJobId,
    project_id: projectId,
    status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: artifactId, sha256: digest }],
      executionProvenance: {
        toolJobId,
        projectId,
        script: { sha256: sourceSha256 },
        artifacts: [{ id: artifactId, sha256: digest }],
      },
    },
  };
}

function fixture(context) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'biof3-rs8-'));
  const db = new Database(join(workspaceRoot, 'rs8.db'));
  // 先关库再删目录：Windows 上打开的 SQLite 文件无法删除（EPERM）。
  context.after(() => {
    try { db.close(); } catch { /* closed */ }
    rmSync(workspaceRoot, { recursive: true, force: true });
  });
  ensureResultStudioSchema(db);
  ensureResultRefTransactionSchema(db);
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

function assertAllRevisionSourcesAvailable(repository, adapter, projectId) {
  const revisions = repository.listProjectRevisions(projectId, { limit: 10000 });
  for (const revision of revisions) {
    assert.equal(adapter.revParse(`${revision.sourceCommit}^{commit}`), revision.sourceCommit);
    if (revision.sourceScriptRef?.relativePath) {
      const source = adapter.showFile({
        ref: revision.sourceCommit,
        filePath: revision.sourceScriptRef.relativePath,
      });
      assert.equal(typeof source, 'string', `source missing for ${revision.revisionId}`);
      assert.equal(sha256(source), revision.sourceScriptRef.sha256, `source drift for ${revision.revisionId}`);
    }
  }
  return revisions;
}

test('RS8 restores a durable running ChangeSet to preview only with valid Job and Artifact truth', (context) => {
  const fx = fixture(context);
  const candidate = fx.adapter.commitVirtualFiles({
    parentCommit: fx.base, ref: 'refs/heads/biof3/changeset/cs_pending', expectedOld: '0'.repeat(40), message: 'candidate',
    files: [
      { path: 'analysis/scripts/candidate.R', content: 'print(2)\n' },
      { path: 'analysis/scripts/candidate-parameters.json', content: '{}\n' },
    ],
  }).commit;
  fx.repository.createChangeSet({ changeSetId: 'cs_pending', projectId: 'p_rs8', conversationId: 'conv_1', baseCommit: fx.base, workingBranchRef: 'refs/heads/biof3/changeset/cs_pending', createdBy: 'agent' });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_pending', to: 'running' });
  fx.repository.appendRevision({
    revisionId: 'rev_pending', projectId: 'p_rs8', artifactFamilyId: 'family', artifactId: 'table', parentRevisionIds: ['rev_base'],
    sourceCommit: candidate, sourceScriptRef: { relativePath: 'analysis/scripts/candidate.R', sha256: sha256('print(2)\n'), entryPoint: 'candidate.R', artifactId: 'table', rendererId: 'test:table', language: 'r', origin: 'project_materialized' },
    inputArtifactRefs: [], parametersRef: 'analysis/scripts/candidate-parameters.json', parametersHash: sha256('{}\n'),
    toolJobId: 'tj_pending', outputPath: 'results/jobs/tj_base/output/table.csv', outputHash: fx.outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_pending',
  });
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_pending', projectId: 'p_rs8', conversationId: 'conv_1', baseCommit: fx.base, candidateCommit: candidate,
    changeSetId: 'cs_pending', changeSetStatus: 'running', currentRevisionIds: ['rev_base'],
    pendingPreview: { stage: 'revision', revisionIds: ['rev_pending'], runtimeLease: PREVIOUS_RUNTIME_LEASE }, jobRefs: ['tj_pending'],
  });
  const result = recoverResultStudioWorkspace({
    workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', conversationId: 'conv_1', runtimeLease: CURRENT_RUNTIME_LEASE,
  }, {
    repository: fx.repository, adapter: fx.adapter,
    getToolJob: () => validJob('p_rs8', 'tj_pending', 'table', fx.outputHash, sha256('print(2)\n')),
  });
  assert.equal(result.recovered, true);
  assert.equal(fx.repository.getChangeSet('cs_pending').status, 'preview_ready');
  assert.ok(result.repaired.some((entry) => entry.repair === 'running_to_preview_ready'));
  assert.equal(result.after.status, 'ready');
  assert.equal(result.after.interrupted.length, 0);
  assert.equal(result.after.pendingDecisions.length, 1);
  assert.equal(result.after.consistency.status, 'consistent');
  assert.equal(fx.repository.getCheckpoint('cp_pending').changeSetStatus, 'preview_ready');
  assert.equal(fx.repository.getCheckpoint('cp_pending').pendingPreview.stage, 'preview_ready');
});

test('P6 treats an intact preview as a pending decision instead of a restart interruption', (context) => {
  const fx = fixture(context);
  fx.repository.createChangeSet({
    changeSetId: 'cs_preview',
    projectId: 'p_rs8',
    baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_preview',
    createdBy: 'agent',
  });
  const candidate = fx.adapter.commitVirtualFiles({
    parentCommit: fx.base,
    ref: 'refs/heads/biof3/changeset/cs_preview',
    expectedOld: '0'.repeat(40),
    message: 'complete preview',
    files: [
      { path: 'analysis/scripts/preview.R', content: 'print(3)\n' },
      { path: 'analysis/scripts/preview-parameters.json', content: '{}\n' },
    ],
  }).commit;
  fx.repository.transitionChangeSet({ changeSetId: 'cs_preview', to: 'running' });
  fx.repository.appendRevision({
    revisionId: 'rev_preview', projectId: 'p_rs8', artifactFamilyId: 'family', artifactId: 'table', parentRevisionIds: ['rev_base'],
    sourceCommit: candidate, sourceScriptRef: { relativePath: 'analysis/scripts/preview.R', sha256: sha256('print(3)\n'), entryPoint: 'preview.R', artifactId: 'table', rendererId: 'test:table', language: 'r', origin: 'project_materialized' },
    inputArtifactRefs: [], parametersRef: 'analysis/scripts/preview-parameters.json', parametersHash: sha256('{}\n'),
    toolJobId: 'tj_preview', outputPath: 'results/jobs/tj_base/output/table.csv', outputHash: fx.outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_preview',
  });
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_preview', to: 'preview_ready', candidateCommit: candidate,
    candidateArtifactRefs: ['rev_preview'], jobRefs: ['tj_preview'],
    validationSummary: {
      artifactTruthStatus: 'valid', formalArtifactCount: 1,
      formalArtifactCohort: [{ toolJobId: 'tj_preview', artifactId: 'table', outputHash: fx.outputHash }],
    },
  });
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_preview', projectId: 'p_rs8', baseCommit: fx.base, candidateCommit: candidate,
    changeSetId: 'cs_preview', changeSetStatus: 'preview_ready', currentRevisionIds: ['rev_base'],
    pendingPreview: { stage: 'preview_ready', revisionIds: ['rev_preview'], runtimeLease: CURRENT_RUNTIME_LEASE },
    jobRefs: ['tj_preview'],
  });

  const report = inspectResultStudioWorkspace({
    repository: fx.repository,
    adapter: fx.adapter,
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
    runtimeLease: CURRENT_RUNTIME_LEASE,
    getToolJob: () => validJob('p_rs8', 'tj_preview', 'table', fx.outputHash, sha256('print(3)\n')),
  });
  assert.equal(report.status, 'ready');
  assert.equal(report.interrupted.length, 0);
  assert.equal(report.pendingDecisions.length, 1);
  assert.equal(report.pendingDecisions[0].recovery, 'awaiting_user_decision');
  const publicReport = JSON.stringify(report);
  assert.equal(publicReport.includes('cs_preview'), false);
  assert.equal(publicReport.includes('rev_preview'), false);
  assert.equal(publicReport.includes('cp_preview'), false);
  assert.equal(publicReport.includes(candidate), false);
});

test('P6 closes an incomplete running attempt after restart instead of leaving permanent recovery state', (context) => {
  const fx = fixture(context);
  fx.repository.createChangeSet({
    changeSetId: 'cs_incomplete',
    projectId: 'p_rs8',
    conversationId: 'conv_incomplete',
    baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_incomplete',
    createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_incomplete', to: 'running' });
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_incomplete',
    projectId: 'p_rs8',
    conversationId: 'conv_incomplete',
    baseCommit: fx.base,
    changeSetId: 'cs_incomplete',
    changeSetStatus: 'running',
    currentRevisionIds: ['rev_base'],
    pendingPreview: { stage: 'materialized', revisionIds: [], runtimeLease: PREVIOUS_RUNTIME_LEASE },
  });

  const result = recoverResultStudioWorkspace({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
    conversationId: 'conv_incomplete',
    runtimeLease: CURRENT_RUNTIME_LEASE,
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob: () => null });
  assert.equal(result.recovered, true);
  assert.equal(fx.repository.getChangeSet('cs_incomplete').status, 'validation_failed');
  assert.ok(result.repaired.some((entry) => entry.repair === 'running_to_validation_failed'));
  assert.equal(result.after.status, 'ready');
  assert.equal(result.after.interrupted.length, 0);
  assert.equal(result.after.consistency.status, 'consistent');
  assert.equal(fx.repository.getCheckpoint('cp_incomplete').changeSetStatus, 'validation_failed');
});

test('P6 takes over a newer checkpoint after its isolated child owner has died', (context) => {
  const fx = fixture(context);
  fx.repository.createChangeSet({
    changeSetId: 'cs_dead_child',
    projectId: 'p_rs8',
    conversationId: 'conv_dead_child',
    baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_dead_child',
    createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_dead_child', to: 'running' });
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_dead_child',
    projectId: 'p_rs8',
    conversationId: 'conv_dead_child',
    baseCommit: fx.base,
    changeSetId: 'cs_dead_child',
    changeSetStatus: 'running',
    currentRevisionIds: ['rev_base'],
    pendingPreview: {
      stage: 'materialized',
      revisionIds: [],
      runtimeLease: {
        instanceId: '3'.repeat(32),
        startedAt: new Date(Date.now() + 120_000).toISOString(),
        ownerPid: 2_147_483_647,
      },
    },
  });
  const result = recoverResultStudioWorkspace({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
    conversationId: 'conv_dead_child',
    runtimeLease: CURRENT_RUNTIME_LEASE,
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob: () => null });
  assert.equal(result.recovered, true);
  assert.equal(fx.repository.getChangeSet('cs_dead_child').status, 'validation_failed');
  assert.ok(result.repaired.some((entry) => entry.repair === 'running_to_validation_failed'));
});

test('P6 abandons an unstarted draft after restart while preserving its checkpoint record', (context) => {
  const fx = fixture(context);
  fx.repository.createChangeSet({
    changeSetId: 'cs_draft',
    projectId: 'p_rs8',
    conversationId: 'conv_draft',
    baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_draft',
    createdBy: 'agent',
  });
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_draft',
    projectId: 'p_rs8',
    conversationId: 'conv_draft',
    baseCommit: fx.base,
    changeSetId: 'cs_draft',
    changeSetStatus: 'draft',
    currentRevisionIds: ['rev_base'],
    pendingPreview: { stage: 'change_set', revisionIds: [], runtimeLease: PREVIOUS_RUNTIME_LEASE },
  });

  const result = recoverResultStudioWorkspace({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
    conversationId: 'conv_draft',
    runtimeLease: CURRENT_RUNTIME_LEASE,
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(result.recovered, true);
  assert.equal(fx.repository.getChangeSet('cs_draft').status, 'abandoned');
  assert.ok(result.repaired.some((entry) => entry.repair === 'draft_to_abandoned'));
  assert.ok(fx.repository.getCheckpoint('cp_draft'));
  assert.equal(result.after.status, 'ready');
  assert.equal(result.after.consistency.status, 'consistent');
  assert.equal(fx.repository.getCheckpoint('cp_draft').changeSetStatus, 'abandoned');
});

test('P6 never recovers a ChangeSet owned by the current runtime lease', (context) => {
  const fx = fixture(context);
  fx.repository.createChangeSet({
    changeSetId: 'cs_active', projectId: 'p_rs8', baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_active', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_active', to: 'running' });
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_active', projectId: 'p_rs8', baseCommit: fx.base,
    changeSetId: 'cs_active', changeSetStatus: 'running', currentRevisionIds: ['rev_base'],
    pendingPreview: { stage: 'materialized', revisionIds: [], runtimeLease: CURRENT_RUNTIME_LEASE },
  });
  const report = inspectResultStudioWorkspace({
    repository: fx.repository, adapter: fx.adapter, workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8', runtimeLease: CURRENT_RUNTIME_LEASE,
  });
  assert.equal(report.status, 'ready');
  assert.equal(report.interrupted.length, 0);
  assert.equal(report.activeOperations.length, 1);
  const recovery = recoverResultStudioWorkspace({
    workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', runtimeLease: CURRENT_RUNTIME_LEASE,
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(recovery.recovered, false);
  assert.equal(fx.repository.getChangeSet('cs_active').status, 'running');
});

test('P6 never takes over an older checkpoint while its foreign runtime owner is alive', (context) => {
  const fx = fixture(context);
  fx.repository.createChangeSet({
    changeSetId: 'cs_live_foreign', projectId: 'p_rs8', baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_live_foreign', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_live_foreign', to: 'running' });
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_live_foreign', projectId: 'p_rs8', baseCommit: fx.base,
    changeSetId: 'cs_live_foreign', changeSetStatus: 'running', currentRevisionIds: ['rev_base'],
    pendingPreview: {
      stage: 'materialized',
      revisionIds: [],
      runtimeLease: {
        instanceId: '3'.repeat(32),
        startedAt: '2026-01-01T00:00:00.000Z',
        ownerPid: process.pid,
      },
    },
  });
  const report = inspectResultStudioWorkspace({
    repository: fx.repository, adapter: fx.adapter, workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8', runtimeLease: CURRENT_RUNTIME_LEASE,
  });
  assert.equal(report.interrupted.length, 0);
  assert.equal(report.activeOperations.length, 1);
  const recovery = recoverResultStudioWorkspace({
    workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', runtimeLease: CURRENT_RUNTIME_LEASE,
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(recovery.recovered, false);
  assert.equal(fx.repository.getChangeSet('cs_live_foreign').status, 'running');
});

test('P6 reconciles an atomic preview whose old-runtime checkpoint missed the final save', (context) => {
  const fx = fixture(context);
  const candidate = fx.adapter.commitVirtualFiles({
    parentCommit: fx.base, ref: 'refs/heads/biof3/changeset/cs_atomic_preview', expectedOld: '0'.repeat(40),
    message: 'atomic preview', files: [
      { path: 'analysis/scripts/atomic.R', content: 'print(4)\n' },
      { path: 'analysis/scripts/atomic-parameters.json', content: '{}\n' },
    ],
  }).commit;
  fx.repository.createChangeSet({
    changeSetId: 'cs_atomic_preview', projectId: 'p_rs8', baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_atomic_preview', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_atomic_preview', to: 'running' });
  fx.repository.appendRevision({
    revisionId: 'rev_atomic_preview', projectId: 'p_rs8', artifactFamilyId: 'family', artifactId: 'table', parentRevisionIds: ['rev_base'],
    sourceCommit: candidate, sourceScriptRef: { relativePath: 'analysis/scripts/atomic.R', sha256: sha256('print(4)\n'), entryPoint: 'atomic.R', artifactId: 'table', rendererId: 'test:table', language: 'r', origin: 'project_materialized' },
    inputArtifactRefs: [], parametersRef: 'analysis/scripts/atomic-parameters.json', parametersHash: sha256('{}\n'),
    toolJobId: 'tj_atomic_preview', outputPath: 'results/jobs/tj_base/output/table.csv', outputHash: fx.outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_atomic_preview',
  });
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_atomic_preview', to: 'preview_ready', candidateCommit: candidate,
    candidateArtifactRefs: ['rev_atomic_preview'], jobRefs: ['tj_atomic_preview'],
    validationSummary: {
      artifactTruthStatus: 'valid', formalArtifactCount: 1,
      formalArtifactCohort: [{ toolJobId: 'tj_atomic_preview', artifactId: 'table', outputHash: fx.outputHash }],
    },
  });
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_atomic_preview', projectId: 'p_rs8', baseCommit: fx.base, candidateCommit: candidate,
    changeSetId: 'cs_atomic_preview', changeSetStatus: 'running', currentRevisionIds: ['rev_base'],
    pendingPreview: { stage: 'revision', revisionIds: ['rev_atomic_preview'], runtimeLease: PREVIOUS_RUNTIME_LEASE },
    jobRefs: ['tj_atomic_preview'],
  });
  const getToolJob = () => validJob('p_rs8', 'tj_atomic_preview', 'table', fx.outputHash, sha256('print(4)\n'));
  const before = inspectResultStudioWorkspace({
    repository: fx.repository, adapter: fx.adapter, workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8', runtimeLease: CURRENT_RUNTIME_LEASE, getToolJob,
  });
  assert.equal(before.status, 'recovery_available');
  assert.equal(before.interrupted.length, 1);
  const result = recoverResultStudioWorkspace({
    workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', runtimeLease: CURRENT_RUNTIME_LEASE,
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob });
  assert.equal(result.recovered, true);
  assert.deepEqual(result.repaired, [{ repair: 'preview_checkpoint_reconciled' }]);
  assert.equal(fx.repository.getChangeSet('cs_atomic_preview').status, 'preview_ready');
  assert.equal(fx.repository.getCheckpoint('cp_atomic_preview').changeSetStatus, 'preview_ready');
  assert.equal(result.after.status, 'ready');
  assert.equal(result.after.pendingDecisions.length, 1);
  assert.equal(result.after.consistency.status, 'consistent');
});

test('P6 blocks an incoherent preview and never presents it as a pending decision', (context) => {
  const fx = fixture(context);
  const candidate = fx.adapter.commitVirtualFiles({
    parentCommit: fx.base, ref: 'refs/heads/biof3/changeset/cs_bad_preview', expectedOld: '0'.repeat(40),
    message: 'bad preview', files: [{ path: 'analysis/scripts/bad.R', content: 'print(5)\n' }],
  }).commit;
  fx.repository.createChangeSet({
    changeSetId: 'cs_bad_preview', projectId: 'p_rs8', baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_bad_preview', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_bad_preview', to: 'running' });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_bad_preview', to: 'preview_ready', candidateCommit: candidate });
  const report = inspectResultStudioWorkspace({
    repository: fx.repository, adapter: fx.adapter, workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8', runtimeLease: CURRENT_RUNTIME_LEASE, getToolJob: () => null,
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.pendingDecisions.length, 0);
  assert.ok(report.pendingIssues.some((issue) => issue.kind === 'revision_cohort_incomplete'));
  assert.ok(report.pendingIssues.some((issue) => issue.kind === 'preview_checkpoint_missing'));
});

test('P6 blocks stale running evidence when exact Job provenance does not prove the Revision', (context) => {
  const fx = fixture(context);
  const candidate = fx.adapter.commitVirtualFiles({
    parentCommit: fx.base, ref: 'refs/heads/biof3/changeset/cs_job_drift', expectedOld: '0'.repeat(40),
    message: 'job drift', files: [
      { path: 'analysis/scripts/job-drift.R', content: 'print(6)\n' },
      { path: 'analysis/scripts/job-drift-parameters.json', content: '{}\n' },
    ],
  }).commit;
  fx.repository.createChangeSet({
    changeSetId: 'cs_job_drift', projectId: 'p_rs8', baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_job_drift', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_job_drift', to: 'running' });
  fx.repository.appendRevision({
    revisionId: 'rev_job_drift', projectId: 'p_rs8', artifactFamilyId: 'family', artifactId: 'table', parentRevisionIds: ['rev_base'],
    sourceCommit: candidate, sourceScriptRef: { relativePath: 'analysis/scripts/job-drift.R', sha256: sha256('print(6)\n'), entryPoint: 'job-drift.R', artifactId: 'table', rendererId: 'test:table', language: 'r', origin: 'project_materialized' },
    inputArtifactRefs: [], parametersRef: 'analysis/scripts/job-drift-parameters.json', parametersHash: sha256('{}\n'),
    toolJobId: 'tj_job_drift', outputPath: 'results/jobs/tj_base/output/table.csv', outputHash: fx.outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_job_drift',
  });
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_job_drift', projectId: 'p_rs8', baseCommit: fx.base, candidateCommit: candidate,
    changeSetId: 'cs_job_drift', changeSetStatus: 'running', currentRevisionIds: ['rev_base'],
    pendingPreview: { stage: 'revision', revisionIds: ['rev_job_drift'], runtimeLease: PREVIOUS_RUNTIME_LEASE },
    jobRefs: ['tj_job_drift'],
  });
  const getToolJob = () => validJob('p_rs8', 'tj_job_drift', 'table', 'f'.repeat(64), sha256('print(6)\n'));
  const result = recoverResultStudioWorkspace({
    workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', runtimeLease: CURRENT_RUNTIME_LEASE,
  }, { repository: fx.repository, adapter: fx.adapter, getToolJob });
  assert.equal(result.recovered, false);
  assert.equal(result.before.status, 'blocked');
  assert.ok(result.before.pendingIssues.some((issue) => issue.kind === 'recovery_job_artifact_truth_drift'));
  assert.equal(fx.repository.getChangeSet('cs_job_drift').status, 'running');
  assert.equal(fx.repository.getCheckpoint('cp_job_drift').changeSetStatus, 'running');
});

test('P6 recovery transition and checkpoint rollback together on an injected failure', (context) => {
  const fx = fixture(context);
  fx.repository.createChangeSet({
    changeSetId: 'cs_atomic_recovery', projectId: 'p_rs8', baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_atomic_recovery', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_atomic_recovery', to: 'running' });
  const checkpoint = fx.repository.saveCheckpoint({
    checkpointId: 'cp_atomic_recovery', projectId: 'p_rs8', baseCommit: fx.base,
    changeSetId: 'cs_atomic_recovery', changeSetStatus: 'running', currentRevisionIds: ['rev_base'],
    pendingPreview: { stage: 'materialized', revisionIds: [], runtimeLease: PREVIOUS_RUNTIME_LEASE },
  });
  assert.throws(() => fx.repository.applyRecoveryTransition({
    transition: { changeSetId: 'cs_atomic_recovery', to: 'validation_failed', reason: 'injected' },
    expectedChangeSetStatus: 'running',
    expectedCheckpointHash: checkpoint.checkpointHash,
    checkpoint: {
      ...checkpoint,
      changeSetStatus: 'validation_failed',
      pendingPreview: { stage: 'failed', revisionIds: [], runtimeLease: CURRENT_RUNTIME_LEASE },
    },
    beforeCommit: () => { throw new Error('rollback injection'); },
  }), /rollback injection/);
  assert.equal(fx.repository.getChangeSet('cs_atomic_recovery').status, 'running');
  assert.equal(fx.repository.getCheckpoint('cp_atomic_recovery').changeSetStatus, 'running');
  assert.equal(fx.repository.verifyCheckpointIntegrity('cp_atomic_recovery').matches, true);
});

test('P6 new ChangeSet start leaves neither draft nor checkpoint on an injected failure', (context) => {
  const fx = fixture(context);
  assert.throws(() => fx.repository.startChangeSetWithCheckpoint({
    changeSet: {
      changeSetId: 'cs_atomic_start', projectId: 'p_rs8', baseCommit: fx.base,
      workingBranchRef: 'refs/heads/biof3/changeset/cs_atomic_start', createdBy: 'agent',
    },
    checkpoint: {
      checkpointId: 'cp_atomic_start', projectId: 'p_rs8', baseCommit: fx.base,
      changeSetId: 'cs_atomic_start', changeSetStatus: 'running', currentRevisionIds: ['rev_base'],
      pendingPreview: { stage: 'change_set', revisionIds: [], runtimeLease: CURRENT_RUNTIME_LEASE },
    },
    beforeCommit: () => { throw new Error('start rollback injection'); },
  }), /start rollback injection/);
  assert.equal(fx.repository.getChangeSet('cs_atomic_start'), null);
  assert.equal(fx.repository.getCheckpoint('cp_atomic_start'), null);
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

test('P6 blocks integrity when the persisted Revision inventory exceeds a capped scan', (context) => {
  const fx = fixture(context);
  const cappedRepository = {
    ...fx.repository,
    listAllProjectRevisions: undefined,
    listProjectRevisions: () => fx.repository.listProjectRevisions('p_rs8'),
    countProjectRevisions: () => 5_001,
  };
  const report = inspectResultStudioWorkspace({
    repository: cappedRepository,
    adapter: fx.adapter,
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.revisionIntegrity.revisionCount, 5_001);
  assert.ok(report.revisionIntegrity.issues.some(
    (issue) => issue.kind === 'revision_inventory_incomplete' && issue.blocking === true,
  ));
});

test('RS8 restores a missing current Git ref but blocks a conflicting ref', (context) => {
  const fx = fixture(context);
  fx.adapter.deleteRefCas({ ref: 'refs/heads/biof3/current/family', expectedOld: fx.base });
  assert.equal(inspectResultStudioWorkspace({ repository: fx.repository, adapter: fx.adapter, workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }).status, 'recovery_available');
  const repaired = recoverResultStudioWorkspace({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(repaired.after.status, 'ready');
  assert.equal(fx.adapter.revParse('refs/heads/biof3/current/family'), fx.base);

  const conflicting = fx.adapter.commitVirtualFiles({
    parentCommit: fx.base,
    ref: 'refs/heads/biof3/conflict',
    expectedOld: '0'.repeat(40),
    message: 'conflicting current ref',
    files: [{ path: 'analysis/scripts/conflict.R', content: 'print(99)\n' }],
  }).commit;
  fx.adapter.updateRefCas({
    ref: 'refs/heads/biof3/current/family',
    newCommit: conflicting,
    expectedOld: fx.base,
  });
  const blocked = inspectResultStudioWorkspace({
    repository: fx.repository,
    adapter: fx.adapter,
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
  });
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.revisionIntegrity.issues.some((issue) => issue.kind === 'current_ref_drift'));
  const refused = recoverResultStudioWorkspace({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, {
    repository: fx.repository,
    adapter: fx.adapter,
  });
  assert.equal(refused.recovered, false);
  assert.equal(fx.adapter.revParse('refs/heads/biof3/current/family'), conflicting);
});

test('P6 blocks a corrupted durable checkpoint without rewriting its evidence', (context) => {
  const fx = fixture(context);
  fx.repository.saveCheckpoint({
    checkpointId: 'cp_corrupt',
    projectId: 'p_rs8',
    conversationId: 'conv_corrupt',
    baseCommit: fx.base,
    changeSetId: 'cs_base',
    changeSetStatus: 'adopted',
    currentRevisionIds: ['rev_base'],
    pendingPreview: { stage: 'preview_ready', revisionIds: [] },
  });
  fx.db.prepare("UPDATE workspace_revision_checkpoints SET pending_preview_json='{}' WHERE checkpoint_id='cp_corrupt'").run();
  const before = fx.repository.getCheckpoint('cp_corrupt');
  const report = inspectResultStudioWorkspace({
    repository: fx.repository,
    adapter: fx.adapter,
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
    conversationId: 'conv_corrupt',
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.consistency.status, 'checkpoint_corrupt');
  const recovery = recoverResultStudioWorkspace({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
    conversationId: 'conv_corrupt',
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(recovery.recovered, false);
  assert.equal(fx.repository.getCheckpoint('cp_corrupt').checkpointHash, before.checkpointHash);
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
  const contentObject = join(fx.workspaceRoot, '.biof3/result-objects/sha256', fx.outputHash.slice(0, 2), fx.outputHash);
  mkdirSync(join(contentObject, '..'), { recursive: true });
  linkSync(fx.output, contentObject);
  rmSync(duplicatePath);
  linkSync(fx.output, duplicatePath);
  assert.equal(statSync(fx.output).ino, statSync(duplicatePath).ino);
  assert.equal(statSync(fx.output).ino, statSync(contentObject).ino);
  const dedupPlan = planArtifactDeduplication({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, { repository: fx.repository });
  const deduped = executeArtifactDeduplication({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', planToken: dedupPlan.planToken }, { repository: fx.repository });
  assert.equal(deduped.strategy, 'copy_on_write_clone');
  assert.equal(deduped.hardLinkCount, 0);
  assert.equal(deduped.clonedCount >= 2, true);
  assert.ok(deduped.clonePrimitives.every((primitive) => primitive.startsWith('copyfile_ficlone')));
  assert.equal(deduped.linkedCount >= 1, true);
  assert.notEqual(statSync(fx.output).ino, statSync(duplicatePath).ino);
  assert.notEqual(statSync(fx.output).ino, statSync(contentObject).ino);
  assert.notEqual(statSync(duplicatePath).ino, statSync(contentObject).ino);
  assert.equal(statSync(fx.output).nlink, 1);
  assert.equal(statSync(duplicatePath).nlink, 1);
  assert.equal(statSync(contentObject).nlink, 1);
  const original = readFileSync(fx.output);
  writeFileSync(duplicatePath, 'mutated after safe deduplication');
  assert.deepEqual(readFileSync(fx.output), original);
  assert.deepEqual(readFileSync(contentObject), original);
  writeFileSync(duplicatePath, original);
  const plan = planResultStudioGc({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(plan.artifactDeletionCount, 0);
  assert.match(plan.revisionSourceDigest, /^[a-f0-9]{64}$/);
  assert.match(plan.protectedSourceRefDigest, /^[a-f0-9]{64}$/);
  assert.equal(plan.sourceRevisionCount, 2);
  assert.equal(plan.sourceCommitCount, 1);
  assert.equal(plan.protectedSourceRefs[0].sourceCommit, fx.base);
  assert.ok(plan.entries.some((entry) => entry.relativePath?.endsWith('cs_orphan')));
  const executed = executeResultStudioGc({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', planToken: plan.planToken }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(executed.removedCount >= 1, true);
  assert.equal(executed.protectedSourceRefs[0].action, 'protected');
  assert.equal(readFileSync(fx.output, 'utf8').startsWith('gene'), true);
  assert.ok(fx.repository.getRevision('rev_orphan'));
});

test('P6 deduplication revalidates result-objects and never writes through a private symlink', (context) => {
  const fx = fixture(context);
  const duplicatePath = join(fx.workspaceRoot, 'results/jobs/tj_private_link/output/table.csv');
  mkdirSync(join(duplicatePath, '..'), { recursive: true });
  writeFileSync(duplicatePath, readFileSync(fx.output));
  fx.repository.createChangeSet({
    changeSetId: 'cs_private_link',
    projectId: 'p_rs8',
    baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_private_link',
    createdBy: 'agent',
  });
  fx.repository.appendRevision({
    revisionId: 'rev_private_link', projectId: 'p_rs8', artifactFamilyId: 'private_link', artifactId: 'table', sourceCommit: fx.base,
    sourceScriptRef: { relativePath: 'analysis/scripts/base.R', sha256: sha256('print(1)\n'), entryPoint: 'base.R', artifactId: 'table', rendererId: 'test:table', language: 'r', origin: 'project_materialized' },
    inputArtifactRefs: [], toolJobId: 'tj_private_link', outputPath: 'results/jobs/tj_private_link/output/table.csv', outputHash: fx.outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_private_link',
  });
  const plan = planArtifactDeduplication(
    { workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' },
    { repository: fx.repository },
  );
  const outside = mkdtempSync(join(tmpdir(), 'biof3-result-objects-outside-'));
  context.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(fx.workspaceRoot, '.biof3', 'result-objects'), 'dir');

  assert.throws(
    () => executeArtifactDeduplication(
      { workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', planToken: plan.planToken },
      { repository: fx.repository },
    ),
    (error) => error?.code === 'private_path_symlink',
  );
  assert.equal(existsSync(join(outside, 'sha256')), false);
  assert.deepEqual(readFileSync(duplicatePath), readFileSync(fx.output));
});

test('P6 GC revalidates revision staging before ref mutation or external deletion', (context) => {
  const fx = fixture(context);
  fx.repository.createChangeSet({
    changeSetId: 'cs_private_gc',
    projectId: 'p_rs8',
    baseCommit: fx.base,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_private_gc',
    createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_private_gc', to: 'abandoned' });
  const revisionRoot = join(fx.workspaceRoot, '.biof3', 'revision');
  const staging = join(revisionRoot, 'cs_private_gc');
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, 'candidate.R'), 'print(1)\n');
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  utimesSync(staging, old, old);
  const plan = planResultStudioGc(
    { workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' },
    { repository: fx.repository, adapter: fx.adapter },
  );
  assert.ok(plan.entries.some((entry) => entry.relativePath === '.biof3/revision/cs_private_gc'));

  rmSync(revisionRoot, { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), 'biof3-revision-outside-'));
  context.after(() => rmSync(outside, { recursive: true, force: true }));
  const outsideStaging = join(outside, 'cs_private_gc');
  mkdirSync(outsideStaging);
  const marker = join(outsideStaging, 'keep.txt');
  writeFileSync(marker, 'must survive');
  symlinkSync(outside, revisionRoot, 'dir');

  assert.throws(
    () => executeResultStudioGc(
      { workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', planToken: plan.planToken },
      { repository: fx.repository, adapter: fx.adapter },
    ),
    (error) => error?.code === 'private_path_symlink',
  );
  assert.equal(readFileSync(marker, 'utf8'), 'must survive');
  assert.equal(fx.adapter.revParse('refs/heads/biof3/result-sources/' + fx.base), null);
});

test('P6 GC atomically protects every persisted Revision source before deleting a closed candidate ref', (context) => {
  const fx = fixture(context);
  const sourceText = 'message("historical source remains replayable")\n';
  const candidateRef = 'refs/heads/biof3/changeset/cs_historical_source';
  const candidate = fx.adapter.commitVirtualFiles({
    parentCommit: fx.base,
    ref: candidateRef,
    expectedOld: '0'.repeat(40),
    message: 'historical source candidate',
    files: [{ path: 'analysis/scripts/historical-source.R', content: sourceText }],
  }).commit;
  fx.repository.createChangeSet({
    changeSetId: 'cs_historical_source',
    projectId: 'p_rs8',
    baseCommit: fx.base,
    workingBranchRef: candidateRef,
    createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_historical_source', to: 'running' });
  fx.repository.appendRevision({
    revisionId: 'rev_historical_source',
    projectId: 'p_rs8',
    artifactFamilyId: 'historical',
    artifactId: 'table',
    sourceCommit: candidate,
    sourceScriptRef: {
      relativePath: 'analysis/scripts/historical-source.R',
      sha256: sha256(sourceText),
      entryPoint: 'historical-source.R',
      artifactId: 'table',
      rendererId: 'test:table',
      language: 'r',
      origin: 'project_materialized',
    },
    inputArtifactRefs: [],
    toolJobId: 'tj_historical_source',
    outputPath: 'results/jobs/tj_base/output/table.csv',
    outputHash: fx.outputHash,
    validationStatus: 'valid',
    reproducibilityStatus: 'available',
    changeSetId: 'cs_historical_source',
  });
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_historical_source',
    to: 'validation_failed',
    reason: 'fixture_terminal_state',
    candidateCommit: candidate,
  });

  const plan = planResultStudioGc({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
  }, { repository: fx.repository, adapter: fx.adapter });
  const protection = plan.protectedSourceRefs.find((entry) => entry.sourceCommit === candidate);
  const deletion = plan.entries.find((entry) => entry.kind === 'candidate_ref' && entry.ref === candidateRef);
  assert.ok(protection);
  assert.equal(protection.action, 'create_before_cleanup');
  assert.deepEqual(protection.revisionIds, ['rev_historical_source']);
  assert.ok(deletion);
  assert.equal(deletion.independentSourceRef, protection.ref);
  assert.equal(deletion.independentlyReachableAfterPlan, true);
  assert.deepEqual(deletion.sourceRevisionIds, ['rev_historical_source']);

  const executed = executeResultStudioGc({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
    planToken: plan.planToken,
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(fx.adapter.revParse(candidateRef), null);
  assert.equal(fx.adapter.revParse(protection.ref), candidate);
  assert.equal(executed.protectedSourceRefs.find((entry) => entry.sourceCommit === candidate)?.action, 'protected');

  const expired = fx.adapter.run(['reflog', 'expire', '--expire=now', '--all'], { allowFailure: true });
  assert.equal(expired.ok, true, expired.stderr);
  const collected = fx.adapter.run(['gc', '--prune=now'], { allowFailure: true });
  assert.equal(collected.ok, true, collected.stderr);
  const revisions = assertAllRevisionSourcesAvailable(fx.repository, fx.adapter, 'p_rs8');
  assert.deepEqual(revisions.map((revision) => revision.revisionId), ['rev_base', 'rev_historical_source']);
  assert.equal(fx.adapter.showFile({ ref: candidate, filePath: 'analysis/scripts/historical-source.R' }), sourceText);
});

test('P6 GC deletes a closed non-source candidate ref only after independent reachability is proven', (context) => {
  const fx = fixture(context);
  const candidateRef = 'refs/heads/biof3/changeset/cs_unreferenced_candidate';
  const candidate = fx.adapter.commitVirtualFiles({
    parentCommit: fx.base,
    ref: candidateRef,
    expectedOld: '0'.repeat(40),
    message: 'unreferenced closed candidate',
    files: [{ path: 'analysis/scripts/unreferenced-candidate.R', content: 'print("closed")\n' }],
  }).commit;
  fx.repository.createChangeSet({
    changeSetId: 'cs_unreferenced_candidate', projectId: 'p_rs8', baseCommit: fx.base,
    workingBranchRef: candidateRef, createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_unreferenced_candidate', to: 'running' });
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_unreferenced_candidate', to: 'validation_failed', candidateCommit: candidate,
  });

  const protectedPlan = planResultStudioGc({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(protectedPlan.entries.some((entry) => entry.ref === candidateRef), false);
  assert.equal(protectedPlan.protectedCandidateRefs.length, 1);
  assert.equal(protectedPlan.protectedCandidateRefs[0].ref, candidateRef);
  assert.equal(protectedPlan.protectedCandidateRefs[0].independentlyReachableAfterPlan, false);
  assert.equal(fx.adapter.revParse(candidateRef), candidate);

  const independentRef = 'refs/heads/biof3/archive/unreferenced_candidate';
  fx.adapter.updateRefCas({ ref: independentRef, newCommit: candidate, expectedOld: '0'.repeat(40) });
  const deletablePlan = planResultStudioGc({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
  }, { repository: fx.repository, adapter: fx.adapter });
  const deletion = deletablePlan.entries.find((entry) => entry.ref === candidateRef);
  assert.ok(deletion);
  assert.equal(deletion.independentlyReachableAfterPlan, true);
  assert.equal(deletion.independentReachabilityCount >= 1, true);
  executeResultStudioGc({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
    planToken: deletablePlan.planToken,
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(fx.adapter.revParse(candidateRef), null);
  assert.equal(fx.adapter.revParse(independentRef), candidate);
});

test('P6 GC fails closed when a deterministic source protection ref conflicts', (context) => {
  const fx = fixture(context);
  const sourceText = 'message("protected conflict")\n';
  const candidateRef = 'refs/heads/biof3/changeset/cs_source_conflict';
  const candidate = fx.adapter.commitVirtualFiles({
    parentCommit: fx.base,
    ref: candidateRef,
    expectedOld: '0'.repeat(40),
    message: 'source protection conflict',
    files: [{ path: 'analysis/scripts/source-conflict.R', content: sourceText }],
  }).commit;
  fx.repository.createChangeSet({
    changeSetId: 'cs_source_conflict', projectId: 'p_rs8', baseCommit: fx.base,
    workingBranchRef: candidateRef, createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_source_conflict', to: 'running' });
  fx.repository.appendRevision({
    revisionId: 'rev_source_conflict', projectId: 'p_rs8', artifactFamilyId: 'source_conflict', artifactId: 'table',
    sourceCommit: candidate,
    sourceScriptRef: {
      relativePath: 'analysis/scripts/source-conflict.R', sha256: sha256(sourceText), entryPoint: 'source-conflict.R',
      artifactId: 'table', rendererId: 'test:table', language: 'r', origin: 'project_materialized',
    },
    inputArtifactRefs: [], toolJobId: 'tj_source_conflict', outputPath: 'results/jobs/tj_base/output/table.csv', outputHash: fx.outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_source_conflict',
  });
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_source_conflict', to: 'validation_failed', candidateCommit: candidate,
  });
  const protectedRef = `refs/heads/biof3/result-sources/${candidate}`;
  fx.adapter.updateRefCas({ ref: protectedRef, newCommit: fx.base, expectedOld: '0'.repeat(40) });

  assert.throws(
    () => planResultStudioGc({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, {
      repository: fx.repository,
      adapter: fx.adapter,
    }),
    (error) => error?.code === 'gc_source_ref_conflict'
      && error.detail?.expectedCommit === candidate
      && error.detail?.actualCommit === fx.base,
  );
  assert.equal(fx.adapter.revParse(candidateRef), candidate);
  assert.equal(fx.adapter.showFile({ ref: candidate, filePath: 'analysis/scripts/source-conflict.R' }), sourceText);
});

test('P6 GC only deletes the exact server-derived ChangeSet candidate ref', (context) => {
  const fx = fixture(context);
  const protectedRefs = [
    ['cs_current_ref', 'refs/heads/biof3/current/family'],
    ['cs_main_ref', 'refs/heads/biof3/main'],
    ['cs_baseline_ref', 'refs/heads/biof3/baseline/cs_baseline_ref'],
    ['cs_source_ref', 'refs/heads/biof3/result-sources/manual'],
    ['cs_internal_ref', 'refs/heads/biof3/archive/keep'],
    ['cs_external_ref', 'refs/heads/user-owned/result-candidate'],
    ['cs_mismatched_candidate', 'refs/heads/biof3/changeset/not_cs_mismatched_candidate'],
  ];
  for (const [changeSetId, ref] of protectedRefs) {
    if (!fx.adapter.revParse(ref)) {
      const created = fx.adapter.run(['update-ref', ref, fx.base, '0'.repeat(40)], { allowFailure: true });
      assert.equal(created.ok, true, created.stderr);
    }
    fx.repository.createChangeSet({
      changeSetId, projectId: 'p_rs8', baseCommit: fx.base, workingBranchRef: ref, createdBy: 'agent',
    });
    fx.repository.transitionChangeSet({ changeSetId, to: 'running' });
    fx.repository.transitionChangeSet({ changeSetId, to: 'validation_failed', candidateCommit: fx.base });
  }

  const plan = planResultStudioGc({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.ok(protectedRefs.every(([, ref]) => !plan.entries.some((entry) => entry.ref === ref)));

  executeResultStudioGc({
    workspaceRoot: fx.workspaceRoot,
    projectId: 'p_rs8',
    planToken: plan.planToken,
  }, { repository: fx.repository, adapter: fx.adapter });
  for (const [, ref] of protectedRefs) assert.equal(fx.adapter.revParse(ref), fx.base);
});

test('P6 rejects stale GC plans and deduplication after Artifact drift', (context) => {
  const fx = fixture(context);
  fx.repository.createChangeSet({ changeSetId: 'cs_cleanup', projectId: 'p_rs8', baseCommit: fx.base, workingBranchRef: 'refs/heads/biof3/changeset/cs_cleanup', createdBy: 'agent' });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_cleanup', to: 'abandoned' });
  const staging = join(fx.workspaceRoot, '.biof3/revision/cs_cleanup');
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, 'candidate.R'), 'print(2)');
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  utimesSync(staging, old, old);
  const gcPlan = planResultStudioGc({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, { repository: fx.repository, adapter: fx.adapter });
  mkdirSync(join(fx.workspaceRoot, '.biof3/revision/.tmp-new'), { recursive: true });
  utimesSync(join(fx.workspaceRoot, '.biof3/revision/.tmp-new'), old, old);
  assert.throws(
    () => executeResultStudioGc({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', planToken: gcPlan.planToken }, { repository: fx.repository, adapter: fx.adapter }),
    (error) => error?.code === 'gc_plan_stale',
  );
  assert.ok(fx.repository.getRevision('rev_base'));
  assert.equal(readFileSync(fx.output, 'utf8').startsWith('gene'), true);

  const duplicatePath = join(fx.workspaceRoot, 'results/jobs/tj_duplicate/output/table.csv');
  mkdirSync(join(duplicatePath, '..'), { recursive: true });
  writeFileSync(duplicatePath, readFileSync(fx.output));
  fx.repository.createChangeSet({ changeSetId: 'cs_duplicate', projectId: 'p_rs8', baseCommit: fx.base, workingBranchRef: 'refs/heads/biof3/changeset/cs_duplicate', createdBy: 'agent' });
  fx.repository.appendRevision({
    revisionId: 'rev_duplicate', projectId: 'p_rs8', artifactFamilyId: 'duplicate', artifactId: 'table', sourceCommit: fx.base,
    sourceScriptRef: { relativePath: 'analysis/scripts/base.R', sha256: sha256('print(1)\n'), entryPoint: 'base.R', artifactId: 'table', rendererId: 'test:table', language: 'r', origin: 'project_materialized' },
    inputArtifactRefs: [], toolJobId: 'tj_duplicate', outputPath: 'results/jobs/tj_duplicate/output/table.csv', outputHash: fx.outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_duplicate',
  });
  const dedupPlan = planArtifactDeduplication({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8' }, { repository: fx.repository });
  writeFileSync(duplicatePath, 'externally modified');
  assert.throws(
    () => executeArtifactDeduplication({ workspaceRoot: fx.workspaceRoot, projectId: 'p_rs8', planToken: dedupPlan.planToken }, { repository: fx.repository }),
    (error) => error?.code === 'dedup_artifact_drift',
  );
  assert.equal(readFileSync(fx.output, 'utf8').startsWith('gene'), true);
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
  assert.doesNotMatch(first.caveat, /multiline cells are not supported/i);
});

test('P6 Revision table pages bind every parsed byte to one Artifact Truth descriptor', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-p6-table-truth-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const filePath = join(root, 'truth.csv');
  const original = 'id,value\nA,1\nB,2\n';
  const changed = 'id,value\nA,9\nB,8\n';
  const expectedSha256 = sha256(original);
  writeFileSync(filePath, original);

  assert.deepEqual(
    readTablePage({ filePath, expectedSha256, limit: 10 }).rows,
    [['A', '1'], ['B', '2']],
  );
  assert.throws(
    () => readTablePage({ filePath, expectedSha256: 'not-a-sha', limit: 10 }),
    (error) => error?.code === 'artifact_truth_unavailable',
  );

  let openCount = 0;
  let closeCount = 0;
  let initialHashComplete = false;
  let mutated = false;
  const io = {
    constants,
    openSync(...args) {
      openCount += 1;
      return openSync(...args);
    },
    fstatSync,
    closeSync(handle) {
      closeCount += 1;
      return closeSync(handle);
    },
    readSync(...args) {
      const bytesRead = readSync(...args);
      if (!initialHashComplete && bytesRead === 0) {
        initialHashComplete = true;
        writeFileSync(filePath, changed);
        mutated = true;
      }
      return bytesRead;
    },
  };
  assert.throws(
    () => readTablePage({ filePath, expectedSha256, limit: 10, io }),
    (error) => error?.code === 'artifact_truth_drift',
  );
  assert.equal(mutated, true);
  assert.equal(openCount, 1);
  assert.equal(closeCount, 1);
});

test('P6 progressive table pages round-trip RFC4180 records at exact byte boundaries', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-p6-rfc4180-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const filePath = join(root, 'unicode.csv');
  writeFileSync(filePath, [
    'id,note,language',
    '1,"alpha, beta",plain',
    '2,"line one\r\nline two","汉字"',
    '3,"escaped ""quote""","🙂"',
    '4,last,é',
  ].join('\r\n'));

  const expected = [
    ['1', 'alpha, beta', 'plain'],
    ['2', 'line one\r\nline two', '汉字'],
    ['3', 'escaped "quote"', '🙂'],
    ['4', 'last', 'é'],
  ];
  const bytes = readFileSync(filePath);
  const rows = [];
  const cursors = [];
  let cursor = 0;
  do {
    const page = readTablePage({ filePath, cursor, limit: 1 });
    assert.deepEqual(page.columns, ['id', 'note', 'language']);
    rows.push(...page.rows);
    cursor = page.nextCursor;
    if (cursor !== null) {
      assert.equal(bytes[cursor - 1], 0x0a);
      cursors.push(cursor);
    }
  } while (cursor !== null);
  assert.deepEqual(rows, expected);
  assert.equal(new Set(cursors).size, cursors.length);
  assert.ok(cursors.every((value, index) => index === 0 || value > cursors[index - 1]));
});

test('P6 progressive table reader supports quoted TSV delimiters and a header beyond 64 KiB', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-p6-long-header-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const tsvPath = join(root, 'quoted.tsv');
  writeFileSync(tsvPath, 'id\tnote\r\n1\t"alpha\tbeta"\r\n2\t"line one\nline two"\r\n');
  const tsv = readTablePage({ filePath: tsvPath, cursor: 0, limit: 10 });
  assert.deepEqual(tsv.columns, ['id', 'note']);
  assert.deepEqual(tsv.rows, [['1', 'alpha\tbeta'], ['2', 'line one\nline two']]);
  assert.equal(tsv.nextCursor, null);

  const longColumn = `column_${'x'.repeat(70 * 1024)}`;
  const csvPath = join(root, 'long-header.csv');
  writeFileSync(csvPath, `"${longColumn}",value\r\ncell,1\r\n`);
  const csv = readTablePage({ filePath: csvPath, cursor: 0, limit: 1 });
  assert.equal(csv.columns[0], longColumn);
  assert.equal(csv.columns[1], 'value');
  assert.deepEqual(csv.rows, [['cell', '1']]);
  assert.equal(csv.nextCursor, null);

  const chunkBoundaryPath = join(root, 'utf8-chunk-boundary.csv');
  const chunkPrefix = 'a'.repeat((64 * 1024) - Buffer.byteLength('1,"') - 1);
  writeFileSync(chunkBoundaryPath, `id,note\n1,"${chunkPrefix}汉"\n`);
  const chunkBoundary = readTablePage({ filePath: chunkBoundaryPath, cursor: 0, limit: 1 });
  assert.equal(chunkBoundary.rows[0][1], `${chunkPrefix}汉`);
  assert.equal(chunkBoundary.nextCursor, null);
});

test('P6 progressive table reader fails closed for incomplete and oversized records', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-p6-invalid-table-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, content) => {
    const filePath = join(root, name);
    writeFileSync(filePath, content);
    return filePath;
  };

  assert.throws(
    () => readTablePage({ filePath: write('incomplete-header.csv', 'id,"note\r\n1,value\r\n') }),
    (error) => error?.code === 'table_header_incomplete_quoted_record',
  );
  assert.throws(
    () => readTablePage({ filePath: write('oversized-header.csv', `${'h'.repeat(300 * 1024)}\n`) }),
    (error) => error?.code === 'table_header_too_large',
  );
  assert.throws(
    () => readTablePage({ filePath: write('incomplete-record.csv', 'value\r\n"unterminated\r\n') }),
    (error) => error?.code === 'table_record_incomplete_quoted_record',
  );
  assert.throws(
    () => readTablePage({ filePath: write('oversized-record.csv', `value\n${'x'.repeat(1024 * 1024 + 16)}\n`) }),
    (error) => error?.code === 'table_record_too_large',
  );
});

test('RS8 preview budget queues concurrency and blocks resource pressure without changing science', () => {
  const snapshot = { state: 'ready', memory: { availableBytes: 8_000 }, disk: { availableBytes: 20_000 } };
  assert.equal(evaluatePreviewResourceBudget({
    resourceSnapshot: snapshot,
    estimatedMemoryBytes: 1,
    estimatedDiskBytes: 1,
    activePreviewJobs: 2,
  }).decision, 'queued');
  const blocked = evaluatePreviewResourceBudget({
    resourceSnapshot: snapshot,
    estimatedMemoryBytes: 7_000,
    estimatedDiskBytes: 1,
  });
  assert.equal(blocked.decision, 'blocked');
  assert.equal(blocked.scientificParametersChanged, false);
  const unknown = evaluatePreviewResourceBudget({
    resourceSnapshot: { state: 'unavailable', memory: { availableBytes: null }, disk: { availableBytes: 20_000 } },
    estimatedMemoryBytes: 1,
    estimatedDiskBytes: 1,
  });
  assert.equal(unknown.decision, 'blocked');
  assert.ok(unknown.reasons.includes('memory_measurement_unavailable'));
});
