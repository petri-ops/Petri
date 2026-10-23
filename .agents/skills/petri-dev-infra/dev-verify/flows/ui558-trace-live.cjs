#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui558-trace-live — BLOCK-248（Q3）执行轨迹实机腿。
 *
 * 前置（由 scripts/block248-trace-live.mjs 一键备好）：
 *   - 隔离后端 :3001（脚本化 mock provider）+ Vite :3000 + CDP 9223；
 *   - mock 回合：用户说「轨迹」→ 调 workspace_read 读一个**不存在的文件**（必然失败）→ 收尾文本。
 *
 * 断言链：
 *   R1 轨迹 API：任务收尾且统计里 toolFailures ≥ 1（真失败，不是空轨迹）
 *   R2 轨迹 surface 可见且有事件行
 *   R3 事件里有工具失败行（data-status=error）
 *   R4 「错误」镜头只筛失败（工具失败也计入）
 *   R5 定位最近失败：滚到该行且 elementFromPoint 命中（屏幕可见，不只是 DOM 在场）
 *   R6 recordedOnly 口径明示
 *   R7 模型 I/O 互链可达
 *   R8 证据面聚合执行事件统计 + 入口能打开轨迹
 *   R9 既有用户消息导航条（C1）仍在（对账，不重复造）
 *   截图：轨迹、错误镜头、证据面（亮/暗各一轮）
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const appUrl = () => process.env.PETRI_B248_APP || 'http://localhost:3000';
const apiUrl = () => process.env.PETRI_B248_API || 'http://127.0.0.1:3001';
const isDark = () => process.env.PETRI_B248_DARK === '1';
const suffix = () => (isDark() ? 'dark' : 'light');
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-558');
const COMPOSER = 'textarea.sc-input';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evalJsWithTimeout(client, expression, timeoutMs = 20_000) {
  let timer = null;
  try {
    return await Promise.race([
      lib.evalJs(client, expression),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cdp_eval_timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function poll(fn, { timeoutMs, intervalMs = 400, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 240)}`);
}

async function restGet(endpoint) {
  const response = await fetch(`${apiUrl()}/api${endpoint}`, {
    headers: { Authorization: 'Bearer desktop-local' },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function mockStats() {
  const url = process.env.PETRI_B248_MOCK_STATS_URL;
  if (!url) throw new Error('missing PETRI_B248_MOCK_STATS_URL');
  return fetch(url, { signal: AbortSignal.timeout(6000) }).then((response) => response.json());
}

async function dismissFirstRun(client) {
  const clicked = await evalJsWithTimeout(client, `(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      if ((btns[i].textContent || '').trim() === '开始使用') { btns[i].click(); return 'clicked'; }
    }
    return 'none';
  })()`).catch(() => 'none');
  if (clicked === 'clicked') {
    await poll(async () => {
      const present = await evalJsWithTimeout(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') >= 0 : false`).catch(() => true);
      return present === false ? true : null;
    }, { timeoutMs: 12_000, label: 'role_reveal_dismissed' }).catch(() => null);
  }
  return clicked;
}

async function waitComposerAndProject(client, projectId, projectName) {
  // 正路是 **workspace 路由** `/project/:id`（`?project=` 只是首屏选项目的旧入口，
  // SPA 落点是 /project/:id）。先确认真的在工作区路由上，再判 composer——
  // 否则会把欢迎页的 composer 误当工作区（本包实机抓真：W1 在欢迎页上找不到右栏）。
  await poll(async () => {
    const onWorkspace = await evalJsWithTimeout(client, `location.pathname.indexOf(${JSON.stringify(`/project/${projectId}`)}) === 0`).catch(() => false);
    return onWorkspace === true ? true : null;
  }, { timeoutMs: 30_000, intervalMs: 500, label: 'workspace_route' }).catch(() => null);
  await dismissFirstRun(client);
  await poll(async () => {
    const ready = await evalJsWithTimeout(client, `!!document.querySelector(${JSON.stringify(COMPOSER)})`).catch(() => false);
    return ready === true ? true : null;
  }, { timeoutMs: 40_000, intervalMs: 600, label: 'composer_ready' });
  const overlayGone = await evalJsWithTimeout(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') < 0 : false`).catch(() => false);
  if (overlayGone !== true) await dismissFirstRun(client);

  const pendingText = () => evalJsWithTimeout(client, `document.body && document.body.innerText.indexOf('先选择一个项目') >= 0`).catch(() => false);
  await poll(async () => {
    const has = await evalJsWithTimeout(client, `document.body && document.body.innerText.indexOf(${JSON.stringify(projectName)}) >= 0`).catch(() => false);
    return has === true ? true : null;
  }, { timeoutMs: 30_000, intervalMs: 600, label: 'project_list_loaded' });

  if ((await pendingText()) === true) {
    await evalJsWithTimeout(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        var t = (btns[i].textContent || '').trim();
        if (${JSON.stringify(projectName)} && t.indexOf(${JSON.stringify(projectName)}) >= 0) { btns[i].click(); return 'clicked'; }
      }
      return 'none';
    })()`, 10_000).catch(() => null);
  }
  return poll(async () => {
    const pending = await pendingText();
    return pending === false ? 'selected' : null;
  }, { timeoutMs: 25_000, intervalMs: 600, label: 'project_selected' }).catch(() => 'not_selected');
}

function setTextareaExpr(text) {
  return `(function(){
    var ta = document.querySelector(${JSON.stringify(COMPOSER)});
    if (!ta) return 'no_textarea';
    ta.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok:' + ta.value.length;
  })()`;
}

async function clickSend(client) {
  await poll(async () => {
    const state = await evalJsWithTimeout(client, `(function(){
      var btn = document.querySelector('[data-testid="chat-send"]');
      if (!btn) return 'no_button';
      return btn.disabled ? 'disabled' : 'enabled';
    })()`, 10_000).catch(() => 'eval_failed');
    return state === 'enabled' ? state : null;
  }, { timeoutMs: 120_000, intervalMs: 800, label: 'chat_send_enabled' });
  await poll(async () => {
    const clicked = await evalJsWithTimeout(client, `(function(){
      var btn = document.querySelector('[data-testid="chat-send"]');
      if (!btn || btn.disabled) return null;
      btn.click();
      return 'clicked';
    })()`, 20_000).catch(() => null);
    return clicked === 'clicked' ? true : null;
  }, { timeoutMs: 40_000, intervalMs: 800, label: 'chat_send_clicked' });
}

/** 种 tab 与导航同一次 eval（原子）：中间不留渲染 tick，避免应用把旧 tab 状态写回覆盖种子。 */
function seedAndNavigateExpr(projectId, tabs, activeId) {
  return `(function(){
    try {
      localStorage.setItem('petri.workSurfaceTabs.v1.' + ${JSON.stringify(projectId)},
        JSON.stringify({ version: 1, tabs: ${JSON.stringify(tabs)}, activeId: ${JSON.stringify(activeId)} }));
    } catch (e) { /* storage 不可用：下面照常导航 */ }
    location.href = ${JSON.stringify(`${appUrl()}/project/${projectId}`)};
    return 'navigating';
  })()`;
}

async function ensureTraceVisible(client) {
  const state = await evalJsWithTimeout(client, `(function(){
    var el = document.querySelector('[data-testid="trace-surface"]');
    if (!el) return 'missing';
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? 'visible' : 'hidden';
  })()`).catch(() => 'eval_failed');
  if (state === 'visible') return state;
  await evalJsWithTimeout(client, `(function(){
    var btn = document.querySelector('[aria-label="展开右侧栏"]');
    if (btn) { btn.click(); return 'opened'; }
    return 'none';
  })()`).catch(() => null);
  await sleep(600);
  return evalJsWithTimeout(client, `(function(){
    var el = document.querySelector('[data-testid="trace-surface"]');
    if (!el) return 'missing';
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? 'visible' : 'hidden';
  })()`).catch(() => 'eval_failed');
}

async function waitTrajectoryReady(conversationId) {
  return poll(async () => {
    const response = await restGet(`/ai/agent/trajectory?conversationId=${encodeURIComponent(conversationId)}&limit=200`);
    const data = response.data;
    if (!data || data.ok !== true) return null;
    const done = data.task && data.task.status && data.task.status !== 'running';
    const failures = data.stats ? data.stats.toolFailures : 0;
    return done && failures >= 1 ? data : null;
  }, { timeoutMs: 120_000, intervalMs: 1000, label: 'trajectory_ready' });
}

async function traceRowCensus(client) {
  return evalJsWithTimeout(client, `(function(){
    var rows = Array.prototype.slice.call(document.querySelectorAll('[data-testid="trace-event"]'));
    return JSON.stringify(rows.map(function(el){
      return {
        group: el.getAttribute('data-group'),
        status: el.getAttribute('data-status'),
        seq: el.getAttribute('data-seq'),
        text: (el.textContent || '').trim().slice(0, 120),
      };
    }));
  })()`, 60_000).then((raw) => JSON.parse(raw)).catch(() => []);
}

async function run({ assert }) {
  const projectId = process.env.PETRI_B248_PROJECT_ID;
  const projectName = process.env.PETRI_B248_PROJECT_NAME || '';
  const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
  const screenshots = {};

  const applyDark = async () => {
    if (!isDark()) return;
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }).catch(() => {});
    await sleep(400);
  };
  const seedAndLoad = async (tabs, activeId) => {
    await evalJsWithTimeout(client, seedAndNavigateExpr(projectId, tabs, activeId));
    const state = await waitComposerAndProject(client, projectId, projectName);
    await applyDark();
    return state;
  };

  // ── 腿 1：跑出真实失败的工具链（事件落库；本腿不做轨迹 DOM 断言）──
  // 回合结束后渲染线程会被既有重渲染环拖慢（AUDIT-LOG 存量），轨迹断言放**新装载**（腿 2）。
  const firstLoad = await seedAndLoad([{ id: 'trace', surfaceId: 'trace' }], 'trace');
  assert('W0_project_selected', firstLoad === 'selected', String(firstLoad));
  const traceVisible = await poll(async () => {
    const state = await ensureTraceVisible(client);
    return state === 'visible' ? state : null;
  }, { timeoutMs: 40_000, intervalMs: 800, label: 'trace_visible' }).catch(() => 'not_visible');
  assert('W1_trace_surface_visible', traceVisible === 'visible', String(traceVisible));

  const statsBefore = (await mockStats()).calls;
  await evalJsWithTimeout(client, setTextareaExpr('看一下轨迹：读取一个不存在的文件'));
  await clickSend(client);
  await poll(async () => {
    const stats = await mockStats();
    return stats.calls > statsBefore ? stats : null;
  }, { timeoutMs: 40_000, intervalMs: 700, label: 'provider_called' });

  const convList = await restGet(`/ai/conversations?project_id=${encodeURIComponent(projectId)}`);
  const conversationId = convList.data && convList.data.conversations && convList.data.conversations[0]
    ? convList.data.conversations[0].id
    : null;
  assert('R1_conversation_resolved', Boolean(conversationId), `status=${convList.status} id=${conversationId}`);

  const trajectory = await (conversationId ? waitTrajectoryReady(conversationId) : Promise.resolve(null)).catch(() => null);
  assert('R2_trajectory_ready_with_failure',
    Boolean(trajectory && trajectory.availability === 'available'),
    trajectory
      ? `availability=${trajectory.availability} task=${trajectory.task && trajectory.task.status} stats=${JSON.stringify(trajectory.stats)}`
      : 'trajectory_not_ready');

  const railCount = await poll(async () => {
    const count = await evalJsWithTimeout(client, `document.querySelectorAll('[aria-label^="跳转到第"]').length`).catch(() => 0);
    return Number(count) >= 1 ? Number(count) : null;
  }, { timeoutMs: 30_000, intervalMs: 800, label: 'message_rail' }).catch(() => 0);
  assert('W2_existing_message_rail_present', Number(railCount) >= 1, `railTicks=${railCount}`);

  // ── 腿 2：新装载读轨迹（避开回合后的重渲染抖动；事件已落库）──
  const reloaded = await seedAndLoad([{ id: 'trace', surfaceId: 'trace' }], 'trace');
  assert('W3_reloaded_for_trace', reloaded === 'selected', String(reloaded));
  const visible2 = await poll(async () => {
    const state = await ensureTraceVisible(client);
    return state === 'visible' ? state : null;
  }, { timeoutMs: 40_000, intervalMs: 800, label: 'trace_visible_reload' }).catch(() => 'not_visible');
  assert('R3_trace_visible_after_reload', visible2 === 'visible', String(visible2));

  const rows = await poll(async () => {
    const census = await traceRowCensus(client);
    return census.length > 0 ? census : null;
  }, { timeoutMs: 30_000, intervalMs: 1000, label: 'trace_rows' }).catch(() => []);
  assert('R4_trace_events_rendered', rows.length > 0, `rows=${rows.length}`);

  const failureRow = rows.find((row) => row.status === 'error' || row.group === 'error');
  assert('R5_tool_failure_visible_in_trace', Boolean(failureRow), JSON.stringify(failureRow || null));

  const note = await evalJsWithTimeout(client, `(function(){
    var el = document.querySelector('[data-testid="trace-recorded-note"]');
    return el ? (el.textContent || '').trim() : '';
  })()`, 20_000).catch(() => '');
  assert('R6_recorded_only_notice', String(note).includes('只显示已记录事件'), String(note).slice(0, 120));

  // 错误镜头 + 定位最近失败
  await evalJsWithTimeout(client, `(function(){
    var chip = document.querySelector('[data-testid="trace-filter-error"]');
    if (chip) chip.click();
    return 'ok';
  })()`, 20_000).catch(() => null);
  await sleep(500);
  const errorRows = await traceRowCensus(client);
  const allFailures = errorRows.length > 0 && errorRows.every((row) => row.status === 'error' || row.group === 'error');
  assert('R7_error_filter_shows_failures_only', allFailures, `rows=${JSON.stringify(errorRows)}`);

  await evalJsWithTimeout(client, `(function(){
    var btn = document.querySelector('[data-testid="trace-locate-failure"]');
    if (btn) { btn.click(); return 'clicked'; }
    return 'none';
  })()`, 20_000).catch(() => null);
  await sleep(600);
  const located = await evalJsWithTimeout(client, `(function(){
    var list = document.querySelector('[data-testid="trace-events"]');
    var row = document.querySelector('[data-testid="trace-events"] [data-status="error"]');
    if (!list || !row) return JSON.stringify({ found: false });
    var lr = list.getBoundingClientRect();
    var rr = row.getBoundingClientRect();
    var hit = document.elementFromPoint(rr.left + 20, rr.top + rr.height / 2);
    return JSON.stringify({
      found: true,
      inList: rr.top >= lr.top - 2 && rr.bottom <= lr.bottom + 2,
      hit: Boolean(hit && (hit === row || row.contains(hit))),
    });
  })()`, 20_000).catch(() => '{}');
  const locatedInfo = JSON.parse(located || '{}');
  assert('R8_locate_failure_visible', locatedInfo.found === true && locatedInfo.inList === true && locatedInfo.hit === true, located);
  // 轨迹 ↔ 模型 I/O 互链
  await evalJsWithTimeout(client, `(function(){
    var btn = document.querySelector('[data-testid="trace-open-io"]');
    if (btn) { btn.click(); return 'clicked'; }
    return 'none';
  })()`, 20_000).catch(() => null);
  const ioOpened = await poll(async () => {
    const state = await evalJsWithTimeout(client, `(function(){
      var el = document.querySelector('[aria-label="模型 I/O 信息流"]');
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? 'visible' : 'hidden';
    })()`, 10_000).catch(() => null);
    return state === 'visible' ? state : null;
  }, { timeoutMs: 30_000, intervalMs: 700, label: 'io_surface' }).catch(() => 'not_visible');
  assert('R9_io_link_opens_transcript', ioOpened === 'visible', String(ioOpened));

  // ── 腿 3：证据面聚合 + 入口（两个 tab 都在，以「证据」为活动 tab）──
  const evidenceLoad = await seedAndLoad([
    { id: 'trace', surfaceId: 'trace' },
    { id: 'evidence', surfaceId: 'evidence' },
  ], 'evidence');
  assert('W4_reloaded_for_evidence', evidenceLoad === 'selected', String(evidenceLoad));

  const evidenceStats = await poll(async () => {
    const text = await evalJsWithTimeout(client, `(function(){
      var el = document.querySelector('[data-testid="evidence-trace-stats"]');
      return el ? (el.textContent || '').trim() : '';
    })()`, 15_000).catch(() => '');
    return text && text.indexOf('工具') >= 0 ? text : null;
  }, { timeoutMs: 40_000, intervalMs: 800, label: 'evidence_trace_stats' }).catch(() => '');
  assert('R10_evidence_event_stats', String(evidenceStats).includes('失败'), String(evidenceStats));
  await evalJsWithTimeout(client, `(function(){
    var btn = document.querySelector('[data-testid="evidence-open-trace"]');
    if (btn) { btn.click(); return 'clicked'; }
    return 'none';
  })()`, 20_000).catch(() => null);
  const traceFromEvidence = await poll(async () => {
    const state = await evalJsWithTimeout(client, `(function(){
      var el = document.querySelector('[data-testid="trace-surface"]');
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? 'visible' : 'hidden';
    })()`, 10_000).catch(() => null);
    return state === 'visible' ? state : null;
  }, { timeoutMs: 30_000, intervalMs: 700, label: 'trace_from_evidence' }).catch(() => 'not_visible');
  assert('R11_evidence_entry_opens_trace', traceFromEvidence === 'visible', String(traceFromEvidence));

  // ── 截图最后做（离屏窗口可能等不到合成帧；断言必须已完成）──
  // 有界：单次 10s，首张不可用即跳过其余（不重复等待）；不开窗换证据。
  const shot = async (name) => {
    let timer = null;
    try {
      const result = await Promise.race([
        client.send("Page.captureScreenshot", { format: "png", fromSurface: false, captureBeyondViewport: false }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("screenshot_timeout(offscreen)")), 10_000); }),
      ]);
      fs.mkdirSync(EVIDENCE, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCE, name), Buffer.from(result.data, "base64"));
      return name;
    } catch (error) {
      return `unavailable:${error.message}`;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  await seedAndLoad([{ id: "trace", surfaceId: "trace" }], "trace").catch(() => null);
  await poll(async () => {
    const census = await traceRowCensus(client);
    return census.length > 0 ? census : null;
  }, { timeoutMs: 20_000, intervalMs: 1000, label: "shots_trace_rows" }).catch(() => null);
  screenshots.trace = await shot(`ui558-trace-${suffix()}.png`);
  if (!String(screenshots.trace).startsWith('unavailable')) {
    await evalJsWithTimeout(client, `(function(){
      var chip = document.querySelector('[data-testid="trace-filter-error"]');
      if (chip) chip.click();
      return 'ok';
    })()`, 10_000).catch(() => null);
    await sleep(400);
    screenshots.traceError = await shot(`ui558-trace-error-${suffix()}.png`);
    await seedAndLoad([{ id: 'trace', surfaceId: 'trace' }, { id: 'evidence', surfaceId: 'evidence' }], 'evidence').catch(() => null);
    await poll(async () => {
      const text = await evalJsWithTimeout(client, `(function(){
        var el = document.querySelector('[data-testid="evidence-trace-stats"]');
        return el ? (el.textContent || '').trim() : '';
      })()`, 10_000).catch(() => '');
      return text && text.indexOf('工具') >= 0 ? text : null;
    }, { timeoutMs: 20_000, intervalMs: 800, label: 'shots_evidence' }).catch(() => null);
    screenshots.evidence = await shot(`ui558-evidence-${suffix()}.png`);
  } else {
    screenshots.traceError = 'skipped:offscreen_screenshot_unavailable';
    screenshots.evidence = 'skipped:offscreen_screenshot_unavailable';
  }

  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, `ui558-screenshots-${suffix()}.json`), JSON.stringify(screenshots, null, 2));
}

module.exports = {
  id: 'ui558-trace-live',
  description: 'BLOCK-248 实机腿：真实失败工具 → 执行轨迹可见 → 错误筛选 → 定位失败 → 模型 I/O 互链 → 证据面聚合',
  run,
};
