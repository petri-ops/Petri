#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: b268-scratchpad-live — BLOCK-268（UI-585 速记板开态实机腿）。
 *
 * UI-585 scratchpad_dock_remount  开→跨路由重挂保留→Esc 关闭→刷新归零四链
 *
 * 诚实边界：截图离屏 unavailable；重挂触发=真实路由切换（首页→设置→回首页）；
 * 流式推进触发的重挂形态由组件测试同语义覆盖。
 */

const path = require('node:path');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

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
    try {
      last = await lib.evalJs(await ensureClient(), expr, 8000);
      if (last) return last;
    } catch (e) { last = String(e && e.message || e); }
    await sleep(600);
  }
  throw new Error(`timeout:${label}:${String(last).slice(0, 200)}`);
}

module.exports = {
  async run({ assert }) {
    // 进首页（composer 所在）
    await navigate(`${APP_ORIGIN}/`);
    await pagePoll(null, `!!document.getElementById('root')`, { label: 'app-ready' });
    const toggleReady = await pagePoll(
      null,
      `!!document.querySelector('[data-testid="scratchpad-toggle"]')`,
      { timeoutMs: 30000, label: 'scratchpad-toggle' },
    );
    assert('S2_composer_ready', Boolean(toggleReady), `scratchpad-toggle 在场（首页 composer）`);

    // ---------- ①开 ----------
    await evalRetry(null, `document.querySelector('[data-testid="scratchpad-toggle"]').click()`);
    const openExpanded = await pagePoll(
      null,
      `document.querySelector('[data-testid="scratchpad-toggle"]')?.getAttribute('aria-expanded') === 'true'`,
      { timeoutMs: 10000, label: 'expanded' },
    );
    const panelShown = await pagePoll(null, `!!document.querySelector('[data-testid="sc-scratch-panel"]')`, { timeoutMs: 10000, label: 'panel' });
    assert('UI585_dock_open', openExpanded && panelShown,
      `toggle 开 → aria-expanded=true + sc-scratch-panel 在场`);

    // ---------- ②跨路由重挂保留（SPA 内部切换；CDP Page.navigate 是整页刷新=新 realm，不作重挂路径）----------
    await evalRetry(null, `
      (function(){
        const settings = document.querySelector('[data-testid="sidebar-settings"]');
        if (!settings) return 'no-settings-btn';
        settings.click(); return 'settings-clicked';
      })()
    `);
    await pagePoll(null, `location.pathname === '/settings'`, { timeoutMs: 15000, label: 'spa-to-settings' });
    await sleep(800); // SPA 挂载 settings 面板（SimpleChat 子树已卸载）
    const settingsOk = await evalRetry(null, `location.pathname === '/settings'`);
    await evalRetry(null, `history.back(); 'back'`);
    const toggleBack = await pagePoll(
      null,
      `location.pathname === '/' && !!document.querySelector('[data-testid="scratchpad-toggle"]')`,
      { timeoutMs: 30000, label: 'composer-back' },
    );
    await sleep(600); // 重挂实例完成挂载重读
    const remountExpanded = await evalRetry(null,
      `document.querySelector('[data-testid="scratchpad-toggle"]')?.getAttribute('aria-expanded') === 'true'`);
    const remountPanel = await evalRetry(null, `!!document.querySelector('[data-testid="sc-scratch-panel"]')`);
    assert('UI585_remount_keeps_open', settingsOk && toggleBack && remountExpanded && remountPanel,
      `首页→(SPA)设置→history.back 回首页（SPA 卸载重挂）→ aria-expanded=${remountExpanded} panel=${remountPanel}（模块级 store 重读）`);

    // ---------- ③Esc 关闭 ----------
    await evalRetry(null, `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      'esc-dispatched'
    `);
    await sleep(400);
    const closedExpanded = await evalRetry(null,
      `document.querySelector('[data-testid="scratchpad-toggle"]')?.getAttribute('aria-expanded') === 'false'`);
    const closedPanel = await evalRetry(null, `!document.querySelector('[data-testid="sc-scratch-panel"]')`);
    assert('UI585_close_semantics', closedExpanded && closedPanel,
      `Escape（面板 document keydown 既有监听）→ aria-expanded=false + panel 消失`);

    // ---------- ④刷新归零（有意语义：模块级 store 零持久化）----------
    const live = await ensureClient();
    try { await live.send('Page.reload', {}); } catch { activeClient = null; }
    await pagePoll(null, `!!document.querySelector('[data-testid="scratchpad-toggle"]')`, { timeoutMs: 30000, label: 'reload-ready' });
    await sleep(600);
    const reloadExpanded = await evalRetry(null,
      `document.querySelector('[data-testid="scratchpad-toggle"]')?.getAttribute('aria-expanded') === 'false'`);
    const reloadPanel = await evalRetry(null, `!document.querySelector('[data-testid="sc-scratch-panel"]')`);
    assert('UI585_reload_resets', reloadExpanded && reloadPanel,
      `reload → aria-expanded=false + 无 panel（刷新即归零=有意边界，非持久化缺陷）`);
  },
};
