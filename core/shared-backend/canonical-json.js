'use strict';

/**
 * Canonical JSON serialization (BLOCK-83 D1：从 scientific-task-spec 上提的通用原语).
 *
 * Domain-neutral: key-sorted deterministic stringify used for digests and
 * equality checks across contracts, manifests, provenance and replay services.
 */

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

module.exports = { stableValue, stableStringify };
