#!/usr/bin/env node
'use strict';
/**
 * ui362-command-center-tab-live.cjs — UI-362 实机验收：指挥中心入口右栏 tab 化（项目绑定）。
 *
 * 背景（用户裁决）：指挥中心入口应像右栏的结果/文件/审阅一样作为 tab 存在且项目绑定；
 * UI-361 的左栏底部入口撤除。全局俯瞰独立窗仍由 Ctrl/Cmd+Shift+C 承载。
 *
 * 断言：
 *   V1 左栏底部与顶栏均无指挥中心入口（撤除干净）；
 *   V2 右栏「+」工具菜单含「指挥中心」项；点击后 tab pill 出现、瓦片墙挂载
 *      （瓦片或项目空态文案至少其一在场）；
 *   V3 Ctrl/Cmd+Shift+C 全局独立窗仍可弹出（/window/command-center target），
 *      验证后关闭。
 */

const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CDP_HTTP = { host: '127.0.0.1', port: 9222, path: '/json/list' };

async function attachMain() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_page_target');
  return lib.connectTarget(target);
}

function listTargetsRaw() {
  return new Promise((resolve, reject) => {
    http.get(CDP_HTTP, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

const nav = (p) => `location.href = 'http://localhost:3000${p}'; 'nav'`;

const PROBE = `(function(){
  var q = function(sel) { return document.querySelector(sel); };
  var qa = function(sel) { return Array.from(document.querySelectorAll(sel)); };
  var railEntry = q('[data-testid="sidebar-command-center"]');
  var titlebarEntry = q('button[aria-label="打开指挥中心"]');
  var toolMenuBtn = q('button[aria-label="展开更多工具"]');
  var jobsPill = qa('button[title="指挥中心"]').find(function(b) { return b.getAttribute('aria-pressed') === 'true'; }) || null;
  var wallMounted = !!q('[data-testid="cc-tile-active"], [data-testid="cc-tile-history"]')
    || document.body.textContent.indexOf('本项目暂无作业') !== -1;
  return JSON.stringify({ railEntry: !!railEntry, titlebarEntry: !!titlebarEntry, toolMenu: !!toolMenuBtn, jobsPill: !!jobsPill, wallMounted: wallMounted });
})()`;

(async () => {
  const run = lib.createRun({ name: 'ui362-command-center-tab', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-362') });
  const projects = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path: '/api/data/projects', headers: { Authorization: 'Bearer desktop-local' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const pid = projects.projects[0].id;

  // 关掉可能残留的指挥中心窗
  const stale = (await listTargetsRaw()).find((t) => typeof t.url === 'string' && t.url.includes('/window/command-center'));
  if (stale) {
    const c = await lib.connectTarget(stale);
    await lib.evalJs(c, 'window.close(); "closing"').catch(() => {});
    await sleep(1200);
  }

  // V1 — 工作区 chat：旧入口撤除干净
  let client = await attachMain();
  await lib.evalJs(client, nav(`/project/${pid}/chat`));
  await sleep(4000);
  client = await attachMain();
  const base = JSON.parse(await lib.evalJs(client, PROBE) || '{}');
  run.assert('V1_legacy_entries_removed', base.railEntry === false && base.titlebarEntry === false,
    `左栏底部与顶栏均无指挥中心入口（rail=${base.railEntry}，titlebar=${base.titlebarEntry}）`);

  // V2 — 「+」工具菜单 → 指挥中心 → tab 打开且瓦片墙挂载
  await lib.evalJs(client, `document.querySelector('button[aria-label="展开更多工具"]').click(); 'opened'`);
  await sleep(700);
  const menuHit = await lib.evalJs(client, `(function(){
    var items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    var target = items.find(function(i) { return i.textContent.indexOf('指挥中心') !== -1; });
    if (!target) return 'missing';
    target.click(); return 'clicked';
  })()`);
  await sleep(1500);
  client = await attachMain();
  const after = JSON.parse(await lib.evalJs(client, PROBE) || '{}');
  run.assert('V2_jobs_tab_opens_wall', menuHit === 'clicked' && after.jobsPill === true && after.wallMounted === true,
    `工具菜单含指挥中心（menuHit=${menuHit}），点击后 tab pill 在场且瓦片墙挂载（pill=${after.jobsPill}，wall=${after.wallMounted}）`);

  // V3 — 全局独立窗仍可经快捷键弹出
  await lib.evalJs(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', shiftKey: true, ctrlKey: true })); 'k'`);
  let ccTarget = null;
  for (let i = 0; i < 10 && !ccTarget; i++) {
    await sleep(800);
    ccTarget = (await listTargetsRaw()).find((t) => typeof t.url === 'string' && t.url.includes('/window/command-center'));
  }
  run.assert('V3_global_window_via_shortcut', !!ccTarget,
    `Ctrl+Shift+C 弹出全局指挥中心独立窗（url=${ccTarget && ccTarget.url}）`);
  if (ccTarget) {
    const cc = await lib.connectTarget(ccTarget);
    await lib.evalJs(cc, 'window.close(); "closing"').catch(() => {});
    await sleep(1200);
  }

  return await run.finish({ observations: { pid, base, after } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
