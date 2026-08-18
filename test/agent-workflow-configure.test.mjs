/**
 * test/agent-workflow-configure.test.mjs — A-003 unit tests for configure injection
 *
 * Verifies:
 * 1. configure({}) does not throw
 * 2. configure({ projectHarnessWorkflowJob }) is callable without error
 * 3. After configure({ projectHarnessWorkflowJob }), harnessState IS attached
 * 4. runToolJobs with a harness projector enriches jobs with harnessState
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const SHARED = resolve(__dirname, '..', 'core', 'shared-backend');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function harnessState(job) {
  const result = job.result_json || job.result || {};
  return {
    harnessWorkflowStateVersion: 1,
    jobId: job.id,
    toolId: job.tool_id,
    jobStatus: job.status,
    terminal: ['completed', 'failed', 'cancelled'].includes(job.status),
    recoverable: false,
    resumeFrom: null,
    artifactTruth: result.artifactTruth || null,
    artifactDiagnostics: [],
    artifactCount: (result.artifacts || []).length,
    error: job.error,
  };
}

function stubJob(overrides = {}) {
  return {
    id: 'tj_1',
    tool_id: 'deseq2',
    status: 'completed',
    result_json: null,
    result: null,
    ack_status: null,
    error: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('configure({}) does not throw', () => {
  const { agentWorkflow } = req(SHARED + '/index.js');
  assert.doesNotThrow(() => {
    agentWorkflow.configure({});
  });
});

test('configure({ projectHarnessWorkflowJob }) is callable', () => {
  const { agentWorkflow } = req(SHARED + '/index.js');
  const fakeFn = (job) => ({ mock: true, jobId: job.id });
  assert.doesNotThrow(() => {
    agentWorkflow.configure({ projectHarnessWorkflowJob: fakeFn });
  });
  const result = fakeFn({ id: 'test-job' });
  assert.deepStrictEqual(result, { mock: true, jobId: 'test-job' });
});

test('runToolJobs with harness configured: harnessState IS attached', () => {
  const { agentWorkflow } = req(SHARED + '/index.js');
  // Ensure harness projector is configured
  agentWorkflow.configure({ projectHarnessWorkflowJob: harnessState });

  const aw = req(SHARED + '/agent-workflow.js');
  const runToolJobs = aw.runToolJobs;

  const plan = {
    steps: [
      { id: 'step-1', toolJobId: 'tj_1' },
      { id: 'step-2', toolJobId: 'tj_2' },
    ],
  };
  const jobs = [
    stubJob({ id: 'tj_1', status: 'completed', result: { artifacts: [] } }),
    stubJob({ id: 'tj_2', status: 'failed', error: 'oops', result: { artifacts: [] } }),
  ];

  const results = runToolJobs(plan, (id) => jobs.find((j) => j.id === id));

  assert.strictEqual(results.length, 2);
  // harnessState must be attached when projectHarnessWorkflowJob is configured
  assert.strictEqual(results[0].harnessState.harnessWorkflowStateVersion, 1);
  assert.strictEqual(results[0].harnessState.jobId, 'tj_1');
  assert.strictEqual(results[0].harnessState.toolId, 'deseq2');
  assert.strictEqual(results[0].harnessState.jobStatus, 'completed');
  assert.strictEqual(results[1].harnessState.jobStatus, 'failed');
});

test('runToolJobs enriches jobs with _stepId', () => {
  const { agentWorkflow } = req(SHARED + '/index.js');
  agentWorkflow.configure({ projectHarnessWorkflowJob: harnessState });

  const aw = req(SHARED + '/agent-workflow.js');
  const runToolJobs = aw.runToolJobs;

  const plan = {
    steps: [{ id: 'step-x', toolJobId: 'tj_1' }],
  };
  const jobs = [stubJob({ id: 'tj_1' })];

  const results = runToolJobs(plan, (id) => jobs.find((j) => j.id === id));

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0]._stepId, 'step-x');
});
