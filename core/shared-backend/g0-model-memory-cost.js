'use strict';

const crypto = require('crypto');
const contract = require('./g0/model-memory-cost.json');

const MODEL_MEMORY_COST_VERSION = 1;
const canonical = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const digest = (value) => crypto.createHash('sha256').update(canonical(value)).digest('hex');

function validateCompression({ beforeFacts = [], afterFacts = [], trigger, sourceCheckpointHash } = {}) {
  const before = new Map(beforeFacts.map((item) => [item.factId, item]));
  const after = new Map(afterFacts.map((item) => [item.factId, item]));
  const missing = [...before.keys()].filter((id) => !after.has(id));
  const changed = [...before.keys()].filter((id) => after.has(id) && digest(before.get(id)) !== digest(after.get(id)));
  const validTrigger = contract.compressionTriggers.includes(trigger);
  const result = {
    modelMemoryCostVersion: MODEL_MEMORY_COST_VERSION,
    valid: validTrigger && Boolean(sourceCheckpointHash) && missing.length === 0 && changed.length === 0,
    trigger: validTrigger ? trigger : 'invalid',
    sourceCheckpointHash: sourceCheckpointHash || null,
    missing,
    changed,
  };
  return Object.freeze({ ...result, validationHash: digest(result) });
}

function buildCacheIdentity(fields = {}) {
  const missing = contract.cacheFingerprintFields.filter((field) => fields[field] == null);
  return Object.freeze({
    valid: missing.length === 0,
    missing,
    cacheKey: missing.length ? null : digest(fields),
    projectId: fields.project || null,
  });
}

function aggregateUsage(entries = []) {
  const totals = entries.reduce((sum, item) => ({
    inputTokens: sum.inputTokens + Number(item.inputTokens || 0),
    outputTokens: sum.outputTokens + Number(item.outputTokens || 0),
    cacheReadTokens: sum.cacheReadTokens + Number(item.cacheReadTokens || 0),
    cacheWriteTokens: sum.cacheWriteTokens + Number(item.cacheWriteTokens || 0),
    cost: sum.cost + Number(item.cost || 0),
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 });
  const currencies = [...new Set(entries.map((item) => item.currency).filter(Boolean))];
  return Object.freeze({ ...totals, currency: currencies.length === 1 ? currencies[0] : currencies.length ? 'mixed' : null, entryCount: entries.length });
}

function evaluateProviderFallback({ capabilityCompatible, policyAllowed, auditRecorded, scientificGatesUnchanged } = {}) {
  const checks = { capabilityCompatible, policyAllowed, auditRecorded, scientificGatesUnchanged };
  const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
  return Object.freeze({ allowed: failed.length === 0, failed, silent: auditRecorded !== true });
}

module.exports = { MODEL_MEMORY_COST_VERSION, contract, validateCompression, buildCacheIdentity, aggregateUsage, evaluateProviderFallback };
