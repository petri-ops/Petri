'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RESULT_STUDIO_PLUGIN_CONTRACT_VERSION = 1;
const IMPACT_CLASSES = new Set(['view', 'presentation', 'data', 'scientific', 'workflow']);
const FORMAL_ARTIFACT_TYPES = new Set(['plot', 'table', 'report']);
const INTERACTION_CONTRACTS = new Set(['interactive', 'noninteractive']);
const INTERACTION_MODES = new Set(['table', 'scatter', 'matrix']);
const SHA256 = /^[a-f0-9]{64}$/;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  const bytes = Buffer.isBuffer(value) || ArrayBuffer.isView(value)
    ? value
    : typeof value === 'string' ? value : stableJson(value);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeResultStudioDescriptor(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    ...raw,
    contractVersion: Number(raw.contractVersion),
    descriptorVersion: Number(raw.descriptorVersion),
    inputBindings: Array.isArray(raw.inputBindings) ? raw.inputBindings : [],
    parameters: raw.parameters && typeof raw.parameters === 'object' ? raw.parameters : {},
    parameterImpacts: raw.parameterImpacts && typeof raw.parameterImpacts === 'object'
      ? raw.parameterImpacts : {},
    actions: Array.isArray(raw.actions) ? raw.actions : [],
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    interactionMappings: Array.isArray(raw.interactionMappings) ? raw.interactionMappings : [],
  };
}

function validateResultStudioDescriptor({ plugin = {}, toolDefinition = {}, pluginDir = null } = {}) {
  const descriptor = normalizeResultStudioDescriptor(toolDefinition.resultStudio || plugin.resultStudio);
  const errors = [];
  const warnings = [];
  const pluginId = String(toolDefinition.id || plugin.id || 'unknown');
  const inputById = new Map((toolDefinition.inputs || []).map((item) => [item.id, item]));
  const outputById = new Map((toolDefinition.outputs || []).map((item) => [item.id, item]));
  const fail = (code, field, detail) => errors.push({ code, field, detail });

  if (!descriptor) {
    fail('result_studio_descriptor_missing', 'resultStudio', `${pluginId} has no descriptor`);
    return { valid: false, descriptor: null, errors, warnings };
  }
  if (descriptor.contractVersion !== RESULT_STUDIO_PLUGIN_CONTRACT_VERSION) {
    fail('contract_version_unsupported', 'contractVersion', 'only Result Studio plugin contract v1 is trusted');
  }
  if (!Number.isInteger(descriptor.descriptorVersion) || descriptor.descriptorVersion < 1) {
    fail('descriptor_version_invalid', 'descriptorVersion', 'must be a positive integer');
  }
  if (typeof descriptor.semanticType !== 'string' || !descriptor.semanticType.trim()) {
    fail('semantic_type_missing', 'semanticType', 'stable result semantics are required');
  }
  if (!descriptor.entity || typeof descriptor.entity !== 'object'
      || !descriptor.entity.type || !descriptor.entity.idField
      || !descriptor.entity.fields || typeof descriptor.entity.fields !== 'object') {
    fail('entity_schema_invalid', 'entity', 'type, idField and fields are required');
  } else if (!Object.prototype.hasOwnProperty.call(descriptor.entity.fields, descriptor.entity.idField)) {
    fail('entity_id_field_missing', 'entity.idField', 'idField must exist in entity.fields');
  }
  if (!descriptor.source || descriptor.source.strategy !== 'execution_snapshot_per_artifact'
      || typeof descriptor.source.entryPoint !== 'string') {
    fail('source_strategy_invalid', 'source', 'execution_snapshot_per_artifact and entryPoint are required');
  } else if (pluginDir) {
    const entry = path.resolve(pluginDir, descriptor.source.entryPoint);
    const root = `${path.resolve(pluginDir)}${path.sep}`;
    if (!entry.startsWith(root) || !fs.existsSync(entry)) {
      fail('source_entry_point_missing', 'source.entryPoint', 'entryPoint must exist inside the plugin');
    }
  }
  if (descriptor.independentScriptPathTemplate !== 'analysis/scripts/{artifactFamilyId}/{revisionId}/{artifactId}.R') {
    fail('independent_script_contract_invalid', 'independentScriptPathTemplate', 'must use the canonical per-artifact Revision path');
  }

  const boundInputs = new Set();
  for (const [index, binding] of descriptor.inputBindings.entries()) {
    if (!binding || !inputById.has(binding.inputId)) {
      fail('input_binding_unknown', `inputBindings[${index}]`, 'inputId must be declared by the tool');
      continue;
    }
    if (boundInputs.has(binding.inputId)) fail('input_binding_duplicate', `inputBindings[${index}]`, binding.inputId);
    boundInputs.add(binding.inputId);
    if (!Array.isArray(binding.acceptsArtifactTypes) || binding.acceptsArtifactTypes.length === 0) {
      fail('input_binding_types_missing', `inputBindings[${index}].acceptsArtifactTypes`, 'at least one Artifact type is required');
    }
  }
  for (const input of inputById.values()) {
    if (input.type === 'file' && input.required !== false && !boundInputs.has(input.id)) {
      fail('required_file_input_unbound', `inputs.${input.id}`, 'required scientific file input needs an Artifact binding');
    }
  }

  const parameterIds = new Set();
  for (const [id, parameter] of Object.entries(descriptor.parameters)) {
    const input = inputById.get(id);
    parameterIds.add(id);
    if (!input || input.type === 'file') fail('parameter_unknown', `parameters.${id}`, 'must reference a non-file tool input');
    if (!parameter || parameter.type !== input?.type) fail('parameter_type_mismatch', `parameters.${id}.type`, 'must match tool input type');
    if (!Object.prototype.hasOwnProperty.call(descriptor.parameterImpacts, id)) {
      fail('parameter_impact_missing', `parameterImpacts.${id}`, 'every editable parameter needs an impact class');
    }
  }
  for (const [id, impact] of Object.entries(descriptor.parameterImpacts)) {
    if (!parameterIds.has(id)) fail('parameter_impact_unknown', `parameterImpacts.${id}`, 'impact cannot describe an undeclared parameter');
    if (!IMPACT_CLASSES.has(impact)) fail('parameter_impact_invalid', `parameterImpacts.${id}`, String(impact));
  }
  if (descriptor.actions.length === 0 || descriptor.actions.some((action) => typeof action !== 'string' || !action)) {
    fail('actions_invalid', 'actions', 'at least one stable selection, derivation, or recompute action is required');
  }

  const declaredArtifacts = new Set();
  for (const output of outputById.values()) {
    if (!FORMAL_ARTIFACT_TYPES.has(output.type)) continue;
    if (typeof output.filename !== 'string' || !output.filename
        || path.basename(output.filename) !== output.filename || output.filename.includes('..')) {
      fail(
        'formal_output_filename_invalid',
        `outputs.${output.id}.filename`,
        'every formal table, plot, or report requires one exact safe filename'
      );
    }
  }
  for (const [index, artifact] of descriptor.artifacts.entries()) {
    const output = artifact && outputById.get(artifact.id);
    if (!output) {
      fail('artifact_output_unknown', `artifacts[${index}]`, 'id must reference a tool output');
      continue;
    }
    if (!FORMAL_ARTIFACT_TYPES.has(output.type)) {
      fail('artifact_not_formal', `artifacts[${index}]`, 'only table, plot, or report outputs belong in Result Studio v1');
    }
    if (declaredArtifacts.has(artifact.id)) fail('artifact_duplicate', `artifacts[${index}]`, artifact.id);
    declaredArtifacts.add(artifact.id);
    if (artifact.type !== output.type) fail('artifact_type_mismatch', `artifacts[${index}].type`, output.type);
    if (typeof artifact.filename !== 'string' || !artifact.filename
        || path.basename(artifact.filename) !== artifact.filename || artifact.filename.includes('..')) {
      fail('artifact_filename_invalid', `artifacts[${index}].filename`, artifact.id);
    } else if (artifact.filename !== output.filename) {
      fail(
        'artifact_filename_mismatch',
        `artifacts[${index}].filename`,
        'descriptor filename must exactly match the top-level output contract'
      );
    }
    if ((artifact.required !== false) !== (output.required !== false)) {
      fail(
        'artifact_required_mismatch',
        `artifacts[${index}].required`,
        'descriptor optionality must exactly match the top-level output contract'
      );
    }
    if (!INTERACTION_CONTRACTS.has(artifact.interaction)) {
      fail(
        'artifact_interaction_contract_invalid',
        `artifacts[${index}].interaction`,
        'every formal Artifact must explicitly declare interactive or noninteractive'
      );
    }
  }
  for (const output of outputById.values()) {
    if (FORMAL_ARTIFACT_TYPES.has(output.type) && !declaredArtifacts.has(output.id)) {
      fail('formal_output_unmapped', `outputs.${output.id}`, 'every formal table, plot, or report output must be mapped');
    }
  }

  const mappedInteractions = new Set();
  const interactionCounts = new Map();
  for (const [index, mapping] of descriptor.interactionMappings.entries()) {
    const field = `interactionMappings[${index}]`;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      fail('interaction_mapping_invalid', field, 'mapping must be an object');
      continue;
    }
    if (!declaredArtifacts.has(mapping.artifactId)) {
      fail('interaction_artifact_unknown', `${field}.artifactId`, 'must reference a Result Studio artifact');
    }
    interactionCounts.set(mapping.artifactId, (interactionCounts.get(mapping.artifactId) || 0) + 1);
    if (mappedInteractions.has(mapping.artifactId)) {
      fail('interaction_artifact_duplicate', `${field}.artifactId`, String(mapping.artifactId));
    }
    mappedInteractions.add(mapping.artifactId);
    if (!INTERACTION_MODES.has(mapping.mode)) {
      fail('interaction_mode_invalid', `${field}.mode`, 'must be table, scatter, or matrix');
      continue;
    }
    if (typeof mapping.entityType !== 'string' || !mapping.entityType.trim()) {
      fail('interaction_entity_type_missing', `${field}.entityType`, 'stable entity semantics are required');
    }
    if (mapping.dataArtifactId && !outputById.has(mapping.dataArtifactId)) {
      fail('interaction_data_artifact_unknown', `${field}.dataArtifactId`, String(mapping.dataArtifactId));
    }
    if (mapping.dataFile && (typeof mapping.dataFile !== 'string'
        || path.basename(mapping.dataFile) !== mapping.dataFile || mapping.dataFile.includes('..'))) {
      fail('interaction_data_file_unsafe', `${field}.dataFile`, String(mapping.dataFile));
    }
    if (mapping.mode === 'table' && (typeof mapping.idField !== 'string' || !mapping.idField.trim())) {
      fail('interaction_id_field_missing', `${field}.idField`, 'table selection requires a stable id field');
    }
    if (mapping.mode === 'scatter') {
      if (!mapping.dataArtifactId && !mapping.dataFile) {
        fail('interaction_backing_data_missing', field, 'scatter selection requires backing data');
      }
      for (const required of ['idField', 'xField', 'yField']) {
        if (typeof mapping[required] !== 'string' || !mapping[required].trim()) {
          fail('interaction_scatter_field_missing', `${field}.${required}`, `${required} is required`);
        }
      }
      if (mapping.yTransform && mapping.yTransform !== 'neg_log10') {
        fail('interaction_transform_invalid', `${field}.yTransform`, String(mapping.yTransform));
      }
    }
    if (mapping.mode === 'matrix') {
      if (!mapping.dataArtifactId && !mapping.dataFile) {
        fail('interaction_backing_data_missing', field, 'matrix selection requires backing data');
      }
      if (typeof mapping.rowIdField !== 'string' || !mapping.rowIdField.trim()) {
        fail('interaction_matrix_row_id_missing', `${field}.rowIdField`, 'rowIdField is required');
      }
      if (typeof mapping.rowEntityType !== 'string' || typeof mapping.columnEntityType !== 'string') {
        fail('interaction_matrix_entity_missing', field, 'rowEntityType and columnEntityType are required');
      }
    }
  }

  for (const [index, artifact] of descriptor.artifacts.entries()) {
    const output = artifact && outputById.get(artifact.id);
    if (!output) continue;
    const mappingCount = interactionCounts.get(artifact.id) || 0;
    if (artifact.interaction === 'interactive' && mappingCount !== 1) {
      fail(
        'interactive_artifact_mapping_count_invalid',
        `artifacts[${index}]`,
        'an interactive formal Artifact requires exactly one trusted interaction mapping'
      );
    }
    if (artifact.interaction === 'noninteractive' && mappingCount !== 0) {
      fail(
        'noninteractive_artifact_mapped',
        `artifacts[${index}]`,
        'a noninteractive formal Artifact cannot declare an interaction mapping'
      );
    }
    if (output.type === 'report') {
      if (artifact.interaction !== 'noninteractive') {
        fail(
          'report_interaction_contract_missing',
          `artifacts[${index}].interaction`,
          'a formal report must explicitly declare interaction as noninteractive'
        );
      }
    }
  }

  if (!descriptor.validator || typeof descriptor.validator.id !== 'string'
      || !Array.isArray(descriptor.validator.checks) || descriptor.validator.checks.length === 0) {
    fail('validator_invalid', 'validator', 'stable validator id and checks are required');
  }
  if (!descriptor.goldenFixture || typeof descriptor.goldenFixture.path !== 'string') {
    fail('golden_fixture_missing', 'goldenFixture.path', 'a repository-relative golden Revision fixture is required');
  } else if (pluginDir) {
    const fixturePath = path.resolve(pluginDir, descriptor.goldenFixture.path);
    const root = `${path.resolve(pluginDir)}${path.sep}`;
    if (!fixturePath.startsWith(root) || !fs.existsSync(fixturePath)) {
      fail('golden_fixture_unreadable', 'goldenFixture.path', 'fixture must exist inside the plugin');
    } else {
      try {
        const fixture = readJson(fixturePath);
        if (fixture.pluginId !== pluginId || fixture.pluginVersion !== plugin.version) {
          fail('golden_fixture_identity_mismatch', 'goldenFixture.path', 'plugin id/version mismatch');
        }
        if (!SHA256.test(fixture.sourceScriptSha256 || '') || !SHA256.test(fixture.inputBindingDigest || '')
            || !SHA256.test(fixture.artifactContractDigest || '')) {
          fail('golden_fixture_digest_invalid', 'goldenFixture.path', 'three SHA-256 digests are required');
        }
        const scriptPath = path.resolve(pluginDir, descriptor.source.entryPoint || '');
        if (fs.existsSync(scriptPath) && digest(fs.readFileSync(scriptPath)) !== fixture.sourceScriptSha256) {
          fail('golden_fixture_script_drift', 'goldenFixture.sourceScriptSha256', 'source script changed; regenerate fixture or declare migration');
        }
        if (digest(descriptor.inputBindings) !== fixture.inputBindingDigest
            || digest(descriptor.artifacts) !== fixture.artifactContractDigest) {
          fail('golden_fixture_contract_drift', 'goldenFixture', 'input/artifact contract changed; regenerate fixture or declare migration');
        }
        const expectedArtifactIds = descriptor.artifacts.map((artifact) => artifact.id);
        if (!Array.isArray(fixture.expectedArtifactIds)
            || fixture.expectedArtifactIds.length !== expectedArtifactIds.length
            || fixture.expectedArtifactIds.some((id, index) => id !== expectedArtifactIds[index])) {
          fail(
            'golden_fixture_artifact_ids_mismatch',
            'goldenFixture.expectedArtifactIds',
            'golden formal Artifact ids must exactly match descriptor order'
          );
        }
      } catch (error) {
        fail('golden_fixture_invalid_json', 'goldenFixture.path', error.message);
      }
    }
  }
  if (!descriptor.upgradePolicy || descriptor.upgradePolicy.sameMajor !== 'compatible_if_contract_digests_match'
      || descriptor.upgradePolicy.contractDrift !== 'migration_required'
      || descriptor.upgradePolicy.missingMigration !== 'read_only_legacy') {
    fail('upgrade_policy_invalid', 'upgradePolicy', 'explicit compatible/migration/read-only behavior is required');
  }

  return { valid: errors.length === 0, descriptor: errors.length === 0 ? descriptor : null, errors, warnings };
}

function evaluateRevisionCompatibility({ descriptor, currentPluginVersion, revision } = {}) {
  if (!descriptor || !revision) return { status: 'read_only_legacy', reason: 'descriptor_or_revision_missing' };
  const currentMajor = Number(String(currentPluginVersion || '').split('.')[0]);
  const recordedMajor = Number(String(revision.pluginVersion || '').split('.')[0]);
  if (!Number.isInteger(currentMajor) || !Number.isInteger(recordedMajor) || currentMajor !== recordedMajor) {
    return { status: 'migration_required', reason: 'plugin_major_changed' };
  }
  const inputBindingDigest = digest(descriptor.inputBindings || []);
  const artifactContractDigest = digest(descriptor.artifacts || []);
  if (revision.inputBindingDigest !== inputBindingDigest || revision.artifactContractDigest !== artifactContractDigest) {
    return revision.migrationId
      ? { status: 'migration_required', reason: 'contract_drift', migrationId: revision.migrationId }
      : { status: 'read_only_legacy', reason: 'contract_drift_without_migration' };
  }
  return { status: 'compatible', reason: 'same_major_and_contract' };
}

function lintResultStudioPlugin(input) {
  return validateResultStudioDescriptor(input);
}

module.exports = {
  RESULT_STUDIO_PLUGIN_CONTRACT_VERSION,
  digest,
  normalizeResultStudioDescriptor,
  validateResultStudioDescriptor,
  lintResultStudioPlugin,
  evaluateRevisionCompatibility,
  FORMAL_ARTIFACT_TYPES,
  INTERACTION_MODES,
};
