#!/usr/bin/env node
'use strict';
/**
 * scripts/block318-context-breakdown-sidechat-drag-live.cjs — BLOCK-318 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例；聊天模型可用。
 * 用法：node scripts/block318-context-breakdown-sidechat-drag-live.cjs
 * 证据：acceptance/block-316/live-context-breakdown-sidechat-drag.json。
 *
 * A UI-622 上下文分类：真实 agent 一轮 → 捕获 petri:token-budget breakdown
 *   （系统提示词/工具定义/对话消息/工具结果/其他系统/输出预留，total=和）；
 *   打开上下文用量面板 → 六类行 + 构成（估算）+ 剩余，无「窗口未知」。
 * B UI-623 侧聊悬浮拖动：宽窗打开侧聊（不再固定列）→ 拖头部移动 →
 *   位置持久化 → 拖出视口被钳制 → 双击复位。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-316');
const RAW_TIMEOUT = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1000); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 25000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(500);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 200));
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 340) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 250)}`);
    return ok === true || ok === 'true';
  };

  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  const client = await lib.connectTarget(target);
  await client.send('Page.enable', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});

  const created = await rest('POST', '/data/projects', { name: 'BLOCK318-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root' });
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await pagePoll(client, `!!document.querySelector('.sc-input')`, { label: 'composer' });
  await sleep(700);

  // 捕获 token_budget 事件（UI-622）
  await evalRetry(client, `(function(){
    window.__block318Budgets = [];
    window.addEventListener('petri:token-budget', function(e){
      try { window.__block318Budgets.push(e.detail); } catch (err) { /* ignore */ }
    });
    return 'listening';
  })()`);

  const prompt = '读取项目根 package.json 并列出 scripts 名称，然后用一句话总结。';
  await evalRetry(client, `(function(){
    var ta = document.querySelector('.sc-input');
    var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(prompt)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return 'sent';
  })()`);
  assert('A0_run_sent', true, '已发送一轮真实 agent 任务');
  await pagePoll(client, `window.__block318Budgets.some(function(b){ return b && b.breakdown; })`, { timeoutMs: 120000, label: 'token budget with breakdown' });
  await sleep(400);
  const budget = JSON.parse(await evalRetry(client, `(function(){
    var list = window.__block318Budgets || [];
    var withBreakdown = list.filter(function(b){ return b && b.breakdown; });
    return JSON.stringify(withBreakdown[withBreakdown.length - 1] || null);
  })()`));
  const bd = budget && budget.breakdown;
  const sum = bd ? bd.systemPrompt + bd.toolDefinitions + bd.messages + bd.toolResults + bd.otherSystem + bd.outputReserve : 0;
  assert('A1_breakdown_six_categories',
    Boolean(bd) && bd.systemPrompt > 0 && bd.toolDefinitions > 0 && bd.messages > 0 && bd.outputReserve > 0,
    bd ? `system=${bd.systemPrompt} tools=${bd.toolDefinitions} messages=${bd.messages} toolResults=${bd.toolResults} otherSystem=${bd.otherSystem} reserve=${bd.outputReserve}` : 'no breakdown');
  assert('A2_breakdown_total_is_sum',
    Boolean(bd) && Math.abs(sum - (bd.total || 0)) <= 0,
    `sum=${sum} total=${bd && bd.total}`);
  assert('A3_context_window_resolved', Boolean(budget) && budget.contextWindow > 0, `window=${budget && budget.contextWindow} pct=${budget && budget.pct}`);

  // 打开上下文用量面板读分类行
  await evalRetry(client, `(function(){
    var btn = document.querySelector('button[title="上下文用量（点击查看详情）"]');
    if (btn) btn.click();
    return btn ? 'opened' : 'no_button';
  })()`);
  await sleep(350);
  const panel = JSON.parse(await evalRetry(client, `(function(){
    var btn = document.querySelector('button[title="上下文用量（点击查看详情）"]');
    var panel = btn ? btn.parentElement : null;
    var text = panel ? panel.textContent : '';
    return JSON.stringify({
      text: text.slice(0, 800),
      hasSystem: text.indexOf('系统提示词') >= 0,
      hasTools: text.indexOf('工具定义') >= 0,
      hasMessages: text.indexOf('对话消息') >= 0,
      hasToolResults: text.indexOf('工具结果') >= 0,
      hasOtherSystem: text.indexOf('其他系统内容') >= 0,
      hasReserve: text.indexOf('输出预留') >= 0,
      hasBreakdownHead: text.indexOf('构成（估算）') >= 0,
      hasFree: text.indexOf('剩余可用') >= 0,
      unknownWindowHint: text.indexOf('模型上下文窗口未知') >= 0,
    });
  })()`));
  assert('A4_panel_six_rows',
    panel.hasSystem && panel.hasTools && panel.hasMessages && panel.hasToolResults && panel.hasOtherSystem && panel.hasReserve,
    JSON.stringify({ system: panel.hasSystem, tools: panel.hasTools, messages: panel.hasMessages, toolResults: panel.hasToolResults, otherSystem: panel.hasOtherSystem, reserve: panel.hasReserve }));
  assert('A5_panel_breakdown_and_free',
    panel.hasBreakdownHead && panel.hasFree && !panel.unknownWindowHint,
    `breakdownHead=${panel.hasBreakdownHead} free=${panel.hasFree} unknownHint=${panel.unknownWindowHint}`);
  // 关面板
  await evalRetry(client, `(function(){
    var btn = document.querySelector('button[title="上下文用量（点击查看详情）"]');
    if (btn) btn.click();
    return 'closed';
  })()`);

  // B 侧聊悬浮拖动（宽窗也应悬浮）
  await evalRetry(client, `(function(){
    window.dispatchEvent(new CustomEvent('petri:side-chat-open'));
    return 'opened';
  })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="side-chat-surface"]')`, { label: 'side chat surface' });
  // 离屏实例的入场动画可能停在首帧（translateX 12px）；与真实用户拖动前的状态对齐。
  await evalRetry(client, `(function(){
    var s = document.querySelector('[data-testid="side-chat-surface"]');
    if (s) s.style.animation = 'none';
    return 'settled';
  })()`);
  await sleep(300);
  const hasHandle = await evalRetry(client, `!!document.querySelector('[data-testid="side-chat-drag-handle"]')`);
  assert('B0_side_chat_floats_with_handle', hasHandle === true, `dragHandle=${hasHandle}`);
  const before = JSON.parse(await evalRetry(client, `(function(){
    var s = document.querySelector('[data-testid="side-chat-surface"]');
    var r = s.getBoundingClientRect();
    return JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), viewport: { width: window.innerWidth, height: window.innerHeight } });
  })()`));
  await evalRetry(client, `(function(){
    var handle = document.querySelector('[data-testid="side-chat-drag-handle"]');
    function pe(type, x, y){
      return new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0, buttons: 1 });
    }
    handle.dispatchEvent(pe('pointerdown', 300, 200));
    handle.dispatchEvent(pe('pointermove', 420, 280));
    handle.dispatchEvent(pe('pointerup', 420, 280));
    return 'dragged';
  })()`);
  await sleep(400);
  const afterDrag = JSON.parse(await evalRetry(client, `(function(){
    var s = document.querySelector('[data-testid="side-chat-surface"]');
    var r = s.getBoundingClientRect();
    var stored = null;
    try { stored = JSON.parse(window.localStorage.getItem('petri:side-chat-float-position') || 'null'); } catch (e) { stored = 'parse_error'; }
    return JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top), stored, position: s.style.position });
  })()`));
  const expectedTop = Math.min(before.top + 80, before.viewport.height - before.height - 8); // 视口钳制生效时取上限
  assert('B1_drag_moves_by_delta',
    Math.abs(afterDrag.left - (before.left + 120)) <= 1
      && Math.abs(afterDrag.top - expectedTop) <= 1
      && afterDrag.position === 'fixed',
    `before=${JSON.stringify(before)} after=${JSON.stringify(afterDrag)} expectedTopClamp=${expectedTop}`);
  assert('B2_position_persisted',
    Boolean(afterDrag.stored)
      && Math.abs(afterDrag.stored.left - afterDrag.left) <= 1
      && Math.abs(afterDrag.stored.top - afterDrag.top) <= 1,
    `stored=${JSON.stringify(afterDrag.stored)} rect=${afterDrag.left},${afterDrag.top}`);

  const clampResult = JSON.parse(await evalRetry(client, `(function(){
    var handle = document.querySelector('[data-testid="side-chat-drag-handle"]');
    var surface = document.querySelector('[data-testid="side-chat-surface"]');
    function pe(type, x, y){
      return new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 8, button: 0, buttons: 1 });
    }
    handle.dispatchEvent(pe('pointerdown', 300, 200));
    handle.dispatchEvent(pe('pointermove', 100000, 100000));
    handle.dispatchEvent(pe('pointerup', 100000, 100000));
    var r = surface.getBoundingClientRect();
    return JSON.stringify({
      left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
  })()`));
  await sleep(300);
  assert('B3_clamped_to_viewport',
    clampResult.left >= 8 && clampResult.top >= 8
      && clampResult.right <= clampResult.viewport.width - 8 + 1
      && clampResult.bottom <= clampResult.viewport.height - 8 + 1,
    JSON.stringify(clampResult));

  const reset = JSON.parse(await evalRetry(client, `(function(){
    var handle = document.querySelector('[data-testid="side-chat-drag-handle"]');
    var surface = document.querySelector('[data-testid="side-chat-surface"]');
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 320, clientY: 220 }));
    return JSON.stringify({
      inlinePosition: surface.style.position,
      computed: getComputedStyle(surface).position,
      stored: window.localStorage.getItem('petri:side-chat-float-position'),
    });
  })()`));
  assert('B4_double_click_resets',
    reset.stored === null && reset.inlinePosition === '' && reset.computed !== 'fixed',
    JSON.stringify(reset));

  // 清理：收起侧聊 + 取消运行
  await evalRetry(client, `(function(){
    var close = [...document.querySelectorAll('button')].find(function(b){ return b.getAttribute('aria-label') === '收起会话面板'; });
    if (close) close.click();
    var stop = document.querySelector('[data-testid="chat-stop"]');
    if (stop) stop.click();
    window.__block318Budgets = [];
    return 'cleanup';
  })()`);
  await sleep(800);

  let screenshot = 'not_attempted';
  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: false }, { timeoutMs: 15000 });
    fs.writeFileSync(path.join(EVIDENCE, 'context-breakdown-sidechat-drag.png'), Buffer.from(shot.data, 'base64'));
    screenshot = 'saved';
  } catch (e) {
    screenshot = 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 100);
  }

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: '上下文用量分类（UI-622）+ 侧聊悬浮拖动（UI-623）',
    budget, panel, before, afterDrag, clampResult, reset,
    notes: { screenshot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-context-breakdown-sidechat-drag.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-318 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block318-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
