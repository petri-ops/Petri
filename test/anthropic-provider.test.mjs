import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AnthropicProvider } = require('../core/shared-backend/llm-providers/anthropic.js');
const aiUsageHelper = require('../core/shared-backend/ai-usage-helper.js');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('Anthropic provider discovers native models with the expected path and headers', async () => {
  let received;
  const { server, baseUrl } = await startServer((req, res) => {
    received = { path: req.url, headers: req.headers };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: [
        { id: 'claude-sonnet-test', type: 'model' },
        { id: 'claude-opus-test', type: 'model' },
      ],
    }));
  });
  try {
    const result = await new AnthropicProvider().listModels('secret', { baseUrl });
    assert.equal(received.path, '/v1/models');
    assert.equal(received.headers['x-api-key'], 'secret');
    assert.equal(received.headers['anthropic-version'], '2023-06-01');
    assert.deepEqual(result, {
      ok: true,
      models: ['claude-sonnet-test', 'claude-opus-test'],
      message: '已获取 2 个模型',
    });
  } finally {
    await closeServer(server);
  }
});

test('Anthropic model discovery stops reading an oversized chunked response', async () => {
  const { server, baseUrl } = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"data":[{"id":"');
    res.end('x'.repeat(2 * 1024 * 1024 + 1));
  });
  try {
    const result = await new AnthropicProvider().listModels('secret', { baseUrl });
    assert.deepEqual(result, {
      ok: false,
      models: [],
      message: '模型列表响应过大',
    });
  } finally {
    await closeServer(server);
  }
});

test('Anthropic provider converts Gateway chat request and response', async () => {
  let received;
  const { server, baseUrl } = await startServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received = { path: req.url, headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'message-1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 'tool-1', name: 'lookup', input: { id: 1 } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 4, output_tokens: 2 },
      }));
    });
  });
  try {
    const result = await new AnthropicProvider().chat('secret', {
      model: 'claude-test',
      messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }],
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      max_tokens: 100,
    }, {}, { baseUrl });
    assert.equal(received.path, '/v1/messages');
    assert.equal(received.headers['x-api-key'], 'secret');
    assert.equal(received.headers['anthropic-version'], '2023-06-01');
    assert.equal(received.body.system, 'system');
    assert.equal(received.body.tools[0].name, 'lookup');
    assert.equal(result.choices[0].message.tool_calls[0].function.name, 'lookup');
    assert.equal(result.choices[0].finish_reason, 'tool_calls');
  } finally {
    await closeServer(server);
  }
});

test('Anthropic provider streams normalized text and split tool arguments', async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('message_start', {
        type: 'message_start',
        message: { id: 'm', model: 'claude-test', content: [], usage: { input_tokens: 3 } },
      });
      send('content_block_start', {
        type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' },
      });
      send('content_block_delta', {
        type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' },
      });
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('content_block_start', {
        type: 'content_block_start', index: 1,
        content_block: { type: 'tool_use', id: 't', name: 'run', input: {} },
      });
      send('content_block_delta', {
        type: 'content_block_delta', index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"x":' },
      });
      send('content_block_delta', {
        type: 'content_block_delta', index: 1,
        delta: { type: 'input_json_delta', partial_json: '1}' },
      });
      send('content_block_stop', { type: 'content_block_stop', index: 1 });
      send('message_delta', {
        type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 2 },
      });
      send('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  try {
    const events = [];
    const result = await new AnthropicProvider().chatStream(
      'secret',
      { model: 'claude-test', messages: [{ role: 'user', content: 'hello' }] },
      {},
      (event) => events.push(event),
      { baseUrl }
    );
    assert.equal(events.some((event) => event.type === 'content_delta' && event.content === 'hello'), true);
    const argumentDeltas = events
      .filter((event) => event.type === 'tool_call_delta' && event.delta.function)
      .map((event) => event.delta.function.arguments || '')
      .join('');
    assert.equal(argumentDeltas, '{"x":1}');
    assert.equal(result.choices[0].message.content, 'hello');
    assert.deepEqual(JSON.parse(result.choices[0].message.tool_calls[0].function.arguments), { x: 1 });
    assert.equal(result.usage.total_tokens, 5);
  } finally {
    await closeServer(server);
  }
});

test('Anthropic provider returns standardized HTTP and no-key errors', async () => {
  assert.equal((await new AnthropicProvider().chat('', {}, {})).error, 'no_api_key');
  const { server, baseUrl } = await startServer((_req, res) => {
    res.writeHead(529, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }));
  });
  try {
    const result = await new AnthropicProvider().chatStream(
      'secret',
      { model: 'claude-test', messages: [] },
      {},
      () => {},
      { baseUrl }
    );
    assert.equal(result.error, 'http_error');
    assert.equal(result.message, 'busy');
    assert.equal(result.status, 529);
  } finally {
    await closeServer(server);
  }
});

test('Anthropic provider propagates AbortSignal as a standardized cancel', async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"m","model":"claude-test","content":[],"usage":{"input_tokens":1}}}\n\n');
      // 保持连接打开，等待客户端 abort
    });
  });
  try {
    const controller = new AbortController();
    const result = await new AnthropicProvider().chatStream(
      'secret',
      { model: 'claude-test', messages: [{ role: 'user', content: 'hi' }] },
      {},
      (event) => { if (event.type === 'usage') controller.abort(); },
      { baseUrl, signal: controller.signal }
    );
    assert.equal(result.error, 'aborted');
  } finally {
    await closeServer(server);
  }
});

test('Anthropic non-streaming chat records usage tokens and a finite latency once', async () => {
  const usageRecords = [];
  aiUsageHelper.configure({ recordAiUsage: (record) => usageRecords.push(record) });
  const { server, baseUrl } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'message-usage',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 7, output_tokens: 3 },
      }));
    });
  });
  try {
    const result = await new AnthropicProvider().chat(
      'secret',
      { model: 'claude-test', messages: [{ role: 'user', content: 'hi' }] },
      { userId: 'u-1', kind: 'agent_iter' },
      { baseUrl }
    );
    assert.equal(result.choices[0].message.content, 'done');
    assert.equal(usageRecords.length, 1);
    const record = usageRecords[0];
    assert.equal(record.promptTokens, 7);
    assert.equal(record.completionTokens, 3);
    assert.equal(record.model, 'claude-test');
    assert.equal(record.errorCode, null);
    assert.equal(Number.isFinite(record.latencyMs), true);
    assert.equal(record.latencyMs >= 0, true);
  } finally {
    aiUsageHelper.configure({ recordAiUsage: () => {} });
    await closeServer(server);
  }
});
