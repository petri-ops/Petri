#!/usr/bin/env node
'use strict';

/** NEXT-06 韧性实机：3D 首帧耗时、WebGL 上下文丢失边界、刷新后恢复。 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.NEXT06_API || 'http://127.0.0.1:3011';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'next-06-convergence');
const WORKSPACE = path.join(EVIDENCE_DIR, 'resilience-workspace');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function evalJs(client, expression, timeoutMs = 20_000) {
  let timer = null;
  try {
    return await Promise.race([
      lib.evalJs(client, expression),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cdp_eval_timeout')), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
async function poll(fn, { timeoutMs, intervalMs = 500, label }) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(intervalMs); }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 200)}`);
}
async function rest(method, endpoint, body) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: { Authorization: 'Bearer desktop-local', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function open3D(client) {
  await evalJs(client, `(function(){
    if (!document.querySelector('[data-testid="model3d-surface"]')) {
      var expand = document.querySelector('[aria-label="展开右侧栏"]');
      if (expand) expand.click();
    }
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) if ((btns[i].textContent || '').trim() === '3D 模型') { btns[i].click(); return 'opened'; }
    return 'missing';
  })()`).catch(() => null);
  await poll(async () => (await evalJs(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false)) === true ? true : null,
    { timeoutMs: 20_000, intervalMs: 500, label: 'surface' });
  await evalJs(client, `(function(){
    var panel = document.querySelector('[data-testid="model3d-surface"]');
    var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) if ((btns[i].textContent || '').trim() === '加载示例') { btns[i].click(); return 'clicked'; }
    return 'missing';
  })()`);
  await poll(async () => (await evalJs(client, `!!document.querySelector('[data-testid="model3d-surface"] canvas')`).catch(() => false)) === true ? true : null,
    { timeoutMs: 30_000, intervalMs: 400, label: 'canvas' });
}

async function run({ assert }) {
  let projectId = null;
  let client = null;
  try {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    const project = await rest('POST', '/data/projects', { name: `NEXT-06-R-${Date.now()}`, workspacePath: WORKSPACE });
    projectId = project.data?.project?.id || null;
    assert('R0_project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 180));

    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJs(client, `(function(){
      localStorage.setItem('petri.workSurfaceTabs.v1.' + ${JSON.stringify(projectId)},
        JSON.stringify({ version: 1, tabs: [{ id: 'model3d', surfaceId: 'model3d' }], activeId: 'model3d' }));
      location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(projectId)};
      return 'navigating';
    })()`);
    await poll(async () => {
      const p = await evalJs(client, 'location.pathname').catch(() => '');
      return p === `/project/${projectId}` ? p : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'route' });
    await poll(async () => (await evalJs(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false)) === true ? true : null,
      { timeoutMs: 40_000, intervalMs: 600, label: 'workspace' }).catch(() => null);

    const started = Date.now();
    await open3D(client);
    const firstFrameMs = Date.now() - started;
    assert('R1_first_frame', firstFrameMs > 0 && firstFrameMs < 30_000, `${firstFrameMs}ms`);

    const lost = await evalJs(client, `(function(){
      var canvas = document.querySelector('[data-testid="model3d-surface"] canvas');
      if (!canvas) return 'missing';
      canvas.dispatchEvent(new Event('webglcontextlost', { bubbles: false, cancelable: true }));
      return 'dispatched';
    })()`);
    assert('R2_context_lost_dispatched', lost === 'dispatched', String(lost));
    const lossText = await poll(async () => {
      const text = await evalJs(client, `(function(){ var p=document.querySelector('[data-testid="model3d-surface"]'); return p ? p.textContent : ''; })()`).catch(() => '');
      return text.includes('webgl_context_lost') ? text : null;
    }, { timeoutMs: 5000, intervalMs: 200, label: 'context_lost_text' });
    assert('R3_context_lost_honest', Boolean(lossText), String(lossText).slice(0, 300));

    await evalJs(client, `location.reload(); 'reload'`);
    await sleep(2500);
    await poll(async () => (await evalJs(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false)) === true ? true : null,
      { timeoutMs: 40_000, intervalMs: 600, label: 'workspace_after_reload' }).catch(() => null);
    await open3D(client);
    const recovered = await evalJs(client, `(function(){
      var p = document.querySelector('[data-testid="model3d-surface"]');
      return JSON.stringify({ canvas: !!p.querySelector('canvas'), text: (p.textContent || '').includes('webgl_context_lost') });
    })()`).catch(() => '{}');
    assert('R4_recovered_after_reload', JSON.parse(recovered).canvas === true, recovered);

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'resilience.json'), JSON.stringify({ firstFrameMs, recovered: JSON.parse(recovered) }, null, 2));
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* closed */ }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'next06-resilience-live',
  description: 'NEXT-06 韧性：3D 首帧/WebGL 上下文丢失/刷新恢复',
  evidenceDir: EVIDENCE_DIR,
  run,
};
