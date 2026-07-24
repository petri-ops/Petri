'use strict';

const crypto = require('crypto');
const truthContract = require('./g0/truth-lattice.json');

const TRUTH_PROJECTION_VERSION = 1;
const TERMINAL = new Set(['completed', 'blocked', 'failed', 'cancelled', 'needs_review', 'recovery_required']);

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function parse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function layer(id, status, authority, evidence = []) {
  return Object.freeze({ id, status, authority, evidence: [...new Set(evidence.filter(Boolean))].sort() });
}

function normalizeJobStatus(value) {
  const status = String(value || 'pending').toLowerCase();
  return ['pending', 'queued'].includes(status) ? 'pending'
    : status === 'running' ? 'running'
      : ['completed', 'failed', 'cancelled'].includes(status) ? status
        : 'blocked';
}

function buildTruthProjection({ job = {}, deliveryManifest = null, scientificValidation = null, presentation = null } = {}) {
  const result = parse(job.result_json || job.result, {});
  const jobStatus = normalizeJobStatus(job.status);
  const recovery = String(job.error || '').includes('recovery_required');
  const artifact = result.artifactTruth || null;
  const scientific = scientificValidation || result.scientificValidation || null;
  const delivery = deliveryManifest || result.deliveryManifest || null;
  const jobLayer = layer('job', recovery ? 'recovery_required' : jobStatus, 'tool_jobs', [job.id]);
  const artifactStatus = artifact
    ? artifact.blocking === true || artifact.status === 'blocked' ? 'blocked'
      : artifact.status === 'degraded' ? 'needs_review'
        : artifact.status === 'valid' ? 'completed' : 'pending'
    : 'pending';
  const artifactLayer = layer('artifact', artifactStatus, 'artifactTruth', [
    result.executionProvenance?.provenanceHash,
    result.artifactManifest?.manifestHash,
  ]);
  const scientificState = scientific?.truthStatus || scientific?.status;
  const scientificStatus = scientific
    ? scientific.blocking === true || scientificState === 'blocked' ? 'blocked'
      : ['valid', 'not_applicable', 'passed'].includes(scientificState) ? 'completed'
        : ['degraded', 'needs_review'].includes(scientificState) ? 'needs_review' : 'pending'
    : artifactStatus === 'completed' ? 'pending' : artifactStatus;
  const scientificLayer = layer('scientific', scientificStatus, 'validatorEvidence', [
    scientific?.evidenceHash,
  ]);
  const deliveryStatus = delivery
    ? delivery.status === 'valid' ? 'completed'
      : delivery.status === 'degraded' ? 'needs_review' : 'blocked'
    : 'pending';
  const deliveryLayer = layer('delivery', deliveryStatus, 'DeliveryManifest', [
    delivery?.manifestHash,
  ]);
  const upstream = [jobLayer, artifactLayer, scientificLayer, deliveryLayer];
  const precedence = truthContract.precedence;
  const aggregate = precedence.find((status) => upstream.some((item) => item.status === status)) || 'pending';
  const completionAllowed = upstream.every((item) => item.status === 'completed');
  const publicStatus = completionAllowed ? 'completed' : aggregate;
  const presentationLayer = layer(
    'presentation',
    presentation?.status === 'completed' && !completionAllowed ? publicStatus : publicStatus,
    'derived_projection_only',
    [presentation?.evidenceHash],
  );
  const projection = {
    truthProjectionVersion: TRUTH_PROJECTION_VERSION,
    subject: { jobId: job.id || null, toolId: job.tool_id || job.toolId || null },
    status: publicStatus,
    completionAllowed,
    terminal: TERMINAL.has(publicStatus),
    layers: [...upstream, presentationLayer],
    invalidationFingerprint: result.invalidationFingerprint || null,
    derivedAt: job.updated_at || job.completed_at || job.created_at || null,
  };
  return Object.freeze({ ...projection, projectionHash: digest(projection) });
}

function evaluateInvalidation({ recorded, current } = {}) {
  if (!recorded || !current) return Object.freeze({ status: 'unknown', invalidated: true, changed: ['fingerprint_missing'] });
  const fields = truthContract.invalidationFingerprintFields;
  const changed = fields.filter((field) => canonical(recorded[field] ?? null) !== canonical(current[field] ?? null));
  return Object.freeze({
    status: changed.length ? 'invalidated' : 'current',
    invalidated: changed.length > 0,
    changed,
    recordedDigest: digest(recorded),
    currentDigest: digest(current),
  });
}

function reduceTruthEvents(events = []) {
  const unique = new Map();
  for (const event of events) {
    if (!event?.eventId) continue;
    const existing = unique.get(event.eventId);
    if (!existing || canonical(existing) === canonical(event)) unique.set(event.eventId, event);
  }
  const ordered = [...unique.values()].sort((a, b) =>
    Number(a.sequence || 0) - Number(b.sequence || 0)
    || String(a.occurredAt || '').localeCompare(String(b.occurredAt || ''))
    || String(a.eventId).localeCompare(String(b.eventId))
  );
  return Object.freeze({
    events: Object.freeze(ordered.map((item) => Object.freeze({ ...item }))),
    eventDigest: digest(ordered),
    duplicateCount: Math.max(0, events.length - unique.size),
  });
}

module.exports = {
  TRUTH_PROJECTION_VERSION,
  buildTruthProjection,
  evaluateInvalidation,
  reduceTruthEvents,
};
