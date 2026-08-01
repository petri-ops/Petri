'use strict';

const { computeResultRefTransactionHash } = require('./result-ref-transaction-schema');
const {
  getResultStudioRuntimeLease,
  isResultStudioRuntimeLease,
  isResultStudioRuntimeLeaseOwnerAlive,
} = require('./result-studio-runtime-lease');

const ZERO_OID = '0'.repeat(40);

class ResultRefTransactionError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultRefTransactionError';
    this.code = code;
    this.detail = detail;
  }
}

function currentRefOid(adapter, ref) {
  return adapter.readRefExact(ref) || ZERO_OID;
}

function classifyRefTransaction(intent, adapter) {
  const observations = intent.refUpdates.map((entry) => ({
    ref: entry.ref,
    actual: currentRefOid(adapter, entry.ref),
    expectedOld: entry.expectedOld,
    newOid: entry.newOid,
  }));
  const allOld = observations.every((entry) => entry.actual === entry.expectedOld);
  const allNew = observations.every((entry) => entry.actual === entry.newOid);
  return {
    status: allOld ? 'all_old' : allNew ? 'all_new' : 'conflict',
    observations,
  };
}

function reverseUpdates(updates) {
  return [...updates].reverse().map((entry) => ({
    ref: entry.ref,
    expectedOld: entry.newOid,
    newOid: entry.expectedOld,
  }));
}

function hasValidIntentHash(intent) {
  return /^[a-f0-9]{64}$/.test(String(intent?.intentHash || ''))
    && computeResultRefTransactionHash(intent) === intent.intentHash;
}

function assertIntentIntegrity(intent) {
  if (!hasValidIntentHash(intent)) {
    throw new ResultRefTransactionError(
      'ref_transaction_integrity_failed',
      'The durable ref transition journal failed its immutable intent hash.'
    );
  }
}

function recoveryOwnership(intent, runtimeLease, ownerAlive = isResultStudioRuntimeLeaseOwnerAlive) {
  if (!isResultStudioRuntimeLease(runtimeLease) || !isResultStudioRuntimeLease(intent.ownerLease)) {
    return 'unproven';
  }
  if (intent.ownerLease.instanceId === runtimeLease.instanceId) return 'current';
  return ownerAlive(intent.ownerLease) === false ? 'stale' : 'external';
}

function requireDependencies(repository, adapter) {
  if (!repository || typeof repository.prepareRefTransaction !== 'function'
      || typeof repository.finalizeRefTransaction !== 'function'
      || !adapter || typeof adapter.updateRefsCas !== 'function'
      || typeof adapter.readRefExact !== 'function') {
    throw new ResultRefTransactionError(
      'ref_transaction_dependencies_missing',
      'Durable ref transitions require the canonical Repository and atomic Git adapter.'
    );
  }
}

function executeDurableRefTransaction(input = {}, dependencies = {}) {
  const { repository, adapter } = dependencies;
  requireDependencies(repository, adapter);
  const intent = repository.prepareRefTransaction({
    ...input,
    ownerLease: input.ownerLease || getResultStudioRuntimeLease(),
  });
  let refsApplied = false;
  try {
    adapter.updateRefsCas({ updates: intent.refUpdates });
    refsApplied = true;
    if (typeof dependencies.afterRefsApplied === 'function') {
      dependencies.afterRefsApplied(intent);
    }
    const acknowledgement = classifyRefTransaction(intent, adapter);
    if (acknowledgement.status !== 'all_new') {
      throw new ResultRefTransactionError(
        'ref_transaction_git_postcondition_failed',
        'The atomic Git ref cohort did not remain at its exact target state.',
        { observations: acknowledgement.observations },
      );
    }
    repository.markRefTransactionRefsApplied(intent.operationId);
    const completed = repository.finalizeRefTransaction(intent.operationId);
    return { intent: completed, recovered: false };
  } catch (error) {
    const current = repository.getRefTransaction(intent.operationId);
    if (current && ['prepared', 'refs_applied'].includes(current.state)) {
      let classification = null;
      try {
        assertIntentIntegrity(current);
        classification = classifyRefTransaction(current, adapter);
      } catch {
        throw error;
      }
      if (!refsApplied && classification.status === 'all_new') {
        try {
          repository.markRefTransactionRefsApplied(intent.operationId);
          const completed = repository.finalizeRefTransaction(intent.operationId);
          return { intent: completed, recovered: true, acknowledgementRecovered: true };
        } catch {
          throw error;
        }
      }
      if (refsApplied && classification.status === 'all_new') {
        try { adapter.updateRefsCas({ updates: reverseUpdates(current.refUpdates) }); } catch {}
      }
      let afterRollback = null;
      try { afterRollback = classifyRefTransaction(current, adapter); } catch {}
      if (afterRollback?.status === 'all_old') {
        try { repository.abortRefTransaction(intent.operationId, error.code || 'ref_transition_failed'); } catch {}
      }
    }
    throw error;
  }
}

function recoverActiveRefTransactions({
  projectId,
  runtimeLease = getResultStudioRuntimeLease(),
} = {}, dependencies = {}) {
  const { repository, adapter } = dependencies;
  requireDependencies(repository, adapter);
  const repaired = [];
  const blocked = [];
  for (const intent of repository.listActiveRefTransactions(projectId)) {
    try {
      assertIntentIntegrity(intent);
      const ownership = recoveryOwnership(
        intent,
        runtimeLease,
        dependencies.isOwnerAlive || isResultStudioRuntimeLeaseOwnerAlive,
      );
      if (ownership === 'external' || ownership === 'unproven') {
        throw new ResultRefTransactionError(
          'ref_transaction_owner_active',
          'Another live runtime still owns the durable ref transition.'
        );
      }
      let classification = classifyRefTransaction(intent, adapter);
      if (classification.status === 'conflict') {
        throw new ResultRefTransactionError(
          'ref_transaction_git_conflict',
          'The durable ref transition encountered a third-value Git ref.'
        );
      }
      if (classification.status === 'all_old') {
        try { adapter.updateRefsCas({ updates: intent.refUpdates }); } catch {}
        classification = classifyRefTransaction(intent, adapter);
        if (classification.status !== 'all_new') {
          throw new ResultRefTransactionError(
            'ref_transaction_git_postcondition_failed',
            'The atomic Git ref cohort did not reach its exact target state.'
          );
        }
        repaired.push({ repair: 'ref_transaction_refs_resumed' });
      }
      classification = classifyRefTransaction(intent, adapter);
      if (classification.status !== 'all_new') {
        throw new ResultRefTransactionError(
          'ref_transaction_git_postcondition_failed',
          'The atomic Git ref cohort did not reach its exact target state.'
        );
      }
      repository.markRefTransactionRefsApplied(intent.operationId);
      repository.finalizeRefTransaction(intent.operationId);
      repaired.push({ repair: 'ref_transaction_sqlite_finalized' });
    } catch (error) {
      blocked.push({
        operationId: intent.operationId,
        changeSetId: intent.changeSetId,
        kind: error.code || 'ref_transaction_recovery_failed',
      });
    }
  }
  return { repaired, blocked };
}

module.exports = {
  ZERO_OID,
  ResultRefTransactionError,
  classifyRefTransaction,
  executeDurableRefTransaction,
  hasValidIntentHash,
  recoveryOwnership,
  recoverActiveRefTransactions,
  reverseUpdates,
};
