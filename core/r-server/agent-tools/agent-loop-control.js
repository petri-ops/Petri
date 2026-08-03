'use strict';

// Scientific work is goal-terminated, not round-terminated. These compatibility
// exports remain infinite so existing callers cannot accidentally reintroduce a
// normal-path iteration/tool cap. Runtime termination is driven by a final model
// answer, user cancellation, approval, Provider/tool failure, or anomaly guard.
const MAX_AGENT_TOOL_ITERS = Number.POSITIVE_INFINITY;
const MAX_AGENT_ITERS = Number.POSITIVE_INFINITY;
const MAX_AGENT_TOOL_CALLS = Number.POSITIVE_INFINITY;
const MAX_IDENTICAL_TOOL_CALLS = 3;
// Preserve a long scientific task's full stage trail while keeping persisted
// conversation metadata bounded against runaway provider chatter.
const MAX_AGENT_PROGRESS_UPDATES = 50;
const MAX_FINALIZATION_ATTEMPTS = 2;
const FINALIZATION_RETRY_PROMPT =
  '上一次最终整理没有返回可展示的正文。不要调用工具，不要输出思考过程；只输出面向用户的完整最终答复，说明已完成的工作、结果、需要注意的事项和下一步。';

function normalizeRedactedContextTokenJson(value) {
  return String(value || '').replace(
    /("contextToken"\s*:\s*)\[REDACTED\](?=\s*[,}])/g,
    '$1"[REDACTED]"'
  );
}

function createResultEditCompletionGuard({ required = false } = {}) {
  let candidateCreated = false;
  let recoveryAttempted = false;
  return {
    required: required === true,
    recordToolResult(name, result) {
      if (name === 'result_changeset_create_in_context'
          && result?.ok === true
          && result?.changeSet?.status === 'preview_ready') candidateCreated = true;
    },
    assessTerminal() {
      if (!required || candidateCreated) return { action: 'accept' };
      if (!recoveryAttempted) {
        recoveryAttempted = true;
        return {
          action: 'retry',
          prompt:
            '本轮是由结果编辑器提交的绑定式候选创建请求，界面中的科学影响确认已经由后端保存。你尚未成功创建 preview_ready 候选，不能声称修改、重算或验证已完成。请立即使用当前受信上下文调用必要的 Result Studio 工具完成候选创建；不要只复述上一轮结果，也不要再次向用户索要确认。',
        };
      }
      return {
        action: 'fail',
        message: '结果修改未完成：模型没有创建并验证真实候选版本，系统已阻止展示伪成功结论。请重试本次编辑。',
      };
    },
    snapshot() {
      return { required: required === true, candidateCreated, recoveryAttempted };
    },
  };
}

function shouldFinalizeAgentIteration(iteration, controller) {
  return Boolean(controller && (
    (typeof controller.capHit === 'function' && controller.capHit()) ||
    (typeof controller.anomalyHit === 'function' && controller.anomalyHit())
  ));
}

function assessFinalizationResult(result, streamedText = '') {
  const choice = result && Array.isArray(result.choices) ? result.choices[0] : null;
  const message = choice && choice.message && typeof choice.message === 'object' ? choice.message : {};
  const content = String(streamedText || message.content || '').trim();
  if (content) return { usable: true, retryable: false, reason: null, content };

  if (result && result.error) {
    const { isRetryableProviderError } = require('../../shared-backend/llm-providers/model-gateway');
    const error = typeof result.error === 'string'
      ? result.error
      : String(result.error.code || result.error.type || 'provider_failure');
    const status = Number(result.status || result.statusCode);
    return {
      usable: false,
      retryable: isRetryableProviderError(result),
      reason: Number.isFinite(status) ? `http_${status}` : error,
      content: '',
    };
  }
  if (!choice) {
    return { usable: false, retryable: true, reason: 'invalid_provider_response', content: '' };
  }
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return { usable: false, retryable: true, reason: 'unexpected_tool_calls_in_finalization', content: '' };
  }
  return { usable: false, retryable: true, reason: 'empty_final_response', content: '' };
}

function buildFinalizationFallbackMessage({
  attempts = 1,
  reason = 'empty_final_response',
  anomaly = null,
  lastStageConclusion = '',
} = {}) {
  const reasonLabels = {
    empty_final_response: '上游返回了空正文',
    invalid_provider_response: '上游返回格式异常',
    unexpected_tool_calls_in_finalization: '上游忽略了最终整理约束',
    timeout: '上游响应超时',
    network_error: '上游网络异常',
    http_401: '上游鉴权失败',
    http_403: '上游权限不足',
    http_429: '上游请求过于频繁',
    http_500: '上游服务异常',
    http_502: '上游网关异常',
    http_503: '上游服务暂不可用',
    http_504: '上游网关超时',
  };
  const label = reasonLabels[reason] || `上游异常：${reason}`;
  const attemptCount = Math.max(1, Number(attempts) || 1);
  const stage = compactPublicText(lastStageConclusion, 280);
  const cause = anomaly && anomaly.message
    ? `${anomaly.message}；随后${label}`
    : label;
  const actionLabels = {
    unexpected_tool_calls_in_finalization: '当前模型没有遵守“停止调用工具并给出结论”的协议。若已配置备用模型，系统也已自动尝试；仍失败时请在模型设置中选择工具协议更稳定的模型。',
    empty_final_response: '当前模型连续返回空答复。请稍后重试，或切换备用模型。',
    invalid_provider_response: '模型服务返回格式不完整。请检查该 Endpoint 的 OpenAI 兼容协议，或切换备用模型。',
    timeout: '请检查网络或 Endpoint 状态；任务结果已经保留，不需要重新运行已完成步骤。',
    network_error: '请检查网络或 Endpoint 状态；任务结果已经保留，不需要重新运行已完成步骤。',
    http_401: '请在模型设置中更新失效的 API Key。',
    http_403: '请确认当前 API Key 对所选模型和 Endpoint 具有访问权限。',
    http_429: '当前服务触发限流；请稍后重试或切换备用模型。',
    http_500: '上游服务异常；请稍后重试或切换备用模型。',
    http_502: '上游网关异常；请稍后重试或切换备用模型。',
    http_503: '上游服务暂不可用；请稍后重试或切换备用模型。',
    http_504: '上游网关超时；请稍后重试或切换备用模型。',
  };
  const action = actionLabels[reason] || '请展开上方处理详情查看最后一个异常；已完成的工具结果和文件均已保留。';
  const automaticActions = [
    anomaly ? '停止异常调用' : null,
    '保留已有工具结果',
    `自动尝试最终整理 ${attemptCount} 次`,
  ].filter(Boolean).join('、');
  return [
    '任务在自动恢复后仍未完成。',
    stage ? `停止位置：${stage}` : null,
    `原因：${cause}。`,
    `系统已处理：${automaticActions}。`,
    `需要处理：${action}`,
  ].filter(Boolean).join('\n\n');
}

function compactPublicText(value, maxLength = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function finalizationFallbackReason(result) {
  const assessment = assessFinalizationResult(result);
  return !assessment.usable && assessment.retryable
    ? { code: assessment.reason || 'invalid_final_response' }
    : null;
}

function buildFinalizationRetryRequest(requestBody) {
  return {
    ...(requestBody || {}),
    messages: [...(Array.isArray(requestBody?.messages) ? requestBody.messages : []), {
      role: 'system',
      content: FINALIZATION_RETRY_PROMPT,
    }],
    temperature: 0.2,
    tools: undefined,
    tool_choice: undefined,
  };
}

function createAgentProgressRecorder(options = {}) {
  const maxItems = Math.max(1, Number(options.maxItems) || MAX_AGENT_PROGRESS_UPDATES);
  const maxContentLength = Math.max(200, Number(options.maxContentLength) || 4000);
  const updates = [];
  return {
    record(content, iteration) {
      const bounded = String(content || '').trim().slice(0, maxContentLength);
      if (!bounded || updates[updates.length - 1]?.content === bounded) return null;
      const progress = {
        iteration: Math.max(1, Number(iteration) || updates.length + 1),
        content: bounded,
      };
      updates.push(progress);
      if (updates.length > maxItems) updates.splice(0, updates.length - maxItems);
      return progress;
    },
    snapshot() {
      return updates.map((item) => ({ ...item }));
    },
  };
}

function createAgentToolCallController(options = {}) {
  const configuredMax = Number(options.maxToolCalls);
  const maxToolCalls = Number.isFinite(configuredMax) && configuredMax > 0
    ? Math.max(1, configuredMax)
    : Number.POSITIVE_INFINITY;
  const seenProviderCallIds = new Set();
  const reservedProtocolCallIds = new Set();
  let lastSemanticCallKey = null;
  let consecutiveSemanticCallCount = 0;
  let totalToolCalls = 0;
  let generatedProtocolCallId = 0;
  let repeatedCallAnomaly = false;
  let anomaly = null;

  function capHit() {
    return Number.isFinite(maxToolCalls) && totalToolCalls >= maxToolCalls;
  }

  function anomalyHit() {
    return repeatedCallAnomaly;
  }

  function reserve(toolCalls) {
    const calls = Array.isArray(toolCalls) ? toolCalls : [];
    const remaining = Math.max(0, maxToolCalls - totalToolCalls);
    const accepted = calls.slice(0, remaining);
    totalToolCalls += accepted.length;
    return {
      accepted,
      omitted: Math.max(0, calls.length - accepted.length),
      totalToolCalls,
      capHit: capHit(),
    };
  }

  function parse(toolCall, fallbackCallId) {
    const fn = toolCall && typeof toolCall === 'object' && toolCall.function && typeof toolCall.function === 'object'
      ? toolCall.function
      : {};
    const providerCallId = typeof toolCall?.id === 'string' && toolCall.id.trim()
      ? toolCall.id.trim()
      : fallbackCallId;
    const name = typeof fn.name === 'string' ? fn.name.trim() : '';

    if (seenProviderCallIds.has(providerCallId) || reservedProtocolCallIds.has(providerCallId)) {
      return {
        ok: false,
        name,
        callId: providerCallId,
        args: {},
        error: 'duplicate_tool_call',
        message: 'Provider 重复使用了同一个 tool call id；该调用未执行',
      };
    }
    seenProviderCallIds.add(providerCallId);

    let args;
    try {
      const rawArguments = typeof fn.arguments === 'string' && fn.arguments.trim() ? fn.arguments : '{}';
      args = JSON.parse(normalizeRedactedContextTokenJson(rawArguments));
    } catch {
      return {
        ok: false,
        name,
        callId: providerCallId,
        args: {},
        error: 'invalid_arguments',
        message: 'Provider 返回的工具参数不是合法 JSON；该调用未执行',
      };
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return {
        ok: false,
        name,
        callId: providerCallId,
        args: {},
        error: 'invalid_arguments',
        message: 'Provider 返回的工具参数必须是 JSON 对象；该调用未执行',
      };
    }
    // Some OpenAI-compatible Providers occasionally wrap the declared JSON
    // object in a single `arguments` string. Accept only that exact transport
    // envelope, then run the normal schema/policy/context checks on the
    // decoded object. Extra wrapper keys, arrays and scalars remain untouched
    // and fail at the existing boundary.
    if (Object.keys(args).length === 1 && typeof args.arguments === 'string') {
      try {
        // A few Providers serialize the diagnostic redaction marker as a
        // bare token inside the stringified envelope. Repair only the exact
        // contextToken placeholder; result-context binding will replace the
        // resulting string with the click-time trusted token before schema
        // validation. Other malformed JSON remains rejected downstream.
        const normalizedArguments = normalizeRedactedContextTokenJson(args.arguments);
        const decoded = JSON.parse(normalizedArguments);
        if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) args = decoded;
      } catch {}
    }
    const semanticKey = `${name}:${stableJson(args)}`;
    consecutiveSemanticCallCount = semanticKey === lastSemanticCallKey
      ? consecutiveSemanticCallCount + 1
      : 1;
    lastSemanticCallKey = semanticKey;
    if (consecutiveSemanticCallCount >= MAX_IDENTICAL_TOOL_CALLS) {
      repeatedCallAnomaly = true;
      anomaly = {
        code: 'repeated_tool_call',
        tool: name || 'unknown_tool',
        message: `检测到 ${name || '同一工具'} 使用相同参数连续调用 ${consecutiveSemanticCallCount} 次，系统已停止异常循环`,
      };
      return {
        ok: false,
        name,
        callId: providerCallId,
        args,
        error: 'repeated_tool_call',
        message: `检测到相同工具和参数已连续重复 ${consecutiveSemanticCallCount} 次；为避免异常循环，该调用未执行`,
      };
    }
    return { ok: true, name, callId: providerCallId, args };
  }

  function reserveProtocolCallId(preferredCallId, createCallId) {
    const preferred = typeof preferredCallId === 'string' ? preferredCallId.trim() : '';
    if (preferred && !reservedProtocolCallIds.has(preferred)) {
      reservedProtocolCallIds.add(preferred);
      return preferred;
    }

    const factory = typeof createCallId === 'function' ? createCallId : () => '';
    let candidate = String(factory() || '').trim();
    if (!candidate) candidate = `call_generated_${++generatedProtocolCallId}`;
    while (reservedProtocolCallIds.has(candidate) || seenProviderCallIds.has(candidate)) {
      candidate = `${candidate}_${++generatedProtocolCallId}`;
    }
    reservedProtocolCallIds.add(candidate);
    return candidate;
  }

  return {
    capHit,
    anomalyHit,
    get anomaly() {
      return anomaly ? { ...anomaly } : null;
    },
    reserve,
    parse,
    reserveProtocolCallId,
    get totalToolCalls() {
      return totalToolCalls;
    },
    get remainingToolCalls() {
      return Math.max(0, maxToolCalls - totalToolCalls);
    },
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function runAgentToolCallBatch(options = {}) {
  const controller = options.controller;
  if (
    !controller ||
    typeof controller.reserve !== 'function' ||
    typeof controller.parse !== 'function' ||
    typeof controller.reserveProtocolCallId !== 'function'
  ) {
    throw new TypeError('controller is required');
  }
  const createFallbackCallId = typeof options.createCallId === 'function'
    ? options.createCallId
    : () => `call_${Date.now()}`;
  const reservation = controller.reserve(options.toolCalls);
  const prepared = reservation.accepted.map((rawToolCall) => {
    const providerCallId = typeof rawToolCall?.id === 'string' && rawToolCall.id.trim()
      ? rawToolCall.id.trim()
      : createFallbackCallId();
    let toolCall = {
      ...(rawToolCall && typeof rawToolCall === 'object' ? rawToolCall : {}),
      id: providerCallId,
    };
    let parsed = controller.parse(toolCall, providerCallId);

    // Provider and generated protocol IDs are request-scoped. Duplicate or
    // colliding IDs are rejected without executing the handler, while history
    // receives a fresh ID so every assistant call still has one paired result.
    const protocolCallId = controller.reserveProtocolCallId(
      parsed.error === 'duplicate_tool_call' ? null : providerCallId,
      createFallbackCallId
    );
    if (protocolCallId !== providerCallId) {
      toolCall = { ...toolCall, id: protocolCallId };
      parsed = { ...parsed, callId: protocolCallId, providerCallId };
    }
    return { toolCall, parsed };
  });
  const accepted = prepared.map((item) => item.toolCall);

  if (accepted.length && typeof options.onReserved === 'function') {
    await options.onReserved(accepted, reservation);
  }

  const outcomes = [];
  for (const item of prepared) {
    const { toolCall } = item;
    const fn = toolCall.function && typeof toolCall.function === 'object' ? toolCall.function : {};
    const canceled = typeof options.shouldAbort === 'function' && options.shouldAbort();
    const parsed = canceled
      ? {
          ok: false,
          name: typeof fn.name === 'string' ? fn.name.trim() : '',
          callId: toolCall.id,
          args: {},
          error: 'request_canceled',
          message: '请求已取消；该调用未执行',
        }
      : item.parsed;
    const outcome = parsed.ok
      ? await options.execute(parsed, toolCall)
      : await options.reject(parsed, toolCall);
    outcomes.push({ toolCall, parsed, outcome });
    if (typeof options.onResult === 'function') {
      await options.onResult({ toolCall, parsed, outcome });
    }
  }

  return { ...reservation, accepted, outcomes };
}

module.exports = {
  MAX_AGENT_ITERS,
  MAX_AGENT_TOOL_ITERS,
  MAX_AGENT_TOOL_CALLS,
  MAX_IDENTICAL_TOOL_CALLS,
  MAX_FINALIZATION_ATTEMPTS,
  FINALIZATION_RETRY_PROMPT,
  shouldFinalizeAgentIteration,
  assessFinalizationResult,
  buildFinalizationRetryRequest,
  buildFinalizationFallbackMessage,
  finalizationFallbackReason,
  createAgentProgressRecorder,
  createResultEditCompletionGuard,
  createAgentToolCallController,
  runAgentToolCallBatch,
};
