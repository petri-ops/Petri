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

function buildDurableExportManifest({ projectId, objects = [], files = [] } = {}) {
  if (!projectId) throw new Error('durable_export_project_required');
  const normalizedObjects = objects.map((item) => ({
    type: item.type,
    id: item.id,
    version: item.version ?? null,
    digest: item.digest,
  })).sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
  const normalizedFiles = files.map((item) => ({
    relativePath: item.relativePath,
    sha256: item.sha256,
    sizeBytes: item.sizeBytes,
  })).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const body = {
    durableExportVersion: DURABLE_STATE_VERSION,
    projectId,
    objects: normalizedObjects,
    files: normalizedFiles,
  };
  return Object.freeze({ ...body, manifestHash: hash(body) });
}

function verifyDurableExportManifest(manifest = {}) {
  const { manifestHash, ...body } = manifest;
  const issues = [];
  if (!manifest.projectId) issues.push('project_missing');
  if (!Array.isArray(manifest.objects) || !Array.isArray(manifest.files)) issues.push('inventory_missing');
  if (manifestHash !== hash(body)) issues.push('manifest_hash_mismatch');
  for (const file of manifest.files || []) {
    if (!file.relativePath || file.relativePath.startsWith('/') || file.relativePath.includes('..')) issues.push('file_path_invalid');
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || '')) issues.push('file_hash_invalid');
  }
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze([...new Set(issues)]) });
}

function appendRecoveryAudit(timeline = [], event = {}) {
  if (!event.eventId || !event.occurredAt || !event.outcome) throw new Error('recovery_audit_event_invalid');
  const existing = timeline.find((item) => item.eventId === event.eventId);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(event)) throw new Error('recovery_audit_event_conflict');
    return Object.freeze(timeline.map((item) => Object.freeze({ ...item })));
  }
  return Object.freeze([...timeline, Object.freeze({ ...event })]);
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

module.exports = {
  DURABLE_STATE_VERSION,
  inventory,
  buildRecoveryPlan,
  buildDurableExportManifest,
  verifyDurableExportManifest,
  appendRecoveryAudit,
  validateDurableInventory,
};
