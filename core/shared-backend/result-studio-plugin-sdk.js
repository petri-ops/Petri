'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RESULT_STUDIO_PLUGIN_CONTRACT_VERSION = 1;
const IMPACT_CLASSES = new Set(['view', 'presentation', 'data', 'scientific', 'workflow']);
const EDITABLE_ARTIFACT_TYPES = new Set(['plot', 'table']);
const SHA256 = /^[a-f0-9]{64}$/;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
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
  for (const [index, artifact] of descriptor.artifacts.entries()) {
    const output = artifact && outputById.get(artifact.id);
    if (!output) {
      fail('artifact_output_unknown', `artifacts[${index}]`, 'id must reference a tool output');
      continue;
    }
    if (!EDITABLE_ARTIFACT_TYPES.has(output.type)) {
      fail('artifact_not_editable', `artifacts[${index}]`, 'only plot/table outputs belong in Result Studio v1');
    }
    if (declaredArtifacts.has(artifact.id)) fail('artifact_duplicate', `artifacts[${index}]`, artifact.id);
    declaredArtifacts.add(artifact.id);
    if (artifact.type !== output.type) fail('artifact_type_mismatch', `artifacts[${index}].type`, output.type);
    if (typeof artifact.filename !== 'string' || !artifact.filename) fail('artifact_filename_missing', `artifacts[${index}].filename`, artifact.id);
  }
  for (const output of outputById.values()) {
    if (EDITABLE_ARTIFACT_TYPES.has(output.type) && !declaredArtifacts.has(output.id)) {
      fail('editable_output_unmapped', `outputs.${output.id}`, 'every formal table/plot output must be mapped');
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
};
