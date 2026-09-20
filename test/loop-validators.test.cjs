#!/usr/bin/env node

/**
 * Built-in Loop Validators — unit tests (CJS).
 * Run via: node --test test/loop-validators.test.cjs
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  validateArtifact,
  validateDelivery,
  clearRegistry,
  registerValidator,
} = require('../core/shared-backend/loop-validator-registry');
const { BUILTIN_VALIDATOR_DEFS } = require('../core/shared-backend/loop-validators');

// Re-register all built-in validators before every test to ensure fresh state.
beforeEach(() => {
  clearRegistry();
  for (const def of BUILTIN_VALIDATOR_DEFS) {
    registerValidator(def);
  }
});

const VALID = 'valid';
const DEGRADED = 'degraded';
const BLOCKED = 'blocked';

// ---------------------------------------------------------------------------
// BIV-1: input-snapshot validator
// ---------------------------------------------------------------------------

describe('BIV-1 input-snapshot validator', () => {
  it('passes for non-empty artifact with valid hash', () => {
    const result = validateArtifact({
      kind: 'file',
      filename: 'counts.csv',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
    });
    assert.strictEqual(result.overallStatus, VALID);
  });

  it('blocks empty file (sizeBytes=0)', () => {
    const result = validateArtifact({ kind: 'file', filename: 'empty.csv', sizeBytes: 0 });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'INPUT_FILE_EMPTY'));
  });

  it('blocks invalid SHA-256 hash', () => {
    const result = validateArtifact({ kind: 'file', filename: 'counts.csv', sha256: 'not-a-hash' });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'INPUT_HASH_INVALID'));
  });

  it('passes for artifact with no hash provided', () => {
    const result = validateArtifact({ kind: 'file', filename: 'report.pdf', sizeBytes: 512 });
    assert.strictEqual(result.overallStatus, VALID);
  });

  it('warns when artifact not in dagNode requiredInputs', () => {
    const result = validateArtifact(
      { kind: 'file', filename: 'foo.txt', inputRole: 'foo', sizeBytes: 100 },
      { dagNode: { requiredInputs: ['counts', 'metadata'] } },
    );
    assert.strictEqual(result.overallStatus, DEGRADED);
    assert.ok(result.findings.some((f) => f.code === 'INPUT_NOT_IN_REQUIRED_LIST'));
  });

  it('passes when artifact matches requiredInputs', () => {
    const result = validateArtifact(
      { kind: 'file', filename: 'counts.csv', inputRole: 'counts', sizeBytes: 1024 },
      { dagNode: { requiredInputs: ['counts', 'metadata'] } },
    );
    assert.strictEqual(result.overallStatus, VALID);
  });
});

// ---------------------------------------------------------------------------
// BIV-2: metadata-consistency validator
// ---------------------------------------------------------------------------

describe('BIV-2 metadata-consistency validator', () => {
  it('passes for valid metadata with sample_id column', () => {
    const result = validateArtifact({
      kind: 'metadata',
      filename: 'metadata.csv',
      rows: [
        { sample_id: 'S1', condition: 'control' },
        { sample_id: 'S2', condition: 'treatment' },
      ],
    });
    assert.strictEqual(result.overallStatus, VALID);
  });

  it('passes for "sample" column alias', () => {
    const result = validateArtifact({
      kind: 'metadata',
      filename: 'meta.csv',
      rows: [{ sample: 'A1' }, { sample: 'A2' }],
    });
    assert.strictEqual(result.overallStatus, VALID);
  });

  it('blocks metadata with no identifiable columns', () => {
    const result = validateArtifact({ kind: 'metadata', filename: 'empty.tsv', rows: [] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'METADATA_NO_COLUMNS'));
  });

  it('blocks metadata missing sample_id column', () => {
    const result = validateArtifact({
      kind: 'metadata',
      filename: 'bad.csv',
      rows: [{ condition: 'ctrl' }, { condition: 'treat' }],
    });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'METADATA_MISSING_SAMPLE_ID'));
  });

  it('blocks duplicate column names', () => {
    const result = validateArtifact({
      kind: 'metadata',
      filename: 'dup.csv',
      columns: ['sample_id', 'sample_id', 'condition'],
      rows: [],
    });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'METADATA_DUPLICATE_COLUMNS'));
  });

  it('warns on too few rows', () => {
    const result = validateArtifact({
      kind: 'metadata',
      filename: 'single.tsv',
      rows: [{ sample_id: 'S1' }],
    });
    assert.strictEqual(result.overallStatus, DEGRADED);
    assert.ok(result.findings.some((f) => f.code === 'METADATA_TOO_FEW_ROWS'));
  });

  it('warns on missing expected columns', () => {
    const result = validateArtifact(
      {
        kind: 'metadata',
        filename: 'partial.csv',
        rows: [{ sample_id: 'S1' }],
      },
      { expectedColumns: ['condition'] },
    );
    assert.strictEqual(result.overallStatus, DEGRADED);
    assert.ok(result.findings.some((f) => f.code === 'METADATA_MISSING_EXPECTED_COLUMN'));
  });
});

// ---------------------------------------------------------------------------
// BIV-3: counts-matrix validator
// ---------------------------------------------------------------------------

describe('BIV-3 counts-matrix validator', () => {
  it('passes for valid counts matrix', () => {
    const data = Array.from({ length: 20 }, (_, i) => [i, i * 2, i * 3]);
    const result = validateArtifact({ kind: 'counts', filename: 'counts.csv', data });
    assert.strictEqual(result.overallStatus, VALID);
  });

  it('blocks counts with no data array', () => {
    const result = validateArtifact({ kind: 'counts', filename: 'counts.csv' });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'COUNTS_NO_DATA'));
  });

  it('blocks counts with fewer than 2 columns', () => {
    const result = validateArtifact({ kind: 'counts', filename: 'counts.csv', data: [[1], [2]] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'COUNTS_TOO_FEW_COLUMNS'));
  });

  it('blocks negative count values', () => {
    const result = validateArtifact({ kind: 'counts', filename: 'counts.csv', data: [[1, -5, 3]] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'COUNTS_NEGATIVE_VALUE'));
  });

  it('blocks non-numeric values', () => {
    const result = validateArtifact({ kind: 'counts', filename: 'counts.csv', data: [['a', 'b', 'c']] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'COUNTS_NON_NUMERIC'));
  });

  it('warns on too few rows', () => {
    const result = validateArtifact({ kind: 'counts', filename: 'counts.csv', data: [[1, 2]] });
    assert.strictEqual(result.overallStatus, DEGRADED);
    assert.ok(result.findings.some((f) => f.code === 'COUNTS_TOO_FEW_ROWS'));
  });

  it('warns on row count below expected', () => {
    const result = validateArtifact(
      { kind: 'counts', filename: 'counts.csv', data: Array.from({ length: 5 }, (_, i) => [i, i + 1, i + 2]) },
      { expectedGenes: 100 },
    );
    assert.strictEqual(result.overallStatus, DEGRADED);
    assert.ok(result.findings.some((f) => f.code === 'COUNTS_ROW_COUNT_LOW'));
  });
});

// ---------------------------------------------------------------------------
// BIV-4: de-results validator
// ---------------------------------------------------------------------------

describe('BIV-4 de-results validator', () => {
  it('passes for valid DE results', () => {
    const rows = [
      { gene: 'TP53', log2fc: 2.5, padj: 0.001 },
      { gene: 'BRCA1', log2fc: -1.2, pvalue: 0.03 },
    ];
    const result = validateArtifact({ kind: 'de-results', filename: 'de_results.csv', rows });
    assert.strictEqual(result.overallStatus, VALID);
  });

  it('blocks DE results with no rows', () => {
    const result = validateArtifact({ kind: 'de-results', filename: 'de.csv', rows: [] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'DE_NO_RESULTS'));
  });

  it('blocks missing gene column', () => {
    const result = validateArtifact({ kind: 'de-results', filename: 'de.csv', rows: [{ log2fc: 2.1, padj: 0.01 }] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'DE_MISSING_GENE_COLUMN'));
  });

  it('blocks missing logFC column', () => {
    const result = validateArtifact({ kind: 'de-results', filename: 'de.csv', rows: [{ gene: 'TP53', padj: 0.01 }] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'DE_MISSING_LOGFC_COLUMN'));
  });

  it('blocks missing p-value columns', () => {
    const result = validateArtifact({ kind: 'de-results', filename: 'de.csv', rows: [{ gene: 'TP53', log2fc: 2.1 }] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'DE_MISSING_PVALUE'));
  });

  it('warns on extreme log2FC values', () => {
    const rows = [{ gene: 'TP53', log2fc: 25.0, padj: 0.001 }];
    const result = validateArtifact({ kind: 'de-results', filename: 'de.csv', rows });
    assert.strictEqual(result.overallStatus, DEGRADED);
    assert.ok(result.findings.some((f) => f.code === 'DE_EXTREME_LOGFC'));
  });
});

// ---------------------------------------------------------------------------
// BIV-5: heatmap-data validator
// ---------------------------------------------------------------------------

describe('BIV-5 heatmap-data validator', () => {
  it('passes for valid heatmap data', () => {
    const matrix = [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]];
    const result = validateArtifact({ kind: 'heatmap', filename: 'heatmap.json', matrix });
    assert.strictEqual(result.overallStatus, VALID);
  });

  it('passes with row/col annotations', () => {
    const result = validateArtifact({
      kind: 'heatmap',
      filename: 'heatmap.json',
      matrix: [[1, 2], [3, 4]],
      rowAnnotations: [{ gene: 'TP53' }],
      colAnnotations: [{ sample: 'S1' }],
    });
    assert.strictEqual(result.overallStatus, VALID);
  });

  it('blocks heatmap with no matrix', () => {
    const result = validateArtifact({ kind: 'heatmap', filename: 'heatmap.json' });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'HEATMAP_NO_MATRIX'));
  });

  it('blocks heatmap with no columns', () => {
    const result = validateArtifact({ kind: 'heatmap', filename: 'heatmap.json', matrix: [[]] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'HEATMAP_NO_COLUMNS'));
  });

  it('blocks heatmap smaller than 2x2', () => {
    const result = validateArtifact({ kind: 'heatmap', filename: 'heatmap.json', matrix: [[1]] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'HEATMAP_TOO_SMALL'));
  });

  it('warns on NaN values', () => {
    const result = validateArtifact({ kind: 'heatmap', filename: 'heatmap.json', matrix: [[1, NaN, 3], [4, 5, 6]] });
    assert.strictEqual(result.overallStatus, DEGRADED);
    assert.ok(result.findings.some((f) => f.code === 'HEATMAP_NA_VALUE'));
  });
});

// ---------------------------------------------------------------------------
// BIV-6: enrichment-statistics validator
// ---------------------------------------------------------------------------

describe('BIV-6 enrichment-statistics validator', () => {
  it('passes for valid enrichment results', () => {
    const rows = [
      { pathway: 'GO:0001234', pvalue: 0.001, gene_count: 25 },
      { term: 'KEGG:hsa04110', pval: 0.03 },
    ];
    const result = validateArtifact({ kind: 'enrichment', filename: 'enrichment.csv', rows });
    assert.strictEqual(result.overallStatus, VALID);
  });

  it('passes with adjusted p-values', () => {
    const rows = [{ category: 'Reactome', padj: 0.05 }];
    const result = validateArtifact({ kind: 'enrichment', filename: 'enr.csv', rows });
    assert.strictEqual(result.overallStatus, VALID);
  });

  it('blocks enrichment with no rows', () => {
    const result = validateArtifact({ kind: 'enrichment', filename: 'enr.csv', rows: [] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'ENRICHMENT_NO_RESULTS'));
  });

  it('blocks missing term/pathway column', () => {
    const result = validateArtifact({ kind: 'enrichment', filename: 'enr.csv', rows: [{ pvalue: 0.01 }] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'ENRICHMENT_MISSING_TERM_COLUMN'));
  });

  it('blocks missing p-value column', () => {
    const result = validateArtifact({ kind: 'enrichment', filename: 'enr.csv', rows: [{ pathway: 'GO:0001' }] });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'ENRICHMENT_MISSING_PVALUE'));
  });

  it('blocks p-value out of [0,1]', () => {
    const rows = [{ pathway: 'GO:0001', pvalue: 1.5 }];
    const result = validateArtifact({ kind: 'enrichment', filename: 'enr.csv', rows });
    assert.strictEqual(result.overallStatus, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'ENRICHMENT_PVALUE_OUT_OF_RANGE'));
  });
});

// ---------------------------------------------------------------------------
// BIV-7: delivery-integrity validator
// ---------------------------------------------------------------------------

describe('BIV-7 delivery-integrity validator', () => {
  it('passes for valid delivery manifest', () => {
    const record = {
      deliveryManifestVersion: 1,
      status: 'valid',
      artifacts: [{ id: 'counts', filename: 'counts.csv' }],
      requirementCoverage: [{ requirement: 'counts', status: 'satisfied' }],
    };
    const result = validateDelivery(record);
    assert.strictEqual(result.status, VALID);
  });

  it('blocks delivery with no version', () => {
    const result = validateDelivery({ status: 'valid', artifacts: [] });
    assert.strictEqual(result.status, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'DELIVERY_NO_VERSION'));
  });

  it('blocks delivery with no artifacts', () => {
    const result = validateDelivery({ deliveryManifestVersion: 1, status: 'valid', artifacts: [] });
    assert.strictEqual(result.status, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'DELIVERY_NO_ARTIFACTS'));
  });

  it('blocks delivery with artifact missing id/filename', () => {
    const result = validateDelivery({
      deliveryManifestVersion: 1,
      status: 'valid',
      artifacts: [{ type: 'csv' }],
    });
    assert.strictEqual(result.status, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'DELIVERY_ARTIFACT_NO_ID'));
  });

  it('blocks uncovered requirements', () => {
    const result = validateDelivery({
      deliveryManifestVersion: 1,
      status: 'valid',
      artifacts: [{ id: 'counts' }],
      requirementCoverage: [
        { requirement: 'counts', status: 'satisfied' },
        { requirement: 'heatmap', status: 'unresolved' },
      ],
    });
    assert.strictEqual(result.status, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'DELIVERY_REQUIREMENT_UNCOVERED'));
  });

  it('blocks when artifactTruth is blocked', () => {
    const result = validateDelivery({
      deliveryManifestVersion: 1,
      status: 'blocked',
      artifacts: [{ id: 'counts' }],
      artifactTruth: { status: 'blocked', blocking: true },
    });
    assert.strictEqual(result.status, BLOCKED);
    assert.ok(result.findings.some((f) => f.code === 'DELIVERY_ARTIFACT_TRUTH_BLOCKED'));
  });

  it('returns degraded on degraded status', () => {
    const result = validateDelivery({
      deliveryManifestVersion: 1,
      status: 'degraded',
      artifacts: [{ id: 'counts' }],
    });
    assert.strictEqual(result.status, DEGRADED);
  });
});

// ---------------------------------------------------------------------------
// BIV-8: cross-validator integration
// ---------------------------------------------------------------------------

describe('BIV-8 cross-validator integration', () => {
  it('counts-matrix validator runs on counts kind', () => {
    const result = validateArtifact({
      kind: 'counts',
      filename: 'counts.csv',
      data: Array.from({ length: 5 }, () => [1, 2, 3]),
    });
    const found = result.results.find((r) => r.validatorId === 'counts-matrix');
    assert.ok(found, 'counts-matrix validator should have run');
  });

  it('de-results validator runs on de-results kind', () => {
    const result = validateArtifact({
      kind: 'de-results',
      filename: 'de_results.json',
      rows: [{ gene: 'TP53', log2fc: 2, padj: 0.01 }],
    });
    const found = result.results.find((r) => r.validatorId === 'de-results');
    assert.ok(found, 'de-results validator should have run');
  });

  it('multiple validators on same artifact aggregate correctly', () => {
    const result = validateArtifact({
      kind: 'metadata',
      filename: 'counts.csv',
      rows: [{ sample_id: 'S1' }, { sample_id: 'S2' }],
    });
    assert.strictEqual(result.overallStatus, VALID);
  });
});