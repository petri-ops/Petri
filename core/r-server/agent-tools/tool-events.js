'use strict';

const { redactSensitiveValue } = require('../../shared-backend/redaction');

const PUBLIC_DATA_LIMIT = 1600;

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function publicData(data) {
  const redacted = redactSensitiveValue(data);
  const serialized = safeJson(redacted);
  if (serialized.length <= PUBLIC_DATA_LIMIT) return { data: redacted, truncated: false };
  return {
    data: { preview: `${serialized.slice(0, PUBLIC_DATA_LIMIT)}…` },
    truncated: true,
  };
}

function buildToolCallEvent({ name, args, traceId, callId }) {
  return {
    event: 'tool_call',
    name,
    args: redactSensitiveValue(args || {}),
    traceId,
    callId,
  };
}

function buildToolResultEvent(envelope, args = {}) {
  const result = envelope.data;
  const published = publicData(result);
  const summary = result && typeof result === 'object'
    ? Array.isArray(result)
      ? `返回 ${result.length} 条`
      : result.error
        ? `错误: ${result.error}`
        : 'ok'
    : String(result);
  const evt = {
    event: 'tool_result',
    name: envelope.tool,
    summary,
    toolResult: {
      contractVersion: envelope.contractVersion,
      traceId: envelope.traceId,
      callId: envelope.callId,
      tool: envelope.tool,
      status: envelope.status,
      terminationReason: envelope.terminationReason,
      durationMs: envelope.durationMs,
      // `status` is the execution outcome. These flags describe bounded
      // representations of a result and must not be treated as a tool failure
      // by clients.
      sourceTruncated: Boolean(envelope.truncated),
      previewTruncated: Boolean(published.truncated),
      truncated: Boolean(envelope.truncated || published.truncated),
      sideEffects: envelope.sideEffects,
      data: published.data,
    },
  };

  if (envelope.tool === 'act' && result && typeof result === 'object') {
    if (result.undoToken) evt.undoToken = result.undoToken;
    if (result.undoableUntil) evt.undoableUntil = result.undoableUntil;
    if (result.message) evt.message = result.message;
    if (result.error) evt.actError = result.error;
    if (args.type) evt.actType = args.type;
    if (result.analysisId) evt.analysisId = result.analysisId;
    if (result.taskId) evt.taskId = result.taskId;
    if (result.ackToken) evt.ackToken = result.ackToken;
    if (result.type === 'update_figcode_editor' && result.code) {
      evt.figcodeCode = result.code;
      evt.figcodeAutoRun = result.autoRun !== false;
    }
    if (result.type === 'switch_result_tab') evt.scTab = result.tab;
    if (result.type === 'focus_cluster') evt.scCluster = result.cluster;
    if (result.type === 'highlight_gene') evt.scGene = result.gene;
    if (['select_cells', 'filter_table', 'label_cells'].includes(result.type) && result.columnFilters) {
      evt.scColumnFilters = result.columnFilters;
    }
    if (result.type === 'select_cells') evt.scSubsetName = result.subsetName || null;
    if (result.type === 'label_cells') {
      evt.scLabelKey = result.labelKey;
      evt.scLabelValue = result.labelValue;
    }
    if (result.type === 'merge_datasets') {
      evt.scDatasetIds = result.datasetIds;
      evt.scMergeName = result.mergeName || null;
    }
    if (result.type === 'open_replot') evt.scOpenReplotForAnalysis = result.analysisId;
    if (result.type === 'upload_data_hint') evt.scUploadHint = true;
    if (result.type === 'open_figcode_plot') evt.figcardId = result.figcardId;
    if (result.type === 'open_tool' && result.toolId) evt.toolId = result.toolId;
  }

  if (envelope.tool === 'act_generic' && result && typeof result === 'object') {
    if (result.actType) evt.actType = result.actType;
    if (result.handlerId) evt.handlerId = result.handlerId;
    if (result.payload) evt.payload = result.payload;
    if (result.message) evt.message = result.message;
    if (result.ackToken) evt.ackToken = result.ackToken;
  }

  if (envelope.tool === 'run_tool' && result && typeof result === 'object') {
    if (result.needApproval) {
      evt.needApproval = true;
      if (result.ackToken) evt.ackToken = result.ackToken;
      if (result.toolJobId) evt.toolJobId = result.toolJobId;
      if (result.toolId) evt.toolId = result.toolId;
      if (result.message) evt.message = result.message;
      if (result.params) evt.params = redactSensitiveValue(result.params);
    } else if (result.toolJobId) {
      evt.toolJobId = result.toolJobId;
      if (result.toolId) evt.toolId = result.toolId;
      if (result.message || result.error) evt.message = String(result.message || result.error);
    }
  }

  return redactSensitiveValue(evt);
}

module.exports = { buildToolCallEvent, buildToolResultEvent };
