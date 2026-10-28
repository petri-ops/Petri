#!/usr/bin/env node
'use strict';
/**
 * scripts/block301-settings-rail-live.cjs — BLOCK-302 UI-602 实机腿：设置页隐藏壳层左栏。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block301-settings-rail-live.cjs
 * 证据：acceptance/block-301/live-settings-rail.json。
 *
 * 场景（用户裁决「点击设置按钮的时候左侧栏应该隐藏，保持好的使用习惯」）：
 *   首页 AppRail 在场 → navigate /settings → 左栏（AppRail+LeftPanel 全系统）退场、
 *   设置页占满窗口 → 点设置页「← 返回」→ 回上一页、左栏恢复。
 *
 * 断言面：
 *   D0 首页左栏在场（sidebar-settings 入口可寻址）；
 *   D1 /settings 下左栏退场 + 设置页在场；
 *   D2 设置页占满窗口（宽度 ≈ 视口）；
 *   D3 「返回」后左栏恢复。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-301');
const RAW_TIMEOUT = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1200); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 25000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(800);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 220) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 150)}`);
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
  await client.send('Page.reload', { ignoreCache: true }, { timeoutMs: RAW_TIMEOUT }).catch(() => {});
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after hard reload' });
  await sleep(800);

  // ── D0 首页左栏在场（hard reload 可能停在上次会话的项目页且其左栏关闭态——先回首页取稳定锚）──
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/`)}; 'nav'`);
  await pagePoll(client, `(function(){
    return document.querySelector('[data-testid="sidebar-settings"]') ? 'rail_ready' : '';
  })()`, { label: 'home rail ready' });
  const home = await evalRetry(client, `(function(){
    return { rail: !!document.querySelector('[data-testid="sidebar-settings"]'),
             path: location.pathname };
  })()`);
  assert('D0_home_rail_present', home.rail === true, JSON.stringify(home));

  // ── D1 /settings 左栏退场 ──
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/settings`)}; 'nav'`);
  await pagePoll(client, `(function(){
    var page = document.querySelector('[class*="settingsPage"]');
    return page && page.getBoundingClientRect().width > 300 ? 'settings_ready' : '';
  })()`, { label: 'settings page ready' });
  await sleep(400);
  const settings = await evalRetry(client, `(function(){
    return { rail: !!document.querySelector('[data-testid="sidebar-settings"]'),
             railRoot: Boolean(document.querySelector('aside')),
             settingsPage: !!document.querySelector('[class*="settingsPage"]') };
  })()`);
  assert('D1_settings_rail_hidden', settings.rail === false && settings.settingsPage === true,
    JSON.stringify(settings));

  // ── D2 设置页占满窗口 ──
  const width = await evalRetry(client, `(function(){
    var page = document.querySelector('[class*="settingsPage"]');
    var r = page.getBoundingClientRect();
    return { pageW: Math.round(r.width), vw: window.innerWidth };
  })()`);
  assert('D2_settings_fullwidth', width.pageW >= width.vw - 4,
    `page=${width.pageW}px viewport=${width.vw}px`);

  // ── D3 返回 → 左栏恢复 ──
  await evalRetry(client, `(function(){
    var b = document.querySelector('[aria-label="返回"], [title="返回"]');
    if (!b) return 'no_back';
    b.click();
    return 'returned';
  })()`);
  await sleep(1200);
  const restored = await evalRetry(client, `(function(){
    return { rail: !!document.querySelector('[data-testid="sidebar-settings"]'),
             path: location.pathname };
  })()`);
  assert('D3_back_restores_rail', restored.rail === true,
    JSON.stringify(restored));

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    surface: '壳层左栏（AppRail+LeftPanel）×设置独立页',
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-settings-rail.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-301 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block301-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
