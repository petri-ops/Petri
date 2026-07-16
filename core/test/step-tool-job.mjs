import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  STEP_TASK_TYPES,
  buildStepTaskRequest,
  publicStepParams,
} = require('../r-server/helpers/step-tool-job');

test('all advertised single-cell steps map to real task types', () => {
  assert.equal(Object.keys(STEP_TASK_TYPES).length, 10);
  assert.equal(STEP_TASK_TYPES['scrna-standard'], 'scrna_standard');
  assert.equal(STEP_TASK_TYPES['cell-cycle'], 'cell_cycle');
  assert.equal(STEP_TASK_TYPES.doublet, 'doublet');
});

test('builds an auditable task request without leaking routing fields to R params', () => {
  const request = buildStepTaskRequest({
    toolId: 'enrichment',
    toolJobId: 'tj_1',
    userId: 'u_1',
    projectId: 'p_1',
    args: {
      ossInputUrl: 'https://example.test/genes.csv',
      parentTaskId: 'task_0',
      organism: 'human',
      enrichType: 'both',
    },
  });
  assert.equal(request.type, 'enrichment');
  assert.equal(request.ossInputUrl, 'https://example.test/genes.csv');
  assert.equal(request.parentTaskId, 'task_0');
  assert.equal(request.params.organism, 'human');
  assert.equal(request.params.ossInputUrl, undefined);
  assert.deepEqual(request.params.__harness, {
    version: 1,
    toolId: 'enrichment',
    toolJobId: 'tj_1',
    userId: 'u_1',
    projectId: 'p_1',
  });
  assert.deepEqual(publicStepParams(request.params), {
    organism: 'human',
    enrichType: 'both',
  });
});

test('rejects missing input and unsupported tools before queue submission', () => {
  assert.throws(
    () => buildStepTaskRequest({ toolId: 'doublet', args: {} }),
    /missing_oss_input_url/,
  );
  assert.throws(
    () => buildStepTaskRequest({ toolId: 'not-a-step', args: { ossInputUrl: 'x' } }),
    /unsupported_step_tool/,
  );
});
