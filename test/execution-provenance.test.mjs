import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createExecutionProvenance,
  attachProvenanceToResult,
  resolveExecutionInputPath,
} = require('../core/shared-backend/execution-provenance');
const { collectExecutionInputs, writeArtifactManifest } = require('../core/shared-backend/artifact-manifest');
const root = mkdtempSync(join(tmpdir(), 'biof3-hrt4-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('HRT-4 binds TaskSpec, plugin, runtime, script, params, inputs and artifacts', () => {
  const scriptPath = join(root, 'run-script.R');
  const tablePath = join(root, 'deg.csv');
  writeFileSync(scriptPath, 'write.csv(data.frame(gene="A"), "deg.csv")\n');
  writeFileSync(tablePath, 'gene,log2FC,pvalue\nA,1,0.01\n');
  const scientificTask = {
    task_id: 'task_1', version: 1, spec_hash: 'a'.repeat(64),
    confirmation: { confirmationVersion: 1 },
    spec: { inputs: [{ role: 'counts', relativePath: 'data/counts.csv', sha256: 'b'.repeat(64), sizeBytes: 100 }] },
  };
  const provenance = createExecutionProvenance({
    toolJobId: 'tj_1', projectId: 'project_1', scientificTask,
    plugin: { id: 'deseq2', version: '1.0.0', language: 'r', entryPoint: 'scripts/deseq2.R', execution: { scriptFingerprint: 'c'.repeat(64) } },
    params: { alpha: 0.05 }, runtime: { name: 'r', command: '/runtime/Rscript', version: '4.5', ready: true },
    runScriptPath: scriptPath, command: { executable: '/runtime/Rscript', args: [scriptPath, root], cwd: root },
    artifacts: [{ id: 'deg_table', filename: 'deg.csv', type: 'table', path: tablePath }],
  });
  assert.equal(provenance.task.specHash, scientificTask.spec_hash);
  assert.equal(provenance.plugin.id, 'deseq2');
  assert.match(provenance.script.sha256, /^[a-f0-9]{64}$/);
  assert.match(provenance.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(provenance.provenanceHash, /^[a-f0-9]{64}$/);
  const result = attachProvenanceToResult({ artifacts: [{ id: 'deg_table', filename: 'deg.csv', path: tablePath }] }, provenance, join(root, 'provenance.json'));
  assert.equal(result.artifacts[0].provenance.reproductionTarget, 'deg_table');
  assert.equal(result.outputs[0].provenance.provenanceHash, provenance.provenanceHash);
});

test('HRT-4 produces stable provenance for identical facts', () => {
  const scriptPath = join(root, 'stable.R');
  writeFileSync(scriptPath, 'print(1)\n');
  const input = { toolJobId: 'tj_stable', projectId: 'p', plugin: { id: 'tool', version: '1', language: 'r' }, params: { b: 2, a: 1 }, runScriptPath: scriptPath, artifacts: [] };
  assert.equal(createExecutionProvenance(input).provenanceHash, createExecutionProvenance({ ...input, params: { a: 1, b: 2 } }).provenanceHash);
});

test('direct plugin runs hash declared file inputs without retaining absolute paths', () => {
  const jobDir = join(root, 'direct-run');
  const inputPath = join(jobDir, 'counts.csv');
  const scriptPath = join(jobDir, 'run-script.R');
  const outputPath = join(jobDir, 'deg.csv');
  require('node:fs').mkdirSync(jobDir, { recursive: true });
  writeFileSync(inputPath, 'gene,S1\nA,2\n');
  writeFileSync(scriptPath, 'print(1)\n');
  writeFileSync(outputPath, 'gene,log2FC\nA,1\n');
  const inputs = collectExecutionInputs({
    inputDefinitions: [{ id: 'counts', role: 'counts', type: 'file' }],
    params: { counts: inputPath },
    jobDir,
  });
  const provenance = createExecutionProvenance({
    toolJobId: 'tj_direct',
    plugin: { id: 'tool', version: '1', language: 'r', packages: { r: { jsonlite: '>=1.8' } } },
    params: { counts: inputPath, alpha: 0.05 },
    inputs,
    runScriptPath: scriptPath,
    artifacts: [{ id: 'deg', filename: 'deg.csv', type: 'table', path: outputPath }],
  });
  assert.match(provenance.inputs[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(provenance.params.normalized.counts.inputRef, 'inputs/counts/counts.csv');
  assert.doesNotMatch(JSON.stringify(provenance.params), new RegExp(jobDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(provenance.plugin.packageConstraints, { jsonlite: '>=1.8' });
});

test('direct uploaded files remain normalized input bindings when public params omit their paths', () => {
  const jobDir = join(root, 'uploaded-run');
  const inputPath = join(jobDir, 'counts.csv');
  const scriptPath = join(jobDir, 'run-script.R');
  require('node:fs').mkdirSync(jobDir, { recursive: true });
  writeFileSync(inputPath, 'gene,S1\nA,2\n');
  writeFileSync(scriptPath, 'print(1)\n');
  const inputs = collectExecutionInputs({
    inputDefinitions: [{ id: 'counts', role: 'counts', type: 'file' }],
    params: { alpha: 0.05 },
    jobDir,
  });
  const provenance = createExecutionProvenance({
    toolJobId: 'tj_uploaded',
    plugin: { id: 'tool', version: '1', language: 'r' },
    params: { alpha: 0.05 },
    inputs,
    runScriptPath: scriptPath,
  });
  assert.deepEqual(provenance.params.normalized.counts, {
    inputRef: 'inputs/counts/counts.csv',
    sha256: provenance.inputs[0].sha256,
  });
  const resolved = resolveExecutionInputPath({
    workspaceRoot: root,
    input: provenance.inputs[0],
    sourceParams: { alpha: 0.05 },
    provenance,
  });
  assert.equal(resolved.path, realpathSync(inputPath));
  assert.equal(resolved.source, 'job_compatibility_input');

  for (const relativePath of ['../counts.csv', '..\\counts.csv', 'inputs/../counts.csv']) {
    const unsafe = resolveExecutionInputPath({
      workspaceRoot: root,
      input: { ...provenance.inputs[0], relativePath },
      sourceParams: { alpha: 0.05 },
      provenance,
    });
    assert.deepEqual(unsafe, {
      path: null,
      source: null,
      reason: 'input_identity_invalid',
    });
  }
});

test('artifact manifest records script, params, input and output hashes', () => {
  const outputDir = join(root, 'artifact-output');
  require('node:fs').mkdirSync(outputDir, { recursive: true });
  const scriptPath = join(outputDir, 'run-script.py');
  const inputPath = join(outputDir, 'input.csv');
  const tablePath = join(outputDir, 'table.csv');
  writeFileSync(scriptPath, 'print(1)\n');
  writeFileSync(inputPath, 'x\n1\n');
  writeFileSync(tablePath, 'y\n2\n');
  const provenance = createExecutionProvenance({
    toolJobId: 'tj_manifest',
    plugin: { id: 'pca', version: '1', language: 'python' },
    params: { expr: inputPath },
    inputs: [{ id: 'expr', role: 'expression', relativePath: 'inputs/expr/input.csv', sha256: require('node:crypto').createHash('sha256').update(readFileSync(inputPath)).digest('hex'), sizeBytes: 4 }],
    runScriptPath: scriptPath,
    artifacts: [{ id: 'table', filename: 'table.csv', type: 'table', path: tablePath }],
  });
  const written = writeArtifactManifest({ outputDir, result: { artifactTruth: { status: 'valid' } }, provenance });
  const manifest = JSON.parse(readFileSync(written.manifestPath, 'utf8'));
  assert.match(manifest.reproducibility.scriptSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.reproducibility.paramsSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.reproducibility.inputSha256.expr, /^[a-f0-9]{64}$/);
  assert.match(manifest.reproducibility.outputSha256['table.csv'], /^[a-f0-9]{64}$/);
});
