'use strict';
'use strict';
'use strict';

const MAX_AGENT_ITERS = 5;
const MAX_AGENT_TOOL_CALLS = 12;

function shouldFinalizeAgentIteration(iteration, controller) {
  return iteration >= MAX_AGENT_ITERS - 1 || Boolean(controller && controller.capHit());
}

function createAgentToolCallController(options = {}) {
  const maxToolCalls = Math.max(1, Number(options.maxToolCalls) || MAX_AGENT_TOOL_CALLS);
  const seenProviderCallIds = new Set();
  const reservedProtocolCallIds = new Set();
  let totalToolCalls = 0;
  let generatedProtocolCallId = 0;

  function capHit() {
    return totalToolCalls >= maxToolCalls;
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
      args = JSON.parse(typeof fn.arguments === 'string' && fn.arguments.trim() ? fn.arguments : '{}');
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
  MAX_AGENT_TOOL_CALLS,
  shouldFinalizeAgentIteration,
  createAgentToolCallController,
  runAgentToolCallBatch,
};
