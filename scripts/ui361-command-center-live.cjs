#!/usr/bin/env node
'use strict';
/**
 * ui361-command-center-live.cjs — UI-361 实机验收：指挥中心入口迁入壳层左栏底部。
 *
 * 背景：指挥中心是全局单例窗（跨项目/会话的全部作业俯瞰），原先的入口按钮挂在
 * TitleBarRightZone 的 windowTools 里——右栏展开时视觉上像右栏自己的附属控件
 * （列级 chrome 承载全局动作，层级错位），且与联邦的 cpu 图标撞车。
 *
 * 断言：
 *   V1 顶栏右区不再有「打开指挥中心」按钮（欢迎页与工作区 chat 均不在）；
 *   V2 左栏底部工具行有「指挥中心」入口（欢迎页 / 工作区 chat / /skills 三处常驻）；
 *   V3 点击后指挥中心独立窗真实弹出（CDP target /window/command-center 出现）；
 *   V4 验证后关闭该窗（target 消失）。
 */

const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CDP_HTTP = { host: '127.0.0.1', port: 9222, path: '/json/list' };

async function attach() {
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

const MEASURE = `(function(){
  var q = function(sel) { return document.querySelector(sel); };
  var ccTitlebar = q('button[aria-label="打开指挥中心"]');
  var ccRail = q('[data-testid="sidebar-command-center"]');
  return JSON.stringify({
    titlebarEntry: !!ccTitlebar,
    railEntry: !!ccRail,
    railTitle: ccRail ? ccRail.getAttribute('title') : null
  });
})()`;

const nav = (p) => `location.href = 'http://localhost:3000${p}'; 'nav'`;

async function goto(url) {
  let client = await attach();
  await lib.evalJs(client, nav(url));
  await sleep(3000);
  client = await attach();
  return { client, state: JSON.parse(await lib.evalJs(client, MEASURE) || '{}') };
}

async function commandCenterTargetPresent() {
  const targets = await listTargetsRaw();
  return targets.find((t) => typeof t.url === 'string' && t.url.includes('/window/command-center')) || null;
}

(async () => {
  const run = lib.createRun({ name: 'ui361-command-center', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-361') });
  const projects = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path: '/api/data/projects', headers: { Authorization: 'Bearer desktop-local' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const pid = projects.projects[0].id;

  // 关掉可能残留的指挥中心窗，保证从干净态开始
  const stale = await commandCenterTargetPresent();
  if (stale) {
    const c = await lib.connectTarget(stale);
    await lib.evalJs(c, 'window.close(); "closing"').catch(() => {});
    await sleep(1200);
  }

  // V1 + V2 — 欢迎页：顶栏无入口、左栏底部有入口
  const home = await goto('/');
  run.assert('V1_titlebar_entry_removed', home.state.titlebarEntry === false,
    `欢迎页顶栏右区无指挥中心按钮（titlebarEntry=${home.state.titlebarEntry}）`);
  run.assert('V2a_rail_entry_on_home', home.state.railEntry === true && /Ctrl\+Shift\+C/.test(home.state.railTitle || ''),
    `欢迎页左栏底部有指挥中心入口且带快捷键提示（title=${home.state.railTitle}）`);

  // V2b — 工作区与 /skills 常驻
  const chat = await goto(`/project/${pid}/chat`);
  const skills = await goto('/skills');
  run.assert('V2b_rail_entry_persistent', chat.state.railEntry === true && chat.state.titlebarEntry === false && skills.state.railEntry === true,
    `工作区 chat 左栏底部入口在场且顶栏无入口；/skills 亦常驻（chat rail=${chat.state.railEntry}，chat titlebar=${chat.state.titlebarEntry}，skills rail=${skills.state.railEntry}）`);

  // V3 — 点击弹出指挥中心独立窗
  let client = await attach();
  await lib.evalJs(client, `document.querySelector('[data-testid="sidebar-command-center"]').click(); 'clicked'`);
  let ccTarget = null;
  for (let i = 0; i < 10 && !ccTarget; i++) {
    await sleep(800);
    ccTarget = await commandCenterTargetPresent();
  }
  run.assert('V3_command_center_window_pops_out', !!ccTarget,
    `点击后指挥中心独立窗弹出（url=${ccTarget && ccTarget.url}）`);

  // V4 — 关闭验证窗，恢复现场
  if (ccTarget) {
    const cc = await lib.connectTarget(ccTarget);
    await lib.evalJs(cc, 'window.close(); "closing"').catch(() => {});
    await sleep(1500);
  }
  const gone = await commandCenterTargetPresent();
  run.assert('V4_command_center_closable', gone === null,
    `指挥中心窗可关闭（残留=${!!gone}）`);

  // 收尾：回工作区
  await goto(`/project/${pid}/chat`);

  return await run.finish({ observations: { pid, home: home.state, chat: chat.state, skills: skills.state } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
