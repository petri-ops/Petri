import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  appendWorkflowRecoveryAudit,
  createRecoveryConfirmationStore,
  publicRecoveryParams,
  validateWorkflowRecoveryAction,
} = require('../core/biof3-server/helpers/harness-workflow-recovery.js');

test('reconcile requires an existing result and rejects agent-only actions', () => {
  assert.deepEqual(
    validateWorkflowRecoveryAction({ status: 'completed' }, 'reconcile_artifacts'),
    { ok: false, error: 'result_not_available' },
  );
  assert.deepEqual(
    validateWorkflowRecoveryAction({ status: 'completed', result: {} }, 'reconcile_artifacts'),
    { ok: true },
  );
  assert.deepEqual(
    validateWorkflowRecoveryAction({ status: 'failed', result: {} }, 'repair_artifacts'),
    { ok: false, error: 'action_requires_agent' },
  );
});

test('retry only accepts terminal failed or cancelled plugin jobs', () => {
  assert.equal(validateWorkflowRecoveryAction({ status: 'running', tool_id: 'volcano-plot' }, 'retry_run').error, 'job_not_retryable');
  assert.equal(validateWorkflowRecoveryAction({ status: 'failed' }, 'retry_run').error, 'tool_not_available');
  assert.deepEqual(
    validateWorkflowRecoveryAction({ status: 'failed', tool_id: 'volcano-plot' }, 'retry_run'),
    { ok: true },
  );
});

test('recovery audit is bounded and hidden from public tool params', () => {
  let params = { top_n: 10 };
  for (let i = 0; i < 25; i += 1) {
    params = appendWorkflowRecoveryAudit(params, { id: `event_${i}` });
  }
  assert.equal(params.__harnessRecovery.length, 20);
  assert.equal(params.__harnessRecovery[0].id, 'event_5');
  assert.deepEqual(publicRecoveryParams(params), { top_n: 10 });
});

test('confirmation tokens are single-use, scoped and expire safely', () => {
  let timestamp = 1000;
  let sequence = 0;
  const store = createRecoveryConfirmationStore({
    ttlMs: 100,
    now: () => timestamp,
    tokenFactory: () => `token_${sequence += 1}`,
  });
  const issued = store.issue({ jobId: 'tj_1', actionId: 'retry_run', userId: 'u1' });
  assert.equal(issued.expiresAt, 1100);
  assert.equal(
    store.consume(issued.token, { jobId: 'wrong', actionId: 'retry_run', userId: 'u1' }).error,
    'confirmation_invalid_or_expired',
  );
  assert.equal(
    store.consume(issued.token, { jobId: 'tj_1', actionId: 'retry_run', userId: 'u1' }).error,
    'confirmation_invalid_or_expired',
  );

  const expired = store.issue({ jobId: 'tj_2', actionId: 'reconcile_artifacts', userId: 'u1' });
  timestamp = 1200;
  assert.equal(store.consume(expired.token).error, 'confirmation_invalid_or_expired');

  timestamp = 1300;
  const valid = store.issue({ jobId: 'tj_3', actionId: 'retry_run', userId: 'u1' });
  assert.equal(store.consume(valid.token, { jobId: 'tj_3', actionId: 'retry_run', userId: 'u1' }).ok, true);
});
