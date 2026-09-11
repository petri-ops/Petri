#!/usr/bin/env node
'use strict';
/**
 * ui351-summary-float-live.cjs — UI-351 实机验收：中栏变窄时摘要卡自动转悬浮。
 *
 * 用户反馈：摘要概览卡片随中间会话区变小应自动处于悬浮状态，目前不是（<780px 时
 * 直接消失）。修复：summaryVisibility 增加 'float' 档——中栏 <780px 时卡片以
 * 绝对定位悬浮层盖在会话右上方（compact 样式），不占列宽、不消失。
 *
 * 断言：
 *   V1 宽中栏：卡片为钉住列（workspaceSummaryColumn）；
 *   V2 窗口收窄（中栏 <780）：卡片自动转悬浮（workspaceSummaryFloat），会话区不被挤压；
 *   V3 悬浮态卡片可见（compact 样式、非空内容）；
 *   V4 窗口恢复后回到钉住列。
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resize(args) {
  execFileSync('powershell', ['-NoProfile', '-File', path.join(__dirname, 'resize-electron-window.ps1'), ...args], { stdio: 'pipe' });
}

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_page_target');
  return lib.connectTarget(target);
}

async function wait(ms) { await sleep(ms); }

const MEASURE = `(function(){
  var layout = document.querySelector('[class*="workspaceSessionLayout"]');
  var inset = document.querySelector('[class*="workspaceSessionInset"]');
  var col = document.querySelector('[class*="workspaceSummaryColumn"]');
  var floatEl = document.querySelector('[class*="workspaceSummaryFloat"]');
  var card = document.querySelector('[class*="workspacePinnedSummary"]');
  function w(el){ return el ? Math.round(el.getBoundingClientRect().width) : null; }
  return JSON.stringify({
    layoutW: w(layout), insetW: w(inset),
    pinned: !!col, floating: !!floatEl,
    cardVisible: !!card && card.getBoundingClientRect().height > 100,
    cardText: card ? card.textContent.slice(0, 40) : null
  });
})()`;

(async () => {
  const run = lib.createRun({ name: 'ui351-summary-float', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-351') });
  const http = require('node:http');
  const projects = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path: '/api/data/projects', headers: { Authorization: 'Bearer desktop-local' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const pid = projects.projects[0].id;

  let client = await attach();
  // 前置：恢复默认宽窗口（排除上一次运行的窗口状态残留）
  resize([]);
  await wait(2000);
  client = await attach();
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${pid}'; 'nav'`);
  await wait(4000);
  client = await attach();

  // 打开摘要卡（顶栏「展开摘要概览」）
  const toggled = await lib.evalJs(client, `(function(){
    var b = document.querySelector('button[aria-label="展开摘要概览"]');
    if (!b) return 'toggle_missing';
    b.click(); return 'clicked';
  })()`).catch(() => 'err');
  await wait(1500);

  /* V1 — 宽中栏：钉住列 */
  const wide = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  run.assert('V1_wide_pinned_column', wide.pinned === true && wide.floating === false && wide.cardVisible === true,
    `宽中栏（layout=${wide.layoutW}px）卡片为钉住列（pinned=${wide.pinned}，悬浮=${wide.floating}）`);

  /* V2+V3 — 收窄窗口 → 自动悬浮 */
  resize(['narrow', '-Width', '1200', '-Height', '900']);
  await wait(2500);
  const narrow = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  const squeezed = narrow.insetW !== null && narrow.layoutW !== null && narrow.insetW < narrow.layoutW * 0.8;
  run.assert('V2_narrow_auto_float', narrow.pinned === false && narrow.floating === true && squeezed === false,
    `中栏收窄（layout=${narrow.layoutW}px，会话区=${narrow.insetW}px ≈ 全宽）卡片自动转悬浮（pinned=${narrow.pinned}，floating=${narrow.floating}，会话被挤压=${squeezed}）`);
  run.assert('V3_float_card_visible', narrow.cardVisible === true,
    `悬浮卡片可见（cardVisible=${narrow.cardVisible}，内容预览=${(narrow.cardText || '').slice(0, 24)}）`);

  /* V4 — 恢复窗口 → 回钉住列 */
  resize([]);
  await wait(2500);
  const restored = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  run.assert('V4_restore_pinned', restored.pinned === true && restored.floating === false,
    `窗口恢复后卡片回钉住列（pinned=${restored.pinned}，悬浮=${restored.floating}）`);

  return await run.finish({ observations: { wide, narrow, restored } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
