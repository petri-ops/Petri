#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: q2rem-stats-drag-live — BLOCK-255（Q2-REM）实机腿。
 *
 * 覆盖：
 *   A0a backend_rest_healthy       隔离后端 REST 可达
 *   A0b app_page_ready             CDP 页面 root 就绪
 *   A0c seeded_conversations       两条种子会话（当前/待拖入）可在 REST 列出
 *   A1 left_panel_conversations    左栏渲染两个会话行（必要时展开项目）
 *   A2 current_conversation_loaded 点击当前会话，种子助手消息渲染
 *   A3 stats_action_present        带 usage 的助手行出现「统计」按钮
 *   A4 stats_panel_usage           面板展示 usage 合计（calls/token/cache/未返回）
 *   A5 stats_honest_without_usage  无 usage 的消息明确「未记录」，不伪造 0
 *   A6 self_drag_rejected          当前会话拖入 composer → 可见提示，不进 chip
 *   A7 target_drag_adds_chip       目标会话拖入 → 唯一 conversation chip + 有界摘要
 *   A8 chip_removable              移除 chip 回空（同一通道可移除）
 *   A9 spa_clean                   收尾回 ?test=1，页面仍可用
 *
 * 诚实边界：
 * - 截图：离屏窗口不产截图，report 标 screenshots=unavailable。
 * - 实时 runUsage 累加由单测覆盖；本 flow 验的是落库 meta.usage 的恢复路径
 *   （历史消息统计）与会话拖放的真实 DOM 链路。
 * - 拖放用同一 DataTransfer 合成 dragstart→dragover→drop（Chromium/Electron 支持）。
 *
 * 前置：隔离栈由 scripts/block255-q2-rem-live.mjs 起（:3001/:3000/:9223 + 临时数据根）。
 */
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const CONVERSATION_MIME = 'application/x-petri-conversation';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rest(method, p) {
  const resp = await fetch(API + p, { method, headers: AUTH });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}

let activeClient = null;

async function ensureClient() {
  if (activeClient) {
    try { await lib.evalJs(activeClient, '1', 4000); return activeClient; } catch { activeClient = null; }
  }
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const chosen = await lib.selectPageTarget(pages, {
    probe: async (candidate) => lib.evalJs(candidate, `!!document.getElementById('root')`).catch(() => false),
  });
  activeClient = await lib.connectTarget(chosen);
  return activeClient;
}

async function evalRetry(_client, expr, tries = 4) {
  let lastErr = null;
  for (let index = 0; index < tries; index += 1) {
    try {
      const live = await ensureClient();
      return await lib.evalJs(live, expr, 8000);
    } catch (error) {
      lastErr = error;
      await sleep(600);
    }
  }
  throw lastErr;
}

async function navigate(url) {
  const withTimeout = (factory, ms) => Promise.race([
    factory(),
    new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('nav_timeout')), ms); }),
  ]);
  const live = await ensureClient();
  try {
    await withTimeout(() => live.send('Page.navigate', { url }), 6000);
  } catch {
    try {
      await withTimeout(
        () => lib.evalJs(live, `setTimeout(function(){ location.href = ${JSON.stringify(url)}; }, 0); 'navigating'`, 3000),
        5000,
      );
    } catch {
      activeClient = null;
    }
  }
  await sleep(1200);
}

async function pagePoll(_client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const budget = Math.min(6000, Math.max(1200, deadline - Date.now()));
    last = await Promise.race([
      evalRetry(null, expr, 1),
      new Promise((resolve) => { setTimeout(() => resolve('poll_budget_exhausted'), budget); }),
    ]).catch((error) => `eval_err:${error.message}`);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(700);
  }
  throw new Error(`page_poll_timeout: ${label} :: ${String(last).slice(0, 200)}`);
}

async function dismissFirstRun() {
  await evalRetry(null, `(function(){
    var btn = document.querySelector('[data-testid="role-reveal-start"]');
    if (btn) { btn.click(); return 'dismissed'; }
    return 'absent';
  })()`).catch(() => 'ignore');
}

function rowExpr(text) {
  return `[...document.querySelectorAll('.sc-msg')].find(function(el){
    return (el.textContent || '').indexOf(${JSON.stringify(text)}) >= 0; })`;
}

async function clickStatsFor(text) {
  return evalRetry(null, `(function(){
    var row = ${rowExpr(text)};
    if (!row) return 'no_row';
    var btn = row.querySelector('[data-testid="msg-action-stats"]');
    if (!btn) return 'no_stats_button';
    btn.click();
    return 'clicked';
  })()`);
}

async function statsPanelText() {
  return evalRetry(null, `(function(){
    var panel = document.querySelector('[data-testid="msg-stats-panel"]');
    return panel ? panel.textContent : '';
  })()`);
}

async function closeStats() {
  return evalRetry(null, `(function(){
    var btn = document.querySelector('[data-testid="msg-stats-close"]');
    if (btn) { btn.click(); return 'closed'; }
    return 'no_close';
  })()`);
}

async function ensureConversationRows(projectName) {
  const visible = await evalRetry(null, `String(document.querySelectorAll('[data-conversation-id]').length >= 2)`);
  if (visible === 'true') return true;
  await evalRetry(null, `(function(){
    var row = [...document.querySelectorAll('[class*="projectTreeRow"]')].find(function(el){
      return (el.textContent || '').indexOf(${JSON.stringify(projectName)}) >= 0; });
    if (row) { row.click(); return 'clicked_project'; }
    return 'no_project_row';
  })()`);
  await pagePoll(null, `String(document.querySelectorAll('[data-conversation-id]').length >= 2)`, {
    label: 'conversation rows', timeoutMs: 15000,
  });
  return true;
}

async function clickConversation(id) {
  return evalRetry(null, `(function(){
    var row = document.querySelector('[data-conversation-id=${JSON.stringify(id)}]');
    if (!row) return 'no_row';
    row.click();
    return 'clicked';
  })()`);
}

/**
 * 合成拖放：同一 DataTransfer 依次 dispatch dragstart（会话行）→ dragover/drop（composer）。
 * 行上的 onDragStart 会写入真实 payload；这里先写一份，保证 dragover 阶段可见 MIME。
 */
async function dragConversationToComposer(id, title) {
  return evalRetry(null, `(function(){
    var row = document.querySelector('[data-conversation-id=${JSON.stringify(id)}]');
    var composer = document.querySelector('.sc-composer');
    if (!row || !composer) return JSON.stringify({ ok:false, row:!!row, composer:!!composer });
    var dt = new DataTransfer();
    dt.setData(${JSON.stringify(CONVERSATION_MIME)}, JSON.stringify({
      id: ${JSON.stringify(id)}, title: ${JSON.stringify(title)}, messageCount: 0, updatedAt: null
    }));
    dt.setData('text/plain', ${JSON.stringify(title)});
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    composer.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    composer.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return JSON.stringify({ ok:true, mime: ${JSON.stringify(CONVERSATION_MIME)} });
  })()`);
}

module.exports = {
  id: 'q2rem-stats-drag-live',
  description: 'BLOCK-255 Q2-REM 实机：逐消息统计面板 + 会话拖入 composer（唯一 ContextItem 通道）',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-255'),

  async run(ctx) {
    const { assert } = ctx;
    const projectId = ctx.projectId;
    const projectName = ctx.projectName;
    const currentId = ctx.currentConversationId;
    const targetId = ctx.targetConversationId;
    let client = null;

    const health = await rest('GET', '/data/projects');
    assert('A0a_backend_rest_healthy', health.ok, `status=${health.status}`);

    client = await ensureClient();
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'app page root', timeoutMs: 30000 });
    assert('A0b_app_page_ready', true, 'root 就绪');

    const listed = await rest('GET', `/ai/conversations?project_id=${encodeURIComponent(projectId)}`);
    const rows = listed.data && Array.isArray(listed.data.conversations) ? listed.data.conversations : [];
    const hasCurrent = rows.some((row) => row.id === currentId);
    const targetRow = rows.find((row) => row.id === targetId);
    assert('A0c_seeded_conversations', hasCurrent && Boolean(targetRow),
      JSON.stringify({ count: rows.length, current: hasCurrent, targetMessages: targetRow && targetRow.message_count }));

    await navigate(`${APP_ORIGIN}/project/${encodeURIComponent(projectId)}`);
    await dismissFirstRun();
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'project root', timeoutMs: 30000 });

    await ensureConversationRows(projectName);
    assert('A1_left_panel_conversations',
      await evalRetry(null, `String(document.querySelectorAll('[data-conversation-id]').length >= 2)`) === 'true',
      '左栏两个会话行在场');

    const clicked = await clickConversation(currentId);
    assert('A2_current_conversation_loaded',
      clicked === 'clicked' && await pagePoll(
        client,
        `String([...document.querySelectorAll('.sc-msg')].some(function(el){
          return (el.textContent || '').indexOf('这是带 usage 的回复统计样例。') >= 0; }))`,
        { label: 'seed assistant message', timeoutMs: 30000 },
      ) === 'true',
      '当前会话种子消息渲染');

    const statsClicked = await clickStatsFor('这是带 usage 的回复统计样例。');
    assert('A3_stats_action_present', statsClicked === 'clicked', statsClicked);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="msg-stats-panel"]'))`, {
      label: 'stats panel', timeoutMs: 15000,
    });
    const usageText = await statsPanelText();
    assert('A4_stats_panel_usage',
      usageText.indexOf('2 次（有 usage）') >= 0
      && usageText.indexOf('1 次未返回 usage') >= 0
      && usageText.indexOf('输入 1K') >= 0
      && usageText.indexOf('2 步') >= 0
      && usageText.indexOf('2 轮') >= 0
      && usageText.indexOf('另有 1 次调用未返回 usage') >= 0,
      usageText.slice(0, 420));
    await closeStats();
    assert('A4b_stats_panel_closed',
      await evalRetry(null, `String(!document.querySelector('[data-testid="msg-stats-panel"]'))`) === 'true',
      '关闭后面板移除');

    const noUsageClicked = await clickStatsFor('这是没有 usage 的历史回复。');
    assert('A5_stats_honest_without_usage', noUsageClicked === 'clicked', noUsageClicked);
    const noUsageText = await pagePoll(client, `(function(){
      var panel = document.querySelector('[data-testid="msg-stats-panel"]');
      return panel ? panel.textContent : '';
    })()`, { label: 'no-usage panel', timeoutMs: 15000 });
    assert('A5b_no_usage_honest',
      noUsageText.indexOf('本条未记录 token') >= 0 && noUsageText.indexOf('未记录') >= 0,
      noUsageText.slice(0, 420));
    await closeStats();

    const dragCurrent = await dragConversationToComposer(currentId, '当前会话（统计）');
    assert('A6_drag_dispatched_current', JSON.parse(dragCurrent).ok === true, dragCurrent);
    const notice = await pagePoll(client, `(function(){
      var nodes = [...document.querySelectorAll('.sc-attachment-notice')];
      var hit = nodes.find(function(el){ return (el.textContent || '').indexOf('当前会话无需引用自己') >= 0; });
      return hit ? hit.textContent : '';
    })()`, { label: 'self-drag notice', timeoutMs: 15000 });
    const chipCountAfterSelf = await evalRetry(null, `String(document.querySelectorAll('[data-context-kind="conversation"]').length)`);
    assert('A6b_self_drag_rejected', notice.indexOf('当前会话无需引用自己') >= 0 && chipCountAfterSelf === '0',
      `notice=${notice} chips=${chipCountAfterSelf}`);

    const dragTarget = await dragConversationToComposer(targetId, '待拖入会话');
    assert('A7_drag_dispatched_target', JSON.parse(dragTarget).ok === true, dragTarget);
    const chip = await pagePoll(client, `(function(){
      var el = document.querySelector('[data-context-kind="conversation"]');
      return el ? JSON.stringify({ text: el.textContent, title: el.getAttribute('title') || '' }) : '';
    })()`, { label: 'conversation chip', timeoutMs: 30000 });
    const chipData = JSON.parse(chip);
    assert('A7b_target_drag_adds_chip',
      chipData.text.indexOf('待拖入会话') >= 0
      && chipData.title.indexOf(`conversationId：${targetId}`) >= 0
      && chipData.title.indexOf('上一个会话的问题') >= 0,
      chip.slice(0, 500));

    const removed = await evalRetry(null, `(function(){
      var el = document.querySelector('[data-context-kind="conversation"]');
      if (!el) return 'no_chip';
      var btn = el.querySelector('button');
      if (!btn) return 'no_remove';
      btn.click();
      return 'removed';
    })()`);
    assert('A8_chip_removable',
      removed === 'removed' && await evalRetry(null, `String(document.querySelectorAll('[data-context-kind="conversation"]').length === 0)`) === 'true',
      removed);

    await navigate(`${APP_ORIGIN}/?test=1`);
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'spa reset', timeoutMs: 30000 });
    assert('A9_spa_clean', true, '收尾回到 ?test=1，页面可用');
  },
};
