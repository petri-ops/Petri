import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { ensureResultRefTransactionSchema } = require('../core/shared-backend/result-ref-transaction-schema');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const {
  getResultStudioRuntimeLease,
  isResultStudioRuntimeLeaseOwnerAlive,
} = require('../core/shared-backend/result-studio-runtime-lease');
const {
  executeDurableRefTransaction,
  hasValidIntentHash,
  recoverActiveRefTransactions,
} = require('../core/shared-backend/result-ref-transaction');

const ZERO_OID = '0'.repeat(40);
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const COMMIT_C = 'c'.repeat(40);
const HASH_A = '1'.repeat(64);
const HASH_B = '2'.repeat(64);
const CURRENT_RUNTIME_LEASE = getResultStudioRuntimeLease();
const DATABASE_MODULE_PATH = require.resolve('better-sqlite3');
const REPOSITORY_MODULE_PATH = require.resolve('../core/shared-backend/result-studio-repository');

class MemoryRefAdapter {
  constructor(entries = []) {
    this.refs = new Map(entries);
    this.readFailure = null;
    this.throwAfterApply = null;
  }

  revParse(ref) {
    return this.refs.get(ref) || null;
  }

  readRefExact(ref) {
    if (this.readFailure) throw this.readFailure;
    return this.revParse(ref);
  }

  updateRefsCas({ updates }) {
    for (const update of updates) {
      const actual = this.revParse(update.ref) || ZERO_OID;
      if (actual !== update.expectedOld) {
        const error = new Error('Git ref compare-and-swap failed.');
        error.code = 'git_ref_transaction_conflict';
        throw error;
      }
    }
    for (const update of updates) {
      if (update.newOid === ZERO_OID) this.refs.delete(update.ref);
      else this.refs.set(update.ref, update.newOid);
    }
    if (this.throwAfterApply) {
      const error = this.throwAfterApply;
      this.throwAfterApply = null;
      throw error;
    }
    return { updated: updates.length };
  }
}

function revisionInput({ changeSetId, revisionId, familyId, artifactId, sourceCommit, parentRevisionIds = [] }) {
  return {
    revisionId,
    projectId: 'project_p6_ref',
    artifactFamilyId: familyId,
    artifactId,
    parentRevisionIds,
    sourceCommit,
    toolJobId: `job_${revisionId}`,
    outputPath: `results/jobs/job_${revisionId}/output/${artifactId}.csv`,
    outputHash: sourceCommit === COMMIT_A ? HASH_A : HASH_B,
    validationStatus: 'valid',
    reproducibilityStatus: 'available',
    changeSetId,
  };
}

function makeFixture(context, { families = ['family_a'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'biof3-p6-ref-tx-'));
  const dbPath = join(root, 'result-studio.db');
  context.after(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      // Windows：被测服务可能仍持有 SQLite/文件句柄；EPERM/EBUSY 交由 OS 清理临时目录
      if (error && (error.code === 'EPERM' || error.code === 'EBUSY')) return;
      throw error;
    }
  });
  const db = new Database(dbPath);
  context.after(() => { try { db.close(); } catch { /* already closed */ } });
  ensureResultStudioSchema(db);
  ensureResultRefTransactionSchema(db);
  const repository = createResultStudioRepository(db, { ensureSchema: false });

  repository.createChangeSet({
    changeSetId: 'cs_base',
    projectId: 'project_p6_ref',
    baseCommit: COMMIT_A,
    workingBranchRef: 'refs/heads/biof3/baseline/cs_base',
    createdBy: 'agent',
  });
  repository.transitionChangeSet({ changeSetId: 'cs_base', to: 'running' });
  repository.transitionChangeSet({
    changeSetId: 'cs_base',
    to: 'preview_ready',
    candidateCommit: COMMIT_A,
  });
  const baseRevisions = families.map((familyId, index) => revisionInput({
    changeSetId: 'cs_base',
    revisionId: `rev_base_${index}`,
    familyId,
    artifactId: `artifact_${index}`,
    sourceCommit: COMMIT_A,
  }));
  for (const revision of baseRevisions) repository.appendRevision(revision);
  repository.adoptChangeSet({ changeSetId: 'cs_base', candidateCommit: COMMIT_A });

  const candidates = createCandidate(repository, {
    changeSetId: 'cs_candidate',
    sourceCommit: COMMIT_B,
    baseRevisions,
  });
  const refs = families.map((familyId) => [`refs/heads/biof3/current/${familyId}`, COMMIT_A]);
  return {
    dbPath,
    db,
    repository,
    adapter: new MemoryRefAdapter(refs),
    baseRevisions,
    candidates,
  };
}

function prepareRefTransactionInExitedRuntime(dbPath, input) {
  const childSource = `
const Database = require(${JSON.stringify(DATABASE_MODULE_PATH)});
const { createResultStudioRepository } = require(${JSON.stringify(REPOSITORY_MODULE_PATH)});
const db = new Database(process.argv[1]);
try {
  const repository = createResultStudioRepository(db, { ensureSchema: false });
  const intent = repository.prepareRefTransaction(JSON.parse(process.argv[2]));
  process.stdout.write(JSON.stringify({ ownerLease: intent.ownerLease, state: intent.state }));
} finally {
  db.close();
}
`;
  const prepared = spawnSync(
    process.execPath,
    ['-e', childSource, dbPath, JSON.stringify({ ...input, ownerLease: undefined })],
    { encoding: 'utf8' },
  );
  assert.equal(
    prepared.status,
    0,
    `restart fixture failed to prepare its durable journal: ${prepared.stderr || prepared.error?.message || 'unknown error'}`,
  );
  return JSON.parse(prepared.stdout);
}

function createCandidate(repository, { changeSetId, sourceCommit, baseRevisions }) {
  repository.createChangeSet({
    changeSetId,
    projectId: 'project_p6_ref',
    baseCommit: COMMIT_A,
    workingBranchRef: `refs/heads/biof3/changeset/${changeSetId}`,
    createdBy: 'agent',
  });
  repository.transitionChangeSet({ changeSetId, to: 'running' });
  const candidates = baseRevisions.map((baseRevision, index) => revisionInput({
    changeSetId,
    revisionId: `rev_${changeSetId}_${index}`,
    familyId: baseRevision.artifactFamilyId,
    artifactId: baseRevision.artifactId,
    sourceCommit,
    parentRevisionIds: [baseRevision.revisionId],
  }));
  for (const revision of candidates) repository.appendRevision(revision);
  repository.transitionChangeSet({
    changeSetId,
    to: 'preview_ready',
    candidateCommit: sourceCommit,
    candidateArtifactRefs: candidates.map((revision) => revision.revisionId),
  });
  return candidates;
}

function transitionInput({
  operationId = 'rft_adopt',
  changeSetId = 'cs_candidate',
  candidates,
  currentRevisionIds = candidates.map((revision) => revision.revisionId),
  ownerLease = CURRENT_RUNTIME_LEASE,
}) {
  return {
    operationId,
    projectId: 'project_p6_ref',
    changeSetId,
    operationKind: 'adopt',
    sourceStatus: 'preview_ready',
    targetStatus: 'adopted',
    ownerLease,
    refUpdates: candidates.map((revision) => ({
      ref: `refs/heads/biof3/current/${revision.artifactFamilyId}`,
      expectedOld: COMMIT_A,
      newOid: revision.sourceCommit,
    })),
    targetRevisionIds: candidates.map((revision) => revision.revisionId),
    checkpoint: {
      checkpointId: `checkpoint_${operationId}`,
      projectId: 'project_p6_ref',
      changeSetId,
      changeSetStatus: 'adopted',
      baseCommit: COMMIT_A,
      candidateCommit: candidates[0].sourceCommit,
      currentRevisionIds,
      pendingPreview: {
        stage: 'adopted',
        revisionIds: candidates.map((revision) => revision.revisionId),
      },
    },
  };
}

test('P6 durable ref transaction atomically finalizes a multi-family cohort', (context) => {
  const { repository, adapter, candidates } = makeFixture(context, {
    families: ['family_a', 'family_b'],
  });
  const result = executeDurableRefTransaction(
    transitionInput({ candidates }),
    { repository, adapter },
  );

  assert.equal(result.intent.state, 'completed');
  assert.equal(repository.getChangeSet('cs_candidate').status, 'adopted');
  assert.deepEqual(
    repository.listCurrentRevisions('project_p6_ref').map((revision) => revision.revisionId).sort(),
    candidates.map((revision) => revision.revisionId).sort(),
  );
  for (const candidate of candidates) {
    assert.equal(adapter.revParse(`refs/heads/biof3/current/${candidate.artifactFamilyId}`), COMMIT_B);
  }
});

test('P6 ordinary post-ref failure rolls Git back and aborts the journal', (context) => {
  const { repository, adapter, candidates, baseRevisions } = makeFixture(context);
  assert.throws(
    () => executeDurableRefTransaction(transitionInput({ candidates }), {
      repository,
      adapter,
      afterRefsApplied() {
        const error = new Error('injected failure');
        error.code = 'injected_after_refs';
        throw error;
      },
    }),
    /injected failure/,
  );
  assert.equal(adapter.revParse('refs/heads/biof3/current/family_a'), COMMIT_A);
  assert.equal(repository.getRefTransaction('rft_adopt').state, 'aborted');
  assert.equal(repository.getChangeSet('cs_candidate').status, 'preview_ready');
  assert.equal(repository.getCurrentRevision('family_a').revisionId, baseRevisions[0].revisionId);
});

test('P6 execute refuses SQLite acknowledgement when a ref drifts after atomic Git apply', (context) => {
  const {
    repository,
    adapter,
    candidates,
    baseRevisions,
  } = makeFixture(context, { families: ['family_a', 'family_b'] });
  assert.throws(
    () => executeDurableRefTransaction(transitionInput({ candidates }), {
      repository,
      adapter,
      afterRefsApplied() {
        adapter.refs.set('refs/heads/biof3/current/family_b', COMMIT_C);
      },
    }),
    (error) => error?.code === 'ref_transaction_git_postcondition_failed',
  );

  assert.equal(repository.getRefTransaction('rft_adopt').state, 'prepared');
  assert.equal(repository.getChangeSet('cs_candidate').status, 'preview_ready');
  assert.deepEqual(
    repository.listCurrentRevisions('project_p6_ref').map((revision) => revision.revisionId).sort(),
    baseRevisions.map((revision) => revision.revisionId).sort(),
  );
  assert.equal(adapter.revParse('refs/heads/biof3/current/family_a'), COMMIT_B);
  assert.equal(adapter.revParse('refs/heads/biof3/current/family_b'), COMMIT_C);

  const recovered = recoverActiveRefTransactions(
    { projectId: 'project_p6_ref', runtimeLease: CURRENT_RUNTIME_LEASE },
    { repository, adapter },
  );
  assert.deepEqual(recovered.repaired, []);
  assert.equal(recovered.blocked[0].kind, 'ref_transaction_git_conflict');
  assert.equal(repository.getRefTransaction('rft_adopt').state, 'prepared');
});

test('P6 recovery resumes an all-old prepared transaction', (context) => {
  const { repository, adapter, candidates } = makeFixture(context);
  repository.prepareRefTransaction(transitionInput({ candidates }));

  const recovered = recoverActiveRefTransactions(
    { projectId: 'project_p6_ref' },
    { repository, adapter },
  );
  assert.deepEqual(recovered.blocked, []);
  assert.deepEqual(recovered.repaired.map((item) => item.repair), [
    'ref_transaction_refs_resumed',
    'ref_transaction_sqlite_finalized',
  ]);
  assert.equal(repository.getRefTransaction('rft_adopt').state, 'completed');
  assert.equal(adapter.revParse('refs/heads/biof3/current/family_a'), COMMIT_B);
});

test('P6 restart recovers a prepared journal after its different owner process exits', (context) => {
  const { dbPath, db, adapter, candidates } = makeFixture(context);
  const input = transitionInput({ operationId: 'rft_restart', candidates });
  db.close();

  const prepared = prepareRefTransactionInExitedRuntime(dbPath, input);
  assert.equal(prepared.state, 'prepared');
  assert.notEqual(prepared.ownerLease.instanceId, CURRENT_RUNTIME_LEASE.instanceId);
  assert.equal(isResultStudioRuntimeLeaseOwnerAlive(prepared.ownerLease), false);

  const restartedDb = new Database(dbPath);
  try {
    const restartedRepository = createResultStudioRepository(restartedDb, { ensureSchema: false });
    assert.deepEqual(
      restartedRepository.getRefTransaction('rft_restart').ownerLease,
      prepared.ownerLease,
    );

    const recovered = recoverActiveRefTransactions(
      { projectId: 'project_p6_ref', runtimeLease: CURRENT_RUNTIME_LEASE },
      { repository: restartedRepository, adapter },
    );
    assert.deepEqual(recovered.blocked, []);
    assert.deepEqual(recovered.repaired.map((item) => item.repair), [
      'ref_transaction_refs_resumed',
      'ref_transaction_sqlite_finalized',
    ]);
    assert.equal(restartedRepository.getRefTransaction('rft_restart').state, 'completed');
    assert.equal(restartedRepository.getChangeSet('cs_candidate').status, 'adopted');
    assert.equal(restartedRepository.getCurrentRevision('family_a').revisionId, candidates[0].revisionId);
    assert.equal(adapter.revParse('refs/heads/biof3/current/family_a'), COMMIT_B);
  } finally {
    restartedDb.close();
  }
});

test('P6 recovery finalizes an all-new transaction left before SQLite acknowledgement', (context) => {
  const { repository, adapter, candidates } = makeFixture(context);
  const intent = repository.prepareRefTransaction(transitionInput({ candidates }));
  adapter.updateRefsCas({ updates: intent.refUpdates });

  const recovered = recoverActiveRefTransactions(
    { projectId: 'project_p6_ref' },
    { repository, adapter },
  );
  assert.deepEqual(recovered.blocked, []);
  assert.deepEqual(recovered.repaired.map((item) => item.repair), [
    'ref_transaction_sqlite_finalized',
  ]);
  assert.equal(repository.getChangeSet('cs_candidate').status, 'adopted');
  assert.equal(repository.getCurrentRevision('family_a').revisionId, candidates[0].revisionId);
});

test('P6 recovery blocks a third-value Git ref without changing SQLite truth', (context) => {
  const { repository, adapter, candidates, baseRevisions } = makeFixture(context);
  repository.prepareRefTransaction(transitionInput({ candidates }));
  adapter.refs.set('refs/heads/biof3/current/family_a', COMMIT_C);

  const recovered = recoverActiveRefTransactions(
    { projectId: 'project_p6_ref' },
    { repository, adapter },
  );
  assert.equal(recovered.blocked[0].kind, 'ref_transaction_git_conflict');
  assert.equal(repository.getRefTransaction('rft_adopt').state, 'prepared');
  assert.equal(repository.getChangeSet('cs_candidate').status, 'preview_ready');
  assert.equal(repository.getCurrentRevision('family_a').revisionId, baseRevisions[0].revisionId);
});

test('P6 failed atomic Git CAS preserves its journal when a third-value ref makes ownership ambiguous', (context) => {
  const { repository, adapter, candidates } = makeFixture(context);
  adapter.refs.set('refs/heads/biof3/current/family_a', COMMIT_C);
  assert.throws(
    () => executeDurableRefTransaction(transitionInput({ candidates }), { repository, adapter }),
    (error) => error?.code === 'git_ref_transaction_conflict',
  );
  assert.equal(repository.getRefTransaction('rft_adopt').state, 'prepared');
  assert.equal(repository.getChangeSet('cs_candidate').status, 'preview_ready');
});

test('P6 an ambiguous Git acknowledgement finalizes only after exact all-new observation', (context) => {
  const { repository, adapter, candidates } = makeFixture(context);
  const ambiguous = new Error('git child acknowledgement lost');
  ambiguous.code = 'git_ref_transaction_unknown';
  adapter.throwAfterApply = ambiguous;
  const result = executeDurableRefTransaction(
    transitionInput({ candidates }),
    { repository, adapter },
  );
  assert.equal(result.recovered, true);
  assert.equal(result.acknowledgementRecovered, true);
  assert.equal(repository.getRefTransaction('rft_adopt').state, 'completed');
  assert.equal(repository.getChangeSet('cs_candidate').status, 'adopted');
  assert.equal(adapter.revParse('refs/heads/biof3/current/family_a'), COMMIT_B);
});

test('P6 prepared journals cannot finalize before Git acknowledgement', (context) => {
  const { repository, candidates } = makeFixture(context);
  repository.prepareRefTransaction(transitionInput({ candidates }));
  assert.throws(
    () => repository.finalizeRefTransaction('rft_adopt'),
    (error) => error?.code === 'ref_transaction_state_conflict',
  );
  assert.equal(repository.getChangeSet('cs_candidate').status, 'preview_ready');
});

test('P6 unfinished transactions exclusively claim the full project projection', (context) => {
  const { repository, baseRevisions } = makeFixture(context, {
    families: ['family_a', 'family_b'],
  });
  const left = createCandidate(repository, {
    changeSetId: 'cs_left',
    sourceCommit: COMMIT_B,
    baseRevisions: [baseRevisions[0]],
  });
  const right = createCandidate(repository, {
    changeSetId: 'cs_right',
    sourceCommit: COMMIT_C,
    baseRevisions: [baseRevisions[1]],
  });
  repository.prepareRefTransaction(transitionInput({
    operationId: 'rft_left',
    changeSetId: 'cs_left',
    candidates: left,
    currentRevisionIds: [left[0].revisionId, baseRevisions[1].revisionId],
  }));
  assert.throws(
    () => repository.prepareRefTransaction(transitionInput({
      operationId: 'rft_right',
      changeSetId: 'cs_right',
      candidates: right,
      currentRevisionIds: [baseRevisions[0].revisionId, right[0].revisionId],
    })),
    (error) => error?.code === 'ref_transaction_project_active',
  );
  assert.equal(repository.getRefTransaction('rft_right'), null);
});

test('P6 recovery refuses a journal still owned by another live runtime', (context) => {
  const { repository, adapter, candidates } = makeFixture(context);
  const externalLease = {
    instanceId: 'f'.repeat(32),
    startedAt: '2026-08-01T00:00:00.000Z',
    ownerPid: 4242,
  };
  repository.prepareRefTransaction(transitionInput({ candidates, ownerLease: externalLease }));
  const recovered = recoverActiveRefTransactions(
    { projectId: 'project_p6_ref', runtimeLease: CURRENT_RUNTIME_LEASE },
    { repository, adapter, isOwnerAlive: () => true },
  );
  assert.equal(recovered.blocked[0].kind, 'ref_transaction_owner_active');
  assert.equal(adapter.revParse('refs/heads/biof3/current/family_a'), COMMIT_A);
  assert.equal(repository.getChangeSet('cs_candidate').status, 'preview_ready');
});

test('P6 recovery blocks unreadable Git state instead of treating it as a missing ref', (context) => {
  const { repository, adapter, candidates } = makeFixture(context);
  repository.prepareRefTransaction(transitionInput({ candidates }));
  adapter.readFailure = Object.assign(new Error('repository unavailable'), {
    code: 'git_ref_read_failed',
  });
  const recovered = recoverActiveRefTransactions(
    { projectId: 'project_p6_ref', runtimeLease: CURRENT_RUNTIME_LEASE },
    { repository, adapter },
  );
  assert.equal(recovered.blocked[0].kind, 'git_ref_read_failed');
  assert.equal(repository.getRefTransaction('rft_adopt').state, 'prepared');
  assert.equal(repository.getChangeSet('cs_candidate').status, 'preview_ready');
});

test('P6 recovery blocks a mutated SQLite journal before touching Git', (context) => {
  const { db, repository, adapter, candidates } = makeFixture(context);
  repository.prepareRefTransaction(transitionInput({ candidates }));
  db.prepare('UPDATE result_ref_transactions SET target_status = ? WHERE operation_id = ?')
    .run('reverted', 'rft_adopt');
  const recovered = recoverActiveRefTransactions(
    { projectId: 'project_p6_ref', runtimeLease: CURRENT_RUNTIME_LEASE },
    { repository, adapter },
  );
  assert.equal(recovered.blocked[0].kind, 'ref_transaction_integrity_failed');
  assert.equal(adapter.revParse('refs/heads/biof3/current/family_a'), COMMIT_A);
  assert.equal(repository.getChangeSet('cs_candidate').status, 'preview_ready');
});

test('P6 recovery blocks a target Revision commit mutated after journal preparation', (context) => {
  const { db, repository, adapter, candidates, baseRevisions } = makeFixture(context);
  const intent = repository.prepareRefTransaction(transitionInput({ candidates }));
  adapter.updateRefsCas({ updates: intent.refUpdates });
  db.prepare('UPDATE artifact_revisions SET source_commit = ? WHERE revision_id = ?')
    .run(COMMIT_C, candidates[0].revisionId);

  assert.equal(hasValidIntentHash(repository.getRefTransaction('rft_adopt')), true);
  const recovered = recoverActiveRefTransactions(
    { projectId: 'project_p6_ref', runtimeLease: CURRENT_RUNTIME_LEASE },
    { repository, adapter },
  );
  assert.deepEqual(recovered.repaired, []);
  assert.equal(recovered.blocked[0].kind, 'ref_transaction_target_revision_mismatch');
  assert.equal(repository.getRefTransaction('rft_adopt').state, 'refs_applied');
  assert.equal(repository.getChangeSet('cs_candidate').status, 'preview_ready');
  assert.equal(repository.getCurrentRevision('family_a').revisionId, baseRevisions[0].revisionId);
  assert.equal(adapter.revParse('refs/heads/biof3/current/family_a'), COMMIT_B);
});

test('P6 recovery blocks target Revision families swapped after journal preparation', (context) => {
  const {
    db,
    repository,
    adapter,
    candidates,
    baseRevisions,
  } = makeFixture(context, { families: ['family_a', 'family_b'] });
  const intent = repository.prepareRefTransaction(transitionInput({ candidates }));
  adapter.updateRefsCas({ updates: intent.refUpdates });
  db.prepare('UPDATE artifact_revisions SET artifact_family_id = ? WHERE revision_id = ?')
    .run('family_swap_temporary', candidates[0].revisionId);
  db.prepare('UPDATE artifact_revisions SET artifact_family_id = ? WHERE revision_id = ?')
    .run('family_a', candidates[1].revisionId);
  db.prepare('UPDATE artifact_revisions SET artifact_family_id = ? WHERE revision_id = ?')
    .run('family_b', candidates[0].revisionId);

  assert.equal(hasValidIntentHash(repository.getRefTransaction('rft_adopt')), true);
  const recovered = recoverActiveRefTransactions(
    { projectId: 'project_p6_ref', runtimeLease: CURRENT_RUNTIME_LEASE },
    { repository, adapter },
  );
  assert.deepEqual(recovered.repaired, []);
  assert.equal(recovered.blocked[0].kind, 'ref_transaction_target_revision_mismatch');
  assert.equal(repository.getRefTransaction('rft_adopt').state, 'refs_applied');
  assert.equal(repository.getChangeSet('cs_candidate').status, 'preview_ready');
  assert.deepEqual(
    repository.listCurrentRevisions('project_p6_ref').map((revision) => revision.revisionId).sort(),
    baseRevisions.map((revision) => revision.revisionId).sort(),
  );
  assert.equal(adapter.revParse('refs/heads/biof3/current/family_a'), COMMIT_B);
  assert.equal(adapter.revParse('refs/heads/biof3/current/family_b'), COMMIT_B);
});
