import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { projectHarnessWorkflowJob } = require('../core/petri-server/helpers/harness-workflow-state.js');

function stage(workflow, id) {
  return workflow.stages.find((item) => item.id === id);
}

test('workflow waits at confirm when tool job approval is pending', () => {
  const workflow = projectHarnessWorkflowJob({ id: 'tj_1', status: 'pending', ack_status: 'pending' });
  assert.equal(stage(workflow, 'confirm').status, 'pending');
  assert.equal(stage(workflow, 'run').status, 'blocked');
  assert.equal(workflow.resumeFrom, 'confirm');
  assert.equal(workflow.terminal, false);
  assert.ok(workflow.nextActions.some((action) => action.id === 'confirm_params'));
});

test('workflow projects queued and running jobs without inventing verification', () => {
  const queued = projectHarnessWorkflowJob({ id: 'tj_queued', status: 'queued' });
  assert.equal(stage(queued, 'run').status, 'pending');
  assert.equal(queued.resumeFrom, 'run');

  const running = projectHarnessWorkflowJob({ id: 'tj_running', status: 'running' });
  assert.equal(stage(running, 'run').status, 'in_progress');
  assert.equal(stage(running, 'verify').status, 'pending');
  assert.equal(running.resumeFrom, 'run');
});

test('restart-interrupted tool job becomes explicitly recoverable from run stage', () => {
  const workflow = projectHarnessWorkflowJob({
    id: 'tj_restart',
    status: 'failed',
    error: 'recovery_required_after_restart',
  });
  assert.equal(workflow.recoveryRequired, true);
  assert.equal(workflow.recoverable, true);
  assert.equal(workflow.resumeFrom, 'run');
  assert.ok(workflow.nextActions.some((action) => action.id === 'retry_run'));
});

test('completed job waits for artifact truth before report', () => {
  const workflow = projectHarnessWorkflowJob({
    id: 'tj_completed',
    status: 'completed',
    result: { artifacts: [{ name: 'plot.png' }] },
  });
  assert.equal(stage(workflow, 'run').status, 'completed');
  assert.equal(stage(workflow, 'verify').status, 'pending');
  assert.equal(stage(workflow, 'report').status, 'blocked');
  assert.equal(workflow.resumeFrom, 'verify');
  assert.equal(workflow.terminal, false);
  assert.ok(workflow.nextActions.some((action) => action.id === 'reconcile_artifacts'));
});

test('valid artifact truth completes verify and report', () => {
  const workflow = projectHarnessWorkflowJob({
    id: 'tj_valid',
    tool_id: 'volcano-plot',
    status: 'completed',
    result_json: JSON.stringify({
      artifactTruth: { status: 'valid', blocking: false, validCount: 1 },
      artifacts: [{ name: 'volcano.png' }],
    }),
    params: {
      top_n: 10,
      __harnessRecovery: [{ id: 'recovery_1', actionId: 'retry_run' }],
    },
  });
  assert.equal(stage(workflow, 'verify').status, 'completed');
  assert.equal(stage(workflow, 'report').status, 'completed');
  assert.equal(workflow.resumeFrom, null);
  assert.equal(workflow.terminal, true);
  assert.equal(workflow.artifactCount, 1);
  assert.equal(workflow.recoveryHistory[0].actionId, 'retry_run');
});

test('degraded artifact truth keeps report available but requests review', () => {
  const workflow = projectHarnessWorkflowJob({
    id: 'tj_degraded',
    status: 'completed',
    result: {
      artifactTruth: { status: 'degraded', blocking: false, validCount: 1 },
      artifactDiagnostics: [{ code: 'artifact_missing', recoverable: true }],
      artifacts: [{ name: 'table.csv' }],
    },
  });
  assert.equal(stage(workflow, 'verify').status, 'needs_review');
  assert.equal(stage(workflow, 'report').status, 'completed');
  assert.equal(workflow.resumeFrom, 'verify');
  assert.equal(workflow.recoverable, true);
  assert.equal(workflow.terminal, true);
  assert.ok(workflow.nextActions.some((action) => action.id === 'review_artifacts'));
});

test('artifact-truth failure differs from execution failure', () => {
  const artifactFailure = projectHarnessWorkflowJob({
    id: 'tj_artifact_failed',
    status: 'failed',
    result: {
      artifactTruth: { status: 'blocked', blocking: true },
      artifactDiagnostics: [{ code: 'required_artifact_missing', recoverable: true }],
    },
  });
  assert.equal(stage(artifactFailure, 'run').status, 'completed');
  assert.equal(stage(artifactFailure, 'verify').status, 'failed');
  assert.equal(artifactFailure.resumeFrom, 'verify');
  assert.ok(artifactFailure.nextActions.some((action) => action.id === 'repair_artifacts'));

  const executionFailure = projectHarnessWorkflowJob({
    id: 'tj_execution_failed',
    status: 'failed',
    error: 'Rscript exited 1',
  });
  assert.equal(stage(executionFailure, 'run').status, 'failed');
  assert.equal(stage(executionFailure, 'verify').status, 'blocked');
  assert.equal(executionFailure.resumeFrom, 'run');
  assert.ok(executionFailure.nextActions.some((action) => action.id === 'retry_run'));
});

test('cancelled and rejected jobs remain terminal and auditable', () => {
  const cancelled = projectHarnessWorkflowJob({ id: 'tj_cancelled', status: 'cancelled' });
  assert.equal(stage(cancelled, 'run').status, 'cancelled');
  assert.equal(cancelled.terminal, true);

  const rejected = projectHarnessWorkflowJob({
    id: 'tj_rejected',
    status: 'failed',
    ack_status: 'rejected',
    error: '用户取消了该重操作',
  });
  assert.equal(stage(rejected, 'confirm').status, 'cancelled');
  assert.equal(stage(rejected, 'run').status, 'cancelled');
  assert.equal(rejected.resumeFrom, 'confirm');
  assert.equal(rejected.terminal, true);
});
