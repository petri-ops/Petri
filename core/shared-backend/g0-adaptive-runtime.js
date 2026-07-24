'use strict';

const crypto = require('crypto');
const contract = require('./g0/adaptive-runtime.json');
const { isResourceSnapshotFresh } = require('./runtime-resource-snapshot');

const ADAPTIVE_RUNTIME_VERSION = 1;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value, Object.keys(value || {}).sort())).digest('hex');

function planRuntimeAction({ snapshot, job = {}, readiness = {}, now = Date.now() } = {}) {
  const issues = [];
  if (!snapshot || !isResourceSnapshotFresh(snapshot, now)) issues.push('resource_snapshot_stale');
  for (const key of contract.readinessRequired.slice(0, 3)) if (readiness[key] !== true) issues.push(`${key}_not_ready`);
  const state = snapshot?.state || 'unavailable';
  let action = 'run';
  if (issues.length) action = 'block';
  else if (state === 'unavailable') action = job.checkpointable === true ? 'pause' : 'block';
  else if (state === 'warning') action = job.chunkable === true ? 'chunk' : 'queue';
  const decision = {
    adaptiveRuntimeVersion: ADAPTIVE_RUNTIME_VERSION,
    action,
    issues,
    adjustment: action === 'chunk' ? { kind: 'chunk_size', preservesScientificMethod: true } : null,
    scientificMethodChanged: false,
    resumeRequiresReconciliation: action === 'pause',
  };
  return Object.freeze({ ...decision, decisionHash: hash(decision) });
}

function validateRuntimeAdjustment(adjustment = {}) {
  const changed = adjustment.changedFields || [];
  const forbidden = ['method', 'parameters', 'seed_semantics', 'sample_inclusion'];
  const scientificChanges = changed.filter((field) => forbidden.includes(field));
  return Object.freeze({
    allowedAsResourceRepair: scientificChanges.length === 0 && contract.safeAdjustments.includes(adjustment.kind),
    scientificChanges,
    requiresScientificDecision: scientificChanges.length > 0,
  });
}

module.exports = { ADAPTIVE_RUNTIME_VERSION, contract, planRuntimeAction, validateRuntimeAdjustment };
