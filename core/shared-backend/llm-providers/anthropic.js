/** Anthropic Messages API adapter with OpenAI-compatible Gateway I/O. */

const aiUsageHelper = require('../ai-usage-helper');
const {
  openAIToAnthropicRequest,
  anthropicToOpenAIResponse,
} = require('./protocol-conversion');
const { AnthropicStreamAggregator, extractSseFrames } = require('./stream-aggregate');

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_VERSION = '2023-06-01';
const MODEL_LIST_TIMEOUT_MS = 10000;
const MAX_MODEL_LIST_BYTES = 2 * 1024 * 1024;

function endpointUrl(baseUrl, pathname) {
  const url = new URL(baseUrl || DEFAULT_BASE_URL);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${pathname}`;
  return url.toString();
}

function requestHeaders(apiKey, options = {}) {
  return {
    'content-type': 'application/json',
    accept: options.accept || 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': options.anthropicVersion || DEFAULT_VERSION,
  };
}

async function readBoundedResponseText(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_MODEL_LIST_BYTES) {
    if (response.body && typeof response.body.cancel === 'function') {
      try { await response.body.cancel(); } catch {}
    }
    throw new Error('模型列表响应过大');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_MODEL_LIST_BYTES) throw new Error('模型列表响应过大');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MODEL_LIST_BYTES) {
      try { await reader.cancel(); } catch {}
      throw new Error('模型列表响应过大');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// BLOCK-95 B3 — cache 字段提取（兼容原始/归一 usage 形状）
const { extractCacheFields: cacheFieldsOf } = require('./protocol-usage');

function usageRecord(telemetry, model, startedAt, usage, errorCode) {
  return {
    userId: telemetry && telemetry.userId,
    kind: (telemetry && telemetry.kind) || 'agent_iter',
    model,
    // BLOCK-79 P1 — 供应商归因（网关注入）
    provider: (telemetry && telemetry.provider) || null,
    promptTokens: (usage && (usage.prompt_tokens || usage.input_tokens)) || 0,
    completionTokens: (usage && (usage.completion_tokens || usage.output_tokens)) || 0,
    // BLOCK-95 B3 — prompt cache 字段落库（原恒 0 断链）
    ...(usage ? cacheFieldsOf(usage) : { cacheReadTokens: 0, cacheCreationTokens: 0 }),
    latencyMs: Date.now() - startedAt,
    errorCode: errorCode || null,
    conversationId: telemetry && telemetry.conversationId,
  };
}

function emitSafely(onEvent, event) {
  try {
    if (typeof onEvent === 'function') onEvent(event);
  } catch {}
}

class AnthropicProvider {
  get name() {
    return 'anthropic';
  }

  get capabilities() {
    return 'chat';
  }

  get supportsStreaming() {
    return true;
  }

  async listModels(apiKey, options = {}) {
    if (!apiKey) return { ok: false, models: [], message: 'Anthropic API key 未配置' };
    const controller = new AbortController();
    const onAbort = () => controller.abort(options.signal && options.signal.reason);
    if (options.signal && options.signal.aborted) onAbort();
    else if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
    try {
      const response = await fetch(endpointUrl(options.baseUrl, '/models'), {
        headers: requestHeaders(apiKey, options),
        signal: controller.signal,
      });
      const raw = await readBoundedResponseText(response);
      let parsed = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        return { ok: false, models: [], message: 'Anthropic 模型列表返回了无效 JSON' };
      }
      if (!response.ok || parsed?.type === 'error') {
        return {
          ok: false,
          models: [],
          message: parsed?.error?.message || `HTTP ${response.status}`,
        };
      }
      const models = Array.isArray(parsed?.data)
        ? [...new Set(parsed.data.map((item) => String(item?.id || '').trim()).filter(Boolean))]
        : [];
      return {
        ok: models.length > 0,
        models,
        message: models.length > 0 ? `已获取 ${models.length} 个模型` : '接口未返回可用模型',
      };
    } catch (error) {
      return {
        ok: false,
        models: [],
        message: error && error.name === 'AbortError'
          ? (options.signal && options.signal.aborted ? 'Anthropic 模型列表请求已取消' : 'Anthropic 模型列表请求超时')
          : error && error.message ? error.message : 'Anthropic 模型列表请求失败',
      };
    } finally {
      clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
    }
  }

  async chat(apiKey, body, telemetry, options = {}) {
    if (!apiKey) return { error: 'no_api_key', message: 'Anthropic API key 未配置' };
    const startedAt = Date.now();
    const requestBody = openAIToAnthropicRequest({ ...(body || {}), stream: false });
    try {
      const response = await fetch(endpointUrl(options.baseUrl, '/messages'), {
        method: 'POST',
        headers: requestHeaders(apiKey, options),
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });
      const parsed = await response.json();
      if (!response.ok || parsed.type === 'error') {
        const message = (parsed.error && parsed.error.message) || `HTTP ${response.status}`;
        aiUsageHelper.recordAiUsage(usageRecord(telemetry, body.model, startedAt, null, 'api_error'));
        return { error: 'api_error', message, status: response.status };
      }
      const result = anthropicToOpenAIResponse(parsed, body.model);
      aiUsageHelper.recordAiUsage(usageRecord(telemetry, body.model, startedAt, result.usage));
      return result;
    } catch (error) {
      const code = error && error.name === 'AbortError' ? 'aborted' : 'network_error';
      aiUsageHelper.recordAiUsage(usageRecord(telemetry, body && body.model, startedAt, null, code));
      return { error: code, message: error.message };
    }
  }

  async chatStream(apiKey, body, telemetry, onEvent, options = {}) {
    if (!apiKey) return { error: 'no_api_key', message: 'Anthropic API key 未配置' };
    const startedAt = Date.now();
    const requestBody = openAIToAnthropicRequest({ ...(body || {}), stream: true });
    try {
      const response = await fetch(endpointUrl(options.baseUrl, '/messages'), {
        method: 'POST',
        headers: requestHeaders(apiKey, { ...options, accept: 'text/event-stream' }),
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });
      if (!response.ok) {
        const raw = await response.text();
        let message = raw || `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(raw);
          message = (parsed.error && parsed.error.message) || message;
        } catch {}
        emitSafely(onEvent, { type: 'error', error: 'http_error', message });
        aiUsageHelper.recordAiUsage(usageRecord(telemetry, body.model, startedAt, null, 'http_error'));
        return { error: 'http_error', message, status: response.status };
      }

      const aggregator = new AnthropicStreamAggregator();
      const eventState = { buffer: '' };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        aggregator.feed(chunk);
        for (const frame of extractSseFrames(eventState, chunk)) {
          if (!frame.json) continue;
          const event = frame.json;
          if (event.type === 'error') {
            const message = (event.error && event.error.message) || 'Anthropic stream error';
            emitSafely(onEvent, { type: 'error', error: 'api_error', message });
            return { error: 'api_error', message };
          }
          if (event.type === 'content_block_start' && event.content_block && event.content_block.type === 'tool_use') {
            emitSafely(onEvent, {
              type: 'tool_call_delta',
              delta: {
                index: event.index,
                id: event.content_block.id,
                type: 'function',
                function: { name: event.content_block.name, arguments: '' },
              },
            });
          }
          if (event.type === 'content_block_delta' && event.delta) {
            if (event.delta.type === 'text_delta' && event.delta.text) {
              emitSafely(onEvent, { type: 'content_delta', content: event.delta.text });
            }
            if (event.delta.type === 'input_json_delta') {
              emitSafely(onEvent, {
                type: 'tool_call_delta',
                delta: { index: event.index, function: { arguments: event.delta.partial_json || '' } },
              });
            }
          }
          if ((event.type === 'message_start' && event.message && event.message.usage) ||
              (event.type === 'message_delta' && event.usage)) {
            emitSafely(onEvent, { type: 'usage', usage: (event.message && event.message.usage) || event.usage });
          }
        }
      }
      const tail = decoder.decode();
      if (tail) aggregator.feed(tail);
      const result = anthropicToOpenAIResponse(aggregator.getResult(), body.model);
      emitSafely(onEvent, { type: 'done', usage: result.usage });
      aiUsageHelper.recordAiUsage(usageRecord(telemetry, body.model, startedAt, result.usage));
      return result;
    } catch (error) {
      const code = error && error.name === 'AbortError' ? 'aborted' : 'network_error';
      emitSafely(onEvent, { type: 'error', error: code, message: error.message });
      aiUsageHelper.recordAiUsage(usageRecord(telemetry, body && body.model, startedAt, null, code));
      return { error: code, message: error.message };
    }
  }

  async healthCheck(apiKey, options = {}) {
    if (!apiKey) return false;
    try {
      const response = await fetch(endpointUrl(options.baseUrl, '/models'), {
        headers: requestHeaders(apiKey, options),
        signal: options.signal,
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

module.exports = { AnthropicProvider, DEFAULT_BASE_URL, DEFAULT_VERSION };
