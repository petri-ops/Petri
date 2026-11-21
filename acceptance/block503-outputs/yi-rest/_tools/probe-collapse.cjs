#!/usr/bin/env node
'use strict';

/** 复现「agent 工作时」工具行/消息折叠现状（mock SSE 三工具 run，运行中+结束后双截图）。非产品代码。 */
const http = require('node:http');
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };

function startMock() {
  const server = http.createServer((req, res) => {
    const url = String(req.url || '');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.method === 'POST' && url.includes('/api/ai/agent')) {
      let body = '';
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, taskId: `cl-${Date.now()}`, status: 'running' }));
      });
      return;
    }
    if (req.method === 'GET' && url.includes('/api/ai/agent/task/')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* closed */ } };
      const timers = [];
      send({ event: 'run_started', taskId: 'collapse-probe' });
      const tools = [
        ['workspace_read', '读取 big-context.txt 完成，900 行已载入。'],
        ['workspace_grep', '模式匹配命中 14 处，已汇总。'],
        ['workspace_exec', '命令执行完毕，exit 0。'],
      ];
      tools.forEach(([name, text], i) => {
        timers.push(setTimeout(() => send({ event: 'tool_call', name, args: {}, callId: `c${i}`, iteration: 1 }), 300 + i * 1800));
        timers.push(setTimeout(() => send({ event: 'tool_output', name, callId: `c${i}`, text: `${text}\n${'输出明细行 '.repeat(40)}` }), 800 + i * 1800));
      });
      // 运行中悬挂 6 秒（第三个工具 running 状态）再收尾
      timers.push(setTimeout(() => send({ choices: [{ delta: { content: '三点结论：…' } }] }), 300 + 3 * 1800 + 2500));
      timers.push(setTimeout(() => { send({ event: 'done', filesChanged: [] }); try { res.write('data: [DONE]\n\n'); res.end(); } catch { /* closed */ } }, 300 + 3 * 1800 + 5500));
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
  const startUrl = c.page.url;
  const mock = await startMock();
  const mockPort = mock.address().port;
  c.setEventListener((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const u = String(msg.params.request.url || '');
    const nu = u.includes('/api/ai/agent') ? u.replace('http://localhost:3001', `http://127.0.0.1:${mockPort}`) : u;
    void c.send('Fetch.continueRequest', { requestId: msg.params.requestId, url: nu });
  });
  await c.send('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:3001/api/ai/agent*', requestStage: 'Request' }] });

  await c.evaluate(`(() => {
    const ta = document.querySelector('textarea.sc-input') || document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '折叠行为复现：连续读三个文件。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(350);
  await c.evaluate(`document.querySelector('.sc-send-cta-send')?.click()`);

  // 等第三个工具 running（第 3 个 call 在 ~3.9s，output 在 ~4.4s；等 output 之后仍 running）
  await sleep(4700);
  const running = await c.evalJson(`(function(){
    const rows = [...document.querySelectorAll('.sc-tool-activity')].map(el => ({
      cls: String(el.className).slice(0, 60),
      dataExpanded: el.getAttribute('data-expanded'),
      ariaExpanded: el.getAttribute('aria-expanded'),
      text: (el.innerText || '').replace(/\\n/g, '|').slice(0, 70),
    }));
    const working = !!document.querySelector('[data-testid="chat-working-status"]');
    const assistantMsgs = document.querySelectorAll('.sc-msg-assistant').length;
    return { rows, workingStatus: working, assistantMsgs };
  })()`);
  await c.shot(outPath('collapse-probe', 'running-state.png'));
  console.log('RUNNING:', JSON.stringify(running, null, 1));

  // 等结束
  await sleep(6000);
  const done = await c.evalJson(`(function(){
    const rows = [...document.querySelectorAll('.sc-tool-activity')].map(el => ({ dataExpanded: el.getAttribute('data-expanded'), ariaExpanded: el.getAttribute('aria-expanded') }));
    return { rows, workingStatus: !!document.querySelector('[data-testid="chat-working-status"]') };
  })()`);
  await c.shot(outPath('collapse-probe', 'done-state.png'));
  console.log('DONE:', JSON.stringify(done));

  writeJson('collapse-probe', 'findings.json', { running, done, note: '运行中第三工具 running 态时取第一组读数；结束后取第二组。' });
  await c.send('Fetch.disable');
  mock.close();
  await c.navigate(startUrl);
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
