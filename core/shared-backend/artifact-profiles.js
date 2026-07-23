/**
 * Artifact Profile Registry — biof3.*
 *
 * Machine-readable canonical profiles for scientific artifact types.
 * These define the typed contract between plugin outputs and downstream inputs.
 *
 * Profiles are versioned. Consumers MUST check schemaVersion before binding.
 *
 * @module artifact-profiles
 */

const ARTIFACT_PROFILES = {
  /**
   * biof3.deg.v1 — Differential Expression Gene table
   *
   * Produced by: deg-standardizer (canonical), deseq2 (direct, different column names)
   * Consumed by: volcano-plot, go-kegg, gsea, pca-explorer
   *
   * Canonical columns:
   *   gene            — gene identifier (symbol | ensembl | entrez)
   *   log2FoldChange — effect size (DESeq2 apeglm-shrunken)
   *   pvalue          — raw p-value
   *   padj            — adjusted p-value (Benjamini-Hochberg)
   *   source_method   — DESeq2 | limma | edgeR | other
   *   lineage        — parent artifact/job reference
   *   schema_version  — "v1"
   *
   * Optional columns (valid if present):
   *   direction   — "up" | "down" | "neutral"
   *   significant — true | false
   *   contrast    — human-readable comparison label (e.g., "KO_vs_WT")
   *
   * Invalid for production binding:
   *   - missing required columns
   *   - duplicate gene rows
   *   - all padj values are NA (no multiple testing correction possible)
   */
  'biof3.deg.v1': {
    profileId: 'biof3.deg.v1',
    version: 'v1',
    schemaVersion: 1,
    description: 'Canonical differential expression gene table',

    // Required columns: { name, type, nullable, description }
    requiredColumns: [
      { name: 'gene', type: 'string', nullable: false, description: 'Gene identifier (symbol/ensembl/entrez)' },
      { name: 'log2FoldChange', type: 'number', nullable: false, description: 'Effect size (log2 fold change)' },
      { name: 'pvalue', type: 'number', nullable: false, description: 'Raw p-value' },
      { name: 'padj', type: 'number', nullable: false, description: 'Adjusted p-value (Benjamini-Hochberg)' },
      { name: 'source_method', type: 'string', nullable: false, description: 'Statistical method (DESeq2|limma|edgeR|other)' },
    ],

    // Optional columns
    optionalColumns: [
      { name: 'direction', type: 'enum', values: ['up', 'down', 'neutral'], nullable: true },
      { name: 'significant', type: 'boolean', nullable: true },
      { name: 'contrast', type: 'string', nullable: true, description: 'Human-readable comparison label' },
      { name: 'gene_id_type', type: 'string', nullable: true },
    ],

    // Known non-canonical column aliases that must be mapped
    // Key = known alias, Value = canonical name
    knownColumnAliases: {
      'log2FC': 'log2FoldChange',
      'logFC': 'log2FoldChange',
      'avg_log2FC': 'log2FoldChange',
      'log2.Ratio': 'log2FoldChange',
      'padj': 'padj', // canonical name
      'p_adj': 'padj',
      'adj.P.Val': 'padj',
      'P.Value': 'pvalue',
      'p_val': 'pvalue',
      'gene_name': 'gene',
      'gene_symbol': 'gene',
      'Gene': 'gene',
    },

    // Producers: plugin IDs that emit this profile
    producers: ['deg-standardizer'],

    // Direct producers (emit profile but with different names — must use alias mapping)
    directProducers: ['deseq2'],

    // Consumers: plugin IDs that consume this profile
    consumers: ['volcano-plot', 'go-kegg', 'gsea', 'pca-explorer'],

    // Validation rules beyond column presence
    validationRules: [
      {
        rule: 'no_duplicate_genes',
        description: 'gene column must not contain duplicate entries',
        severity: 'error',
      },
      {
        rule: 'padj_not_all_na',
        description: 'padj column must not be entirely NA (multiple testing correction required)',
        severity: 'error',
      },
      {
        rule: 'log2fc_finite',
        description: 'log2FoldChange values must be finite (no Inf/-Inf)',
        severity: 'error',
      },
      {
        rule: 'pvalue_range',
        description: 'pvalue must be in [0, 1]',
        severity: 'error',
      },
      {
        rule: 'padj_range',
        description: 'padj must be in [0, 1]',
        severity: 'error',
      },
    ],

    // Provenance requirements
    provenance: {
      requiresParentJob: true,
      requiresInputHash: true,
      requiresScriptHash: true,
      requiresParamsHash: true,
    },
  },
};

/**
 * Get a profile by ID.
 * @param {string} profileId
 * @returns {object|null}
 */
function getProfile(profileId) {
  return ARTIFACT_PROFILES[profileId] || null;
}

/**
 * List all known profile IDs.
 * @returns {string[]}
 */
function listProfiles() {
  return Object.keys(ARTIFACT_PROFILES);
}

/**
 * Check if a plugin ID is a producer of a given profile.
 * @param {string} profileId
 * @param {string} pluginId
 * @returns {boolean}
 */
function isProducer(profileId, pluginId) {
  const p = ARTIFACT_PROFILES[profileId];
  if (!p) return false;
  return p.producers.includes(pluginId) || p.directProducers.includes(pluginId);
}

/**
 * Check if a plugin ID is a consumer of a given profile.
 * @param {string} profileId
 * @param {string} pluginId
 * @returns {boolean}
 */
function isConsumer(profileId, pluginId) {
  const p = ARTIFACT_PROFILES[profileId];
  if (!p) return false;
  return p.consumers.includes(pluginId);
}

/**
 * Resolve a column name to its canonical form using known aliases.
 * Returns the canonical name or the original name if not an alias.
 * @param {string} profileId
 * @param {string} columnName
 * @returns {string}
 */
function resolveCanonicalColumn(profileId, columnName) {
  const p = ARTIFACT_PROFILES[profileId];
  if (!p) return columnName;
  return p.knownColumnAliases[columnName] || columnName;
}

/**
 * Validate a CSV column set against a profile.
 * Returns { valid: boolean, errors: string[], warnings: string[] }
 * @param {string} profileId
 * @param {string[]} columnNames
 * @returns {object}
 */
function validateColumnSchema(profileId, columnNames) {
  const p = ARTIFACT_PROFILES[profileId];
  if (!p) {
    return { valid: false, errors: [`Unknown profile: ${profileId}`], warnings: [] };
  }

  const errors = [];
  const warnings = [];
  const present = new Set(columnNames);

  // Check required columns
  for (const col of p.requiredColumns) {
    if (!present.has(col.name)) {
      // Check if it's available under an alias
      const aliases = Object.entries(p.knownColumnAliases)
        .filter(([, canon]) => canon === col.name)
        .map(([alias]) => alias);
      const availableAlias = aliases.find(a => present.has(a));
      if (!availableAlias) {
        errors.push(`Missing required column '${col.name}'`);
      } else {
        warnings.push(`Column '${availableAlias}' maps to canonical '${col.name}'`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = {
  ARTIFACT_PROFILES,
  getProfile,
  listProfiles,
  isProducer,
  isConsumer,
  resolveCanonicalColumn,
  validateColumnSchema,
};
