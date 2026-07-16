import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  EXECUTION_CONTEXT_VERSION,
  createExecutionContext,
  createTaskExecutionContext,
  attachExecutionMetadata,
} = require('../shared-backend/execution-context');

test('maps host result paths to stable canonical paths', () => {
  const { context, canonicalizePath } = createExecutionContext({
    jobId: 'job-1',
    toolId: 'deseq2',
    runtime: 'r',
    runtimeCommand: '/opt/R/bin/Rscript',
    workDir: '/tmp/biof3/jobs/job-1',
    outputDir: '/tmp/biof3/jobs/job-1/output',
    resultDir: '/tmp/biof3/jobs/job-1/output',
    localRoot: '/tmp/biof3',
    canonicalRoot: '/work/biof3',
  });

  assert.equal(context.executionContextVersion, EXECUTION_CONTEXT_VERSION);
  assert.equal(context.adapter.kind, 'local');
  assert.equal(context.canonicalWorkDir, '/work/biof3/jobs/job-1');
  assert.equal(context.executionWorkDir, '/tmp/biof3/jobs/job-1');
  assert.equal(
    canonicalizePath('/tmp/biof3/jobs/job-1/output/a.csv'),
    '/work/biof3/jobs/job-1/output/a.csv'
  );
});

test('task contexts preserve local and canonical paths', () => {
  const context = createTaskExecutionContext(
    {
      taskId: 'task-1',
      type: 'scrna-standard',
      workDir: '/srv/tasks/task-task-1',
      workerId: 'worker-a',
    },
    {
      tempDir: '/srv/tasks',
      canonicalTaskRoot: '/work/biof3/tasks',
    },
    'r'
  );

  assert.equal(context.adapter.workerId, 'worker-a');
  assert.equal(context.workDir, '/srv/tasks/task-task-1');
  assert.equal(context.canonicalWorkDir, '/work/biof3/tasks/task-task-1');
  assert.equal(context.executionWorkDir, '/srv/tasks/task-task-1');
});

test('result files inherit stable host and canonical paths', () => {
  const context = createTaskExecutionContext(
    {
      taskId: 'task-2',
      type: 'deg',
      workDir: '/srv/tasks/task-task-2',
    },
    {
      tempDir: '/srv/tasks',
      canonicalTaskRoot: '/work/biof3/tasks',
    },
    'r'
  );
  const result = attachExecutionMetadata(
    { files: [{ name: 'markers.csv', url: 'oss://x' }] },
    context
  );
  assert.equal(result.execution, context);
  assert.equal(result.files[0].path, '/srv/tasks/task-task-2/markers.csv');
  assert.equal(result.files[0].canonicalPath, '/work/biof3/tasks/task-task-2/markers.csv');
});
