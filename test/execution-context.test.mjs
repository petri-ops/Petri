import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  EXECUTION_CONTEXT_VERSION,
  createExecutionContext,
  attachExecutionMetadata,
} = require('../core/shared-backend/execution-context');

test('maps host result paths to stable canonical paths', () => {
  const { context, canonicalizePath } = createExecutionContext({
    jobId: 'job-1',
    toolId: 'deseq2',
    runtime: 'r',
    runtimeCommand: '/opt/R/bin/Rscript',
    workDir: '/tmp/petri/jobs/job-1',
    outputDir: '/tmp/petri/jobs/job-1/output',
    resultDir: '/tmp/petri/jobs/job-1/output',
    localRoot: '/tmp/petri',
    canonicalRoot: '/work/petri',
  });

  assert.equal(context.executionContextVersion, EXECUTION_CONTEXT_VERSION);
  assert.equal(context.adapter.kind, 'local');
  assert.equal(context.canonicalWorkDir, '/work/petri/jobs/job-1');
  assert.equal(context.executionWorkDir, '/tmp/petri/jobs/job-1');
  assert.equal(
    canonicalizePath('/tmp/petri/jobs/job-1/output/a.csv'),
    '/work/petri/jobs/job-1/output/a.csv'
  );
});

test('result files inherit stable host and canonical paths', () => {
  const { context } = createExecutionContext({
    jobId: 'job-2',
    toolId: 'deg',
    runtime: 'r',
    workDir: '/srv/jobs/job-2',
    resultDir: '/srv/jobs/job-2/output',
    localRoot: '/srv/jobs',
    canonicalRoot: '/work/petri/jobs',
  });
  const result = attachExecutionMetadata(
    { files: [{ name: 'markers.csv' }] },
    context
  );
  assert.equal(result.execution, context);
  // .path is built from context.resultDir (which createExecutionContext resolves
  // via path.resolve — adding the cwd drive letter on Windows) joined with the
  // filename. Mirror that exactly so the assertion is platform-stable.
  assert.equal(
    result.files[0].path,
    path.join(path.resolve('/srv/jobs/job-2/output'), 'markers.csv').split(path.sep).join('/'),
  );
  assert.equal(result.files[0].canonicalPath, '/work/petri/jobs/job-2/output/markers.csv');
});
