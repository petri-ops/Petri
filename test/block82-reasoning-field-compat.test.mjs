import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// TEST-INFRA-DEBT-2 纪律：Windows 下 ESM 裸相对 import 失败，统一走 createRequire
const { DeepSeekProvider } = require('../core/shared-backend/llm-providers/deepseek.js');
const { normalizeResponse } = require('../core/shared-backend/llm-providers/io-transcript.js');

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

function collectStream(baseUrl, body) {
  const events = [];
  const resultPromise = new DeepSeekProvider().chatStream(
    'secret-key',
    body,
    {},
    (event) => events.push(event),
    { baseUrl }
  );
  return { events, resultPromise };
}

// BLOCK-82 P1 — sensenova 系上游思考段字段名为 reasoning，解析面归一兜底（reasoning_content 优先）。

test('BLOCK-82: 流式 delta.reasoning（sensenova 形状）归一为 reasoning_delta', async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"reasoning":"让我想想"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"答案"},"finish_reason":"stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  try {
    const { events, resultPromise } = collectStream(baseUrl, { model: 'sensenova-6.8-flash-lite', messages: [] });
    const result = await resultPromise;
    assert.deepEqual(events[0], { type: 'reasoning_delta', content: '让我想想' });
    assert.equal(result.choices[0].message.content, '答案');
  } finally {
    await closeServer(server);
  }
});

test('BLOCK-82: 流式 delta.reasoning_content（DeepSeek 形状）主路径回归不变', async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"reasoning_content":"推理中"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  try {
    const { events, resultPromise } = collectStream(baseUrl, { model: 'deepseek-chat', messages: [] });
    await resultPromise;
    assert.deepEqual(events[0], { type: 'reasoning_delta', content: '推理中' });
  } finally {
    await closeServer(server);
  }
});

test('BLOCK-82: 双字段并存时 reasoning_content 优先（不拼接、不重复）', async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"reasoning_content":"主字段","reasoning":"兜底字段"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  try {
    const { events, resultPromise } = collectStream(baseUrl, { model: 'dual-field', messages: [] });
    await resultPromise;
    const reasoningEvents = events.filter((e) => e.type === 'reasoning_delta');
    assert.equal(reasoningEvents.length, 1);
    assert.equal(reasoningEvents[0].content, '主字段');
  } finally {
    await closeServer(server);
  }
});

test('BLOCK-82: 非流式信封（SSE 整包 JSON）message.reasoning 同样归一', async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const envelope = {
        choices: [
          {
            message: { role: 'assistant', content: '完成', reasoning: '信封内思考' },
            finish_reason: 'stop',
          },
        ],
      };
      res.write(`data: ${JSON.stringify(envelope)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  try {
    const { events, resultPromise } = collectStream(baseUrl, { model: 'sensenova-6.8-flash-lite', messages: [] });
    const result = await resultPromise;
    assert.deepEqual(events[0], { type: 'reasoning_delta', content: '信封内思考' });
    assert.equal(result.choices[0].message.content, '完成');
  } finally {
    await closeServer(server);
  }
});

test('BLOCK-82: io-transcript normalizeResponse 记录面 reasoning 兜底归一', () => {
  // sensenova 形状：message.reasoning → reasoningContent
  const sensenova = normalizeResponse({
    choices: [{ message: { content: '答', reasoning: '思考段' }, finish_reason: 'stop' }],
  });
  assert.equal(sensenova.reasoningContent, '思考段');

  // DeepSeek 形状回归：reasoning_content 优先
  const deepseek = normalizeResponse({
    choices: [{ message: { content: '答', reasoning_content: '主字段', reasoning: '兜底' }, finish_reason: 'stop' }],
  });
  assert.equal(deepseek.reasoningContent, '主字段');

  // reasoning_content 为空串时保持既有契约（空串原样记录），不吞并 reasoning
  const emptyMain = normalizeResponse({
    choices: [{ message: { content: '答', reasoning_content: '', reasoning: '兜底' }, finish_reason: 'stop' }],
  });
  assert.equal(emptyMain.reasoningContent, '');

  // 两字段皆缺 → undefined（零变化）
  const none = normalizeResponse({
    choices: [{ message: { content: '答' }, finish_reason: 'stop' }],
  });
  assert.equal(none.reasoningContent, undefined);
});
