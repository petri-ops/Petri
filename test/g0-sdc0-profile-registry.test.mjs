import test from 'node:test';
import assert from 'node:assert/strict';

import profileRegistry from '../core/shared-backend/artifact-profiles.js';
import workflow from '../core/shared-backend/agent-workflow.js';

const {
  ARTIFACT_PROFILE_REGISTRY_VERSION,
  PROFILE_KINDS,
  classifyProfileChange,
  getProfile,
  getProfileIdentity,
  isRegisteredProfile,
  listProfiles,
  resolveProfileCompatibility,
  validateProfileDefinition,
  validateProfileRegistry,
} = profileRegistry;

const { validateWorkflowPlanBindings } = workflow;

const EXPECTED_PROFILE_IDS = [
  'petri.counts-matrix.v1',
  'petri.sample-metadata.v1',
  'petri.expression-matrix.v1',
  'petri.deg.v1',
  'petri.gene-list.v1',
  'petri.enrichment-table.v1',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('SDC-0 exposes a versioned registry containing the six canonical profiles', () => {
  assert.equal(ARTIFACT_PROFILE_REGISTRY_VERSION, 1);
  assert.deepEqual([...PROFILE_KINDS].sort(), ['artifact', 'data', 'display']);
  assert.deepEqual(listProfiles().sort(), [...EXPECTED_PROFILE_IDS].sort());

  const result = validateProfileRegistry();
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.profileCount, 6);
  assert.equal(result.registryVersion, 1);
  assert.equal(result.registryDigest.length, 64);
});

test('SDC-0 profiles carry machine-readable science, schema, lifecycle and provenance contracts', () => {
  for (const profileId of EXPECTED_PROFILE_IDS) {
    const profile = getProfile(profileId);
    assert.ok(profile, profileId);
    assert.equal(validateProfileDefinition(profile).valid, true, profileId);
    assert.match(profile.familyId, /^petri\.[a-z0-9-]+$/);
    assert.ok(PROFILE_KINDS.includes(profile.profileKind));
    assert.ok(profile.scientificMeaning.length > 10);
    assert.ok(profile.granularity.length > 0);
    assert.ok(profile.orientation.length > 0);
    assert.ok(Array.isArray(profile.requiredColumns));
    assert.ok(Array.isArray(profile.optionalColumns));
    assert.ok(Array.isArray(profile.identifierNamespaces));
    assert.ok(profile.validationRules.length > 0);
    assert.equal(profile.provenance.requiresInputHash, true);
    assert.equal(profile.provenance.requiresScriptHash, true);
    assert.equal(profile.lifecycle.status, 'active');
    assert.equal(profile.compatibilityPolicy.unknownVersion, 'blocked');
    assert.equal(Object.isFrozen(profile), true);

    const identity = getProfileIdentity(profileId);
    assert.equal(identity.profileId, profileId);
    assert.equal(identity.familyId, profile.familyId);
    assert.equal(identity.majorVersion, 1);
    assert.equal(identity.contractDigest.length, 64);
  }
});

test('SDC-0 preserves the canonical DEG profile and legacy aliases', () => {
  const profile = getProfile('petri.deg.v1');
  assert.equal(profile.knownColumnAliases.log2FC, 'log2FoldChange');
  assert.ok(profile.producers.includes('deg-standardizer'));
  assert.ok(profile.directProducers.includes('deseq2'));
  assert.ok(profile.consumers.includes('volcano-plot'));
});

test('SDC-0 rejects malformed profile identity and reused version drift', () => {
  const malformed = clone(getProfile('petri.gene-list.v1'));
  malformed.profileId = 'petri.gene-list.latest';
  assert.equal(validateProfileDefinition(malformed).valid, false);

  const drifted = clone(getProfile('petri.gene-list.v1'));
  drifted.optionalColumns.push({ name: 'weight', type: 'number', nullable: true });
  const change = classifyProfileChange(getProfile('petri.gene-list.v1'), drifted);
  assert.equal(change.changeClass, 'breaking');
  assert.equal(change.reason, 'profile_identity_reused_with_contract_drift');
});

test('SDC-0 classifies compatible, migration and breaking profile changes conservatively', () => {
  const base = clone(getProfile('petri.gene-list.v1'));

  const compatible = clone(base);
  compatible.profileId = 'petri.gene-list.v2';
  compatible.version = 'v2';
  compatible.schemaVersion = 2;
  compatible.optionalColumns.push({ name: 'weight', type: 'number', nullable: true });
  assert.equal(classifyProfileChange(base, compatible).changeClass, 'compatible');

  const migration = clone(compatible);
  migration.requiredColumns.push({ name: 'source', type: 'string', nullable: false });
  assert.equal(classifyProfileChange(base, migration).changeClass, 'migration');

  const breaking = clone(compatible);
  breaking.scientificMeaning = 'A different scientific object with incompatible semantics';
  assert.equal(classifyProfileChange(base, breaking).changeClass, 'breaking');
});

test('SDC-0 compatibility resolution is explicit and fail-closed', () => {
  assert.deepEqual(resolveProfileCompatibility('petri.deg.v1', 'petri.deg.v1'), {
    status: 'compatible',
    reason: 'exact_profile_match',
    sourceProfileId: 'petri.deg.v1',
    targetProfileId: 'petri.deg.v1',
    migrationId: null,
  });

  assert.equal(
    resolveProfileCompatibility('petri.deg.v1', 'petri.unknown.v1').status,
    'blocked',
  );
  assert.equal(
    resolveProfileCompatibility('petri.deg.v1', 'petri.gene-list.v1').reason,
    'profile_family_mismatch',
  );
  assert.equal(isRegisteredProfile('petri.not-real.v1'), false);
});

test('SDC-0 prevents an unregistered profile from becoming a typed DAG edge', () => {
  const plan = {
    agentWorkflowPlanVersion: 1,
    steps: [
      { id: 'source', dependsOn: [], inputBindings: [] },
      {
        id: 'target',
        dependsOn: ['source'],
        inputBindings: [{
          inputId: 'data',
          fromStepId: 'source',
          artifactProfile: 'petri.not-real.v1',
        }],
      },
    ],
  };

  const result = validateWorkflowPlanBindings(plan);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('unregistered_artifact_profile')));
});
