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

// UI-273 增补 — 写操作的逐行改动（统计 + 截断 hunks）。挂在 toolResult 顶层而非 data 内：
// data 受 PUBLIC_DATA_LIMIT 截断，超限会被整体替换为 preview 字符串，diff 必须独立存活。
const CHANGE_DIFF_LIMIT = 4000;

function boundedChangeDiff(result) {
  if (!result || typeof result !== 'object') return undefined;
  const raw = result.changeDiff;
  if (!raw || typeof raw !== 'object') return undefined;
  const added = Number.isFinite(raw.added) ? raw.added : 0;
  const removed = Number.isFinite(raw.removed) ? raw.removed : 0;
  const hunks = Array.isArray(raw.hunks) ? raw.hunks : [];
  const base = { added, removed, truncated: raw.truncated === true, hunks };
  if (safeJson(base).length <= CHANGE_DIFF_LIMIT) return base;
  // 超限：保留诚实统计，丢弃精细 hunks
  return { added, removed, truncated: true, hunks: [] };
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
      // UI-273 — 写操作逐行改动（独立于 data，规避 publicData 截断）
      ...(boundedChangeDiff(result) ? { changeDiff: boundedChangeDiff(result) } : {}),
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

// ===== BLOCK-33 P3 — workspace_exec 流式输出（tool_output SSE 事件） =====

const TOOL_OUTPUT_INTERVAL_MS = 200;
// 单次工具调用流式输出的总字符封顶；超出后发一次 truncated 标记并丢弃后续增量。
const TOOL_OUTPUT_MAX_CHARS = 16000;

/**
 * 构造 tool_output SSE 事件（callId 关联到对应 tool_call / tool_result）。
 * text 已经过脱敏；事件本身再整体脱敏一次，与 tool_call/tool_result 对齐。
 */
function buildToolOutputEvent({ name, callId, traceId, iteration, text, truncated }) {
  return redactSensitiveValue({
    event: 'tool_output',
    name,
    callId,
    traceId,
    ...(Number.isFinite(iteration) ? { iteration } : {}),
    text: String(text || ''),
    ...(truncated ? { truncated: true } : {}),
  });
}

/**
 * 创建工具输出流式发射器：聚合增量、按 TOOL_OUTPUT_INTERVAL_MS 节流、
 * 总量封顶 TOOL_OUTPUT_MAX_CHARS。返回 onOutput(chunk) 回调（chunk 形如
 * { stream: 'stdout' | 'stderr', text }) 与 flush()（命令结束后冲刷剩余缓冲）。
 * 非 workspace_exec 工具或未提供 emit 时返回 no-op。
 */
function createToolOutputStream({ name, callId, traceId, iteration, emit, intervalMs = TOOL_OUTPUT_INTERVAL_MS, maxChars = TOOL_OUTPUT_MAX_CHARS }) {
  if (!emit || name !== 'workspace_exec' || !callId) {
    return { onOutput: () => {}, flush: () => {} };
  }
  const limit = Math.max(256, Number(maxChars) || TOOL_OUTPUT_MAX_CHARS);
  const interval = Math.max(50, Number(intervalMs) || TOOL_OUTPUT_INTERVAL_MS);
  let buffer = '';
  let emittedChars = 0;
  let truncatedSent = false;
  let timer = null;

  const send = (text, truncated) => {
    if (!text) return;
    try {
      emit(buildToolOutputEvent({ name, callId, traceId, iteration, text, truncated }));
    } catch {
      // SSE 发送失败不阻塞工具执行
    }
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (truncatedSent) return;
    if (buffer) {
      send(buffer, false);
      buffer = '';
    }
  };

  const onOutput = (chunk) => {
    if (truncatedSent || !chunk || typeof chunk.text !== 'string' || !chunk.text) return;
    if (emittedChars >= limit) return;
    buffer += chunk.text;
    emittedChars += chunk.text.length;
    if (emittedChars >= limit) {
      // 封顶：本次冲刷后发 truncated 标记，后续增量丢弃
      const room = Math.max(0, limit - (emittedChars - buffer.length));
      send(buffer.slice(0, room), false);
      buffer = '';
      truncatedSent = true;
      send('…（输出超出流式上限，已截断）', true);
      return;
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (truncatedSent || !buffer) return;
      send(buffer, false);
      buffer = '';
    }, interval);
  };

  return { onOutput, flush };
}

/** Safe, compact activity details suitable for conversation metadata. */
function summarizeToolCallForActivity(name, args = {}) {
  switch (name) {
    case 'workspace_exec':
      return { actionLabel: '已运行', actionDetail: compactActivityDetail(args.command) || '命令' };
    // BLOCK-33 P4 — 后台进程三件套
    case 'workspace_exec_background':
      return { actionLabel: '后台运行', actionDetail: compactActivityDetail(args.command) || '命令' };
    case 'process_status':
      return { actionLabel: '查询后台进程', actionDetail: compactActivityDetail(args.processId) || '全部' };
    case 'process_stop':
      return { actionLabel: '停止后台进程', actionDetail: compactActivityDetail(args.processId) || '进程' };
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
      // UI-273 — 写操作逐行改动随活动快照落库（历史会话展开执行记录可回看）
      changeDiff: result.changeDiff && typeof result.changeDiff === 'object'
        ? {
            added: Number.isFinite(result.changeDiff.added) ? result.changeDiff.added : 0,
            removed: Number.isFinite(result.changeDiff.removed) ? result.changeDiff.removed : 0,
            truncated: result.changeDiff.truncated === true,
            hunks: Array.isArray(result.changeDiff.hunks) ? result.changeDiff.hunks.slice(0, 20) : [],
          }
        : undefined,
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
  TOOL_OUTPUT_INTERVAL_MS,
  TOOL_OUTPUT_MAX_CHARS,
  buildToolCallEvent,
  buildToolOutputEvent,
  buildToolResultEvent,
  createToolOutputStream,
  summarizeToolCallForActivity,
  createToolActivityRecorder,
};
