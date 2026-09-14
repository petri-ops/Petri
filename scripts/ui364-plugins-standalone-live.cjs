#!/usr/bin/env node
'use strict';
/**
 * ui364-plugins-standalone-live.cjs — UI-364 实机验收：插件商店独立页化（解绑项目）。
 *
 * 背景（用户裁决）：插件装卸是设备级能力，不该绑项目；原「插件」入口经
 * openWorkspaceMode('plugins') 打开会隐式激活当前项目并进入工作区 chrome。
 * 修复后：左栏「插件」→ 独立页 /plugins（与 /skills 同形态，无工作区 chrome）。
 *
 * 断言：
 *   V1 左栏点「插件」→ 落在 /plugins 独立页：无工作区右栏、商店面板在场；
 *   V2 返回按钮在场（aria-label 返回）；
 *   V3 旧深链 /project/:id/plugins → fail-closed 回 chat 工作区（aside
 *      data-workspace-mode=chat，右栏恢复）。
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
  var rail = q('aside[class*="rightCol"]');
  return JSON.stringify({
    path: location.pathname,
    store: !!q('.gewu-plugin-store-panel'),
    backBtn: !!q('button[aria-label="返回"]'),
    workspaceAside: !!q('aside[data-workspace-mode]'),
    railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : null,
    railMode: rail ? rail.getAttribute('data-workspace-mode') : null
  });
})()`;

(async () => {
  const run = lib.createRun({ name: 'ui364-plugins-standalone', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-364') });
  const projects = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path: '/api/data/projects', headers: { Authorization: 'Bearer desktop-local' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const pid = projects.projects[0].id;

  // V1 — 左栏「插件」→ /plugins 独立页
  let client = await attach();
  await lib.evalJs(client, nav(`/project/${pid}/chat`));
  await sleep(3500);
  client = await attach();
  const clicked = await lib.evalJs(client, `(function(){
    var btns = Array.from(document.querySelectorAll('[class*="leftQuickActions"] button'));
    var target = btns.find(function(b) { return b.textContent.indexOf('插件') !== -1; });
    if (!target) return 'missing';
    target.click(); return 'clicked';
  })()`);
  await sleep(3000);
  client = await attach();
  const plugins = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  run.assert('V1_plugins_standalone_page', clicked === 'clicked' && plugins.path === '/plugins'
    && plugins.store === true && plugins.workspaceAside === false && plugins.railWidth === null,
    `点插件落在 /plugins 独立页：商店面板在场、无工作区右栏（path=${plugins.path}，store=${plugins.store}，aside=${plugins.workspaceAside}，rail=${plugins.railWidth}）`);

  // V2 — 返回按钮在场（Skills 页同语义）
  run.assert('V2_back_button_present', plugins.backBtn === true,
    `独立页含返回按钮（back=${plugins.backBtn}）`);

  // V3 — 历史深链 fail-closed 回 chat 工作区
  await lib.evalJs(client, nav(`/project/${pid}/plugins`));
  await sleep(3500);
  client = await attach();
  const legacy = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  run.assert('V3_legacy_deeplink_falls_back_chat', legacy.path === `/project/${pid}/plugins`
    && legacy.railMode === 'chat' && (legacy.railWidth || 0) > 0,
    `旧深链回 chat 工作区（path=${legacy.path}，mode=${legacy.railMode}，rail=${legacy.railWidth}）`);

  // 收尾：回工作区 chat
  await lib.evalJs(client, nav(`/project/${pid}/chat`));

  return await run.finish({ observations: { pid, plugins, legacy } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
