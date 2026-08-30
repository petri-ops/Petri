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

function buildToolCallEvent({ name, args, traceId, callId, iteration }) {
  return {
    event: 'tool_call',
    name,
    args: redactSensitiveValue(args || {}),
    traceId,
    callId,
    ...(Number.isFinite(iteration) ? { iteration } : {}),
  };
}

function buildToolResultEvent(envelope, args = {}, options = {}) {
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
    ...(Number.isFinite(options.iteration) ? { iteration: options.iteration } : {}),
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

function compactActivityDetail(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > 140 ? `${normalized.slice(0, 137)}…` : normalized;
}

/** Safe, compact activity details suitable for conversation metadata. */
function summarizeToolCallForActivity(name, args = {}) {
  switch (name) {
    case 'workspace_exec':
      return { actionLabel: '已运行', actionDetail: compactActivityDetail(args.command) || '命令' };
    case 'workspace_read': {
      const path = compactActivityDetail(args.path) || '文件';
      const start = Number.isInteger(args.startLine) ? ` · 第 ${args.startLine} 行起` : '';
      return { actionLabel: '已读取', actionDetail: `${path}${start}` };
    }
    case 'workspace_list':
      return { actionLabel: '已读取', actionDetail: `目录 ${compactActivityDetail(args.path) || '.'}` };
    case 'workspace_find':
      return { actionLabel: '已查找', actionDetail: compactActivityDetail(args.pattern) || '文件' };
    case 'workspace_search':
      return { actionLabel: '已搜索', actionDetail: compactActivityDetail(args.query) || '文本' };
    case 'workspace_write':
    case 'workspace_replace':
      return { actionLabel: '已修改', actionDetail: compactActivityDetail(args.path) || '文件' };
    case 'run_tool':
      return { actionLabel: '已运行', actionDetail: compactActivityDetail(args.toolId) || '分析工具' };
    default:
      return { actionLabel: '已调用', actionDetail: name };
  }
}

function createToolActivityRecorder() {
  const items = [];

  function recordCall({ name, args, traceId, callId, iteration }) {
    const summary = summarizeToolCallForActivity(name, args);
    items.push({
      key: callId || `${traceId || 'legacy'}:${name}:${items.length + 1}`,
      callId,
      traceId,
      ...(Number.isFinite(iteration) ? { iteration } : {}),
      name,
      status: 'running',
      ...summary,
    });
  }

  function recordResult(event) {
    const result = event && event.toolResult ? event.toolResult : {};
    const name = result.tool || event.name || 'tool';
    let index = result.callId
      ? items.findIndex((item) => item.callId === result.callId)
      : -1;
    if (index < 0) {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (items[i].name === name && items[i].status === 'running') {
          index = i;
          break;
        }
      }
    }
    const existing = index >= 0 ? items[index] : null;
    const next = {
      key: existing ? existing.key : (result.callId || `${result.traceId || 'legacy'}:${name}:${items.length + 1}`),
      toolJobId: event.toolJobId || (existing && existing.toolJobId),
      toolId: event.toolId || (existing && existing.toolId),
      callId: result.callId || (existing && existing.callId),
      traceId: result.traceId || (existing && existing.traceId),
      iteration: Number.isFinite(event.iteration)
        ? event.iteration
        : (existing && existing.iteration),
      name,
      status: result.terminationReason === 'approval_required'
        ? 'awaiting_confirmation'
        : result.status || (event.summary && /^错误[:：]/.test(event.summary) ? 'error' : 'success'),
      durationMs: result.durationMs,
      sourceTruncated: result.sourceTruncated,
      previewTruncated: result.previewTruncated,
      truncated: result.truncated,
      terminationReason: result.terminationReason,
      sideEffects: result.sideEffects,
      summary: event.summary,
      actionLabel: existing ? existing.actionLabel : summarizeToolCallForActivity(name).actionLabel,
      actionDetail: existing ? existing.actionDetail : summarizeToolCallForActivity(name).actionDetail,
    };
    if (index < 0) items.push(next);
    else items[index] = next;
  }

  return {
    recordCall,
    recordResult,
    snapshot: () => items.slice(0, 100),
  };
}

module.exports = {
  buildToolCallEvent,
  buildToolResultEvent,
  summarizeToolCallForActivity,
  createToolActivityRecorder,
};
