'use strict';
const crypto = require('crypto');
const contract = require('./g0/capability-supply-chain.json');
const CAPABILITY_SUPPLY_CHAIN_VERSION = 2;
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function validateCapabilityDescriptor(value = {}) {
  const required = ['pluginId', 'version', 'sourcePolicy', 'manifestHash', 'runtimeHash', 'scriptHash', 'packageHash', 'platform', 'failureModes', 'validators', 'artifacts'];
  const missing = required.filter((key) => value[key] == null || (Array.isArray(value[key]) && value[key].length === 0));
  const hashes = ['manifestHash', 'runtimeHash', 'scriptHash', 'packageHash'].filter((key) => value[key] != null && !/^[a-f0-9]{64}$/.test(value[key]));
  const sourceValid = contract.sources.includes(value.sourcePolicy);
  return Object.freeze({ ok: missing.length === 0 && hashes.length === 0 && sourceValid, missing, invalidHashes: hashes, sourceValid });
}

function assessCapabilityUpgrade({ previous, next, replayReport, currentPlatform } = {}) {
  const descriptor = validateCapabilityDescriptor(next);
  const reasons = [];
  if (!descriptor.ok) reasons.push('descriptor_invalid');
  if (previous?.pluginId && next?.pluginId !== previous.pluginId) reasons.push('plugin_identity_changed');
  if (next?.platform !== currentPlatform) reasons.push('platform_unverified');
  if (!replayReport) reasons.push('upgrade_replay_missing');
  else if (['scientifically_material', 'unknown'].includes(replayReport.classification)) reasons.push(`drift_${replayReport.classification}`);
  const result = { allowed: reasons.length === 0, reasons, replayClassification: replayReport?.classification || null, createsSecondLedger: false };
  return Object.freeze({ ...result, decisionHash: digest(result) });
}
module.exports = { CAPABILITY_SUPPLY_CHAIN_VERSION, contract, validateCapabilityDescriptor, assessCapabilityUpgrade };
