'use strict';

const { redactSensitiveValue } = require('../../shared-backend/redaction');

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_SUMMARY_CHARS = 1200;

function summarize(value, maxChars = DEFAULT_SUMMARY_CHARS) {
  let text;
  try {
    text = JSON.stringify(redactSensitiveValue(value));
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}…`, truncated: true };
}

function createToolTraceStore(options = {}) {
  const maxEntries = Math.max(1, options.maxEntries || DEFAULT_MAX_ENTRIES);
  const ttlMs = Math.max(1, options.ttlMs || DEFAULT_TTL_MS);
  const now = options.now || Date.now;
  const entries = [];

  function prune() {
    const cutoff = now() - ttlMs;
    while (entries.length && entries[0].recordedAt < cutoff) entries.shift();
    while (entries.length > maxEntries) entries.shift();
  }

  function append(record) {
    const args = summarize(record.args);
    const result = summarize(record.result);
    entries.push(Object.freeze({
      traceId: record.traceId,
      callId: record.callId,
      tool: record.tool,
      status: record.status,
      terminationReason: record.terminationReason,
      durationMs: record.durationMs,
      recordedAt: now(),
      argsSummary: args.text,
      resultSummary: result.text,
      truncated: Boolean(record.truncated || args.truncated || result.truncated),
    }));
    prune();
  }

  function getTrace(traceId) {
    prune();
    return entries.filter((entry) => entry.traceId === traceId);
  }

  function clear() {
    entries.length = 0;
  }

  return { append, getTrace, clear, size: () => (prune(), entries.length) };
}

const toolTraceStore = createToolTraceStore();

module.exports = { createToolTraceStore, toolTraceStore };
