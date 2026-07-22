import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createScientificTaskConfirmationPreview, confirmScientificTask, validateScientificTaskExecution } = require('../core/shared-backend/scientific-task-confirmation');

const hashes = { 'data/counts.csv': 'a'.repeat(64), 'data/metadata.csv': 'b'.repeat(64) };
const taskSpec = {
  schemaVersion: 1, taskId: 'task_confirm_1', projectId: 'project_1', conversationId: 'conv_1',
  originalRequest: '比较处理组和对照组',
  question: { domain: 'bulk RNA-seq', analysisUnit: 'gene', questionType: 'differential_expression' },
  inputs: [
    { role: 'counts', relativePath: 'data/counts.csv', sha256: hashes['data/counts.csv'], sizeBytes: 100 },
    { role: 'metadata', relativePath: 'data/metadata.csv', sha256: hashes['data/metadata.csv'], sizeBytes: 40 },
  ],
  design: { groups: ['Control', 'Treatment'], contrast: { reference: 'Control', treatment: 'Treatment' } },
  method: { category: 'bulk RNA-seq' },
  requestedDeliverables: ['deg_table', 'plots', 'report'],
  status: 'ready_for_confirmation',
};
const plan = { status: 'ready_for_confirmation', recommendation: { toolId: 'deseq2' }, planHash: 'c'.repeat(64) };

test('HRT-3 preview is side-effect free and exposes confirmation scope', () => {
  const result = createScientificTaskConfirmationPreview({ taskSpec, plan, evidence: [{ relativePath: 'data/counts.csv', source: 'harness-file-index' }] });
  assert.equal(result.ok, true);
  assert.equal(result.preview.sideEffects.createsToolJob, false);
  assert.deepEqual(result.preview.inputs.map((item) => item.sha256), Object.values(hashes));
});

test('HRT-3 rejects stale input hashes and missing risk acknowledgement', () => {
  const result = confirmScientificTask({ taskSpec, plan, confirmation: {
    userId: 'user_1', method: 'bulk RNA-seq', inputHashes: { ...hashes, 'data/counts.csv': 'd'.repeat(64) }, requestedDeliverables: ['deg_table'], riskAcknowledged: false,
  } });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((item) => item.code === 'input_hash_mismatch'));
  assert.ok(result.issues.some((item) => item.code === 'risk_not_acknowledged'));
});

test('HRT-3 confirmation produces immutable spec hash but still does not create a Job', () => {
  const result = confirmScientificTask({ taskSpec, plan, confirmation: {
    userId: 'user_1', method: 'bulk RNA-seq', inputHashes: hashes, requestedDeliverables: ['deg_table', 'plots', 'report'], riskAcknowledged: true,
  } });
  assert.equal(result.ok, true);
  assert.equal(result.spec.status, 'confirmed');
  assert.match(result.taskSpecHash, /^[a-f0-9]{64}$/);
  assert.equal(result.confirmation.taskSpecHash, result.taskSpecHash);
  assert.equal(result.createsToolJob, false);
});

test('HRT-3 execution gate rejects changed tool, params, project and duplicate binding', () => {
  const confirmed = confirmScientificTask({ taskSpec, plan, confirmation: {
    userId: 'user_1', method: 'bulk RNA-seq', inputHashes: hashes, params: { alpha: 0.05, nested: { b: 2, a: 1 } }, requestedDeliverables: ['deg_table'], riskAcknowledged: true,
  } });
  const persistedTask = { task_id: taskSpec.taskId, version: 1, project_id: taskSpec.projectId, status: 'confirmed', spec_hash: confirmed.taskSpecHash, confirmation: confirmed.confirmation, tool_job_id: null };
  assert.equal(validateScientificTaskExecution({ persistedTask, projectId: taskSpec.projectId, toolId: 'deseq2', params: { nested: { a: 1, b: 2 }, alpha: 0.05 } }).ok, true);
  assert.equal(validateScientificTaskExecution({ persistedTask, projectId: 'other', toolId: 'deseq2', params: confirmed.confirmation.params }).error, 'scientific_task_project_mismatch');
  assert.equal(validateScientificTaskExecution({ persistedTask, projectId: taskSpec.projectId, toolId: 'wgcna', params: confirmed.confirmation.params }).error, 'scientific_task_tool_changed');
  assert.equal(validateScientificTaskExecution({ persistedTask, projectId: taskSpec.projectId, toolId: 'deseq2', params: { alpha: 0.1 } }).error, 'scientific_task_params_changed');
  assert.equal(validateScientificTaskExecution({ persistedTask: { ...persistedTask, tool_job_id: 'tj_done' }, projectId: taskSpec.projectId, toolId: 'deseq2', params: confirmed.confirmation.params }).error, 'scientific_task_already_bound');
});
