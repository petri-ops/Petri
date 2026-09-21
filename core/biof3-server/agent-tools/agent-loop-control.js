'use strict';

// BLOCK-109-CORE-ARCH P2 — 工具执行元数据（调度分组地基）
const { getToolMetadata } = require('./tool-metadata');

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
// 方案 B complete：截断自动续写时的硬保护。
// 任务自描述由模型的 finish_reason 决定，但必须给"无法收敛"一个硬上限：
//   MAX_CONTINUATION_CHAINS 防止单任务内连续续写链无限拉长；
//   MAX_CONTINUATION_TOKENS 防止累计请求 token 把上下文或成本打爆。
// 这两个上限是"防失控"，不是"限制任务完整性"——只有连续截断到顶时才会触发，
// 此时主动收尾 + 提示用户继续，比让模型无限续写更可靠。
const MAX_CONTINUATION_CHAINS = 4;
const MAX_CONTINUATION_TOKENS = 65536;
const FINALIZATION_RETRY_PROMPT =
  '上一次最终整理没有返回可展示的正文。不要调用工具，不要输出思考过程；只输出面向用户的完整最终答复，说明已完成的工作、结果、需要注意的事项和下一步。';

function normalizeRedactedContextTokenJson(value) {
  return String(value || '').replace(
    /("contextToken"\s*:\s*)\[REDACTED\](?=\s*[,}])/g,
    '$1"[REDACTED]"'
  );
}

function recoverSealedResultEditArgs(name, value) {
  if (name !== 'result_changeset_create_in_context') return null;
  const source = String(value || '');
  const intentIds = [...source.matchAll(/"intentId"\s*:\s*"(rei_[A-Za-z0-9_-]{1,128})"/g)]
    .map((match) => match[1]);
  if (new Set(intentIds).size !== 1) return null;
  const tokenMatch = source.match(
    /"contextToken"\s*:\s*(?:"([a-f0-9]{64}|\[REDACTED\])"|(\[REDACTED\]))/
  );
  const confirmedMatch = source.match(/"scientificConfirmed"\s*:\s*(true|false)/);
  return {
    ...(tokenMatch ? { contextToken: tokenMatch[1] || tokenMatch[2] } : {}),
    intent: { intentId: intentIds[0] },
    ...(confirmedMatch ? { scientificConfirmed: confirmedMatch[1] === 'true' } : {}),
  };
}

function isExplicitEnrichmentAction(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || !/(?:\bGO\b|\bKEGG\b|富集)/i.test(text)) return false;
  const presentationOnly = /(?:配色|颜色|字号|字体|布局|标注|标签|图例|展示|显示|排序)/i.test(text)
    && !/(?:重算|重新计算|重跑|运行|执行|进行|开展|分析)/i.test(text);
  if (presentationOnly) return false;
  return /(?:做|进行|运行|执行|开展|继续|分析|重算|重新计算|重跑)[^。！？]*(?:\bGO\b|\bKEGG\b|富集)|(?:\bGO\b|\bKEGG\b)[^。！？]*富集|富集(?:分析|计算)/i.test(text);
}

function createResultEditCompletionGuard({ expectation, required = false, requestedOutcome = '' } = {}) {
  const completionExpectation = ['candidate', 'result_action', 'none'].includes(expectation)
    ? expectation
    : (required === true ? 'candidate' : 'none');
  const completionTarget = completionExpectation === 'result_action'
    && isExplicitEnrichmentAction(requestedOutcome)
    ? 'enrichment'
    : completionExpectation;
  let candidateCreated = false;
  let enrichmentJobStarted = false;
  let recoveryAttempted = false;
  const satisfied = () => candidateCreated
    || (completionExpectation === 'result_action' && enrichmentJobStarted);
  return {
    required: completionExpectation !== 'none',
    requiresToolExecution() {
      return completionExpectation !== 'none' && recoveryAttempted && !satisfied();
    },
    requiredToolChoice() {
      return completionTarget === 'enrichment'
        ? { type: 'function', function: { name: 'result_enrichment_from_context' } }
        : 'required';
    },
    recordToolResult(name, result) {
      if (name === 'result_changeset_create_in_context'
          && result?.ok === true
          && result?.changeSet?.status === 'preview_ready') candidateCreated = true;
      if (name === 'result_enrichment_from_context'
          && result?.ok === true
          && result?.toolId === 'go-kegg'
          && typeof result?.result?.toolJobId === 'string'
          && result.result.toolJobId.trim()) enrichmentJobStarted = true;
    },
    assessTerminal() {
      if (completionExpectation === 'none' || satisfied()) return { action: 'accept' };
      if (!recoveryAttempted) {
        recoveryAttempted = true;
        if (completionExpectation === 'result_action') {
          return {
            action: 'retry',
            reason: 'result_action_not_executed',
            message: '模型尚未执行真实结果动作，正在自动纠正执行…',
            prompt:
              '本轮是由结果区自然语言 Composer 提交的受信结果动作，不等同于一律创建参数候选。你尚未成功执行任何与用户原始目标一致的结果动作，不能声称分析、修改或验证已完成。必须立即选择并调用正确的 Result Studio 执行工具：如果用户要求基于当前 DEG 或当前基因选择做 GO/KEGG 富集，直接调用 result_enrichment_from_context；如果用户要求修改当前结果的参数或呈现，才使用 result_edit_plan_in_context 后调用 result_changeset_create_in_context。不要把富集请求改写成候选创建，不要轮询无关或旧的 ChangeSet，也不要只复述上一轮结果。',
          };
        }
        return {
          action: 'retry',
          reason: 'candidate_not_created',
          message: '模型尚未创建真实候选，正在自动纠正执行…',
          prompt:
            '本轮是由结果编辑器提交的绑定式候选创建请求，界面中的科学影响确认已经由后端保存。你尚未成功创建 preview_ready 候选，不能声称修改、重算或验证已完成。请立即使用当前受信上下文调用必要的 Result Studio 工具完成候选创建；不要只复述上一轮结果，也不要再次向用户索要确认。',
        };
      }
      return {
        action: 'fail',
        message: completionExpectation === 'result_action'
          ? '结果动作未完成：模型没有执行与用户目标一致的受信结果工具，系统已阻止展示伪成功结论。请重试本次操作。'
          : '结果修改未完成：模型没有创建并验证真实候选版本，系统已阻止展示伪成功结论。请重试本次编辑。',
      };
    },
    snapshot() {
      return {
        required: completionExpectation !== 'none',
        expectation: completionExpectation,
        target: completionTarget,
        candidateCreated,
        enrichmentJobStarted,
        recoveryAttempted,
      };
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
  
  // 方案 B：识别 finish_reason === 'length'（被 token 上限截断）
  // 虽然被截断，但内容仍可用；标记为 truncated 而不是 empty
  const finishReason = choice && choice.finish_reason;
  const truncatedByLimit = finishReason === 'length';
  
  if (content) {
    return {
      usable: true,
      retryable: false,
      reason: truncatedByLimit ? 'truncated_at_limit' : null,
      content,
      truncated: truncatedByLimit,
    };
  }

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

// 方案 B complete：跟踪单任务内的截断自动续写，提供硬上限。
// 计数维度：
//   chains        — 连续续写段数（每次自然停止 finish_reason=stop 重置）
//   totalTokens   — 累计请求 token（截断时按 max_tokens 估算，停止时不计）
// 一旦命中上限，capHit() → true，配合 shouldFinalizeAgentIteration 触发收尾。
function createContinuationGuard(options = {}) {
  const maxChains = Math.max(1, Number(options.maxChains) || MAX_CONTINUATION_CHAINS);
  const maxTokens = Math.max(1, Number(options.maxTokens) || MAX_CONTINUATION_TOKENS);
  let chains = 0;
  let totalTokens = 0;
  return {
    recordTruncation(approxTokens = 0) {
      chains += 1;
      totalTokens += Math.max(0, Number(approxTokens) || 0);
    },
    recordStop() {
      chains = 0;
    },
    capHit() {
      return chains >= maxChains || totalTokens >= maxTokens;
    },
    snapshot() {
      return { chains, totalTokens, maxChains, maxTokens };
    },
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
      args = recoverSealedResultEditArgs(name, fn.arguments);
      if (!args) {
        return {
          ok: false,
          name,
          callId: providerCallId,
          args: {},
          error: 'invalid_arguments',
          message: 'Provider 返回的工具参数不是合法 JSON；该调用未执行',
        };
      }
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
      } catch {
        const recovered = recoverSealedResultEditArgs(name, args.arguments);
        if (recovered) args = recovered;
      }
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
  // BLOCK-109-CORE-ARCH P2-3 — 调度分组：readOnly && concurrentSafe 组并行执行，
  // 其余（写/破坏性/OS 自动化/spawn 族）保持原序串行。spawn 族 concurrentSafe=false
  // 是硬组合语义（P2-5）：派发并行度软上限（SPAWN_CONCURRENCY_LIMIT）在 spawn 执行器
  // 内生效，分组并行永不绕过。结果按原 prepared 顺序重组，调用方契约不变。
  const outcomeByIndex = new Array(prepared.length);
  const parallelItems = [];
  const serialItems = [];
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    const fn = item.toolCall.function && typeof item.toolCall.function === 'object' ? item.toolCall.function : {};
    const name = typeof fn.name === 'string' ? fn.name.trim() : '';
    const meta = getToolMetadata(name);
    if (item.parsed.ok && meta.readOnly && meta.concurrentSafe) parallelItems.push({ item, index: i });
    else serialItems.push({ item, index: i });
  }
  const runItem = async (item) => {
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
    return { toolCall, parsed, outcome };
  };
  if (parallelItems.length > 0) {
    const parallelResults = await Promise.all(parallelItems.map(async ({ item }) => {
      const result = await runItem(item);
      if (typeof options.onResult === 'function') {
        await options.onResult(result);
      }
      return result;
    }));
    parallelItems.forEach(({ index }, i) => { outcomeByIndex[index] = parallelResults[i]; });
  }
  for (const { item, index } of serialItems) {
    const result = await runItem(item);
    if (typeof options.onResult === 'function') {
      await options.onResult(result);
    }
    outcomeByIndex[index] = result;
  }
  for (const r of outcomeByIndex) {
    if (r) outcomes.push(r);
  }

  return { ...reservation, accepted, outcomes };
}

module.exports = {
  MAX_AGENT_ITERS,
  MAX_AGENT_TOOL_ITERS,
  MAX_AGENT_TOOL_CALLS,
  MAX_IDENTICAL_TOOL_CALLS,
  MAX_FINALIZATION_ATTEMPTS,
  MAX_CONTINUATION_CHAINS,
  MAX_CONTINUATION_TOKENS,
  FINALIZATION_RETRY_PROMPT,
  shouldFinalizeAgentIteration,
  assessFinalizationResult,
  buildFinalizationRetryRequest,
  buildFinalizationFallbackMessage,
  finalizationFallbackReason,
  createAgentProgressRecorder,
  createContinuationGuard,
  createResultEditCompletionGuard,
  createAgentToolCallController,
  runAgentToolCallBatch,
};
