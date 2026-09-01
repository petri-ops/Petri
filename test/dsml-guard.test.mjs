/**
 * DSML 泄漏防护（UI-265 实机观察修复）。
 *
 * DeepSeek 偶发把内部工具调用标记 `<|DSML|>invoke name="…" … <|/DSML|>`
 * 当正文 content 输出（而不是走 tool_calls 通道），标记原文泄漏到聊天区。
 * 覆盖：
 * - stripLeakedToolMarkup：一次性截断（完整块 / 块后正文 / 无标记原样）
 * - createDsmlStreamGuard：增量跨 chunk 分裂、尾部部分前缀扣留与 flush 补发、
 *   命中后 poisoned 吞掉后续增量
 * - DeepSeekProvider 集成：chatStream 聚合 content 与 SSE content_delta 均
 *   不含标记；非流式 chat() 返回的 message.content 同样干净
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stripLeakedToolMarkup, createDsmlStreamGuard } = require('../core/shared-backend/llm-providers/dsml-guard.js');
const { DeepSeekProvider } = require('../core/shared-backend/llm-providers/deepseek.js');

const LEAK = '<|DSML|>invoke name="process_status"<|DSML|>parameter name="processId" string="true">bg-123<|/DSML|>invoke><|DSML|>tool_calls>…<|/DSML|>invoke>';

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

function sseResponse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end('data: [DONE]\n\n');
}

test('stripLeakedToolMarkup truncates from the first DSML mark', () => {
  assert.equal(stripLeakedToolMarkup(`结论已就绪。${LEAK}`), '结论已就绪。');
  assert.equal(stripLeakedToolMarkup(`${LEAK} 尾部噪音`), '');
  // 未配对的开标记同样整段截断
  assert.equal(stripLeakedToolMarkup('正文 <|DSML|>invoke name="x"'), '正文 ');
  // 无标记原样保留（含普通尖括号文本）
  assert.equal(stripLeakedToolMarkup('普通 <div> 正文'), '普通 <div> 正文');
  assert.equal(stripLeakedToolMarkup(''), '');
  assert.equal(stripLeakedToolMarkup(null), '');
});

test('stripLeakedToolMarkup also truncates fullwidth variants (U+FF5C)', () => {
  // 实机复验观察到的 tokenizer 变体：｜｜DSML｜｜
  assert.equal(stripLeakedToolMarkup('报告如下。｜｜DSML｜｜invoke name="process_status"'), '报告如下。');
  assert.equal(stripLeakedToolMarkup('｜｜DSML｜｜｜｜DSML｜｜'), '');
  assert.equal(stripLeakedToolMarkup('正文 ｜｜/DSML｜｜ 尾部'), '正文 ');
  // 半角/全角混合
  assert.equal(stripLeakedToolMarkup('正文 <｜DSML｜>x'), '正文 ');
  // 普通全角竖线文本不受影响
  assert.equal(stripLeakedToolMarkup('A｜B 全角正文'), 'A｜B 全角正文');
});

test('stream guard keeps plain text intact across chunks including partial-bracket tails', () => {
  const guard = createDsmlStreamGuard();
  let out = '';
  out += guard.push('第一段 <');
  out += guard.push('b>加粗</b> 100% <|');
  out += guard.push('完成');
  out += guard.flush();
  assert.equal(out, '第一段 <b>加粗</b> 100% <|完成');
});

test('stream guard strips a DSML block split across chunks', () => {
  const guard = createDsmlStreamGuard();
  let out = '';
  out += guard.push('总结：全部通过。');
  out += guard.push('<|DS');
  out += guard.push('ML|>invoke name="process_status"');
  out += guard.push('…garbage…<|/DSML|>invoke>');
  out += guard.push('更多噪音');
  out += guard.flush();
  assert.equal(out, '总结：全部通过。');
});

test('stream guard swallows everything after a leak and flush stays empty', () => {
  const guard = createDsmlStreamGuard();
  const out = guard.push('ok <|/DSML|> tail') + guard.push('more') + guard.flush();
  assert.equal(out, 'ok ');
});

test('stream guard holds a partial close-mark tail and releases it on flush', () => {
  const guard = createDsmlStreamGuard();
  let out = guard.push('结尾文本 <|/DS');
  assert.equal(out, '结尾文本 ');
  out += guard.flush();
  assert.equal(out, '结尾文本 ');
});

test('stream guard strips fullwidth ｜｜DSML｜｜ deltas (real-device variant)', () => {
  const guard = createDsmlStreamGuard();
  let out = '';
  out += guard.push('后台进程已干净终止。');
  out += guard.push('｜｜DSML｜｜');
  out += guard.push('｜｜DSML｜｜invoke');
  out += guard.flush();
  assert.equal(out, '后台进程已干净终止。');
});

test('stream guard strips a fullwidth mark split across chunks', () => {
  const guard = createDsmlStreamGuard();
  let out = '';
  out += guard.push('完成。');
  out += guard.push('｜｜DS');
  out += guard.push('ML｜｜invoke…');
  out += guard.flush();
  assert.equal(out, '完成。');
});

test('stream guard flush drops a trailing partial mark fragment', () => {
  const guard = createDsmlStreamGuard();
  let out = guard.push('正文完整');
  out += guard.push(' ｜｜DS');
  out += guard.flush();
  assert.equal(out, '正文完整 ');
});

test('chatStream: leaked DSML in deltas never reaches SSE events or aggregate content', async () => {
  const { server, baseUrl } = await startServer((_req, res) => {
    sseResponse(res, [
      { choices: [{ delta: { content: '任务已完成。' } }] },
      { choices: [{ delta: { content: '<|DS' } }] },
      { choices: [{ delta: { content: 'ML|>invoke name="workspace_exec"' } }] },
      { choices: [{ delta: { content: '<|/DSML|>invoke>' } }] },
      { choices: [{ delta: { content: 'noise' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1 } },
    ]);
  });
  try {
    const events = [];
    const result = await new DeepSeekProvider().chatStream('key', { model: 'deepseek-chat', messages: [] }, {}, (event) => events.push(event), { baseUrl });
    const deltas = events.filter((e) => e.type === 'content_delta').map((e) => e.content).join('');
    assert.equal(deltas, '任务已完成。');
    assert.equal(result.choices[0].message.content, '任务已完成。');
    assert.ok(!deltas.includes('DSML'));
    assert.ok(!result.choices[0].message.content.includes('DSML'));
  } finally {
    await closeServer(server);
  }
});

test('chatStream: clean responses pass through byte-for-byte', async () => {
  const { server, baseUrl } = await startServer((_req, res) => {
    sseResponse(res, [
      { choices: [{ delta: { content: 'a < b && c > d' } }] },
      { choices: [{ delta: { content: ' 正常 <|noop' } }] },
      { choices: [{ finish_reason: 'stop' }] },
    ]);
  });
  try {
    const events = [];
    const result = await new DeepSeekProvider().chatStream('key', { model: 'deepseek-chat', messages: [] }, {}, (event) => events.push(event), { baseUrl });
    const deltas = events.filter((e) => e.type === 'content_delta').map((e) => e.content).join('');
    assert.equal(deltas, 'a < b && c > d 正常 <|noop');
    assert.equal(result.choices[0].message.content, deltas);
  } finally {
    await closeServer(server);
  }
});

test('chat (non-stream): leaked DSML is stripped from message.content', async () => {
  const { server, baseUrl } = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: `报告如下。${LEAK}` }, finish_reason: 'stop' }],
    }));
  });
  try {
    const result = await new DeepSeekProvider().chat('key', { model: 'deepseek-chat', messages: [] }, {}, { baseUrl });
    assert.equal(result.choices[0].message.content, '报告如下。');
  } finally {
    await closeServer(server);
  }
});
