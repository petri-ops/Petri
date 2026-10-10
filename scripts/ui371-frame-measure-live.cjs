#!/usr/bin/env node
'use strict';
/**
 * ui371-frame-measure-live.cjs — UI-371 会话框测量实机验收。
 *
 * 被测缺陷（实机实证）：`SessionFrameView` 在 chat（常驻）/ scheduled（条件挂载）两个
 * 互斥分支各渲染一个实例，二者共用同一个测量 ref；原实现（普通 refObject + 一次性
 * effect 挂 RO）导致
 *   ① scheduled 实例卸载时 React 对共用 refObject 调 `ref(null)` → current 置空且
 *      常驻实例不会被重新赋值 → 测量恒 0 → `summaryVisibility` 恒 'expanded'
 *      （摘要卡恒钉住被挤压）；
 *   ② RO 只 observe 一次 → 节点替换后观察已移除的旧节点，永不触发 → 尺寸冻在旧值。
 *
 * 断言（每条都是旧实现必红、修复后必绿的判别式）：
 *   A1 **不派发任何 resize**，仅把会话框宽度改为 700px（flex-basis）→ 形态应自动转
 *      'float'（旧实现 RO 已死 → 形态不变 → FAIL）
 *   A2 同上改为 1300px（≥1120）→ 形态应自动转 'column'
 *   A3 移除覆盖 → 形态应回到自然基线（仍不派发 resize）
 *   A4 **模式往返 + 测量触发**：保持 700px 覆盖，经 history/popstate 进 scheduled 再
 *      回 chat（触发条件实例卸载→挂载），随后派发一次 window resize 作为测量触发 →
 *      形态必须仍为 'float'（旧实现：ref 被置空 → resize 把宽度写成 0 → 恒 'expanded'
 *      → 形态变 column → FAIL）
 *   A5 采集完成时会话框宽度非 0 且与注入值一致
 *
 * 用法：dev 栈在跑（Vite:3000 + CDP:9222）→ `node scripts/ui371-frame-measure-live.cjs`
 * 证据：acceptance/ui-371/ui371-frame-measure-live.json
 */

const path = require('node:path');
const fs = require('node:fs');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-371');
const OVERRIDE_ID = 'ui371-acceptance-override';
const FRAME = '[class*="workspaceSessionFrame"]';

const STATE = `(function(){
  var wrap=document.querySelector('[class*="workspaceSummaryFloat"]');
  var col=document.querySelector('[class*="workspaceSummaryColumn"]');
  var frames=Array.prototype.slice.call(document.querySelectorAll('[class*="workspaceSessionFrame"]'));
  var visible=frames.filter(function(n){ return n.getBoundingClientRect().width > 0; });
  var card=document.querySelector('[class*="workspacePinnedSummary"]');
  return JSON.stringify({
    path: location.pathname,
    host: wrap?'float':(col?'column':'none'),
    frameCount: frames.length,
    visibleFrameWidth: visible.length ? Math.round(visible[0].getBoundingClientRect().width) : 0,
    frameWidths: frames.map(function(n){ return Math.round(n.getBoundingClientRect().width); }),
    cardInlineWidth: card ? card.style.width : null
  });
})()`;

const injectCss = (css) => `(function(){
  var el=document.getElementById('${OVERRIDE_ID}');
  if(!el){ el=document.createElement('style'); el.id='${OVERRIDE_ID}'; document.head.appendChild(el); }
  el.textContent=${JSON.stringify(css)};
  return el.textContent;})()`;
const removeCss = `(function(){var el=document.getElementById('${OVERRIDE_ID}'); if(el) el.remove(); return true;})()`;
const OPEN_SUMMARY = `(function(){
  var b=Array.prototype.slice.call(document.querySelectorAll('button'))
    .find(function(n){return (n.getAttribute('aria-label')||'').indexOf('展开摘要概览')>=0;});
  if(b){ b.click(); return 'opened'; } return 'already_open_or_absent';
})()`;
/** 合成一次测量触发（真实用户拖窗口会走同一入口），不改变任何尺寸。 */
const NUDGE = `(function(){ window.dispatchEvent(new Event('resize')); return 'nudged'; })()`;
/** 应用内路由跳转（react-router 监听 popstate）→ 触发 SessionFrameView 条件分支挂载/卸载。 */
const goRoute = (suffix) => `(function(){
  var m = location.pathname.match(/^\\/project\\/[^/]+/);
  if(!m) return 'no_project_route';
  history.pushState({}, '', m[0] + '${suffix}');
  window.dispatchEvent(new PopStateEvent('popstate'));
  return location.pathname;
})()`;

async function readState(client) {
  return JSON.parse(await lib.evalJs(client, STATE));
}

async function waitFor(client, predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(400);
    last = await readState(client);
    if (predicate(last)) return last;
  }
  return last;
}

(async () => {
  const run = lib.createRun({ name: 'ui371-frame-measure', evidenceDir: EVIDENCE_DIR });
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_main_target');
  const client = await lib.connectTarget(target);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  // 重新加载工作区（载入当前源码的 hook；同时清掉历史卡死状态）
  const projects = await (await fetch('http://127.0.0.1:3001/api/data/projects', { headers: { Authorization: 'Bearer desktop-local' } })).json();
  const all = projects.projects || [];
  const local = all.find((p) => (p.workspaceKind || p.workspace_kind) !== 'ssh') || all[0];
  await client.send('Page.navigate', { url: `http://localhost:3000/project/${local.id}/chat` });
  await sleep(5000);
  await lib.evalJs(client, OPEN_SUMMARY);
  await sleep(1500);

  const baseline = await readState(client);
  lib.log(`baseline: path=${baseline.path} host=${baseline.host} frame=${baseline.visibleFrameWidth}px`);
  const cases = { baseline };

  // A1 — 不派发 resize，仅改宽度为 700（<1120）→ 应自动 float
  await lib.evalJs(client, injectCss(`${FRAME}{flex:0 0 700px !important;width:700px !important;}`));
  cases.a1_float = await waitFor(client, (s) => s.host === 'float');
  lib.log(`A1 → host=${cases.a1_float.host} frame=${cases.a1_float.visibleFrameWidth}px`);

  // A2 — 同一路径改为 1300（≥1120）→ 应自动 column
  await lib.evalJs(client, injectCss(`${FRAME}{flex:0 0 1300px !important;width:1300px !important;}`));
  cases.a2_column = await waitFor(client, (s) => s.host === 'column');
  lib.log(`A2 → host=${cases.a2_column.host} frame=${cases.a2_column.visibleFrameWidth}px`);

  // A3 — 移除覆盖 → 回到自然基线（仍不派发 resize）
  await lib.evalJs(client, removeCss);
  cases.a3_restored = await waitFor(client, (s) => s.host === baseline.host);
  lib.log(`A3 → host=${cases.a3_restored.host} frame=${cases.a3_restored.visibleFrameWidth}px`);

  // A4 — 模式往返（条件实例卸载→挂载）+ 一次测量触发，宽度不得被写成 0
  await lib.evalJs(client, injectCss(`${FRAME}{flex:0 0 700px !important;width:700px !important;}`));
  await waitFor(client, (s) => s.host === 'float');
  const toScheduled = await lib.evalJs(client, goRoute('/scheduled'));
  await waitFor(client, (s) => s.path.endsWith('/scheduled') && s.frameCount >= 2, 8000);
  cases.a4_in_scheduled = await readState(client);
  const backToChat = await lib.evalJs(client, goRoute('/chat'));
  await waitFor(client, (s) => s.path.endsWith('/chat') && s.frameCount === 1, 8000);
  await lib.evalJs(client, NUDGE);          // 测量触发：旧实现此刻把宽度写成 0
  cases.a4_after_roundtrip = await waitFor(client, (s) => s.visibleFrameWidth > 0, 8000);
  lib.log(`A4 → scheduled(${toScheduled})→chat(${backToChat}) 后 host=${cases.a4_after_roundtrip.host} frame=${cases.a4_after_roundtrip.visibleFrameWidth}px frameCount=${cases.a4_after_roundtrip.frameCount}`);

  await lib.evalJs(client, removeCss);

  const a1 = cases.a1_float, a2 = cases.a2_column, a3 = cases.a3_restored, a4 = cases.a4_after_roundtrip;
  run.assert('A1 不派发 resize，仅改会话框宽度 → 形态自动跟随（float）', a1.host === 'float' && a1.visibleFrameWidth === 700,
    `host=${a1.host} frame=${a1.visibleFrameWidth}px`);
  run.assert('A2 同上改为 1300px（≥1120）→ 形态自动转 column', a2.host === 'column' && a2.visibleFrameWidth === 1300,
    `host=${a2.host} frame=${a2.visibleFrameWidth}px`);
  run.assert('A3 移除覆盖后回到自然基线形态（仍不派发 resize）', a3.host === baseline.host,
    `baseline=${baseline.host} now=${a3.host}`);
  run.assert('A4 模式往返 + 测量触发后宽度不被写成 0（形态仍随宽度）', a4.visibleFrameWidth > 0 && a4.host === 'float',
    `host=${a4.host} frame=${a4.visibleFrameWidth}px frameCount=${a4.frameCount}`);
  run.assert('A5 采集完成时会话框宽度与注入值一致（700px）', a4.visibleFrameWidth === 700, `frame=${a4.visibleFrameWidth}px`);

  client.close?.();
  await run.finish({
    cases,
    injectCss: `${FRAME}{flex:0 0 <w>px !important;width:<w>px !important;}`,
    note: 'A1–A3 全程不派发 resize（旧实现 RO 已死则形态不变）；A4 为缺陷①的现场重现路径（scheduled 实例卸载 + 一次测量触发）',
    userReport: '用户问询「sessionFrameWidth 会在窗口尺寸/分支切换后失联，导致摘要卡形态恒 pinned」',
  });
  process.exit(run.allPass ? 0 : 1);
})().catch((e) => { lib.log(`FATAL ${e.message}`); process.exit(2); });
