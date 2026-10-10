#!/usr/bin/env node
'use strict';

/**
 * block139-selection-walk.cjs — BLOCK-139 选择回路实机三断言走查（acceptance/block-139/）。
 *
 * 目标 job：tj_mus4uxjq_s69m（deseq2 · completed · project p_mus4u230_wvib，
 * deg_table.csv 交互表格，manifest 实证 entityType=gene / idField=gene / mode=table）。
 * 深链 /project/:id/result?job= 打开。
 *
 * S1 选中→composer 结构化注入：勾选表格行 → getCopilotContext().activeArtifact.selection
 *    （D2 注入通道组装面）= SelectionContext v1 投影（entityType+样本≤12+hash，有界）。
 * S2 继续分析携实体列表：点击菜单项 → window 捕获 petri:copilot-ask 载荷（组装层实据，
 *    prompt 含 jobId+artifact+「用户已选中 N 个 gene（标记列 gene）：样本」+selectionId 三态）；
 *    同时 CDP Fetch 拦截 api/ai/agent 发送（任意本地端口——实测 rApiBase 是动态端口，非 3001）
 *    并 BlockedByClient——真实网络发送被阻断，不消耗 LLM；被拦请求体作为第二实据。
 * S3 mark-to-entity：window 捕获 petri:selection-bus 事件流（实例无关真相通道；模块
 *    动态 import 按 performance 资源条目解析真实 URL——Vite HMR t-戳会让裸 URL 造出
 *    第二实例，2026-10-04 首轮走查实抓）——落总线 selection.entityType + 顶层 idField。
 *
 * 证据：acceptance/block-139/selection-walk.json + 3 截图。
 * 红线遵守：不 commit；不改 src/core/docs/test；只写本目录；不杀后端。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));

const EVIDENCE_DIR = __dirname;
const PROJECT_ID = process.env.B139_PROJECT || 'p_mus4u230_wvib';
const JOB_ID = process.env.B139_JOB || 'tj_mus4uxjq_s69m';
const DEEP_LINK = `http://localhost:3000/project/${PROJECT_ID}/result?job=${JOB_ID}`;
const MANIFEST = { artifactId: 'deg_table', entityType: 'gene', idField: 'gene' }; // HTTP 实证：/api/result-studio/interaction?jobId=…&artifact=deg_table.csv

let client;
const EVAL = (expr, timeoutMs) => lib.evalJs(client, expr, timeoutMs || 30000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (expr, { timeoutMs = 25000, label = '' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await EVAL(expr).catch(() => null);
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label || String(expr).slice(0, 90)} | last=${JSON.stringify(last).slice(0, 200)}`);
    await sleep(350);
  }
};

// ── CDP Fetch 拦截：阻断 /api/ai/agent 真实发送（S2 组装层取证不消耗 LLM）──
// 端口用 *：实测 Electron 后端 rApiBase 是动态端口（57312），不是 3001。
const intercepted = [];
async function armSendInterceptor() {
  try {
    await client.send('Fetch.enable', {
      patterns: [{ urlPattern: '*://localhost:*/api/ai/agent*', requestStage: 'Request' }],
    });
  } catch (e) {
    return { armed: false, reason: String(e.message).slice(0, 120) };
  }
  client.on('Fetch.requestPaused', async (params) => {
    const isAgentPost = params.request.method === 'POST' && /\/api\/ai\/agent(\?|$)/.test(params.request.url);
    if (!isAgentPost) {
      try { await client.send('Fetch.continueRequest', { requestId: params.requestId }); } catch { /* 车间已关 */ }
      return;
    }
    let body = null;
    try {
      const payload = await client.send('Fetch.getRequestPayload', { requestId: params.requestId });
      if (payload && payload.postData) body = Buffer.from(payload.postData, 'base64').toString('utf8').slice(0, 6000);
    } catch { /* getRequestPayload 并非对所有请求可用 */ }
    intercepted.push({
      url: params.request.url,
      method: params.request.method,
      postData: body,
      at: new Date().toISOString(),
    });
    try { await client.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }); } catch { /* 车间已关 */ }
  });
  return { armed: true };
}

// ── 页面内仪器：petri 事件捕获 + 按真实加载 URL 动态 import 模块单例 ──
async function busInstrument() {
  return EVAL(`(async () => {
    if (!window.__b139) {
      window.__b139 = { busEvents: [], askEvents: [] };
      window.addEventListener('petri:selection-bus', (e) => {
        window.__b139.busEvents.push({ at: Date.now(), state: e.detail });
      });
      window.addEventListener('petri:copilot-ask', (e) => {
        window.__b139.askEvents.push({ at: Date.now(), detail: e.detail });
      });
    }
    // HMR t-戳会让裸 URL import 造出第二实例——按 performance 资源条目找应用真实加载的 URL。
    const resUrls = performance.getEntriesByType('resource').map(r => r.name);
    const pickUrl = (stem) => {
      const hit = resUrls.find(u => u.includes(stem));
      return hit || stem;
    };
    const out = { busEventCount: window.__b139.busEvents.length };
    try {
      const bus = await import(pickUrl('/src/lib/selectionBus.ts'));
      out.bus = { snapshot: bus.getSelectionBusState(), via: pickUrl('/src/lib/selectionBus.ts').split('?')[0] + (pickUrl('/src/lib/selectionBus.ts').includes('?') ? '(stamped)' : '(bare)') };
    } catch (e) { out.busError = String(e.message).slice(0, 120); }
    try {
      const ctx = await import(pickUrl('/src/lib/copilotContext.ts'));
      out.activeArtifact = ctx.getCopilotContext().activeArtifact || null;
    } catch (e) { out.ctxError = String(e.message).slice(0, 120); }
    return out;
  })()`, 20000);
}

(async () => {
  const startedAt = new Date().toISOString();
  const checks = [];
  const assert = (id, pass, detail) => {
    checks.push({ id, pass: !!pass, detail: String(detail).slice(0, 1800) });
    lib.log(`${pass ? 'PASS' : 'FAIL'} ${id} :: ${String(detail).slice(0, 150)}`);
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
  assert('P0_cdp_attached', true, `target=${String(target.url).slice(0, 110)}`);

  // ── Step 1: 先武装拦截器（跨同 target 导航持久），再深链打开 result 视图 ──
  const interceptor = await armSendInterceptor();
  await EVAL(`location.href = ${JSON.stringify(DEEP_LINK)}; 'nav'`);
  await waitFor(`(() => ({ url: location.pathname + location.search, mounted: !!document.getElementById('root') }))()`,
    { label: 'deep link settled', timeoutMs: 40000 });
  await sleep(2500);
  const route = await EVAL(`location.pathname + location.search`);
  const routeOk = String(route).includes(`/project/${PROJECT_ID}`) && String(route).includes(`job=${JOB_ID}`);
  assert('P1_route_deeplink', routeOk, `route=${route} deepLink=${DEEP_LINK}`);

  await busInstrument();
  const apiBase = await EVAL(`(window.petriDesktop && window.petriDesktop.backendConfig && window.petriDesktop.backendConfig.rApiBase) || 'default'`);
  lib.log(`rApiBase=${apiBase}`);

  // ── Step 2: 选 deg_table.csv → 交互表格挂载 ──
  await waitFor(`(() => { const opts = [...document.querySelectorAll('option')]; return opts.some(o => /deg_table\\.csv/.test(o.value || '')) ? true : null; })()`,
    { label: 'artifact picker has deg_table', timeoutMs: 45000 });
  const switchState = await EVAL(`(() => {
    const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /deg_table\\.csv$/.test(o.value)));
    if (!sel) return 'no-picker';
    const want = [...sel.options].find(o => /deg_table\\.csv$/.test(o.value)).value;
    if (sel.value === want) return 'already';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, want);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'switched:' + want;
  })()`);
  lib.log(`artifact switch: ${switchState}`);
  const tableMounted = await waitFor(`(() => {
    const vp = document.querySelector('[aria-label="科学结果表格"]');
    if (!vp) return null;
    return { checkboxes: vp.querySelectorAll('input[type=checkbox][aria-label^="选择 "]').length };
  })()`, { label: 'interactive table + row checkboxes', timeoutMs: 45000 });
  assert('P3_interactive_table_mounted', !!tableMounted && tableMounted.checkboxes > 0, JSON.stringify(tableMounted));

  // ── Step 3: S3 前置——总线 D1 绑定态（事件流真相，实例无关）──
  const binding = await waitFor(`(() => {
    const evs = window.__b139.busEvents;
    const bindEvent = [...evs].reverse().find(e => e.state && e.state.artifactId === ${JSON.stringify(MANIFEST.artifactId)});
    const tail = evs.length ? evs[evs.length - 1].state : null;
    return bindEvent ? { artifactId: bindEvent.state.artifactId, selectionAtBind: !!bindEvent.state.selection, tailArtifactId: tail ? tail.artifactId : null, eventCount: evs.length } : null;
  })()`, { label: 'bus D1 binding event for deg_table', timeoutMs: 25000 }).catch(() => null);
  assert('P4_bus_artifact_bound', !!binding && binding.artifactId === MANIFEST.artifactId,
    `busBindingEvent={artifactId:${binding && binding.artifactId}, selectionAtBind:${binding && binding.selectionAtBind}, tailArtifactId:${binding && binding.tailArtifactId}, eventCount:${binding && binding.eventCount}}（petri:selection-bus 事件流实证 setSelectionBusArtifact 生产绑定=useArtifactInteractionSelection.ts:227-231；事件通道为实例无关真相——模块动态 import 裸 URL 会因 Vite HMR t-戳得到第二实例，首轮走查实抓后改为按 performance 资源 URL 解析）`);

  // ── Step 4: 先清残留持久选择（selectionDurable=true 会恢复旧选），再勾 3 行 → S3 ──
  const cleared = await EVAL(`(() => {
    const vp = document.querySelector('[aria-label="科学结果表格"]');
    if (!vp) return { error: 'no-table' };
    const checked = [...vp.querySelectorAll('input[type=checkbox][aria-label^="选择 "]')].filter(b => b.checked);
    for (const b of checked) b.click();
    return { cleared: checked.map(b => b.getAttribute('aria-label').replace(/^选择\\s*/, '')) };
  })()`);
  lib.log(`pre-cleared restored rows: ${JSON.stringify(cleared)}`);
  if (cleared && Array.isArray(cleared.cleared) && cleared.cleared.length > 0) {
    await waitFor(`(() => {
      const evs = window.__b139.busEvents;
      const tail = evs.length ? evs[evs.length-1].state : null;
      return tail && tail.selection === null ? true : null;
    })()`, { label: 'bus selection cleared', timeoutMs: 15000 }).catch(() => null);
    sideEffects.push(`走查前置：清除了该 artifact 上已持久化的历史选择（selectionDurable=true 恢复了 ${JSON.stringify(cleared.cleared)}），清除经既有 deleteResultStudioSelection 持久化流，属验收项目内正常选择操作。`);
  }

  const picked = await EVAL(`(() => {
    const vp = document.querySelector('[aria-label="科学结果表格"]');
    const boxes = [...(vp ? vp.querySelectorAll('input[type=checkbox][aria-label^="选择 "]') : [])].slice(0, 3);
    const picked = [];
    for (const b of boxes) {
      if (b.checked) continue;
      b.click();
      picked.push(b.getAttribute('aria-label').replace(/^选择\\s*/, ''));
    }
    return picked;
  })()`);
  lib.log(`clicked rows: ${JSON.stringify(picked)}`);
  const afterClick = await waitFor(`(() => {
    const evs = window.__b139.busEvents;
    const st = evs.length ? evs[evs.length - 1].state : null;
    if (!st || !st.selection) return null;
    return { count: st.selection.entityIdCount, ids: st.selection.entityIds, entityType: st.selection.entityType, idField: st.idField, artifactId: st.artifactId, origin: st.selection.origin };
  })()`, { label: 'bus selection event with selection', timeoutMs: 20000 });
  assert('S3_mark_to_entity_bus', !!afterClick
    && afterClick.entityType === MANIFEST.entityType
    && afterClick.idField === MANIFEST.idField
    && afterClick.count === picked.length
    && JSON.stringify((afterClick.ids || []).slice().sort()) === JSON.stringify(picked.slice().sort()),
    `busState={artifactId:${afterClick && afterClick.artifactId}, entityType:${afterClick && afterClick.entityType}, idField:${afterClick && afterClick.idField}, count:${afterClick && afterClick.count}, ids:${JSON.stringify(afterClick && afterClick.ids)}, origin:${afterClick && afterClick.origin}} clicked=${JSON.stringify(picked)} —— mark-to-entity P1 契约：选择落总线带 entityType（selection 词汇）+ idField=${MANIFEST.idField}（setSelectionBusSelection(selection,{idField:manifest.idField})，镜像点 useArtifactInteractionSelection.ts:233-235，manifest HTTP 实证 entityType=${MANIFEST.entityType}/idField=${MANIFEST.idField}）`);

  // agentProjection 恒等投影（有界）
  const busTail = await EVAL(`(() => { const e = window.__b139.busEvents[window.__b139.busEvents.length - 1]; return e ? { agentProjection: e.state.agentProjection } : null; })()`);
  const proj = busTail && busTail.agentProjection;
  assert('S3b_agent_projection_identity', !!proj
    && proj.entityType === MANIFEST.entityType
    && proj.entityIdCount === picked.length
    && Array.isArray(proj.sampleEntityIds)
    && proj.sampleEntityIds.length <= 12,
    `agentProjection=${JSON.stringify(proj).slice(0, 400)}（summarizeSelectionForAgent 恒等投影：实体类型+样本 ${proj ? proj.sampleEntityIds.length : 'n/a'} 条 ≤12 有界）`);
  await Promise.race([lib.screenshotPng(client, EVIDENCE_DIR, 'mark-to-entity.png').catch((e) => lib.log('shot fail: ' + e.message)), sleep(5000)]);
  screenshots.push('acceptance/block-139/mark-to-entity.png');

  // ── Step 5: S1 composer 结构化注入（D2 通道组装面 = copilotContext.activeArtifact.selection）──
  const s1 = await busInstrument();
  const inj = s1.activeArtifact;
  const selSummary = inj && inj.selection;
  const boundedOk = !!selSummary
    && selSummary.entityType === MANIFEST.entityType
    && selSummary.entityIdCount === picked.length
    && Array.isArray(selSummary.sampleEntityIds)
    && selSummary.sampleEntityIds.length <= 12
    && selSummary.sampleEntityIds.length === Math.min(selSummary.entityIdCount, 12)
    && typeof selSummary.entityIdsHash === 'string' && selSummary.entityIdsHash.length === 64;
  assert('S1_composer_structured_injection', boundedOk,
    `copilotContext.activeArtifact={jobId:${inj && inj.jobId}, name:${inj && inj.name}, entityType:${inj && inj.entityType}, idField:${inj && inj.idField}, selectionId:${inj && inj.selectionId}} selection=${JSON.stringify(selSummary).slice(0, 520)} —— D2 注入通道（useResultStudioEditContext.ts:167-196 copilotActiveArtifact → useSetCopilotContext）SelectionContext v1 投影：实体类型 ${selSummary && selSummary.entityType}+样本 ${selSummary ? selSummary.sampleEntityIds.length : 'n/a'} 条（≤12 有界不泛滥）+entityIdsHash SHA-256 坐标`);

  // DOM 面：viewer 选中行回显 + 选择摘要 chip
  const domSel = await EVAL(`(() => {
    const vp = document.querySelector('[aria-label="科学结果表格"]');
    if (!vp) return null;
    const checked = [...vp.querySelectorAll('input[type=checkbox][aria-label^="选择 "]')].filter(b => b.checked).map(b => b.getAttribute('aria-label').replace(/^选择\\s*/, ''));
    const chip = [...document.querySelectorAll('[class*="selection"], [class*="Selection"]')].map(n => (n.textContent || '').trim()).filter(t => /已选择/.test(t)).slice(0, 3);
    return { checked, chip };
  })()`);
  assert('S1b_viewer_dom_echo', !!domSel && domSel.checked.length === picked.length
    && JSON.stringify(domSel.checked.slice().sort()) === JSON.stringify(picked.slice().sort()),
    `checkedRows=${JSON.stringify(domSel && domSel.checked)} chip=${JSON.stringify(domSel && domSel.chip).slice(0, 220)}`);
  await Promise.race([lib.screenshotPng(client, EVIDENCE_DIR, 'selection-context-composer.png').catch((e) => lib.log('shot fail: ' + e.message)), sleep(5000)]);
  screenshots.push('acceptance/block-139/selection-context-composer.png');

  // ── Step 6: S2 继续分析携实体列表（组装层实据：copilot-ask 载荷；网络层阻断真实发送）──
  const askBefore = await EVAL(`window.__b139.askEvents.length`);
  const menuOpened = await EVAL(`(() => {
    const summary = document.querySelector('details summary[aria-label="继续分析"]');
    if (!summary) return 'no-menu';
    const details = summary.parentElement;
    if (!details.open) details.open = true;
    const items = [...details.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label'));
    return { items: items.slice(0, 6) };
  })()`);
  const menuUsable = menuOpened && typeof menuOpened === 'object' && Array.isArray(menuOpened.items) && menuOpened.items.length > 0;
  assert('P5_continue_menu_present', !!menuUsable, `menu=${JSON.stringify(menuOpened).slice(0, 300)}`);
  if (menuUsable) {
    await Promise.race([lib.screenshotPng(client, EVIDENCE_DIR, 'continue-analysis-menu.png').catch(() => {}), sleep(4000)]);
    screenshots.push('acceptance/block-139/continue-analysis-menu.png');
    // 点第一个候选（真实组件链 runDownstream → appendSelectionToPrompt → dispatch copilotAsk）
    const clickedItem = await EVAL(`(() => {
      const details = document.querySelector('details summary[aria-label="继续分析"]').parentElement;
      const btn = details.querySelector('div[class*="popup"] button');
      if (!btn) return 'no-item';
      btn.click();
      return 'clicked:' + btn.getAttribute('aria-label');
    })()`);
    lib.log(`menu item: ${clickedItem}`);
    const askAfter = await waitFor(`(() => window.__b139.askEvents.length > ${askBefore} ? window.__b139.askEvents.length : null)()`,
      { label: 'copilot-ask dispatched', timeoutMs: 15000 }).catch(() => null);
    const ask = await EVAL(`(() => { const e = window.__b139.askEvents[window.__b139.askEvents.length - 1]; return e ? e.detail : null; })()`);
    const prompt = ask && ask.prompt ? String(ask.prompt) : '';
    const sampleHit = picked.filter((id) => prompt.includes(id));
    const cond = {
      dispatched: askAfter > askBefore,
      jobId: prompt.includes(JOB_ID),
      artifact: prompt.includes('deg_table.csv'),
      countPhrase: new RegExp(`用户已选中 ${picked.length} 个 ${MANIFEST.entityType}`).test(prompt),
      idFieldPhrase: new RegExp(`标记列\\s*${MANIFEST.idField}`).test(prompt),
      samplesAll: sampleHit.length === picked.length,
      tail: /请优先基于所选实体执行分析/.test(prompt),
    };
    const s2Ok = Object.values(cond).every(Boolean);
    assert('S2_continue_analysis_entities', s2Ok,
      `cond=${JSON.stringify(cond)} askBefore=${askBefore} askAfter=${askAfter} copilot-ask payload prompt=${JSON.stringify(prompt.slice(0, 720))} samplesHit=${JSON.stringify(sampleHit)}（组装层实据：ContinueAnalysisMenu.runDownstream → appendSelectionToPrompt（ContinueAnalysisMenu.tsx:35-52/80-88），计数+entityType+标记列+≤12 样本+selectionId 通道三态如实，零 LLM 发送）`);

    // 网络层第二实据：发送请求被 CDP 拦截（BlockedByClient），不消耗 LLM
    await sleep(3000);
    const netReq = intercepted[0] || null;
    let netBodyHasEntities = false;
    let netBodyHasSelectionContext = false;
    if (netReq && netReq.postData) {
      netBodyHasEntities = picked.every((id) => netReq.postData.includes(id)) && netReq.postData.includes(MANIFEST.entityType);
      netBodyHasSelectionContext = netReq.postData.includes('activeArtifact') && netReq.postData.includes('entityIdCount');
    }
    assert('S2b_send_blocked_no_llm', !!interceptor.armed && intercepted.length >= 1,
      `interceptor=${JSON.stringify(interceptor)} request=${netReq ? netReq.method + ' ' + netReq.url : 'none'} bodyHasEntities=${netBodyHasEntities} bodyHasActiveArtifactSelectionContext=${netBodyHasSelectionContext} —— 真实发送已在网络层阻断（BlockedByClient），本走查零 LLM 消耗${netReq && netReq.postData ? `；发送请求体含实体样本=${netBodyHasEntities}` : ''}（rApiBase=${apiBase}）`);
    sideEffects.push('S2 菜单点击触发会话发送链（copilot-ask → SimpleChat send）：POST /api/ai/agent 被 CDP Fetch 拦截以 BlockedByClient 失败——无 LLM 运行；会话侧出现一条发送失败记录，留在验收项目 p_mus4u230_wvib 内。');
  } else {
    assert('S2_continue_analysis_entities', false, `menu not usable: ${JSON.stringify(menuOpened).slice(0, 200)}`);
    assert('S2b_send_blocked_no_llm', false, 'skipped: menu missing');
  }

  // ── 收尾状态留档（模块读数仅作旁证；事件流为真相通道）──
  const finalState = await busInstrument();
  const finishedAt = new Date().toISOString();
  const result = {
    generatedAt: finishedAt,
    startedAt,
    route: String(route),
    deepLink: DEEP_LINK,
    targetJob: {
      jobId: JOB_ID,
      toolId: 'deseq2',
      status: 'completed',
      projectId: PROJECT_ID,
      source: 'sqlite readonly: .petri-dev-user-data/data/petri.db tool_jobs WHERE tool_id=\'deseq2\' AND status=\'completed\' ORDER BY completed_at DESC LIMIT 1（最近 completed deseq2，2026-10-03 16:31:42）',
      artifact: `deg_table.csv（差异基因表；manifest HTTP 实证 artifactId=${MANIFEST.artifactId}/entityType=${MANIFEST.entityType}/idField=${MANIFEST.idField}/interactionMode=table/selectionDurable=true）`,
    },
    checks,
    screenshots,
    allPass: checks.length > 0 && checks.every((c) => c.pass),
    sideEffects,
    final: {
      busEventCount: finalState.busEventCount,
      busModuleSnapshot: finalState.bus || null,
      activeArtifactSelection: finalState.activeArtifact ? finalState.activeArtifact.selection : null,
      interceptedRequests: intercepted,
    },
  };
  const out = path.join(EVIDENCE_DIR, 'selection-walk.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  lib.log(`evidence: ${out}`);
  lib.log(`allPass=${result.allPass}`);
  process.exit(result.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[block139-walk] FATAL', err && err.message);
  process.exit(2);
});
