'use strict';

/**
 * g0-baseline-qualification.js — G0-LF12 Baseline Qualification engine.
 *
 * This module qualifies the SEALED current G0 baseline bundle without mutating
 * it. The baseline bundle (constitution + all g0 contract objects) produces a
 * bundleDigest that every prior wave gate binds to; LF12 takes that digest as
 * its SUBJECT and never adds itself to the bundle. You do not modify the thing
 * you are qualifying.
 *
 * The verdict (`qualified` | `not_yet_qualified` | `blocked`) is produced by
 * deterministic rules from an evidence ledger. A model may explain the verdict
 * but can never decide or override it. The engine refuses to report `qualified`
 * unless every mandatory evidence class is satisfied by fresh, baseline-bound,
 * passing evidence and every zero-tolerance count is zero.
 */

const g0 = require('./g0-baseline');
const contract = require('./g0/qualification-manifest.json');

const QUALIFICATION_VERSION = 1;

const EVIDENCE_STATUSES = Object.freeze(['passed', 'degraded', 'blocked', 'unavailable']);
const FRESHNESS_STATUSES = Object.freeze(['fresh', 'stale', 'unbound', 'unverifiable']);
const DECISION_STATES = Object.freeze(['qualified', 'not_yet_qualified', 'blocked']);

const sha256 = g0.sha256;
const canonical = g0.canonicalStringify;

function mandatoryClasses() {
  return contract.requiredEvidenceClasses.filter((c) => c.enforcement === 'mandatory');
}

function classById(id) {
  return contract.requiredEvidenceClasses.find((c) => c.id === id) || null;
}

/**
 * Validate the shape of a single evidence ledger entry. Returns bounded issues;
 * never throws. Rejects entries that carry obvious raw secrets or absolute user
 * paths so credential/PII material cannot enter committed evidence (ZT-05).
 */
function validateEvidenceEntry(entry = {}) {
  const issues = [];
  if (!entry || typeof entry !== 'object') return ['evidence_entry_not_object'];
  if (!entry.evidenceId || typeof entry.evidenceId !== 'string') issues.push('evidence_id_missing');
  if (!classById(entry.evidenceClass)) issues.push('evidence_class_unknown');
  if (entry.schemaVersion !== QUALIFICATION_VERSION) issues.push('evidence_schema_version_mismatch');
  if (!entry.sourceCommit || typeof entry.sourceCommit !== 'string') issues.push('evidence_source_commit_missing');
  if (!entry.baselineDigest || typeof entry.baselineDigest !== 'string') issues.push('evidence_baseline_digest_missing');
  if (!entry.platform || typeof entry.platform !== 'string') issues.push('evidence_platform_missing');
  if (!entry.appMode || typeof entry.appMode !== 'string') issues.push('evidence_app_mode_missing');
  if (!entry.generatedAt || Number.isNaN(Date.parse(entry.generatedAt))) issues.push('evidence_generated_at_invalid');
  if (!EVIDENCE_STATUSES.includes(entry.status)) issues.push('evidence_status_invalid');
  if (entry.freshnessStatus && !FRESHNESS_STATUSES.includes(entry.freshnessStatus)) {
    issues.push('evidence_freshness_invalid');
  }
  if (!entry.privacyClassification || typeof entry.privacyClassification !== 'string') {
    issues.push('evidence_privacy_classification_missing');
  }
  if (!entry.commandOrEntry || typeof entry.commandOrEntry !== 'string') {
    issues.push('evidence_command_or_entry_missing');
  }
  // Bounded privacy screen: committed evidence must be indexes/digests/counts.
  const serialized = canonical(entry);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serialized)) issues.push('evidence_contains_private_key');
  if (/(sk-[A-Za-z0-9]{16,})|(Bearer\s+[A-Za-z0-9._-]{12,})/.test(serialized)) issues.push('evidence_contains_credential');
  if (/https?:\\?\/\\?\//i.test(serialized)) issues.push('evidence_contains_url');
  if (/"\/Users\/[^"/]+\//.test(serialized) || /"\/home\/[^"/]+\//.test(serialized)) {
    issues.push('evidence_contains_absolute_user_path');
  }
  return issues;
}

/**
 * Compute the freshness of an entry relative to the qualified subject baseline.
 * Real-execution evidence that is not bound to the subject bundleDigest is
 * `unbound` (treated as degraded downstream), never fresh.
 */
function computeFreshness(entry, subjectBundleDigest, subjectSourceCommit = null, verifySourceCommit = null) {
  if (!entry.baselineDigest || !entry.sourceCommit) return 'unbound';
  if (entry.baselineDigest !== subjectBundleDigest) return 'stale';
  if (subjectSourceCommit && entry.sourceCommit === subjectSourceCommit) return 'fresh';
  if (typeof verifySourceCommit !== 'function') return 'unverifiable';
  const verified = verifySourceCommit(entry.sourceCommit, subjectSourceCommit);
  if (verified === true) return 'fresh';
  if (verified === false) return 'stale';
  return 'unverifiable';
}

/**
 * Build the QualificationManifest v1 by binding the current sealed baseline as
 * the subject. Never mutates the baseline; only references its digests.
 */
function buildQualificationManifest({ sourceCommit = null, generatedAt = null } = {}) {
  const baseline = g0.getCurrentG0Baseline();
  const manifest = {
    schemaVersion: QUALIFICATION_VERSION,
    contractVersion: contract.contractVersion,
    decisionPolicyVersion: contract.decisionPolicyVersion,
    qualificationId: contract.qualificationId,
    subjectBaselineId: baseline.baselineId,
    subjectBaselineVersion: baseline.baselineVersion,
    subjectLifecycleStatus: baseline.lifecycleStatus,
    subjectQualificationStatus: baseline.qualificationStatus,
    manifestDigest: baseline.manifestDigest,
    bundleDigest: baseline.bundleDigest,
    qualificationScope: contract.qualificationScope,
    requiredEvidenceClasses: contract.requiredEvidenceClasses.map((c) => ({
      id: c.id,
      enforcement: c.enforcement,
      evidenceMode: c.evidenceMode,
    })),
    zeroToleranceInvariants: contract.zeroToleranceInvariants.map((z) => z.id),
    supportClaims: contract.supportClaims.map((c) => c.id),
    excludedClaims: contract.excludedClaims.map((c) => c.id),
    freshnessPolicy: contract.freshnessPolicy,
    sourceCommit: sourceCommit || null,
    generatedAt: generatedAt || null,
  };
  return Object.freeze({ ...manifest, manifestObjectHash: sha256(manifest) });
}

/**
 * Build the QualificationEvidenceLedger v1 from raw entries. Validates each
 * entry, computes freshness against the subject baseline, and aggregates a
 * per-class status. Only stores bounded indexes, hashes, counts and statuses.
 */
function buildEvidenceLedger({
  entries = [],
  manifest = buildQualificationManifest(),
  zeroToleranceObservations = [],
  verifySourceCommit = null,
} = {}) {
  const subjectBundleDigest = manifest.bundleDigest;
  const seen = new Set();
  const normalized = [];
  for (const raw of entries) {
    const issues = validateEvidenceEntry(raw);
    // Freshness is always engine-derived from the subject bundleDigest binding,
    // never trusted from the caller — a caller cannot label stale evidence fresh.
    const freshnessStatus = computeFreshness(
      raw,
      subjectBundleDigest,
      manifest.sourceCommit,
      verifySourceCommit
    );
    const duplicate = seen.has(raw.evidenceId);
    if (raw.evidenceId) seen.add(raw.evidenceId);
    normalized.push(Object.freeze({
      evidenceId: raw.evidenceId || null,
      evidenceClass: raw.evidenceClass || null,
      schemaVersion: raw.schemaVersion ?? null,
      sourceCommit: raw.sourceCommit || null,
      baselineDigest: raw.baselineDigest || null,
      platform: raw.platform || null,
      architecture: raw.architecture || null,
      appMode: raw.appMode || null,
      runtimeSummary: raw.runtimeSummary || null,
      providerSummary: raw.providerSummary || null,
      commandOrEntry: raw.commandOrEntry || null,
      generatedAt: raw.generatedAt || null,
      freshnessStatus,
      counts: raw.counts || null,
      hashes: raw.hashes || null,
      boundedResult: raw.boundedResult || null,
      privacyClassification: raw.privacyClassification || null,
      applicableClaims: Array.isArray(raw.applicableClaims) ? [...raw.applicableClaims] : [],
      status: EVIDENCE_STATUSES.includes(raw.status) ? raw.status : 'unavailable',
      blockerRefs: Array.isArray(raw.blockerRefs) ? [...raw.blockerRefs] : [],
      integrity: issues.length === 0 && !duplicate ? 'valid' : 'invalid',
      integrityIssues: Object.freeze(duplicate ? [...issues, 'evidence_id_duplicate'] : issues),
    }));
  }

  const classStatus = {};
  for (const cls of contract.requiredEvidenceClasses) {
    const clsEntries = normalized.filter((e) => e.evidenceClass === cls.id && e.integrity === 'valid');
    if (clsEntries.length === 0) {
      classStatus[cls.id] = 'missing';
    } else if (clsEntries.some((e) => e.freshnessStatus === 'fresh' && e.status === 'passed')) {
      classStatus[cls.id] = 'satisfied';
    } else if (clsEntries.some((e) => e.status === 'blocked')) {
      classStatus[cls.id] = 'blocked';
    } else if (clsEntries.some((e) => e.status === 'passed')) {
      classStatus[cls.id] = 'stale';
    } else if (clsEntries.some((e) => e.status === 'degraded')) {
      classStatus[cls.id] = 'degraded';
    } else {
      classStatus[cls.id] = 'unavailable';
    }
  }

  const observationIds = new Set();
  const observationIntegrityIssues = [];
  const observations = zeroToleranceObservations.map((obs) => {
    const known = contract.zeroToleranceInvariants.some((item) => item.id === obs.id);
    const duplicate = observationIds.has(obs.id);
    if (obs.id) observationIds.add(obs.id);
    if (!known) observationIntegrityIssues.push(`zero_tolerance_id_unknown:${obs.id || 'missing'}`);
    if (duplicate) observationIntegrityIssues.push(`zero_tolerance_id_duplicate:${obs.id}`);
    if (!Number.isInteger(obs.violations) || obs.violations < 0) {
      observationIntegrityIssues.push(`zero_tolerance_count_invalid:${obs.id || 'missing'}`);
    }
    if (!obs.evidenceRef || typeof obs.evidenceRef !== 'string') {
      observationIntegrityIssues.push(`zero_tolerance_evidence_ref_missing:${obs.id || 'missing'}`);
    }
    return Object.freeze({
      id: obs.id || null,
      violations: Number.isInteger(obs.violations) && obs.violations >= 0 ? obs.violations : 1,
      evidenceRef: obs.evidenceRef || null,
    });
  });

  const ledger = {
    schemaVersion: QUALIFICATION_VERSION,
    subjectBaselineId: manifest.subjectBaselineId,
    subjectBaselineVersion: manifest.subjectBaselineVersion,
    bundleDigest: subjectBundleDigest,
    sourceCommit: manifest.sourceCommit,
    privacy: 'indexes_digests_counts_and_bounded_status_only_no_raw_data_credentials_urls_or_absolute_paths',
    entries: normalized,
    classStatus: Object.freeze(classStatus),
    zeroToleranceObservations: Object.freeze(observations),
    zeroToleranceIntegrityIssues: Object.freeze([...new Set(observationIntegrityIssues)]),
    invalidEntryCount: normalized.filter((e) => e.integrity === 'invalid').length,
  };
  return Object.freeze({
    ...ledger,
    ledgerHash: sha256({
      classStatus,
      entries: normalized,
      observations,
      observationIntegrityIssues: ledger.zeroToleranceIntegrityIssues,
    }),
  });
}

/**
 * Deterministic qualification decision. Given the manifest and ledger, produce
 * a verdict with satisfied/limited/unsupported claims and precise blockers.
 * Same inputs always produce the same decisionHash.
 */
function evaluateQualificationDecision({ manifest = buildQualificationManifest(), ledger } = {}) {
  const activeLedger = ledger || buildEvidenceLedger({ manifest });
  const classStatus = activeLedger.classStatus;
  const blockers = [];

  // 1. Zero-tolerance invariants — any violation blocks qualification outright.
  const violations = [];
  for (const invariant of contract.zeroToleranceInvariants) {
    const obs = activeLedger.zeroToleranceObservations.find((item) => item.id === invariant.id);
    if (!obs) {
      blockers.push(`zero_tolerance_unobserved:${invariant.id}`);
      continue;
    }
    if (obs.violations > 0) {
      violations.push(obs.id);
      blockers.push(`zero_tolerance_violation:${obs.id}`);
    }
  }

  for (const issue of activeLedger.zeroToleranceIntegrityIssues || []) {
    blockers.push(`zero_tolerance_integrity_failure:${issue}`);
  }

  // 2. Committed evidence integrity failures block qualification.
  const integrityFailures = activeLedger.entries.filter((e) => e.integrity === 'invalid');
  for (const bad of integrityFailures) {
    blockers.push(`evidence_integrity_failure:${bad.evidenceId || 'unknown'}`);
  }

  // 3. Mandatory evidence classes must each be satisfied.
  for (const cls of mandatoryClasses()) {
    const status = classStatus[cls.id];
    if (status !== 'satisfied') {
      blockers.push(`mandatory_evidence_${status}:${cls.id}`);
    }
  }

  const classSatisfied = (id) => classStatus[id] === 'satisfied';

  // 4. Support claims partition.
  const satisfiedClaims = [];
  const limitedClaims = [];
  const unsupportedClaims = [];
  for (const claim of contract.supportClaims) {
    const required = claim.requiredEvidenceClasses;
    const satisfiedCount = required.filter(classSatisfied).length;
    if (satisfiedCount === required.length) {
      satisfiedClaims.push(claim.id);
    } else if (satisfiedCount === 0) {
      unsupportedClaims.push(claim.id);
    } else {
      limitedClaims.push(claim.id);
    }
  }
  for (const claim of [...limitedClaims, ...unsupportedClaims]) {
    blockers.push(`support_claim_unsatisfied:${claim}`);
  }

  // 5. Excluded claims can never be promoted (defense against scope creep).
  const excludedIds = contract.excludedClaims.map((c) => c.id);
  const promotedExcluded = satisfiedClaims.filter((id) => excludedIds.includes(id));
  for (const id of promotedExcluded) blockers.push(`excluded_claim_promoted:${id}`);

  // 6. Verdict.
  const hasHardFailure = violations.length > 0
    || integrityFailures.length > 0
    || (activeLedger.zeroToleranceIntegrityIssues || []).length > 0
    || promotedExcluded.length > 0;
  const uniqueBlockers = [...new Set(blockers)];
  let state;
  if (hasHardFailure) {
    state = 'blocked';
  } else if (uniqueBlockers.length > 0) {
    state = 'not_yet_qualified';
  } else {
    state = 'qualified';
  }

  const decisionCore = {
    state,
    satisfiedClaims: satisfiedClaims.sort(),
    limitedClaims: limitedClaims.sort(),
    unsupportedClaims: unsupportedClaims.sort(),
    blockers: uniqueBlockers.sort(),
    zeroToleranceViolations: violations.sort(),
    requiredRequalification: [...contract.freshnessPolicy.requalificationTriggers],
  };

  return Object.freeze({
    schemaVersion: QUALIFICATION_VERSION,
    decisionPolicyVersion: contract.decisionPolicyVersion,
    subjectBaselineId: manifest.subjectBaselineId,
    subjectBaselineVersion: manifest.subjectBaselineVersion,
    bundleDigest: manifest.bundleDigest,
    sourceCommit: manifest.sourceCommit,
    ...decisionCore,
    modelMayDecide: false,
    decisionHash: sha256(decisionCore),
  });
}

module.exports = {
  QUALIFICATION_VERSION,
  contract,
  EVIDENCE_STATUSES,
  FRESHNESS_STATUSES,
  DECISION_STATES,
  mandatoryClasses,
  classById,
  validateEvidenceEntry,
  computeFreshness,
  buildQualificationManifest,
  buildEvidenceLedger,
  evaluateQualificationDecision,
};
