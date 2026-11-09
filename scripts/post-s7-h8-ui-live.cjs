#!/usr/bin/env node
/**
 * scripts/post-s7-h8-ui-live.cjs — post-S7 H8 CDP 代行 UI 腿（布局几何基线 + A11Y 在场断言）。
 *
 * 分层纪律（五类证据不互冒）：
 *  - 本脚本产出的是 **DOM 与实机** 证据（evidenceClass=cdp-dom-assertion）。
 *  - 不产出人眼观感结论：暗色对比度、VoiceOver 朗读、截图观感仍 pending_human_eye。
 *  - 不产出视觉绿：UI-702 / UI-699 等条目的 in_progress 状态不因本脚本翻 verified。
 *
 * 前置同 post-s7-dom-budget-live.cjs（无窗口 dev 栈 + 9223 默认离屏实例 + 隔离库）。
 * 用法：node scripts/post-s7-h8-ui-live.cjs
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h8/ui-live.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GEOMETRY_EXPR = `JSON.stringify({
  viewport: { width: innerWidth, height: innerHeight },
  blocks: {
    root: (() => { const r = document.getElementById('root')?.getBoundingClientRect(); return r ? {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)} : null; })(),
    scMessages: (() => { const r = document.querySelector('.sc-messages')?.getBoundingClientRect(); return r ? {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)} : null; })(),
    firstConvItem: (() => { const r = document.querySelector('[class*=convItem]')?.getBoundingClientRect(); return r ? {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)} : null; })(),
  },
  overflow: { docScrollWidth: document.documentElement.scrollWidth, docClientWidth: document.documentElement.clientWidth, bodyScrollWidth: document.body.scrollWidth },
  a11y: {
    contentVisibilityAutoNodes: [...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).contentVisibility==='auto').length,
    statusRoles: document.querySelectorAll('[role=status],[aria-live]').length,
    sliderRoles: document.querySelectorAll('[role=slider]').length,
    separatorRoles: document.querySelectorAll('[role=separator]').length,
    inertNodes: document.querySelectorAll('[inert]').length,
    logRoles: document.querySelectorAll('[role=log]').length,
    toastHistoryText: document.body.innerText.includes('通知历史'),
  },
})`;

async function setViewport(client, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(1200);
}

(async () => {
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /localhost:3000/);
  if (!pages.length) throw new Error('no_test_page_on_9223');
  const client = await lib.connectTarget(pages[0]);
  await client.send('Page.bringToFront').catch(() => {});

  const baseline = JSON.parse(await lib.evalJs(client, GEOMETRY_EXPR));
  await setViewport(client, Math.round(baseline.viewport.width * 2), Math.round(baseline.viewport.height * 2));
  const doubled = JSON.parse(await lib.evalJs(client, GEOMETRY_EXPR));
  await setViewport(client, Math.round(baseline.viewport.width / 2), Math.round(baseline.viewport.height / 2));
  const halved = JSON.parse(await lib.evalJs(client, GEOMETRY_EXPR));
  await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await sleep(800);
  const restored = JSON.parse(await lib.evalJs(client, GEOMETRY_EXPR));

  let sourceCommit = null;
  try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* 非 git 环境如实留空 */ }

  const checks = {
    // CDP 可代行的 DOM 断言（不是视觉绿）
    contentVisibilityInSessionRows: baseline.a11y.contentVisibilityAutoNodes > 0,
    statusRegionPresent: baseline.a11y.statusRoles > 0,
    noHorizontalOverflowAtBaseline: baseline.overflow.docScrollWidth <= baseline.overflow.docClientWidth + 1,
    noHorizontalOverflowWhenHalved: halved.overflow.docScrollWidth <= halved.overflow.docClientWidth + 1,
    geometryRestoredAfterOverride: Math.abs(restored.viewport.width - baseline.viewport.width) <= 1,
  };
  const evidence = {
    schemaVersion: 1,
    kind: 'post-s7-h8-ui-live',
    sourceCommit,
    platform: os.platform() + '-' + os.arch(),
    command: 'node scripts/post-s7-h8-ui-live.cjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'cdp-dom-assertion',
    humanEyeEquivalent: false,
    visualVerified: false,
    verdict: 'measured',
    note: '几何基线供 CenterPanel 双层同名 layout 收敛做「拆前基线」；暗色观感 / VoiceOver 朗读 / 截图过目仍待人眼，本脚本不代答。',
    phases: { baseline, doubled, halved, restored },
    checks,
    pendingHumanEye: [
      'UI-702 通知历史：暗色态对比度与 4 秒后按钮在场（需触发一条 error toast，当前页面无触发通道）',
      'UI-702 viewer 降级原因：VoiceOver 朗读 role=status（需语音确认，DOM 断言不可替代）',
      'UI-698/699 观感：content-visibility 在场已由 DOM 断言，但「观感无异常」需人眼',
      'B-10 分屏 slider：需打开分屏态后读屏确认（当前页面 sliderRoles=0 因分屏未打开，不判不通过）',
    ],
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log('[h8-ui] evidence ->', OUT);
  console.log('[h8-ui] checks', JSON.stringify(checks));
  console.log('[h8-ui] viewport', JSON.stringify({ base: baseline.viewport, doubled: doubled.viewport, halved: halved.viewport }));
  process.exit(0);
})().catch((e) => { console.error('[h8-ui] FATAL', e.stack || e.message); process.exit(1); });
