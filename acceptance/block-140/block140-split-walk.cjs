#!/usr/bin/env node
'use strict';

/**
 * block140-split-walk.cjs — BLOCK-140 三断言实机走查（acceptance/block-140/）。
 *
 * 目标 job：
 *  W1/W3  tj_mus4vpzy_ztwn（volcano-plot · completed · project p_mus4u230_wvib，
 *         产物 report.html/volcano.png/volcano.svg/classified_table.csv/volcano.pdf；
 *         /lineage 实证 chain=3：deseq2→deg-standardizer→volcano-plot[current]）。
 *  W2     tj_murysfdj_vytq（deseq2 · completed · project p_murymf8c_6ao0；
 *         sqlite readonly 实证不在任何 result_workflow_graphs 行（root 与 nodes_json
 *         均不含），/lineage 实证 lineage=null）。
 * 深链 /project/:id/result?job= 打开（block-139 同款，Vite dev :3000）。
 *
 * W1 分屏+钉住保持：result 模式「钉住」（更多操作菜单内）→ aside[data-testid=
 *    artifact-pin-pane]（40% 副栏）出现 → 主区切换产物 → 副栏快照不变 →
 *    解除钉住恢复单栏。截图 split-pinned.png。
 * W2 空态隐藏：无图 job 打开 → [aria-label="血缘形态"] 切换器整组不在场
 *    （R-1 生效）。截图 empty-state-hidden.png。
 * W3 有链回归：链上 job → 切换器在场 + 条带节点「钉住」悬停可见（真实鼠标
 *    hover，opacity 0→1 实证）→ 点击钉住跨 job 快照入副栏（P1）。截图 lineage-pin.png。
 *
 * 证据：acceptance/block-140/split-walk.json（WalkResult 六字段）+ 3 截图。
 * 红线遵守：不 commit；不改 src/core/docs/test；只写本目录；后端零改动；
 * 侧效应仅视图级（钉住态=组件内状态，unpin 复原），零 LLM 消耗。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));

const EVIDENCE_DIR = __dirname;
const PROJECT_W1W3 = 'p_mus4u230_wvib';
const JOB_W1W3 = 'tj_mus4vpzy_ztwn';
const PROJECT_W2 = 'p_murymf8c_6ao0';
const JOB_W2 = 'tj_murysfdj_vytq';
const deepLink = (projectId, jobId) => `http://localhost:3000/project/${projectId}/result?job=${jobId}`;

let client;
const EVAL = (expr, timeoutMs) => lib.evalJs(client, expr, timeoutMs || 30000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (expr, { timeoutMs = 25000, label = '' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await EVAL(expr).catch(() => null);
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label || String(expr).slice(0, 90)} | last=${JSON.stringify(last).slice(0, 240)}`);
    await sleep(350);
  }
};

/** 轮询「应缺席」表达式：记录 settle 窗口内是否任何一次轮询出现过。 */
const absentAfterSettle = async (expr, { settleMs = 9000, label = '' } = {}) => {
  const deadline = Date.now() + settleMs;
  let polls = 0;
  let everSeen = null;
  while (Date.now() < deadline) {
    const v = await EVAL(expr).catch(() => null);
    polls += 1;
    if (v) { everSeen = v; break; }
    await sleep(400);
  }
  return { absent: !everSeen, polls, everSeen, label };
};

(async () => {
  const startedAt = new Date().toISOString();
  const checks = [];
  const assert = (id, pass, detail) => {
    checks.push({ id, pass: !!pass, detail: String(detail).slice(0, 1800) });
    lib.log(`${pass ? 'PASS' : 'FAIL'} ${id} :: ${String(detail).slice(0, 160)}`);
  };
  const screenshots = [];
  const sideEffects = [];

  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  client = await lib.connectTarget(target);
  try { await client.send('Page.bringToFront'); } catch { /* ignore */ }
  lib.log(`attached: ${String(target.url).slice(0, 110)}`);

  // ══ Step 0: 深链打开 W1/W3 result 视图（route 记录）══
  const LINK_W1W3 = deepLink(PROJECT_W1W3, JOB_W1W3);
  await EVAL(`location.href = ${JSON.stringify(LINK_W1W3)}; 'nav'`);
  await waitFor(`(() => ({ url: location.pathname + location.search, mounted: !!document.getElementById('root') }))()`,
    { label: 'deep link settled', timeoutMs: 40000 });
  await sleep(2500);
  const routeW1W3 = await EVAL(`location.pathname + location.search`);
  assert('P0_route_deeplink', String(routeW1W3) === `/project/${PROJECT_W1W3}/result?job=${JOB_W1W3}`,
    `route=${routeW1W3} deepLink=${LINK_W1W3}（深链 /result?job= 打开 result 视图；前端为本 run 新实现，Vite HMR 即时生效）`);

  const apiBase = await EVAL(`(window.petriDesktop && window.petriDesktop.backendConfig && window.petriDesktop.backendConfig.rApiBase) || 'http://localhost:57312'`);
  lib.log(`rApiBase=${apiBase}`);

  // HTTP 真相同源取数（R-1 判空与切换器同一 /lineage 端点）——两 job 一次取证
  const lineageW1W3 = await lib.fetchJson(`${apiBase}/result-studio/lineage?jobId=${JOB_W1W3}&projectId=${PROJECT_W1W3}`);
  const lineageW2 = await lib.fetchJson(`${apiBase}/result-studio/lineage?jobId=${JOB_W2}&projectId=${PROJECT_W2}`);
  const chainLen = lineageW1W3 && lineageW1W3.lineage ? lineageW1W3.lineage.chain.length : 0;
  assert('P0_lineage_truth_endpoints', chainLen === 3 && lineageW2 && lineageW2.lineage === null,
    `GET ${apiBase}/result-studio/lineage: W1W3(${JOB_W1W3}) chain=${chainLen} graphId=${lineageW1W3.graphId}；W2(${JOB_W2}) lineage=${JSON.stringify(lineageW2.lineage)} note=${JSON.stringify(lineageW2.note || '')} —— R-1 判空与切换器同源端点（fetchResultLineage → /result-studio/lineage）`);

  // ══ Step 1 (W1): 选 volcano.png → 「钉住」→ 副栏出现（40% 区）══
  await waitFor(`(() => { const sel = document.querySelector('select[aria-label="切换当前结果"]'); return sel && [...sel.options].some(o => o.value === 'volcano.png') ? true : null; })()`,
    { label: 'artifact picker has volcano.png', timeoutMs: 45000 });
  await EVAL(`(() => {
    const sel = document.querySelector('select[aria-label="切换当前结果"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'volcano.png');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'switched';
  })()`);
  await waitFor(`document.querySelector('[data-debug-selected-name="volcano.png"][data-debug-job-status="done"]') ? true : null`,
    { label: 'main shows volcano.png', timeoutMs: 40000 });
  await waitFor(`document.querySelector('[data-debug-selected-name] img[src*="volcano.png"]') ? true : null`,
    { label: 'volcano image rendered', timeoutMs: 30000 });

  // 「钉住」在「更多结果操作」弹出菜单内（CompactResultNavigator secondaryActions）
  const pinBtnInfo = await EVAL(`(() => {
    const details = [...document.querySelectorAll('details')].find(d => d.querySelector('summary[aria-label="更多结果操作"]'));
    if (!details) return { error: 'no-more-menu' };
    details.open = true;
    const btn = [...details.querySelectorAll('[class*="secondaryActions"] button')].find(b => (b.textContent || '').trim() === '钉住');
    if (!btn) return { error: 'no-pin-btn', menuItems: [...details.querySelectorAll('[class*="secondaryActions"] button')].map(b => (b.textContent || '').trim()).slice(0, 8) };
    return { found: true, disabled: btn.disabled, text: (btn.textContent || '').trim() };
  })()`);
  assert('W1_pin_button_present', !!pinBtnInfo && pinBtnInfo.found && !pinBtnInfo.disabled,
    `「钉住」按钮=更多结果操作菜单 secondaryActions 内（ResultArtifactShell.tsx:952，disabled=previewLoading）：${JSON.stringify(pinBtnInfo).slice(0, 220)}`);

  await EVAL(`(() => {
    const details = [...document.querySelectorAll('details')].find(d => d.querySelector('summary[aria-label="更多结果操作"]'));
    const btn = [...details.querySelectorAll('[class*="secondaryActions"] button')].find(b => (b.textContent || '').trim() === '钉住');
    btn.click();
    return 'clicked';
  })()`);
  const pinPane = await waitFor(`(() => {
    const pane = document.querySelector('aside[data-testid="artifact-pin-pane"]');
    if (!pane) return null;
    const split = pane.closest('[class*="artifactPinSplit"]');
    if (!split) return { paneFound: true, noSplit: true };
    const main = split.querySelector('[data-testid="artifact-pin-main"]');
    const sr = pane.getBoundingClientRect();
    const mr = main ? main.getBoundingClientRect() : null;
    const gr = split.getBoundingClientRect();
    return {
      ariaLabel: pane.getAttribute('aria-label'),
      title: pane.getAttribute('title'),
      mainFound: !!main,
      sideRatio: gr.width > 0 ? +(sr.width / gr.width).toFixed(3) : null,
      mainRatio: gr.width > 0 && mr ? +(mr.width / gr.width).toFixed(3) : null,
      sideRight: sr.left > (mr ? mr.left : 0),
      bodyHasImg: !!pane.querySelector('img[src*="volcano.png"]'),
      unpinBtn: !!pane.querySelector('button'),
    };
  })()`, { label: 'artifact-pin-pane appears', timeoutMs: 20000 });
  assert('W1_split_pane_appears', !!pinPane && pinPane.mainFound && pinPane.sideRatio !== null
      && pinPane.sideRatio >= 0.36 && pinPane.sideRatio <= 0.44 && pinPane.sideRight && pinPane.bodyHasImg,
    `钉住后副栏 aside[data-testid=artifact-pin-pane]：aria-label=${JSON.stringify(pinPane && pinPane.ariaLabel)} title(jobId)=${pinPane && pinPane.title} 主区在场=${pinPane && pinPane.mainFound} 副栏宽占比=${pinPane && pinPane.sideRatio}（60/40 固定比例 D2，40%±4pp）副栏在右=${pinPane && pinPane.sideRight} 副栏含 volcano.png 快照渲染=${pinPane && pinPane.bodyHasImg}（ArtifactPinPane.tsx:96-121）`);
  await EVAL(`(() => { const d = [...document.querySelectorAll('details')].find(x => x.querySelector('summary[aria-label="更多结果操作"]')); if (d) d.open = false; return 'menu-closed'; })()`);

  // ══ Step 2 (W1 续): 主区切换产物 → 副栏快照保持 ══
  await EVAL(`(() => {
    const sel = document.querySelector('select[aria-label="切换当前结果"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'classified_table.csv');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'switched';
  })()`);
  await waitFor(`document.querySelector('[data-debug-selected-name="classified_table.csv"]') ? true : null`,
    { label: 'main switched to classified_table.csv', timeoutMs: 40000 });
  // 等主区 CSV 表格真正渲染完成再取证/截图（双产物同屏：主区表 + 副栏图）
  await waitFor(`document.querySelector('[data-testid="artifact-pin-main"] table') ? true : null`,
    { label: 'main table rendered', timeoutMs: 30000 }).catch(() => lib.log('warn: main table not detected in 30s'));
  const keep = await EVAL(`(() => {
    const pane = document.querySelector('aside[data-testid="artifact-pin-pane"]');
    if (!pane) return { paneGone: true };
    return {
      ariaLabel: pane.getAttribute('aria-label'),
      imgStill: !!pane.querySelector('img[src*="volcano.png"]'),
      mainName: document.querySelector('[data-debug-selected-name]')?.getAttribute('data-debug-selected-name'),
      mainHasTable: !!document.querySelector('[data-testid="artifact-pin-main"] table, [data-testid="artifact-pin-main"] [class*="csvPreviewBody"]'),
    };
  })()`);
  assert('W1_pinned_keep_on_switch', !!keep && !keep.paneGone && /volcano[.]png/.test(String(keep.ariaLabel))
      && keep.imgStill && keep.mainName === 'classified_table.csv',
    `主区切到 classified_table.csv（data-debug-selected-name=${keep && keep.mainName}，plain-table 探针=${keep && keep.mainHasTable}——该 CSV 以科学交互表格网格渲染而非裸 <table>，见 split-pinned.png）后副栏不变：aria-label=${JSON.stringify(keep && keep.ariaLabel)} 快照 img 仍在=${keep && keep.imgStill} —— 钉住=视图级快照（pinnedArtifact 归宿主持有，主区 setSelectedName 不触碰，ResultArtifactShell.tsx:187/883-894）`);
  await Promise.race([lib.screenshotPng(client, EVIDENCE_DIR, 'split-pinned.png').catch((e) => lib.log('shot fail: ' + e.message)), sleep(6000)]);
  screenshots.push('acceptance/block-140/split-pinned.png');

  // ══ Step 3 (W1 收尾): 解除钉住 → 恢复单栏 ══
  await EVAL(`(() => {
    const btn = [...document.querySelectorAll('aside[data-testid="artifact-pin-pane"] button')].find(b => (b.textContent || '').trim() === '解除钉住');
    if (!btn) return 'no-unpin';
    btn.click();
    return 'clicked';
  })()`);
  const unpin = await waitFor(`(() => {
    const pane = document.querySelector('aside[data-testid="artifact-pin-pane"]');
    const split = document.querySelector('[class*="artifactPinSplit"]');
    if (pane || split) return null;
    return { paneGone: true, mainName: document.querySelector('[data-debug-selected-name]')?.getAttribute('data-debug-selected-name') };
  })()`, { label: 'unpin restores single column', timeoutMs: 15000 });
  assert('W1_unpin_restores_single', !!unpin && unpin.paneGone && unpin.mainName === 'classified_table.csv',
    `解除钉住后 aside 与 [class*=artifactPinSplit] 均不在场（单栏恢复），主区保持 classified_table.csv=${unpin && unpin.mainName}（ArtifactPinPane.tsx:44 未钉住即 return children，副栏 DOM 彻底不在场）`);

  // ══ Step 4 (W2): 无图 job → 切换器整组不在场 ══
  const LINK_W2 = deepLink(PROJECT_W2, JOB_W2);
  await EVAL(`location.href = ${JSON.stringify(LINK_W2)}; 'nav'`);
  await waitFor(`(() => ({ url: location.pathname + location.search, mounted: !!document.getElementById('root') }))()`,
    { label: 'W2 deep link settled', timeoutMs: 40000 });
  await waitFor(`(() => { const rv = document.querySelector('[data-debug-job-status]'); return rv && rv.getAttribute('data-debug-job-status') === 'done' ? true : null; })()`,
    { label: 'W2 result body done', timeoutMs: 45000 });
  const w2Probe = await absentAfterSettle(`(() => {
    const grp = document.querySelector('[role="group"][aria-label="血缘形态"]');
    if (grp) return { where: 'switcher' };
    if (document.querySelector('[aria-label="结果血缘链"]')) return { where: 'strip' };
    if (document.querySelector('[aria-label="结果血缘图"]')) return { where: 'graph' };
    return null;
  })()`, { settleMs: 9000, label: 'lineage switcher absence on graph-less job' });
  const w2State = await EVAL(`(() => {
    const rv = document.querySelector('[data-debug-selected-name]');
    return {
      status: rv?.getAttribute('data-debug-job-status'),
      selected: rv?.getAttribute('data-debug-selected-name'),
      artifactCount: rv?.getAttribute('data-debug-artifact-count'),
      placeholder: (document.querySelector('[class*="resultPlaceholder"]')?.textContent || '').trim().slice(0, 80),
      url: location.pathname + location.search,
    };
  })()`);
  assert('W2_empty_state_hidden', w2Probe.absent && w2State.url === `/project/${PROJECT_W2}/result?job=${JOB_W2}`,
    `无图 job（/lineage 实证 lineage=null，见 P0_lineage_truth_endpoints）完成态（job-status=done artifacts=${w2State && w2State.artifactCount} placeholder=${JSON.stringify(w2State && w2State.placeholder)}）下 9s settle 窗口轮询 ${w2Probe.polls} 次全程无 [aria-label="血缘形态"]/结果血缘链/结果血缘图（everSeen=${JSON.stringify(w2Probe.everSeen)}）—— R-1 生效：切换器整组不在场（LineageViewSwitch.tsx:57 !observation.ready → null），对照 BLOCK-138 时期空态常驻缺陷`);
  await Promise.race([lib.screenshotPng(client, EVIDENCE_DIR, 'empty-state-hidden.png').catch((e) => lib.log('shot fail: ' + e.message)), sleep(6000)]);
  screenshots.push('acceptance/block-140/empty-state-hidden.png');

  // ══ Step 5 (W3): 链上 job → 切换器在场 + 条带「钉住」悬停可见 ══
  await EVAL(`location.href = ${JSON.stringify(LINK_W1W3)}; 'nav'`);
  await waitFor(`(() => ({ url: location.pathname + location.search, mounted: !!document.getElementById('root') }))()`,
    { label: 'W3 deep link settled', timeoutMs: 40000 });
  const switcher = await waitFor(`(() => {
    const grp = document.querySelector('[role="group"][aria-label="血缘形态"]');
    if (!grp) return null;
    const btns = [...grp.querySelectorAll('button')].map(b => ({ t: (b.textContent || '').trim(), pressed: b.getAttribute('aria-pressed') }));
    const strip = document.querySelector('[aria-label="结果血缘链"]');
    const nodes = strip ? [...strip.querySelectorAll('[class*="nodeWrap"]')] : [];
    return { btns, nodeCount: nodes.length, downstream: strip?.getAttribute('data-downstream') };
  })()`, { label: 'W3 switcher + strip present', timeoutMs: 45000 });
  assert('W3_switcher_present_with_chain', !!switcher && switcher.nodeCount === 3
      && switcher.btns.some(b => b.t === '条带') && switcher.btns.some(b => b.t === '画布'),
    `链上 job 切换器在场：role=group[aria-label=血缘形态] 按钮=${JSON.stringify(switcher && switcher.btns)} 条带节点数=${switcher && switcher.nodeCount}（chain=3 同源 /lineage）data-downstream=${switcher && switcher.downstream} —— R-1 未误伤（chain≥2 维持渲染，LineageViewSwitch.tsx:44-46）`);

  // 真实鼠标 hover 第一个节点（上游 deseq2）→ .nodePin opacity 0→1。
  // 实证前置（2026-10-05 首轮走查实抓）：renderer 长时后台后 CSS transition 时钟停摆
  // （opacity 恒 0 且 transition 永远 running），Page.bringToFront 后恢复——
  // 故 hover 前先 bringToFront，并带重试读数循环。
  try { await client.send('Page.bringToFront'); } catch { /* ignore */ }
  await sleep(600);
  const nodeRect = await EVAL(`(() => {
    const wrap = document.querySelector('[aria-label="结果血缘链"] [class*="nodeWrap"]');
    if (!wrap) return null;
    wrap.scrollIntoView({ block: 'center', inline: 'center' });
    const r = wrap.getBoundingClientRect();
    const pin = wrap.querySelector('button[class*="nodePin"]');
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, pinLabel: pin?.getAttribute('aria-label'), pinOpacityBefore: pin ? getComputedStyle(pin).opacity : null };
  })()`);
  let pinVis = null;
  let hoverAttempts = 0;
  if (nodeRect && nodeRect.x != null) {
    for (hoverAttempts = 1; hoverAttempts <= 5; hoverAttempts += 1) {
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(nodeRect.x), y: Math.round(nodeRect.y), button: 'none' }).catch(() => {});
      await sleep(450);
      pinVis = await EVAL(`(() => {
        const wrap = document.querySelector('[aria-label="结果血缘链"] [class*="nodeWrap"]');
        const pin = wrap && wrap.querySelector('button[class*="nodePin"]');
        if (!pin) return null;
        const r = pin.getBoundingClientRect();
        const cs = getComputedStyle(pin);
        return { label: pin.getAttribute('aria-label'), text: (pin.textContent || '').trim(), opacity: cs.opacity, visible: cs.visibility, w: +r.width.toFixed(1), h: +r.height.toFixed(1), wrapHover: wrap.matches(':hover') };
      })()`);
      if (pinVis && pinVis.opacity === '1') break;
      try { await client.send('Page.bringToFront'); } catch { /* ignore */ }
      await sleep(400);
    }
  }
  assert('W3_pin_entry_hover_visible', !!pinVis && pinVis.opacity === '1' && pinVis.w > 0 && pinVis.h > 0 && /钉住/.test(pinVis.label || ''),
    `条带节点「钉住」入口悬停可见：aria-label=${JSON.stringify(pinVis && pinVis.label)} 文本=${pinVis && pinVis.text} opacity ${nodeRect && nodeRect.pinOpacityBefore}→${pinVis && pinVis.opacity} wrap:hover=${pinVis && pinVis.wrapHover}（真实 CDP mousemove @${nodeRect && Math.round(nodeRect.x)},${nodeRect && Math.round(nodeRect.y)}，尝试 ${hoverAttempts} 次；nodeWrap:hover → .nodePin opacity 1，LineageStrip.module.css:73-76；LineageStrip.tsx:58-68）rect=${pinVis && pinVis.w}×${pinVis && pinVis.h}`);
  await Promise.race([lib.screenshotPng(client, EVIDENCE_DIR, 'lineage-pin.png').catch((e) => lib.log('shot fail: ' + e.message)), sleep(6000)]);
  screenshots.push('acceptance/block-140/lineage-pin.png');

  // ══ Step 6 (W3 P1 加证): 点击条带「钉住」→ 跨 job 快照入副栏（上游 deseq2）══
  const crossPin = await EVAL(`(() => {
    const wrap = document.querySelector('[aria-label="结果血缘链"] [class*="nodeWrap"]');
    const pin = wrap && wrap.querySelector('button[class*="nodePin"]');
    if (!pin) return { error: 'no-pin' };
    pin.click();
    return { clicked: pin.getAttribute('aria-label') };
  })()`);
  const crossPane = await waitFor(`(() => {
    const pane = document.querySelector('aside[data-testid="artifact-pin-pane"]');
    if (!pane) return null;
    return { title: pane.getAttribute('title'), ariaLabel: pane.getAttribute('aria-label'), body: (pane.querySelector('img,iframe,table,pre') ? 'rendered' : 'empty') };
  })()`, { label: 'cross-job pin pane', timeoutMs: 20000 }).catch(() => null);
  assert('W3b_lineage_pin_crossjob_snapshot', !!crossPane && crossPane.title === 'tj_mus4uxjq_s69m',
    `点击条带「钉住」(${JSON.stringify(crossPin && crossPin.clicked)}) → 副栏 aside[title=jobId]=${crossPane && crossPane.title} aria-label=${JSON.stringify(crossPane && crossPane.ariaLabel)} 快照体=${crossPane && crossPane.body} —— 血缘节点钉住=跨 job 视图级快照（handleLineagePin → fetchCrossJobPinSnapshot 一次取数，ResultArtifactShell.tsx:224-228；目标上游节点 tj_mus4uxjq_s69m）`);
  if (crossPane) {
    await EVAL(`(() => {
      const btn = [...document.querySelectorAll('aside[data-testid="artifact-pin-pane"] button')].find(b => (b.textContent || '').trim() === '解除钉住');
      if (btn) btn.click();
      return 'unpinned';
    })()`);
    await waitFor(`document.querySelector('aside[data-testid="artifact-pin-pane"]') ? null : true`, { label: 'cleanup unpin', timeoutMs: 10000 }).catch(() => {});
    sideEffects.push('W3b 收尾：已点击「解除钉住」复原单栏；跨 job 钉住为视图级组件状态（零持久化、零写入）。');
  }

  // ══ 落盘 WalkResult ══
  const finishedAt = new Date().toISOString();
  const result = {
    route: LINK_W1W3 + `（深链实际落位 ${routeW1W3}；W2 段 route=/project/${PROJECT_W2}/result?job=${JOB_W2}）`,
    checks,
    screenshots,
    allPass: checks.length > 0 && checks.every((c) => c.pass),
    sideEffects,
    generatedAt: finishedAt,
  };
  result.startedAt = startedAt;
  const out = path.join(EVIDENCE_DIR, 'split-walk.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  lib.log(`evidence: ${out}`);
  lib.log(`allPass=${result.allPass}`);
  process.exit(result.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[block140-walk] FATAL', err && (err.stack || err.message));
  process.exit(2);
});
