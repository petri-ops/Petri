/** Anthropic Messages API adapter with OpenAI-compatible Gateway I/O. */

const aiUsageHelper = require('../ai-usage-helper');
const {
  openAIToAnthropicRequest,
  anthropicToOpenAIResponse,
} = require('./protocol-conversion');
const { AnthropicStreamAggregator, extractSseFrames } = require('./stream-aggregate');

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_VERSION = '2023-06-01';

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

function usageRecord(telemetry, model, startedAt, usage, errorCode) {
  return {
    userId: telemetry && telemetry.userId,
    kind: (telemetry && telemetry.kind) || 'agent_iter',
    model,
    promptTokens: (usage && (usage.prompt_tokens || usage.input_tokens)) || 0,
    completionTokens: (usage && (usage.completion_tokens || usage.output_tokens)) || 0,
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
