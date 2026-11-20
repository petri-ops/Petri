#!/usr/bin/env node
'use strict';
// 诊断：错误腿为何超时（非产品代码）。
const http = require('node:http');
const { connect, sleep } = require('./cdp.cjs');

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };

function startMock() {
  const server = http.createServer((req, res) => {
    const url = String(req.url || '');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.method === 'POST' && url.includes('/api/ai/agent')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        console.log('[mock POST] body snippet:', body.slice(0, 160).replace(/\s+/g, ' '));
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, taskId: `diag-${Date.now()}`, status: 'running' }));
      });
      return;
    }
    if (req.method === 'GET' && url.includes('/api/ai/agent/task/')) {
      console.log('[mock SSE] opened');
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* closed */ } };
      send({ event: 'run_started', taskId: 'diag' });
      const timers = [];
      timers.push(setTimeout(() => { console.log('[mock] error frame sent'); send({ error: '乙6 受控注入：上游服务返回 502 bad gateway（模拟服务端错误态）' }); send({ event: 'done', filesChanged: [] }); try { res.write('data: [DONE]\n\n'); res.end(); } catch { /* closed */ } }, 500));
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
  c.setEventListener((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const u = String(msg.params.request.url || '');
    console.log('[paused]', msg.params.request.method, u.replace(/^https?:\/\/localhost:3001/, '').slice(0, 80));
    const nu = u.includes('/api/ai/agent') ? u.replace('http://localhost:3001', `http://127.0.0.1:${mockPort}`) : u;
    void c.send('Fetch.continueRequest', { requestId: msg.params.requestId, url: nu });
  });
  await c.send('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:3001/api/ai/agent*', requestStage: 'Request' }] });
  await c.evaluate(`(() => {
    const ta = document.querySelector('textarea.sc-input') || document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '乙6 受控：触发错误态。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(400);
  const btnState = await c.evalJson(`(function(){ const b = document.querySelector('.sc-send-cta-send'); return { disabled: b && b.disabled, taValue: (document.querySelector('textarea') || {}).value }; })()`);
  console.log('send button:', JSON.stringify(btnState));
  await c.evaluate(`document.querySelector('.sc-send-cta-send')?.click()`);
  for (let i = 0; i < 12; i += 1) {
    await sleep(500);
    const st = await c.evalJson(`(function(){ return { banner: !!document.querySelector('.sc-error-banner'), body502: document.body.innerText.includes('502'), gwErr: document.body.innerText.includes('网关错误'), msgs: document.querySelectorAll('.sc-msg-assistant').length, statsBar: !!document.querySelector('[data-testid=run-stats-bar]') }; })()`);
    console.log(i, JSON.stringify(st));
    if (st.banner || st.body502) break;
  }
  await c.send('Fetch.disable');
  mock.close();
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
