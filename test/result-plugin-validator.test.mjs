import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateResultStudioCandidate } = require('../core/shared-backend/result-plugin-validator');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function workspace(context) {
  const root = mkdtempSync(join(tmpdir(), 'biof3-result-validator-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const inputPath = join(root, 'data', 'input.csv');
  const outputDir = join(root, 'results', 'job_1', 'output');
  mkdirSync(join(inputPath, '..'), { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(inputPath, 'gene,value\nA,1\nB,2\n');
  return { root, inputPath, outputDir };
}

function descriptor({ checks, artifacts, mappings, fields = {} }) {
  return {
    inputBindings: [{ inputId: 'source', required: true }],
    entity: { fields },
    artifacts,
    interactionMappings: mappings,
    validator: { id: 'test_validator_v1', checks },
  };
}

function candidate({ fx, scriptHash, artifacts, normalized = null }) {
  const inputHash = sha256('gene,value\nA,1\nB,2\n');
  return {
    id: 'job_1',
    project_id: 'p_1',
    tool_id: 'test-plugin',
    status: 'completed',
    params: { source: fx.inputPath },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: artifacts.map((artifact) => ({ id: artifact.id, type: artifact.type, path: artifact.path })),
      executionProvenance: {
        script: { sha256: scriptHash },
        params: { normalized: normalized || { source: { inputRef: 'inputs/source/input.csv', sha256: inputHash } } },
        inputs: [{ id: 'source', sha256: inputHash }],
        artifacts: artifacts.map((artifact) => ({ id: artifact.id, sha256: sha256(artifact.content) })),
      },
    },
  };
}

test('P5 descriptor validator proves every produced formal output but never claims exact replay', (context) => {
  const fx = workspace(context);
  const scriptHash = 'a'.repeat(64);
  const tablePath = join(fx.outputDir, 'deg.csv');
  const plotPath = join(fx.outputDir, 'volcano.png');
  const reportPath = join(fx.outputDir, 'report.html');
  const table = 'gene,log2FoldChange,padj\nTP53,2,0.01\nEGFR,-1.5,0.02\n';
  const plot = 'not-a-real-png-but-exact-test-bytes';
  const report = '<html><body>exact report</body></html>';
  writeFileSync(tablePath, table);
  writeFileSync(plotPath, plot);
  writeFileSync(reportPath, report);
  const artifacts = [
    { id: 'deg_table', type: 'table', path: tablePath, content: table },
    { id: 'volcano', type: 'plot', path: plotPath, content: plot },
    { id: 'report', type: 'report', path: reportPath, content: report },
  ];
  const result = validateResultStudioCandidate({
    workspaceRoot: fx.root,
    expectedScriptSha256: scriptHash,
    descriptor: descriptor({
      checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256', 'stable_gene_id'],
      artifacts: [
        { id: 'deg_table', type: 'table', filename: 'deg.csv' },
        { id: 'volcano', type: 'plot', filename: 'volcano.png' },
        { id: 'report', type: 'report', filename: 'report.html' },
      ],
      mappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
    }),
    job: candidate({ fx, scriptHash, artifacts }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.formalArtifacts.map((artifact) => artifact.artifactId), ['deg_table', 'volcano', 'report']);
  assert.equal(result.validationStatus, 'valid');
  assert.equal(result.reproducibilityStatus, 'available');
  assert.equal(result.exactReplayVerified, false);
});

test('P5 descriptor validator blocks a completed Job when one required formal Artifact is missing', (context) => {
  const fx = workspace(context);
  const scriptHash = '8'.repeat(64);
  const tablePath = join(fx.outputDir, 'deg.csv');
  const table = 'gene,log2FoldChange,padj\nTP53,2,0.01\n';
  writeFileSync(tablePath, table);
  const artifacts = [{ id: 'deg_table', type: 'table', path: tablePath, content: table }];
  const result = validateResultStudioCandidate({
    workspaceRoot: fx.root,
    expectedScriptSha256: scriptHash,
    descriptor: descriptor({
      checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256', 'stable_gene_id'],
      artifacts: [
        { id: 'deg_table', type: 'table', filename: 'deg.csv' },
        { id: 'volcano', type: 'plot', filename: 'volcano.png' },
      ],
      mappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
    }),
    job: candidate({ fx, scriptHash, artifacts }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.formalArtifacts.map((artifact) => artifact.artifactId), ['deg_table']);
  assert.equal(result.diagnostics.some((item) => item.code === 'validator_formal_artifact_missing'
    && item.detail?.artifactId === 'volcano'), true);
});

test('P5 descriptor validator permits an explicitly optional formal Artifact to be absent', (context) => {
  const fx = workspace(context);
  const scriptHash = '7'.repeat(64);
  const tablePath = join(fx.outputDir, 'go.csv');
  const table = 'ID,Description,p.adjust\nGO:1,term,0.01\n';
  writeFileSync(tablePath, table);
  const artifacts = [{ id: 'go_bp_results', type: 'table', path: tablePath, content: table }];
  const result = validateResultStudioCandidate({
    workspaceRoot: fx.root,
    expectedScriptSha256: scriptHash,
    descriptor: descriptor({
      checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256', 'stable_term_id'],
      artifacts: [
        { id: 'go_bp_results', type: 'table', filename: 'go.csv' },
        { id: 'kegg_results', type: 'table', filename: 'kegg.csv', required: false },
      ],
      mappings: [{ artifactId: 'go_bp_results', mode: 'table', entityType: 'pathway', idField: 'ID' }],
    }),
    job: candidate({ fx, scriptHash, artifacts }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.some((item) => item.code === 'validator_formal_artifact_missing'), false);
});

test('P5 validator verifies an uploaded input from the authoritative Job sandbox when params omit a file path', (context) => {
  const fx = workspace(context);
  const scriptHash = '9'.repeat(64);
  const jobRoot = join(fx.root, 'results', 'job_1');
  const uploadedInput = join(jobRoot, 'source.csv');
  const scriptPath = join(jobRoot, 'run-script.R');
  const tablePath = join(fx.outputDir, 'deg.csv');
  const table = 'gene,log2FoldChange,padj\nTP53,2,0.01\n';
  writeFileSync(uploadedInput, 'gene,value\nA,1\nB,2\n');
  writeFileSync(scriptPath, 'print("trusted snapshot")\n');
  writeFileSync(tablePath, table);
  const artifacts = [{ id: 'deg_table', type: 'table', path: tablePath, content: table }];
  const job = candidate({ fx, scriptHash, artifacts });
  job.params = {};
  job.result.executionProvenance.script.snapshotPath = scriptPath;
  job.result.executionProvenance.inputs[0].relativePath = 'inputs/source/input.csv';
  const spec = descriptor({
    checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256', 'stable_gene_id'],
    artifacts: [{ id: 'deg_table', type: 'table' }],
    mappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
  });
  const valid = validateResultStudioCandidate({
    workspaceRoot: fx.root, expectedScriptSha256: scriptHash, descriptor: spec, job,
  });
  assert.equal(valid.ok, true);

  job.params = { source: 'source.csv' };
  const relativeParam = validateResultStudioCandidate({
    workspaceRoot: fx.root, expectedScriptSha256: scriptHash, descriptor: spec, job,
  });
  assert.equal(relativeParam.ok, true, 'safe relative plugin parameters resolve from the signed Job snapshot');
  job.params = {};

  writeFileSync(join(jobRoot, 'source.tsv'), 'gene\tvalue\nA\t1\nB\t2\n');
  const ambiguous = validateResultStudioCandidate({
    workspaceRoot: fx.root, expectedScriptSha256: scriptHash, descriptor: spec, job,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.diagnostics.some((item) => item.code === 'validator_input_hash_mismatch'
    && item.detail?.source === 'snapshot_input_ambiguous'), true);
});

test('P5 stable-id and output-hash checks block duplicate entities or drifted bytes', (context) => {
  const fx = workspace(context);
  const scriptHash = 'b'.repeat(64);
  const tablePath = join(fx.outputDir, 'deg.csv');
  const duplicate = 'gene,log2FoldChange,padj\nTP53,2,0.01\nTP53,-1,0.02\n';
  writeFileSync(tablePath, duplicate);
  const artifacts = [{ id: 'deg_table', type: 'table', path: tablePath, content: duplicate }];
  const spec = descriptor({
    checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256', 'stable_gene_id'],
    artifacts: [{ id: 'deg_table', type: 'table' }],
    mappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
  });
  const duplicateResult = validateResultStudioCandidate({
    workspaceRoot: fx.root, expectedScriptSha256: scriptHash, descriptor: spec,
    job: candidate({ fx, scriptHash, artifacts }),
  });
  assert.equal(duplicateResult.ok, false);
  assert.equal(duplicateResult.diagnostics.some((item) => item.code === 'validator_stable_id_invalid'), true);

  const driftedJob = candidate({ fx, scriptHash, artifacts });
  driftedJob.result.executionProvenance.artifacts[0].sha256 = 'f'.repeat(64);
  const drifted = validateResultStudioCandidate({
    workspaceRoot: fx.root, expectedScriptSha256: scriptHash, descriptor: spec, job: driftedJob,
  });
  assert.equal(drifted.ok, false);
  assert.equal(drifted.diagnostics.some((item) => item.code === 'validator_output_hash_mismatch'), true);
});

test('P5 finite-statistics validation rejects non-finite and out-of-range probabilities', (context) => {
  const fx = workspace(context);
  const scriptHash = 'f'.repeat(64);
  const tablePath = join(fx.outputDir, 'deg.csv');
  const spec = descriptor({
    checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256', 'stable_gene_id', 'finite_statistics'],
    artifacts: [{ id: 'deg_table', type: 'table' }],
    mappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
    fields: { gene: 'string', log2FoldChange: 'number', pvalue: 'number|null', padj: 'number|null' },
  });

  for (const [value, expectedCode] of [
    ['Inf', 'validator_statistic_not_finite'],
    ['-0.01', 'validator_probability_out_of_range'],
    ['1.01', 'validator_probability_out_of_range'],
  ]) {
    const table = `gene,log2FoldChange,pvalue,padj\nTP53,2,0.01,${value}\n`;
    writeFileSync(tablePath, table);
    const result = validateResultStudioCandidate({
      workspaceRoot: fx.root,
      expectedScriptSha256: scriptHash,
      descriptor: spec,
      job: candidate({
        fx,
        scriptHash,
        artifacts: [{ id: 'deg_table', type: 'table', path: tablePath, content: table }],
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics.some((item) => item.code === expectedCode), true);
  }
});

test('P6 finite-statistics validation admits R NA only for descriptor-nullable numerics', (context) => {
  const fx = workspace(context);
  const scriptHash = 'd'.repeat(64);
  const tablePath = join(fx.outputDir, 'enrichment.csv');
  const artifacts = [{ id: 'enrichment', type: 'table', path: tablePath }];
  const baseSpec = {
    checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256', 'stable_term_id', 'finite_statistics'],
    artifacts: [{ id: 'enrichment', type: 'table' }],
    mappings: [{ artifactId: 'enrichment', mode: 'table', entityType: 'pathway', idField: 'term_id' }],
  };
  const nullable = 'term_id,p_adjust,up_gene_count\nGO:1,0.01,NA\n';
  writeFileSync(tablePath, nullable);
  const accepted = validateResultStudioCandidate({
    workspaceRoot: fx.root,
    expectedScriptSha256: scriptHash,
    descriptor: descriptor({
      ...baseSpec,
      fields: { term_id: 'string', p_adjust: 'number', up_gene_count: 'number|null' },
    }),
    job: candidate({
      fx,
      scriptHash,
      artifacts: artifacts.map((artifact) => ({ ...artifact, content: nullable })),
    }),
  });
  assert.equal(accepted.ok, true);

  const required = validateResultStudioCandidate({
    workspaceRoot: fx.root,
    expectedScriptSha256: scriptHash,
    descriptor: descriptor({
      ...baseSpec,
      fields: { term_id: 'string', p_adjust: 'number', up_gene_count: 'number' },
    }),
    job: candidate({
      fx,
      scriptHash,
      artifacts: artifacts.map((artifact) => ({ ...artifact, content: nullable })),
    }),
  });
  assert.equal(required.ok, false);
  assert.equal(required.diagnostics.some((item) => item.code === 'validator_statistic_not_finite'
    && item.detail?.field === 'up_gene_count'), true);
});

test('P5 neutral fixture descriptor declares finite-statistics-style validator checks', () => {
  // BLOCK-83 P4：生信插件迁出核心后，validator-checks 机制断言改用中性夹具
  // （sample-metrics 自带合法 resultStudio.validator，经 fail-closed lint）。
  const definition = require('../test/fixtures/neutral-plugins/sample-metrics/tool-definition.json');
  assert.equal(Array.isArray(definition.resultStudio.validator.checks), true, 'validator.checks array');
  assert.ok(definition.resultStudio.validator.checks.length > 0);
});

test('P5 symmetric-matrix validation accepts exact correlation matrices and rejects asymmetric values', (context) => {
  const fx = workspace(context);
  const scriptHash = 'c'.repeat(64);
  const matrixPath = join(fx.outputDir, 'corr.csv');
  const symmetric = ',TP53,EGFR\nTP53,1,0.25\nEGFR,0.25,1\n';
  writeFileSync(matrixPath, symmetric);
  const artifacts = [{ id: 'corr_matrix', type: 'table', path: matrixPath, content: symmetric }];
  const spec = descriptor({
    checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256', 'symmetric_matrix'],
    artifacts: [{ id: 'corr_matrix', type: 'table' }],
    mappings: [{ artifactId: 'corr_matrix', dataArtifactId: 'corr_matrix', mode: 'matrix', rowIdField: 'row_id' }],
  });
  const valid = validateResultStudioCandidate({
    workspaceRoot: fx.root, expectedScriptSha256: scriptHash, descriptor: spec,
    job: candidate({ fx, scriptHash, artifacts }),
  });
  assert.equal(valid.ok, true);

  const asymmetric = ',TP53,EGFR\nTP53,1,0.25\nEGFR,0.5,1\n';
  writeFileSync(matrixPath, asymmetric);
  const invalidArtifacts = [{ id: 'corr_matrix', type: 'table', path: matrixPath, content: asymmetric }];
  const invalid = validateResultStudioCandidate({
    workspaceRoot: fx.root, expectedScriptSha256: scriptHash, descriptor: spec,
    job: candidate({ fx, scriptHash, artifacts: invalidArtifacts }),
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics.some((item) => item.code === 'validator_matrix_not_symmetric'), true);
});

test('P5 enrichment stable-term validation permits a declared empty result but rejects duplicate terms', (context) => {
  const fx = workspace(context);
  const scriptHash = 'd'.repeat(64);
  const tablePath = join(fx.outputDir, 'go.csv');
  const spec = descriptor({
    checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256', 'stable_term_id', 'empty_result_is_valid'],
    artifacts: [{ id: 'go_bp_results', type: 'table' }],
    mappings: [{ artifactId: 'go_bp_results', mode: 'table', entityType: 'pathway', idField: 'ID' }],
  });
  const empty = 'ID,Description,p.adjust\n';
  writeFileSync(tablePath, empty);
  const valid = validateResultStudioCandidate({
    workspaceRoot: fx.root, expectedScriptSha256: scriptHash, descriptor: spec,
    job: candidate({ fx, scriptHash, artifacts: [{ id: 'go_bp_results', type: 'table', path: tablePath, content: empty }] }),
  });
  assert.equal(valid.ok, true);

  const duplicate = 'ID,Description,p.adjust\nGO:1,first,0.01\nGO:1,second,0.02\n';
  writeFileSync(tablePath, duplicate);
  const invalid = validateResultStudioCandidate({
    workspaceRoot: fx.root, expectedScriptSha256: scriptHash, descriptor: spec,
    job: candidate({ fx, scriptHash, artifacts: [{ id: 'go_bp_results', type: 'table', path: tablePath, content: duplicate }] }),
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics.some((item) => item.code === 'validator_stable_id_invalid'), true);
});

test('P5 validator fails closed when a descriptor check has no implementation', (context) => {
  const fx = workspace(context);
  const scriptHash = 'e'.repeat(64);
  const tablePath = join(fx.outputDir, 'table.csv');
  const table = 'gene,value\nA,1\n';
  writeFileSync(tablePath, table);
  const result = validateResultStudioCandidate({
    workspaceRoot: fx.root,
    expectedScriptSha256: scriptHash,
    descriptor: descriptor({
      checks: ['artifact_truth_valid', 'future_magic_check'],
      artifacts: [{ id: 'table', type: 'table' }],
      mappings: [],
    }),
    job: candidate({ fx, scriptHash, artifacts: [{ id: 'table', type: 'table', path: tablePath, content: table }] }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((item) => item.code === 'validator_check_unsupported'), true);
});
