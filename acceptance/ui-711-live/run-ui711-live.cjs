#!/usr/bin/env node
'use strict';

/**
 * UI-711-LIVE 实机腿（非产品代码）。
 *
 * 真实 deepseek 流式停滞是服务端偶发，无法按需触发（BLOCK-507/508 既有真实腿结论）。
 * 本腿用 CDP Fetch 域把主窗发往 :3001 的 /api/ai/agent* 请求改道到本地 mock SSE，
 * 由 mock 发出 model-gateway 的同一句停滞错误文案；前端仍走真实收帧 → 真实
 * conversationRunStore → 真实 formatErrorForUser/classifyError → 真实 DOM 渲染。
 *
 * 断言：
 *  ① 页面出现「模型响应暂时停滞，正在自动恢复」文案（STREAM_STALLED）
 *  ② 页面不出现「Python 依赖模块缺失」误导文案
 *  ③ 截图与断言 JSON 落 acceptance/ui-711-live/
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'acceptance', 'ui-711-live');
fs.mkdirSync(OUT, { recursive: true });

const STALL_MESSAGE = '模型流式响应停滞（连续无 token 60001ms），已中止本次调用';
const STALL_UI = '模型响应暂时停滞，正在自动恢复';
const PY_UI = 'Python 依赖模块缺失';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let b = '';
    res.on('data', (c) => { b += c; });
    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

function startMock() {
  const server = http.createServer((req, res) => {
    const url = String(req.url || '');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (req.method === 'POST' && url.includes('/api/ai/agent')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, taskId: `ui711-${Date.now()}`, status: 'running', requestBytes: body.length }));
      });
      return;
    }
    if (req.method === 'GET' && url.includes('/api/ai/agent/task/')) {
      res.writeHead(200, {
        ...cors,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const send = (obj) => {
        try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* closed */ }
      };
      send({ event: 'run_started', taskId: 'ui711-live' });
      send({ choices: [{ delta: { content: '正在验证流式停滞错误分类。' } }] });
      const timer = setTimeout(() => {
        send({ error: STALL_MESSAGE });
        try { res.write('data: [DONE]\n\n'); } catch { /* closed */ }
        try { res.end(); } catch { /* closed */ }
      }, 900);
      res.on('close', () => clearTimeout(timer));
      return;
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const mock = await startMock();
  const mockPort = mock.address().port;
  const targets = await getJson('http://127.0.0.1:9222/json/list');
  const page = targets.find((t) => t.type === 'page' && String(t.url).includes('localhost:3000'));
  if (!page) throw new Error('main-window page target not found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Fetch.requestPaused') {
      const oldUrl = String(msg.params.request.url || '');
      const newUrl = oldUrl.replace('http://localhost:3001', `http://127.0.0.1:${mockPort}`);
      void send('Fetch.continueRequest', { requestId: msg.params.requestId, url: newUrl });
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return m.result?.result?.value;
  };

  await send('Fetch.enable', {
    patterns: [{ urlPattern: 'http://localhost:3001/api/ai/agent*', requestStage: 'Request' }],
  });

  const prompt = '请只回答“已收到”，不要调用任何工具。本轮用于验证停滞错误分类。';
  await evaluate(`(() => {
    const ta = document.querySelector('textarea.sc-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(prompt)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.value.length;
  })()`);
  await sleep(300);
  await evaluate(`document.querySelector('.sc-send-cta-send')?.click()`);

  let snap = null;
  for (let i = 0; i < 80; i += 1) {
    snap = JSON.parse(await evaluate(`JSON.stringify((() => {
      const bodies = [...document.querySelectorAll('.sc-msg-assistant .sc-msg-body')];
      const text = bodies.length ? (bodies[bodies.length - 1].innerText || '') : '';
      const i = text.indexOf(${JSON.stringify(STALL_UI)});
      return {
        stallUi: text.includes(${JSON.stringify(STALL_UI)}),
        pyUi: text.includes(${JSON.stringify(PY_UI)}),
        genericUi: text.includes('发生未知错误，请重试或联系支持'),
        snippet: i >= 0 ? text.slice(Math.max(0, i - 40), i + 120) : null
      };
    })())`));
    if (snap.stallUi) break;
    await sleep(250);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const shotPath = path.join(OUT, 'stall-classification.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.result?.data || '', 'base64'));

  const results = [
    { id: 'L0_upstream_message', pass: true, detail: STALL_MESSAGE },
    { id: 'L1_stall_ui', pass: Boolean(snap?.stallUi), detail: snap?.snippet || 'not found' },
    { id: 'L2_no_python_mislead', pass: Boolean(snap && !snap.pyUi), detail: `pythonMisleading=${snap?.pyUi}` },
  ];
  const meta = {
    item: 'UI-711-LIVE',
    date: new Date().toISOString().slice(0, 10),
    leg: 'dev Electron 主窗 + CDP Fetch 改道本地 mock SSE（真实前端收帧/分类/渲染链）',
    boundary: '真实 deepseek 停摆偶发不可按需触发；上游错误帧由 mock 注入，文案取 model-gateway 原句。非产品代码改动。',
    observedExtra: { genericUnknownBanner: Boolean(snap?.genericUi), note: 'mock 终态叠加的通用 UNKNOWN 横幅，非 UI-711 范围；本腿只断言 STALL 文案在场且无误导 Python 文案。' },
    target: page.url,
    upstreamError: STALL_MESSAGE,
    screenshot: 'acceptance/ui-711-live/stall-classification.png',
    results,
    ok: results.every((r) => r.pass),
  };
  fs.writeFileSync(path.join(OUT, 'live-assertion.json'), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(JSON.stringify(meta, null, 2));

  await send('Fetch.disable');
  ws.close();
  mock.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
