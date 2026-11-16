/**
 * responses.js — DeepSeek Responses API adapter（BLOCK-454 P5）。
 *
 * 契约（findings UNVERIFIED 项补抓，2026-11-17 官方 create-response 页 VERIFIED）：
 *   POST {baseUrl}/responses，Bearer；请求 model/input/instructions/reasoning{effort}/
 *   max_output_tokens（**不是** Chat 的 max_tokens）/tools（function 扁平形）/tool_choice/
 *   temperature/top_p/text.format/safety_check{level}/title{enabled}；
 *   content 块 input_text|input_image(image_url|file_id 互斥)|input_file(file_id,user only)|reasoning_text；
 *   响应 id/object:"response"/status/incomplete_details/output[]/title/usage；
 *   流式 event+sequence_number，无 [DONE]，终事件 completed/incomplete/failed。
 *
 * 设计：OpenAI-compat 请求体进（网关既有调用面零改动）→ Responses 请求转换 →
 * 响应/流式事件归一回 OpenAI-compat 信封（choices/message/usage），四类内容投影不丢：
 *   thinking → reasoning_content；tool_use → tool_calls；citations(web_search_call sources)
 *   → deepseekResponses；refusal(content_filter) → finish_reason。
 * safety_check / title 仅参数级透传——**不替换 Petri 本地审批/治理链**（plan P5 非范围）。
 */

const aiUsageHelper = require('../ai-usage-helper');
const { extractCacheFields: cacheFieldsOf } = require('./protocol-usage');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';

function baseUrlOf(options) {
  return String((options && options.baseUrl) || DEFAULT_BASE_URL).replace(/\/$/, '');
}

/** usage 计量（与 deepseek.js 同构 usageArgs；helper 未装配时静默跳过）。 */
function usageArgs(telemetry, body, startedAt, usage, errorCode) {
  if (!aiUsageHelper || typeof aiUsageHelper.recordAiUsage !== 'function') return;
  const u = usage || {};
  try {
    aiUsageHelper.recordAiUsage({
      userId: telemetry.userId,
      kind: telemetry.kind || 'agent_iter',
      model: (body && body.model) || 'deepseek-flash',
      provider: (telemetry && telemetry.provider) || null,
      promptTokens: u.prompt_tokens || 0,
      completionTokens: u.completion_tokens || 0,
      ...(cacheFieldsOf(usage)),
      latencyMs: Date.now() - startedAt,
      errorCode: errorCode || null,
      conversationId: telemetry.conversationId,
    });
  } catch {
    // 计量失败不影响调用主链路
  }
}

// ---------- 请求转换（OpenAI-compat → Responses） ----------

function textPart(text) {
  return { type: 'input_text', text: String(text == null ? '' : text) };
}

function imagePartFromOpenAI(part) {
  const url = typeof part.image_url === 'string' ? part.image_url : part.image_url && part.image_url.url;
  if (!url) return null;
  // 官方契约：input_image 的 image_url 与 file_id 互斥；data URL / http(s) 走 image_url。
  return { type: 'input_image', image_url: String(url) };
}

function toolNameOf(tool) {
  return tool && tool.function && tool.function.name ? tool.function.name : tool && tool.name;
}

/**
 * OpenAI-compat 请求体 → Responses 请求体。
 * @returns {object} Responses 请求体（model/input/[instructions]/[reasoning]/[max_output_tokens]/tools/…）
 */
function openAIToResponsesRequest(body) {
  const source = body || {};
  const input = [];
  for (const message of Array.isArray(source.messages) ? source.messages : []) {
    if (!message || typeof message !== 'object') continue;
    // assistant 历史里的 tool_calls → function_call items
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      for (const call of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: String((call && call.id) || ''),
          name: toolNameOf(call) || '',
          arguments: typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments || {}),
        });
      }
      if (typeof message.content === 'string' && message.content.trim()) {
        input.push({ role: 'assistant', content: [textPart(message.content)] });
      }
      continue;
    }
    // tool 结果 → function_call_output item
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: String(message.tool_call_id || ''),
        output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content || ''),
      });
      continue;
    }
    const role = message.role === 'assistant' ? 'assistant' : message.role;
    const content = [];
    if (typeof message.content === 'string') {
      if (message.content.trim()) content.push(textPart(message.content));
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!part || typeof part !== 'object') continue;
        if (part.type === 'text' && part.text) content.push(textPart(part.text));
        else if (part.type === 'image_url') {
          const imagePart = imagePartFromOpenAI(part);
          if (imagePart) content.push(imagePart);
        } else if (part.type === 'file' && part.file_id) {
          content.push({ type: 'input_file', file_id: String(part.file_id) });
        }
      }
    }
    if (content.length === 0) continue;
    input.push({ role, content });
  }

  const request = { model: source.model, input };
  if (typeof source.instructions === 'string' && source.instructions) request.instructions = source.instructions;
  // thinking 映射产物：reasoning {effort}（thinking-level.js responses 协议）原样透传
  if (source.reasoning && typeof source.reasoning === 'object') request.reasoning = source.reasoning;
  // Chat 参数名 → Responses 参数名（官方逐字：max_output_tokens 含可见输出与思维链）
  if (Number.isFinite(Number(source.max_output_tokens))) request.max_output_tokens = Number(source.max_output_tokens);
  else if (Number.isFinite(Number(source.max_tokens))) request.max_output_tokens = Number(source.max_tokens);
  if (Number.isFinite(Number(source.temperature))) request.temperature = Number(source.temperature);
  if (Number.isFinite(Number(source.top_p))) request.top_p = Number(source.top_p);
  if (source.text_format && typeof source.text_format === 'object') request.text = { format: source.text_format };
  // tools：OpenAI 嵌套 function 形 → Responses 扁平形；内联工具（deepseek_web_search 等）原样透传
  if (Array.isArray(source.tools) && source.tools.length > 0) {
    request.tools = source.tools.map((tool) => {
      if (tool && tool.type === 'function' && tool.function && !tool.name) {
        return {
          type: 'function',
          name: tool.function.name,
          ...(tool.function.description ? { description: tool.function.description } : {}),
          ...(tool.function.parameters ? { parameters: tool.function.parameters } : {}),
        };
      }
      return tool;
    });
  }
  if (source.tool_choice !== undefined) request.tool_choice = source.tool_choice;
  // BLOCK-454 P5 — safety_check / title 仅参数级透传；Petri 本地审批/治理链不动（丢魂红线）。
  if (source.safety_check && typeof source.safety_check === 'object') request.safety_check = source.safety_check;
  if (source.title && typeof source.title === 'object') request.title = source.title;
  return request;
}

// ---------- 响应归一（Responses → OpenAI-compat 信封） ----------

/**
 * @returns {object} { id, object:'chat.completion', model, choices:[{message, finish_reason}], usage, deepseekResponses }
 */
function responsesToOpenAIResponse(payload, requestedModel) {
  const output = payload && Array.isArray(payload.output) ? payload.output : [];
  const message = { role: 'assistant', content: '' };
  const toolCalls = [];
  const webSearchCalls = [];
  let reasoningText = '';
  let hasFunctionCall = false;
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : [];
      message.content = parts
        .filter((p) => p && p.type === 'output_text' && typeof p.text === 'string')
        .map((p) => p.text)
        .join('');
    } else if (item.type === 'reasoning') {
      const parts = Array.isArray(item.content) ? item.content : [];
      reasoningText += parts
        .filter((p) => p && p.type === 'reasoning_text' && typeof p.text === 'string')
        .map((p) => p.text)
        .join('');
    } else if (item.type === 'function_call') {
      hasFunctionCall = true;
      toolCalls.push({
        id: String(item.call_id || ''),
        type: 'function',
        function: { name: item.name || '', arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}) },
      });
    } else if (item.type === 'web_search_call') {
      webSearchCalls.push(item);
    }
  }
  if (reasoningText) message.reasoning_content = reasoningText;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  // 投影不丢：incomplete reason → finish_reason（refusal=content_filter / 截断=length）
  let finishReason = 'stop';
  const status = payload && payload.status;
  const incompleteReason = payload && payload.incomplete_details && payload.incomplete_details.reason;
  if (status === 'incomplete' && incompleteReason === 'content_filter') finishReason = 'content_filter';
  else if (status === 'incomplete') finishReason = 'length';
  else if (hasFunctionCall) finishReason = 'tool_calls';

  const rawUsage = (payload && payload.usage) || {};
  const usage = {
    prompt_tokens: Number.isFinite(Number(rawUsage.input_tokens)) ? Number(rawUsage.input_tokens) : 0,
    completion_tokens: Number.isFinite(Number(rawUsage.output_tokens)) ? Number(rawUsage.output_tokens) : 0,
    total_tokens: Number.isFinite(Number(rawUsage.total_tokens)) ? Number(rawUsage.total_tokens)
      : (Number.isFinite(Number(rawUsage.input_tokens)) + Number.isFinite(Number(rawUsage.output_tokens))
        ? Number(rawUsage.input_tokens) + Number(rawUsage.output_tokens) : 0),
  };
  if (rawUsage.input_tokens_details) usage.input_tokens_details = rawUsage.input_tokens_details;
  if (rawUsage.output_tokens_details) usage.output_tokens_details = rawUsage.output_tokens_details;
  if (rawUsage.safety_tokens !== undefined) usage.safety_tokens = rawUsage.safety_tokens;
  if (rawUsage.server_tool_use) usage.server_tool_use = rawUsage.server_tool_use;

  if (status === 'failed') {
    return {
      error: 'api_error',
      message: (payload.error && payload.error.message) || 'Responses 调用失败',
      ...(payload.error && payload.error.code ? { code: payload.error.code } : {}),
      status: undefined,
      usage,
    };
  }

  return {
    id: payload && payload.id,
    object: 'chat.completion',
    model: (payload && payload.model) || requestedModel,
    choices: [{ message, finish_reason: finishReason, index: 0 }],
    usage,
    // citations/refusal 之外的可审计投影：web_search_call 原样保留（sources 来源可审计，P3-a）
    deepseekResponses: {
      ...(webSearchCalls.length ? { webSearchCalls } : {}),
      ...(payload && payload.title ? { title: payload.title } : {}),
      ...(incompleteReason ? { incompleteReason } : {}),
    },
  };
}

// ---------- 流式 SSE 归一 ----------

function parseSseFrames(text) {
  const frames = [];
  for (const block of text.split('\n\n')) {
    let event = null;
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!event || dataLines.length === 0) continue;
    try {
      frames.push({ event, data: JSON.parse(dataLines.join('\n')) });
    } catch {
      // 单帧解析失败不炸整流（诚实丢弃，不猜事件语义）
    }
  }
  return frames;
}

class ResponsesStreamAggregator {
  constructor(requestedModel) {
    this.requestedModel = requestedModel;
    this.finalPayload = null;
  }

  observe(frame, onEvent) {
    const { event, data } = frame;
    if (event === 'response.output_text.delta') {
      if (data && typeof data.delta === 'string') onEvent({ type: 'content_delta', content: data.delta });
      return;
    }
    if (event === 'response.in_progress' || event === 'response.output_item.added' || event === 'response.content_part.added') {
      return; // 进度类事件：不计入聚合
    }
    if (event === 'response.created' || event === 'response.output_text.done' || event === 'response.content_part.done' || event === 'response.output_item.done') {
      if (event === 'response.created' && data) this.finalPayload = data;
      return;
    }
    if (event === 'response.completed' || event === 'response.incomplete' || event === 'response.failed') {
      this.finalPayload = data || this.finalPayload;
      return;
    }
    // 未知事件：不猜语义（诚实丢弃；原始帧可经 transcript 侧核对）
  }

  /** 终事件后的聚合信封（OpenAI-compat）。 */
  resolve(onEvent) {
    const payload = this.finalPayload || {};
    const envelope = responsesToOpenAIResponse(payload, this.requestedModel);
    if (envelope.error) {
      onEvent({ type: 'error', error: envelope.error, message: envelope.message });
      return envelope;
    }
    onEvent({ type: 'done', usage: envelope.usage });
    return envelope;
  }
}

// ---------- Provider 适配（LLMProvider 接口） ----------

class ResponsesProvider {
  constructor(config = {}) {
    this.name = config.name || 'deepseek-responses';
    this.providerLabel = config.label || 'DeepSeek (Responses)';
    this.defaultBaseUrl = config.defaultBaseUrl || DEFAULT_BASE_URL;
    this.capabilities = 'chat';
  }

  async chat(apiKey, body, telemetry, options = {}) {
    if (!apiKey) return { error: 'no_api_key', message: `${this.providerLabel} API key 未配置` };
    const startedAt = Date.now();
    let requestBody;
    try {
      requestBody = JSON.stringify(openAIToResponsesRequest(body));
    } catch (error) {
      usageArgs(telemetry, body, startedAt, null, 'serialize_error');
      return { error: 'serialize_error', message: error.message };
    }
    const t = telemetry || {};
    try {
      const response = await fetch(`${baseUrlOf(options)}/responses`, {
        method: 'POST',
        signal: options.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: requestBody,
      });
      const text = await response.text();
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(text);
          message = (parsed.error && parsed.error.message) || message;
        } catch { /* 保留 HTTP 状态文案 */ }
        usageArgs(t, body, startedAt, null, 'http_error');
        return {
          error: 'http_error',
          message,
          status: response.status,
          retryable: response.status >= 500 && response.status !== 401 && response.status !== 403,
        };
      }
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        usageArgs(t, body, startedAt, null, 'parse_error');
        return { error: 'parse_error', message: 'Responses 响应不是 JSON。' };
      }
      const envelope = responsesToOpenAIResponse(payload, body && body.model);
      usageArgs(t, body, startedAt, envelope.usage, envelope.error ? 'api_error' : null);
      return envelope;
    } catch (error) {
      const code = error && error.name === 'AbortError' ? 'aborted' : 'network_error';
      usageArgs(t, body, startedAt, null, code);
      return { error: code, message: error.message };
    }
  }

  async chatStream(apiKey, body, telemetry, onEvent, options = {}) {
    if (!apiKey) return { error: 'no_api_key', message: `${this.providerLabel} API key 未配置` };
    const startedAt = Date.now();
    let requestBody;
    try {
      requestBody = JSON.stringify(openAIToResponsesRequest(body));
    } catch (error) {
      usageArgs(telemetry, body, startedAt, null, 'serialize_error');
      return { error: 'serialize_error', message: error.message };
    }
    const t = telemetry || {};
    try {
      const response = await fetch(`${baseUrlOf(options)}/responses`, {
        method: 'POST',
        signal: options.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          authorization: `Bearer ${apiKey}`,
        },
        body: requestBody,
      });
      if (!response.ok || !response.body) {
        const text = response.body ? await response.text() : '';
        let message = `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(text);
          message = (parsed.error && parsed.error.message) || message;
        } catch { /* 保留状态文案 */ }
        usageArgs(t, body, startedAt, null, 'http_error');
        return {
          error: 'http_error',
          message,
          status: response.status,
          retryable: response.status >= 500 && response.status !== 401 && response.status !== 403,
        };
      }
      const aggregator = new ResponsesStreamAggregator(body && body.model);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      const consumeFrames = (frameText, isFinal) => {
        for (const frame of parseSseFrames(frameText)) {
          if (frame.event === 'response.completed' || frame.event === 'response.incomplete' || frame.event === 'response.failed') {
            finished = true;
          }
          aggregator.observe(frame, onEvent);
        }
        return isFinal;
      };
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separatorIndex;
        while ((separatorIndex = buffer.indexOf('\n\n')) >= 0) {
          const frameText = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          consumeFrames(frameText, false);
        }
      }
      // 收尾：终帧可能无尾部 \n\n（本仓实测过 completed 滞留 buffer 的形态），flush 处理。
      if (buffer.trim() && !finished) consumeFrames(buffer, true);
      const envelope = aggregator.resolve(onEvent);
      usageArgs(t, body, startedAt, envelope.usage, envelope.error ? 'api_error' : null);
      return envelope;
    } catch (error) {
      const code = error && error.name === 'AbortError' ? 'aborted' : 'network_error';
      usageArgs(t, body, startedAt, null, code);
      return { error: code, message: error.message };
    }
  }

  async healthCheck(apiKey, options = {}) {
    try {
      const response = await fetch(`${baseUrlOf(options)}/responses`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'deepseek-flash', input: 'ping', max_output_tokens: 16 }),
      });
      return response.ok || response.status === 400;
    } catch {
      return false;
    }
  }
}

module.exports = {
  ResponsesProvider,
  openAIToResponsesRequest,
  responsesToOpenAIResponse,
  ResponsesStreamAggregator,
  parseSseFrames,
};
