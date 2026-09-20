#!/usr/bin/env node
'use strict';
/**
 * ui365-settings-diagnostics-live.cjs — UI-365 + UI-366 实机验收。
 *
 * UI-365：设置独立页化（/settings，与 /skills /plugins 同形态，不绑项目；
 *         工作区 settings 模式退役，历史深链 fail-closed 回 chat）。
 * UI-366：全局「后端」页（/backend）退役，诊断面板并入设置
 *         「运行时与诊断」分区；左栏工作台「后端」入口移除。
 *
 * 断言：
 *   V1 左栏底部「设置」→ /settings 独立页：面板在场、无工作区 aside；
 *   V2 设置内「运行时与诊断」分区可切：分区标题 + 本地服务诊断面板在场；
 *   V3 左栏工作台不再有「后端」入口（欢迎页核对）；
 *   V4 旧深链 /project/:id/settings → fail-closed 回 chat 工作区；
 *   V5 旧路由 /backend → 重定向 /。
 */

const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_page_target');
  return lib.connectTarget(target);
}

const nav = (p) => `location.href = 'http://localhost:3000${p}'; 'nav'`;

const MEASURE = `(function(){
  var q = function(sel) { return document.querySelector(sel); };
  var qa = function(sel) { return Array.from(document.querySelectorAll(sel)); };
  var rail = q('aside[class*="rightCol"]');
  return JSON.stringify({
    path: location.pathname,
    settingsPanel: !!q('.gewu-desktop-panel'),
    workspaceAside: !!q('aside[data-workspace-mode]'),
    railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : null,
    diagNav: qa('[class*="gewu-settings-nav__item"]').some(function(b) { return b.textContent.indexOf('运行时与诊断') !== -1; }),
    diagTitle: document.body.textContent.indexOf('运行时与诊断') !== -1,
    localSvc: document.body.textContent.indexOf('本地服务') !== -1,
    backendQuickAction: qa('[class*="leftQuickActions"] button').some(function(b) { return b.textContent.indexOf('后端') !== -1; })
  });
})()`;

(async () => {
  const run = lib.createRun({ name: 'ui365-settings-diagnostics', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-365') });
  const projects = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path: '/api/data/projects', headers: { Authorization: 'Bearer desktop-local' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const pid = projects.projects[0].id;

  // V1 — 左栏底部「设置」→ /settings 独立页
  let client = await attach();
  await lib.evalJs(client, nav('/'));
  await sleep(3000);
  client = await attach();
  await lib.evalJs(client, `document.querySelector('[data-testid="sidebar-settings"]').click(); 'clicked'`);
  await sleep(3000);
  client = await attach();
  const settings = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  run.assert('V1_settings_standalone_page', settings.path === '/settings' && settings.settingsPanel === true
    && settings.workspaceAside === false && settings.railWidth === null,
    `点设置落 /settings 独立页（path=${settings.path}，panel=${settings.settingsPanel}，aside=${settings.workspaceAside}，rail=${settings.railWidth}）`);

  // V2 — 「运行时与诊断」分区切换 + 本地服务诊断面板在场
  const navHit = await lib.evalJs(client, `(function(){
    var items = Array.from(document.querySelectorAll('[class*="gewu-settings-nav__item"]'));
    var target = items.find(function(i) { return i.textContent.indexOf('运行时与诊断') !== -1; });
    if (!target) return 'missing';
    target.click(); return 'clicked';
  })()`);
  await sleep(1500);
  client = await attach();
  const diag = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  run.assert('V2_diagnostics_section', navHit === 'clicked' && diag.diagTitle === true && diag.localSvc === true,
    `运行时与诊断分区切换成功且本地服务诊断面板在场（navHit=${navHit}，title=${diag.diagTitle}，localSvc=${diag.localSvc}）`);

  // V3 — 左栏工作台无「后端」入口
  await lib.evalJs(client, nav('/'));
  await sleep(3000);
  client = await attach();
  const home = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  run.assert('V3_backend_entry_removed', home.backendQuickAction === false,
    `左栏工作台无「后端」入口（backendQuickAction=${home.backendQuickAction}）`);

  // V4 — 旧深链 /project/:id/settings → fail-closed chat：以 chrome 语义断言
  // （chat 模式的摘要开关 + 右栏开关在场；若仍按 settings 模式则二者都不在场）
  await lib.evalJs(client, nav(`/project/${pid}/settings`));
  await sleep(4500);
  client = await attach();
  const legacy = JSON.parse(await lib.evalJs(client, `(function(){
    var qa = function(sel) { return !!document.querySelector(sel); };
    return JSON.stringify({
      path: location.pathname,
      summaryToggle: qa('button[aria-label="展开摘要概览"], button[aria-label="收起摘要概览"]'),
      rightToggle: qa('button[aria-label="展开右侧栏"], button[aria-label="收起右侧栏"]')
    });
  })()`));
  run.assert('V4_legacy_settings_deeplink_chat', legacy.path === `/project/${pid}/settings`
    && legacy.summaryToggle === true && legacy.rightToggle === true,
    `旧 settings 深链回 chat 语义（path=${legacy.path}，摘要开关=${legacy.summaryToggle}，右栏开关=${legacy.rightToggle}）`);

  // V5 — 旧路由 /backend → 重定向 /
  await lib.evalJs(client, nav('/backend'));
  await sleep(3000);
  client = await attach();
  const redirected = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  run.assert('V5_backend_route_retired', redirected.path === '/',
    `/backend 重定向 /（path=${redirected.path}）`);

  return await run.finish({ observations: { pid, settings, diag, home, legacy, redirected } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
