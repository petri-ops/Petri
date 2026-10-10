#!/usr/bin/env node
'use strict';
/**
 * ui360-titlebar-mode-live.cjs — UI-360 实机验收：摘要开关/右栏按模式裁剪。
 *
 * 背景：顶栏「展开摘要概览」开关在 TitleBarCenterZone 无条件渲染（只有
 * /skills /knowledge /backend 走 bare 分支），而摘要卡只在 chat/scheduled 模式
 * 存在 → 欢迎页（新建任务）等路由上是死开关；「插件」入口 =
 * openWorkspaceMode('plugins')，PluginStorePanel 占满中栏但右侧栏仍渲染。
 *
 * 断言：
 *   V1 欢迎页 /：摘要开关不在场（死开关裁剪）；
 *   V2 工作区 chat：摘要开关在场、右栏可见、右栏开关在场；
 *   V3 工作区 plugins：摘要开关与右栏开关不在场、右栏收起（宽 0/aria-hidden）、
 *      底部终端开关仍在；
 *   V4 回到 chat：右栏恢复可见（用户偏好保持）；
 *   V5 /skills：摘要开关与右栏均不在场（基线不变）。
 */

const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
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

const MEASURE = `(function(){
  var q = function(sel) { return document.querySelector(sel); };
  var summaryBtn = q('button[aria-label="展开摘要概览"], button[aria-label="收起摘要概览"]');
  var rightBtn = q('button[aria-label="展开右侧栏"], button[aria-label="收起右侧栏"]');
  var termBtn = q('button[aria-label="展开底部终端"], button[aria-label="收起底部终端"]');
  var rail = q('aside[class*="rightCol"]');
  return JSON.stringify({
    summary: !!summaryBtn,
    rightToggle: !!rightBtn,
    terminalToggle: !!termBtn,
    railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : null,
    railHidden: rail ? rail.getAttribute('aria-hidden') === 'true' : null,
    railMode: rail ? rail.getAttribute('data-workspace-mode') : null
  });
})()`;

const nav = (p) => `location.href = 'http://localhost:3000${p}'; 'nav'`;

async function goto(url) {
  let client = await attach();
  await lib.evalJs(client, nav(url));
  await sleep(3500);
  client = await attach();
  return JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
}

(async () => {
  const run = lib.createRun({ name: 'ui360-titlebar-mode', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-360') });
  const projects = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path: '/api/data/projects', headers: { Authorization: 'Bearer desktop-local' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const pid = projects.projects[0].id;

  // V1 — 欢迎页（新建任务落点）
  const home = await goto('/');
  run.assert('V1_home_summary_toggle_absent', home.summary === false && home.rightToggle === false && home.railWidth === null,
    `欢迎页摘要开关/右栏开关/右栏均不在场（summary=${home.summary}，rightToggle=${home.rightToggle}，rail=${home.railWidth}）`);

  // V2 — 工作区 chat：全量在场
  const chat = await goto(`/project/${pid}/chat`);
  run.assert('V2_chat_full_chrome', chat.summary === true && chat.rightToggle === true && chat.railWidth !== null && chat.railWidth > 0,
    `chat 模式摘要开关在场、右栏可见（railWidth=${chat.railWidth}，mode=${chat.railMode}）`);

  // V3 — plugins 全屏工作面：右栏与摘要开关裁剪，终端开关保留
  const plugins = await goto(`/project/${pid}/plugins`);
  run.assert('V3_plugins_rail_and_summary_trimmed',
    plugins.summary === false && plugins.rightToggle === false
    && plugins.terminalToggle === true
    && plugins.railMode === 'plugins' && (plugins.railWidth === 0 || plugins.railHidden === true),
    `plugins 模式摘要开关/右栏开关不在场、右栏收起（railWidth=${plugins.railWidth}，ariaHidden=${plugins.railHidden}，mode=${plugins.railMode}，terminal=${plugins.terminalToggle}）`);

  // V4 — 回 chat：右栏恢复（rightOpen 偏好未被模式切换破坏）
  const restored = await goto(`/project/${pid}/chat`);
  run.assert('V4_chat_rail_restored', restored.rightToggle === true && restored.railWidth !== null && restored.railWidth > 0,
    `回到 chat 右栏恢复可见（railWidth=${restored.railWidth}）`);

  // V5 — /skills 基线不变
  const skills = await goto('/skills');
  run.assert('V5_skills_unchanged', skills.summary === false && skills.railWidth === null,
    `/skills 摘要开关与右栏不在场（基线保持）`);

  // 收尾：回工作区
  await goto(`/project/${pid}/chat`);

  return await run.finish({ observations: { pid, home, chat, plugins, restored, skills } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
