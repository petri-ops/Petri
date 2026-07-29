import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('HTTP tool execution resolves only server-owned manifest or declared artifact result roots', (context) => {
  const jobDir = mkdtempSync(join(tmpdir(), 'biof3-tools-result-root-'));
  const outputDir = join(jobDir, 'output');
  mkdirSync(outputDir);
  context.after(() => rmSync(jobDir, { recursive: true, force: true }));
  const expectedArtifacts = [{ id: 'volcano', filename: 'volcano.png' }];

  writeFileSync(join(jobDir, 'manifest.json'), '{}\n');
  assert.deepEqual(_test.resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts }), {
    resultDir: jobDir,
    manifestPath: join(jobDir, 'manifest.json'),
    reason: 'manifest',
  });

  writeFileSync(join(outputDir, 'manifest.json'), '{}\n');
  assert.equal(
    _test.resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts }).resultDir,
    outputDir,
    'the standard output directory wins when both manifests exist',
  );
  rmSync(join(outputDir, 'manifest.json'));
  rmSync(join(jobDir, 'manifest.json'));
  writeFileSync(join(jobDir, 'volcano.png'), 'PNG');
  assert.equal(
    _test.resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts }).reason,
    'declared_artifact',
  );
  rmSync(join(jobDir, 'volcano.png'));
  writeFileSync(join(jobDir, 'untrusted.txt'), 'not a declared output');
  assert.deepEqual(_test.resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts }), {
    resultDir: outputDir,
    manifestPath: join(outputDir, 'manifest.json'),
    reason: 'standard_default',
  });
});
