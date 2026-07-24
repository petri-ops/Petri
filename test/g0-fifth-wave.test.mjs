import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const evolution = require('../core/shared-backend/g0-evolution-pipeline');

const fullEvidence = [
  'problem_evidence', 'impact_scope', 'baseline_comparison', 'replay_shadow_result',
  'scientific_and_compatibility_risk', 'data_migration', 'rollback_path', 'new_permanent_regression',
];

test('maintained v1 retains the fifth-wave evolution contracts', () => {
  const validation = g0.validateG0BaselineBundle();
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.equal(g0.manifest.baselineVersion, '1.0.0');
  assert.equal(g0.manifest.qualificationStatus, 'qualified');
  assert.equal(g0.manifest.lifecycleStatus, 'maintained');
  assert.equal(g0.getQualificationSubjectBaseline().baselineVersion, '0.6.0');
  assert.equal(g0.manifest.contracts.evolutionPipeline, 1);
  assert.equal(evolution.EVOLUTION_PIPELINE_VERSION, 1);
});

test('LF11 classifies the four change classes with their required evidence', () => {
  const policy = evolution.classifyChange({ changeClass: 'policy' });
  assert.equal(policy.ok, true);
  assert.equal(policy.requiresNewMajor, false);
  assert.equal(policy.requiresMigration, false);
  const migration = evolution.classifyChange({ changeClass: 'migration' });
  assert.equal(migration.requiresMigration, true);
  assert.ok(migration.requiredEvidence.includes('rollback'));
  const breaking = evolution.classifyChange({ changeClass: 'breaking' });
  assert.equal(breaking.requiresNewMajor, true);
  assert.ok(breaking.requiredEvidence.includes('rfc'));
  assert.equal(evolution.classifyChange({ changeClass: 'nonsense' }).ok, false);
});

test('LF11 promotion gate requires all eight evidence items plus class evidence', () => {
  const allowed = evolution.evaluatePromotionGate({
    changeClass: 'policy',
    providedEvidence: [...fullEvidence, 'metrics', 'replay', 'rollback'],
  });
  assert.equal(allowed.allowed, true, allowed.reasons.join('\n'));
  assert.equal(allowed.createsSecondLedger, false);

  const missingGate = evolution.evaluatePromotionGate({
    changeClass: 'policy',
    providedEvidence: ['metrics', 'replay', 'rollback'],
  });
  assert.equal(missingGate.allowed, false);
  assert.ok(missingGate.reasons.some((r) => r.startsWith('promotion_evidence_missing:')));

  const missingClass = evolution.evaluatePromotionGate({
    changeClass: 'compatible-contract',
    providedEvidence: fullEvidence,
  });
  assert.equal(missingClass.allowed, false);
  assert.ok(missingClass.reasons.some((r) => r.startsWith('class_evidence_missing:')));
});

test('LF11 breaking and migration classes demand new major and migration flags', () => {
  const breaking = evolution.evaluatePromotionGate({
    changeClass: 'breaking',
    providedEvidence: [...fullEvidence, 'rfc', 'requalification', 'migration', 'rollback'],
    newMajor: false,
    migrationProvided: true,
  });
  assert.equal(breaking.allowed, false);
  assert.ok(breaking.reasons.includes('new_major_required'));

  const migration = evolution.evaluatePromotionGate({
    changeClass: 'migration',
    providedEvidence: [...fullEvidence, 'migration', 'backup', 'rollback', 'replay'],
    migrationProvided: false,
  });
  assert.equal(migration.allowed, false);
  assert.ok(migration.reasons.includes('migration_required'));
});

test('LF11 fails closed when an LF12 requalification trigger lacks a qualified decision', () => {
  const missing = evolution.evaluatePromotionGate({
    changeClass: 'policy',
    providedEvidence: [...fullEvidence, 'metrics', 'replay', 'rollback'],
    requalificationTrigger: 'baseline_bundle_digest_change',
  });
  assert.equal(missing.allowed, false);
  assert.ok(missing.reasons.includes('requalification_decision_not_qualified'));
  assert.ok(missing.reasons.includes('requalification_evidence_digest_missing'));

  const qualified = evolution.evaluatePromotionGate({
    changeClass: 'policy',
    providedEvidence: [...fullEvidence, 'metrics', 'replay', 'rollback'],
    requalificationTrigger: 'baseline_bundle_digest_change',
    requalificationDecision: 'qualified',
    requalificationEvidenceDigest: 'a'.repeat(64),
  });
  assert.equal(qualified.allowed, true, qualified.reasons.join('\n'));
  assert.equal(qualified.requalification.required, true);

  const unknown = evolution.evaluateRequalificationGate({
    trigger: 'model_made_up_trigger',
    decisionState: 'qualified',
    evidenceDigest: 'a'.repeat(64),
  });
  assert.equal(unknown.allowed, false);
  assert.ok(unknown.reasons.some((reason) => reason.startsWith('requalification_trigger_unknown:')));
});

test('LF11 policy learning stays candidate-only and never drifts scientific thresholds', () => {
  const accepted = evolution.evaluatePolicyLearning({
    target: 'resource_hint',
    controls: ['privacy_boundary', 'explainable', 'versioned', 'replayable', 'rollbackable'],
  });
  assert.equal(accepted.accepted, true, accepted.reasons.join('\n'));
  assert.equal(accepted.outputKind, 'candidate_only');
  assert.equal(accepted.mutatesBaseline, false);

  const threshold = evolution.evaluatePolicyLearning({
    target: 'scientific_threshold',
    controls: ['privacy_boundary', 'explainable', 'versioned', 'replayable', 'rollbackable'],
  });
  assert.equal(threshold.accepted, false);
  assert.ok(threshold.reasons.includes('immutable_target:scientific_threshold'));

  const direct = evolution.evaluatePolicyLearning({
    target: 'cache_hint',
    controls: ['privacy_boundary', 'explainable', 'versioned', 'replayable', 'rollbackable'],
    mutatesBaselineDirectly: true,
  });
  assert.equal(direct.accepted, false);
  assert.ok(direct.reasons.includes('direct_baseline_mutation'));

  const missingControls = evolution.evaluatePolicyLearning({ target: 'model_hint', controls: ['versioned'] });
  assert.equal(missingControls.accepted, false);
  assert.ok(missingControls.reasons.some((r) => r.startsWith('control_missing:')));
});

test('LF11 forbids second execution truth and implicit scientific drift', () => {
  assert.ok(evolution.contract.forbidden.includes('second_execution_or_workflow_truth'));
  assert.ok(evolution.contract.forbidden.includes('implicit_online_scientific_threshold_drift'));
  assert.equal(g0.manifest.executionTruthChain.join(','), 'run_tool,tool_job,artifact_truth');
});
