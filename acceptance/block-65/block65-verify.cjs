#!/usr/bin/env node
// BLOCK-65 子智能体专属界面实机验收（真实模型 spawn 链路）：
//   P1-b① spawn 后自动弹出专属窗（无手动点击）+ 窗口标题带 task 描述
//   P1-a  窗内交互：留言（队列语义 note）+ 终态「继续派」（自动弹新窗）
//   P2-c② SubAgentsBar「全部俯瞰」跨会话列表
// 证据 → acceptance/block-65/。
'use strict';
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = 'D:/<workdir>/petri-desktop';
const OUT = path.join(ROOT, 'acceptance', 'block-65');

async function cdpConnect(targetUrlMatch) {
  const list = await (await fetch('http://localhost:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page' && (!targetUrlMatch || targetUrlMatch.test(t.url)));
  if (!page) return null;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'page exception');
    return r.result?.value;
  };
  return { ws, send, ev, url: page.url, close: () => ws.close() };
}

async function sendChat(main, text) {
  return main.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ta = document.querySelector('textarea.sc-input');
    if (!ta) return { ok: false, reason: 'no textarea' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await sleep(1500);
    return { ok: true };
  })()`);
}

(async () => {
  const out = { steps: {} };
  const O = (k, v) => { out.steps[k] = v; console.log(`[${k}]`, JSON.stringify(v).slice(0, 300)); };
  fs.mkdirSync(OUT, { recursive: true });

  const before = new Set((await (await fetch('http://localhost:9222/json/list')).json())
    .filter((t) => /\/window\/agent\//.test(t.url)).map((t) => t.url));

  // ── STEP 1: open conversation ──
  const main = await cdpConnect(/localhost:3000\/project/);
  if (!main) throw new Error('main page not found');
  const opened = await main.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const node = [...document.querySelectorAll('[class*="projectTreeNode"]')].find((n) => /Active/i.test((n.querySelector('[class*="projectTreeRow"]') || {}).className || ''));
    if (!node) return { ok: false, reason: 'no active project node' };
    const row = node.querySelector('[class*="projectTreeRow"]');
    if (!node.querySelector('ul')) { row.click(); await sleep(800); }
    const lis = [...((node.querySelector('ul') || {}).querySelectorAll?.('li') || [])];
    for (const li of lis) {
      li.click(); await sleep(2200);
      const t = (document.querySelector('.sc-messages')?.innerText || '').trim();
      if (t.length > 0 && document.querySelectorAll('.sc-example-title').length === 0) return { ok: true };
    }
    return { ok: false, reason: 'no conversation loaded' };
  })()`);
  O('1-conv-open', opened);
  if (!opened.ok) throw new Error('conversation not loaded');

  // ── STEP 2: send spawn instruction (real model) ──
  const PROMPT = '请用 spawn_agent 派一个子 agent，任务：从 1 逐个列出 30 的每个数的平方，直到 30 的平方为止（每个一行，共 30 行）。派出后用 wait_agent 等待它完成（超时 180 秒），并把子 agent 的答案原样汇报给我。';
  const sent = await sendChat(main, PROMPT);
  O('2-send', sent);
  if (!sent.ok) throw new Error('failed to send prompt');

  // ── STEP 3: auto pop-out (P1-b①) — new agent window without manual click ──
  let agentUrl = null;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const list = await (await fetch('http://localhost:9222/json/list')).json();
    const targets = list.filter((t) => /\/window\/agent\//.test(t.url) && !before.has(t.url));
    if (targets.length > 0) { agentUrl = targets[targets.length - 1].url; break; }
  }
  O('3-auto-pop', { agentUrl, isAuto: !!agentUrl });
  if (!agentUrl) throw new Error('agent window did not auto-pop within 120s');
  const taskId = decodeURIComponent(agentUrl.split('/window/agent/')[1] || '');

  // ── STEP 4: agent window assertions (title prefix + action bar + 留言) ──
  const win = await cdpConnect(/\/window\/agent\//);
  if (!win) throw new Error('cannot connect to agent window');
  let leave = null;
  let winState = null;
  try {
    await sleep(2500); // meta fetch + title
    winState = await win.ev(`(() => ({
      title: document.querySelector('[class*="titleGroup"] strong')?.textContent || document.title,
      hasActionBar: !!document.querySelector('[data-testid="agent-window-actions"]'),
      hasMessageComposer: !!document.querySelector('[data-testid="agent-window-actions"] textarea'),
      statusChip: (document.querySelector('[class*="statusChip"]') || {}).textContent || null,
    }))()`);
    O('4-window', winState);

    // 留言（队列语义）
    leave = await win.ev(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const ta = document.querySelector('[data-testid="agent-window-actions"] textarea');
      if (!ta) return { ok: false, reason: 'no composer' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'BLOCK-65 留言探针：完成后请额外给出结果的十六进制表示。');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(250);
      const btn = [...document.querySelectorAll('[data-testid="agent-window-actions"] button')].find((b) => b.textContent.includes('留言'));
      if (!btn) return { ok: false, reason: 'no 留言 button' };
      btn.click();
      await sleep(1200);
      const note = document.querySelector('[role="status"]')?.textContent || '';
      return { ok: true, noteHead: note.slice(0, 60) };
    })()`);
    O('5-message', leave);

    // screenshot of agent window
    const shot1 = await win.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'ui314-agent-window.png'), Buffer.from(shot1.data, 'base64'));
  } finally { win.close(); }

  // ── STEP 6: wait for terminal (poll meta via HTTP) ──
  const token = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_PATH(), 'local-identity.json'), 'utf8')).token || ''; } catch { return ''; } })();
  function DATA_PATH() { return path.join(ROOT, '.petri-dev-user-data', 'data'); }
  let meta = null;
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    try {
      const resp = await fetch(`http://localhost:3001/api/ai/agent/task/${encodeURIComponent(taskId)}/meta`, {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      const body = await resp.json().catch(() => null);
      if (body?.ok) { meta = body; if (body.status !== 'running' && body.status !== 'pending') break; }
    } catch {}
  }
  O('6-terminal', { status: meta?.status || 'unknown' });

  // ── STEP 7: followup in agent window → auto pops new window ──
  const beforeFollowup = new Set((await (await fetch('http://localhost:9222/json/list')).json())
    .filter((t) => /\/window\/agent\//.test(t.url)).map((t) => t.url));
  const win2 = await cdpConnect(/\/window\/agent\//);
  if (!win2) throw new Error('cannot reconnect agent window');
  let follow = null;
  try {
    follow = await win2.ev(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const section = document.querySelector('[data-testid="agent-window-actions"]');
      const ta = section && section.querySelector('textarea');
      if (!ta) return { ok: false, reason: 'no followup composer (state?)', hasSection: !!section };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'BLOCK-65 续派探针：列出 1 到 40 每个数的平方（每行一个，共 40 行），最后给出它们的和。');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(250);
      const btn = [...section.querySelectorAll('button')].find((b) => b.textContent.includes('继续派'));
      if (!btn) return { ok: false, reason: 'no 继续派 button' };
      btn.click();
      await sleep(2500);
      return { ok: true };
    })()`);
    O('7-followup-click', follow);
    const shot2 = await win2.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'ui314-agent-window-terminal.png'), Buffer.from(shot2.data, 'base64'));
  } finally { win2.close(); }
  let newAgentPopped = false;
  let newAgentUrl = null;
  for (let i = 0; i < 15 && !newAgentPopped; i++) {
    await sleep(1500);
    const list = await (await fetch('http://localhost:9222/json/list')).json();
    const fresh = list.find((t) => /\/window\/agent\//.test(t.url) && !beforeFollowup.has(t.url) && t.url !== agentUrl);
    if (fresh) { newAgentPopped = true; newAgentUrl = fresh.url; }
  }
  O('7-followup-pop', { newAgentPopped, newAgentUrl });

  // ── STEP 7.5: 留言（对刚续派、必然运行中的新子窗；队列语义） ──
  let leave2 = null;
  const win3 = newAgentUrl ? await cdpConnect(/\/window\/agent\//) : null;
  if (win3) {
    try {
      leave2 = await win3.ev(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 20; i++) {
          const ta = document.querySelector('[data-testid="agent-window-actions"] textarea');
          const btn = [...(document.querySelectorAll('[data-testid="agent-window-actions"] button') || [])].find((b) => b.textContent.includes('留言'));
          if (ta && btn) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, 'BLOCK-65 留言探针：完成后请额外给出结果的十六进制表示。');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(250);
            btn.click();
            await sleep(1200);
            const note = document.querySelector('[role="status"]')?.textContent || '';
            return { ok: note.includes('入队') || note.includes('队列'), noteHead: note.slice(0, 60) };
          }
          await sleep(1000);
        }
        return { ok: false, reason: 'running composer never appeared' };
      })()`);
    } finally { win3.close(); }
  }
  O('7.5-message', leave2);

  // ── STEP 8: SubAgentsBar 全部俯瞰 ──
  const main2 = await cdpConnect(/localhost:3000\/project/);
  let overview = null;
  if (main2) {
    await main2.ev(`(() => {
      const btn = document.querySelector('[data-testid="subagents-overview-toggle"]');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
      return {};
    })()`);
    await sleep(2500);
    overview = await main2.ev(`(() => {
      const panel = document.querySelector('[data-testid="subagents-overview"]');
      if (!panel) return { present: false };
      const rows = [...panel.querySelectorAll('[data-status]')].filter((n) => n.className.includes('row'));
      return { present: true, rows: rows.length, hasConvTag: panel.textContent.includes('@') };
    })()`);
    const shot3 = await main2.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'ui314-overview.png'), Buffer.from(shot3.data, 'base64'));
    main2.close();
  }
  O('8-overview', overview);

  const verdict = {
    autoPopOnSpawn: !!agentUrl,
    windowTitlePrefix: !!winState && /Agent · /.test(winState.title),
    messageQueued: !!(leave2 && leave2.ok),
    followupLaunched: !!(follow && follow.ok),
    followupAutoPops: newAgentPopped,
    overviewPanel: !!(overview && overview.present && overview.rows >= 1 && overview.hasConvTag),
  };
  out.taskId = taskId;
  out.verdict = verdict;
  console.log('VERDICT', JSON.stringify(verdict, null, 1));
  fs.writeFileSync(path.join(OUT, 'ui314-live.json'), JSON.stringify(out, null, 2));
  const allPass = Object.values(verdict).every(Boolean);
  if (!allPass) { console.error('VERDICT PARTIAL'); process.exit(2); }
  console.log('BLOCK-65 LIVE PASS');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
