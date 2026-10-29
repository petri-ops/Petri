#!/usr/bin/env node
'use strict';
/**
 * scripts/block321c-center-priority-live.cjs — BLOCK-321c / UI-629 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 中栏优先宽度模型实机验证（用户裁决「固定中间栏宽度，除非手动调整」）：
 *   T1 默认双栏共存，中栏 ≥760；
 *   T2 拖宽右栏 600px → 钳制在 max = vw − 左 − gap − 中栏保底，中栏 ≥760。
 * 视口分档（1366 自动收让位）由纯函数测试 16/16 覆盖：OS resize 对隐藏
 * Electron 窗不传播（实测 vw 恒 1602），不冒充实机分档。
 * 证据：acceptance/block-321c/live-center-priority.json。
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

/** 布局读数：三栏 rect 宽（CSS modules 编译类名保留原词）。 */
const READ_LAYOUT = '(function(){' +
  'var q = function(sel){ var el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().width) : null; };' +
  'var right = document.querySelector(\'[class*="rightCol"]\');' +
  'return JSON.stringify({' +
  'vw: window.innerWidth,' +
  'left: q(\'[class*="leftCol"]\'),' +
  'center: q(\'[class*="workspaceSessionLayout"]\'),' +
  'rightOpen: !!(right && right.className.indexOf("rightColCollapsed") === -1),' +
  'right: right ? Math.round(right.getBoundingClientRect().width) : null,' +
  '});' +
  '})()';

/**
 * 模拟拖宽右栏把手 600px（delta 写死，避免模板嵌套）。
 * React 18 合成委托对合成 dispatchEvent 不响应——mousedown 直接调
 * React props 处理器；mousemove/mouseup 走 document 原生监听（响应 dispatch）。
 */
const DRAG_RIGHT_HANDLE_600 = '(function(){' +
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
  'document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x - 600, clientY: y, buttons: 1 }));' +
  'document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x - 600, clientY: y, buttons: 1 }));' +
  'document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x - 600, clientY: y }));' +
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

  // T1：清列宽持久化（前轮探针可能残留极值）→ reload → 默认双栏共存，中栏 ≥760
  await evalRetry(client, "localStorage.removeItem('petri-pw-cols'); 'cleared'");
  await evalRetry(client, "location.reload(); 'reloading'");
  await pagePoll(client, '!!document.querySelector(\'[class*="workspaceSessionLayout"]\')', { label: 'layout-after-reload' });
  await sleep(1500);
  const t1 = JSON.parse(await evalRetry(client, READ_LAYOUT));
  assert('T1_default_both_open_center_ok', t1.left > 0 && t1.rightOpen && t1.center >= 760, t1);

  // T2：拖宽右栏 600px → 钳制上限 = vw − 左 − gap − 中栏保底（现算，容差 8px 边框）
  const vwNow = await evalRetry(client, 'window.innerWidth');
  const leftW = JSON.parse(await evalRetry(client, READ_LAYOUT)).left;
  const expectedMax = Math.max(96, vwNow - leftW - 40 - 760);
  const dragInfo = await evalRetry(client, DRAG_RIGHT_HANDLE_600);
  await sleep(1000);
  const t2 = JSON.parse(await evalRetry(client, READ_LAYOUT));
  let drag = {};
  try { drag = JSON.parse(dragInfo); } catch { drag = { raw: String(dragInfo).slice(0, 80) }; }
  assert(
    'T2_drag_started_and_clamped',
    drag.resizingAfterDown === true && t2.rightOpen && t2.right <= expectedMax + 8 && t2.center >= 760,
    { drag, expectedMax, ...t2 },
  );

  const pass = records.every((r) => r.ok);
  const evidence = { capturedAt: new Date().toISOString(), projectId, pass, checks: records };
  fs.writeFileSync(path.join(EVIDENCE, 'live-center-priority.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('\nRESULT: ' + (pass ? 'PASS' : 'FAIL') + ' (' + records.filter((r) => r.ok).length + '/' + records.length + ')');
  console.log('evidence: acceptance/block-321c/live-center-priority.json');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('PROBE-ERROR:', err.message);
  process.exit(2);
});
