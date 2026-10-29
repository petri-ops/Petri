#!/usr/bin/env node
'use strict';

/**
 * NEXT-02A 实机腿：三轴执行状态在指挥中心的真实投影 + 长作业列表有界。
 *
 * 前置：dev 栈（:3001/:3000）与 9223 测试实例已在跑；本 flow 自行种入
 * 1 个临时项目 + 16 个作业（2 活跃 + 14 终态），结束时删除，不污染用户项目。
 */

const path = require('node:path');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';

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

function seed() {
  process.env.PETRI_DB_PATH = path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
  process.env.PETRI_LOCAL_DATA_DIR = path.join(ROOT, '.petri-dev-user-data', 'data');
  const db = require(path.join(ROOT, 'core', 'petri-server', 'db.js'));
  const project = db.createProject({
    name: `NEXT-02A-状态实机-${Date.now()}`,
    description: 'temporary live-verification project',
  });
  const now = Date.now();
  const make = (name, status, offset) => {
    const job = db.createToolJob({
      toolId: 'next02a-probe',
      userId: 'local-user',
      params: {},
      status,
      name,
      projectId: project.id,
    });
    if (status !== 'pending' && status !== 'running') {
      db.updateToolJob(job.id, { status, completedAt: now - offset });
    }
    return job.id;
  };
  const runningId = make('NEXT-02A 运行中', 'running', 0);
  const pendingId = make('NEXT-02A 排队中', 'pending', 0);
  const doneIds = Array.from({ length: 14 }, (_, index) => make(`NEXT-02A 历史 ${index + 1}`, 'done', (index + 1) * 1000));
  return { db, project, runningId, pendingId, doneIds };
}

function cleanup(seeded) {
  if (!seeded) return;
  try {
    const database = seeded.db.getDatabase();
    database.prepare('DELETE FROM tool_jobs WHERE project_id = ?').run(seeded.project.id);
    seeded.db.deleteProject(seeded.project.id);
  } catch {
    // 清理失败不掩盖产品断言；临时项目带唯一前缀可人工辨识。
  }
}

async function dismissFirstRun(client) {
  const clicked = await evalJsWithTimeout(client, `(function(){
    var dismissed = [];
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      var text = (btns[i].textContent || '').trim();
      if (text === '开始使用' || text === '知道了') { btns[i].click(); dismissed.push(text); }
    }
    return dismissed.length ? dismissed.join(',') : 'none';
  })()`).catch(() => 'none');
  if (clicked !== 'none') await sleep(600);
  return clicked;
}

async function surfaceVisible(client) {
  return evalJsWithTimeout(client, `(function(){
    var el = document.querySelector('[data-testid="cc-tile-active"], [data-testid="cc-tile-history"]');
    if (!el) return 'missing';
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? 'visible' : 'hidden';
  })()`).catch(() => 'eval_failed');
}

async function openJobsPanel(client) {
  const state = await surfaceVisible(client);
  if (state === 'visible') return state;
  await evalJsWithTimeout(client, `(function(){
    var expand = document.querySelector('[aria-label="展开右侧栏"]');
    if (expand) expand.click();
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      var title = btns[i].querySelector('span');
      var text = (btns[i].textContent || '').trim();
      if (text.indexOf('指挥中心') >= 0) { btns[i].click(); return 'clicked'; }
    }
    return 'none';
  })()`).catch(() => null);
  await sleep(700);
  return surfaceVisible(client);
}

async function tiles(client) {
  const raw = await evalJsWithTimeout(client, `(function(){
    return JSON.stringify(Array.prototype.slice.call(document.querySelectorAll('[data-job-id]')).map(function(el){
      return {
        id: el.getAttribute('data-job-id'),
        kind: el.getAttribute('data-testid'),
        rawStatus: el.getAttribute('data-status'),
        execution: el.querySelector('[data-execution-status]')?.getAttribute('data-execution-status') || null,
        text: (el.textContent || '').trim(),
        rect: (function(r){ return { width: r.width, height: r.height }; })(el.getBoundingClientRect()),
      };
    }));
  })()`, 20_000);
  return JSON.parse(raw || '[]');
}

async function run({ assert }) {
  let seeded = null;
  let client = null;
  try {
    seeded = seed();
    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJsWithTimeout(client, `(function(){
      localStorage.setItem('petri.workSurfaceTabs.v1.' + ${JSON.stringify(seeded.project.id)},
        JSON.stringify({ version: 1, tabs: [{ id: 'jobs', surfaceId: 'jobs' }], activeId: 'jobs' }));
      location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(seeded.project.id)};
      return 'navigating';
    })()`);
    const routeReady = await poll(async () => {
      const pathname = await evalJsWithTimeout(client, 'location.pathname').catch(() => '');
      return pathname === `/project/${seeded.project.id}` ? pathname : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'project_route' }).catch(() => 'route_timeout');
    assert('L0_project_route_ready', routeReady === `/project/${seeded.project.id}`, String(routeReady));
    await dismissFirstRun(client);
    await poll(async () => {
      const ready = await evalJsWithTimeout(client, `!!document.querySelector('.sc-input')`).catch(() => false);
      return ready === true ? true : null;
    }, { timeoutMs: 40_000, intervalMs: 600, label: 'workspace_ready' }).catch(() => null);
    const panel = await openJobsPanel(client);
    const debug = panel === 'visible' ? '' : await evalJsWithTimeout(client, `JSON.stringify({
      path: location.pathname,
      text: (document.body.innerText || '').slice(0, 500),
      expand: !!document.querySelector('[aria-label="展开右侧栏"]'),
      tabs: localStorage.getItem('petri.workSurfaceTabs.v1.' + ${JSON.stringify(seeded.project.id)})
    })`).catch(() => 'debug_failed');
    assert('L1_jobs_surface_visible', panel === 'visible', `${panel} :: ${debug}`);

    const rows = await poll(async () => {
      const current = await tiles(client);
      return current.length > 0 ? current : null;
    }, { timeoutMs: 20_000, intervalMs: 500, label: 'job_tiles' });
    assert('L2_long_list_bounded_to_12', rows.length === 12, `tiles=${rows.length} seeded=16`);
    assert('L3_active_tiles_two', rows.filter((row) => row.kind === 'cc-tile-active').length === 2,
      JSON.stringify(rows.map((row) => row.kind)));

    const running = rows.find((row) => row.id === seeded.runningId);
    assert('L4_running_axis_and_label',
      running?.execution === 'running' && running?.text.includes('运行中'),
      JSON.stringify(running || null));
    const done = rows.find((row) => seeded.doneIds.includes(row.id));
    assert('L5_completed_axis_and_label',
      done?.execution === 'completed' && done?.text.includes('已完成'),
      JSON.stringify(done || null));
    const pending = rows.find((row) => row.id === seeded.pendingId);
    assert('L6_pending_axis_preserves_queue_label',
      pending?.execution === 'waiting' && /排队中/.test(pending?.text || ''),
      JSON.stringify(pending || null));
    assert('L7_tiles_have_geometry', rows.every((row) => row.rect.width > 0 && row.rect.height > 0),
      JSON.stringify(rows.filter((row) => !(row.rect.width > 0 && row.rect.height > 0)).slice(0, 3)));

    const focusBefore = await evalJsWithTimeout(client, `(function(){
      var btn = document.querySelector('[data-job-id] button');
      if (!btn) return 'no_button';
      btn.focus();
      return document.activeElement === btn ? 'focused' : 'focus_failed';
    })()`).catch(() => 'focus_failed');
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(150);
    const focusAfter = await evalJsWithTimeout(client, `(function(){
      var el = document.activeElement;
      var r = el ? el.getBoundingClientRect() : null;
      return JSON.stringify({ tag: el ? el.tagName : null, visible: !!r && r.width > 0 && r.height > 0, label: el ? (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').slice(0, 80) : null });
    })()`).catch(() => '{}');
    assert('L8_keyboard_focus_traverses_visible_control',
      focusBefore === 'focused' && JSON.parse(focusAfter || '{}').visible === true,
      `${focusBefore} ${focusAfter}`);
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    if (process.env.NEXT02A_KEEP_SEED !== '1') cleanup(seeded);
  }
}

module.exports = {
  id: 'next02a-status-live',
  description: 'NEXT-02A 三轴执行状态实机 + 长作业列表有界 + 临时数据清理',
  evidenceDir: path.join(ROOT, 'acceptance', 'next-02a-ui-trust-core'),
  run,
};
