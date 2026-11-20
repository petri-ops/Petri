#!/usr/bin/env node
'use strict';

/**
 * 乙6 · C-53 P5 性能可信（流式 pending/首屏占位/空错误态）+ P6 skill 触发链消费面（非产品代码）。
 *
 * 腿形态（UI-711 先例）：CDP Fetch 域把主窗发往 :3001 的 /api/ai/agent* 改道本地 mock SSE，
 * 前端仍走真实 conversationRunStore → 真实 SimpleChat/GenUiMessageContent/ToolActivityList 渲染链。
 * 上游内容由 mock 受控注入（真实 deepseek 流式停滞偶发不可按需触发），如实标注。
 * 观感判定归用户；零代签；零新依赖。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'yi6-p5p6';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

// 结构对齐 yi2 合法 spec（root/m1/c1 为 nodes 兄弟节点；root 无 parent）
const COMPOSE_PARTIAL_HEAD = '::compose{"version":1,"root":"root","nodes":{"root":{"kind":"card"}';
const COMPOSE_PARTIAL_TAIL = ',"m1":{"kind":"metric","parent":"root","title":"流式命中","value":"92","unit":"%"},'
  + '"c1":{"kind":"chart","parent":"root","title":"吞吐趋势","chartType":"bar","labels":["A","B"],'
  + '"series":[{"name":"tok/s","values":[120,145]}]}}}';

// 模块级：messages 劫持合成的「已持久化」内容（sendPrompt 记录 prompt；mock stream 剧本组装助手全文）
let lastPrompt = '';
let composeAssistantContent = '';

function startMock() {
  let script = null; // 当前 POST 存的剧本
  const state = { hydrateReady: false }; // stream 剧本 [DONE] 后置 true → messages GET 才劫持
  const server = http.createServer((req, res) => {
    const url = String(req.url || '');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.method === 'POST' && url.includes('/api/ai/agent')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let prompt = '';
        try { prompt = String(JSON.parse(body).prompt || JSON.parse(body).message || body).slice(0, 400); } catch { prompt = body.slice(0, 200); }
        script = prompt.includes('技能触发链') ? 'skill' : prompt.includes('触发错误') ? 'error' : 'stream';
        state.hydrateReady = false;
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, taskId: `yi6-${Date.now()}`, status: 'running', requestBytes: body.length }));
      });
      return;
    }
    if (req.method === 'GET' && url.includes('/api/ai/agent/task/')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* closed */ } };
      const done = () => { try { res.write('data: [DONE]\n\n'); res.end(); } catch { /* closed */ } };
      send({ event: 'run_started', taskId: 'yi6-live' });
      const behavior = script || 'stream';
      const timers = [];
      if (behavior === 'stream') {
        const chunks = [
          '这是乙6 受控长回复第一段：用于观察流式渲染 pending 态与运行统计条。',
          '第二段：流式过程中消息逐段上屏，不阻塞输入区。',
          '第三段：随后进入结构化产物流式段，观察首屏占位。',
          '第四段：占位期间不得泄漏原始 JSON。',
        ];
        chunks.forEach((t, i) => timers.push(setTimeout(() => send({ choices: [{ delta: { content: `${t}\n\n` } }] }), 300 + i * 320)));
        timers.push(setTimeout(() => send({ choices: [{ delta: { content: COMPOSE_PARTIAL_HEAD } }] }), 300 + chunks.length * 320));
        timers.push(setTimeout(() => send({ choices: [{ delta: { content: COMPOSE_PARTIAL_TAIL } }] }), 300 + (chunks.length + 3) * 320));
        timers.push(setTimeout(() => send({ choices: [{ delta: { content: '\n\n（乙6 compose 受控注入完成）' } }] }), 300 + (chunks.length + 5) * 320));
        timers.push(setTimeout(() => { if (process.env.YI6_DEBUG) console.log('[mock done]', Date.now() % 100000); state.hydrateReady = true; send({ event: 'done', filesChanged: [] }); done(); }, 300 + (chunks.length + 6) * 320));
      } else if (behavior === 'error') {
        timers.push(setTimeout(() => { send({ error: '乙6 受控注入：上游服务返回 502 bad gateway（模拟服务端错误态）' }); }, 400));
        timers.push(setTimeout(() => { send({ event: 'done', filesChanged: [] }); done(); }, 2500));
      } else {
        // skill 触发链：skill_discover → skill_get → 简短正文
        timers.push(setTimeout(() => send({ event: 'tool_call', name: 'skill_discover', args: { query: '设计简报 design brief' }, callId: 'sd1', iteration: 1 }), 300));
        timers.push(setTimeout(() => send({ event: 'tool_output', name: 'skill_discover', callId: 'sd1', text: '语义匹配技能库…' }), 600));
        timers.push(setTimeout(() => send({ event: 'tool_result', name: 'skill_discover', callId: 'sd1', summary: '匹配 design-brief（语义分 0.91）' }), 1000));
        timers.push(setTimeout(() => send({ event: 'tool_call', name: 'skill_get', args: { id: 'design-brief' }, callId: 'sg1', iteration: 2 }), 1400));
        timers.push(setTimeout(() => send({ event: 'tool_result', name: 'skill_get', callId: 'sg1', summary: 'design-brief v1.1.0 已加载（五件套契约）' }), 1900));
        timers.push(setTimeout(() => send({ choices: [{ delta: { content: '已按 design-brief skill（受控演示注入）读取设计上下文五件套。' } }] }), 2300));
        timers.push(setTimeout(() => { send({ event: 'done', filesChanged: [] }); done(); }, 4500));
      }
      res.on('close', () => timers.forEach(clearTimeout));
      return;
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state })));
}

async function sendPrompt(c, text) {
  lastPrompt = text;
  await c.evaluate(`(() => {
    const ta = document.querySelector('textarea.sc-input') || document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(350);
  await c.evaluate(`document.querySelector('.sc-send-cta-send')?.click()`);
}

async function regionShot(c, file, selCandidates) {
  for (const sel of selCandidates) {
    const rect = await c.evalJson(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = Math.max(0, r.x), y = Math.max(0, r.y);
      return { x, y, w: Math.min(r.right, innerWidth) - x, h: Math.min(r.bottom, innerHeight) - y };
    })()`);
    if (rect && rect.w > 40 && rect.h > 40) {
      await c.cropFull(file, rect, 0);
      return sel;
    }
  }
  throw new Error(`no region target among ${selCandidates.join(',')}`);
}

const waitFor = async (c, expr, timeoutMs = 15000, interval = 180) => {
  const t0 = Date.now();
  for (;;) {
    const v = await c.evalJson(expr);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor timeout: ${expr.slice(0, 60)}`);
    await sleep(interval);
  }
};

(async () => {
  const c = await connect();
  const startUrl = c.page.url;
  const findings = { startUrl, legs: [] };

  // 开局强制重载：清掉此前 probe/run 可能留下的内存态（真实 hydrate 后才是可信空态基线）
  await c.navigate(startUrl);
  for (let i = 0; i < 12; i += 1) {
    await sleep(500);
    const ok = await c.evalJson(`(function(){ const ta = document.querySelector('textarea'); return !!ta && ta.offsetParent !== null && ta.getBoundingClientRect().width > 0; })()`);
    if (ok) break;
  }

  // messages GET 劫持：run 完成后前端重取 /conversations/:id/messages，而 mock run 无持久化
  // → 视图被重置为空。合成「已持久化」消息（与流出内容一致）让真实 hydrate 链渲染完成卡。
  // 消息形状 = ConversationMessage {id, role, content, ts}（copilotConversationsClient.ts:56）。
  composeAssistantContent = [
    '这是乙6 受控长回复第一段：用于观察流式渲染 pending 态与运行统计条。',
    '第二段：流式过程中消息逐段上屏，不阻塞输入区。',
    '第三段：随后进入结构化产物流式段，观察首屏占位。',
    '第四段：占位期间不得泄漏原始 JSON。',
  ].map((t) => `${t}\n\n`).join('') + COMPOSE_PARTIAL_HEAD + COMPOSE_PARTIAL_TAIL + '\n\n（乙6 compose 受控注入完成）';
  const buildMessagesEnvelope = () => ({
    status: 'ok',
    messages: [
      { id: 'yi6-syn-u1', role: 'user', content: lastPrompt, ts: new Date().toISOString() },
      { id: 'yi6-syn-a1', role: 'assistant', content: composeAssistantContent, ts: new Date().toISOString() },
    ],
    hasMore: false,
    nextBefore: null,
    windowOffset: 0,
    total: 2,
    compaction: null,
  });

  // ① 空态（当前空会话：开始新的对话 + 示例卡）
  try {
    const emptyText = await c.evalJson(`(function(){ const t = document.body.innerText; return { hasEmpty: t.includes('开始新的对话') || t.includes('在下方输入框中提问'), examples: document.querySelectorAll('.sc-example-card').length }; })()`);
    const sel = await regionShot(c, outPath(ITEM, 'p5-empty-state.png'), ['.sc-root', '[class*="centerPanel"]', 'main']);
    findings.legs.push({ id: 'p5_empty_state', pass: emptyText.hasEmpty || emptyText.examples > 0, sel, detail: emptyText });
    console.log('ok p5_empty_state');
  } catch (e) { findings.legs.push({ id: 'p5_empty_state', pass: null, error: e.message }); console.log('ERR p5_empty_state', e.message); }

  // Fetch 改道 → 本地 mock SSE（真实前端链渲染）
  const mock = await startMock();
  const mockPort = mock.server.address().port;
  await c.send('Fetch.enable', {
    patterns: [
      { urlPattern: 'http://localhost:3001/api/ai/agent*', requestStage: 'Request' },
      { urlPattern: 'http://localhost:3001/api/ai/conversations/*/messages*', requestStage: 'Request' },
    ],
  });
  const onReq = async (msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const oldUrl = String(msg.params.request.url || '');
    if (process.env.YI6_DEBUG) console.log('[req]', Date.now() % 100000, msg.params.request.method, oldUrl.replace(/^https?:\\\/\\\/localhost:3001/, ''), 'hydrate=', mock.state.hydrateReady);
    const origin = String((msg.params.request.headers || {}).Origin || 'http://localhost:3000');
    // CORS 合成响应必须精确 origin + credentials（应用带 Authorization，ACAO:* 会被浏览器拒）
    const corsHeaders = [
      { name: 'Access-Control-Allow-Origin', value: origin },
      { name: 'Access-Control-Allow-Credentials', value: 'true' },
      { name: 'Access-Control-Allow-Headers', value: String((msg.params.request.headers || {})['Access-Control-Request-Headers'] || '*') },
      { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
    ];
    if (msg.params.request.method === 'OPTIONS') {
      await c.send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 204, responseHeaders: corsHeaders, body: '' });
      return;
    }
    if (mock.state.hydrateReady && oldUrl.includes('/api/ai/conversations/') && oldUrl.includes('/messages')) {
      if (process.env.YI6_DEBUG) console.log('[fulfill]', Date.now() % 100000, oldUrl.replace(/^https?:\/\/localhost:3001/, ''));
      const body64 = Buffer.from(JSON.stringify(buildMessagesEnvelope())).toString('base64');
      await c.send('Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...corsHeaders],
        body: body64,
      });
      return;
    }
    await c.send('Fetch.continueRequest', { requestId: msg.params.requestId, url: oldUrl.replace('http://localhost:3001', `http://127.0.0.1:${mockPort}`) });
  };
  c.setEventListener(onReq);

  // ② 长回复流式 pending 态（RunStatsBar + 流式文本）
  try {
    await sendPrompt(c, '乙6 受控：请给一段长回复观察流式渲染。');
    await waitFor(c, `!!document.querySelector('[data-testid="run-stats-bar"]')`);
    await sleep(600);
    const sel = await regionShot(c, outPath(ITEM, 'p5-streaming-pending.png'), ['.sc-root', '[class*="centerPanel"]', 'main']);
    const stats = await c.evalJson(`(function(){ const b = document.querySelector('[data-testid="run-stats-bar"]'); return { barText: (b.innerText || '').replace(/\\n/g, ' ').slice(0, 90), streamingMsg: document.querySelectorAll('.sc-msg-assistant').length }; })()`);
    findings.legs.push({ id: 'p5_streaming_pending', pass: true, sel, detail: stats });
    console.log('ok p5_streaming_pending');
  } catch (e) { findings.legs.push({ id: 'p5_streaming_pending', pass: null, error: e.message }); console.log('ERR', e.message); }

  // ③ compose 流式占位（compose-stream-pending）→ 完成卡
  // 完成判定信号：收尾行在场 + 无 pending/invalid 占位 + 无裸 ::compose 文本。
  // 完成翻转后的 hydration 由 messages 劫持的合成持久化消息承载（真实 hydrate 链渲染完成卡）。
  try {
    await waitFor(c, `!!document.querySelector('[data-testid="compose-stream-pending"]')`, 20000);
    const pendingRead = await c.evalJson(`(function(){ const p = document.querySelector('[data-testid="compose-stream-pending"]'); return { text: (p.innerText || '').slice(0, 60), leak: document.body.innerText.includes('"kind":"metric"') }; })()`);
    await regionShot(c, outPath(ITEM, 'p5-compose-stream-pending.png'), ['.sc-root', '[class*="centerPanel"]', 'main']);
    // 完成等待：500ms 轮询 + 状态转储（哪个条件不满足一目了然）
    let st = null;
    for (let i = 0; i < 40; i += 1) {
      await sleep(500);
      st = await c.evalJson(`(function(){ return { pending: !!document.querySelector('[data-testid="compose-stream-pending"]'), invalid: !!document.querySelector('[data-testid="gen-ui-invalid"]'), close: document.body.innerText.includes('乙6 compose 受控注入完成'), raw: document.body.innerText.includes('"kind":"chart"'), msgs: document.querySelectorAll('.sc-msg-assistant').length }; })()`);
      if (process.env.YI6_DEBUG) console.log('[compose-wait]', i, JSON.stringify(st));
      if (!st.pending && !st.invalid && st.close && !st.raw) break;
      st = null;
    }
    if (!st) throw new Error('compose completion wait timeout');
    await sleep(300);
    const doneRead = await c.evalJson(`(function(){ const msgs=[...document.querySelectorAll('.sc-msg-assistant')]; const el=msgs[msgs.length-1]; return { metric: document.body.innerText.includes('流式命中'), chart: document.body.innerText.includes('吞吐趋势'), rawLeak: document.body.innerText.includes('"kind":"chart"'), pending: !!document.querySelector('[data-testid="compose-stream-pending"]'), invalid: !!document.querySelector('[data-testid="gen-ui-invalid"]'), svgCount: el ? el.querySelectorAll('svg').length : 0, lastMsgText: el ? (el.innerText || '').replace(/\\n/g, '|').slice(0, 120) : null }; })()`);
    const msgRect = await c.evalJson(`(function(){ const msgs=[...document.querySelectorAll('.sc-msg-assistant')]; const el=msgs[msgs.length-1]; if(!el) return null; el.scrollIntoView({block:'center',behavior:'instant'}); const r=el.getBoundingClientRect(); const x=Math.max(0,r.x), y=Math.max(0,r.y); return { x, y, w: Math.min(r.right, innerWidth)-x, h: Math.min(r.bottom, innerHeight)-y }; })()`);
    let shotDone = false;
    if (msgRect && msgRect.w > 40 && msgRect.h > 20) { await c.cropFull(outPath(ITEM, 'p5-compose-completed.png'), msgRect, 4); shotDone = true; }
    else { await regionShot(c, outPath(ITEM, 'p5-compose-completed.png'), ['.sc-root', '[class*="centerPanel"]', 'main']); shotDone = true; }
    findings.legs.push({ id: 'p5_compose_pending_then_completed', pass: !pendingRead.leak && !doneRead.rawLeak && !doneRead.pending && !doneRead.invalid && shotDone, detail: { pendingRead, doneRead, completedShot: shotDone, imgEvidence: shotDone ? '见 p5-compose-completed.png（合成持久化消息经真实 hydrate 链渲染的完成态）' : 'screenshot_unavailable' } });
    console.log('ok p5_compose');
  } catch (e) { findings.legs.push({ id: 'p5_compose_pending_then_completed', pass: null, error: e.message }); console.log('ERR compose', e.message); }

  // ④ 错误态（受控 502 注入；发前 reload 清掉 compose 腿遗留内存态，与探针同款干净状态）
  const reloadClean = async () => {
    mock.state.hydrateReady = false; // 错误/skill 腿不需要劫持：reload 后走真实空会话（与探针同款干净基线）
    await c.navigate(startUrl);
    for (let i = 0; i < 12; i += 1) {
      await sleep(500);
      const ok = await c.evalJson(`(function(){ const ta = document.querySelector('textarea'); return !!ta && ta.offsetParent !== null && ta.getBoundingClientRect().width > 0; })()`);
      if (ok) return;
    }
    throw new Error('reload 后 textarea 未就绪');
  };
  try {
    await reloadClean();
    await sendPrompt(c, '乙6 受控：触发错误态。');
    let errSt = null;
    for (let i = 0; i < 40; i += 1) {
      await sleep(500);
      errSt = await c.evalJson(`(function(){ return { banner: !!document.querySelector('.sc-error-banner'), body502: document.body.innerText.includes('502'), msgs: document.querySelectorAll('.sc-msg-assistant').length, statsBar: !!document.querySelector('[data-testid="run-stats-bar"]'), ta: !!(function(){ const ta = document.querySelector('textarea'); return ta && ta.value; })() }; })()`);
      if (process.env.YI6_DEBUG) console.log('[err-wait]', i, JSON.stringify(errSt));
      if (errSt.banner || errSt.body502) break;
      errSt = null;
    }
    if (!errSt) throw new Error('error-state wait timeout');
    await sleep(400);
    const errRead = await c.evalJson(`(function(){ const b = document.querySelector('.sc-error-banner'); return { banner: !!b, bannerText: (b && b.innerText || '').slice(0, 90), roleAlert: document.querySelectorAll('[role="alert"]').length }; })()`);
    await regionShot(c, outPath(ITEM, 'p5-error-state.png'), ['.sc-root', '[class*="centerPanel"]', 'main']);
    findings.legs.push({ id: 'p5_error_state', pass: errRead.banner || errRead.roleAlert > 0, detail: errRead });
    console.log('ok p5_error_state');
  } catch (e) { findings.legs.push({ id: 'p5_error_state', pass: null, error: e.message }); console.log('ERR error-state', e.message); }

  // ⑤ P6 skill 触发链消费面（skill_discover → skill_get 工具行；发前 reload 同上）
  try {
    await reloadClean();
    await sendPrompt(c, '乙6 受控：走一次技能触发链。');
    await waitFor(c, `(function(){ return document.querySelectorAll('.sc-tool-activity').length >= 2; })()`, 20000);
    await sleep(600);
    const toolRead = await c.evalJson(`(function(){ const rows = [...document.querySelectorAll('.sc-tool-activity')]; return { rows: rows.length, labels: rows.map(r => (r.innerText || '').replace(/\\n/g, ' ').slice(0, 60)) }; })()`);
    // 滚到最后一条助手消息，区域截图
    const msgRect = await c.evalJson(`(function(){ const msgs = [...document.querySelectorAll('.sc-msg-assistant')]; const el = msgs[msgs.length - 1]; if (!el) return null; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: Math.min(r.height, innerHeight - r.y - 8) }; })()`);
    await sleep(250);
    await c.cropFull(outPath(ITEM, 'p6-skill-chain.png'), msgRect, 4);
    findings.legs.push({ id: 'p6_skill_chain', pass: toolRead.rows >= 2 && /已列技能|已读技能|skill_discover|skill_get/.test(toolRead.labels.join(' ')), detail: { ...toolRead, note: '工具行标签为产品本地化形态（已列技能=skill_discover / 已读技能=skill_get）' } });
    console.log('ok p6_skill_chain');
  } catch (e) { findings.legs.push({ id: 'p6_skill_chain', pass: null, error: e.message }); console.log('ERR skill-chain', e.message); }

  await c.send('Fetch.disable');
  mock.server.close();

  findings.boundary = '上游 /api/ai/agent* 由本地 mock SSE 受控注入（真实 deepseek 流式偶发不可按需触发）；前端 conversationRunStore/渲染链全真实。消息落当前 fixture 会话（UI-711 同款先例，如实登记）。观感判定归用户，Agent 零代签。';
  writeJson(ITEM, 'findings.json', findings);
  console.log('DONE legs=', findings.legs.length);
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
