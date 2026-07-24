'use strict';

const crypto = require('crypto');
const contract = require('./g0/observable-experience.json');

const OBSERVABLE_EXPERIENCE_VERSION = 1;
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function buildObservableProjection({
  truthProjection,
  publicConclusion = null,
  durable = null,
  scientificValidation = null,
  driftReport = null,
  runtimeSnapshot = null,
  usage = null,
  error = null,
} = {}) {
  const status = truthProjection?.status || durable?.status || 'pending';
  const issue = error ? {
    reason: error.reason || 'unknown_error',
    impact: error.impact || 'task_progress_unknown',
    action: error.action || 'inspect_evidence',
    retryStatus: error.retryStatus || 'not_evaluated',
  } : null;
  const projection = {
    observableExperienceVersion: OBSERVABLE_EXPERIENCE_VERSION,
    status,
    completionAllowed: truthProjection?.completionAllowed === true,
    publicConclusion,
    persisted: durable?.persisted === true,
    scientific: scientificValidation ? { outcome: scientificValidation.outcome, truthStatus: scientificValidation.truthStatus, evidenceHash: scientificValidation.evidenceHash } : null,
    drift: driftReport ? { classification: driftReport.classification, reviewRequired: driftReport.reviewRequired, reportHash: driftReport.reportHash } : null,
    runtime: runtimeSnapshot ? { state: runtimeSnapshot.state, activeJobs: runtimeSnapshot.activeJobs, observedAt: runtimeSnapshot.observedAt } : null,
    usage: usage ? { ...usage } : null,
    issue,
    consumers: contract.consumers,
    defaultDetail: contract.defaultDetail,
  };
  return Object.freeze({ ...projection, projectionHash: digest(projection) });
}

module.exports = { OBSERVABLE_EXPERIENCE_VERSION, contract, buildObservableProjection };
