import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const { reconcileArtifactTruth } = req(resolve(
  __dirname,
  '..',
  'core',
  'r-server',
  'helpers',
  'artifact-truth.js',
));
const { _test: metadataTest, reconcileToolJobArtifacts } = req(resolve(
  __dirname,
  '..',
  'core',
  'r-server',
  'routes',
  'tools-metadata.js',
));
const { _test: executorTest } = req(resolve(
  __dirname,
  '..',
  'core',
  'r-server',
  'helpers',
  'tools-executor.js',
));

function tempResultDir() {
  return fs.mkdtempSync(join(os.tmpdir(), 'biof3-artifact-truth-'));
}

test('filters optional manifest artifacts that do not exist on disk', () => {
  const resultDir = tempResultDir();
  fs.writeFileSync(join(resultDir, 'volcano.png'), 'png');
  const reconciled = reconcileArtifactTruth({
    resultDir,
    result: {
      manifest: {
        files: [
          { name: 'report.html', type: 'report', required: false },
          { name: 'volcano.png', type: 'plot' },
        ],
        sections: [
          { id: 'report', artifactNames: ['report.html'] },
          { id: 'plots', artifactNames: ['volcano.png'] },
        ],
      },
    },
  });

  assert.equal(reconciled.blocking, false);
  assert.equal(reconciled.artifactTruth.status, 'degraded');
  assert.deepEqual(reconciled.artifacts.map((item) => item.name), ['volcano.png']);
  assert.equal(reconciled.result.manifest.sections.length, 1);
  assert.equal(reconciled.issues[0].code, 'artifact_missing');
});

test('does not expose manifest metadata as a user artifact', () => {
  const resultDir = tempResultDir();
  fs.writeFileSync(join(resultDir, 'manifest.json'), '{}');
  fs.writeFileSync(join(resultDir, 'table.csv'), 'a,b\n1,2\n');
  const reconciled = reconcileArtifactTruth({
    resultDir,
    result: {
      files: [
        { name: 'manifest.json', type: 'text' },
        { name: 'table.csv', type: 'table' },
      ],
    },
  });

  assert.equal(reconciled.artifactTruth.status, 'valid');
  assert.deepEqual(reconciled.artifacts.map((item) => item.name), ['table.csv']);
});

test('blocks completion when a required declared artifact is missing', () => {
  const resultDir = tempResultDir();
  const reconciled = reconcileArtifactTruth({
    resultDir,
    result: { outputs: [{ id: 'plot', filename: 'plot.png', required: true }] },
  });

  assert.equal(reconciled.blocking, true);
  assert.equal(reconciled.artifactTruth.status, 'blocked');
  assert.equal(reconciled.issues[0].code, 'required_artifact_missing');
});

test('matches required output ids to real files and adds unlisted disk artifacts', () => {
  const resultDir = tempResultDir();
  fs.writeFileSync(join(resultDir, 'volcano.png'), 'plot');
  fs.writeFileSync(join(resultDir, 'table.csv'), 'a,b\n1,2\n');
  const reconciled = reconcileArtifactTruth({
    resultDir,
    result: { outputs: [{ id: 'volcano', filename: 'volcano.png', type: 'plot' }] },
    expectedArtifacts: [{ id: 'volcano', type: 'plot', required: true }],
    canonicalizePath: (value) => value.replace(resultDir, '/work/result'),
  });

  assert.equal(reconciled.blocking, false);
  assert.equal(reconciled.artifactTruth.status, 'valid');
  assert.deepEqual(reconciled.artifacts.map((item) => item.name), ['volcano.png', 'table.csv']);
  assert.equal(reconciled.artifacts[0].required, true);
  assert.equal(reconciled.artifacts[0].canonicalPath, '/work/result/volcano.png');
});

test('treats empty required files as blocking', () => {
  const resultDir = tempResultDir();
  fs.writeFileSync(join(resultDir, 'result.csv'), '');
  const reconciled = reconcileArtifactTruth({
    resultDir,
    result: { files: [{ name: 'result.csv', required: true }] },
  });

  assert.equal(reconciled.blocking, true);
  assert.equal(reconciled.issues[0].code, 'required_artifact_empty');
});

test('selects a populated output directory over an existing empty job root', () => {
  const jobsDir = tempResultDir();
  const jobRoot = join(jobsDir, 'job_1');
  const outputDir = join(jobRoot, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(join(outputDir, 'manifest.json'), '{}');
  fs.writeFileSync(join(outputDir, 'plot.png'), 'plot');

  const selected = metadataTest.selectArtifactResultDir({
    job: { id: 'job_1' },
    result: { resultDir: jobRoot },
    jobsDir,
  });

  assert.equal(selected, outputDir);
});

test('reports a blocking type mismatch for required artifacts', () => {
  const resultDir = tempResultDir();
  fs.writeFileSync(join(resultDir, 'report.csv'), 'a,b\n1,2\n');
  const reconciled = reconcileArtifactTruth({
    resultDir,
    result: { files: [{ name: 'report.csv', type: 'report', required: true }] },
  });

  assert.equal(reconciled.blocking, true);
  assert.equal(reconciled.issues[0].code, 'artifact_type_mismatch');
});

test('allows standard and MCP result directories but rejects unmanaged paths', () => {
  const root = tempResultDir();
  const jobsDir = join(root, 'tool-jobs');
  assert.equal(executorTest.isManagedResultDir(join(jobsDir, 'job_1', 'output'), jobsDir), true);
  assert.equal(executorTest.isManagedResultDir(join(root, 'mcp-tool-jobs', 'mcp_1'), jobsDir), true);
  assert.equal(executorTest.isManagedResultDir(join(root, 'outside', 'secret'), jobsDir), false);
});

test('shared tool-job reconciliation persists artifact truth before workflow projection', async () => {
  const jobsDir = tempResultDir();
  const resultDir = join(jobsDir, 'job_shared', 'output');
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(join(resultDir, 'table.csv'), 'a,b\n1,2\n');
  const writes = [];
  const db = {
    prepare() {
      return {
        async run(...args) {
          writes.push(args);
        },
      };
    },
  };
  const reconciled = await reconcileToolJobArtifacts({
    db,
    jobsDir,
    job: {
      id: 'job_shared',
      tool_id: 'unknown-test-tool',
      status: 'completed',
      result: { resultDir, files: [{ name: 'table.csv', type: 'table' }] },
    },
  });

  assert.equal(reconciled.status, 'completed');
  assert.equal(reconciled.result.artifactTruth.status, 'valid');
  assert.equal(reconciled.result.artifacts.length, 1);
  assert.equal(writes.length, 1);
});
