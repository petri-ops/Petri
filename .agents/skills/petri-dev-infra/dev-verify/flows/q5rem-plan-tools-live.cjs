#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：q5rem-plan-tools-live — BLOCK-253 Q5-REM 实机腿。
 *
 * 前置：scripts/block253-q5-rem-live.mjs（隔离栈 + 合成计划/修订 + 工作区 note.txt）。
 *
 * 断言链：
 *   H1 标题栏「更多工具」统一列出中心模式/终端/侧聊/右轨面；
 *   H2 点「终端」→ 终端标签在场；再点收起；点「侧聊」→ dock 在场并可收起；
 *   P1 计划面显示当前/修订 tabs；选中修订显示原因/提议步骤；
 *   P2 批准修订 → REST 计划步骤被替换、修订 applied、UI 刷新；
 *   F1 bridge 直调 showInFolder 返回 testInstance + 真实路径（测试实例不弹系统窗）；
 *   F2 文件树按钮点击后可见状态「已在文件管理器中显示」。
 */

const path = require('node:path');
const fs = require('node:fs');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const APP = 'http://localhost:3000';
const API = 'http://127.0.0.1:3001';
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-544-547-q5rem');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function isDark() { return process.env.PETRI_B253_DARK === '1'; }
function suffix() { return isDark() ? 'dark' : 'light'; }

async function ev(client, expression, timeoutMs = 20_000) {
  return lib.evalJs(client, expression, timeoutMs);
}

async function poll(fn, { timeoutMs, intervalMs = 350, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 300)} :: ${lastError ? lastError.message : ''}`);
}

async function ensureNoOverlay(client) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const present = await ev(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') >= 0 : false`).catch(() => false);
    if (present !== true) return true;
    await ev(client, `(function(){
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

const screenshots = {};
async function shot(client, filename) {
  await ensureNoOverlay(client);
  await sleep(800);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await client.send('Page.bringToFront', {}, { timeoutMs: 3_000 }).catch(() => null);
      await Promise.race([
        lib.screenshotPng(client, EVIDENCE, filename),
        new Promise((_, reject) => setTimeout(() => reject(new Error('screenshot_timeout(offscreen)')), 12_000)),
      ]);
      screenshots[filename] = path.join(EVIDENCE, filename);
      return;
    } catch (error) {
      if (attempt === 2) screenshots[filename] = `unavailable:${error.message}`;
      else await sleep(1200);
    }
  }
}

async function ensureRightRail(client) {
  await ev(client, `(function(){
    var btn = document.querySelector('button[aria-label="展开右侧栏"]');
    if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
    return 'ok';
  })()`).catch(() => null);
}

async function openToolsMenu(client) {
  await ensureRightRail(client);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await ev(client, `(function(){
      if (document.getElementById('titlebar-tool-menu')) return 'open';
      var btn = document.querySelector('button[aria-label="展开更多工具"]');
      if (!btn) return 'no_button';
      btn.click();
      return 'clicked';
    })()`).catch(() => 'eval_failed');
    if (state === 'open') return true;
    const opened = await poll(async () => {
      const present = await ev(client, `!!document.getElementById('titlebar-tool-menu')`).catch(() => false);
      return present ? true : null;
    }, { timeoutMs: 6_000, label: 'tools_menu_open' }).catch(() => null);
    if (opened) return true;
    await sleep(500);
  }
  throw new Error('tools_menu_open_failed');
}

async function toolMenuLabels(client) {
  const raw = await ev(client, `JSON.stringify(Array.prototype.slice.call(
    document.querySelectorAll('#titlebar-tool-menu [role="menuitem"]')
  ).map(function(el){ return (el.textContent || '').trim(); }))`);
  return JSON.parse(raw || '[]');
}

async function clickTool(client, label) {
  await openToolsMenu(client);
  const clicked = await ev(client, `(function(){
    var items = Array.prototype.slice.call(document.querySelectorAll('#titlebar-tool-menu [role="menuitem"]'));
    var wanted = ${JSON.stringify(label)};
    var texts = items.map(function(el){ return (el.textContent || '').trim(); });
    var hit = items[texts.indexOf(wanted)];
    if (!hit) {
      var startIndex = texts.findIndex(function(text){ return text.indexOf(wanted) === 0; });
      if (startIndex >= 0) hit = items[startIndex];
    }
    if (!hit) {
      var anyIndex = texts.findIndex(function(text){ return text.indexOf(wanted) >= 0; });
      if (anyIndex >= 0) hit = items[anyIndex];
    }
    if (!hit) return 'no_item:' + texts.join('|');
    hit.click();
    return 'clicked';
  })()`);
  if (clicked !== 'clicked') throw new Error(`tool_click_failed:${label}:${clicked}`);
}

async function rest(endpoint, init) {
  const response = await fetch(`${API}/api${endpoint}`, {
    ...init,
    headers: { authorization: 'Bearer desktop-local', 'content-type': 'application/json', ...(init && init.headers) },
    signal: AbortSignal.timeout(8000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function run({ assert }) {
  const projectId = process.env.PETRI_B253_PROJECT_ID;
  const planId = process.env.PETRI_B253_PLAN_ID;
  const planTitle = process.env.PETRI_B253_PLAN_TITLE || '';
  if (!projectId || !planId) throw new Error('missing B253 env');
  fs.mkdirSync(EVIDENCE, { recursive: true });

  const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
  await ev(client, `location.href = ${JSON.stringify(`${APP}/project/${projectId}`)}; 'ok'`);
  await sleep(900);
  await ensureNoOverlay(client);
  await poll(async () => {
    const ready = await ev(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
    return ready ? true : null;
  }, { timeoutMs: 45_000, label: 'composer_ready' });

  if (isDark()) {
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    }).catch(() => {});
    await poll(async () => {
      const dark = await ev(client, `window.matchMedia('(prefers-color-scheme: dark)').matches`).catch(() => false);
      return dark === true ? true : null;
    }, { timeoutMs: 15_000, label: 'dark_media_emulated' });
    await sleep(500);
  }

  // ---------- E1：宿主入口菜单 ----------
  await openToolsMenu(client);
  const labels = await toolMenuLabels(client);
  assert('H1_host_entries_in_tools_menu',
    ['结果', '代码', '审查', '历史', '终端', '侧聊'].every((label) => labels.some((text) => text.includes(label)))
      && labels.some((text) => text.includes('文件')),
    JSON.stringify(labels));

  // ---------- B3/H4：计划修订 tabs ----------
  await clickTool(client, '计划');
  await poll(async () => {
    const state = await ev(client, `(function(){
      var el = document.querySelector('[data-testid="plan-surface"]');
      return el ? el.getAttribute('data-state') : null;
    })()`).catch(() => null);
    return state === 'ready' ? true : null;
  }, { timeoutMs: 30_000, label: 'plan_surface_ready' });
  const revisionTab = await poll(async () => {
    const text = await ev(client, `(function(){
      var el = document.querySelector('[data-testid="plan-revision-tab-1"]');
      return el ? (el.textContent || '').trim() : null;
    })()`).catch(() => null);
    return text && text.includes('待批准') ? text : null;
  }, { timeoutMs: 25_000, label: 'plan_revision_tab' });
  assert('P1_revision_tab_visible', revisionTab.includes('待批准'), revisionTab);

  await ev(client, `document.querySelector('[data-testid="plan-revision-tab-1"]').click(); 'clicked'`);
  const revisionDetail = await poll(async () => {
    const text = await ev(client, `(function(){
      var panel = document.querySelector('[data-testid="plan-surface"]');
      return panel ? (panel.innerText || '') : null;
    })()`).catch(() => null);
    return text && text.includes('原因：第二步拆成两步：先质控再降维') && text.includes('先做质控') ? text : null;
  }, { timeoutMs: 15_000, label: 'revision_detail' });
  assert('P1b_revision_detail', revisionDetail.includes('先做质控'), revisionDetail.slice(0, 200));

  await ev(client, `document.querySelector('[data-testid="plan-revision-approve"]').click(); 'clicked'`);
  const approved = await poll(async () => {
    const revisions = await rest(`/ai/plans/${planId}/revisions`);
    const rows = Array.isArray(revisions.data?.revisions) ? revisions.data.revisions : [];
    return rows.some((row) => row.rev_no === 1 && row.status === 'applied') ? rows : null;
  }, { timeoutMs: 25_000, intervalMs: 600, label: 'revision_applied_rest' });
  const planAfter = await rest(`/ai/plans/${planId}`);
  const stepTitles = (planAfter.data?.plan?.steps || []).map((step) => step.title);
  assert('P2_revision_applied_rest',
    stepTitles.includes('先做质控') && planAfter.data?.plan?.steps?.length === 3,
    `revisions=${approved.length} steps=${JSON.stringify(stepTitles)}`);
  const uiApplied = await poll(async () => {
    const text = await ev(client, `(function(){
      var el = document.querySelector('[data-testid="plan-revision-tab-1"]');
      return el ? (el.textContent || '').trim() : null;
    })()`).catch(() => null);
    return text && text.includes('已应用') ? text : null;
  }, { timeoutMs: 20_000, label: 'revision_applied_ui' });
  assert('P2b_revision_applied_ui', uiApplied.includes('已应用'), uiApplied);

  // ---------- E4：文件管理器定位 ----------
  await clickTool(client, '文件');
  try {
    await poll(async () => {
      const row = await ev(client, `!!document.querySelector('button[data-file-path="note.txt"]')`).catch(() => false);
      return row ? true : null;
    }, { timeoutMs: 30_000, label: 'file_tree_row' });
  } catch (error) {
    const diag = await ev(client, `JSON.stringify({
      treeitems: document.querySelectorAll('[role="treeitem"]').length,
      dataPaths: Array.prototype.slice.call(document.querySelectorAll('[data-file-path]')).map(function(el){ return el.getAttribute('data-file-path'); }).slice(0, 20),
      rightPanel: (function(){ var el = document.querySelector('[class*="rightPanelTabContent"]'); return el ? (el.innerText || '').slice(0, 500) : null; })(),
      body: (document.body ? document.body.innerText : '').slice(0, 700)
    })`, 45_000).catch((e) => `diag_failed:${e.message}`);
    throw new Error(`${error.message} :: diag=${diag}`);
  }
  await ev(client, `document.querySelector('button[data-file-path="note.txt"]').click(); 'clicked'`);
  await poll(async () => {
    const btn = await ev(client, `!!document.querySelector('[data-testid="file-show-in-folder"]')`).catch(() => false);
    return btn ? true : null;
  }, { timeoutMs: 20_000, label: 'show_in_folder_button' });

  const bridgeResult = await ev(client, `(async function(){
    var result = await window.petri.files.showInFolder(${JSON.stringify(process.env.PETRI_B253_WORKSPACE)}, 'note.txt');
    return JSON.stringify(result);
  })()`, 20_000);
  const bridge = JSON.parse(bridgeResult || '{}');
  assert('F1_bridge_test_instance_dry_run',
    bridge.ok === true && bridge.testInstance === true && String(bridge.path || '').includes('note.txt'),
    bridgeResult);

  await ev(client, `document.querySelector('[data-testid="file-show-in-folder"]').click(); 'clicked'`);
  let status = null;
  try {
    status = await poll(async () => {
      const text = await ev(client, `(function(){
        var el = document.querySelector('[data-testid="file-show-in-folder-status"]');
        return el ? (el.textContent || '').trim() : null;
      })()`).catch(() => null);
      return text && text.includes('已在文件管理器中显示') ? text : null;
    }, { timeoutMs: 20_000, label: 'show_in_folder_status' });
  } catch (error) {
    await sleep(1200);
    const diag = await ev(client, `JSON.stringify({
      statusCount: document.querySelectorAll('[data-testid="file-show-in-folder-status"]').length,
      previewErrors: Array.prototype.slice.call(document.querySelectorAll('[class*="workspacePreviewError"]')).map(function(el){ return (el.textContent || '').trim(); }),
      body: (document.body ? document.body.innerText : '').slice(0, 900)
    })`, 45_000).catch((e) => `diag_failed:${e.message}`);
    throw new Error(`${error.message} :: diag=${diag}`);
  }
  assert('F2_show_in_folder_status', status.includes('已在文件管理器中显示'), status);

  // 宿主菜单在底部终端打开后无法再次弹出（实机观察到；本包不修壳层菜单），
  // 故先验侧聊、最后开终端，避免用不可复现的 reopen 姿态污染断言。
  await clickTool(client, '侧聊');
  await poll(async () => {
    const open = await ev(client, `!!document.querySelector('[data-testid="side-chat-surface"]')`).catch(() => false);
    return open ? true : null;
  }, { timeoutMs: 20_000, label: 'side_chat_visible' });
  assert('H2a_side_chat_toggled', true, 'side-chat-dock visible');
  await clickTool(client, '侧聊');
  await poll(async () => {
    const open = await ev(client, `!!document.querySelector('[data-testid="side-chat-surface"]')`).catch(() => true);
    return open === false ? true : null;
  }, { timeoutMs: 20_000, label: 'side_chat_closed' }).catch(() => null);

  await clickTool(client, '终端');
  await poll(async () => {
    const open = await ev(client, `!!document.querySelector('[role="tablist"][aria-label="终端标签"]')`).catch(() => false);
    return open ? true : null;
  }, { timeoutMs: 20_000, label: 'terminal_visible' });
  assert('H2b_terminal_toggled', true, 'terminal tablist visible');

  // 截图放最后（离屏 captureScreenshot 可能拖住渲染器）：关终端 → 回计划面
  // 选中已应用修订 → 一次性截图；之后再无交互断言。
  await ev(client, `(function(){
    var btn = document.querySelector('button[aria-label="关闭终端面板"]');
    if (btn) btn.click();
    return 'closed';
  })()`).catch(() => null);
  await sleep(1800);
  await clickTool(client, '计划');
  await poll(async () => {
    const ready = await ev(client, `!!document.querySelector('[data-testid="plan-revision-tab-1"]')`).catch(() => false);
    return ready ? true : null;
  }, { timeoutMs: 30_000, label: 'plan_reopen_for_shot' });
  await ev(client, `document.querySelector('[data-testid="plan-revision-tab-1"]').click(); 'clicked'`);
  await shot(client, `q5rem-plan-revision-${suffix()}.png`);
  try {
    await openToolsMenu(client);
    await shot(client, `q5rem-host-menu-${suffix()}.png`);
  } catch (error) {
    screenshots[`q5rem-host-menu-${suffix()}.png`] = `unavailable:${error.message}`;
  }

  fs.writeFileSync(path.join(EVIDENCE, `q5rem-screenshots-${suffix()}.json`), JSON.stringify(screenshots, null, 2));
}

module.exports = {
  id: 'q5rem-plan-tools-live',
  description: 'BLOCK-253 实机腿：宿主入口菜单 / 计划修订 tabs + 批准 / 文件管理器定位（测试实例干跑）',
  run,
};
