'use strict';

const crypto = require('crypto');

const constitution = require('./g0/constitution.json');
const manifest = require('./g0/baseline-manifest.json');
const registry = require('./g0/baseline-registry.json');
const supportMatrix = require('./g0/support-matrix.json');
const governanceVocabulary = require('./g0/governance-vocabulary.json');
const truthLattice = require('./g0/truth-lattice.json');
const durableStateInventory = require('./g0/durable-state-inventory.json');
const capabilitySupplyChain = require('./g0/capability-supply-chain.json');
const securityPermissionMatrix = require('./g0/security-permission-matrix.json');
const scientificAccuracy = require('./g0/scientific-accuracy.json');
const reproducibilityLab = require('./g0/reproducibility-lab.json');
const adaptiveRuntime = require('./g0/adaptive-runtime.json');
const modelMemoryCost = require('./g0/model-memory-cost.json');
const observableExperience = require('./g0/observable-experience.json');
const resilienceLab = require('./g0/resilience-lab.json');
const evolutionPipeline = require('./g0/evolution-pipeline.json');
const qualificationManifest = require('./g0/qualification-manifest.json');

const LEGACY_BASELINE_ID = 'legacy-unversioned';
const PROJECT_BASELINE_RECORD_VERSION = 1;
const COMPATIBILITY_STATUSES = Object.freeze([
  'compatible',
  'migration_required',
  'blocked',
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

[
  constitution,
  manifest,
  registry,
  supportMatrix,
  governanceVocabulary,
  truthLattice,
  durableStateInventory,
  capabilitySupplyChain,
  securityPermissionMatrix,
  scientificAccuracy,
  reproducibilityLab,
  adaptiveRuntime,
  modelMemoryCost,
  observableExperience,
  resilienceLab,
  evolutionPipeline,
  qualificationManifest,
].forEach(deepFreeze);

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(
    typeof value === 'string' ? value : canonicalStringify(value)
  ).digest('hex');
}

function parseMajor(version) {
  if (version == null || version === '') return null;
  const match = String(version).trim().match(/^(\d+)(?:\.|$)/);
  return match ? Number(match[1]) : null;
}

function currentContractVersions() {
  const taskSpec = require('./scientific-task-spec');
  const workflow = require('./agent-workflow');
  const loopContract = require('./loop-contract');
  const loopCheckpoint = require('./loop-checkpoint');
  const delivery = require('./delivery-manifest');
  const replay = require('./scientific-replay-package');
  const resources = require('./runtime-resource-snapshot');
  const artifactProfiles = require('./artifact-profiles');
  const truthProjection = require('./g0-truth-projection');
  const durableState = require('./g0-durable-state');
  const scientificAccuracyModule = require('./g0-scientific-accuracy');
  const reproducibilityLabModule = require('./g0-reproducibility-lab');
  const adaptiveRuntimeModule = require('./g0-adaptive-runtime');
  const modelMemoryCostModule = require('./g0-model-memory-cost');
  const observableExperienceModule = require('./g0-observable-experience');
  const resilienceLabModule = require('./g0-resilience-lab');
  const evolutionPipelineModule = require('./g0-evolution-pipeline');
  const artifactProfileVersions = Object.values(artifactProfiles.ARTIFACT_PROFILES || {})
    .map((profile) => Number(profile.schemaVersion))
    .filter(Number.isInteger);

  return {
    scientificTaskSpec: taskSpec.SCIENTIFIC_TASK_SPEC_VERSION,
    conversationContextEnvelope: taskSpec.CONVERSATION_CONTEXT_ENVELOPE_VERSION,
    contextCheckpoint: taskSpec.CONTEXT_CHECKPOINT_VERSION,
    agentWorkflowTemplate: workflow.AGENT_WORKFLOW_TEMPLATE_VERSION,
    loopContract: loopContract.LOOP_CONTRACT_VERSION,
    loopCheckpoint: loopCheckpoint.CHECKPOINT_VERSION,
    loopContextEnvelope: loopCheckpoint.ENVELOPE_VERSION,
    deliveryManifest: delivery.DELIVERY_MANIFEST_VERSION,
    replayPackage: replay.REPLAY_PACKAGE_VERSION,
    runtimeResourceSnapshot: resources.SNAPSHOT_VERSION,
    artifactProfile: artifactProfileVersions.length > 0
      ? Math.max(...artifactProfileVersions)
      : null,
    pluginManifest: 1,
    projectBaselineRecord: PROJECT_BASELINE_RECORD_VERSION,
    truthProjection: truthProjection.TRUTH_PROJECTION_VERSION,
    durableState: durableState.DURABLE_STATE_VERSION,
    capabilitySupplyChain: require('./g0/capability-supply-chain.json').contractVersion,
    securityPermissionMatrix: require('./g0/security-permission-matrix.json').contractVersion,
    scientificAccuracy: scientificAccuracyModule.SCIENTIFIC_ACCURACY_VERSION,
    reproducibilityLab: reproducibilityLabModule.REPRODUCIBILITY_LAB_VERSION,
    adaptiveRuntime: adaptiveRuntimeModule.ADAPTIVE_RUNTIME_VERSION,
    modelMemoryCost: modelMemoryCostModule.MODEL_MEMORY_COST_VERSION,
    observableExperience: observableExperienceModule.OBSERVABLE_EXPERIENCE_VERSION,
    resilienceLab: resilienceLabModule.RESILIENCE_LAB_VERSION,
    evolutionPipeline: evolutionPipelineModule.EVOLUTION_PIPELINE_VERSION,
    baselineQualification: qualificationManifest.contractVersion,
  };
}

function getCurrentG0Baseline() {
  const manifestDigest = sha256(manifest);
  const bundleDigest = sha256({
    constitution,
    manifest,
    registry,
    supportMatrix,
    governanceVocabulary,
    truthLattice,
    durableStateInventory,
    capabilitySupplyChain,
    securityPermissionMatrix,
    scientificAccuracy,
    reproducibilityLab,
    adaptiveRuntime,
    modelMemoryCost,
    observableExperience,
    resilienceLab,
    evolutionPipeline,
    qualificationManifest,
  });
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    baselineId: manifest.baselineId,
    baselineVersion: manifest.baselineVersion,
    lifecycleStatus: manifest.lifecycleStatus,
    qualificationStatus: manifest.qualificationStatus,
    constitutionId: manifest.constitutionId,
    manifestDigest,
    bundleDigest,
  });
}

/**
 * Return the immutable bundle that LF12 qualifies. Before promotion this is
 * simply the current establishing baseline. Once a maintained baseline is
 * published, its qualification metadata points back to the exact sealed
 * subject bundle so evidence validation never forms a digest cycle by trying
 * to qualify the qualification metadata itself.
 */
function getQualificationSubjectBaseline() {
  const current = getCurrentG0Baseline();
  const qualifiedFrom = manifest.qualification?.qualifiedFrom;
  if (
    manifest.lifecycleStatus === 'maintained'
    && manifest.qualificationStatus === 'qualified'
    && qualifiedFrom
    && typeof qualifiedFrom.baselineId === 'string'
    && typeof qualifiedFrom.baselineVersion === 'string'
    && /^[a-f0-9]{64}$/.test(String(qualifiedFrom.bundleDigest || ''))
    && /^[a-f0-9]{64}$/.test(String(qualifiedFrom.manifestDigest || ''))
  ) {
    return Object.freeze({
      schemaVersion: current.schemaVersion,
      baselineId: qualifiedFrom.baselineId,
      baselineVersion: qualifiedFrom.baselineVersion,
      lifecycleStatus: 'establishing',
      qualificationStatus: 'not_yet_qualified',
      constitutionId: current.constitutionId,
      manifestDigest: qualifiedFrom.manifestDigest,
      bundleDigest: qualifiedFrom.bundleDigest,
    });
  }
  return current;
}

function getPublicG0BaselineSummary() {
  const current = getCurrentG0Baseline();
  return {
    ...current,
    executionTruthChain: [...manifest.executionTruthChain],
    support: {
      platforms: supportMatrix.platforms.map(({ id, status, reason }) => ({ id, status, ...(reason ? { reason } : {}) })),
      providers: supportMatrix.providers.map(({ id, status, reason }) => ({ id, status, ...(reason ? { reason } : {}) })),
      runtimes: supportMatrix.runtimes.map(({ id, status, platform }) => ({ id, status, ...(platform ? { platform } : {}) })),
      plugins: supportMatrix.plugins.map(({ id, status }) => ({ id, status })),
      productCapabilities: (supportMatrix.productCapabilities || []).map(({ id, status, scope }) => ({
        id,
        status,
        ...(scope ? { scope } : {}),
      })),
    },
  };
}

function validateG0BaselineBundle() {
  const issues = [];
  const current = getCurrentG0Baseline();
  const actualContracts = currentContractVersions();
  const allowedStatuses = new Set(Object.keys(governanceVocabulary.capabilityStatuses || {}));
  const allowedChangeClasses = new Set(Object.keys(governanceVocabulary.changeClasses || {}));

  if (constitution.schemaVersion !== 1) issues.push('constitution_schema_version_unsupported');
  if (manifest.schemaVersion !== 1) issues.push('manifest_schema_version_unsupported');
  if (registry.schemaVersion !== 1) issues.push('registry_schema_version_unsupported');
  if (supportMatrix.schemaVersion !== 1) issues.push('support_matrix_schema_version_unsupported');
  if (governanceVocabulary.schemaVersion !== 1) issues.push('governance_vocabulary_schema_version_unsupported');
  if (truthLattice.schemaVersion !== 1) issues.push('truth_lattice_schema_version_unsupported');
  if (durableStateInventory.schemaVersion !== 1) issues.push('durable_state_inventory_schema_version_unsupported');
  if (capabilitySupplyChain.schemaVersion !== 1) issues.push('capability_supply_chain_schema_version_unsupported');
  if (securityPermissionMatrix.schemaVersion !== 1) issues.push('security_permission_matrix_schema_version_unsupported');
  if (scientificAccuracy.schemaVersion !== 1) issues.push('scientific_accuracy_schema_version_unsupported');
  if (reproducibilityLab.schemaVersion !== 1) issues.push('reproducibility_lab_schema_version_unsupported');
  if (adaptiveRuntime.schemaVersion !== 1) issues.push('adaptive_runtime_schema_version_unsupported');
  if (modelMemoryCost.schemaVersion !== 1) issues.push('model_memory_cost_schema_version_unsupported');
  if (observableExperience.schemaVersion !== 1) issues.push('observable_experience_schema_version_unsupported');
  if (resilienceLab.schemaVersion !== 1) issues.push('resilience_lab_schema_version_unsupported');
  if (evolutionPipeline.schemaVersion !== 1) issues.push('evolution_pipeline_schema_version_unsupported');
  if (qualificationManifest.schemaVersion !== 1) issues.push('qualification_manifest_schema_version_unsupported');
  if (manifest.baselineId !== registry.currentBaselineId) issues.push('registry_current_baseline_mismatch');
  if (manifest.baselineId !== supportMatrix.baselineId) issues.push('support_matrix_baseline_mismatch');
  if (manifest.constitutionId !== constitution.constitutionId) issues.push('constitution_id_mismatch');
  if (canonicalStringify(manifest.executionTruthChain) !== canonicalStringify(constitution.executionTruthChain)) {
    issues.push('execution_truth_chain_mismatch');
  }
  if (canonicalStringify(manifest.executionTruthChain) !== canonicalStringify(['run_tool', 'tool_job', 'artifact_truth'])) {
    issues.push('execution_truth_chain_invalid');
  }
  if (!Array.isArray(constitution.invariants) || constitution.invariants.length < 8) {
    issues.push('constitution_invariants_incomplete');
  } else {
    const invariantIds = constitution.invariants.map((item) => item.id);
    if (new Set(invariantIds).size !== invariantIds.length) issues.push('constitution_invariant_ids_duplicate');
    for (const item of constitution.invariants) {
      if (!allowedChangeClasses.has(item.changeLevel)) issues.push(`invariant_change_class_invalid:${item.id}`);
    }
  }
  for (const [name, expected] of Object.entries(manifest.contracts || {})) {
    if (actualContracts[name] !== expected) {
      issues.push(`contract_version_drift:${name}:${expected}:${actualContracts[name]}`);
    }
  }
  for (const group of ['platforms', 'providers', 'runtimes', 'plugins', 'projectFormats', 'productCapabilities']) {
    for (const capability of supportMatrix[group] || []) {
      if (!allowedStatuses.has(capability.status)) issues.push(`capability_status_invalid:${group}:${capability.id}`);
      if (
        capability.status === 'qualified'
        && (manifest.lifecycleStatus !== 'maintained' || manifest.qualificationStatus !== 'qualified')
      ) issues.push(`premature_qualification:${group}:${capability.id}`);
    }
  }
  if (manifest.lifecycleStatus === 'maintained' || manifest.qualificationStatus === 'qualified') {
    const qualifiedFrom = manifest.qualification?.qualifiedFrom;
    if (manifest.lifecycleStatus !== 'maintained') issues.push('qualified_baseline_not_maintained');
    if (manifest.qualificationStatus !== 'qualified') issues.push('maintained_baseline_not_qualified');
    if (manifest.qualification?.decisionState !== 'qualified') issues.push('qualification_decision_state_invalid');
    if (!/^[a-f0-9]{40}$/.test(String(manifest.qualification?.sourceCommit || ''))) {
      issues.push('qualification_source_commit_invalid');
    }
    if (!/^[a-f0-9]{64}$/.test(String(manifest.qualification?.decisionHash || ''))) {
      issues.push('qualification_decision_hash_invalid');
    }
    if (!/^[a-f0-9]{64}$/.test(String(manifest.qualification?.ledgerHash || ''))) {
      issues.push('qualification_ledger_hash_invalid');
    }
    if (
      !qualifiedFrom
      || qualifiedFrom.baselineId !== qualificationManifest.subjectBaselineId
      || qualifiedFrom.baselineVersion !== qualificationManifest.subjectBaselineVersion
      || !/^[a-f0-9]{64}$/.test(String(qualifiedFrom.manifestDigest || ''))
      || !/^[a-f0-9]{64}$/.test(String(qualifiedFrom.bundleDigest || ''))
    ) issues.push('qualification_subject_binding_invalid');
    const currentRegistryEntry = registry.baselines.find((item) => item.baselineId === manifest.baselineId);
    if (
      currentRegistryEntry?.lifecycleStatus !== 'maintained'
      || currentRegistryEntry?.qualificationStatus !== 'qualified'
      || currentRegistryEntry?.qualifiedFromBaselineId !== qualifiedFrom?.baselineId
    ) issues.push('qualified_registry_entry_invalid');
  }
  if (parseMajor(manifest.baselineVersion) !== manifest.projectFormat.currentMajor) {
    issues.push('project_format_major_mismatch');
  }
  if (!/^[a-f0-9]{64}$/.test(current.manifestDigest) || !/^[a-f0-9]{64}$/.test(current.bundleDigest)) {
    issues.push('baseline_digest_invalid');
  }

  return Object.freeze({
    ok: issues.length === 0,
    issues: Object.freeze(issues),
    baseline: current,
    actualContracts: Object.freeze(actualContracts),
  });
}

function evaluateProjectBaselineCompatibility(record = {}) {
  const current = getCurrentG0Baseline();
  const currentMajor = parseMajor(current.baselineVersion);
  const minimumReadableMajor = Number(manifest.projectFormat.minimumReadableMajor);
  const createdBaselineId = record.createdBaselineId || record.created_baseline_id || LEGACY_BASELINE_ID;
  const createdBaselineVersion = record.createdBaselineVersion ?? record.created_baseline_version ?? null;
  const createdManifestDigest = record.createdManifestDigest ?? record.created_manifest_digest ?? null;
  const createdBundleDigest = record.createdBundleDigest ?? record.created_bundle_digest ?? null;

  if (createdBaselineId === LEGACY_BASELINE_ID || createdBaselineVersion == null) {
    return Object.freeze({
      status: 'compatible',
      reason: 'legacy_unversioned_adopted',
      executionAllowed: true,
      migrationRequired: false,
      current,
    });
  }

  const createdMajor = parseMajor(createdBaselineVersion);
  if (createdMajor == null) {
    return Object.freeze({
      status: 'blocked',
      reason: 'project_baseline_version_invalid',
      executionAllowed: false,
      migrationRequired: false,
      current,
    });
  }
  if (createdMajor > currentMajor) {
    return Object.freeze({
      status: 'blocked',
      reason: 'future_baseline_unsupported',
      executionAllowed: false,
      migrationRequired: false,
      current,
    });
  }
  if (createdMajor < minimumReadableMajor) {
    return Object.freeze({
      status: 'migration_required',
      reason: 'project_baseline_too_old',
      executionAllowed: false,
      migrationRequired: true,
      current,
    });
  }
  if (
    createdBaselineId === current.baselineId
    && createdBaselineVersion === current.baselineVersion
    && createdManifestDigest
    && createdManifestDigest !== current.manifestDigest
  ) {
    return Object.freeze({
      status: 'blocked',
      reason: 'baseline_digest_changed_without_version_bump',
      executionAllowed: false,
      migrationRequired: false,
      current,
    });
  }
  if (
    createdBaselineId === current.baselineId
    && createdBaselineVersion === current.baselineVersion
    && createdBundleDigest
    && createdBundleDigest !== current.bundleDigest
  ) {
    return Object.freeze({
      status: 'blocked',
      reason: 'baseline_bundle_changed_without_version_bump',
      executionAllowed: false,
      migrationRequired: false,
      current,
    });
  }
  return Object.freeze({
    status: 'compatible',
    reason: createdBaselineId === current.baselineId
      ? 'current_baseline'
      : 'compatible_baseline_upgrade',
    executionAllowed: true,
    migrationRequired: false,
    current,
  });
}

function assertProjectG0Compatible(project) {
  const record = project && (project.g0_baseline || project.g0Baseline);
  const compatibility = record && record.compatibilityStatus
    ? {
        status: record.compatibilityStatus,
        reason: record.compatibilityReason,
        executionAllowed: record.executionAllowed === true,
      }
    : evaluateProjectBaselineCompatibility(record || {});
  if (compatibility.status !== 'compatible' || compatibility.executionAllowed !== true) {
    const error = new Error(
      `[g0-baseline] Project baseline is not executable: ${compatibility.reason || compatibility.status}`
    );
    error.code = 'project_g0_baseline_incompatible';
    error.compatibility = compatibility;
    throw error;
  }
  return compatibility;
}

module.exports = {
  LEGACY_BASELINE_ID,
  PROJECT_BASELINE_RECORD_VERSION,
  COMPATIBILITY_STATUSES,
  constitution,
  manifest,
  registry,
  supportMatrix,
  governanceVocabulary,
  truthLattice,
  durableStateInventory,
  capabilitySupplyChain,
  securityPermissionMatrix,
  scientificAccuracy,
  reproducibilityLab,
  adaptiveRuntime,
  modelMemoryCost,
  observableExperience,
  resilienceLab,
  evolutionPipeline,
  qualificationManifest,
  canonicalStringify,
  sha256,
  parseMajor,
  currentContractVersions,
  getCurrentG0Baseline,
  getQualificationSubjectBaseline,
  getPublicG0BaselineSummary,
  validateG0BaselineBundle,
  evaluateProjectBaselineCompatibility,
  assertProjectG0Compatible,
};
