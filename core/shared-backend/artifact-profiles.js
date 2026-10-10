'use strict';

/**
 * Scientific Data / Artifact Profile Registry — SDC-0.
 *
 * This module is the canonical, machine-readable vocabulary for typed
 * scientific data edges. It describes semantics and validation contracts; it
 * does not inspect user files, infer scientific meaning, run adapters, or
 * create a second Job/Artifact truth system.
 */

const crypto = require('crypto');

const ARTIFACT_PROFILE_REGISTRY_VERSION = 1;
const PROFILE_KINDS = Object.freeze(['data', 'artifact', 'display']);
const PROFILE_LIFECYCLE_STATUSES = Object.freeze(['active', 'deprecated']);
const PROFILE_COMPATIBILITY_STATUSES = Object.freeze([
  'compatible',
  'migration_required',
  'blocked',
]);
const PROFILE_CHANGE_CLASSES = Object.freeze(['compatible', 'migration', 'breaking']);
const PROFILE_ID_RE = /^(petri\.[a-z0-9]+(?:-[a-z0-9]+)*)\.v([1-9]\d*)$/;

const DEFAULT_PROVENANCE = Object.freeze({
  requiresParentJob: true,
  requiresInputHash: true,
  requiresScriptHash: true,
  requiresParamsHash: true,
});

const DEFAULT_LIFECYCLE = Object.freeze({
  status: 'active',
  deprecatedBy: null,
  deprecationReason: null,
});

const DEFAULT_COMPATIBILITY_POLICY = Object.freeze({
  exactVersion: 'compatible',
  newerVersion: 'migration_required',
  olderVersion: 'blocked',
  differentFamily: 'blocked',
  unknownVersion: 'blocked',
  identityDrift: 'breaking',
});

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalStringify(value[key])}`
  )).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(
    typeof value === 'string' ? value : canonicalStringify(value)
  ).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function column(name, type, nullable, extra = {}) {
  return { name, type, nullable, ...extra };
}

function rule(ruleId, description, severity = 'error') {
  return { rule: ruleId, description, severity };
}

function defineProfile(definition) {
  return {
    registryContractVersion: ARTIFACT_PROFILE_REGISTRY_VERSION,
    version: 'v1',
    schemaVersion: 1,
    lifecycle: { ...DEFAULT_LIFECYCLE },
    compatibilityPolicy: { ...DEFAULT_COMPATIBILITY_POLICY },
    provenance: { ...DEFAULT_PROVENANCE },
    requiredColumns: [],
    optionalColumns: [],
    knownColumnAliases: {},
    identifierNamespaces: [],
    producers: [],
    directProducers: [],
    consumers: [],
    validationRules: [],
    ...definition,
  };
}

const ARTIFACT_PROFILES = {
  'petri.counts-matrix.v1': defineProfile({
    profileId: 'petri.counts-matrix.v1',
    familyId: 'petri.counts-matrix',
    profileKind: 'data',
    description: 'Canonical raw integer count matrix',
    scientificMeaning: 'Untransformed non-negative integer feature counts measured for biological samples',
    granularity: 'feature_by_sample',
    orientation: 'rows_features_columns_samples',
    requiredColumns: [
      column('gene', 'string', false, { role: 'feature_identifier' }),
    ],
    optionalColumns: [],
    knownColumnAliases: {
      gene_id: 'gene',
      gene_name: 'gene',
      Gene: 'gene',
    },
    identifierNamespaces: ['symbol', 'ensembl', 'entrez', 'custom_declared'],
    validationRules: [
      rule('feature_ids_unique', 'feature identifier values must be unique'),
      rule('sample_columns_present', 'at least one sample value column is required'),
      rule('counts_non_negative_integer', 'all measured values must be finite non-negative integers'),
      rule('sample_names_unique', 'sample column names must be unique'),
    ],
    consumers: ['sample-metadata-validator', 'deseq2', 'expression-qc'],
  }),

  'petri.sample-metadata.v1': defineProfile({
    profileId: 'petri.sample-metadata.v1',
    familyId: 'petri.sample-metadata',
    profileKind: 'data',
    description: 'Canonical sample metadata and scientific design table',
    scientificMeaning: 'One row per biological sample with explicit sample identity and experimental condition',
    granularity: 'sample',
    orientation: 'rows_samples_columns_attributes',
    requiredColumns: [
      column('sample', 'string', false, { role: 'sample_identifier' }),
      column('condition', 'string', false, { role: 'experimental_condition' }),
    ],
    optionalColumns: [
      column('batch', 'string', true, { role: 'batch_factor' }),
      column('pair_id', 'string', true, { role: 'pairing_identifier' }),
      column('subject_id', 'string', true, { role: 'biological_subject_identifier' }),
    ],
    knownColumnAliases: {
      sample_id: 'sample',
      Sample: 'sample',
      group: 'condition',
      Group: 'condition',
      status: 'condition',
      treatment: 'condition',
    },
    identifierNamespaces: ['sample_name', 'project_sample_id'],
    validationRules: [
      rule('sample_ids_unique', 'sample identifiers must be unique'),
      rule('condition_not_missing', 'condition must be present for every admitted sample'),
      rule('condition_levels_explicit', 'reference and treatment levels require an explicit scientific decision'),
      rule('sample_overlap_required', 'sample identifiers must overlap the bound measurement matrix'),
    ],
    producers: ['sample-metadata-validator'],
    consumers: ['deseq2', 'pca-explorer', 'wgcna'],
  }),

  'petri.expression-matrix.v1': defineProfile({
    profileId: 'petri.expression-matrix.v1',
    familyId: 'petri.expression-matrix',
    profileKind: 'data',
    description: 'Canonical normalized expression matrix',
    scientificMeaning: 'Finite continuous abundance values with an explicitly declared normalization and scale',
    granularity: 'feature_by_sample',
    orientation: 'rows_features_columns_samples',
    requiredColumns: [
      column('gene', 'string', false, { role: 'feature_identifier' }),
    ],
    optionalColumns: [],
    knownColumnAliases: {
      gene_id: 'gene',
      gene_name: 'gene',
      Gene: 'gene',
    },
    identifierNamespaces: ['symbol', 'ensembl', 'entrez', 'custom_declared'],
    validationRules: [
      rule('feature_ids_unique', 'feature identifier values must be unique'),
      rule('sample_columns_present', 'at least one sample value column is required'),
      rule('expression_values_finite', 'all admitted expression values must be finite'),
      rule('normalization_declared', 'normalization method and scale must be declared'),
      rule('not_raw_counts', 'raw integer counts cannot be relabelled as normalized expression'),
    ],
    producers: ['expression-qc'],
    consumers: ['pca-explorer', 'gene-correlation', 'wgcna'],
  }),

  'petri.deg.v1': defineProfile({
    profileId: 'petri.deg.v1',
    familyId: 'petri.deg',
    profileKind: 'artifact',
    description: 'Canonical differential expression gene table',
    scientificMeaning: 'Per-gene effect size and multiplicity-controlled statistical evidence for one explicit contrast',
    granularity: 'gene_by_contrast',
    orientation: 'rows_genes_columns_statistics',
    requiredColumns: [
      column('gene', 'string', false, { description: 'Gene identifier (symbol/ensembl/entrez)' }),
      column('log2FoldChange', 'number', false, { description: 'Effect size (log2 fold change)' }),
      column('pvalue', 'number', false, { description: 'Raw p-value', minimum: 0, maximum: 1 }),
      column('padj', 'number', false, { description: 'Adjusted p-value', minimum: 0, maximum: 1 }),
      column('source_method', 'string', false, { description: 'Statistical method' }),
    ],
    optionalColumns: [
      column('direction', 'enum', true, { values: ['up', 'down', 'neutral'] }),
      column('significant', 'boolean', true),
      column('contrast', 'string', true, { description: 'Human-readable comparison label' }),
      column('gene_id_type', 'string', true),
    ],
    knownColumnAliases: {
      log2FC: 'log2FoldChange',
      logFC: 'log2FoldChange',
      avg_log2FC: 'log2FoldChange',
      'log2.Ratio': 'log2FoldChange',
      padj: 'padj',
      p_adj: 'padj',
      'adj.P.Val': 'padj',
      'P.Value': 'pvalue',
      p_val: 'pvalue',
      gene_name: 'gene',
      gene_symbol: 'gene',
      Gene: 'gene',
    },
    identifierNamespaces: ['symbol', 'ensembl', 'entrez', 'custom_declared'],
    producers: ['deg-standardizer'],
    directProducers: ['deseq2'],
    consumers: ['volcano-plot', 'go-kegg', 'gsea', 'pca-explorer'],
    validationRules: [
      rule('no_duplicate_genes', 'gene column must not contain duplicate entries'),
      rule('padj_not_all_na', 'padj cannot be entirely missing'),
      rule('log2fc_finite', 'log2FoldChange values must be finite'),
      rule('pvalue_range', 'pvalue must be in [0, 1]'),
      rule('padj_range', 'padj must be in [0, 1]'),
      rule('contrast_explicit', 'the scientific contrast must be explicit in provenance'),
    ],
  }),

  'petri.gene-list.v1': defineProfile({
    profileId: 'petri.gene-list.v1',
    familyId: 'petri.gene-list',
    profileKind: 'artifact',
    description: 'Canonical gene set or ranked gene list',
    scientificMeaning: 'A declared set or deterministic ranking of gene identifiers derived from a scientific artifact',
    granularity: 'gene',
    orientation: 'rows_genes_columns_annotations',
    requiredColumns: [
      column('gene', 'string', false, { role: 'gene_identifier' }),
    ],
    optionalColumns: [
      column('score', 'number', true, { role: 'ranking_score' }),
      column('rank', 'integer', true),
      column('direction', 'enum', true, { values: ['up', 'down', 'neutral'] }),
      column('gene_id_type', 'string', true),
    ],
    knownColumnAliases: {
      gene_id: 'gene',
      gene_symbol: 'gene',
      SYMBOL: 'gene',
      log2FoldChange: 'score',
      log2FC: 'score',
    },
    identifierNamespaces: ['symbol', 'ensembl', 'entrez', 'custom_declared'],
    producers: ['deg-standardizer', 'gene-correlation', 'wgcna'],
    consumers: ['go-kegg', 'gsea'],
    validationRules: [
      rule('gene_ids_not_missing', 'gene identifiers cannot be missing'),
      rule('gene_ids_unique', 'gene identifiers must be unique after deterministic deduplication'),
      rule('identifier_namespace_declared', 'gene identifier namespace must be declared'),
      rule('rank_scores_finite', 'ranking scores, when present, must be finite'),
    ],
  }),

  'petri.enrichment-table.v1': defineProfile({
    profileId: 'petri.enrichment-table.v1',
    familyId: 'petri.enrichment-table',
    profileKind: 'artifact',
    description: 'Canonical functional enrichment result table',
    scientificMeaning: 'Per-term enrichment statistics tied to a declared gene universe, database and analysis method',
    granularity: 'enriched_term',
    orientation: 'rows_terms_columns_statistics',
    requiredColumns: [
      column('term_id', 'string', false, { role: 'term_identifier' }),
      column('description', 'string', false),
      column('pvalue', 'number', false, { minimum: 0, maximum: 1 }),
      column('p_adjust', 'number', false, { minimum: 0, maximum: 1 }),
      column('gene_ids', 'string', false),
    ],
    optionalColumns: [
      column('gene_ratio', 'string', true),
      column('background_ratio', 'string', true),
      column('count', 'integer', true),
      column('direction', 'enum', true, { values: ['up', 'down', 'all', 'not_applicable'] }),
      column('database', 'string', true),
    ],
    knownColumnAliases: {
      ID: 'term_id',
      Description: 'description',
      pvalue: 'pvalue',
      p_adjust: 'p_adjust',
      pvalue_adjust: 'p_adjust',
      p_adjusted: 'p_adjust',
      'p.adjust': 'p_adjust',
      geneID: 'gene_ids',
      GeneRatio: 'gene_ratio',
      BgRatio: 'background_ratio',
      Count: 'count',
    },
    identifierNamespaces: ['go', 'kegg', 'reactome', 'msigdb', 'custom_declared'],
    producers: ['go-kegg', 'gsea'],
    consumers: [],
    validationRules: [
      rule('term_ids_not_missing', 'term identifiers cannot be missing'),
      rule('term_ids_unique', 'term identifiers must be unique within database and direction'),
      rule('pvalue_range', 'pvalue must be in [0, 1]'),
      rule('p_adjust_range', 'adjusted p-value must be in [0, 1]'),
      rule('database_declared', 'source database and version must be declared in provenance'),
      rule('empty_result_is_valid', 'a verified empty enrichment result is scientifically valid'),
    ],
  }),
};

deepFreeze(ARTIFACT_PROFILES);

function parseProfileIdentity(profileId) {
  const match = PROFILE_ID_RE.exec(String(profileId || '').trim());
  if (!match) return null;
  return {
    profileId: match[0],
    familyId: match[1],
    version: `v${match[2]}`,
    majorVersion: Number(match[2]),
  };
}

function validateColumns(columns, path, errors) {
  if (!Array.isArray(columns)) {
    errors.push(`${path}_must_be_array`);
    return;
  }
  const names = new Set();
  for (const [index, entry] of columns.entries()) {
    if (!entry || typeof entry !== 'object') {
      errors.push(`${path}_${index}_invalid`);
      continue;
    }
    if (typeof entry.name !== 'string' || !entry.name.trim()) errors.push(`${path}_${index}_name_required`);
    if (typeof entry.type !== 'string' || !entry.type.trim()) errors.push(`${path}_${index}_type_required`);
    if (typeof entry.nullable !== 'boolean') errors.push(`${path}_${index}_nullable_required`);
    if (names.has(entry.name)) errors.push(`${path}_${index}_duplicate_name`);
    names.add(entry.name);
  }
}

function validateProfileDefinition(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { valid: false, errors: ['profile_definition_required'] };
  }

  const identity = parseProfileIdentity(profile.profileId);
  if (!identity) errors.push('profile_id_invalid');
  if (identity && profile.familyId !== identity.familyId) errors.push('profile_family_mismatch');
  if (identity && profile.version !== identity.version) errors.push('profile_version_mismatch');
  if (identity && Number(profile.schemaVersion) !== identity.majorVersion) errors.push('profile_schema_version_mismatch');
  if (profile.registryContractVersion !== ARTIFACT_PROFILE_REGISTRY_VERSION) errors.push('registry_contract_version_mismatch');
  if (!PROFILE_KINDS.includes(profile.profileKind)) errors.push('profile_kind_invalid');
  for (const field of ['description', 'scientificMeaning', 'granularity', 'orientation']) {
    if (typeof profile[field] !== 'string' || !profile[field].trim()) errors.push(`${field}_required`);
  }

  validateColumns(profile.requiredColumns, 'required_columns', errors);
  validateColumns(profile.optionalColumns, 'optional_columns', errors);
  const allColumnNames = new Set([
    ...(profile.requiredColumns || []).map((entry) => entry?.name),
    ...(profile.optionalColumns || []).map((entry) => entry?.name),
  ]);
  for (const [alias, target] of Object.entries(profile.knownColumnAliases || {})) {
    if (!alias || !allColumnNames.has(target)) errors.push(`column_alias_invalid:${alias}`);
  }

  if (!Array.isArray(profile.identifierNamespaces) || profile.identifierNamespaces.length === 0) {
    errors.push('identifier_namespaces_required');
  }
  if (!Array.isArray(profile.validationRules) || profile.validationRules.length === 0) {
    errors.push('validation_rules_required');
  } else {
    const ruleIds = new Set();
    for (const entry of profile.validationRules) {
      if (!entry?.rule || !entry?.description || !['error', 'warning'].includes(entry?.severity)) {
        errors.push('validation_rule_invalid');
      }
      if (ruleIds.has(entry?.rule)) errors.push(`validation_rule_duplicate:${entry?.rule}`);
      ruleIds.add(entry?.rule);
    }
  }

  if (!profile.lifecycle || !PROFILE_LIFECYCLE_STATUSES.includes(profile.lifecycle.status)) {
    errors.push('profile_lifecycle_invalid');
  }
  if (profile.lifecycle?.status === 'deprecated' && !parseProfileIdentity(profile.lifecycle.deprecatedBy)) {
    errors.push('deprecated_profile_replacement_required');
  }
  if (!profile.compatibilityPolicy || profile.compatibilityPolicy.unknownVersion !== 'blocked') {
    errors.push('compatibility_policy_fail_closed_required');
  }
  for (const key of ['requiresParentJob', 'requiresInputHash', 'requiresScriptHash', 'requiresParamsHash']) {
    if (typeof profile.provenance?.[key] !== 'boolean') errors.push(`provenance_${key}_required`);
  }
  for (const field of ['producers', 'directProducers', 'consumers']) {
    if (!Array.isArray(profile[field])) errors.push(`${field}_must_be_array`);
  }

  return { valid: errors.length === 0, errors };
}

function registryValues(profiles) {
  if (Array.isArray(profiles)) return profiles;
  if (profiles && typeof profiles === 'object') return Object.values(profiles);
  return [];
}

function validateProfileRegistry(profiles = ARTIFACT_PROFILES) {
  const errors = [];
  const entries = registryValues(profiles);
  const identities = new Set();
  for (const profile of entries) {
    const result = validateProfileDefinition(profile);
    for (const error of result.errors) errors.push(`${profile?.profileId || 'unknown'}:${error}`);
    const identityKey = `${profile?.familyId || ''}:${profile?.schemaVersion || ''}`;
    if (identities.has(identityKey)) errors.push(`${profile?.profileId || 'unknown'}:duplicate_family_version`);
    identities.add(identityKey);
  }
  if (!Array.isArray(profiles) && profiles && typeof profiles === 'object') {
    for (const [key, profile] of Object.entries(profiles)) {
      if (key !== profile?.profileId) errors.push(`${key}:registry_key_profile_id_mismatch`);
    }
  }
  const registryDigest = sha256(entries
    .slice()
    .sort((a, b) => String(a.profileId).localeCompare(String(b.profileId))));
  return {
    valid: errors.length === 0,
    errors,
    registryVersion: ARTIFACT_PROFILE_REGISTRY_VERSION,
    profileCount: entries.length,
    registryDigest,
  };
}

function getProfile(profileId) {
  return ARTIFACT_PROFILES[profileId] || null;
}

function listProfiles() {
  return Object.keys(ARTIFACT_PROFILES).sort();
}

function isRegisteredProfile(profileId) {
  return Object.prototype.hasOwnProperty.call(ARTIFACT_PROFILES, profileId);
}

function getProfileIdentity(profileId) {
  const profile = getProfile(profileId);
  const identity = parseProfileIdentity(profileId);
  if (!profile || !identity) return null;
  return Object.freeze({
    ...identity,
    lifecycleStatus: profile.lifecycle.status,
    registryContractVersion: profile.registryContractVersion,
    contractDigest: sha256(profile),
  });
}

function sameColumnContract(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

function arrayContainsContracts(nextEntries, previousEntries, key) {
  const nextByKey = new Map(nextEntries.map((entry) => [entry[key], entry]));
  return previousEntries.every((entry) => sameColumnContract(nextByKey.get(entry[key]), entry));
}

function classifyProfileChange(previousProfile, nextProfile) {
  const previousValidation = validateProfileDefinition(previousProfile);
  const nextValidation = validateProfileDefinition(nextProfile);
  const base = {
    fromProfileId: previousProfile?.profileId || null,
    toProfileId: nextProfile?.profileId || null,
  };
  if (!previousValidation.valid || !nextValidation.valid) {
    return { ...base, changeClass: 'breaking', reason: 'profile_contract_invalid' };
  }

  const previousIdentity = parseProfileIdentity(previousProfile.profileId);
  const nextIdentity = parseProfileIdentity(nextProfile.profileId);
  if (previousProfile.profileId === nextProfile.profileId) {
    if (sha256(previousProfile) === sha256(nextProfile)) {
      return { ...base, changeClass: 'compatible', reason: 'contract_unchanged' };
    }
    return { ...base, changeClass: 'breaking', reason: 'profile_identity_reused_with_contract_drift' };
  }
  if (
    previousIdentity.familyId !== nextIdentity.familyId
    || nextIdentity.majorVersion <= previousIdentity.majorVersion
  ) {
    return { ...base, changeClass: 'breaking', reason: 'profile_identity_or_version_incompatible' };
  }

  for (const field of ['profileKind', 'scientificMeaning', 'granularity', 'orientation']) {
    if (previousProfile[field] !== nextProfile[field]) {
      return { ...base, changeClass: 'breaking', reason: `scientific_contract_changed:${field}` };
    }
  }
  if (!sameColumnContract(previousProfile.identifierNamespaces, nextProfile.identifierNamespaces)) {
    return { ...base, changeClass: 'breaking', reason: 'identifier_namespace_contract_changed' };
  }
  if (!sameColumnContract(previousProfile.requiredColumns, nextProfile.requiredColumns)) {
    return { ...base, changeClass: 'migration', reason: 'required_schema_changed' };
  }
  if (!arrayContainsContracts(nextProfile.optionalColumns, previousProfile.optionalColumns, 'name')) {
    return { ...base, changeClass: 'migration', reason: 'existing_optional_schema_changed' };
  }
  if (!arrayContainsContracts(nextProfile.validationRules, previousProfile.validationRules, 'rule')) {
    return { ...base, changeClass: 'migration', reason: 'validation_contract_changed' };
  }
  for (const [alias, target] of Object.entries(previousProfile.knownColumnAliases)) {
    if (nextProfile.knownColumnAliases[alias] !== target) {
      return { ...base, changeClass: 'migration', reason: 'column_alias_removed_or_changed' };
    }
  }
  return { ...base, changeClass: 'compatible', reason: 'additive_contract_change' };
}

function resolveProfileCompatibility(sourceProfileId, targetProfileId, options = {}) {
  const source = getProfile(sourceProfileId);
  const target = getProfile(targetProfileId);
  const result = {
    status: 'blocked',
    reason: 'unknown_profile',
    sourceProfileId,
    targetProfileId,
    migrationId: null,
  };
  if (!source || !target) return result;
  if (sourceProfileId === targetProfileId) {
    return { ...result, status: 'compatible', reason: 'exact_profile_match' };
  }
  if (source.familyId !== target.familyId) {
    return { ...result, reason: 'profile_family_mismatch' };
  }

  const sourceIdentity = parseProfileIdentity(sourceProfileId);
  const targetIdentity = parseProfileIdentity(targetProfileId);
  if (targetIdentity.majorVersion <= sourceIdentity.majorVersion) {
    return { ...result, reason: 'profile_downgrade_blocked' };
  }
  const migration = (options.migrations || []).find((entry) => (
    entry?.sourceProfileId === sourceProfileId
    && entry?.targetProfileId === targetProfileId
    && typeof entry?.migrationId === 'string'
    && typeof entry?.scriptRef === 'string'
  ));
  if (!migration) return { ...result, reason: 'migration_missing' };
  return {
    ...result,
    status: 'migration_required',
    reason: 'registered_migration_required',
    migrationId: migration.migrationId,
  };
}

function isProducer(profileId, pluginId) {
  const profile = getProfile(profileId);
  if (!profile) return false;
  return profile.producers.includes(pluginId) || profile.directProducers.includes(pluginId);
}

function isConsumer(profileId, pluginId) {
  const profile = getProfile(profileId);
  return !!profile && profile.consumers.includes(pluginId);
}

function resolveCanonicalColumn(profileId, columnName) {
  const profile = getProfile(profileId);
  if (!profile) return columnName;
  return profile.knownColumnAliases[columnName] || columnName;
}

function validateColumnSchema(profileId, columnNames) {
  const profile = getProfile(profileId);
  if (!profile) {
    return { valid: false, errors: [`Unknown profile: ${profileId}`], warnings: [] };
  }
  const errors = [];
  const warnings = [];
  const present = new Set(Array.isArray(columnNames) ? columnNames : []);
  for (const requiredColumn of profile.requiredColumns) {
    if (present.has(requiredColumn.name)) continue;
    const aliases = Object.entries(profile.knownColumnAliases)
      .filter(([, canonicalName]) => canonicalName === requiredColumn.name)
      .map(([alias]) => alias);
    const availableAlias = aliases.find((alias) => present.has(alias));
    if (!availableAlias) errors.push(`Missing required column '${requiredColumn.name}'`);
    else warnings.push(`Column '${availableAlias}' maps to canonical '${requiredColumn.name}'`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

const registryValidation = validateProfileRegistry();
if (!registryValidation.valid) {
  throw new Error(`artifact_profile_registry_invalid:${registryValidation.errors.join(',')}`);
}

module.exports = {
  ARTIFACT_PROFILE_REGISTRY_VERSION,
  PROFILE_KINDS,
  PROFILE_LIFECYCLE_STATUSES,
  PROFILE_COMPATIBILITY_STATUSES,
  PROFILE_CHANGE_CLASSES,
  ARTIFACT_PROFILES,
  canonicalStringify,
  sha256,
  parseProfileIdentity,
  validateProfileDefinition,
  validateProfileRegistry,
  getProfile,
  listProfiles,
  isRegisteredProfile,
  getProfileIdentity,
  classifyProfileChange,
  resolveProfileCompatibility,
  isProducer,
  isConsumer,
  resolveCanonicalColumn,
  validateColumnSchema,
};
