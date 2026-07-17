import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DeepSeekProvider, OpenAICompatibleProvider } = require('../core/shared-backend/llm-providers/deepseek.js');
const aiUsageHelper = require('../core/shared-backend/ai-usage-helper.js');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function writeSse(res, payload) {
  res.write(`data: ${payload}\n\n`);
}

test('chatStream emits content before response completion and records usage once', async () => {
  let receivedBody;
  const usageRecords = [];
  aiUsageHelper.configure({ recordAiUsage: (record) => usageRecords.push(record) });
  const { server, baseUrl } = await startServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      receivedBody = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"你"}}]}\n');
      setTimeout(() => {
        res.write('\ndata: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n');
        writeSse(res, '[DONE]');
        res.end();
      }, 30);
    });
  });

  try {
    const events = [];
    let resolved = false;
    let resolvedAtFirstDelta;
    let notifyFirstDelta;
    const firstDelta = new Promise((resolve) => (notifyFirstDelta = resolve));
    const resultPromise = new DeepSeekProvider()
      .chatStream(
        'key',
        { model: 'deepseek-chat', messages: [] },
        {},
        (event) => {
          events.push(event);
          if (event.type === 'content_delta' && resolvedAtFirstDelta === undefined) {
            resolvedAtFirstDelta = resolved;
            notifyFirstDelta();
          }
        },
        { baseUrl }
      )
      .then((result) => {
        resolved = true;
        return result;
      });
    await firstDelta;
    assert.equal(resolvedAtFirstDelta, false);
    assert.deepEqual(events[0], { type: 'content_delta', content: '你' });

    const result = await resultPromise;
    assert.equal(result.choices[0].message.content, '你好');
    assert.equal(receivedBody.stream, true);
    assert.equal(receivedBody.stream_options.include_usage, true);
    assert.equal(usageRecords.length, 1);
    assert.equal(usageRecords[0].promptTokens, 3);
    assert.equal(usageRecords[0].completionTokens, 2);
  } finally {
    await closeServer(server);
  }
});

test('chatStream reassembles split tool calls and handles glued SSE frames', async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"query","arguments":"{\\"kind\\":"}}]}}]}\n\n' +
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"projects\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n' +
          'data: [DONE]\n\n'
      );
    });
  });

  try {
    const result = await new DeepSeekProvider().chatStream(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      () => {},
      { baseUrl }
    );
    const call = result.choices[0].message.tool_calls[0];
    assert.equal(call.id, 'call_1');
    assert.equal(call.function.name, 'query');
    assert.deepEqual(JSON.parse(call.function.arguments), { kind: 'projects' });
  } finally {
    await closeServer(server);
  }
});

test('chatStream reports HTTP errors and cancellation', async () => {
  const errorServer = await startServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'bad key' } }));
  });
  try {
    const result = await new DeepSeekProvider().chatStream(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      () => {},
      { baseUrl: errorServer.baseUrl }
    );
    assert.equal(result.error, 'http_error');
    assert.equal(result.message, 'bad key');
  } finally {
    await closeServer(errorServer.server);
  }

  const slowServer = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"start"}}]}\n\n');
    });
  });
  try {
    const controller = new AbortController();
    const promise = new DeepSeekProvider().chatStream(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      () => controller.abort(),
      { baseUrl: slowServer.baseUrl, signal: controller.signal }
    );
    const result = await promise;
    assert.equal(result.error, 'aborted');
  } finally {
    await closeServer(slowServer.server);
  }
});

test('chat remains available as non-streaming fallback with custom base URL', async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'fallback' } }], usage: {} }));
    });
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'custom-model', messages: [] },
      {},
      { baseUrl }
    );
    assert.equal(result.choices[0].message.content, 'fallback');
  } finally {
    await closeServer(server);
  }
});

test('OpenAI-compatible local provider supports no-key chat and /v1 path prefixes', async () => {
  let requestPath;
  let authorization;
  const { server, baseUrl } = await startServer((req, res) => {
    requestPath = req.url;
    authorization = req.headers.authorization;
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'local' } }], usage: {} }));
    });
  });
  try {
    const provider = new OpenAICompatibleProvider({
      name: 'local-test',
      defaultBaseUrl: `${baseUrl}/v1`,
      requiresApiKey: false,
    });
    const result = await provider.chat('', { model: 'local-model', messages: [] }, {});
    assert.equal(result.choices[0].message.content, 'local');
    assert.equal(requestPath, '/v1/chat/completions');
    assert.equal(authorization, undefined);
  } finally {
    await closeServer(server);
  }
});

test('OpenAI-compatible provider normalizes embedding vectors', async () => {
  let requestBody;
  const { server, baseUrl } = await startServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requestBody = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
        usage: { prompt_tokens: 2 },
      }));
    });
  });
  try {
    const provider = new OpenAICompatibleProvider({ name: 'embed-test', requiresApiKey: false });
    const vectors = await provider.embed('', ['a', 'b'], {}, { baseUrl: `${baseUrl}/v1`, model: 'embed' });
    assert.deepEqual(Array.from(vectors[0]), [1, 0]);
    assert.deepEqual(Array.from(vectors[1]), [0, 1]);
    assert.deepEqual(requestBody, { model: 'embed', input: ['a', 'b'] });
  } finally {
    await closeServer(server);
  }
});

test('chat classifies HTTP 401 JSON error body with normalized message and status', async () => {
  const { server, baseUrl } = await startServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'bad key' } }));
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl }
    );
    assert.equal(result.error, 'http_error');
    assert.equal(result.message, 'bad key');
    assert.equal(result.status, 401);
  } finally {
    await closeServer(server);
  }
});

test('chat preserves a top-level error field on a 200 body instead of treating it as success', async () => {
  const usageRecords = [];
  aiUsageHelper.configure({ recordAiUsage: (record) => usageRecords.push(record) });
  const { server, baseUrl } = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'rate limited' }, choices: [] }));
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl }
    );
    assert.ok(result.error, 'top-level error field must be retained');
    assert.equal(result.error.message, 'rate limited');
    assert.equal(usageRecords.at(-1).errorCode, 'api_error');
  } finally {
    await closeServer(server);
  }
});

test('chat classifies a non-JSON body with a >=400 status as http_error carrying the status', async () => {
  const { server, baseUrl } = await startServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal boom');
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl }
    );
    assert.equal(result.error, 'http_error');
    assert.equal(result.status, 500);
    assert.equal(result.message, 'internal boom');
  } finally {
    await closeServer(server);
  }
});

test('chat classifies a non-JSON body with a 200 status as parse_error', async () => {
  const { server, baseUrl } = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('not json');
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl }
    );
    assert.equal(result.error, 'parse_error');
    assert.equal(result.status, 200);
  } finally {
    await closeServer(server);
  }
});

test('chat returns no_api_key without issuing a request when a key is required but missing', async () => {
  let requestReceived = false;
  const { server, baseUrl } = await startServer((_req, res) => {
    requestReceived = true;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [] }));
  });
  try {
    const result = await new DeepSeekProvider().chat(
      '',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl }
    );
    assert.equal(result.error, 'no_api_key');
    assert.equal(requestReceived, false);
  } finally {
    await closeServer(server);
  }
});
