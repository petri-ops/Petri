import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _test } = require('../core/r-server/helpers/tools-executor');

test('tool executor hydrates persisted params and project context before provenance', () => {
  const job = _test.hydrateExecutionJob({
    id: 'job-1',
    project_id: 'project-1',
    params_json: JSON.stringify({ design: 'condition', contrast_ref: 'WT', contrast_treat: 'KO' }),
  });
  assert.equal(job.project_id, 'project-1');
  assert.deepEqual(job.params, {
    design: 'condition',
    contrast_ref: 'WT',
    contrast_treat: 'KO',
  });
});

test('tool executor keeps malformed legacy params bounded instead of losing the job row', () => {
  const job = _test.hydrateExecutionJob({ id: 'job-legacy', params_json: '{broken' });
  assert.equal(job.id, 'job-legacy');
  assert.deepEqual(job.params, {});
  assert.equal(_test.hydrateExecutionJob(null), null);
});
