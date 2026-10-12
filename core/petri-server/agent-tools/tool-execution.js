'use strict';

const { randomUUID } = require('node:crypto');
const { redactSensitiveValue } = require('../../shared-backend/redaction');
const { interceptAgentToolCall } = require('./agent-tool-interceptor');
const { getToolContract } = require('./registry');
const { toolTraceStore } = require('./tool-trace-store');

const TOOL_RESULT_CONTRACT_VERSION = '1.0.0';
const MODEL_RESULT_LIMIT = 6000;
const MODEL_LIST_LIMIT = 40;
const MODEL_SEARCH_LIMIT = 12;
const MODEL_SEARCH_TEXT_LIMIT = 120;
const MODEL_OUTPUT_TAIL = 1600;

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

function normalizeProjectId(value) {
  return value == null || String(value).trim() === '' ? null : String(value);
}

function appendTrace(envelope, args, result, ctx) {
  toolTraceStore.append({
    ...envelope,
    projectId: normalizeProjectId(ctx && ctx.projectId),
    args,
    result,
  });
}

function buildEnvelope(name, args, data, ctx, options, durationMs) {
  const classification = classifyResult(data);
  return {
    contractVersion: TOOL_RESULT_CONTRACT_VERSION,
    traceId: options.traceId || createTraceId(),
    callId: options.callId || createCallId(),
    tool: name,
    status: classification.status,
    terminationReason: classification.terminationReason,
    durationMs: Math.round(durationMs * 10) / 10,
    truncated: safeJson(data).length > MODEL_RESULT_LIMIT,
    sideEffects: sideEffectSummary(name, args, getToolContract(name), data, classification),
    data,
  };
}

function replaceToolResultData(envelope, data) {
  return {
    ...envelope,
    // `truncated` describes the raw handler result captured when the envelope
    // was created. Localizing or attaching ACK metadata must not rewrite that
    // execution-time fact; model projection tracks its own bounded size.
    truncated: envelope.truncated,
    data,
  };
}

async function executeToolCall(name, args = {}, ctx = {}, options = {}) {
  const startedAt = process.hrtime.bigint();
  let data;
  try {
    // BLOCK-33 P3 — options.onOutput（可选）透传到 handler（workspace_exec 流式输出）
    data = await interceptAgentToolCall(
      name,
      args,
      ctx,
      typeof options.onOutput === 'function' ? { onOutput: options.onOutput } : {}
    );
  } catch (error) {
    // BLOCK-171 CP-1 — 协作取消归类：handler 抛 AbortError('tool_cancel_requested')
    // 时诚实入 envelope 为 tool_cancelled（区别于真失败；模型可据此收尾叙事）。
    const cancelled = Boolean(error)
      && (error.name === 'AbortError' || /tool_cancel_requested/.test(String(error.message || '')));
    data = cancelled
      ? {
          ok: false,
          error: 'tool_cancelled',
          message: '工具执行已被用户请求取消。',
        }
      : {
          ok: false,
          error: 'tool_failed',
          message: error && error.message ? error.message : String(error),
        };
  }
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const envelope = buildEnvelope(name, args, data, ctx, options, durationMs);
  appendTrace(envelope, args, data, ctx);
  return envelope;
}

function createRejectedToolResult(name, error, message, ctx = {}, options = {}) {
  const data = {
    ok: false,
    error,
    reason: error,
    message,
    messageKey: `agent_tool.${error}`,
  };
  const envelope = buildEnvelope(name, {}, data, ctx, options, 0);
  appendTrace(envelope, {}, data, ctx);
  return envelope;
}

function createModelResultState(options = {}) {
  return {
    projectId: normalizeProjectId(options.projectId),
    traceId: options.traceId || null,
    readRanges: new Map(),
  };
}

function commonData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const compact = {};
  for (const key of [
    'ok', 'error', 'reason', 'message', 'messageKey', 'needApproval', 'ackToken',
    'toolJobId', 'toolId', 'unhandled', 'dryRun',
  ]) {
    if (data[key] !== undefined) compact[key] = data[key];
  }
  return compact;
}

function tail(value, maxChars = MODEL_OUTPUT_TAIL) {
  const text = String(value == null ? '' : value);
  const limit = Math.max(1, Number(maxChars) || MODEL_OUTPUT_TAIL);
  return text.length <= limit ? text : `…${text.slice(-(limit - 1))}`;
}

function addReadRange(state, key, startLine, endLine) {
  const ranges = state.readRanges.get(key) || [];
  ranges.push([startLine, endLine]);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range[0] > last[1] + 1) merged.push([...range]);
    else last[1] = Math.max(last[1], range[1]);
  }
  state.readRanges.set(key, merged);
}

function rangeSeen(ranges, line) {
  return ranges.some(([start, end]) => line >= start && line <= end);
}

function projectRead(data, envelope, state) {
  const startLine = Number(data.startLine) || 1;
  const lines = String(data.content || '').split(/\r?\n/);
  const endLine = startLine + Math.max(0, lines.length - 1);
  const scopeMatches = state &&
    state.traceId === envelope.traceId &&
    state.projectId !== undefined;
  const key = scopeMatches ? `${state.projectId || '<global>'}\0${String(data.path || '')}` : null;
  const seen = key ? state.readRanges.get(key) || [] : [];
  const segments = [];
  let current = null;
  let omittedPreviouslyReadLines = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = startLine + index;
    if (rangeSeen(seen, lineNumber)) {
      omittedPreviouslyReadLines += 1;
      current = null;
      continue;
    }
    if (!current) {
      current = { startLine: lineNumber, endLine: lineNumber, content: lines[index] };
      segments.push(current);
    } else {
      current.endLine = lineNumber;
      current.content += `\n${lines[index]}`;
    }
  }
  if (key) addReadRange(state, key, startLine, endLine);
  return {
    ...commonData(data),
    path: data.path,
    segments,
    startLine,
    endLine: data.endLine,
    totalLines: data.totalLines,
    sizeBytes: data.sizeBytes,
    sha256: data.sha256,
    truncated: data.truncated === true,
    omittedPreviouslyReadLines,
  };
}

function projectToolData(tool, data, envelope, state) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (envelope.status !== 'success') return commonData(data);

  if (tool === 'workspace_list') {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return {
      ...commonData(data),
      path: data.path,
      entries: entries.slice(0, MODEL_LIST_LIMIT).map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type,
        ...(entry.sizeBytes !== undefined ? { sizeBytes: entry.sizeBytes } : {}),
      })),
      returnedEntries: Math.min(entries.length, MODEL_LIST_LIMIT),
      totalReturnedByTool: entries.length,
      truncated: data.truncated === true || entries.length > MODEL_LIST_LIMIT,
    };
  }
  if (tool === 'workspace_find') {
    const matches = Array.isArray(data.matches) ? data.matches : [];
    return {
      ...commonData(data),
      pattern: data.pattern,
      matches: matches.slice(0, MODEL_LIST_LIMIT).map((match) => ({
        path: match.path,
        ...(match.sizeBytes !== undefined ? { sizeBytes: match.sizeBytes } : {}),
      })),
      returnedMatches: Math.min(matches.length, MODEL_LIST_LIMIT),
      totalReturnedByTool: matches.length,
      filesScanned: data.filesScanned,
      truncated: data.truncated === true || matches.length > MODEL_LIST_LIMIT,
    };
  }
  if (tool === 'workspace_search') {
    const matches = Array.isArray(data.matches) ? data.matches : [];
    return {
      ...commonData(data),
      query: data.query,
      matches: matches.slice(0, MODEL_SEARCH_LIMIT).map((match) => ({
        path: match.path,
        line: match.line,
        text: tail(match.text, MODEL_SEARCH_TEXT_LIMIT),
      })),
      returnedMatches: Math.min(matches.length, MODEL_SEARCH_LIMIT),
      totalReturnedByTool: matches.length,
      filesScanned: data.filesScanned,
      skippedBinaryOrLarge: data.skippedBinaryOrLarge,
      truncated: data.truncated === true || matches.length > MODEL_SEARCH_LIMIT,
    };
  }
  if (tool === 'workspace_read') return projectRead(data, envelope, state);
  if (tool === 'workspace_write' || tool === 'workspace_replace') {
    return {
      ...commonData(data),
      path: data.path,
      created: data.created,
      replacements: data.replacements,
      previousSha256: data.previousSha256,
      sha256: data.sha256,
      sizeBytes: data.sizeBytes,
      changeSummary: data.changeSummary,
    };
  }
  if (tool === 'workspace_exec') {
    return {
      ...commonData(data),
      command: data.command,
      cwd: data.cwd == null ? undefined : '[project workspace]',
      exitCode: data.exitCode,
      signal: data.signal,
      timedOut: data.timedOut === true,
      stdoutTail: data.command === 'pwd' ? '[project workspace]\n' : tail(data.stdout),
      stderrTail: tail(data.stderr),
      truncated: data.truncated === true || String(data.stdout || '').length > MODEL_OUTPUT_TAIL || String(data.stderr || '').length > MODEL_OUTPUT_TAIL,
    };
  }
  // BLOCK-49 — 多 Agent 派生工具面：commonData 白名单会剥掉 agentId/status/kind，
  // 模型拿不到 agentId 就无法 wait_agent（实机回归已证实会触发重复派生异常循环）。
  // 成功与 fail（extra 携带 agentId/reason）两条路径都要保住关键字段。
  if (tool === 'spawn_agent') {
    return {
      ...commonData(data),
      agentId: data.agentId,
      status: data.status,
      kind: data.kind,
      ...(data.model !== undefined ? { model: data.model } : {}),
      ...(data.reason !== undefined ? { reason: data.reason } : {}),
    };
  }
  if (tool === 'list_agents') {
    const agents = Array.isArray(data.agents) ? data.agents : [];
    return {
      ...commonData(data),
      agents: agents.map((agent) => ({
        agentId: agent.agentId,
        status: agent.status,
        agentStatus: agent.agentStatus,
        task: tail(agent.task, 120),
        createdAt: agent.createdAt,
        ...(agent.finishedAt !== undefined ? { finishedAt: agent.finishedAt } : {}),
        ...(agent.error !== undefined ? { error: tail(agent.error, 200) } : {}),
      })),
      returnedAgents: agents.length,
      totalReturnedByTool: agents.length,
    };
  }
  if (tool === 'wait_agent') {
    return {
      ...commonData(data),
      agentId: data.agentId,
      status: data.status,
      agentStatus: data.agentStatus,
      summary: data.summary,
    };
  }
  return data;
}

function fitValidJson(value, maxChars) {
  const redacted = redactSensitiveValue(value);
  let serialized = safeJson(redacted);
  if (serialized.length <= maxChars) return serialized;

  const minimal = {
    contractVersion: redacted.contractVersion,
    traceId: redacted.traceId,
    callId: redacted.callId,
    tool: redacted.tool,
    status: redacted.status,
    terminationReason: redacted.terminationReason,
    truncated: true,
    sideEffects: redacted.sideEffects,
  };
  const dataText = safeJson(redacted.data);
  let room = Math.max(0, maxChars - safeJson({ ...minimal, dataSummary: '' }).length - 8);
  while (room >= 0) {
    serialized = safeJson({ ...minimal, dataSummary: dataText.slice(0, room) });
    if (serialized.length <= maxChars) return serialized;
    room -= Math.max(1, Math.ceil((serialized.length - maxChars) / 2));
  }
  const tiny = safeJson({ tool: redacted.tool, status: redacted.status, truncated: true });
  return tiny.length <= maxChars ? tiny : safeJson({ truncated: true });
}

function cloneModelResultState(state) {
  if (!state) return null;
  return {
    projectId: state.projectId,
    traceId: state.traceId,
    readRanges: new Map(
      [...state.readRanges.entries()].map(([key, ranges]) => [
        key,
        ranges.map((range) => [...range]),
      ])
    ),
  };
}

function serializeToolResultForModel(envelope, maxChars = MODEL_RESULT_LIMIT, options = {}) {
  const state = options.state || null;
  const limit = Math.max(32, Number(maxChars) || MODEL_RESULT_LIMIT);
  // Read deduplication is committed only when the complete structured
  // projection fits. A hard-cap dataSummary must not claim that omitted lines
  // reached the model.
  const projectionState = envelope.tool === 'workspace_read'
    ? cloneModelResultState(state)
    : state;
  const projectedData = projectToolData(envelope.tool, envelope.data, envelope, projectionState);
  const sourceChars = safeJson(redactSensitiveValue(envelope)).length;
  const projected = {
    ...envelope,
    data: projectedData,
    modelContext: {
      projection: envelope.tool,
      sourceChars,
      projectedChars: 0,
      readDeduplicated: envelope.tool === 'workspace_read' && Boolean(state),
      compacted: false,
    },
  };
  // projectedChars includes the measurement metadata itself. Iterate after
  // compacted is known so callers can compare it with the actual JSON length.
  projected.modelContext.compacted = safeJson(redactSensitiveValue(projected)).length < sourceChars;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const projectedChars = safeJson(redactSensitiveValue(projected)).length;
    if (projected.modelContext.projectedChars === projectedChars) break;
    projected.modelContext.projectedChars = projectedChars;
  }
  const serialized = safeJson(redactSensitiveValue(projected));
  if (serialized.length <= limit) {
    if (projectionState && state && envelope.tool === 'workspace_read') {
      state.readRanges = projectionState.readRanges;
    }
    return serialized;
  }
  return fitValidJson(projected, limit);
}

module.exports = {
  MODEL_RESULT_LIMIT,
  TOOL_RESULT_CONTRACT_VERSION,
  createCallId,
  createTraceId,
  createModelResultState,
  createRejectedToolResult,
  executeToolCall,
  replaceToolResultData,
  serializeToolResultForModel,
};
