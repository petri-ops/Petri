/**
 * OpenAI-compatible provider transport, with DeepSeek-compatible defaults.
 */

const http = require('http');
const https = require('https');
const aiUsageHelper = require('../ai-usage-helper');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const CHAT_PATH = '/chat/completions';

function getRecordAiUsage() {
  return aiUsageHelper.recordAiUsage;
}

function resolveEndpoint(baseUrl, pathname, defaultBaseUrl = DEFAULT_BASE_URL) {
  const url = new URL(baseUrl || defaultBaseUrl);
  const prefix = url.pathname.replace(/\/$/, '');
  url.pathname = `${prefix}${pathname}`;
  return url;
}

function buildRequestOptions(endpoint, apiKey, data, accept) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: accept,
    'Content-Length': Buffer.byteLength(data),
  };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  return {
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port || undefined,
    path: endpoint.pathname + endpoint.search,
    method: 'POST',
    headers,
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
  constructor(options = {}) {
    this.providerName = options.name || 'deepseek';
    this.defaultBaseUrl = options.defaultBaseUrl || DEFAULT_BASE_URL;
    this.requiresApiKey = options.requiresApiKey !== false;
    this.providerLabel = options.label || this.providerName;
  }

  get name() {
    return this.providerName;
  }

  get capabilities() {
    return 'chat';
  }

  get supportsStreaming() {
    return true;
  }

  async listModels(apiKey, options) {
    if (this.requiresApiKey && !apiKey) {
      return { ok: false, models: [], message: `${this.providerLabel} API key 未配置` };
    }

    return new Promise((resolve) => {
      const endpoint = resolveEndpoint(options && options.baseUrl, '/models', this.defaultBaseUrl);
      const headers = { Accept: 'application/json' };
      if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
      let settled = false;
      let buffer = '';
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const req = requestModule(endpoint).request(
        {
          protocol: endpoint.protocol,
          hostname: endpoint.hostname,
          port: endpoint.port || undefined,
          path: endpoint.pathname + endpoint.search,
          method: 'GET',
          headers,
          agent: false,
          timeout: 10000,
        },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            buffer += chunk;
            if (buffer.length > 2 * 1024 * 1024) {
              req.destroy();
              finish({ ok: false, models: [], message: '模型列表响应过大' });
            }
          });
          res.on('end', () => {
            if (settled) return;
            let parsed;
            try {
              parsed = buffer ? JSON.parse(buffer) : {};
            } catch {
              finish({ ok: false, models: [], message: `模型列表响应不是有效 JSON（HTTP ${res.statusCode || 0}）` });
              return;
            }
            if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
              const remoteMessage = parsed && parsed.error && parsed.error.message;
              finish({
                ok: false,
                models: [],
                message: remoteMessage || `获取模型列表失败（HTTP ${res.statusCode || 0}）`,
              });
              return;
            }
            const rows = Array.isArray(parsed.data)
              ? parsed.data
              : Array.isArray(parsed.models)
                ? parsed.models
                : [];
            const models = [...new Set(rows
              .map((row) => typeof row === 'string' ? row : row && (row.id || row.name || row.model))
              .map((value) => String(value || '').trim())
              .filter(Boolean))]
              .sort((a, b) => a.localeCompare(b));
            finish(models.length > 0
              ? { ok: true, models, message: `已获取 ${models.length} 个模型` }
              : { ok: false, models: [], message: '接口未返回可用模型' });
          });
          res.on('error', (error) => {
            finish({ ok: false, models: [], message: error.message || '读取模型列表失败' });
          });
        }
      );
      req.on('error', (error) => {
        finish({ ok: false, models: [], message: error.message || '模型列表请求失败' });
      });
      req.on('timeout', () => {
        req.destroy();
        finish({ ok: false, models: [], message: '获取模型列表超时' });
      });
      req.end();
    });
  }

  async chat(apiKey, body, telemetry, options) {
    if (this.requiresApiKey && !apiKey) {
      return { error: 'no_api_key', message: `${this.providerLabel} API key 未配置` };
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
      const endpoint = resolveEndpoint(options && options.baseUrl, CHAT_PATH, this.defaultBaseUrl);
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
              if (res.statusCode < 200 || res.statusCode >= 300) {
                const message = (parsed.error && parsed.error.message) || `HTTP ${res.statusCode}`;
                finish({ error: 'http_error', message, status: res.statusCode }, 'http_error');
                return;
              }
              finish(parsed, parsed && parsed.error ? 'api_error' : null, parsed && parsed.usage);
            } catch (error) {
              const status = Number(res.statusCode);
              finish({
                error: status >= 400 ? 'http_error' : 'parse_error',
                message: status >= 400 ? (buffer || `HTTP ${status}`) : error.message,
                ...(Number.isFinite(status) ? { status } : {}),
              }, status >= 400 ? 'http_error' : 'parse_error');
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
    if (this.requiresApiKey && !apiKey) {
      return { error: 'no_api_key', message: `${this.providerLabel} API key 未配置` };
    }

    const t = telemetry || {};
    const startedAt = Date.now();
    const recordAiUsage = getRecordAiUsage();
    const profileProvider = options && options.profile && options.profile.provider;
    const streamBody = {
      ...(body || {}),
      stream: true,
      // `stream_options` is a DeepSeek/OpenAI extension and is rejected by
      // several otherwise-compatible gateways. Keep usage streaming for the
      // native DeepSeek path, but use the portable OpenAI-compatible shape for
      // custom channels, Ollama, LM Studio, and vLLM.
      ...(!profileProvider || profileProvider === 'deepseek'
        ? { stream_options: { include_usage: true } }
        : {}),
    };
    let data;
    try {
      data = JSON.stringify(streamBody);
    } catch (error) {
      recordAiUsage(usageArgs(t, body, startedAt, null, 'serialize_error'));
      return { error: 'serialize_error', message: error.message };
    }

    return new Promise((resolve) => {
      const endpoint = resolveEndpoint(options && options.baseUrl, CHAT_PATH, this.defaultBaseUrl);
      const contentParts = [];
      const toolCalls = [];
      let usage = null;
      let finishReason = null;
      let sseBuffer = '';
      let errorBuffer = '';
      let sawChoice = false;
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
      const fail = (code, message, details) => {
        const result = { error: code, message, ...(details || {}) };
        emit({ type: 'error', error: code, message });
        finish(result, code);
      };
      const complete = () => {
        if (!sawChoice) {
          fail('parse_error', '模型响应未包含可识别的 choices');
          return;
        }
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
        sawChoice = true;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        // Some OpenAI-compatible gateways advertise streaming but return a
        // regular chat-completions JSON envelope. Accept that shape instead
        // of silently completing with an empty assistant message.
        if (choice.message && typeof choice.message === 'object') {
          const message = choice.message;
          if (typeof message.content === 'string' && message.content) {
            contentParts.push(message.content);
            emit({ type: 'content_delta', content: message.content });
          }
          if (Array.isArray(message.tool_calls)) {
            for (let index = 0; index < message.tool_calls.length; index += 1) {
              const toolCall = { ...message.tool_calls[index], index };
              appendToolCall(toolCalls, toolCall);
              emit({ type: 'tool_call_delta', delta: toolCall });
            }
          }
          complete();
          return;
        }
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
              fail('http_error', message, { status: res.statusCode });
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
    if (this.requiresApiKey && !apiKey) return false;
    return new Promise((resolve) => {
      const endpoint = resolveEndpoint(options && options.baseUrl, '/models', this.defaultBaseUrl);
      const headers = {};
      if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
      const req = requestModule(endpoint).request(
        {
          protocol: endpoint.protocol,
          hostname: endpoint.hostname,
          port: endpoint.port || undefined,
          path: endpoint.pathname + endpoint.search,
          method: 'GET',
          headers,
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

  async embed(apiKey, texts, telemetry, options) {
    if (this.requiresApiKey && !apiKey) return null;
    if (!Array.isArray(texts) || texts.length === 0) return [];
    const body = {
      ...((options && options.parameters) || {}),
      model: (options && options.model) || '',
      input: texts,
    };
    const data = JSON.stringify(body);
    const endpoint = resolveEndpoint(options && options.baseUrl, '/embeddings', this.defaultBaseUrl);
    const startedAt = Date.now();
    const recordAiUsage = getRecordAiUsage();
    return new Promise((resolve) => {
      let buffer = '';
      const req = requestModule(endpoint).request(
        buildRequestOptions(endpoint, apiKey, data, 'application/json'),
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk) => (buffer += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(buffer);
              if (res.statusCode < 200 || res.statusCode >= 300 || !Array.isArray(parsed.data)) {
                resolve(null);
                return;
              }
              const rows = [...parsed.data].sort((a, b) => (a.index || 0) - (b.index || 0));
              const vectors = rows.map((row) => Float32Array.from(row.embedding || []));
              const usage = parsed.usage || {};
              recordAiUsage({
                userId: telemetry && telemetry.userId,
                kind: (telemetry && telemetry.kind) || 'embedding',
                model: body.model,
                promptTokens: usage.prompt_tokens || usage.total_tokens || 0,
                latencyMs: Date.now() - startedAt,
                conversationId: telemetry && telemetry.conversationId,
              });
              resolve(vectors);
            } catch {
              resolve(null);
            }
          });
          res.on('error', () => resolve(null));
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(data);
      req.end();
    });
  }
}

module.exports = { DeepSeekProvider, OpenAICompatibleProvider: DeepSeekProvider };
