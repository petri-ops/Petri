'use strict';

const crypto = require('crypto');
const inventory = require('./g0/durable-state-inventory.json');

const DURABLE_STATE_VERSION = 1;

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildRecoveryPlan(snapshot = {}) {
  const issues = [];
  const add = (objectType, objectId, outcome, reason) => {
    issues.push({ objectType, objectId: objectId || null, outcome, reason });
  };
  for (const job of snapshot.toolJobs || []) {
    if (job.status === 'running') add('tool_job', job.id, 'recovery_required', 'process_interrupted');
    if (job.status === 'completed' && job.artifactTruthStatus !== 'valid') {
      add('artifact', job.id, 'recovery_required', 'completion_without_valid_artifact_truth');
    }
  }
  for (const run of snapshot.loopRuns || []) {
    if (run.loopStatus === 'running') add('loop_run', run.loopRunId, 'recovery_required', 'loop_interrupted');
  }
  for (const checkpoint of snapshot.checkpoints || []) {
    if (checkpoint.valid === false) add('context_checkpoint', checkpoint.id, 'partial_history', 'checkpoint_invalid');
  }
  if (snapshot.migration?.status === 'failed') add('g0_baseline', snapshot.migration.id, 'blocked', 'migration_failed');
  if (snapshot.database?.integrity === 'failed') add('project', snapshot.projectId, 'blocked', 'database_integrity_failed');
  const outcomeOrder = ['blocked', 'recovery_required', 'partial_history', 'waiting_for_user', 'retry_safe', 'resume_safe'];
  const outcome = outcomeOrder.find((candidate) => issues.some((item) => item.outcome === candidate)) || 'resume_safe';
  const plan = {
    durableStateVersion: DURABLE_STATE_VERSION,
    projectId: snapshot.projectId || null,
    outcome,
    safeToResume: outcome === 'resume_safe',
    issues: issues.sort((a, b) => `${a.objectType}:${a.objectId}`.localeCompare(`${b.objectType}:${b.objectId}`)),
  };
  return Object.freeze({ ...plan, planHash: hash(plan) });
}

function validateDurableInventory() {
  const ids = inventory.objects.map((item) => item.id);
  const outcomes = new Set(inventory.allowedRecoveryOutcomes);
  const issues = [];
  if (new Set(ids).size !== ids.length) issues.push('durable_object_duplicate');
  for (const item of inventory.objects) {
    if (!item.owner || !item.store) issues.push(`durable_owner_missing:${item.id}`);
    if (!outcomes.has(item.recovery)) issues.push(`durable_recovery_invalid:${item.id}`);
  }
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
}

module.exports = { DURABLE_STATE_VERSION, inventory, buildRecoveryPlan, validateDurableInventory };
