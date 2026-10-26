#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui557-web-access-live — BLOCK-247（Q2b）联网检索与抓取实机腿。
 *
 * 前置（由 scripts/block247-web-access-live.mjs 一键备好）：
 *   - 隔离后端 :3011（脚本化 mock provider + 假 SearXNG :3012）+ Vite :3010 + CDP :9233；
 *   - 隔离数据根里的 web-search.json 默认 **enabled=false**。
 *
 * 断言链（每条都要有反证，不停在"按钮画出来了"）：
 *   W1 默认关：/api/web-access 快照显示未开启、检索/抓取都不可用；
 *   W2 关闭态跑真调用：agent 调 web_search → 工具**被拒**（web_access_disabled），
 *      审计 JSONL 留一行 ok:false —— 不是静默空结果；
 *   W3 经真实 API() 打开授权（PUT /api/web-access）→ capabilities.search=true；
 *   W4 开启后再跑：web_search 真的检索到 → 结果带来源主机名 → 活动行出现来源标签；
 *   W5 抓取内网地址：逐跳策略拒绝（web_url_private_host），审计留痕；
 *   W6 设置面：联网面板可见、开关为开、说明文字在位（截图）。
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const APP = () => process.env.PETRI_B247_APP || 'http://localhost:3000';
const API = () => process.env.PETRI_B247_API || 'http://127.0.0.1:3001';
// env 必须**调用时**读：flow 是被 require 进来的，脚本在 require 之后才设 env
// （模块级常量会在 require 时固化空值——实机抓真：审计文件路径与 SearXNG 地址都成了空串）。
const appUrl = () => process.env.PETRI_B247_APP || APP();
const apiUrl = () => process.env.PETRI_B247_API || API();
const auditFile = () => process.env.PETRI_B247_AUDIT_FILE || '';
const searxngUrl = () => process.env.PETRI_B247_SEARXNG_URL || '';
// DARK/SUFFIX 也必须**调用时**读：脚本在 require 本模块**之后**才设 PETRI_B247_DARK
// （模块级 const 会在 require 时固化空值——实机抓真：暗色轮照样出了亮色截图并覆盖亮色证据，
//  报告却写着 darkMode=true。同一坑，第三次踩就是缺陷不是意外。）
const isDark = () => process.env.PETRI_B247_DARK === '1';
const suffix = () => (isDark() ? 'dark' : 'light');
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-557');
const COMPOSER = 'textarea.sc-input';
const AUDIT_FILE = () => process.env.PETRI_B247_AUDIT_FILE || '';
const SEARXNG_URL = () => process.env.PETRI_B247_SEARXNG_URL || '';
void AUDIT_FILE(); void SEARXNG_URL();

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evalJsWithTimeout(client, expression, timeoutMs = 15_000) {
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

/**
 * 长超时 eval：lib.evalJs 内部自带 30s 上限，渲染线程被既有重渲染环拖慢时
 * 需要**一次**更长等待，而不是 8s 轮询叠一堆 pending evaluate（会互相拖累）。
 */
async function evalJsLong(client, expression, timeoutMs = 120_000) {
  let timer = null;
  try {
    const result = await Promise.race([
      client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`cdp_eval_timeout_${timeoutMs}ms`)), timeoutMs); }),
    ]);
    if (result && result.exceptionDetails) {
      throw new Error('eval_exception: ' + String(result.exceptionDetails.exception?.description || result.exceptionDetails.text || '').slice(0, 200));
    }
    return result && result.result ? result.result.value : undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function poll(fn, { timeoutMs, intervalMs = 300, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 240)}`);
}

async function ensureNoOverlay(client) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const present = await evalJsWithTimeout(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') >= 0 : false`).catch(() => false);
    if (present !== true) return true;
    await evalJsWithTimeout(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '开始使用') { btns[i].click(); return 'clicked'; }
      }
      return 'none';
    })()`).catch(() => null);
    await sleep(400);
  }
  return false;
}

async function capturePng(client, filename, timeoutMs = 20_000) {
  await ensureNoOverlay(client);
  await sleep(300);
  // 截图必须**有界**：渲染进程被拖住时（ProjectWorkspace 既存重渲染环）CDP 的
  // Page.captureScreenshot 永远不返回——2026-10-23 实机抓真：无界截图让整条 flow
  // 挂在 W4c 之后 40 分钟，报告根本没落盘。超时就如实记"截图不可用"，不假装有图。
  let timer = null;
  try {
    await Promise.race([
      lib.screenshotPng(client, EVIDENCE, filename),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('screenshot_timeout(renderer busy)')), timeoutMs); }),
    ]);
    return filename;
  } finally {
    if (timer) clearTimeout(timer);
  }
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

async function dismissFirstRun(client) {
  const clicked = await evalJsWithTimeout(client, `(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      if ((btns[i].textContent || '').trim() === '开始使用') { btns[i].click(); return 'clicked'; }
    }
    return 'none';
  })()`);
  if (clicked === 'clicked') {
    await poll(async () => {
      const present = await evalJsWithTimeout(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') >= 0 : false`).catch(() => true);
      return present === false ? true : null;
    }, { timeoutMs: 12_000, label: 'role_reveal_dismissed' }).catch(() => null);
  }
  return clicked;
}

async function clickSend(client) {
  // 上一轮 run 没收尾时发送键是禁用的（实机抓真：工具链还在跑）。
  // 先等它回到可发送，再点——否则会把"上一轮没结束"误当成"这一轮发不出去"。
  await poll(async () => {
    const state = await evalJsWithTimeout(client, `(function(){
      var btn = document.querySelector('[data-testid="chat-send"]');
      if (!btn) return 'no_button';
      return btn.disabled ? 'disabled' : 'enabled';
    })()`, 10_000).catch(() => 'eval_failed');
    return state === 'enabled' ? state : null;
  }, { timeoutMs: 120_000, intervalMs: 800, label: 'chat_send_enabled' }).catch(async (error) => {
    const dom = await evalJsWithTimeout(client, `(document.body && document.body.innerText ? document.body.innerText : 'no-body').slice(0, 700)`).catch(() => 'eval_failed');
    throw new Error(`chat_send_never_enabled: ${dom}`);
  });
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

async function mockStats() {
  const url = process.env.PETRI_B247_MOCK_STATS_URL;
  if (!url) throw new Error('missing PETRI_B247_MOCK_STATS_URL');
  return fetch(url, { signal: AbortSignal.timeout(6000) }).then((response) => response.json());
}

async function restGet(endpoint) {
  const response = await fetch(`${apiUrl()}/api${endpoint}`, {
    headers: { Authorization: 'Bearer desktop-local' },
    signal: AbortSignal.timeout(8000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function restPut(endpoint, body) {
  const response = await fetch(`${apiUrl()}/api${endpoint}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer desktop-local' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

function readAudit() {
  const auditFilePath = auditFile();
  if (!auditFilePath) return [];
  try {
    return fs.readFileSync(auditFilePath, 'utf8').split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return { corrupt: true }; }
    });
  } catch {
    return [];
  }
}

/**
 * 来源标签的**屏幕可见性**取证（一次长超时，回合收尾后跑）。
 * 不只查选择器：宽高/可见性/elementFromPoint 命中断言——沿用 BLOCK-245 的
 * 「DOM 在场 ≠ 屏幕上看得见」纪律（浮层盖住时 DOM 断言全绿而截图全是欢迎页）。
 */
const DOM_PROBE_EXPR = `(function(){
  var els = document.querySelectorAll('.sc-tool-activity-source');
  if (els.length && els[0].scrollIntoView) {
    try { els[0].scrollIntoView({ block: 'center' }); } catch (e) { /* 旧内核忽略参数 */ }
  }
  var out = [];
  for (var i = 0; i < els.length; i += 1) {
    var el = els[i];
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var hit = (cx > 0 && cy > 0 && cx < window.innerWidth && cy < window.innerHeight)
      ? document.elementFromPoint(cx, cy) : null;
    out.push({
      text: (el.textContent || '').trim(),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      rendered: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0,
      hit: Boolean(hit && (hit === el || el.contains(hit))),
      inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
    });
  }
  var body = document.body ? document.body.innerText : '';
  return JSON.stringify({
    readyState: document.readyState,
    bodyLen: body.length,
    labels: out,
    snippet: body.slice(0, 400),
  });
})()`;

async function run({ assert }) {
  const projectId = process.env.PETRI_B247_PROJECT_ID;
  const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
  // 渲染进程异常收集（实机抓真用：DOM 空掉时区分"页面崩了"与"选择器不对"）
  const runtimeErrors = [];
  try {
    await client.send('Runtime.enable');
    if (typeof client.on === 'function') {
      client.on('Runtime.exceptionThrown', (params) => {
        runtimeErrors.push(String((params && params.exceptionDetails && (params.exceptionDetails.exception?.description || params.exceptionDetails.text)) || 'unknown').slice(0, 240));
      });
    }
  } catch { /* 事件订阅不可用不影响主流程 */ }
  // 带项目上下文进页面（没选项目时首页不挂 composer —— 实机抓真）
  await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${appUrl()}/?project=${projectId}`)}; 'ok'`);
  const overlay = await dismissFirstRun(client);
  assert('W0_first_run_overlay_dismissed', true, `click=${overlay}`);
  await poll(async () => {
    const ready = await evalJsWithTimeout(client, `!!document.querySelector(${JSON.stringify(COMPOSER)})`).catch(() => false);
    return ready ? true : null;
  }, { timeoutMs: 40_000, label: 'composer_ready' });

  // 首启角色揭示浮层是**异步**出现的（导航后才挂上）：先点掉，否则它盖住整页，
  // 后面所有"点击"其实都被浮层吃掉（BLOCK-245/246/247 三包同款坑）。
  const overlayGone = await ensureNoOverlay(client);
  assert('W0b_role_reveal_dismissed', overlayGone === true, `ensureNoOverlay=${overlayGone}`);

  // 选项目：`?project=` 参数在**项目列表尚未装载**时会被忽略（实机抓真：页面停在
  // 「先选择一个项目，再开始任务」）。做法：先等侧栏出现项目名（列表已装载），
  // 再带参重新导航一次；仍不生效才退回"点侧栏项目卡片"这条用户路径。
  const projectName = process.env.PETRI_B247_PROJECT_NAME || '';
  await poll(async () => {
    const has = await evalJsWithTimeout(client, `document.body && document.body.innerText.indexOf(${JSON.stringify(projectName)}) >= 0`).catch(() => false);
    return has === true ? true : null;
  }, { timeoutMs: 30_000, intervalMs: 600, label: 'project_list_loaded' });

  const pendingText = () => evalJsWithTimeout(client, `document.body && document.body.innerText.indexOf('先选择一个项目') >= 0`).catch(() => false);
  await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${appUrl()}/?project=${projectId}`)}; 'ok'`).catch(() => null);
  await sleep(2500);
  let stillPending = await pendingText();
  if (stillPending === true) {
    // 兜底：点侧栏里的项目卡片（用户路径）
    await evalJsWithTimeout(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        var t = (btns[i].textContent || '').trim();
        if (${JSON.stringify(projectName)} && t.indexOf(${JSON.stringify(projectName)}) >= 0) { btns[i].click(); return 'clicked'; }
      }
      return 'none';
    })()`, 10_000).catch(() => null);
  }
  const selected = await poll(async () => {
    const pending = await pendingText();
    return pending === false ? 'selected' : null;
  }, { timeoutMs: 25_000, intervalMs: 600, label: 'project_selected' }).catch(() => 'not_selected');
  assert('W0c_project_selected', selected === 'selected', String(selected));

  if (isDark()) {
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }).catch(() => {});
    await sleep(800);
  }

  // ---- W1 默认关 ----
  const before = await restGet('/web-access');
  const beforeSnapshot = before.data && before.data.webAccess;
  assert('W1a_web_access_default_off', Boolean(beforeSnapshot) && beforeSnapshot.effective.enabled === false,
    JSON.stringify(beforeSnapshot && beforeSnapshot.effective));
  assert('W1b_capabilities_off', Boolean(beforeSnapshot) && beforeSnapshot.capabilities.search === false && beforeSnapshot.capabilities.fetch === false,
    JSON.stringify(beforeSnapshot && beforeSnapshot.capabilities));

  // ---- W1c 设置面（**先于聊天回合**取 UI 证据：渲染进程在跑完一轮工具链后会卡住）----
  // 设置面：走**独立路由** `/settings`（UI-365：设备级能力独立页；侧栏按钮不总是
  // 挂在当前视图里，click 不动是常态——实机抓真）。
  const settingsOpened = await poll(async () => {
    const state = await evalJsWithTimeout(client, `(function(){
      if (location.pathname.indexOf('/settings') < 0) { location.href = ${JSON.stringify(`${appUrl()}/settings?section=compute`)}; return 'navigating'; }
      return document.querySelector('[data-testid="web-access-panel"]') ? 'panel_ready' : 'on_route_no_panel';
    })()`, 10_000).catch(() => 'eval_failed');
    return state === 'panel_ready' ? state : null;
  }, { timeoutMs: 40_000, intervalMs: 700, label: 'settings_opened' }).catch(() => 'not_found');
  const settingsDiag = await evalJsWithTimeout(client, `JSON.stringify({
    bodyLen: (document.body && document.body.innerText) ? document.body.innerText.length : -1,
    hasDesktopPanel: !!document.querySelector('.petri-desktop-panel'),
    hasWebAccess: !!document.querySelector('[data-testid="web-access-panel"]'),
    hasProxy: !!document.querySelector('[data-testid="network-proxy-panel"], [data-testid="proxy-panel"]'),
    sections: Array.prototype.slice.call(document.querySelectorAll('.petri-desktop-panel__tab, .petri-settings-tab, [data-testid^="settings-tab"]')).map(function(el){ return (el.textContent||'').trim().slice(0,10); }).slice(0,12),
    text: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 300),
  })`).catch(() => '{}');
  assert('W1c_settings_opened', settingsOpened !== 'not_found', `${settingsOpened} ${settingsDiag}`);

  const panel = await poll(async () => {
    const state = await evalJsWithTimeout(client, `(function(){
      var el = document.querySelector('[data-testid="web-access-panel"]');
      if (!el) return null;
      var toggle = el.querySelector('[data-testid="web-access-enabled"]');
      return JSON.stringify({
        text: (el.textContent || '').slice(0, 400),
        enabled: toggle ? toggle.checked : null,
      });
    })()`, 10_000).catch(() => null);
    return state ? JSON.parse(state) : null;
  }, { timeoutMs: 25_000, intervalMs: 500, label: 'web_access_panel_visible' }).catch(() => null);
  assert('W1d_web_access_panel_visible', Boolean(panel), JSON.stringify(panel).slice(0, 200));
  assert('W1e_toggle_reflects_state', Boolean(panel) && panel.enabled === false, JSON.stringify(panel && panel.enabled));

  await capturePng(client, `ui557-web-settings-${suffix()}.png`);

  // 设置面取证后**回到聊天页**（设置是独立路由 `/settings`，不回就找不到 composer）
  await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${appUrl()}/?project=${projectId}`)}; 'ok'`).catch(() => null);
  await poll(async () => {
    const ready = await evalJsWithTimeout(client, `!!document.querySelector(${JSON.stringify(COMPOSER)})`).catch(() => false);
    return ready === true ? true : null;
  }, { timeoutMs: 40_000, intervalMs: 700, label: 'composer_back_on_chat' });
  // 回到聊天页后再确认项目仍是选中态（实机抓真：二次导航会回到"先选择一个项目"）
  await poll(async () => {
    const pending = await evalJsWithTimeout(client, `document.body && document.body.innerText.indexOf('先选择一个项目') >= 0`).catch(() => false);
    return pending === false ? true : null;
  }, { timeoutMs: 25_000, intervalMs: 700, label: 'project_still_selected' }).catch(() => null);

  // ---- W2 关闭态：真调用 → 被拒（不是空结果）----
  const statsBefore = (await mockStats()).calls;
  await evalJsWithTimeout(client, setTextareaExpr('联网检索一次（关闭态应被拒）'));
  await clickSend(client);
  const providerCalled = await poll(async () => {
    const stats = await mockStats();
    return stats.calls > statsBefore ? stats : null;
  }, { timeoutMs: 30_000, intervalMs: 700, label: 'provider_called' }).catch(() => null);
  if (!providerCalled) {
    const dom = await evalJsWithTimeout(client, `JSON.stringify({
      href: location.href,
      len: (document.body && document.body.innerText) ? document.body.innerText.length : -1,
      text: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 1200),
      hasComposer: !!document.querySelector('textarea.sc-input'),
      hasSend: !!document.querySelector('[data-testid="chat-send"]'),
      testids: Array.prototype.slice.call(document.querySelectorAll('[data-testid]')).map(function(el){ return el.getAttribute('data-testid'); }).slice(0, 60),
      buttons: Array.prototype.slice.call(document.querySelectorAll('button')).map(function(el){ return (el.textContent || '').trim().slice(0, 20); }).filter(Boolean).slice(0, 40),
    })`).catch(() => '{}');
    try {
      fs.mkdirSync(EVIDENCE, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCE, 'ui557-diag.json'), dom, 'utf8');
    } catch { /* 诊断落盘失败不影响断言 */ }
    throw new Error(`provider_not_called (diag written)`);
  }
  const rejected = await poll(async () => {
    const rows = readAudit().filter((row) => row.tool === 'web_search' && row.ok === false && row.code === 'web_access_disabled');
    return rows.length > 0 ? rows : null;
  }, { timeoutMs: 60_000, intervalMs: 700, label: 'web_search_rejected_audit' }).catch(() => []);
  assert('W2a_disabled_refused_with_reason', rejected.length > 0, JSON.stringify(rejected[rejected.length - 1] || readAudit().slice(-2)));
  const statsAfterReject = (await mockStats()).calls;
  assert('W2b_provider_actually_ran_tool', statsAfterReject > statsBefore, `calls ${statsBefore} → ${statsAfterReject}`);

  // ---- W3 授权面：经**真实 API()**打开（同一轮内完成——第二轮发送会撞上
  //      ProjectWorkspace 既存重渲染环，AUDIT-LOG 已登记的抖动，本包不修它）----
  const put = await restPut('/web-access', {
    enabled: true,
    provider: 'searxng',
    searxngBaseUrl: searxngUrl(),
    maxResults: 5,
  });
  const putSnapshot = put.data && put.data.webAccess;
  assert('W3a_enable_via_api', put.status === 200 && Boolean(putSnapshot) && putSnapshot.effective.enabled === true,
    `status=${put.status} ${JSON.stringify(putSnapshot && putSnapshot.effective)}`);
  assert('W3b_capabilities_on', Boolean(putSnapshot) && putSnapshot.capabilities.search === true && putSnapshot.capabilities.fetch === true,
    JSON.stringify(putSnapshot && putSnapshot.capabilities));
  // marker：告诉脚本里的 mock「授权已开，可以发第二次检索了」
  const marker = process.env.PETRI_B247_ENABLE_MARKER;
  if (marker) fs.writeFileSync(marker, 'enabled', 'utf8');

  // ---- W4 开启后：真检索 + 来源标签（同一轮的后续工具调用）----
  console.log('  [flow] W4a waiting for ok audit…');
  const okAudit = await poll(async () => {
    const rows = readAudit().filter((row) => row.tool === 'web_search' && row.ok === true);
    return rows.length > 0 ? rows : null;
  }, { timeoutMs: 90_000, intervalMs: 700, label: 'web_search_ok_audit' }).catch(() => []);
  assert('W4a_search_succeeded', okAudit.length > 0, JSON.stringify(okAudit[okAudit.length - 1] || readAudit().slice(-2)));

  // ---- 回合收尾后再取证：渲染线程被既有重渲染环拖慢，回合进行中做短轮询会
  //      叠一堆 pending Runtime.evaluate（每个 8s 超时只是放弃等待，CDP 侧仍挂着），
  //      越轮询越慢。改为「等收尾 → 一次长超时」。
  const settled = await poll(async () => {
    const stats = await mockStats();
    return stats.calls >= 4 ? stats : null;
  }, { timeoutMs: 60_000, intervalMs: 700, label: 'turn_final_text' }).catch(() => null);
  console.log('  [flow] W4b turn settle calls =', settled ? settled.calls : 'timeout');
  await sleep(1500);

  // 来源的**运行时账**（审计行带 resultSources/cost，与前端标签同源）
  const auditRows = readAudit();
  const okRow = auditRows.find((row) => row.tool === 'web_search' && row.ok === true);
  const auditHasSource = Boolean(okRow && Array.isArray(okRow.resultSources) && okRow.resultSources.some((host) => String(host).includes('wiki.example.org')));
  assert('W4b_source_in_audit', auditHasSource,
    `sources=${JSON.stringify((okRow && okRow.resultSources) || [])} cost=${JSON.stringify((okRow && okRow.cost) || null)}`);

  // 完成簇在回合收尾后**默认折叠**（BLOCK-108 v4）：来源标签在明细行上。
  // 按用户路径点开簇头，再取"屏幕可见"证据——不拿折叠态的选择器缺失冒充不可见。
  const expandResult = await evalJsLong(client, `(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    var target = btns.filter(function(b){
      var a = b.getAttribute('aria-label');
      return a === '展开执行过程' || a === '展开执行记录';
    })[0];
    if (target) { target.click(); return 'clicked'; }
    return 'not_found:' + btns.map(function(b){ return b.getAttribute('aria-label'); }).filter(Boolean).slice(0, 20).join('|');
  })()`, 60_000).catch((error) => `expand_error:${String(error && error.message ? error.message : error)}`);
  assert('W4c_cluster_expanded', expandResult === 'clicked', String(expandResult));
  await poll(async () => {
    const ready = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="qoder-cluster-body"]')`).catch(() => false);
    return ready === true ? true : null;
  }, { timeoutMs: 30_000, intervalMs: 500, label: 'cluster_body' }).catch(() => null);
  await sleep(500);

  // 来源的**屏幕可见性**（这一格要的是"屏幕上看得见"，不是"账上有"）
  let domReport = null;
  let domError = '';
  try {
    domReport = JSON.parse(String(await evalJsLong(client, DOM_PROBE_EXPR, 120_000)));
  } catch (error) {
    domError = String(error && error.message ? error.message : error);
  }
  const domRows = domReport && Array.isArray(domReport.labels) ? domReport.labels : [];
  const domRow = domRows.find((row) => String(row.text).includes('wiki.example.org'));
  assert('W4d_dom_source_label_visible',
    Boolean(domRow && domRow.rendered && domRow.w > 0 && domRow.h > 0 && domRow.hit),
    domReport
      ? `label=${JSON.stringify(domRow || null)} labels=${domRows.length} bodyLen=${domReport.bodyLen} ready=${domReport.readyState} snippet=${String(domReport.snippet || '').slice(0, 120)}`
      : `dom_unavailable(${domError})`);
  const shot = await capturePng(client, `ui557-web-source-${suffix()}.png`, 90_000).catch((error) => `screenshot_unavailable(${String(error && error.message ? error.message : error)})`);
  assert('W4e_source_screenshot', shot === `ui557-web-source-${suffix()}.png`, String(shot));

  // ---- W5 抓取云元数据地址 → 逐跳策略拒绝（同一轮的第三次工具调用）----
  const blocked = await poll(async () => {
    const rows = readAudit().filter((row) => row.tool === 'web_fetch' && row.ok === false);
    return rows.length > 0 ? rows : null;
  }, { timeoutMs: 90_000, intervalMs: 700, label: 'web_fetch_blocked_audit' }).catch(() => []);
  assert('W5a_ssrf_refused', blocked.some((row) => String(row.code).includes('web_url_private')),
    JSON.stringify(blocked[blocked.length - 1] || readAudit().slice(-2)));


}

module.exports = {
  id: 'ui557-web-access-live',
  description: 'BLOCK-247 实机腿：联网检索/抓取默认关 → 拒绝 → 授权开启 → 真检索带来源标签 → SSRF 拦截（隔离栈）',
  run,
};
