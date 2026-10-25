#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: q5rem-tail-live — BLOCK-257（Q5-REM 尾包）实机腿。
 *
 * A0a backend_rest_healthy
 * A0b app_page_ready
 * A1 host_menu_open             「更多工具」菜单可见
 * A2 terminal_open_via_menu     菜单点「终端」→ 底部终端打开
 * A3 host_menu_reopen           终端打开后再次点「更多工具」菜单可见（bug 回归）
 * A4 terminal_split             新建第二 tab → 分屏 → 两个 pane 同时可见
 * A5 pin_split_result           结果页钉住 → 主区最大化 → 恢复 → 副栏最大化 → 恢复
 * A6 spa_clean
 *
 * 诚实边界：截图离屏 unavailable；结果用的是合成 job + 本地 CSV（报告标 synthetic）。
 * 前置：scripts/block257-q5-rem-tail-live.mjs 起隔离栈。
 */
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
let activeClient = null;

async function ensureClient() {
  if (activeClient) {
    try { await lib.evalJs(activeClient, '1', 4000); return activeClient; } catch { activeClient = null; }
  }
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const chosen = await lib.selectPageTarget(pages, { probe: async (candidate) => lib.evalJs(candidate, `!!document.getElementById('root')`).catch(() => false) });
  activeClient = await lib.connectTarget(chosen);
  return activeClient;
}

async function evalRetry(_client, expr, tries = 4) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(await ensureClient(), expr, 8000); } catch (e) { lastErr = e; await sleep(500); }
  }
  throw lastErr;
}

async function navigate(url) {
  const live = await ensureClient();
  try { await live.send('Page.navigate', { url }); } catch { activeClient = null; }
  await sleep(1200);
}

async function pagePoll(_client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await Promise.race([
      evalRetry(null, expr, 1),
      new Promise((resolve) => setTimeout(() => resolve('poll_timeout'), 6000)),
    ]).catch((e) => `eval_err:${e.message}`);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(600);
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

async function clickText(rootSelector, text) {
  return evalRetry(null, `(function(){
    var root = document.querySelector(${JSON.stringify(rootSelector)}) || document;
    var btn = [...root.querySelectorAll('button')].find(function(el){
      return (el.textContent || '').trim().indexOf(${JSON.stringify(text)}) >= 0; });
    if (!btn) return 'no_button';
    btn.click();
    return 'clicked';
  })()`);
}

module.exports = {
  id: 'q5rem-tail-live',
  description: 'BLOCK-257 Q5-REM 尾包：宿主菜单复开 + 终端双 pane 分屏 + 钉住/最大化',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-257'),

  async run(ctx) {
    const { assert } = ctx;
    const projectId = ctx.projectId;
    const jobId = ctx.jobId;
    let client = null;

    const health = await fetch(API + '/data/projects', { headers: AUTH });
    assert('A0a_backend_rest_healthy', health.ok, `status=${health.status}`);
    client = await ensureClient();
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'root', timeoutMs: 30000 });
    assert('A0b_app_page_ready', true, 'root 就绪');

    await navigate(`${APP_ORIGIN}/project/${encodeURIComponent(projectId)}`);
    await dismissFirstRun();
    await pagePoll(client, `String(!!document.querySelector('[aria-label="展开更多工具"]'))`, { label: 'more tools', timeoutMs: 30000 });
    const opened = await evalRetry(null, `(function(){ var b=document.querySelector('[aria-label="展开更多工具"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    assert('A1_host_menu_open', opened === 'clicked' && await pagePoll(client, `String(!!document.querySelector('#titlebar-tool-menu'))`, { label: 'host menu', timeoutMs: 15000 }) === 'true', '更多工具菜单可见');

    const terminalItem = await clickText('#titlebar-tool-menu', '终端');
    assert('A2_terminal_open_via_menu', terminalItem === 'clicked', terminalItem);
    await pagePoll(client, `String(!!document.querySelector('section[data-petri-motion="functional"][aria-hidden="false"] [role="tablist"][aria-label="终端标签"]'))`, { label: 'terminal open', timeoutMs: 20000 });
    assert('A2b_terminal_open', true, '终端面板打开');

    const reopen = await evalRetry(null, `(function(){ var b=document.querySelector('[aria-label="展开更多工具"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    assert('A3_host_menu_reopen', reopen === 'clicked' && await pagePoll(client, `String(!!document.querySelector('#titlebar-tool-menu'))`, { label: 'host menu reopen', timeoutMs: 15000 }) === 'true', '终端打开后菜单仍可弹出');
    await evalRetry(null, `(function(){ var b=document.querySelector('[aria-label="关闭工具菜单"]'); if(b) b.click(); return 'closed'; })()`).catch(() => 'ignore');

    await evalRetry(null, `(function(){ var b=document.querySelector('[aria-label="新建终端标签"]'); if(b) {b.click(); return 'opened';} return 'no_button'; })()`);
    await pagePoll(client, `String(document.querySelectorAll('[data-petri-motion="functional"][aria-hidden="false"] [data-tab-body]').length >= 2)`, { label: 'two terminal tabs', timeoutMs: 15000 });
    const splitClick = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="terminal-split-toggle"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    assert('A4_terminal_split_clicked', splitClick === 'clicked', splitClick);
    const splitState = await pagePoll(client, `(function(){
      var body = document.querySelector('[data-split="true"]');
      if (!body) return '';
      var visible = [...body.querySelectorAll('[data-tab-body]')].filter(function(el){
        return getComputedStyle(el).display !== 'none'; });
      return JSON.stringify({ split: true, visible: visible.length, labels: visible.map(function(el){ return el.getAttribute('data-tab-body'); }) });
    })()`, { label: 'split panes', timeoutMs: 15000 });
    const splitData = JSON.parse(splitState);
    assert('A4b_two_panes_visible', splitData.split === true && splitData.visible >= 2, splitState);

    await navigate(`${APP_ORIGIN}/project/${encodeURIComponent(projectId)}/result?job=${encodeURIComponent(jobId)}&artifact=deg.csv`);
    await dismissFirstRun();
    // 血缘条也有「钉住 <名字>」按钮——按精确文本 + 可用态命中宿主钉住。
    await pagePoll(client, `String([...document.querySelectorAll('button')].some(function(b){ return (b.textContent||'').trim() === '钉住' && !b.disabled; }))`, { label: 'pin button', timeoutMs: 30000 });
    const pinClick = await evalRetry(null, `(function(){
      var b = [...document.querySelectorAll('button')].find(function(el){ return (el.textContent||'').trim() === '钉住' && !el.disabled; });
      if (!b) return 'no_button';
      b.click();
      return 'clicked';
    })()`);
    assert('A5_pin_clicked', pinClick === 'clicked', pinClick);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="artifact-pin-pane"]'))`, { label: 'pin pane', timeoutMs: 15000 });
    assert('A5b_pin_pane_visible', true, '副栏快照在场');
    const maxMain = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="artifact-pin-maximize-main"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    assert('A5c_maximize_main_clicked', maxMain === 'clicked', maxMain);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="artifact-pin-main-controls"]'))`, { label: 'main max', timeoutMs: 10000 });
    const restore1 = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="artifact-pin-restore"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    assert('A5d_restore_after_main', restore1 === 'clicked', restore1);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="artifact-pin-maximize-pin"]'))`, { label: 'restored split', timeoutMs: 10000 });
    const maxPin = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="artifact-pin-maximize-pin"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    assert('A5e_maximize_pin_clicked', maxPin === 'clicked', maxPin);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="artifact-pin-restore"]'))`, { label: 'pin max', timeoutMs: 10000 });
    const restore2 = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="artifact-pin-restore"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    assert('A5f_restore_after_pin', restore2 === 'clicked', restore2);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="artifact-pin-pane"]') && !!document.querySelector('[data-testid="artifact-pin-divider"]'))`, { label: 'split restored', timeoutMs: 10000 });
    assert('A5g_split_restored', true, '恢复分屏且比例槽在场');

    await navigate(`${APP_ORIGIN}/?test=1`);
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'spa reset', timeoutMs: 30000 });
    assert('A6_spa_clean', true, '收尾回 ?test=1');
  },
};
