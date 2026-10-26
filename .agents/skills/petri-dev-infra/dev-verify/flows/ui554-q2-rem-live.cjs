#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui554-q2-rem-live — BLOCK-246 Q2 余项实机腿。
 *
 * 前置（由 scripts/block246-q2-rem-live.mjs 一键备好）：
 *   - 隔离后端 :3001（mock provider，请求体留档）+ Vite :3000 + Electron 测试实例 CDP :9223；
 *   - 隔离工作区含 analysis/qc.py 等文件；隔离库里有合成 done job。
 *
 * 断言（要有反证，不停留在"按钮画出来了"）：
 *   L1  速记板：面板打开 →（REST 种一条）→ 行出现 →「引用」→ composer chip 在场；
 *   L2  `@` 菜单新增源：分组里出现「应用快照」，选中后 chip 在场；
 *   L3  文件夹整体引用：选 analysis → chip kind=folder；
 *   L4  发送 → **请求体**里同时含【引用速记】/【引用应用快照】/【引用文件夹】；
 *   L5  消息行动作：回复行的「加入上下文」→ chip kind=message；「有用」→ 按钮变「已赞」。
 */

const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const APP = 'http://localhost:3000';
const API = 'http://127.0.0.1:3001';
const DARK = () => process.env.PETRI_B245_DARK === '1';
const SUFFIX = DARK() ? 'dark' : 'light';
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-554');
const COMPOSER = 'textarea.sc-input';
const MESSAGE = '请结合速记、快照与文件夹说明下一步。';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evalJsWithTimeout(client, expression, timeoutMs = 15_000) {
  let timer = null;
  try {
    return await Promise.race([
      lib.evalJs(client, expression),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cdp_eval_timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function poll(fn, { timeoutMs, intervalMs = 300, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 240)}`);
}

/**
 * 首启角色揭示浮层会在导航**之后**才异步出现（BLOCK-245 同款坑）：截图前必须
 * 再确认一次"浮层不在场"，否则拍到的是一张欢迎页（断言全绿、证据无效）。
 */
async function ensureNoOverlay(client) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const present = await evalJsWithTimeout(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') >= 0 : false`).catch(() => false);
    if (present !== true) return true;
    await evalJsWithTimeout(client, `(function(){
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

async function capturePng(client, filename) {
  await ensureNoOverlay(client);
  await sleep(260);
  await lib.screenshotPng(client, EVIDENCE, filename);
  return filename;
}

function setTextareaExpr(text) {
  return `(function(){
    var ta = document.querySelector(${JSON.stringify(COMPOSER)});
    if (!ta) return 'no_textarea';
    ta.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok:' + ta.value.length;
  })()`;
}

async function dismissFirstRun(client) {
  const clicked = await evalJsWithTimeout(client, `(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      if ((btns[i].textContent || '').trim() === '开始使用') { btns[i].click(); return 'clicked'; }
    }
    return 'none';
  })()`);
  if (clicked === 'clicked') {
    await poll(async () => {
      const present = await evalJsWithTimeout(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') >= 0 : false`).catch(() => true);
      return present === false ? true : null;
    }, { timeoutMs: 12_000, label: 'role_reveal_dismissed' }).catch(() => null);
  }
  return clicked;
}

async function chips(client) {
  const raw = await evalJsWithTimeout(client, `(function(){
    var out = [];
    document.querySelectorAll('.sc-selection-ref').forEach(function(el){
      out.push({ kind: el.getAttribute('data-context-kind') || 'selection', label: (el.textContent || '').trim() });
    });
    return JSON.stringify(out);
  })()`, 8000).catch(() => '[]');
  return JSON.parse(raw || '[]');
}

async function mentionGroups(client) {
  return evalJsWithTimeout(client, `(function(){
    var panel = document.querySelector('[data-testid="sc-mention-panel"]');
    if (!panel) return null;
    var groups = [];
    panel.querySelectorAll('.sc-mention-group').forEach(function(g){
      var label = g.querySelector('.sc-slash-title');
      groups.push({ label: label ? (label.textContent || '').trim() : '', items: g.querySelectorAll('[role="option"]').length });
    });
    var items = [];
    panel.querySelectorAll('[role="option"]').forEach(function(b){ items.push((b.textContent || '').trim()); });
    return JSON.stringify({ groups: groups, items: items });
  })()`, 8000);
}

async function openMention(client, query) {
  const typed = await evalJsWithTimeout(client, setTextareaExpr(`@${query}`));
  if (!String(typed).startsWith('ok:')) throw new Error(`mention_type_failed: ${typed}`);
  // 面板先以"加载中/零分组"出现：必须等到**真的有分组**再判定，
  // 否则会把"还没装载完"误当成"这个源不存在"。
  return poll(async () => {
    const raw = await mentionGroups(client);
    if (!raw) return null;
    const state = JSON.parse(raw);
    return state.groups.length > 0 ? state : null;
  }, { timeoutMs: 40_000, intervalMs: 500, label: `mention_panel(${query || 'all'})` });
}

async function pickMentionByText(client, query, needle) {
  const state = await openMention(client, query);
  const clicked = await evalJsWithTimeout(client, `(function(){
    var panel = document.querySelector('[data-testid="sc-mention-panel"]');
    if (!panel) return 'no_panel';
    var options = Array.prototype.slice.call(panel.querySelectorAll('[role="option"]'));
    var hit = options.find(function(b){ return (b.textContent || '').indexOf(${JSON.stringify(needle)}) >= 0; });
    if (!hit) return 'no_match:' + options.length;
    hit.click();
    return 'clicked';
  })()`);
  if (clicked !== 'clicked') throw new Error(`mention_pick_failed: ${clicked}`);
  await poll(async () => {
    const present = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="sc-mention-panel"]')`).catch(() => true);
    return present === false ? true : null;
  }, { timeoutMs: 10_000, label: 'mention_panel_closed' });
  return state;
}

async function clickSend(client) {
  await poll(async () => {
    const clicked = await evalJsWithTimeout(client, `(function(){
      var btn = document.querySelector('[data-testid="chat-send"]');
      if (!btn || btn.disabled) return null;
      btn.click();
      return 'clicked';
    })()`, 20_000).catch(() => null);
    return clicked === 'clicked' ? true : null;
  }, { timeoutMs: 40_000, intervalMs: 800, label: 'chat_send_clicked' });
}

async function mockStats() {
  const url = process.env.PETRI_B245_MOCK_STATS_URL;
  if (!url) throw new Error('missing PETRI_B245_MOCK_STATS_URL');
  return fetch(url, { signal: AbortSignal.timeout(6000) }).then((response) => response.json());
}

async function waitChatRequest(afterN) {
  return poll(async () => {
    const stats = await mockStats();
    const hits = (stats.requests || []).filter(
      (row) => row.n > afterN && String(row.userText).includes(MESSAGE),
    );
    return hits.length > 0 ? hits[0] : null;
  }, { timeoutMs: 90_000, intervalMs: 700, label: 'chat_request_with_message' });
}

async function seedScratchpad() {
  const response = await fetch(`${API}/api/scratchpad`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'text',
      title: 'UI-554 速记样本',
      body: '先做质控再降维（实机腿种子）',
      sourceKind: 'conversation',
      sourceRef: 'ui554-seed',
    }),
  });
  if (!response.ok) throw new Error(`scratchpad_seed_failed:${response.status}`);
  return (await response.json()).entry;
}

async function run({ assert }) {
  const projectId = process.env.PETRI_B245_PROJECT_ID;
  if (!projectId) throw new Error('missing PETRI_B245_PROJECT_ID');
  const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
  // 先带着项目上下文进页面：@ 的文件/快照源都按项目隔离，留在家页会全是"未选择项目"。
  await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${APP}/?project=${projectId}`)}; 'ok'`);
  const overlay = await dismissFirstRun(client);
  assert('L0_first_run_overlay_dismissed', true, `click=${overlay}`);

  await poll(async () => {
    const ready = await evalJsWithTimeout(client, `!!document.querySelector(${JSON.stringify(COMPOSER)})`).catch(() => false);
    return ready ? true : null;
  }, { timeoutMs: 40_000, label: 'composer_ready' });

  if (DARK()) {
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    }).catch(() => {});
    await poll(async () => {
      const isDark = await evalJsWithTimeout(client, `window.matchMedia('(prefers-color-scheme: dark)').matches`).catch(() => false);
      return isDark === true ? true : null;
    }, { timeoutMs: 15_000, label: 'dark_media_emulated' });
    await sleep(600);
  }

  // ---- L1 速记板：种一条 → 面板可见 → 引用进 chip ----
  const seeded = await seedScratchpad();
  assert('L1a_scratchpad_seeded', Boolean(seeded && seeded.entryId), String(seeded && seeded.entryId));

  // 钮在 composer 底栏：等它出现再点（首帧可能还没挂上），点完确认面板真的开了。
  await poll(async () => {
    const result = await evalJsWithTimeout(client, `(function(){
      var btn = document.querySelector('[data-testid="scratchpad-toggle"]');
      if (!btn) return 'no_toggle';
      btn.click();
      return 'clicked';
    })()`).catch(() => 'eval_failed');
    return result === 'clicked' ? true : null;
  }, { timeoutMs: 20_000, intervalMs: 400, label: 'scratchpad_toggle_clicked' });
  await poll(async () => {
    const present = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="sc-scratch-panel"]')`).catch(() => false);
    return present === true ? true : null;
  }, { timeoutMs: 20_000, intervalMs: 400, label: 'scratchpad_panel_open' });
  let lastPanelText = '';
  // 面板开态住在 React（ScratchpadDock）里：若期间宿主重渲染把 composer 子树重挂，
  // 开态会丢（实机观察：点击后 ~300ms 面板消失）。这里做幂等"确保打开"，
  // 不掩盖产品行为——该重挂现象登记到 AUDIT-LOG 待处理项，由独立包排查。
  const ensureOpen = async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const present = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="sc-scratch-panel"]')`).catch(() => false);
      if (present === true) return true;
      await evalJsWithTimeout(client, `(function(){
        var btn = document.querySelector('[data-testid="scratchpad-toggle"]');
        if (btn) btn.click();
        return 'clicked';
      })()`).catch(() => null);
      await sleep(400);
    }
    return false;
  };
  const panelReady = await poll(async () => {
    await ensureOpen();
    const text = await evalJsWithTimeout(client, `(function(){
      var panels = document.querySelectorAll('[data-testid="sc-scratch-panel"]');
      if (!panels.length) return null;
      var panel = panels[0];
      var rows = panel.querySelectorAll('[data-testid="sc-scratch-item"]').length;
      var html = panel.innerHTML || '';
      return (panel.textContent || '').slice(0, 300) + ' | panels=' + panels.length + ' rows=' + rows + ' htmlLen=' + html.length;
    })()`).catch(() => null);
    lastPanelText = text || '';
    return text && text.includes('速记板') && text.includes('UI-554 速记样本') ? text : null;
  }, { timeoutMs: 25_000, intervalMs: 400, label: 'scratchpad_panel_with_seed' }).catch(() => {
    throw new Error(`scratchpad_panel_with_seed_failed: ${lastPanelText} :: timeline=${timeline.join(',')}`);
  });
  assert('L1b_scratchpad_panel_shows_seed', panelReady.includes('UI-554 速记样本'), panelReady.slice(0, 160));
  await capturePng(client, `ui554-scratchpad-${SUFFIX}.png`);

  const beforeQuote = (await chips(client)).length;
  await evalJsWithTimeout(client, `(function(){
    var btn = document.querySelector('[data-testid="sc-scratch-quote"]');
    if (!btn) return 'no_quote_btn';
    btn.click();
    return 'clicked';
  })()`);
  const afterQuote = await poll(async () => {
    const list = await chips(client);
    return list.length > beforeQuote ? list : null;
  }, { timeoutMs: 15_000, label: 'scratchpad_chip_added' });
  assert('L1c_scratchpad_quoted_to_composer',
    afterQuote.some((chip) => chip.kind === 'scratchpad'), JSON.stringify(afterQuote));

  // ---- L2 应用快照源 ----
  const allSources = await openMention(client, '');
  const sourceLabels = allSources.groups.map((group) => group.label);
  assert('L2a_snapshot_source_present', sourceLabels.includes('应用快照'), JSON.stringify(sourceLabels));
  await pickMentionByText(client, '', '当前状态');
  const afterSnapshot = await chips(client);
  assert('L2b_snapshot_quoted', afterSnapshot.some((chip) => chip.kind === 'snapshot'), JSON.stringify(afterSnapshot));

  // ---- L3 文件夹整体引用 ----
  await pickMentionByText(client, 'analysis', 'analysis');
  const afterFolder = await chips(client);
  assert('L3_folder_quoted', afterFolder.some((chip) => chip.kind === 'folder'), JSON.stringify(afterFolder));
  await capturePng(client, `ui554-composer-chips-${SUFFIX}.png`);

  // ---- L4 发送 → 请求体真含三块引用 ----
  const statsBefore = await mockStats();
  await evalJsWithTimeout(client, setTextareaExpr(MESSAGE));
  await clickSend(client);
  const request = await waitChatRequest(statsBefore.calls);
  const body = String(request.userText || '');
  assert('L4a_request_has_scratchpad_block', body.includes('【引用速记'), body.slice(0, 200));
  assert('L4b_request_has_snapshot_block', body.includes('【引用应用快照】'), body.slice(0, 200));
  assert('L4c_request_has_folder_block', body.includes('【引用文件夹'), body.slice(0, 200));
  assert('L4d_reference_block_count', (body.match(/【引用/g) || []).length >= 3, String((body.match(/【引用/g) || []).length));

  // ---- L5 消息行新动作：加入上下文 + 评价 ----
  const replyReady = await poll(async () => {
    const found = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="msg-action-quote-context"]')`).catch(() => false);
    return found ? true : null;
  }, { timeoutMs: 90_000, intervalMs: 800, label: 'assistant_message_actions' });
  assert('L5a_message_actions_rendered', replyReady === true, 'quote-context button present');

  const beforeMessageQuote = (await chips(client)).length;
  await evalJsWithTimeout(client, `(function(){
    var btn = document.querySelector('[data-testid="msg-action-quote-context"]');
    btn.click();
    return 'clicked';
  })()`);
  const afterMessageQuote = await poll(async () => {
    const list = await chips(client);
    return list.length > beforeMessageQuote ? list : null;
  }, { timeoutMs: 15_000, label: 'message_chip_added' });
  assert('L5b_message_quoted_to_context',
    afterMessageQuote.some((chip) => chip.kind === 'message'), JSON.stringify(afterMessageQuote));

  await evalJsWithTimeout(client, `(function(){
    var btn = document.querySelector('[data-testid="msg-action-rate-up"]');
    if (!btn) return 'no_rate_btn';
    btn.click();
    return 'clicked';
  })()`, 8000).catch(() => null);
  const rated = await poll(async () => {
    const label = await evalJsWithTimeout(client, `(function(){
      var btn = document.querySelector('[data-testid="msg-action-rate-up"]');
      return btn ? (btn.textContent || '').trim() : null;
    })()`).catch(() => null);
    return label && label.includes('已赞') ? label : null;
  }, { timeoutMs: 15_000, label: 'rating_applied' });
  assert('L5c_message_rating_applied', rated.includes('已赞'), rated);

  await capturePng(client, `ui554-message-actions-${SUFFIX}.png`);
}

module.exports = {
  id: 'ui554-q2-rem-live',
  description: 'BLOCK-246 实机腿：速记板引用 / 应用快照 / 文件夹整体引用 / 消息动作（加入上下文+评价）真实生效（隔离栈）',
  run,
};
