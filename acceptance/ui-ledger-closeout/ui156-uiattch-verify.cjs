#!/usr/bin/env node
// UI-156 (Fork button) + UI-ATTCH-001 ③④ (attachment preview modal zoom/ESC + doc chip) evidence.
'use strict';
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT = 'p_mtrawlau_7rly';
const TMP = process.env.TEMP || '/tmp';
const PNG_PATH = path.join(TMP, 'uiattch-fixture.png');
const TXT_PATH = path.join(TMP, 'uiattch-fixture-doc.txt');

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

async function connect() {
  const list = await (await fetch('http://localhost:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page');
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
  const nav = async (url) => { await ev(`location.href='${url}'; 'nav'`); await sleep(3500); };
  return { send, ev, nav, close: () => ws.close() };
}

(async () => {
  fs.writeFileSync(PNG_PATH, PNG_1PX);
  fs.writeFileSync(TXT_PATH, 'uiattch doc fixture 中文文件名内容\n');
  const out = { steps: {} };
  const O = (k, v) => { out.steps[k] = v; console.log(`[${k}]`, JSON.stringify(v).slice(0, 400)); };
  const c = await connect();

  // ── UI-156: Fork button ──
  await c.nav(`http://localhost:3000/project/${PROJECT}`);
  const opened = await c.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const activeNode = [...document.querySelectorAll('[class*="projectTreeNode"]')].find((n) => {
      const row = n.querySelector('[class*="projectTreeRow"]');
      return row && /Active/i.test(row.className);
    });
    if (!activeNode) return { ok: false, reason: 'no active project node' };
    const row = activeNode.querySelector('[class*="projectTreeRow"]');
    if (!activeNode.querySelector('ul')) { row.click(); await sleep(800); }
    const lis = [...((activeNode.querySelector('ul') || {}).querySelectorAll?.('li') || [])];
    for (const li of lis) {
      li.click(); await sleep(2200);
      const t = (document.querySelector('.sc-messages')?.innerText || '').trim();
      if (t.length > 0 && document.querySelectorAll('.sc-example-title').length === 0) return { ok: true };
    }
    return { ok: false, reason: 'no conversation loaded' };
  })()`);
  O('u156-open-conv', opened);
  const forkStep = await c.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btn = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('创建分支') || (b.textContent || '').includes('创建分支'));
    if (!btn) return { found: false };
    const convsBefore = document.querySelectorAll('button[title="双击重命名对话"]').length;
    btn.click();
    await sleep(2500);
    const convsAfter = document.querySelectorAll('button[title="双击重命名对话"]').length;
    const branchTitles = [...document.querySelectorAll('button[title="双击重命名对话"]')].map((b) => b.textContent);
    return { found: true, convsBefore, convsAfter, branchTitles };
  })()`);
  O('u156-fork', forkStep);

  // ── UI-ATTCH-001 ③④: drag files onto composer (in-page real DOM DragEvent
  // with real File objects — the host blocks synthetic OS drag gestures, same
  // evidence class as CDP key injection per plan §5.6) ──
  const convIdsBefore = new Set((await fetchJson('http://localhost:3001/api/ai/conversations?status=active&project_id=' + PROJECT, { headers: {} })).conversations?.map((x) => x.id) || []);
  const pngB64 = PNG_1PX.toString('base64');
  const txtContent = fs.readFileSync(TXT_PATH, 'utf8');
  const rect = await c.ev(`(() => {
    const ta = document.querySelector('textarea.sc-input') || document.querySelector('.sc-composer');
    if (!ta) return null;
    const r = ta.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!rect) throw new Error('composer not found');
  const dragResult = await c.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const b64ToBytes = (b64) => { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
    const composer = document.querySelector('.sc-composer');
    if (!composer) return { error: 'no composer' };
    const pngFile = new File([b64ToBytes('${pngB64}')], 'uiattch-fixture.png', { type: 'image/png' });
    const txtFile = new File(['${txtContent.replace(/'/g, "\\'").replace(/\n/g, '\\n')}'], 'uiattch-fixture-doc.txt', { type: 'text/plain' });
    const mkDt = () => { const dt = new DataTransfer(); dt.items.add(pngFile); dt.items.add(txtFile); return dt; };
    const opts = { bubbles: true, cancelable: true, composed: true };
    composer.dispatchEvent(new DragEvent('dragenter', { ...opts, dataTransfer: mkDt() }));
    composer.dispatchEvent(new DragEvent('dragover', { ...opts, dataTransfer: mkDt() }));
    await sleep(400);
    const dragging = !!document.querySelector('.sc-composer.sc-composer-dragging');
    composer.dispatchEvent(new DragEvent('drop', { ...opts, dataTransfer: mkDt() }));
    await sleep(1200);
    const chips = [...document.querySelectorAll('.sc-attachments .sc-attachment')].map((n) => ({
      text: (n.textContent || '').slice(0, 60),
      hasIcon: !!n.querySelector('svg, i, img'),
      hasPreviewBtn: !!n.querySelector('.sc-attachment-preview-btn'),
    }));
    return { dragging, chips, count: chips.length };
  })()`);
  O('uiattch-drag', dragResult);
  const dragging = { dragging: dragResult.dragging };
  const chips = { count: dragResult.count, chips: dragResult.chips };
  O('uiattch-dragging', dragging);
  O('uiattch-chips', chips);

  // ③ preview modal: open on image chip → zoom in → label → ESC closes
  const preview = await c.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btn = document.querySelector('.sc-attachment-preview-btn');
    if (!btn) return { opened: false, reason: 'no preview button' };
    btn.click(); await sleep(700);
    const overlay = document.querySelector('.sc-preview-overlay');
    if (!overlay) return { opened: false, reason: 'no overlay' };
    const label0 = document.querySelector('.sc-preview-zoom-label')?.textContent || null;
    const zoomIn = [...document.querySelectorAll('.sc-preview-control-btn')].find((b) => b.getAttribute('aria-label') === '放大');
    if (zoomIn) { zoomIn.click(); await sleep(400); }
    const label1 = document.querySelector('.sc-preview-zoom-label')?.textContent || null;
    const filename = document.querySelector('.sc-preview-filename')?.textContent || null;
    return { opened: true, label0, label1, filename, hasReset: [...document.querySelectorAll('.sc-preview-control-btn')].some((b) => /重置|reset/i.test(b.getAttribute('aria-label') || '')) };
  })()`);
  O('uiattch-preview', preview);
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(600);
  const escClosed = await c.ev(`(() => ({ overlayGone: !document.querySelector('.sc-preview-overlay') }))()`);
  O('uiattch-esc', escClosed);

  const verdict = {
    forkButtonPresent: forkStep.found === true,
    forkCreatedBranch: forkStep.convsAfter > forkStep.convsBefore,
    dragFeedback: dragging.dragging === true,
    attachmentChips: chips.count >= 2,
    docChipNamed: chips.chips.some((x) => x.text.includes('uiattch-fixture-doc.txt')),
    chipsHaveIcons: chips.chips.every((x) => x.hasIcon),
    previewModalOpens: preview.opened === true,
    zoomChanged: preview.label0 !== preview.label1,
    escCloses: escClosed.overlayGone === true,
  };
  out.verdict = verdict;
  console.log('VERDICT', JSON.stringify(verdict, null, 1));

  // cleanup: reload discards ephemeral attachments
  await c.nav(`http://localhost:3000/project/${PROJECT}`);
  c.close();

  // delete ONLY conversations created during this run (id-diff, never title-match)
  const token = (() => { try { return JSON.parse(fs.readFileSync(path.join(process.env.TEMP || '/tmp', '..', '.petri-dev-user-data', 'data', 'local-identity.json'), 'utf8')).token || ''; } catch { return ''; } })();
  const base = 'http://localhost:3001/api';
  const H = { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const convsAfterAll = await fetchJson(base + '/ai/conversations?status=active&project_id=' + PROJECT, { headers: H });
  const createdNow = (convsAfterAll.conversations || []).map((x) => x.id).filter((id) => !convIdsBefore.has(id));
  const cleaned = [];
  for (const id of createdNow) {
    await fetch(base + '/ai/conversations/' + id, { method: 'DELETE', headers: H });
    cleaned.push(id);
  }
  O('cleanup-forks', cleaned);
  fs.writeFileSync(path.join(__dirname, 'ui156-uiattch-verdict.json'), JSON.stringify(out, null, 2));

  const allPass = Object.values(verdict).every(Boolean);
  if (!allPass) console.error('VERDICT PARTIAL (see verdict fields)');
  else console.log('UI-156 + UI-ATTCH-001 ③④ PASS');
  process.exit(allPass ? 0 : 2);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
