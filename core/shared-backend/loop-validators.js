'use strict';

/**
 * Built-in Loop Validator Definitions v1.
 *
 * Each validator is a pure function: (artifact, context) => ValidatorResult.
 * No I/O, no DB, no network. All file/hash checks are done by the integration layer
 * which passes pre-fetched facts via context.
 *
 * Built-in validators:
 *  1. input-snapshot        — verify input files exist, hash matches, size non-zero
 *  2. metadata-consistency  — verify metadata columns match expected schema
 *  3. counts-matrix         — verify counts matrix dimensions and non-negative values
 *  4. de-results            — verify DE results have required columns and statistics
 *  5. heatmap-data          — verify heatmap input has required matrix + row/col annotations
 *  6. enrichment-statistics — verify enrichment results have required columns and p-values
 *  7. delivery-integrity    — verify delivery manifest completeness
 *
 * Validator result status semantics:
 *  - valid:       artifact is structurally sound and meets all checks
 *  - degraded:    artifact has warnings (e.g. low sample count, missing optional fields)
 *  - blocked:     artifact has errors (missing required files, wrong columns, invalid values)
 *  - unavailable: cannot validate (missing context, validator not applicable)
 */

const vr = require('./loop-validator-registry');

const {
  VALIDATOR_TYPES,
  VALIDATOR_STATUSES,
  FINDING_SEVERITIES,
  registerValidator,
  buildResult,
  buildUnavailableResult,
} = vr;

// ---------------------------------------------------------------------------
// 1. input-snapshot validator
// ---------------------------------------------------------------------------

const INPUT_SNAPSHOT_DEF = {
  id: 'input-snapshot',
  name: 'Input File Snapshot Validator',
  version: '1.0.0',
  type: VALIDATOR_TYPES.INPUT_SNAPSHOT,
  applicableKinds: ['file', 'data'],
  applicableArtifactTypes: [],
  priority: 20,

  validate(artifact, context) {
    const { dagNode } = context;
    const findings = [];

    if (!artifact || typeof artifact !== 'object') {
      return buildUnavailableResult('input-snapshot', '1.0.0', 'no_artifact');
    }

    const filename = artifact.filename || artifact.name || artifact.id || '';
    const sizeBytes = artifact.sizeBytes || artifact.size || 0;
    const sha256 = artifact.sha256 || artifact.hash || null;

    if (sizeBytes === 0) {
      findings.push({ code: 'INPUT_FILE_EMPTY', message: `Input file '${filename}' is empty (0 bytes)`, severity: FINDING_SEVERITIES.ERROR });
    }

    if (sha256 !== null) {
      if (typeof sha256 !== 'string' || sha256.length !== 64 || !/^[a-f0-9]{64}$/i.test(sha256)) {
        findings.push({ code: 'INPUT_HASH_INVALID', message: `Input hash for '${filename}' is not a valid SHA-256 hex (64 chars)`, severity: FINDING_SEVERITIES.ERROR });
      }
    }

    if (dagNode && Array.isArray(dagNode.requiredInputs)) {
      const requiredInputs = dagNode.requiredInputs.map(String);
      const artifactInputName = String(artifact.inputRole || artifact.id || filename).toLowerCase();
      const matches = requiredInputs.some(
        (req) => artifactInputName.includes(req.toLowerCase()) || req.toLowerCase().includes(artifactInputName),
      );
      if (!matches && requiredInputs.length > 0) {
        findings.push({
          code: 'INPUT_NOT_IN_REQUIRED_LIST',
          message: `Input artifact '${artifactInputName}' does not match any declared required input: ${requiredInputs.join(', ')}`,
          severity: FINDING_SEVERITIES.WARNING,
          context: { requiredInputs, artifactInputName },
        });
      }
    }

    const status = findings.some((f) => f.severity === FINDING_SEVERITIES.ERROR)
      ? VALIDATOR_STATUSES.BLOCKED
      : findings.length > 0
        ? VALIDATOR_STATUSES.DEGRADED
        : VALIDATOR_STATUSES.VALID;

    return buildResult({
      validatorId: 'input-snapshot',
      version: '1.0.0',
      status,
      findings,
      detail: findings.length > 0 ? findings.map((f) => f.message).join('; ') : null,
    });
  },
};

// ---------------------------------------------------------------------------
// 2. metadata-consistency validator
// ---------------------------------------------------------------------------

const METADATA_CONSISTENCY_DEF = {
  id: 'metadata-consistency',
  name: 'Metadata Schema Consistency Validator',
  version: '1.0.0',
  type: VALIDATOR_TYPES.ARTIFACT_SCHEMA,
  applicableKinds: ['metadata'],
  applicableArtifactTypes: [],
  priority: 30,

  validate(artifact, context) {
    const findings = [];
    if (!artifact || typeof artifact !== 'object') {
      return buildUnavailableResult('metadata-consistency', '1.0.0', 'no_artifact');
    }

    const filename = artifact.filename || artifact.name || '';
    const rows = artifact.rows || artifact.data || artifact.content || null;
    const columns = artifact.columns || artifact.header || null;

    let colNames = Array.isArray(columns) ? columns : null;
    if (!colNames && Array.isArray(rows) && rows.length > 0) {
      if (Array.isArray(rows[0])) colNames = rows[0].map((_, i) => `col_${i}`);
      else if (typeof rows[0] === 'object') colNames = Object.keys(rows[0]);
    }

    if (!colNames || colNames.length === 0) {
      findings.push({
        code: 'METADATA_NO_COLUMNS',
        message: `Metadata '${filename}' has no identifiable columns`,
        severity: FINDING_SEVERITIES.ERROR,
      });
      return buildResult({ validatorId: 'metadata-consistency', version: '1.0.0', status: VALIDATOR_STATUSES.BLOCKED, findings });
    }

    const REQUIRED_META_COLS = ['sample_id', 'sample', 'sampleName'];
    const lowerCols = colNames.map((c) => String(c).toLowerCase());
    const hasSampleId = REQUIRED_META_COLS.some((r) => lowerCols.includes(r));
    if (!hasSampleId) {
      findings.push({
        code: 'METADATA_MISSING_SAMPLE_ID',
        message: `Metadata '${filename}' lacks a sample ID column. Expected one of: ${REQUIRED_META_COLS.join(', ')}`,
        severity: FINDING_SEVERITIES.ERROR,
        context: { columns: colNames },
      });
    }

    const seen = new Set();
    for (const col of colNames) {
      const key = String(col).toLowerCase();
      if (seen.has(key)) {
        findings.push({ code: 'METADATA_DUPLICATE_COLUMNS', message: `Metadata has duplicate column name: '${col}'`, severity: FINDING_SEVERITIES.ERROR });
      }
      seen.add(key);
    }

    if (Array.isArray(rows) && rows.length < 2) {
      findings.push({ code: 'METADATA_TOO_FEW_ROWS', message: `Metadata '${filename}' has fewer than 2 rows`, severity: FINDING_SEVERITIES.WARNING });
    }

    if (context.expectedColumns && Array.isArray(context.expectedColumns)) {
      for (const expCol of context.expectedColumns) {
        if (!lowerCols.includes(String(expCol).toLowerCase())) {
          findings.push({
            code: 'METADATA_MISSING_EXPECTED_COLUMN',
            message: `Metadata '${filename}' is missing expected column: '${expCol}'`,
            severity: FINDING_SEVERITIES.WARNING,
            context: { expectedColumn: expCol },
          });
        }
      }
    }

    const status = findings.some((f) => f.severity === FINDING_SEVERITIES.ERROR)
      ? VALIDATOR_STATUSES.BLOCKED
      : findings.length > 0
        ? VALIDATOR_STATUSES.DEGRADED
        : VALIDATOR_STATUSES.VALID;

    return buildResult({
      validatorId: 'metadata-consistency',
      version: '1.0.0',
      status,
      findings,
      detail: findings.length > 0 ? findings.map((f) => f.message).join('; ') : null,
    });
  },
};

// ---------------------------------------------------------------------------
// 3. counts-matrix validator
// ---------------------------------------------------------------------------

const COUNTS_MATRIX_DEF = {
  id: 'counts-matrix',
  name: 'Counts Matrix Validator',
  version: '1.0.0',
  type: VALIDATOR_TYPES.ARTIFACT_SCHEMA,
  applicableKinds: ['counts'],
  applicableArtifactTypes: [],
  priority: 40,

  validate(artifact, context) {
    const findings = [];
    if (!artifact || typeof artifact !== 'object') {
      return buildUnavailableResult('counts-matrix', '1.0.0', 'no_artifact');
    }

    const filename = artifact.filename || artifact.name || '';
    const data = artifact.data || artifact.values || artifact.matrix || artifact.content || null;

    if (!Array.isArray(data)) {
      findings.push({ code: 'COUNTS_NO_DATA', message: `Counts matrix '${filename}' has no data array`, severity: FINDING_SEVERITIES.ERROR });
      return buildResult({ validatorId: 'counts-matrix', version: '1.0.0', status: VALIDATOR_STATUSES.BLOCKED, findings });
    }

    const nRows = data.length;
    if (nRows < 10) {
      findings.push({ code: 'COUNTS_TOO_FEW_ROWS', message: `Counts matrix '${filename}' has fewer than 10 rows (${nRows})`, severity: FINDING_SEVERITIES.WARNING });
    }

    if (nRows > 0) {
      const nCols = Array.isArray(data[0]) ? data[0].length : typeof data[0] === 'object' ? Object.keys(data[0]).length : 0;
      if (nCols < 2) {
        findings.push({ code: 'COUNTS_TOO_FEW_COLUMNS', message: `Counts matrix '${filename}' has fewer than 2 columns`, severity: FINDING_SEVERITIES.ERROR });
      }

      for (let i = 0; i < Math.min(nRows, 100); i++) {
        const row = data[i];
        if (Array.isArray(row)) {
          for (let j = 0; j < row.length; j++) {
            const val = row[j];
            if (val !== null && val !== undefined && isNaN(Number(val))) {
              findings.push({ code: 'COUNTS_NON_NUMERIC', message: `Non-numeric value at [${i},${j}]: ${val}`, severity: FINDING_SEVERITIES.ERROR });
            } else if (Number(val) < 0) {
              findings.push({ code: 'COUNTS_NEGATIVE_VALUE', message: `Negative count at [${i},${j}]: ${val}`, severity: FINDING_SEVERITIES.ERROR });
            }
          }
        }
      }
    }

    if (context.expectedGenes && Number(context.expectedGenes) > 0 && nRows < Number(context.expectedGenes) * 0.8) {
      findings.push({ code: 'COUNTS_ROW_COUNT_LOW', message: `Counts matrix has fewer rows (${nRows}) than expected (${context.expectedGenes})`, severity: FINDING_SEVERITIES.WARNING });
    }

    const status = findings.some((f) => f.severity === FINDING_SEVERITIES.ERROR)
      ? VALIDATOR_STATUSES.BLOCKED
      : findings.length > 0
        ? VALIDATOR_STATUSES.DEGRADED
        : VALIDATOR_STATUSES.VALID;

    return buildResult({
      validatorId: 'counts-matrix',
      version: '1.0.0',
      status,
      findings,
      detail: findings.length > 0 ? findings.slice(0, 5).map((f) => f.message).join('; ') : null,
    });
  },
};

// ---------------------------------------------------------------------------
// 4. de-results validator
// ---------------------------------------------------------------------------

const DE_RESULTS_DEF = {
  id: 'de-results',
  name: 'Differential Expression Results Validator',
  version: '1.0.0',
  type: VALIDATOR_TYPES.SCIENTIFIC,
  applicableKinds: ['de-results'],
  applicableArtifactTypes: [],
  priority: 50,

  validate(artifact, context) {
    const findings = [];
    if (!artifact || typeof artifact !== 'object') {
      return buildUnavailableResult('de-results', '1.0.0', 'no_artifact');
    }

    const filename = artifact.filename || artifact.name || '';
    const rows = artifact.rows || artifact.data || artifact.results || null;

    if (!Array.isArray(rows) || rows.length === 0) {
      findings.push({ code: 'DE_NO_RESULTS', message: `DE results '${filename}' has no result rows`, severity: FINDING_SEVERITIES.ERROR });
      return buildResult({ validatorId: 'de-results', version: '1.0.0', status: VALIDATOR_STATUSES.BLOCKED, findings });
    }

    const GENE_COLS = ['gene', 'gene_name', 'geneid', 'symbol'];
    const LOGFC_COLS = ['log2fc', 'logfc', 'log_fold_change'];
    const PVALUE_COLS = ['pvalue', 'p_value', 'pval'];
    const PADJ_COLS = ['padj', 'p_adj', 'adjusted_pvalue', 'fdr'];
    const firstRow = typeof rows[0] === 'object' ? rows[0] : {};
    const lowerKeys = Object.keys(firstRow).map((k) => k.toLowerCase());
    const hasGene = lowerKeys.some((k) => GENE_COLS.includes(k));
    const hasLogFC = lowerKeys.some((k) => LOGFC_COLS.includes(k));
    const hasPValue = lowerKeys.some((k) => PVALUE_COLS.includes(k));
    const hasPAdj = lowerKeys.some((k) => PADJ_COLS.includes(k));

    if (!hasGene) findings.push({ code: 'DE_MISSING_GENE_COLUMN', message: `DE results '${filename}' lacks a gene identifier column`, severity: FINDING_SEVERITIES.ERROR });
    if (!hasLogFC) findings.push({ code: 'DE_MISSING_LOGFC_COLUMN', message: `DE results '${filename}' lacks a log2FC / logFC column`, severity: FINDING_SEVERITIES.ERROR });
    if (!hasPValue && !hasPAdj) findings.push({ code: 'DE_MISSING_PVALUE', message: `DE results '${filename}' lacks both p-value and adjusted p-value columns`, severity: FINDING_SEVERITIES.ERROR });

    let significantCount = 0;
    for (let i = 0; i < Math.min(rows.length, 100); i++) {
      const row = rows[i];
      if (typeof row !== 'object') continue;
      for (const key of Object.keys(row)) {
        const lower = key.toLowerCase();
        const val = Number(row[key]);
        if (PADJ_COLS.includes(lower) && !isNaN(val) && val >= 0 && val <= 1) significantCount++;
        if (LOGFC_COLS.includes(lower) && Math.abs(val) > 20) {
          findings.push({ code: 'DE_EXTREME_LOGFC', message: `Extreme log2FC value at row ${i}: ${val}`, severity: FINDING_SEVERITIES.WARNING });
        }
      }
    }

    if (rows.length > 100 && significantCount === 0) {
      findings.push({ code: 'DE_NO_SIGNIFICANT_RESULTS', message: `DE results '${filename}' has ${rows.length} rows but zero significant entries detected`, severity: FINDING_SEVERITIES.WARNING });
    }

    const status = findings.some((f) => f.severity === FINDING_SEVERITIES.ERROR)
      ? VALIDATOR_STATUSES.BLOCKED
      : findings.length > 0
        ? VALIDATOR_STATUSES.DEGRADED
        : VALIDATOR_STATUSES.VALID;

    return buildResult({
      validatorId: 'de-results',
      version: '1.0.0',
      status,
      findings,
      detail: findings.length > 0 ? findings.map((f) => f.message).join('; ') : null,
    });
  },
};

// ---------------------------------------------------------------------------
// 5. heatmap-data validator
// ---------------------------------------------------------------------------

const HEATMAP_DATA_DEF = {
  id: 'heatmap-data',
  name: 'Heatmap Data Validator',
  version: '1.0.0',
  type: VALIDATOR_TYPES.ARTIFACT_SCHEMA,
  applicableKinds: ['heatmap'],
  applicableArtifactTypes: [],
  priority: 25,

  validate(artifact, context) {
    const findings = [];
    if (!artifact || typeof artifact !== 'object') {
      return buildUnavailableResult('heatmap-data', '1.0.0', 'no_artifact');
    }

    const filename = artifact.filename || artifact.name || '';
    const matrix = artifact.matrix || artifact.data || artifact.values || null;
    const rowAnnotations = artifact.rowAnnotations || artifact.rowLabels || artifact.geneMetadata || null;
    const colAnnotations = artifact.colAnnotations || artifact.colLabels || artifact.sampleMetadata || null;

    if (!Array.isArray(matrix) || matrix.length === 0) {
      findings.push({ code: 'HEATMAP_NO_MATRIX', message: `Heatmap '${filename}' has no matrix data`, severity: FINDING_SEVERITIES.ERROR });
      return buildResult({ validatorId: 'heatmap-data', version: '1.0.0', status: VALIDATOR_STATUSES.BLOCKED, findings });
    }

    const nRows = matrix.length;
    const nCols = Array.isArray(matrix[0]) ? matrix[0].length : 0;

    if (nRows === 0 || nCols === 0) {
      findings.push({ code: 'HEATMAP_NO_COLUMNS', message: `Heatmap '${filename}' matrix has no columns`, severity: FINDING_SEVERITIES.ERROR });
    }

    if (nRows > 0 && nCols > 0 && (nRows < 2 || nCols < 2)) {
      findings.push({ code: 'HEATMAP_TOO_SMALL', message: `Heatmap matrix is ${nRows}x${nCols} (min 2x2)`, severity: FINDING_SEVERITIES.ERROR });
    }

    if (rowAnnotations && !Array.isArray(rowAnnotations)) {
      findings.push({ code: 'HEATMAP_ROW_ANNOTATIONS_INVALID', message: 'Row annotations must be an array', severity: FINDING_SEVERITIES.WARNING });
    }
    if (colAnnotations && !Array.isArray(colAnnotations)) {
      findings.push({ code: 'HEATMAP_COL_ANNOTATIONS_INVALID', message: 'Column annotations must be an array', severity: FINDING_SEVERITIES.WARNING });
    }

    for (let i = 0; i < Math.min(nRows, 50); i++) {
      const row = matrix[i];
      if (!Array.isArray(row)) continue;
      for (let j = 0; j < Math.min(row.length, 50); j++) {
        const val = Number(row[j]);
        if (isNaN(val)) {
          findings.push({ code: 'HEATMAP_NA_VALUE', message: `NaN value at [${i},${j}]`, severity: FINDING_SEVERITIES.WARNING });
        }
      }
    }

    const status = findings.some((f) => f.severity === FINDING_SEVERITIES.ERROR)
      ? VALIDATOR_STATUSES.BLOCKED
      : findings.length > 0
        ? VALIDATOR_STATUSES.DEGRADED
        : VALIDATOR_STATUSES.VALID;

    return buildResult({
      validatorId: 'heatmap-data',
      version: '1.0.0',
      status,
      findings,
      detail: findings.length > 0 ? findings.slice(0, 5).map((f) => f.message).join('; ') : null,
    });
  },
};

// ---------------------------------------------------------------------------
// 6. enrichment-statistics validator
// ---------------------------------------------------------------------------

const ENRICHMENT_STATISTICS_DEF = {
  id: 'enrichment-statistics',
  name: 'Enrichment Statistics Validator',
  version: '1.0.0',
  type: VALIDATOR_TYPES.SCIENTIFIC,
  applicableKinds: ['enrichment'],
  applicableArtifactTypes: [],
  priority: 50,

  validate(artifact, context) {
    const findings = [];
    if (!artifact || typeof artifact !== 'object') {
      return buildUnavailableResult('enrichment-statistics', '1.0.0', 'no_artifact');
    }

    const filename = artifact.filename || artifact.name || '';
    const rows = artifact.rows || artifact.data || artifact.results || null;

    if (!Array.isArray(rows) || rows.length === 0) {
      findings.push({ code: 'ENRICHMENT_NO_RESULTS', message: `Enrichment results '${filename}' has no result rows`, severity: FINDING_SEVERITIES.ERROR });
      return buildResult({ validatorId: 'enrichment-statistics', version: '1.0.0', status: VALIDATOR_STATUSES.BLOCKED, findings });
    }

    const REQUIRED_COLS = ['term', 'pathway', 'category', 'id'];
    const PVALUE_COLS = ['pvalue', 'p_value', 'pval', 'padj', 'p_adj'];
    const firstRow = typeof rows[0] === 'object' ? rows[0] : {};
    const lowerKeys = Object.keys(firstRow).map((k) => k.toLowerCase());
    const hasTerm = lowerKeys.some((k) => REQUIRED_COLS.map((c) => c.toLowerCase()).includes(k));
    const hasPValue = lowerKeys.some((k) => PVALUE_COLS.includes(k));

    if (!hasTerm) findings.push({ code: 'ENRICHMENT_MISSING_TERM_COLUMN', message: `Enrichment results '${filename}' lacks a term/pathway column`, severity: FINDING_SEVERITIES.ERROR });
    if (!hasPValue) findings.push({ code: 'ENRICHMENT_MISSING_PVALUE', message: `Enrichment results '${filename}' lacks a p-value column`, severity: FINDING_SEVERITIES.ERROR });

    let validPCount = 0;
    for (let i = 0; i < Math.min(rows.length, 50); i++) {
      const row = rows[i];
      if (typeof row !== 'object') continue;
      for (const key of Object.keys(row)) {
        if (PVALUE_COLS.includes(key.toLowerCase())) {
          const val = Number(row[key]);
          if (!isNaN(val) && val >= 0 && val <= 1) validPCount++;
          if (!isNaN(val) && (val < 0 || val > 1)) {
            findings.push({ code: 'ENRICHMENT_PVALUE_OUT_OF_RANGE', message: `P-value out of [0,1] at row ${i}: ${val}`, severity: FINDING_SEVERITIES.ERROR });
          }
        }
      }
    }

    if (rows.length > 20 && validPCount === 0) {
      findings.push({ code: 'ENRICHMENT_NO_VALID_PVALUES', message: `Enrichment results '${filename}' has ${rows.length} rows but no valid p-values`, severity: FINDING_SEVERITIES.ERROR });
    }

    const status = findings.some((f) => f.severity === FINDING_SEVERITIES.ERROR)
      ? VALIDATOR_STATUSES.BLOCKED
      : findings.length > 0
        ? VALIDATOR_STATUSES.DEGRADED
        : VALIDATOR_STATUSES.VALID;

    return buildResult({
      validatorId: 'enrichment-statistics',
      version: '1.0.0',
      status,
      findings,
      detail: findings.length > 0 ? findings.map((f) => f.message).join('; ') : null,
    });
  },
};

// ---------------------------------------------------------------------------
// 7. delivery-integrity validator
// ---------------------------------------------------------------------------

const DELIVERY_INTEGRITY_DEF = {
  id: 'delivery-integrity',
  name: 'Delivery Manifest Integrity Validator',
  version: '1.0.0',
  type: VALIDATOR_TYPES.DELIVERY_INTEGRITY,
  applicableKinds: ['json'],
  applicableArtifactTypes: [],
  priority: 60,

  validate(deliveryRecord, context) {
    const findings = [];
    if (!deliveryRecord || typeof deliveryRecord !== 'object') {
      return buildUnavailableResult('delivery-integrity', '1.0.0', 'no_delivery_record');
    }

    const filename = deliveryRecord.filename || 'delivery-manifest';
    const status = deliveryRecord.status;
    const version = deliveryRecord.deliveryManifestVersion || deliveryRecord.version || null;
    const artifacts = deliveryRecord.artifacts || [];
    const coverage = deliveryRecord.requirementCoverage || [];
    const artifactTruth = deliveryRecord.artifactTruth;

    if (!version) {
      findings.push({ code: 'DELIVERY_NO_VERSION', message: 'Delivery manifest has no version field', severity: FINDING_SEVERITIES.ERROR });
    }

    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      findings.push({ code: 'DELIVERY_NO_ARTIFACTS', message: 'Delivery manifest has no artifacts', severity: FINDING_SEVERITIES.ERROR });
    }

    for (let i = 0; i < artifacts.length; i++) {
      const a = artifacts[i];
      if (!a || typeof a !== 'object') {
        findings.push({ code: 'DELIVERY_ARTIFACT_INVALID', message: `Artifact at index ${i} is not an object`, severity: FINDING_SEVERITIES.ERROR });
        continue;
      }
      if (!a.id && !a.filename && !a.name) {
        findings.push({ code: 'DELIVERY_ARTIFACT_NO_ID', message: `Artifact at index ${i} has no id or filename`, severity: FINDING_SEVERITIES.ERROR });
      }
    }

    const uncovered = coverage.filter((c) => c.status !== 'satisfied');
    if (uncovered.length > 0) {
      findings.push({
        code: 'DELIVERY_REQUIREMENT_UNCOVERED',
        message: `${uncovered.length} requirement(s) not satisfied: ${uncovered.map((c) => c.requirement).join(', ')}`,
        severity: FINDING_SEVERITIES.ERROR,
        context: { uncoveredRequirements: uncovered.map((c) => c.requirement) },
      });
    }

    if (artifactTruth) {
      if (artifactTruth.status === 'blocked' || artifactTruth.blocking === true) {
        findings.push({ code: 'DELIVERY_ARTIFACT_TRUTH_BLOCKED', message: 'Artifact truth is blocked', severity: FINDING_SEVERITIES.ERROR });
      }
    }

    const overallStatus = status === 'blocked' || findings.some((f) => f.severity === FINDING_SEVERITIES.ERROR)
      ? VALIDATOR_STATUSES.BLOCKED
      : status === 'degraded' || findings.length > 0
        ? VALIDATOR_STATUSES.DEGRADED
        : VALIDATOR_STATUSES.VALID;

    return buildResult({
      validatorId: 'delivery-integrity',
      version: '1.0.0',
      status: overallStatus,
      findings,
      detail: findings.length > 0 ? findings.map((f) => f.message).join('; ') : null,
    });
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const BUILTIN_VALIDATOR_DEFS = [
  INPUT_SNAPSHOT_DEF,
  METADATA_CONSISTENCY_DEF,
  COUNTS_MATRIX_DEF,
  DE_RESULTS_DEF,
  HEATMAP_DATA_DEF,
  ENRICHMENT_STATISTICS_DEF,
  DELIVERY_INTEGRITY_DEF,
];

// Auto-register all built-ins on module load
for (const def of BUILTIN_VALIDATOR_DEFS) {
  registerValidator(def);
}

module.exports = { BUILTIN_VALIDATOR_DEFS };