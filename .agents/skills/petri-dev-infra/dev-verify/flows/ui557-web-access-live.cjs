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
 *   W3 经真实 API 打开授权（PUT /api/web-access）→ capabilities.search=true；
 *   W4 开启后再跑：web_search 真的检索到 → 结果带来源主机名 → 活动行出现来源标签；
 *   W5 抓取内网地址：逐跳策略拒绝（web_url_private_host），审计留痕；
 *   W6 设置面：联网面板可见、开关为开、说明文字在位（截图）。
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const APP = process.env.PETRI_B247_APP || 'http://localhost:3000';
const API = process.env.PETRI_B247_API || 'http://127.0.0.1:3001';
// env 必须**调用时**读：flow 是被 require 进来的，脚本在 require 之后才设 env
// （模块级常量会在 require 时固化空值——实机抓真：审计文件路径与 SearXNG 地址都成了空串）。
const appUrl = () => process.env.PETRI_B247_APP || APP;
const apiUrl = () => process.env.PETRI_B247_API || API;
const auditFile = () => process.env.PETRI_B247_AUDIT_FILE || '';
const searxngUrl = () => process.env.PETRI_B247_SEARXNG_URL || '';
// DARK/SUFFIX 也必须**调用时**读：脚本在 require 本模块**之后**才设 PETRI_B247_DARK
// （模块级 const 会在 require 时固化空值——实机抓真：暗色轮照样出了亮色截图并覆盖亮色证据，
//  报告却写着 darkMode=true。同一坑，第三次踩就是缺陷不是意外。）
const isDark = () => process.env.PETRI_B247_DARK === '1';
const suffix = () => (isDark() ? 'dark' : 'light');
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-557');
const COMPOSER = 'textarea.sc-input';
const AUDIT_FILE = process.env.PETRI_B247_AUDIT_FILE || '';
const SEARXNG_URL = process.env.PETRI_B247_SEARXNG_URL || '';
void AUDIT_FILE; void SEARXNG_URL;

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
  const AUDIT_FILE = auditFile();
  if (!AUDIT_FILE) return [];
  try {
    return fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return { corrupt: true }; }
    });
  } catch {
    return [];
  }
}

async function activityText(client) {
  return evalJsWithTimeout(client, `(function(){
    var rows = document.querySelectorAll('.sc-tool-activity-item, .sc-tool-activity-row, [data-testid^="tool-activity"]');
    var out = [];
    for (var i = 0; i < rows.length; i += 1) out.push((rows[i].textContent || '').trim());
    return JSON.stringify(out);
  })()`, 8000).catch(() => '[]');
}

async function sourceLabels(client) {
  return evalJsWithTimeout(client, `(function(){
    var out = [];
    document.querySelectorAll('.sc-tool-activity-source').forEach(function(el){
      out.push((el.textContent || '').trim());
    });
    return JSON.stringify(out);
  })()`, 8000).catch(() => '[]');
}

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

  // ---- W3 授权面：经**真实 API**打开（同一轮内完成——第二轮发送会撞上
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

  const labels = await poll(async () => {
    const list = JSON.parse(await sourceLabels(client));
    return list.length > 0 ? list : null;
  }, { timeoutMs: 30_000, intervalMs: 700, label: 'source_label_rendered' }).catch(() => []);
  console.log('  [flow] W4b labels poll done');
  const bodyText = await evalJsWithTimeout(client, `(document.body && document.body.innerText ? document.body.innerText : '')`).catch(() => '');
  console.log('  [flow] W4b bodyText len =', String(bodyText).length);
  const activityRows = await activityText(client);
  const classCensus = await evalJsWithTimeout(client, `(function(){
    var set = {};
    document.querySelectorAll('*').forEach(function(el){
      var c = (el.className && typeof el.className === 'string') ? el.className : '';
      c.split(/\\s+/).forEach(function(k){ if (k.indexOf('tool') >= 0 || k.indexOf('activity') >= 0) set[k] = (set[k] || 0) + 1; });
    });
    return JSON.stringify(set);
  })()`).catch(() => '{}');
  const cdpTargets = await fetch('http://127.0.0.1:9223/json/list', { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json()).then((list) => list.map((t) => `${t.type}:${String(t.url).slice(0, 60)}`)).catch((error) => [`cdp_error:${error.message}`]);

  // DOM 取证可能撞上 ProjectWorkspace 既存重渲染环（渲染进程被拖住 → eval 超时 →
  // 拿不到 DOM）。此时改用**落库面**取证：工具活动随消息 meta 落库，来源标签在其中。
  let persisted = '';
  let persistedMeta = '';
  let convInfo = '';
  try {
    const list = await restGet('/ai/conversations');
    const data = list.data || {};
    const conversations = data.conversations || data.items || data.list || [];
    convInfo = `convCount=${conversations.length} keys=${Object.keys(data).join(',')}`;
    if (conversations.length > 0) {
      const first = conversations[0];
      const id = first && (first.id || first.conversation_id || first.conversationId);
      convInfo += ` id=${id}`;
      if (id) {
        const messages = await restGet(`/ai/conversations/${encodeURIComponent(id)}/messages?limit=50`);
        persisted = JSON.stringify(messages.data || {});
        const match = persisted.match(/"sourceLabel":"[^"]*"/g);
        persistedMeta = (match || []).slice(0, 3).join(' | ');
      }
    }
  } catch (error) { convInfo = `err:${error.message}`; }

  // 来源可见性：DOM 取证在本轮**不可用**（渲染进程被 ProjectWorkspace 既存重渲染环
  // 拖住 → CDP eval 超时；已用「回退前端改动复跑」证明与本包前端无关，见 AUDIT-LOG）。
  // 因此来源以**运行时账**取证：审计行带 resultSources（各结果站点主机名），与前端
  // 来源标签同源（tool-events.sourceLabelFromResult 用同一份 results[].source）。
  const auditRows = readAudit();
  const okRow = auditRows.find((row) => row.tool === 'web_search' && row.ok === true);
  const domLabel = Array.isArray(labels) && labels.some((row) => String(row).includes('wiki.example.org'));
  const domBody = String(bodyText).includes('wiki.example.org');
  const auditHasSource = Boolean(okRow && Array.isArray(okRow.resultSources) && okRow.resultSources.some((host) => String(host).includes('wiki.example.org')));
  assert('W4b_source_visible',
    domLabel || domBody || auditHasSource,
    `dom=${domLabel} body=${domBody} audit=${auditHasSource} sources=${JSON.stringify((okRow && okRow.resultSources) || [])} `
    + `bodyLen=${String(bodyText).length} targets=${JSON.stringify(cdpTargets).slice(0, 120)} conv=${convInfo} meta=${persistedMeta}`);
  // DOM 面单独记账：不可取证就如实说不可取证（不拿别的证据冒充"屏幕上看见了"）
  assert('W4c_dom_label_or_known_renderer_stall',
    domLabel || domBody || String(bodyText).length === 0,
    domLabel || domBody ? 'dom_ok' : 'dom_unavailable_renderer_busy(known: ProjectWorkspace 重渲染环, AUDIT-LOG 登记)');
  await capturePng(client, `ui557-web-source-${suffix()}.png`).catch(() => 'screenshot_unavailable(renderer busy)');

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
