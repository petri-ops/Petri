'use strict';
const crypto = require('crypto');
const contract = require('./g0/evolution-pipeline.json');
const qualificationContract = require('./g0/qualification-manifest.json');
const EVOLUTION_PIPELINE_VERSION = 1;
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function classifyChange({ changeClass } = {}) {
  const spec = contract.changeClasses[changeClass];
  if (!spec) return Object.freeze({ ok: false, changeClass: changeClass || null, requiredEvidence: [], reasons: ['change_class_unknown'] });
  const result = { ok: true, changeClass, requiredEvidence: [...spec.requiredEvidence], requiresNewMajor: spec.requiresNewMajor === true, requiresMigration: spec.requiresMigration === true, reasons: [] };
  return Object.freeze({ ...result, classificationHash: digest(result) });
}

function evaluateRequalificationGate({ trigger = null, decisionState = null, evidenceDigest = null } = {}) {
  if (trigger == null) {
    const result = { required: false, allowed: true, trigger: null, reasons: [] };
    return Object.freeze({ ...result, decisionHash: digest(result) });
  }
  const reasons = [];
  if (!qualificationContract.freshnessPolicy.requalificationTriggers.includes(trigger)) {
    reasons.push(`requalification_trigger_unknown:${trigger}`);
  }
  if (decisionState !== contract.requalificationGate.requiredDecisionState) {
    reasons.push('requalification_decision_not_qualified');
  }
  if (
    contract.requalificationGate.requiredEvidenceDigest === true
    && !/^[a-f0-9]{64}$/.test(String(evidenceDigest || ''))
  ) reasons.push('requalification_evidence_digest_missing');
  const result = { required: true, allowed: reasons.length === 0, trigger, reasons };
  return Object.freeze({ ...result, decisionHash: digest(result) });
}

function evaluatePromotionGate({
  changeClass,
  providedEvidence = [],
  newMajor = false,
  migrationProvided = false,
  requalificationTrigger = null,
  requalificationDecision = null,
  requalificationEvidenceDigest = null,
} = {}) {
  const classification = classifyChange({ changeClass });
  const provided = new Set(providedEvidence);
  const reasons = [];
  if (!classification.ok) reasons.push('change_class_unknown');
  const missingGate = contract.promotionGate.requiredEvidence.filter((key) => !provided.has(key));
  if (missingGate.length > 0) reasons.push(...missingGate.map((key) => `promotion_evidence_missing:${key}`));
  const missingClass = classification.ok ? classification.requiredEvidence.filter((key) => !provided.has(key)) : [];
  if (missingClass.length > 0) reasons.push(...missingClass.map((key) => `class_evidence_missing:${key}`));
  if (classification.ok && classification.requiresNewMajor && newMajor !== true) reasons.push('new_major_required');
  if (classification.ok && classification.requiresMigration && migrationProvided !== true) reasons.push('migration_required');
  const requalification = evaluateRequalificationGate({
    trigger: requalificationTrigger,
    decisionState: requalificationDecision,
    evidenceDigest: requalificationEvidenceDigest,
  });
  if (!requalification.allowed) reasons.push(...requalification.reasons);
  const result = {
    allowed: reasons.length === 0,
    changeClass: changeClass || null,
    missing: [...missingGate, ...missingClass],
    reasons,
    requalification,
    createsSecondLedger: false,
  };
  return Object.freeze({ ...result, decisionHash: digest(result) });
}

function evaluatePolicyLearning({ target = null, controls = [], mutatesBaselineDirectly = false } = {}) {
  const provided = new Set(controls);
  const reasons = [];
  if (contract.policyLearning.immutableWithoutQualification.includes(target)) reasons.push(`immutable_target:${target}`);
  if (mutatesBaselineDirectly === true) reasons.push('direct_baseline_mutation');
  const missingControls = contract.policyLearning.requiredControls.filter((key) => !provided.has(key));
  if (missingControls.length > 0) reasons.push(...missingControls.map((key) => `control_missing:${key}`));
  const result = { accepted: reasons.length === 0, outputKind: contract.policyLearning.outputKind, target: target || null, reasons, mutatesBaseline: false };
  return Object.freeze({ ...result, decisionHash: digest(result) });
}

module.exports = {
  EVOLUTION_PIPELINE_VERSION,
  contract,
  classifyChange,
  evaluatePromotionGate,
  evaluateRequalificationGate,
  evaluatePolicyLearning,
};
