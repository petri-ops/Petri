import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { P5_NO_SEED_TABLES, P5_SOURCE_FILES } from '../scripts/g0-rs-p5-acceptance.mjs';

import {
  P6_PRODUCT_SCENARIO_CLASSIFICATION,
  P6_PRODUCT_SCENARIO_SOURCE_FILES,
  assertSanitizedP6ProductScenarioObservation,
  captureP6ControlledTransportScenario,
  captureP6ProductScenarios,
  evaluateP6GcColdReadbackObservation,
  evaluateP6NoSeedPrecondition,
  evaluateP6ProductScenarios,
  evaluateP6ProviderTransportObservation,
  evaluateP6ResourceBudgetObservation,
  evaluateP6StaleAdoptionObservation,
  projectP6ResourceEstimateForEvidence,
  sanitizeP6ProductScenarioObservation,
} from '../scripts/g0-rs-p6-product-scenarios.mjs';

test('P6 product scenario source map retains P5 truth and its direct runtime loaders', () => {
  for (const [key, relative] of Object.entries(P5_SOURCE_FILES)) {
    assert.equal(P6_PRODUCT_SCENARIO_SOURCE_FILES[key], relative, key);
  }
  for (const relative of [
    'package-lock.json',
    'frontend/package-lock.json',
    'src/migration-runner.js',
    'src/migrations/001_result_studio.sql',
    'core/shared-backend/result-studio-contracts.js',
    'core/shared-backend/result-studio-schema.js',
    'core/shared-backend/scientific-task-spec.js',
    'core/shared-backend/llm-providers/index.js',
    'core/shared-backend/ai-usage-helper.js',
    'core/shared-backend/logger.js',
  ]) {
    assert.ok(Object.values(P6_PRODUCT_SCENARIO_SOURCE_FILES).includes(relative), relative);
  }
});

function providerFixture() {
  return {
    classification: P6_PRODUCT_SCENARIO_CLASSIFICATION.providerObservation,
    adapter: 'openai-compatible/DeepSeekProvider',
    loopbackOnly: true,
    realProvider: false,
    p7Eligible: false,
    cases: [503, 429].map((status) => ({
      status,
      retryable: true,
      requestPath: '/v1/chat/completions',
      requestModels: [`primary-${status}`, `fallback-${status}`],
      requestStatuses: [status, 200],
      requestCount: 2,
      routingEvent: {
        type: 'model_fallback',
        fromProfileId: `p6-primary-${status}`,
        toProfileId: `p6-fallback-${status}`,
        reason: { code: 'http_error', status },
      },
      modelRouting: {
        role: 'chat',
        profileId: `p6-fallback-${status}`,
        fallbackFrom: `p6-primary-${status}`,
        fallbackReason: { code: 'http_error', status },
      },
      recovered: true,
    })),
  };
}

function resourceFixture() {
  const estimate = {
    estimateVersion: 1,
    source: 'server_job_descriptor_input_truth',
    memoryBytes: 512 * 1024 * 1024,
    diskBytes: 64 * 1024 * 1024,
  };
  return {
    classification: 'real_product_changeset_preflight_no_seed',
    sourceScientificParametersUnchanged: true,
    memoryBlocked: {
      error: 'preview_resource_budget_blocked',
      decision: 'blocked',
      reasons: ['memory_budget_exceeded'],
      scientificParametersChanged: false,
      resourceEstimate: estimate,
      measurement: 'host_statfs_and_runtime_snapshot',
      noJobOrChangeSetOrRevisionOrCheckpointWrite: true,
    },
    diskBlocked: {
      error: 'preview_resource_budget_blocked',
      decision: 'blocked',
      reasons: ['disk_budget_exceeded'],
      scientificParametersChanged: false,
      resourceEstimate: estimate,
      measurement: 'controlled_statfs_dependency_fault',
      noJobOrChangeSetOrRevisionOrCheckpointWrite: true,
    },
    queued: {
      error: 'preview_resource_queued',
      decision: 'queued',
      reasons: ['preview_concurrency_saturated'],
      scientificParametersChanged: false,
      noJobOrChangeSetOrRevisionOrCheckpointWrite: true,
      activePreviewJobs: 2,
    },
    holders: {
      createdByProductService: true,
      realToolExecution: true,
      previewReadyCount: 2,
    },
  };
}

function noSeedFixture() {
  const tableCounts = Object.fromEntries(P5_NO_SEED_TABLES.map((table) => [table, 0]));
  const canonical = Object.fromEntries(Object.keys(tableCounts).sort().map((key) => [key, tableCounts[key]]));
  return {
    tables: [...P5_NO_SEED_TABLES],
    tableCounts,
    seededTables: [],
    digest: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
  };
}

function staleFixture() {
  return {
    classification: 'real_no_seed_same_family_candidate_adoption_race',
    secondAdopted: true,
    staleHttpStatus: 409,
    staleError: 'adoption_base_stale',
    noPartialMutation: true,
    firstCandidateRemainsPreviewReady: true,
    secondCandidateRemainsAdopted: true,
    adoptedCohortCurrent: true,
    stateDigestBeforeFailure: 'a'.repeat(64),
    stateDigestAfterFailure: 'a'.repeat(64),
  };
}

function gcFixture() {
  return {
    classification: 'real_product_http_gc_then_managed_git_gc_and_same_disk_cold_boot',
    httpPlanMode: 'dry_run',
    httpExecutionMode: 'executed',
    planVersion: 2,
    artifactDeletionCount: 0,
    sourceRevisionCount: 12,
    sourceCommitCount: 6,
    protectedSourceRefCount: 6,
    gitGc: { exitCode: 0 },
    ledgerExact: true,
    revisionsExact: true,
    changeSetsExact: true,
    checkpointsExact: true,
    jobsExact: true,
    physicalHashesExact: true,
    scriptsExact: true,
    historyExact: true,
    adoptedCurrentHistoryPresent: true,
    nonterminalPreviewPreserved: true,
    checkpointTruthPreserved: true,
    coldWorkspaceNotBlocked: true,
  };
}

test('P6 controlled 503/429 uses the real loopback OpenAI-compatible transport and fallback classifier', async () => {
  const observation = await captureP6ControlledTransportScenario();
  assert.equal(evaluateP6ProviderTransportObservation(observation), true);
  assert.deepEqual(observation.cases.map((entry) => entry.status), [503, 429]);
  assert.equal(observation.realProvider, false);
  assert.equal(observation.p7Eligible, false);
});

test('P6 product evaluators reject weakened budget, stale adoption and GC truth', () => {
  assert.equal(evaluateP6NoSeedPrecondition(noSeedFixture()), true);
  assert.equal(evaluateP6NoSeedPrecondition({
    ...noSeedFixture(),
    seededTables: ['artifact_revisions'],
  }), false);
  assert.equal(evaluateP6NoSeedPrecondition({
    ...noSeedFixture(),
    tables: ['projects'],
    tableCounts: { projects: 0 },
  }), false);
  assert.equal(evaluateP6NoSeedPrecondition({
    ...noSeedFixture(),
    digest: 'c'.repeat(64),
  }), false);

  assert.equal(evaluateP6ResourceBudgetObservation(resourceFixture()), true);
  assert.equal(evaluateP6ResourceBudgetObservation({
    ...resourceFixture(),
    diskBlocked: { ...resourceFixture().diskBlocked, noJobOrChangeSetOrRevisionOrCheckpointWrite: false },
  }), false);

  assert.equal(evaluateP6StaleAdoptionObservation(staleFixture()), true);
  assert.equal(evaluateP6StaleAdoptionObservation({
    ...staleFixture(),
    stateDigestAfterFailure: 'b'.repeat(64),
  }), false);

  assert.equal(evaluateP6GcColdReadbackObservation(gcFixture()), true);
  assert.equal(evaluateP6GcColdReadbackObservation({
    ...gcFixture(),
    nonterminalPreviewPreserved: false,
  }), false);
});

test('P6 resource estimate evidence replaces the selected Revision ID with a digest', () => {
  const projected = projectP6ResourceEstimateForEvidence({
    ...resourceFixture().memoryBlocked.resourceEstimate,
    selectedRevisionId: 'rev_private123',
    inputBytes: 128,
  });
  assert.equal('selectedRevisionId' in projected, false);
  assert.match(projected.selectedRevisionDigest, /^[a-f0-9]{64}$/);
  assert.equal(projected.inputBytes, 128);
});

test('P6 aggregate remains explicitly non-Provider, non-packaged, non-qualifying and P7-excluded', () => {
  const observation = {
    classification: P6_PRODUCT_SCENARIO_CLASSIFICATION,
    transport: providerFixture(),
    product: {
      noSeedPrecondition: noSeedFixture(),
      resourceBudget: resourceFixture(),
      staleAdoption: staleFixture(),
      gcColdReadback: gcFixture(),
    },
  };
  assert.deepEqual(evaluateP6ProductScenarios(observation), {
    passed: true,
    checks: {
      controlledTransport: true,
      noSeedLedger: true,
      resourceBudget: true,
      staleAdoption: true,
      gcColdReadback: true,
      exclusionsExplicit: true,
    },
  });
  assert.equal(evaluateP6ProductScenarios({
    ...observation,
    classification: { ...P6_PRODUCT_SCENARIO_CLASSIFICATION, realProvider: true },
  }).passed, false);
});

test('P6 observation sanitizer refuses local coordinates while preserving bounded digests', () => {
  const safe = sanitizeP6ProductScenarioObservation({
    requestPath: '/v1/chat/completions',
    projectDigest: 'a'.repeat(64),
    classification: P6_PRODUCT_SCENARIO_CLASSIFICATION,
  });
  assert.equal(assertSanitizedP6ProductScenarioObservation(safe), true);
  assert.throws(
    () => assertSanitizedP6ProductScenarioObservation({ dbPath: '/tmp/private.sqlite' }),
    /p6_product_observation_private_key/,
  );
  assert.throws(
    () => assertSanitizedP6ProductScenarioObservation({ endpoint: 'http://127.0.0.1:3003' }),
    /p6_product_observation_loopback_url/,
  );
});

test('P6 no-seed product scenarios pass against the disposable real runtime', {
  skip: process.env.BIOF3_P6_RUN_PRODUCT_SCENARIOS !== '1',
  timeout: 10 * 60 * 1000,
}, async () => {
  const observation = await captureP6ProductScenarios({ verbose: process.env.BIOF3_P6_VERBOSE === '1' });
  const evaluation = evaluateP6ProductScenarios(observation);
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
  assert.equal(assertSanitizedP6ProductScenarioObservation(observation), true);
});
