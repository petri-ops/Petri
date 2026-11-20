#!/usr/bin/env node
'use strict';
// 诊断：mock run 完成后前端对 :3001 发了哪些请求（找重取端点）；非产品代码。
const http = require('node:http');
const { connect, sleep } = require('./cdp.cjs');

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const HEAD = '::compose{"version":1,"root":"root","nodes":{"root":{"kind":"card"}';
const TAIL = ',"m1":{"kind":"metric","parent":"root","title":"流式命中","value":"92","unit":"%"},"c1":{"kind":"chart","parent":"root","title":"吞吐趋势","chartType":"bar","labels":["A","B"],"series":[{"name":"tok/s","values":[120,145]}]}}}';

function startMock() {
  let script = 'stream';
  const server = http.createServer((req, res) => {
    const url = String(req.url || '');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.method === 'POST' && url.includes('/api/ai/agent')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        script = body.includes('诊断') ? 'stream' : script;
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
      timers.push(setTimeout(() => send({ choices: [{ delta: { content: `第一段。\n\n${HEAD}` } }] }), 300));
      timers.push(setTimeout(() => send({ choices: [{ delta: { content: TAIL } }] }), 900));
      timers.push(setTimeout(() => send({ choices: [{ delta: { content: '\n\n（诊断完成）' } }] }), 1300));
      timers.push(setTimeout(() => { send({ event: 'done', filesChanged: [] }); try { res.write('data: [DONE]\n\n'); res.end(); } catch { /* closed */ } }, 1800));
      res.on('close', () => timers.forEach(clearTimeout));
      return;
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const c = await connect();
  const mock = await startMock();
  const mockPort = mock.address().port;
  const seen = [];
  c.setEventListener((msg) => {
    if (msg.method === 'Fetch.requestPaused') {
      const u = String(msg.params.request.url || '');
      seen.push(`${msg.params.request.method} ${u.replace(/^https?:\/\/localhost:3001/, '')}`);
      const nu = u.includes('/api/ai/agent') ? u.replace('http://localhost:3001', `http://127.0.0.1:${mockPort}`) : u;
      void c.send('Fetch.continueRequest', { requestId: msg.params.requestId, url: nu });
    }
  });
  await c.send('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:3001/*', requestStage: 'Request' }] });
  await c.evaluate(`(() => {
    const ta = document.querySelector('textarea.sc-input') || document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '诊断：compose 完成态重取观察。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  await c.evaluate(`document.querySelector('.sc-send-cta-send')?.click()`);
  // 完成后观察 6 秒内的请求
  await sleep(7000);
  console.log(seen.filter((s) => !s.includes('/api/ai/agent')).join('\n') || '(no other :3001 requests)');
  // 完成后 DOM 里还有什么
  const after = await c.evalJson(`(function(){ const msgs=[...document.querySelectorAll('.sc-msg-assistant')]; const el=msgs[msgs.length-1]; return { msgCount: msgs.length, lastText: el ? (el.innerText||'').slice(0,120).replace(/\\n/g,'|') : null, bodyHasMetric: document.body.innerText.includes('流式命中'), pending: !!document.querySelector('[data-testid=compose-stream-pending]'), invalid: !!document.querySelector('[data-testid=gen-ui-invalid]') }; })()`);
  console.log('after:', JSON.stringify(after));
  await c.send('Fetch.disable');
  mock.close();
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
