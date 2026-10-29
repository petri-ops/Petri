#!/usr/bin/env node
'use strict';

/** NEXT-04A 前端 3D 预览实机腿：SceneSpec 示例 → Three.js canvas → 视角切换 → 节点统计。 */

const path = require('node:path');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.NEXT04A_API || 'http://127.0.0.1:3011';

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

async function poll(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 240)}`);
}

async function rest(method, endpoint, body) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: {
      Authorization: 'Bearer desktop-local',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function dismissOverlays(client) {
  await evalJsWithTimeout(client, `(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      var text = (btns[i].textContent || '').trim();
      if (text === '开始使用' || text === '知道了') btns[i].click();
    }
    return 'ok';
  })()`).catch(() => null);
  await sleep(400);
}

async function run({ assert }) {
  let projectId = null;
  let client = null;
  try {
    const project = await rest('POST', '/data/projects', { name: `NEXT-04A-3D-${Date.now()}` });
    projectId = project.data?.project?.id || null;
    assert('W0_temp_project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 220));

    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJsWithTimeout(client, `(function(){
      localStorage.setItem('petri.workSurfaceTabs.v1.' + ${JSON.stringify(projectId)},
        JSON.stringify({ version: 1, tabs: [{ id: 'model3d', surfaceId: 'model3d' }], activeId: 'model3d' }));
      location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(projectId)};
      return 'navigating';
    })()`);
    await poll(async () => {
      const pathname = await evalJsWithTimeout(client, 'location.pathname').catch(() => '');
      return pathname === `/project/${projectId}` ? pathname : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'project_route' });
    await dismissOverlays(client);
    await poll(async () => {
      const ready = await evalJsWithTimeout(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
      return ready === true ? true : null;
    }, { timeoutMs: 40_000, intervalMs: 600, label: 'workspace_ready' }).catch(() => null);

    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      if (!panel) {
        var expand = document.querySelector('[aria-label="展开右侧栏"]');
        if (expand) expand.click();
      }
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '3D 模型') { btns[i].click(); return 'opened'; }
      }
      return 'missing';
    })()`).catch(() => null);

    await poll(async () => {
      const found = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false);
      return found === true ? true : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'model3d_surface' });

    const clicked = await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '加载示例') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('W1_sample_loaded', clicked === 'clicked', String(clicked));

    const canvas = await poll(async () => {
      const raw = await evalJsWithTimeout(client, `(function(){
        var panel = document.querySelector('[data-testid="model3d-surface"]');
        var canvas = panel.querySelector('[data-testid="model3d-canvas"]');
        if (!canvas) return JSON.stringify({ present: false, text: (panel.textContent || '').slice(0, 600) });
        var data = '';
        try { data = canvas.toDataURL('image/png'); } catch (e) { data = 'error:' + e.message; }
        return JSON.stringify({
          present: true,
          width: canvas.width,
          height: canvas.height,
          rect: (function(r){ return { width: r.width, height: r.height }; })(canvas.getBoundingClientRect()),
          snapshotLength: data.length,
          snapshotPrefix: data.slice(0, 32),
          text: (panel.textContent || '').slice(0, 800),
        });
      })()`).catch(() => '{}');
      const parsed = JSON.parse(raw || '{}');
      return parsed.present ? parsed : null;
    }, { timeoutMs: 30_000, intervalMs: 600, label: 'three_canvas' });
    assert('W2_three_canvas_present', canvas.width > 0 && canvas.height > 0 && canvas.rect.width > 0, JSON.stringify(canvas).slice(0, 300));
    assert('W3_scene_rendered_objects', String(canvas.text).includes('渲染对象2') || String(canvas.text).includes('渲染对象 2'), String(canvas.text).slice(0, 500));
    assert('W4_scene_stats', String(canvas.text).includes('节点2') || String(canvas.text).includes('节点 2'), String(canvas.text).slice(0, 500));
    assert('W5_canvas_has_pixels', canvas.snapshotLength > 1000 && String(canvas.snapshotPrefix).startsWith('data:image/png'), `len=${canvas.snapshotLength} prefix=${canvas.snapshotPrefix}`);

    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('[aria-label="3D 视角"] button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '顶') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    const switched = await poll(async () => {
      const pressed = await evalJsWithTimeout(client, `(function(){
        var panel = document.querySelector('[data-testid="model3d-surface"]');
        var btns = Array.prototype.slice.call(panel.querySelectorAll('[aria-label="3D 视角"] button'));
        for (var i = 0; i < btns.length; i += 1) {
          if ((btns[i].textContent || '').trim() === '顶') return btns[i].getAttribute('aria-pressed');
        }
        return null;
      })()`).catch(() => null);
      return pressed === 'true' ? pressed : null;
    }, { timeoutMs: 5000, intervalMs: 150, label: 'view_switch' }).catch(() => 'false');
    assert('W6_view_switch', switched === 'true', String(switched));
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'next04a-model3d-preview-live',
  description: 'NEXT-04A 3D 预览：示例 SceneSpec/Three canvas/节点统计/视角切换',
  evidenceDir: path.join(ROOT, 'acceptance', 'next-04a-3d-foundation'),
  run,
};
