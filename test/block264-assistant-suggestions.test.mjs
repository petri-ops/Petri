import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// BLOCK-264（C-36）— 模型侧建议纯函数面：parseSuggestions（围栏/杂文/数组形态/
// 条数与长度钳位）+ 端点契约（无凭据 503 / 空 content 400）。
// 模型调用面走 mock 注入（零网络）。

const tempDir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'b264-sugg-'));
process.env.PETRI_LOCAL_DATA_DIR = tempDir;

const suggestions = require('../core/petri-server/helpers/assistant-suggestions.js');

test('BLOCK-264 parseSuggestions — 纯 JSON 数组直取', () => {
  assert.deepEqual(suggestions.parseSuggestions('["问题一","问题二","问题三"]'), ['问题一', '问题二', '问题三']);
});

test('BLOCK-264 parseSuggestions — ```json 围栏与前后杂文容错', () => {
  const raw = '好的，以下是建议：\n```json\n["A","B","C"]\n```\n希望有帮助';
  assert.deepEqual(suggestions.parseSuggestions(raw), ['A', 'B', 'C']);
});

test('BLOCK-264 parseSuggestions — {question} 对象数组形态兼容', () => {
  assert.deepEqual(
    suggestions.parseSuggestions('[{"question":"Q1"},{"question":"Q2"}]'),
    ['Q1', 'Q2']
  );
});

test('BLOCK-264 parseSuggestions — 钳位：最多 3 条、每条 ≤160 字、空白清洗', () => {
  const five = JSON.stringify(['a', 'b', 'c', 'd', 'e']);
  assert.equal(suggestions.parseSuggestions(five).length, 3);
  const long = 'x'.repeat(300);
  const clamped = suggestions.parseSuggestions(JSON.stringify([long]));
  assert.equal(clamped[0].length, 160);
  assert.deepEqual(suggestions.parseSuggestions(JSON.stringify(['  ', null, 42])), null, '全无效=null');
});

test('BLOCK-264 parseSuggestions — 非数组/坏 JSON=null（不编造）', () => {
  assert.equal(suggestions.parseSuggestions('不是 JSON'), null);
  assert.equal(suggestions.parseSuggestions('{"a":1}'), null);
  assert.equal(suggestions.parseSuggestions('[]'), null);
  assert.equal(suggestions.parseSuggestions(''), null);
});

// ---------- 端点契约（无凭据路径走真实 helper） ----------

test('BLOCK-264 端点 — 无凭据 503 no_credential；空 content 400', async () => {
  const express = require('express');
  const http = require('node:http');
  const route = require('../core/petri-server/routes/ai-agent/suggestions.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u1' }; next(); });
  route.register(app);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (res) => ({ status: res.status, body: await res.json() }));
  try {
    const empty = await call('/api/ai/agent/suggest-followups', {});
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, 'content_required');

    const noCred = await call('/api/ai/agent/suggest-followups', { content: '一些回复内容' });
    assert.ok([502, 503].includes(noCred.status), `无凭据应 502/503，实得 ${noCred.status}`);
  } finally { server.close(); }
});
