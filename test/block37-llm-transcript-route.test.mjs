/**
 * BLOCK-37 P2 — 模型 I/O 信息流只读端点（routes/ai-agent/llm-transcripts.js）。
 *
 * 真实 HTTP 集成：真实 Express app + mock auth + 通过 P1 sink 写入的临时数据目录，
 * 覆盖：
 *   - 未登录 401 / 缺 conversationId 400 / 非法 conversationId 400（路径穿越）
 *   - 索引：按会话隔离、ts 升序、不含正文、含轮转留存文件、诚实空态
 *   - 单条完整记录：id 命中 / traceId 命中 / 未命中 404
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resolve = (...segments) => path.resolve(__dirname, '..', ...segments);
const require = createRequire(import.meta.url);

const { createIoTranscriptSink } = require(resolve('core/shared-backend/llm-providers/io-transcript.js'));

const USER_ID = 'u_b37p2';
const CONV_A = 'conv-b37p2-a';
const CONV_B = 'conv_b37p2_b';

let dataDir;
let server;
let baseUrl;
let sink;
let recordOk;
let recordErr;
let recordTrace;

function apiGet(pathname, { userId } = {}) {
  return new Promise((resolvePromise, reject) => {
    const headers = {};
    if (userId) headers['x-mock-user'] = userId;
    const req = http.request(baseUrl + pathname, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let body = null;
        try { body = data ? JSON.parse(data) : null; } catch { body = data; }
        resolvePromise({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block37-p2-'));
  process.env.PETRI_LOCAL_DATA_DIR = dataDir;

  // 通过 P1 sink 写入真实形状的记录（与线上落盘同源）
  sink = createIoTranscriptSink({ dataDir });
  recordOk = {
    telemetry: { conversationId: CONV_A, kind: 'agent_iter', traceId: 'tr-1', userId: USER_ID },
    requestBody: {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'hello' },
      ],
    },
    result: {
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    },
    provider: 'deepseek',
    profileId: 'deepseek-chat',
    role: 'agent',
    attemptIndex: 0,
    model: 'deepseek-chat',
    durationMs: 123,
    frames: [{ type: 'content_delta', content: 'hi' }, { type: 'done' }],
    framesCount: 2,
  };
  recordErr = {
    telemetry: { conversationId: CONV_A, kind: 'agent_iter', traceId: 'tr-2', userId: USER_ID },
    requestBody: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'again' }] },
    result: { error: { code: 'rate_limit', message: 'too many requests' } },
    provider: 'deepseek',
    role: 'agent',
    attemptIndex: 1,
    model: 'deepseek-chat',
  };
  recordTrace = {
    telemetry: { conversationId: CONV_B, kind: 'chat', traceId: 'tr-b', userId: USER_ID },
    requestBody: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'b' }] },
    result: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'bb' } }], usage: { total_tokens: 3 } },
    provider: 'deepseek',
    role: 'chat',
    model: 'deepseek-chat',
  };
  sink.record(recordOk);
  sink.record(recordErr);
  sink.record(recordTrace);

  // 轮转留存文件：手工放一条到 <CONV_A>.<ts>.jsonl
  const rotated = path.join(dataDir, 'llm-transcripts', `${CONV_A}.1700000000000.jsonl`);
  fs.mkdirSync(path.dirname(rotated), { recursive: true });
  fs.writeFileSync(rotated, `${JSON.stringify({
    id: 'rt_rotated_1',
    ts: '2026-09-01T00:00:00.000Z',
    conversationId: CONV_A,
    kind: 'chat',
    role: 'chat',
    attemptIndex: 0,
    request: { messages: [{ role: 'user', content: 'old' }], params: '{}' },
    response: { content: 'old-reply', finishReason: 'stop', usage: { total_tokens: 1 } },
    error: null,
    framesCount: 0,
    framesTruncated: false,
    truncated: false,
    messagesTruncated: 0,
  })}\n`, 'utf8');

  const express = require('express');
  const route = require(resolve('core/petri-server/routes/ai-agent/llm-transcripts.js'));
  const app = express();
  app.use((req, _res, next) => {
    const uid = req.headers['x-mock-user'];
    if (uid) req.user = { id: String(uid), role: 'user' };
    next();
  });
  route.register(app);

  await new Promise((resolvePromise) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolvePromise();
    });
  });
});

after(async () => {
  try { if (server) await new Promise((r) => server.close(r)); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  delete process.env.PETRI_LOCAL_DATA_DIR;
});

test('未登录请求被拒绝 401', async () => {
  const res = await apiGet(`/api/ai/agent/llm-transcripts?conversationId=${CONV_A}`);
  assert.equal(res.status, 401);

  const res2 = await apiGet(`/api/ai/agent/llm-transcripts/record?conversationId=${CONV_A}&id=x`);
  assert.equal(res2.status, 401);
});

test('缺 conversationId 返回 400', async () => {
  const res = await apiGet('/api/ai/agent/llm-transcripts', { userId: USER_ID });
  assert.equal(res.status, 400);

  const res2 = await apiGet('/api/ai/agent/llm-transcripts/record?id=x', { userId: USER_ID });
  assert.equal(res2.status, 400);
});

test('非法 conversationId（路径穿越 / 特殊字符）返回 400', async () => {
  for (const bad of ['..', '../etc', 'a/b', 'a b', '%2e%2e']) {
    const res = await apiGet(`/api/ai/agent/llm-transcripts?conversationId=${encodeURIComponent(bad)}`, { userId: USER_ID });
    assert.equal(res.status, 400, `expected 400 for ${bad}`);
  }
});

test('索引：按会话隔离、ts 升序、含轮转文件、不含正文', async () => {
  const res = await apiGet(`/api/ai/agent/llm-transcripts?conversationId=${CONV_A}`, { userId: USER_ID });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.count, 3); // 轮转 1 + 活跃 2

  const records = res.body.records;
  assert.equal(records[0].id, 'rt_rotated_1');
  assert.equal(records[1].error, null);
  assert.equal(records[2].error, 'rate_limit');
  assert.ok(records[1].ts <= records[2].ts, 'active records sorted by ts asc');

  const okEntry = records[1];
  assert.equal(okEntry.model, 'deepseek-chat');
  assert.equal(okEntry.kind, 'agent_iter');
  assert.equal(okEntry.role, 'agent');
  assert.equal(okEntry.finishReason, 'stop');
  assert.deepEqual(okEntry.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  assert.equal(okEntry.messagesCount, 2);
  assert.equal(okEntry.framesCount, 2);
  assert.equal(okEntry.truncated, false);
  assert.ok(okEntry.sizeBytes > 0);

  // 不含正文：无 request / response / frames / messages 字段
  for (const entry of records) {
    assert.ok(!('request' in entry), 'index must not carry request body');
    assert.ok(!('response' in entry), 'index must not carry response body');
    assert.ok(!('frames' in entry), 'index must not carry frames');
  }

  // B 会话隔离
  const resB = await apiGet(`/api/ai/agent/llm-transcripts?conversationId=${CONV_B}`, { userId: USER_ID });
  assert.equal(resB.status, 200);
  assert.equal(resB.body.count, 1);
  assert.equal(resB.body.records[0].traceId, 'tr-b');
});

test('索引：文件不存在返回诚实空态', async () => {
  const res = await apiGet('/api/ai/agent/llm-transcripts?conversationId=never-written', { userId: USER_ID });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.records, []);
});

test('单条记录：id 命中返回完整记录（request + response + frames）', async () => {
  const res = await apiGet(`/api/ai/agent/llm-transcripts/record?conversationId=${CONV_A}&id=${recordOkId()}`, { userId: USER_ID });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  const record = res.body.record;
  assert.deepEqual(record.request.messages, [
    { role: 'system', content: 'you are helpful' },
    { role: 'user', content: 'hello' },
  ]);
  assert.equal(record.response.content, 'hi');
  assert.equal(record.response.finishReason, 'stop');
  assert.deepEqual(record.response.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  assert.deepEqual(record.frames, [{ type: 'content_delta', content: 'hi' }, { type: 'done' }]);
  assert.ok(res.body.sizeBytes > 0);
});

function recordOkId() {
  // 从索引拿 ok 记录 id（写入口不回传 id，读侧按落盘内容取）
  const file = path.join(dataDir, 'llm-transcripts', `${CONV_A}.jsonl`);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return lines.find((r) => r.error === null).id;
}

test('单条记录：traceId 命中', async () => {
  const res = await apiGet(`/api/ai/agent/llm-transcripts/record?conversationId=${CONV_B}&traceId=tr-b`, { userId: USER_ID });
  assert.equal(res.status, 200);
  assert.equal(res.body.record.response.content, 'bb');
});

test('单条记录：id 与 traceId 均未命中返回 404', async () => {
  const res = await apiGet(`/api/ai/agent/llm-transcripts/record?conversationId=${CONV_A}&id=rt_missing`, { userId: USER_ID });
  assert.equal(res.status, 404);

  const res2 = await apiGet(`/api/ai/agent/llm-transcripts/record?conversationId=${CONV_A}&traceId=tr-none`, { userId: USER_ID });
  assert.equal(res2.status, 404);
});

test('单条记录：id 与 traceId 均缺省返回 400', async () => {
  const res = await apiGet(`/api/ai/agent/llm-transcripts/record?conversationId=${CONV_A}`, { userId: USER_ID });
  assert.equal(res.status, 400);
});

test('单条记录：非法 conversationId 返回 400', async () => {
  const res = await apiGet(`/api/ai/agent/llm-transcripts/record?conversationId=${encodeURIComponent('..%2Fx')}&id=x`, { userId: USER_ID });
  assert.equal(res.status, 400);
});
