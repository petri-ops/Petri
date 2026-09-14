#!/usr/bin/env node
'use strict';
/**
 * ui368-projection-rail-live.cjs — UI-368 实机验收（BLOCK-87 L3-2）。
 *
 * 用户裁决「左上角的左侧展开栏就直接控制左侧栏的展开和收缩」：
 * 投影手机端撤掉独立 ☰ 浮层按钮，标题栏左上「展开/收起左侧栏」直接开合
 * AppRail 抽屉；投影环境隐藏死窗口控件（— □ ×）；抽屉开合不推挤顶栏。
 *
 * 探针方式：dev Electron 窗口（localhost:3000）+ Emulation 手机视口（390×844）
 * + 直接设置 data-projection 标志（同 gateway 垫片）后以一次面板开关强制
 * AppShell 重渲染进入投影手机形态。
 * 注：主进程有 will-navigate 守卫（跨源 preventDefault + shell.openExternal），
 * 且本 Electron CDP 不执行 Page.addScriptToEvaluateOnNewDocument（实测
 * identifier 返回但脚本不跑），故不做窗口内导航/文档前注入；「手机首屏抽屉
 * 默认收起」由 useWorkspacePanels 初始化语义保证（useState(!projectionNarrow)）
 * 并留待用户手机实测复核。
 *
 * 断言：
 *   V1 投影态：无 ☰ 浮层按钮（旧独立 ☰ 已撤）、抽屉收起、左上「展开左侧栏」在场；
 *   V2 点标题栏左上按钮 → 抽屉滑出（AppRail 在场）且顶栏 span 不被推挤（146px）；
 *   V3 点遮罩 → 抽屉收回；
 *   V4 抽屉内点 Skills 导航 → 路由跳转且抽屉自动收起；
 *   V5 投影下死窗口控件（最小化/最大化/关闭）不渲染。
 *
 * 跑完清视口模拟 + 摘标志 + reload，桌面端恢复原状。
 */

const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_main_target');
  return lib.connectTarget(target);
}

const MEASURE = `(function(){
  var q = function(sel) { return document.querySelector(sel); };
  var lt = q('button[aria-label="展开左侧栏"], button[aria-label="收起左侧栏"]');
  var header = q('header');
  return JSON.stringify({
    path: location.pathname,
    projection: document.documentElement.getAttribute('data-projection'),
    oldHamburger: !!q('[data-testid="projection-rail-toggle"]'),
    overlay: !!q('[data-testid="projection-rail-overlay"]'),
    railContent: !!q('[data-testid="projection-rail-overlay"] a, [data-testid="projection-rail-overlay"] button'),
    leftToggle: !!lt,
    leftToggleLabel: lt ? lt.getAttribute('aria-label') : null,
    minimized: !!q('button[aria-label="最小化"]'),
    viewportWidth: innerWidth,
    titlebarLeftSpan: header ? (header.style.getPropertyValue('--titlebar-left-span') || getComputedStyle(header).getPropertyValue('--titlebar-left-span') || '').trim() : null
  });
})()`;

(async () => {
  const run = lib.createRun({ name: 'ui368-projection-rail', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-368') });
  let client = await attach();

  // 前置归位：上轮探针可能把应用留在 /skills 等路由——先回首页（同源导航，
  // will-navigate 守卫放行），保证 V4 是一次真实的跨路由导航
  const pre = JSON.parse(await lib.evalJs(client, `JSON.stringify({ path: location.pathname })`) || '{}');
  if (pre.path !== '/') {
    await lib.evalJs(client, `location.href = 'http://localhost:3000/'; 'nav'`);
    await sleep(3000);
    client = await attach();
  }

  // 手机视口 + 投影标志（gateway 垫片同款 DOM 属性）
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await lib.evalJs(client, `document.documentElement.setAttribute('data-projection','1'); 'flagged'`);
  // 强制 AppShell 重渲染进入投影形态：点一次面板开关（无论当前开合，点击后
  // leftOpen=false —— 桌面挂载初值可能为 true，先归到「收起」再断言）
  await lib.evalJs(client, `(function(){ var b = document.querySelector('button[aria-label="展开左侧栏"], button[aria-label="收起左侧栏"]'); if (!b) return 'no_toggle'; b.click(); return 'clicked'; })()`);
  await sleep(1000);
  client = await attach();

  try {
    // V1 — 投影态默认面：无旧 ☰ 浮层按钮、抽屉收起、左上开关在场
    const v1 = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
    run.assert('V1_no_hamburger_drawer_closed', v1.projection === '1'
      && v1.oldHamburger === false && v1.overlay === false && v1.leftToggle === true,
      `无 ☰ 浮层、抽屉收起、左上开关在场（projection=${v1.projection}，oldHamburger=${v1.oldHamburger}，overlay=${v1.overlay}，leftToggle=${v1.leftToggle}，viewport=${v1.viewportWidth}）`);

    // V2 — 点标题栏左上按钮 → 抽屉滑出，顶栏 span 不被推挤（投影恒收起宽 146px）
    await lib.evalJs(client, `(function(){ var b = document.querySelector('button[aria-label="展开左侧栏"]'); if (!b) return 'no_toggle'; b.click(); return 'clicked'; })()`);
    await sleep(800);
    client = await attach();
    const v2 = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
    await lib.screenshotPng(client, path.join(__dirname, '..', 'acceptance', 'ui-368'), 'drawer-open.png');
    run.assert('V2_titlebar_toggle_opens_drawer', v2.overlay === true && v2.railContent === true
      && v2.leftToggleLabel === '收起左侧栏' && v2.titlebarLeftSpan === '146px',
      `左上按钮开抽屉（overlay=${v2.overlay}，railContent=${v2.railContent}，label=${v2.leftToggleLabel}，span=${v2.titlebarLeftSpan}）`);

    // V3 — 点遮罩 → 抽屉收回
    await lib.evalJs(client, `(function(){ var b = document.querySelector('button[aria-label="关闭导航"]'); if (!b) return 'no_backdrop'; b.click(); return 'clicked'; })()`);
    await sleep(600);
    client = await attach();
    const v3 = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
    run.assert('V3_backdrop_closes_drawer', v3.overlay === false && v3.leftToggleLabel === '展开左侧栏',
      `遮罩收回抽屉（overlay=${v3.overlay}，label=${v3.leftToggleLabel}）`);

    // V4 — 抽屉内点 Skills 导航 → 跳转且抽屉自动收起（轮询 5s 容忍软导航时序）
    await lib.evalJs(client, `(function(){ var b = document.querySelector('button[aria-label="展开左侧栏"]'); if (!b) return 'no_toggle'; b.click(); return 'opened'; })()`);
    await sleep(800);
    client = await attach();
    const navHit = await lib.evalJs(client, `(function(){
      var root = document.querySelector('[data-testid="projection-rail-overlay"]');
      if (!root) return 'no_overlay';
      var btns = Array.prototype.slice.call(root.querySelectorAll('button, a'));
      var target = btns.find(function(b) { return (b.textContent || '').indexOf('Skills') !== -1; });
      if (!target) return 'no_skills_item';
      target.click(); return 'clicked';
    })()`);
    let v4 = null;
    for (let i = 0; i < 10; i += 1) {
      await sleep(500);
      client = await attach();
      v4 = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
      if (v4.path === '/skills' && v4.overlay === false) break;
    }
    run.assert('V4_nav_closes_drawer', navHit === 'clicked' && v4.path === '/skills' && v4.overlay === false,
      `抽屉导航后自动收起（navHit=${navHit}，path=${v4.path}，overlay=${v4.overlay}，projection=${v4.projection}，label=${v4.leftToggleLabel}，oldHamburger=${v4.oldHamburger}，leftToggle=${v4.leftToggle}）`);

    // V5 — 投影下死窗口控件不渲染（真 Electron win32 本会渲染 — □ ×）
    const v5 = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
    run.assert('V5_window_controls_hidden', v5.minimized === false,
      `投影下窗口控件隐藏（minimized=${v5.minimized}）`);
  } finally {
    // 恢复桌面端：摘标志 + 回首页 + reload 回桌面初态 + 清视口模拟
    try {
      client = await attach();
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-projection'); location.href = 'http://localhost:3000/'; 'restore'`);
      await sleep(2500);
      client = await attach();
      await client.send('Emulation.clearDeviceMetricsOverride');
    } catch { /* best effort */ }
  }

  return await run.finish({});
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
