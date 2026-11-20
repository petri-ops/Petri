#!/usr/bin/env node
'use strict';
// 诊断：验证 stream [DONE] 后 messages GET 是否被 fulfill、合成内容是否到达前端（非产品代码）。
const http = require('node:http');
const { connect, sleep } = require('./cdp.cjs');

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const HEAD = '::compose{"version":1,"root":"root","nodes":{"root":{"kind":"card"}';
const TAIL = ',"m1":{"kind":"metric","parent":"root","title":"流式命中","value":"92","unit":"%"},"c1":{"kind":"chart","parent":"root","title":"吞吐趋势","chartType":"bar","labels":["A","B"],"series":[{"name":"tok/s","values":[120,145]}]}}}';
const ASSISTANT = '第一段。\n\n第二段。\n\n' + HEAD + TAIL + '\n\n（诊断完成）';

function startMock() {
  const state = { hydrateReady: false };
  const server = http.createServer((req, res) => {
    const url = String(req.url || '');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.method === 'POST' && url.includes('/api/ai/agent')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        state.hydrateReady = false;
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, taskId: `diag-${Date.now()}`, status: 'running' }));
      });
      return;
    }
    if (req.method === 'GET' && url.includes('/api/ai/agent/task/')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* closed */ } };
      send({ event: 'run_started', taskId: 'diag' });
      const timers = [];
      timers.push(setTimeout(() => send({ choices: [{ delta: { content: '第一段。\n\n' } }] }), 300));
      timers.push(setTimeout(() => send({ choices: [{ delta: { content: HEAD } }] }), 700));
      timers.push(setTimeout(() => send({ choices: [{ delta: { content: TAIL } }] }), 1200));
      timers.push(setTimeout(() => send({ choices: [{ delta: { content: '\n\n（诊断完成）' } }] }), 1600));
      timers.push(setTimeout(() => { state.hydrateReady = true; send({ event: 'done', filesChanged: [] }); try { res.write('data: [DONE]\n\n'); res.end(); } catch { /* closed */ } }, 2100));
      res.on('close', () => timers.forEach(clearTimeout));
      return;
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state })));
}

(async () => {
  const c = await connect();
  const mock = await startMock();
  const mockPort = mock.server.address().port;
  let fulfillCount = 0;
  c.setEventListener((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const u = String(msg.params.request.url || '');
    const origin = String((msg.params.request.headers || {}).Origin || 'http://localhost:3000');
    const corsHeaders = [
      { name: 'Access-Control-Allow-Origin', value: origin },
      { name: 'Access-Control-Allow-Credentials', value: 'true' },
      { name: 'Access-Control-Allow-Headers', value: String((msg.params.request.headers || {})['Access-Control-Request-Headers'] || '*') },
      { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
    ];
    if (msg.params.request.method === 'OPTIONS') {
      void c.send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 204, responseHeaders: corsHeaders, body: '' });
      return;
    }
    if (mock.state.hydrateReady && u.includes('/api/ai/conversations/') && u.includes('/messages')) {
      fulfillCount += 1;
      console.log('FULFILL', u.replace(/^https?:\/\/localhost:3001/, ''), 'hydrateReady=', mock.state.hydrateReady);
      const env = { status: 'ok', messages: [{ id: 'd1', role: 'user', content: '诊断', ts: new Date().toISOString() }, { id: 'd2', role: 'assistant', content: ASSISTANT, ts: new Date().toISOString() }], hasMore: false, nextBefore: null, windowOffset: 0, total: 2, compaction: null };
      void c.send('Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...corsHeaders],
        body: Buffer.from(JSON.stringify(env)).toString('base64'),
      });
      return;
    }
    const nu = u.includes('/api/ai/agent') ? u.replace('http://localhost:3001', `http://127.0.0.1:${mockPort}`) : u;
    void c.send('Fetch.continueRequest', { requestId: msg.params.requestId, url: nu });
  });
  await c.send('Fetch.enable', {
    patterns: [
      { urlPattern: 'http://localhost:3001/api/ai/agent*', requestStage: 'Request' },
      { urlPattern: 'http://localhost:3001/api/ai/conversations*', requestStage: 'Request' },
    ],
  });
  await c.evaluate(`(() => {
    const ta = document.querySelector('textarea.sc-input') || document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '诊断：hydrate 时序。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  await c.evaluate(`document.querySelector('.sc-send-cta-send')?.click()`);
  for (let i = 0; i < 14; i += 1) {
    await sleep(500);
    const st = await c.evalJson(`(function(){ return { t: Date.now()%100000, pending: !!document.querySelector('[data-testid=compose-stream-pending]'), msgs: document.querySelectorAll('.sc-msg-assistant').length, close: document.body.innerText.includes('诊断完成'), raw: document.body.innerText.includes('::compose'), invalid: !!document.querySelector('[data-testid=gen-ui-invalid]') }; })()`);
    console.log(i, JSON.stringify(st));
    if (st.close && !st.pending && !st.raw) break;
  }
  console.log('fulfillCount=', fulfillCount);
  await c.send('Fetch.disable');
  mock.server.close();
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
