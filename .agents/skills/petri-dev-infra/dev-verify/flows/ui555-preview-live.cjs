#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui555-preview-live — BLOCK-251 UI-555 实机腿。
 *
 * 前置（由 scripts/block251-ui555-live.mjs 一键备好）：
 *   - 隔离后端 :3001（mock provider，请求体留档）+ Vite :3000 + Electron 测试实例 CDP :9223（离屏）；
 *   - 工作区含 preview-note.md；隔离库里有一条合成 draft 计划（两步，含子智能体步骤）。
 *
 * 断言链（反证优先，不停留在"按钮画出来了"）：
 *   S1 文件预览打开且正文就绪；
 *   S2 真实 DOM Range 划词 → 动作条可见（5 项）；
 *   S3 批注禁用且给出理由；
 *   S4 「加入对话」→ composer 引用 chip；
 *   S5 「复制」→ 捕获文本与选区一致（离屏写系统剪贴板能力如实标注）；
 *   S6 「加入速记」→ REST 速记条目（sourceKind=selection / sourceRef=文件 / 正文含选区）；
 *   S7 「侧聊提问」→ 悬挂会话面打开；
 *   S8 发送 → mock provider 请求体含 `【引用 preview-note.md】` + 原文；
 *   P1 计划批准卡可见（标题/步骤/反馈输入）；
 *   P2 调整意见 → mock provider 请求体含意见 + planId（不是只收起卡片）；
 *   P3 计划仍 draft（不误批准）；
 *   P4 回合结束后批准卡重新出现（draft 未被吞）；
 *   I1 拖入两张真 PNG → 两张缩略图；
 *   I2 预览 1/2 → I3 下一张 2/2 → ← 键回 1/2；
 *   I4 缩放 200%/50% 标签与 transform 同步；
 *   I5 保存锚点带原文件名与图片源；
 *   I6 移除附件后缩略图清空。
 */

const path = require('node:path');
const fs = require('node:fs');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const APP = 'http://localhost:3000';
const API = 'http://127.0.0.1:3001';
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-555');
const NEEDLE = '划词动作实机样本第一句。';
const SEND_MESSAGE = '请解读我选中的这段，并说明下一步。';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function isDark() { return process.env.PETRI_B251_DARK === '1'; }
function suffix() { return isDark() ? 'dark' : 'light'; }

async function ev(client, expression, timeoutMs = 20_000) {
  return lib.evalJs(client, expression, timeoutMs);
}

async function poll(fn, { timeoutMs, intervalMs = 300, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 300)} :: ${lastError ? lastError.message : ''}`);
}

/** 首启角色揭示浮层在导航之后才异步出现（BLOCK-245/246/247 同款坑）。 */
async function ensureNoOverlay(client) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const present = await ev(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') >= 0 : false`).catch(() => false);
    if (present !== true) return true;
    await ev(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '开始使用') { btns[i].click(); return 'clicked'; }
      }
      return 'none';
    })()`).catch(() => null);
    await sleep(400);
  }
  return false;
}

const screenshots = {};
async function capturePng(client, filename) {
  await ensureNoOverlay(client);
  await sleep(200);
  try {
    const file = await Promise.race([
      lib.screenshotPng(client, EVIDENCE, filename),
      new Promise((_, reject) => setTimeout(() => reject(new Error('screenshot_timeout(offscreen)')), 8_000)),
    ]);
    screenshots[filename] = file;
  } catch (error) {
    screenshots[filename] = `unavailable:${error.message}`;
  }
}

function setTextareaExpr(text) {
  return `(function(){
    var ta = document.querySelector('textarea.sc-input');
    if (!ta) return 'no_textarea';
    ta.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok:' + ta.value.length;
  })()`;
}

/**
 * 在文件预览正文里用真实 DOM Range 选中 needle，并在预览容器上派发 mouseup。
 * markdown 渲染视图走 window.getSelection 分支（无行号，引用头就是路径）。
 */
function selectNeedleExpr(needle) {
  return `(function(){
    var panel = document.querySelector('[role="tabpanel"][data-file-preview-path="preview-note.md"]')
      || document.querySelector('[role="tabpanel"][aria-label="preview-note.md"]');
    if (!panel) return 'no_panel';
    var body = panel.querySelector('[class*="workspacePreviewBody"]');
    if (!body) return 'no_body';
    var needle = ${JSON.stringify(needle)};
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    var node = null;
    while (walker.nextNode()) {
      var value = walker.currentNode.nodeValue || '';
      if (value.indexOf(needle) >= 0) { node = walker.currentNode; break; }
    }
    if (!node) return 'no_text:' + (body.textContent || '').slice(0, 120);
    var idx = node.nodeValue.indexOf(needle);
    var range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + needle.length);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    return 'selected:' + selection.toString();
  })()`;
}

async function selectNeedle(client) {
  const result = await ev(client, selectNeedleExpr(NEEDLE));
  if (!String(result).startsWith('selected:')) throw new Error(`select_failed:${result}`);
  await poll(async () => {
    const present = await ev(client, `!!document.querySelector('[data-testid="sc-selection-bar"]')`);
    return present ? true : null;
  }, { timeoutMs: 12_000, label: 'selection_bar' });
  return result;
}

async function clickAction(client, id) {
  const result = await ev(client, `(function(){
    var btn = document.querySelector('[data-testid="sc-selection-action-${id}"]');
    if (!btn) return 'no_button';
    btn.click();
    return 'clicked';
  })()`);
  if (result !== 'clicked') throw new Error(`action_click_failed:${id}:${result}`);
  await poll(async () => {
    const present = await ev(client, `!!document.querySelector('[data-testid="sc-selection-bar"]')`).catch(() => true);
    return present === false ? true : null;
  }, { timeoutMs: 8_000, label: `selection_bar_closed_${id}` }).catch(() => null);
}

async function selectionChips(client) {
  const raw = await ev(client, `JSON.stringify(Array.prototype.slice.call(
    document.querySelectorAll('.sc-selection-refs .sc-selection-ref')
  ).map(function(el){ return { text: (el.textContent || '').trim(), title: el.getAttribute('title') || '' }; }))`);
  return JSON.parse(raw || '[]');
}

async function listScratchpad(query) {
  const response = await fetch(`${API}/api/scratchpad?query=${encodeURIComponent(query)}&limit=20`, {
    signal: AbortSignal.timeout(6000),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, entries: Array.isArray(body && body.entries) ? body.entries : [] };
}

async function getPlan(planId) {
  const response = await fetch(`${API}/api/ai/plans/${encodeURIComponent(planId)}`, {
    headers: { Authorization: 'Bearer desktop-local' },
    signal: AbortSignal.timeout(6000),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, plan: body && body.plan };
}

async function mockStats() {
  const url = process.env.PETRI_B251_MOCK_STATS_URL;
  if (!url) throw new Error('missing PETRI_B251_MOCK_STATS_URL');
  return fetch(url, { signal: AbortSignal.timeout(6000) }).then((response) => response.json());
}

async function waitRequest(afterN, predicate) {
  return poll(async () => {
    const stats = await mockStats();
    const hit = (stats.requests || []).find((row) => row.n > afterN && predicate(String(row.userText || '')));
    return hit || null;
  }, { timeoutMs: 90_000, intervalMs: 700, label: 'mock_request' });
}

async function waitStreamEnd(client) {
  await poll(async () => {
    const streaming = await ev(client, `!!document.querySelector('[data-testid="chat-stop"]')`).catch(() => false);
    return streaming ? null : true;
  }, { timeoutMs: 90_000, intervalMs: 500, label: 'stream_end' });
}

async function clickSend(client) {
  const result = await ev(client, `(function(){
    var btn = document.querySelector('[data-testid="chat-send"]');
    if (!btn || btn.disabled) return 'unavailable';
    btn.click();
    return 'clicked';
  })()`);
  if (result !== 'clicked') throw new Error(`send_click_failed:${result}`);
}

async function run({ assert }) {
  const projectId = process.env.PETRI_B251_PROJECT_ID;
  const planId = process.env.PETRI_B251_PLAN_ID;
  const planTitle = process.env.PETRI_B251_PLAN_TITLE || '';
  const feedback = process.env.PETRI_B251_FEEDBACK || '';
  if (!projectId) throw new Error('missing PETRI_B251_PROJECT_ID');
  if (!planId) throw new Error('missing PETRI_B251_PLAN_ID');
  if (!feedback) throw new Error('missing PETRI_B251_FEEDBACK');
  fs.mkdirSync(EVIDENCE, { recursive: true });

  const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
  await ev(client, `location.href = ${JSON.stringify(`${APP}/project/${projectId}`)}; 'ok'`);
  await sleep(800);
  const overlay = await ensureNoOverlay(client);
  assert('S0_first_run_overlay_dismissed', true, `dismissed=${overlay}`);

  await poll(async () => {
    const ready = await ev(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
    return ready ? true : null;
  }, { timeoutMs: 45_000, label: 'composer_ready' });

  if (isDark()) {
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    }).catch(() => {});
    await poll(async () => {
      const dark = await ev(client, `window.matchMedia('(prefers-color-scheme: dark)').matches`).catch(() => false);
      return dark === true ? true : null;
    }, { timeoutMs: 15_000, label: 'dark_media_emulated' });
    await sleep(500);
  }

  // ---------- 文件预览 + 划词动作 ----------
  await poll(async () => {
    const clicked = await ev(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      var hit = btns.find(function(btn){ return (btn.textContent || '').trim() === '文件'; });
      if (!hit) return 'no_tab';
      hit.click();
      return 'clicked';
    })()`).catch(() => 'eval_failed');
    return clicked === 'clicked' ? true : null;
  }, { timeoutMs: 25_000, label: 'files_tab' });

  await poll(async () => {
    const row = await ev(client, `!!document.querySelector('button[data-file-path="preview-note.md"]')`).catch(() => false);
    return row ? true : null;
  }, { timeoutMs: 30_000, label: 'tree_file_row' });

  const opened = await ev(client, `(function(){
    var row = document.querySelector('button[data-file-path="preview-note.md"]');
    if (!row) return 'no_row';
    row.click();
    return 'clicked';
  })()`);
  if (opened !== 'clicked') throw new Error(`file_open_failed:${opened}`);

  const previewReady = await poll(async () => {
    const text = await ev(client, `(function(){
      var panel = document.querySelector('[role="tabpanel"][data-file-preview-path="preview-note.md"]');
      if (!panel) return null;
      var body = panel.querySelector('[class*="workspacePreviewBody"]');
      return body ? (body.textContent || '').slice(0, 400) : null;
    })()`).catch(() => null);
    return text && text.indexOf(NEEDLE) >= 0 ? text : null;
  }, { timeoutMs: 45_000, label: 'preview_text_ready' });
  assert('S1_file_preview_ready', previewReady.includes(NEEDLE), previewReady.slice(0, 160));

  await selectNeedle(client);
  const actionBar = JSON.parse(await ev(client, `JSON.stringify({
    bar: !!document.querySelector('[data-testid="sc-selection-bar"]'),
    actions: Array.prototype.slice.call(document.querySelectorAll('[data-testid^="sc-selection-action-"]')).map(function(el){
      return { id: el.getAttribute('data-testid').replace('sc-selection-action-', ''), label: (el.textContent || '').trim(), disabled: el.disabled, hint: el.getAttribute('title') || '' };
    })
  })`));
  assert('S2_selection_bar_visible',
    actionBar.bar === true && actionBar.actions.length === 5
      && ['copy', 'quote', 'scratchpad', 'side-chat', 'annotate'].every((id) => actionBar.actions.some((a) => a.id === id)),
    JSON.stringify(actionBar.actions.map((a) => `${a.id}${a.disabled ? '(disabled)' : ''}`)));
  const annotate = actionBar.actions.find((a) => a.id === 'annotate');
  assert('S3_annotation_disabled_reason',
    Boolean(annotate && annotate.disabled && annotate.hint.includes('文本批注暂不支持')),
    JSON.stringify(annotate));
  await capturePng(client, `ui555-selection-bar-${suffix()}.png`);

  // S4 加入对话 → chip
  await clickAction(client, 'quote');
  const chips = await poll(async () => {
    const list = await selectionChips(client);
    return list.length > 0 ? list : null;
  }, { timeoutMs: 15_000, label: 'selection_chip' });
  assert('S4_quote_chip_created',
    chips.some((chip) => chip.title.startsWith('preview-note.md') && chip.title.includes(NEEDLE)),
    JSON.stringify(chips.map((chip) => chip.title.split('\n')[0])));

  // S5 复制 → 捕获载荷（离屏窗口可能拿不到真实系统剪贴板，如实标注）
  const patch = await ev(client, `(function(){
    if (window.__ui555ClipPatched) return 'already';
    window.__ui555ClipPatched = true;
    window.__ui555Copied = null;
    window.__ui555ClipReal = null;
    var stub = function(text){
      window.__ui555Copied = text;
      window.__ui555ClipReal = false;
      return Promise.resolve();
    };
    try {
      var clip = navigator.clipboard;
      if (!clip) {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: stub } });
        return 'patched:stub_no_clipboard';
      }
      var real = typeof clip.writeText === 'function' ? clip.writeText.bind(clip) : null;
      Object.defineProperty(clip, 'writeText', { configurable: true, value: function(text){
        window.__ui555Copied = text;
        if (!real) { window.__ui555ClipReal = false; return Promise.resolve(); }
        return real(text).then(function(){ window.__ui555ClipReal = true; }, function(){ window.__ui555ClipReal = false; });
      }});
      return 'patched:' + (real ? 'real' : 'stub_no_write');
    } catch (error) {
      return 'patch_failed:' + (error && error.message ? error.message : String(error));
    }
  })()`);
  await selectNeedle(client);
  await clickAction(client, 'copy');
  const copied = await poll(async () => {
    const captured = await ev(client, `window.__ui555Copied`);
    return typeof captured === 'string' && captured.length > 0 ? captured : null;
  }, { timeoutMs: 12_000, label: 'clipboard_capture' });
  const clipReal = await ev(client, `window.__ui555ClipReal`);
  assert('S5_copy_payload', copied === NEEDLE, `${String(patch)} clipboardReal=${String(clipReal)} text=${JSON.stringify(copied).slice(0, 120)}`);

  // S6 加入速记 → REST
  const noticeBefore = await selectionChips(client);
  await selectNeedle(client);
  await clickAction(client, 'scratchpad');
  const scratchNotice = await poll(async () => {
    const text = await ev(client, `(function(){
      var el = document.querySelector('[data-testid="preview-selection-notice"]');
      return el ? (el.textContent || '').trim() : null;
    })()`).catch(() => null);
    return text && text.includes('已存入速记板') ? text : null;
  }, { timeoutMs: 15_000, label: 'scratchpad_notice' });
  const scratch = await listScratchpad(NEEDLE);
  const scratchHit = scratch.entries.find((entry) => entry
    && entry.sourceKind === 'selection'
    && String(entry.sourceRef || '').includes('preview-note.md')
    && String(entry.body || '').includes(NEEDLE));
  assert('S6_scratchpad_persisted', Boolean(scratchHit),
    `notice=${scratchNotice} status=${scratch.status} entries=${scratch.entries.length} hit=${scratchHit ? scratchHit.entryId || scratchHit.id : 'none'} chipsBefore=${noticeBefore.length}`);

  // S7 侧聊提问 → 悬挂会话面
  await selectNeedle(client);
  await clickAction(client, 'side-chat');
  await poll(async () => {
    const open = await ev(client, `!!document.querySelector('[data-testid="side-chat-dock"]')`).catch(() => false);
    return open ? true : null;
  }, { timeoutMs: 20_000, label: 'side_chat_dock' });
  assert('S7_side_chat_opened', true, 'side-chat-dock visible');
  await ev(client, `(function(){
    var btn = document.querySelector('button[aria-label="收起会话面板"]');
    if (btn) { btn.click(); return 'clicked'; }
    return 'none';
  })()`).catch(() => null);
  await poll(async () => {
    const open = await ev(client, `!!document.querySelector('[data-testid="side-chat-dock"]')`).catch(() => true);
    return open === false ? true : null;
  }, { timeoutMs: 12_000, label: 'side_chat_closed' }).catch(() => null);

  // S8 发送 → 请求体含引用块与原文
  const statsBefore = await mockStats();
  await ev(client, setTextareaExpr(SEND_MESSAGE));
  await clickSend(client);
  const quoteRequest = await waitRequest(statsBefore.calls, (text) => text.includes('【引用 preview-note.md】') && text.includes(NEEDLE));
  assert('S8_selection_quote_in_request', Boolean(quoteRequest),
    `n=${quoteRequest && quoteRequest.n} head=${String(quoteRequest && quoteRequest.userText).slice(0, 200)}`);
  await waitStreamEnd(client);

  // ---------- 计划反馈 ----------
  const planCard = await poll(async () => {
    const info = await ev(client, `(function(){
      var input = document.querySelector('[data-testid="plan-feedback-input"]');
      if (!input) return null;
      var card = input.closest('.sc-plan-approval');
      return card ? (card.textContent || '').slice(0, 400) : null;
    })()`).catch(() => null);
    return info ? info : null;
  }, { timeoutMs: 45_000, label: 'plan_card' });
  assert('P1_plan_card_visible',
    planCard.includes(planTitle) && planCard.includes('读取工作区并质控') && planCard.includes('子智能体'),
    planCard.slice(0, 200));

  const statsBeforePlan = await mockStats();
  // 用 CDP 真实输入而不是原型 setter：同时验证受控 textarea 的 onChange 真的把它写进 React state。
  await ev(client, `(function(){
    var input = document.querySelector('[data-testid="plan-feedback-input"]');
    if (!input) return 'no_input';
    input.focus();
    input.select();
    return 'focused';
  })()`);
  await client.send('Input.insertText', { text: feedback }).catch(() => null);
  const feedbackValue = await ev(client, `(function(){
    var input = document.querySelector('[data-testid="plan-feedback-input"]');
    return input ? input.value : null;
  })()`);
  if (feedbackValue !== feedback) throw new Error(`feedback_set_failed:${JSON.stringify(feedbackValue)}`);
  // 诊断面：记录计划 approve 请求的真实状态码（没有模型请求时用它区分「API 拒绝」与「send 没发」）。
  await ev(client, `(function(){
    if (window.__ui555PlanCalls) return 'already';
    window.__ui555PlanCalls = [];
    var orig = window.fetch;
    window.fetch = function(input, init){
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var rec = { url: url, method: (init && init.method) || 'GET' };
      var watching = url.indexOf('/ai/plans') >= 0;
      if (watching) window.__ui555PlanCalls.push(rec);
      var p = orig.apply(this, arguments);
      if (watching) p.then(function(r){ rec.status = r.status; }, function(e){ rec.error = String(e); });
      return p;
    };
    return 'instrumented';
  })()`);
  const keepClicked = await ev(client, `(function(){
    var btn = document.querySelector('[data-testid="plan-keep-planning"]');
    if (!btn) return 'no_button';
    btn.click();
    return 'clicked';
  })()`);
  if (keepClicked !== 'clicked') throw new Error(`keep_planning_click_failed:${keepClicked}`);
  let planRequest = null;
  try {
    planRequest = await waitRequest(statsBeforePlan.calls, (text) => text.includes(feedback) && text.includes(planId));
  } catch (error) {
    const diag = await ev(client, `JSON.stringify({
      planCalls: window.__ui555PlanCalls || [],
      card: !!document.querySelector('.sc-plan-approval'),
      input: (function(){ var el = document.querySelector('[data-testid="plan-feedback-input"]'); return el ? el.value : null; })(),
      notice: (function(){ var el = document.querySelector('.sc-attachment-notice'); return el ? el.textContent : null; })()
    })`).catch((e) => `diag_failed:${e.message}`);
    const stats = await mockStats().catch(() => null);
    throw new Error(`${error.message} :: diag=${diag} :: calls=${stats ? stats.calls : 'n/a'} :: last=${JSON.stringify((stats && stats.requests || []).slice(-2)).slice(0, 400)}`);
  }
  assert('P2_plan_feedback_sent_to_model', Boolean(planRequest),
    `n=${planRequest && planRequest.n} head=${String(planRequest && planRequest.userText).slice(0, 220)}`);

  const planAfter = await getPlan(planId);
  assert('P3_plan_still_draft', Boolean(planAfter.plan && planAfter.plan.status === 'draft'),
    `status=${planAfter.status} planStatus=${planAfter.plan && planAfter.plan.status}`);
  await waitStreamEnd(client);
  const cardBack = await poll(async () => {
    const present = await ev(client, `!!document.querySelector('[data-testid="plan-feedback-input"]')`).catch(() => false);
    return present ? true : null;
  }, { timeoutMs: 30_000, label: 'plan_card_refetch' }).catch(() => null);
  assert('P4_plan_card_reappears', Boolean(cardBack), `draft 计划在回合结束后被重新拉取：${String(cardBack)}`);

  // ---------- 图片预览 ----------
  const dropped = await ev(client, `(async function(){
    async function makeFile(color, name) {
      var canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = color; ctx.fillRect(0, 0, 16, 16);
      var blob = await new Promise(function(resolve){ canvas.toBlob(resolve, 'image/png'); });
      return new File([blob], name, { type: 'image/png' });
    }
    var red = await makeFile('#ff0000', 'ui555-red.png');
    var blue = await makeFile('#0000ff', 'ui555-blue.png');
    var dt = new DataTransfer();
    dt.items.add(red);
    dt.items.add(blue);
    var composer = document.querySelector('.sc-composer');
    if (!composer) return 'no_composer';
    composer.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return 'dropped:' + dt.files.length;
  })()`, 25_000);
  if (dropped !== 'dropped:2') throw new Error(`drop_images_failed:${dropped}`);

  try {
    await poll(async () => {
      const count = await ev(client, `document.querySelectorAll('.sc-attachment-preview-btn').length`).catch(() => 0);
      return count === 2 ? true : null;
    }, { timeoutMs: 20_000, label: 'two_attachment_thumbs' });
  } catch (error) {
    const diag = await ev(client, `JSON.stringify({
      notice: (function(){ var el = document.querySelector('.sc-attachment-notice'); return el ? el.textContent : null; })(),
      attachments: document.querySelectorAll('.sc-attachment').length,
      previews: document.querySelectorAll('.sc-attachment-preview-btn').length,
      files: document.querySelectorAll('.sc-attachment-file').length,
      composer: !!document.querySelector('.sc-composer'),
      textarea: !!document.querySelector('textarea.sc-input')
    })`).catch((e) => `diag_failed:${e.message}`);
    const settings = await fetch(`${API}/api/ai/settings`, { headers: { Authorization: 'Bearer desktop-local' } })
      .then((response) => response.json()).catch(() => null);
    const preset = settings && settings.settings && Array.isArray(settings.settings.chat_model_presets)
      ? settings.settings.chat_model_presets[0] : null;
    throw new Error(`${error.message} :: diag=${diag} :: vision=${String(settings && settings.settings && settings.settings.vision_configured)} :: preset=${JSON.stringify(preset).slice(0, 300)}`);
  }
  assert('I1_two_attachments', true, '2 thumbs');

  await ev(client, `(function(){
    var btn = document.querySelector('.sc-attachment-preview-btn');
    if (!btn) return 'no_thumb';
    btn.click();
    return 'clicked';
  })()`);
  const modal1 = await poll(async () => {
    const state = await ev(client, `(function(){
      var overlay = document.querySelector('.sc-preview-overlay');
      if (!overlay) return null;
      var counter = overlay.querySelector('[data-testid="sc-preview-counter"]');
      var name = overlay.querySelector('.sc-preview-filename');
      return JSON.stringify({ counter: counter ? (counter.textContent || '').trim() : '', name: name ? (name.textContent || '').trim() : '' });
    })()`).catch(() => null);
    return state ? JSON.parse(state) : null;
  }, { timeoutMs: 20_000, label: 'image_preview_modal' });
  assert('I2_preview_counter_1_of_2', modal1.counter === '1/2' && modal1.name.includes('ui555-red.png'), JSON.stringify(modal1));
  await capturePng(client, `ui555-image-preview-${suffix()}.png`);

  await ev(client, `document.querySelector('[data-testid="sc-preview-next"]').click(); 'next'`);
  const modal2 = await poll(async () => {
    const state = await ev(client, `(function(){
      var overlay = document.querySelector('.sc-preview-overlay');
      if (!overlay) return null;
      var counter = overlay.querySelector('[data-testid="sc-preview-counter"]');
      var name = overlay.querySelector('.sc-preview-filename');
      return JSON.stringify({ counter: counter ? (counter.textContent || '').trim() : '', name: name ? (name.textContent || '').trim() : '' });
    })()`).catch(() => null);
    return state ? JSON.parse(state) : null;
  }, { timeoutMs: 12_000, label: 'image_preview_next' });
  assert('I3a_nav_next_2_of_2', modal2.counter === '2/2' && modal2.name.includes('ui555-blue.png'), JSON.stringify(modal2));

  await ev(client, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); 'left'`);
  const modal3 = await poll(async () => {
    const state = await ev(client, `(function(){
      var counter = document.querySelector('[data-testid="sc-preview-counter"]');
      var name = document.querySelector('.sc-preview-filename');
      return JSON.stringify({ counter: counter ? (counter.textContent || '').trim() : '', name: name ? (name.textContent || '').trim() : '' });
    })()`).catch(() => null);
    return state ? JSON.parse(state) : null;
  }, { timeoutMs: 12_000, label: 'image_preview_keyboard' });
  assert('I3b_nav_keyboard_1_of_2', modal3.counter === '1/2' && modal3.name.includes('ui555-red.png'), JSON.stringify(modal3));

  async function zoomTo(testId, label, transform) {
    const clicked = await ev(client, `(function(){
      var btn = document.querySelector('[data-testid="${testId}"]');
      if (!btn) return 'no_button';
      btn.click();
      return 'clicked';
    })()`);
    if (clicked !== 'clicked') throw new Error(`zoom_click_failed:${testId}:${clicked}`);
    // 点击与读取必须分两次求值：同一 eval 里读到的还是提交前的旧渲染。
    return poll(async () => {
      const raw = await ev(client, `(function(){
        var label = document.querySelector('.sc-preview-zoom-label');
        var img = document.querySelector('.sc-preview-image');
        return JSON.stringify({ label: label ? (label.textContent || '').trim() : '', transform: img ? (img.style.transform || '') : '' });
      })()`).catch(() => null);
      if (!raw) return null;
      const state = JSON.parse(raw);
      return state.label === label && state.transform === transform ? state : null;
    }, { timeoutMs: 10_000, label: `zoom_${testId}` });
  }
  const zoom200 = await zoomTo('sc-preview-zoom-200', '200%', 'scale(2)');
  assert('I4a_zoom_200', zoom200.label === '200%' && zoom200.transform === 'scale(2)', JSON.stringify(zoom200));
  const zoom50 = await zoomTo('sc-preview-zoom-50', '50%', 'scale(0.5)');
  assert('I4b_zoom_50', zoom50.label === '50%' && zoom50.transform === 'scale(0.5)', JSON.stringify(zoom50));

  const saveAnchor = JSON.parse(await ev(client, `(function(){
    var a = document.querySelector('[data-testid="sc-preview-save"]');
    if (!a) return JSON.stringify(null);
    return JSON.stringify({ download: a.getAttribute('download') || '', href: (a.getAttribute('href') || '').slice(0, 32), text: (a.textContent || '').trim() });
  })()`));
  assert('I5_save_contract', Boolean(saveAnchor && saveAnchor.download === 'ui555-red.png' && saveAnchor.href.startsWith('data:image/png')),
    JSON.stringify(saveAnchor));

  await ev(client, `(function(){
    var btn = document.querySelector('button[aria-label="关闭"]');
    if (btn) btn.click();
    return 'closed';
  })()`);
  await poll(async () => {
    const present = await ev(client, `!!document.querySelector('.sc-preview-overlay')`).catch(() => true);
    return present === false ? true : null;
  }, { timeoutMs: 12_000, label: 'preview_closed' });

  const removed = await ev(client, `(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('.sc-attachment-remove'));
    btns.forEach(function(btn){ btn.click(); });
    return 'removed:' + btns.length;
  })()`);
  await poll(async () => {
    const count = await ev(client, `document.querySelectorAll('.sc-attachment-preview-btn').length`).catch(() => 1);
    return count === 0 ? true : null;
  }, { timeoutMs: 12_000, label: 'attachments_removed' });
  assert('I6_attachments_removed', true, removed);

  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, `ui555-screenshots-${suffix()}.json`), JSON.stringify(screenshots, null, 2));
}

module.exports = {
  id: 'ui555-preview-live',
  description: 'BLOCK-251 实机腿：文件预览划词动作 / 图片预览多图与缩放 / 计划反馈意见上行（隔离栈、离屏、mock provider）',
  run,
};
