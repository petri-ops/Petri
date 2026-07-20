'use strict';

const { randomUUID } = require('node:crypto');
const { redactSensitiveValue } = require('../../shared-backend/redaction');
const { interceptAgentToolCall } = require('./agent-tool-interceptor');
const { getToolContract } = require('./registry');
const { toolTraceStore } = require('./tool-trace-store');

const TOOL_RESULT_CONTRACT_VERSION = '1.0.0';
const MODEL_RESULT_LIMIT = 6000;

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ error: 'result_not_serializable', message: error.message });
  }
}

function classifyResult(result) {
  if (result && typeof result === 'object' && (result.error || result.ok === false)) {
    if (result.messageKey && String(result.messageKey).startsWith('agent_tool.')) {
      return {
        status: 'denied',
        terminationReason: String(result.reason || result.error || 'policy_denied'),
      };
    }
    return { status: 'error', terminationReason: 'handler_error' };
  }
  if (result && typeof result === 'object' && result.needApproval === true) {
    return { status: 'success', terminationReason: 'approval_required' };
  }
  return { status: 'success', terminationReason: 'success' };
}

function noSideEffects() {
  return { type: 'none', riskTier: 'R0', resources: [] };
}

function sideEffectSummary(name, args, contract, result, classification) {
  if (classification.status !== 'success') return noSideEffects();
  if (result && typeof result === 'object' && result.needApproval === true) {
    return result.toolJobId
      ? { type: 'state-write', riskTier: 'R1', resources: ['tool_job'] }
      : noSideEffects();
  }

  const operation = args && typeof args === 'object' ? args.op : undefined;
  if (name === 'run_tool' && operation !== 'run') return noSideEffects();
  if (name === 'plan' && (operation === 'list' || operation === 'get')) return noSideEffects();
  if (
    (name === 'workspace_write' || name === 'workspace_replace') &&
    result &&
    typeof result === 'object' &&
    result.dryRun === true
  ) {
    return noSideEffects();
  }
  if (!contract || contract.sideEffect === 'none') return noSideEffects();
  return {
    type: contract.sideEffect,
    riskTier: contract.riskTier,
    resources: [...contract.resources],
  };
}

function createCallId() {
  return `call_${randomUUID()}`;
}

function createTraceId() {
  return `trace_${randomUUID()}`;
}

function replaceToolResultData(envelope, data) {
  return {
    ...envelope,
    truncated: safeJson(redactSensitiveValue(data)).length > MODEL_RESULT_LIMIT,
    data,
  };
}

async function executeToolCall(name, args = {}, ctx = {}, options = {}) {
  const traceId = options.traceId || createTraceId();
  const callId = options.callId || createCallId();
  const startedAt = process.hrtime.bigint();
  let data;
  try {
    data = await interceptAgentToolCall(name, args, ctx);
  } catch (error) {
    data = {
      ok: false,
      error: 'tool_failed',
      message: error && error.message ? error.message : String(error),
    };
  }
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const classification = classifyResult(data);
  const envelope = {
    contractVersion: TOOL_RESULT_CONTRACT_VERSION,
    traceId,
    callId,
    tool: name,
    status: classification.status,
    terminationReason: classification.terminationReason,
    durationMs: Math.round(durationMs * 10) / 10,
    truncated: safeJson(data).length > MODEL_RESULT_LIMIT,
    sideEffects: sideEffectSummary(name, args, getToolContract(name), data, classification),
    data,
  };
  toolTraceStore.append({ ...envelope, args, result: data });
  return envelope;
}

function serializeToolResultForModel(envelope, maxChars = MODEL_RESULT_LIMIT) {
  const serialized = safeJson(redactSensitiveValue(envelope));
  if (serialized.length <= maxChars) return serialized;
  return `${serialized.slice(0, maxChars)}... (truncated)`;
}

module.exports = {
  MODEL_RESULT_LIMIT,
  TOOL_RESULT_CONTRACT_VERSION,
  createCallId,
  createTraceId,
  executeToolCall,
  replaceToolResultData,
  serializeToolResultForModel,
};
