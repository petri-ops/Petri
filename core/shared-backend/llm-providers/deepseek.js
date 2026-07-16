/**
 * DeepSeek Provider — OpenAI-compatible chat completion provider.
 */

const http = require('http');
const https = require('https');
const aiUsageHelper = require('../ai-usage-helper');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const CHAT_PATH = '/chat/completions';

function getRecordAiUsage() {
  return aiUsageHelper.recordAiUsage;
}

function resolveEndpoint(baseUrl, pathname) {
  const url = new URL(baseUrl || DEFAULT_BASE_URL);
  const prefix = url.pathname.replace(/\/$/, '');
  url.pathname = `${prefix}${pathname}`;
  return url;
}

function buildRequestOptions(endpoint, apiKey, data, accept) {
  return {
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port || undefined,
    path: endpoint.pathname + endpoint.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: accept,
      Authorization: 'Bearer ' + apiKey,
      'Content-Length': Buffer.byteLength(data),
    },
    agent: false,
    timeout: 90000,
  };
}

function requestModule(endpoint) {
  return endpoint.protocol === 'http:' ? http : https;
}

function usageArgs(telemetry, body, startedAt, usage, errorCode) {
  const u = usage || {};
  return {
    userId: telemetry.userId,
    kind: telemetry.kind || 'agent_iter',
    model: (body && body.model) || 'deepseek-chat',
    promptTokens: u.prompt_tokens || 0,
    completionTokens: u.completion_tokens || 0,
    latencyMs: Date.now() - startedAt,
    errorCode: errorCode || null,
    conversationId: telemetry.conversationId,
  };
}

function appendToolCall(target, delta) {
  const index = Number.isInteger(delta.index) ? delta.index : 0;
  if (!target[index]) {
    target[index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
  }
  const current = target[index];
  if (delta.id) current.id += delta.id;
  if (delta.type) current.type = delta.type;
  if (delta.function) {
    if (delta.function.name) current.function.name += delta.function.name;
    if (delta.function.arguments) current.function.arguments += delta.function.arguments;
  }
}

class DeepSeekProvider {
  get name() {
    return 'deepseek';
  }

  get capabilities() {
    return 'chat';
  }

  get supportsStreaming() {
    return true;
  }

  async chat(apiKey, body, telemetry, options) {
    if (!apiKey) {
      return { error: 'no_api_key', message: 'DeepSeek API key 未配置' };
    }

    const t = telemetry || {};
    const startedAt = Date.now();
    const recordAiUsage = getRecordAiUsage();
    let data;
    try {
      data = JSON.stringify(body);
      if (typeof data !== 'string') throw new Error('request body is not serializable');
    } catch (error) {
      recordAiUsage(usageArgs(t, body, startedAt, null, 'serialize_error'));
      return { error: 'serialize_error', message: error.message };
    }

    return new Promise((resolve) => {
      const endpoint = resolveEndpoint(options && options.baseUrl, CHAT_PATH);
      let settled = false;
      let buffer = '';
      const finish = (result, errorCode, usage) => {
        if (settled) return;
        settled = true;
        recordAiUsage(usageArgs(t, body, startedAt, usage, errorCode));
        resolve(result);
      };
      const req = requestModule(endpoint).request(
        buildRequestOptions(endpoint, apiKey, data, 'application/json'),
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk) => (buffer += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(buffer);
              finish(parsed, parsed && parsed.error ? 'api_error' : null, parsed && parsed.usage);
            } catch (error) {
              finish({ error: 'parse_error', message: error.message }, 'parse_error');
            }
          });
          res.on('error', (error) =>
            finish({ error: 'res_error', message: error.message }, 'res_error')
          );
        }
      );
      req.on('error', (error) =>
        finish({ error: 'req_error', message: error.message }, 'req_error')
      );
      req.on('timeout', () => {
        req.destroy();
        finish({ error: 'timeout', message: '请求超时' }, 'timeout');
      });
      req.write(data);
      req.end();
    });
  }

  /**
   * Streams normalized events and resolves to an OpenAI-compatible aggregate response.
   * onEvent receives content_delta, tool_call_delta, usage, done, or error.
   */
  async chatStream(apiKey, body, telemetry, onEvent, options) {
    if (!apiKey) {
      return { error: 'no_api_key', message: 'DeepSeek API key 未配置' };
    }

    const t = telemetry || {};
    const startedAt = Date.now();
    const recordAiUsage = getRecordAiUsage();
    const streamBody = { ...(body || {}), stream: true, stream_options: { include_usage: true } };
    let data;
    try {
      data = JSON.stringify(streamBody);
    } catch (error) {
      recordAiUsage(usageArgs(t, body, startedAt, null, 'serialize_error'));
      return { error: 'serialize_error', message: error.message };
    }

    return new Promise((resolve) => {
      const endpoint = resolveEndpoint(options && options.baseUrl, CHAT_PATH);
      const contentParts = [];
      const toolCalls = [];
      let usage = null;
      let finishReason = null;
      let sseBuffer = '';
      let errorBuffer = '';
      let settled = false;
      let req; // eslint-disable-line prefer-const

      const emit = (event) => {
        try {
          if (typeof onEvent === 'function') onEvent(event);
        } catch {}
      };
      const finish = (result, errorCode) => {
        if (settled) return;
        settled = true;
        if (options && options.signal) options.signal.removeEventListener('abort', abortRequest);
        recordAiUsage(usageArgs(t, body, startedAt, usage, errorCode));
        resolve(result);
      };
      const fail = (code, message) => {
        const result = { error: code, message };
        emit({ type: 'error', error: code, message });
        finish(result, code);
      };
      const complete = () => {
        emit({ type: 'done', usage });
        finish({
          choices: [
            {
              finish_reason: finishReason,
              message: {
                role: 'assistant',
                content: contentParts.join(''),
                ...(toolCalls.length ? { tool_calls: toolCalls.filter(Boolean) } : {}),
              },
            },
          ],
          usage: usage || undefined,
        });
      };
      const processPayload = (payload) => {
        if (payload === '[DONE]') {
          complete();
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch (error) {
          fail('parse_error', `无效的 SSE 数据: ${error.message}`);
          req.destroy();
          return;
        }
        if (parsed.error) {
          fail('api_error', parsed.error.message || String(parsed.error));
          req.destroy();
          return;
        }
        if (parsed.usage) {
          usage = parsed.usage;
          emit({ type: 'usage', usage });
        }
        const choice = parsed.choices && parsed.choices[0];
        if (!choice) return;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content) {
          contentParts.push(delta.content);
          emit({ type: 'content_delta', content: delta.content });
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const toolDelta of delta.tool_calls) {
            appendToolCall(toolCalls, toolDelta);
            emit({ type: 'tool_call_delta', delta: toolDelta });
          }
        }
      };
      const processFrames = () => {
        sseBuffer = sseBuffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = sseBuffer.indexOf('\n\n')) !== -1 && !settled) {
          const frame = sseBuffer.slice(0, boundary);
          sseBuffer = sseBuffer.slice(boundary + 2);
          const payload = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (payload) processPayload(payload);
        }
      };
      const abortRequest = () => {
        if (settled) return;
        req.destroy();
        fail('aborted', '请求已取消');
      };

      req = requestModule(endpoint).request(
        buildRequestOptions(endpoint, apiKey, data, 'text/event-stream'),
        (res) => {
          res.setEncoding('utf8');
          const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
          res.on('data', (chunk) => {
            if (isSuccess) {
              sseBuffer += chunk;
              processFrames();
            } else {
              errorBuffer += chunk;
            }
          });
          res.on('end', () => {
            if (settled) return;
            if (!isSuccess) {
              let message = errorBuffer || `HTTP ${res.statusCode}`;
              try {
                const parsed = JSON.parse(errorBuffer);
                message = (parsed.error && parsed.error.message) || message;
              } catch {}
              fail('http_error', message);
              return;
            }
            processFrames();
            if (!settled && sseBuffer.trim()) {
              const payload = sseBuffer.replace(/^data:\s*/, '').trim();
              if (payload) processPayload(payload);
            }
            if (!settled) complete();
          });
          res.on('error', (error) => fail('res_error', error.message));
        }
      );
      req.on('error', (error) => {
        if (!settled) fail('req_error', error.message);
      });
      req.on('timeout', () => {
        req.destroy();
        fail('timeout', '请求超时');
      });
      if (options && options.signal) {
        if (options.signal.aborted) return abortRequest();
        options.signal.addEventListener('abort', abortRequest, { once: true });
      }
      req.write(data);
      req.end();
    });
  }

  async healthCheck(apiKey, options) {
    if (!apiKey) return false;
    return new Promise((resolve) => {
      const endpoint = resolveEndpoint(options && options.baseUrl, '/models');
      const req = requestModule(endpoint).request(
        {
          protocol: endpoint.protocol,
          hostname: endpoint.hostname,
          port: endpoint.port || undefined,
          path: endpoint.pathname + endpoint.search,
          method: 'GET',
          headers: { Authorization: 'Bearer ' + apiKey },
          agent: false,
          timeout: 10000,
        },
        (res) => resolve(res.statusCode === 200)
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }
}

module.exports = { DeepSeekProvider };
