import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const truth = require('../core/shared-backend/g0-truth-projection');
const durable = require('../core/shared-backend/g0-durable-state');
const { projectHarnessWorkflowJob } = require('../core/r-server/helpers/harness-workflow-state');

function validJob(overrides = {}) {
  return {
    id: 'job_truth_1',
    tool_id: 'deseq2',
    status: 'completed',
    result_json: JSON.stringify({
      artifactTruth: { status: 'valid', blocking: false, validCount: 2 },
      scientificValidation: { status: 'valid', blocking: false, evidenceHash: 'a'.repeat(64) },
      artifacts: [{ filename: 'deg.csv' }],
    }),
    ...overrides,
  };
}

test('first-wave contracts remain valid across compatible later 0.x baselines', () => {
  const validation = g0.validateG0BaselineBundle();
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.ok(g0.parseMajor(g0.manifest.baselineVersion) >= 1);
  assert.equal(g0.manifest.qualificationStatus, 'qualified');
  assert.ok(g0.registry.baselines.length >= 2);
  const old = g0.evaluateProjectBaselineCompatibility({
    createdBaselineId: 'g0-lf0-establishing-0.1',
    createdBaselineVersion: '0.1.0',
  });
  assert.equal(old.status, 'compatible');
  assert.equal(old.reason, 'compatible_baseline_upgrade');
});

test('LF1 false completion is impossible when any authoritative layer is missing or blocked', () => {
  const missingDelivery = truth.buildTruthProjection({ job: validJob() });
  assert.equal(missingDelivery.completionAllowed, false);
  assert.equal(missingDelivery.status, 'pending');

  const blocked = truth.buildTruthProjection({
    job: validJob({
      result_json: JSON.stringify({
        artifactTruth: { status: 'blocked', blocking: true },
        scientificValidation: { status: 'valid' },
      }),
    }),
    deliveryManifest: { status: 'valid', manifestHash: 'b'.repeat(64) },
    presentation: { status: 'completed' },
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.completionAllowed, false);
  assert.equal(blocked.layers.at(-1).status, 'blocked');
});

test('LF1 completion requires job, artifact, scientific and delivery truth simultaneously', () => {
  const projection = truth.buildTruthProjection({
    job: validJob(),
    deliveryManifest: { status: 'valid', manifestHash: 'b'.repeat(64) },
  });
  assert.equal(projection.status, 'completed');
  assert.equal(projection.completionAllowed, true);
  assert.equal(projection.terminal, true);
  assert.match(projection.projectionHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(projection.layers.map((item) => item.id), [
    'job', 'artifact', 'scientific', 'delivery', 'presentation',
  ]);
});

test('LF1 projection is idempotent for duplicates and deterministic for late events', () => {
  const events = [
    { eventId: 'e2', sequence: 2, occurredAt: '2026-01-02', status: 'completed' },
    { eventId: 'e1', sequence: 1, occurredAt: '2026-01-01', status: 'running' },
    { eventId: 'e2', sequence: 2, occurredAt: '2026-01-02', status: 'completed' },
  ];
  const reduced = truth.reduceTruthEvents(events);
  const reversed = truth.reduceTruthEvents([...events].reverse());
  assert.equal(reduced.duplicateCount, 1);
  assert.deepEqual(reduced.events.map((item) => item.eventId), ['e1', 'e2']);
  assert.equal(reduced.eventDigest, reversed.eventDigest);
});

test('LF1 invalidation binds inputs, parameters, environment, code and artifacts', () => {
  const recorded = {
    inputs: 'i1', parameters: 'p1', environment: 'e1', code: 'c1', artifacts: 'a1',
  };
  assert.equal(truth.evaluateInvalidation({ recorded, current: { ...recorded } }).invalidated, false);
  const changed = truth.evaluateInvalidation({
    recorded,
    current: { ...recorded, code: 'c2', artifacts: 'a2' },
  });
  assert.equal(changed.invalidated, true);
  assert.deepEqual(changed.changed, ['code', 'artifacts']);
});

test('production workflow projection exposes the same LF1 truth without replacing stage compatibility', () => {
  const view = projectHarnessWorkflowJob(validJob());
  assert.equal(view.harnessWorkflowStateVersion, 1);
  assert.equal(view.stages.find((stage) => stage.id === 'verify').status, 'completed');
  assert.equal(view.truthProjection.truthProjectionVersion, 1);
  assert.equal(view.truthProjection.completionAllowed, false);
});

test('LF2 inventory assigns one durable owner and an allowed recovery outcome to every object', () => {
  const validation = durable.validateDurableInventory();
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.ok(durable.inventory.objects.length >= 13);
  assert.ok(durable.inventory.failureClasses.includes('migration_failure'));
  assert.ok(durable.inventory.failureClasses.includes('partial_artifact_write'));
});

test('LF2 recovery plan never silently resumes interrupted or contradictory truth', () => {
  const plan = durable.buildRecoveryPlan({
    projectId: 'project_1',
    toolJobs: [
      { id: 'job_running', status: 'running' },
      { id: 'job_false', status: 'completed', artifactTruthStatus: 'blocked' },
    ],
    loopRuns: [{ loopRunId: 'loop_1', loopStatus: 'running' }],
    checkpoints: [{ id: 'cp_bad', valid: false }],
  });
  assert.equal(plan.safeToResume, false);
  assert.equal(plan.outcome, 'recovery_required');
  assert.equal(plan.issues.length, 4);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
});

test('LF2 migration or database integrity failure blocks instead of fabricating a new history', () => {
  const plan = durable.buildRecoveryPlan({
    projectId: 'project_2',
    migration: { id: 'migration_2', status: 'failed' },
    database: { integrity: 'failed' },
  });
  assert.equal(plan.outcome, 'blocked');
  assert.equal(plan.safeToResume, false);
});

test('LF2 project export is deterministic, path-bounded and integrity-verifiable', () => {
  const manifest = durable.buildDurableExportManifest({
    projectId: 'project_export',
    objects: [{ type: 'task_spec', id: 'task_1', version: 1, digest: 'b'.repeat(64) }],
    files: [{ relativePath: 'results/job_1/deg.csv', sha256: 'a'.repeat(64), sizeBytes: 42 }],
  });
  assert.equal(durable.verifyDurableExportManifest(manifest).ok, true);
  assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(durable.verifyDurableExportManifest({ ...manifest, projectId: 'tampered' }).ok, false);
});

test('LF2 recovery audit is append-only, idempotent and conflict-detecting', () => {
  const event = {
    eventId: 'recovery_1',
    occurredAt: '2026-07-24T00:00:00.000Z',
    outcome: 'recovery_required',
  };
  const once = durable.appendRecoveryAudit([], event);
  const twice = durable.appendRecoveryAudit(once, event);
  assert.equal(twice.length, 1);
  assert.throws(
    () => durable.appendRecoveryAudit(once, { ...event, outcome: 'resume_safe' }),
    /recovery_audit_event_conflict/,
  );
});

test('LF7 and LF8 foundation contracts preserve supply-chain and full-access invariants', () => {
  assert.ok(g0.capabilitySupplyChain.requiredControls.includes('content_hash_verification'));
  assert.ok(g0.capabilitySupplyChain.forbidden.includes('plugin_owned_job_or_artifact_ledger'));
  assert.ok(g0.securityPermissionMatrix.nonOverridableBoundaries.includes('single_execution_truth'));
  assert.ok(g0.securityPermissionMatrix.fullAccessStillBlocks.includes('cross_project_access'));
  assert.ok(g0.securityPermissionMatrix.fullAccessStillBlocks.includes('scientific_source_overwrite'));
});
