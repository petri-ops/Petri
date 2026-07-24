import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const runtime = require('../core/shared-backend/g0-adaptive-runtime');
const memory = require('../core/shared-backend/g0-model-memory-cost');
const observable = require('../core/shared-backend/g0-observable-experience');
const { createRuntimeResourceSnapshot } = require('../core/shared-backend/runtime-resource-snapshot');

const ready = () => createRuntimeResourceSnapshot({
  observedAt: '2026-07-24T00:00:00.000Z',
  availableMemoryBytes: 8e9,
  totalMemoryBytes: 16e9,
  disk: { availableBytes: 20e9, totalBytes: 100e9 },
});
const readiness = { runtime: true, packages: true, plugin: true, disk: true, memory: true };

test('third-wave baseline remains establishing and exposes LF5/LF6/LF9 contracts', () => {
  const validation = g0.validateG0BaselineBundle();
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.ok(Number(g0.manifest.baselineVersion.split('.')[1]) >= 4);
  assert.equal(g0.manifest.qualificationStatus, 'not_yet_qualified');
  assert.equal(g0.adaptiveRuntime.contractVersion, 1);
  assert.equal(g0.modelMemoryCost.contractVersion, 1);
  assert.equal(g0.observableExperience.contractVersion, 1);
});

test('LF5 runs only with fresh resources and ready capabilities', () => {
  const plan = runtime.planRuntimeAction({ snapshot: ready(), readiness, now: Date.parse('2026-07-24T00:00:01.000Z') });
  assert.equal(plan.action, 'run');
  assert.equal(plan.scientificMethodChanged, false);
  assert.match(plan.decisionHash, /^[a-f0-9]{64}$/);
});

test('LF5 warning resources chunk or queue without changing science', () => {
  const snapshot = createRuntimeResourceSnapshot({ observedAt: '2026-07-24T00:00:00.000Z', availableMemoryBytes: 1e9, totalMemoryBytes: 16e9, disk: { availableBytes: 20e9 } });
  assert.equal(runtime.planRuntimeAction({ snapshot, readiness, job: { chunkable: true }, now: Date.parse('2026-07-24T00:00:01.000Z') }).action, 'chunk');
  assert.equal(runtime.planRuntimeAction({ snapshot, readiness, job: { chunkable: false }, now: Date.parse('2026-07-24T00:00:01.000Z') }).action, 'queue');
});

test('LF5 unavailable resources pause checkpointable work and block unsafe work', () => {
  const snapshot = createRuntimeResourceSnapshot({ observedAt: '2026-07-24T00:00:00.000Z', availableMemoryBytes: 100e6, totalMemoryBytes: 16e9, disk: { availableBytes: 20e9 } });
  assert.equal(runtime.planRuntimeAction({ snapshot, readiness, job: { checkpointable: true }, now: Date.parse('2026-07-24T00:00:01.000Z') }).action, 'pause');
  assert.equal(runtime.planRuntimeAction({ snapshot, readiness, job: {}, now: Date.parse('2026-07-24T00:00:01.000Z') }).action, 'block');
});

test('LF5 scientific changes cannot masquerade as runtime repair', () => {
  assert.equal(runtime.validateRuntimeAdjustment({ kind: 'chunk_size', changedFields: ['chunk_size'] }).allowedAsResourceRepair, true);
  const invalid = runtime.validateRuntimeAdjustment({ kind: 'chunk_size', changedFields: ['method'] });
  assert.equal(invalid.allowedAsResourceRepair, false);
  assert.equal(invalid.requiresScientificDecision, true);
});

test('LF6 compression preserves every durable fact across model switches', () => {
  const facts = [{ factId: 'task', kind: 'task_spec', value: 'x' }, { factId: 'result', kind: 'public_conclusion', value: 'y' }];
  const valid = memory.validateCompression({ beforeFacts: facts, afterFacts: facts, trigger: 'model_switch', sourceCheckpointHash: 'a'.repeat(64) });
  assert.equal(valid.valid, true);
  assert.equal(memory.validateCompression({ beforeFacts: facts, afterFacts: facts.slice(0, 1), trigger: 'model_switch', sourceCheckpointHash: 'a'.repeat(64) }).valid, false);
});

test('LF6 cache identity requires project, model, inputs, parameters and contract boundaries', () => {
  const fields = Object.fromEntries(memory.contract.cacheFingerprintFields.map((field) => [field, `${field}-1`]));
  const identity = memory.buildCacheIdentity(fields);
  assert.equal(identity.valid, true);
  assert.match(identity.cacheKey, /^[a-f0-9]{64}$/);
  assert.equal(memory.buildCacheIdentity({ ...fields, project: null }).valid, false);
});

test('LF6 usage combines tokens, cache and cost without hiding mixed currency', () => {
  const usage = memory.aggregateUsage([
    { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cost: 0.1, currency: 'CNY' },
    { inputTokens: 5, outputTokens: 1, cacheWriteTokens: 4, cost: 0.2, currency: 'CNY' },
  ]);
  assert.deepEqual(usage, { inputTokens: 15, outputTokens: 3, cacheReadTokens: 3, cacheWriteTokens: 4, cost: 0.30000000000000004, currency: 'CNY', entryCount: 2 });
});

test('LF6 provider fallback must be compatible, allowed, audited and science-neutral', () => {
  assert.equal(memory.evaluateProviderFallback({ capabilityCompatible: true, policyAllowed: true, auditRecorded: true, scientificGatesUnchanged: true }).allowed, true);
  const denied = memory.evaluateProviderFallback({ capabilityCompatible: true, policyAllowed: true, auditRecorded: false, scientificGatesUnchanged: true });
  assert.equal(denied.allowed, false);
  assert.equal(denied.silent, true);
});

test('LF9 projection carries one honest status to every consumer', () => {
  const projection = observable.buildObservableProjection({
    truthProjection: { status: 'needs_review', completionAllowed: false },
    publicConclusion: '低功效，结果需要审阅。',
    durable: { persisted: true },
    runtimeSnapshot: ready(),
    usage: { inputTokens: 10, cost: 0.1 },
  });
  assert.equal(projection.status, 'needs_review');
  assert.equal(projection.completionAllowed, false);
  assert.equal(projection.persisted, true);
  assert.deepEqual(projection.consumers, ['chat', 'summary', 'task_detail', 'file_tree', 'result_view']);
});

test('LF9 unresolved errors expose reason, impact, action and retry status', () => {
  const projection = observable.buildObservableProjection({
    truthProjection: { status: 'blocked', completionAllowed: false },
    error: { reason: 'runtime_missing', impact: 'analysis_blocked', action: 'prepare_runtime', retryStatus: 'automatic_retry_exhausted' },
  });
  assert.deepEqual(Object.keys(projection.issue), ['reason', 'impact', 'action', 'retryStatus']);
  assert.equal(projection.status, 'blocked');
});
