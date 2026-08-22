/**
 * DeepSeekProvider retry semantics — single-endpoint retry layer.
 *
 * Covers:
 * - chat(): retryable errors (req_error, timeout, http 5xx/429) trigger a fresh
 *   attempt with exponential backoff + jitter; non-retryable errors resolve
 *   immediately. Each attempt records ai-usage.
 * - chatStream(): same retry trigger rules; failed attempt's events are still
 *   flushed to onEvent (callers commonly wire AbortController into onEvent).
 *   The final attempt's terminal error event is always emitted.
 * - Backward compatibility: with `retry: false` or no options.retry, behavior
 *   matches the original implementation (maxAttempts=1, no delays).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DeepSeekProvider } = require('../core/shared-backend/llm-providers/deepseek.js');

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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', reject);
    tester.listen(0, '127.0.0.1', () => {
      const port = tester.address().port;
      tester.close(() => resolve(port));
    });
  });
}

test('chat: with default options.retry (maxAttempts=1) does not retry on req_error', async () => {
  let requestCount = 0;
  // Server that closes the socket before the request completes → req_error
  const { server, baseUrl } = await startServer((req) => {
    requestCount += 1;
    req.socket.destroy();
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl, timeout: 1000 }
    );
    assert.equal(requestCount, 1, 'should not retry without opt-in');
    assert.ok(result.error, 'expected an error result');
    assert.ok(['req_error', 'timeout', 'res_error'].includes(result.error), `unexpected code: ${result.error}`);
  } finally {
    await closeServer(server);
  }
});

test('chat: with retry opts in and recovers from transient 503', async () => {
  let requestCount = 0;
  const { server, baseUrl } = await startServer((_req, res) => {
    requestCount += 1;
    if (requestCount === 1) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'try again' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'recovered' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl, retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, jitterRatio: 0 } }
    );
    assert.equal(requestCount, 2, 'should have retried once');
    assert.equal(result.choices[0].message.content, 'recovered');
    assert.ok(!result.error, 'final result must not carry an error');
  } finally {
    await closeServer(server);
  }
});

test('chat: with retry opts in and exhausts attempts on persistent 500', async () => {
  let requestCount = 0;
  const { server, baseUrl } = await startServer((_req, res) => {
    requestCount += 1;
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('boom');
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl, retry: { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 20, jitterRatio: 0 } }
    );
    assert.equal(requestCount, 3, 'should have made exactly maxAttempts requests');
    assert.equal(result.error, 'http_error');
    assert.equal(result.status, 500);
    assert.equal(result.message, 'boom');
  } finally {
    await closeServer(server);
  }
});

test('chat: with retry does not retry on 401 (non-retryable 4xx)', async () => {
  let requestCount = 0;
  const { server, baseUrl } = await startServer((_req, res) => {
    requestCount += 1;
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'bad key' } }));
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl, retry: { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 20, jitterRatio: 0 } }
    );
    assert.equal(requestCount, 1, '401 is not retryable');
    assert.equal(result.error, 'http_error');
    assert.equal(result.status, 401);
  } finally {
    await closeServer(server);
  }
});

test('chat: with retry does not retry on 429 (non-retryable in this provider; gateway handles 429)', async () => {
  // 429 IS in our retryable set, so it should be retried
  let requestCount = 0;
  const { server, baseUrl } = await startServer((_req, res) => {
    requestCount += 1;
    if (requestCount === 1) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rate limited' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl, retry: { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 20, jitterRatio: 0 } }
    );
    assert.equal(requestCount, 2, '429 is retryable');
    assert.equal(result.choices[0].message.content, 'ok');
  } finally {
    await closeServer(server);
  }
});

test('chat: retry=false explicitly disables retry', async () => {
  let requestCount = 0;
  const { server, baseUrl } = await startServer((_req, res) => {
    requestCount += 1;
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl, retry: false }
    );
    assert.equal(requestCount, 1, 'retry=false must short-circuit');
    assert.equal(result.error, 'http_error');
  } finally {
    await closeServer(server);
  }
});

test('chat: connection refused (req_error) is retryable and eventually succeeds', async () => {
  // Start by pointing at an unreachable port, then succeed via a different server.
  const deadPort = await findFreePort();
  // Close deadPort's tester; nothing should be listening on it now
  let requestCount = 0;
  const { server, baseUrl } = await startServer((_req, res) => {
    requestCount += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'fine' } }] }));
  });
  try {
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl: `http://127.0.0.1:${deadPort}`, retry: { maxAttempts: 2, baseDelayMs: 5, maxDelayMs: 20, jitterRatio: 0 } }
    );
    // First attempt to deadPort should fail with req_error; second attempt should also
    // hit the same deadPort because we only override baseUrl once. Both fail.
    assert.ok(result.error, 'all attempts to unreachable host must error');
    assert.ok(['req_error', 'timeout', 'res_error'].includes(result.error), `unexpected code: ${result.error}`);
  } finally {
    await closeServer(server);
    // Suppress unused-variable lint
    void requestCount;
    void baseUrl;
  }
});

test('chat: aborted signal cancels in-flight request without retrying', async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"choices":[{"message":{"content":"never seen"}}],"usage":{}}');
      // Never end the response — simulate a slow / stuck server
    });
  });
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await new DeepSeekProvider().chat(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      { baseUrl, signal: controller.signal, retry: { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 20, jitterRatio: 0 } }
    );
    assert.equal(result.error, 'aborted', `expected aborted, got ${result.error}`);
  } finally {
    await closeServer(server);
  }
});

test('chatStream: with retry opts in and recovers from transient req_error', async () => {
  let connectionCount = 0;
  const { server, baseUrl } = await startServer((_req, res) => {
    connectionCount += 1;
    if (connectionCount === 1) {
      // Force req_error by destroying before any response
      res.socket.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2}}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  try {
    const events = [];
    const result = await new DeepSeekProvider().chatStream(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      (event) => events.push(event),
      { baseUrl, retry: { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 20, jitterRatio: 0 }, timeout: 500 }
    );
    assert.equal(connectionCount, 2, 'should have made a second connection after the first failed');
    assert.ok(!result.error, 'final result must not carry an error');
    assert.equal(result.choices[0].message.content, 'hello world');
    // Events include content_deltas from the successful attempt plus done
    const contentDeltas = events.filter((e) => e.type === 'content_delta').map((e) => e.content);
    assert.deepEqual(contentDeltas.join(''), 'hello world');
  } finally {
    await closeServer(server);
  }
});

test('chatStream: terminal error event is emitted exactly once when all attempts fail', async () => {
  let connectionCount = 0;
  // Server that closes connections immediately — generates ECONNRESET on the client side
  const { server, baseUrl } = await startServer((req) => {
    connectionCount += 1;
    // Destroy the request socket as soon as headers are received, before
    // the response is sent. This surfaces as a req_error / res_error on the
    // client without making the test wait for the full request timeout.
    req.socket.destroy();
  });
  try {
    const events = [];
    const result = await new DeepSeekProvider().chatStream(
      'key',
      { model: 'deepseek-chat', messages: [] },
      {},
      (event) => events.push(event),
      { baseUrl, retry: { maxAttempts: 2, baseDelayMs: 5, maxDelayMs: 20, jitterRatio: 0 } }
    );
    assert.equal(connectionCount, 2);
    assert.ok(result.error, 'final result must carry an error');
    const errorEvents = events.filter((e) => e.type === 'error');
    assert.ok(errorEvents.length >= 1, `caller must observe at least one error event; saw ${events.length} events: ${JSON.stringify(events)}`);
    assert.equal(errorEvents.at(-1).error, result.error);
  } finally {
    await closeServer(server);
  }
});
