#!/usr/bin/env node
'use strict';
/**
 * scripts/block321c-collapse-threshold-live.cjs — UI-630 实机腿：折叠阈值 240。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 断言：合成拖拽右栏把手 200px（340 → ~140 < 240 新阈值；旧阈值 140 不触发）
 * → 右栏自动折叠（width 旗收起），中栏恢复宽裕。
 * 证据：acceptance/block-321c/live-collapse-threshold.json。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-321c');
const RAW_TIMEOUT = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1000); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 25000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(400);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 180));
}

const READ_LAYOUT = '(function(){' +
  'var right = document.querySelector(\'[class*="rightCol"]\');' +
  'return JSON.stringify({' +
  'vw: window.innerWidth,' +
  'rightOpen: !!(right && right.className.indexOf("rightColCollapsed") === -1),' +
  'right: right ? Math.round(right.getBoundingClientRect().width) : null,' +
  '});' +
  '})()';

/** 合成拖拽右栏把手 delta px（mousedown 直调 React props 处理器）。 */
const DRAG_RIGHT_HANDLE = '(function(){' +
  'var handles = [...document.querySelectorAll(\'[class*="resizeHandleV"]\')];' +
  'var handle = handles[handles.length - 1];' +
  'if (!handle) return "no_handle";' +
  'var rect = handle.getBoundingClientRect();' +
  'var x = rect.left + rect.width / 2, y = rect.top + Math.min(60, rect.height / 2);' +
  'var propsKey = Object.keys(handle).find(function(k){ return k.indexOf("__reactProps$") === 0; });' +
  'var ev = new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y, button: 0 });' +
  'var dispatched = false;' +
  'if (propsKey && handle[propsKey] && handle[propsKey].onMouseDown) { handle[propsKey].onMouseDown(ev); dispatched = "react-props"; }' +
  'else { handle.dispatchEvent(ev); dispatched = "native"; }' +
  'var resizing = document.body.classList.contains("petri-resizing-columns");' +
  'document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x + 200, clientY: y, buttons: 1 }));' +
  'document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x + 200, clientY: y, buttons: 1 }));' +
  'document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x + 200, clientY: y }));' +
  'return JSON.stringify({ dispatched: dispatched, resizingAfterDown: resizing });' +
  '})()';

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    const text = typeof detail === 'object' ? JSON.stringify(detail) : String(detail);
    records.push({ id, ok: ok === true || ok === 'true', detail: text.slice(0, 320) });
    console.log((ok === true || ok === 'true' ? 'PASS' : 'FAIL') + ' ' + id + ' ' + text.slice(0, 240));
    return ok === true || ok === 'true';
  };

  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, '!!document.getElementById("root")').catch(() => false),
  });
  const client = await lib.connectTarget(target);
  await client.send('Page.enable', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});

  const created = await rest('POST', '/data/projects', { name: 'BLOCK321c-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0_project_created', Boolean(projectId), 'id=' + (projectId || 'none'));
  await evalRetry(client, 'location.href = ' + JSON.stringify(APP_ORIGIN + '/project/' + projectId) + "; 'nav'");
  await pagePoll(client, '!!document.querySelector(\'[class*="workspaceSessionLayout"]\')', { label: 'layout' });

  // 清残留 + 重载，确保右栏默认 340 打开
  await evalRetry(client, "localStorage.removeItem('petri-pw-cols'); 'cleared'");
  await evalRetry(client, "location.reload(); 'reloading'");
  await pagePoll(client, '!!document.querySelector(\'[class*="workspaceSessionLayout"]\')', { label: 'layout-after-reload' });
  await sleep(1500);
  const t1 = JSON.parse(await evalRetry(client, READ_LAYOUT));
  assert('T1_right_default_open_340', t1.rightOpen && t1.right >= 320, t1);

  // 拖窄右栏 200px（340 → ~140 < 240 新阈值）：应快速折叠
  const dragInfo = await evalRetry(client, DRAG_RIGHT_HANDLE);
  await pagePoll(client, '(function(){' +
    'var right = document.querySelector(\'[class*="rightCol"]\');' +
    'return (right && right.className.indexOf("rightColCollapsed") !== -1) ? "collapsed" : "waiting";' +
    '})()', { timeoutMs: 15000, label: 'auto-collapse' });
  const t2 = JSON.parse(await evalRetry(client, READ_LAYOUT));
  let drag = {};
  try { drag = JSON.parse(dragInfo); } catch { drag = { raw: String(dragInfo).slice(0, 80) }; }
  assert('T2_drag_narrow_auto_collapse', drag.resizingAfterDown === true && t2.rightOpen === false, { drag, ...t2 });

  const pass = records.every((r) => r.ok);
  const evidence = { capturedAt: new Date().toISOString(), projectId, pass, checks: records };
  fs.writeFileSync(path.join(EVIDENCE, 'live-collapse-threshold.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('\nRESULT: ' + (pass ? 'PASS' : 'FAIL') + ' (' + records.filter((r) => r.ok).length + '/' + records.length + ')');
  console.log('evidence: acceptance/block-321c/live-collapse-threshold.json');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('PROBE-ERROR:', err.message);
  process.exit(2);
});
