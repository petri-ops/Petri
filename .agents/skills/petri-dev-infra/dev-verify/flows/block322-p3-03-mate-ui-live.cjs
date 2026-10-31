#!/usr/bin/env node
'use strict';

/** BLOCK-322 P3-03 UI 实机腿：mate 求值结果进预览；非法 mate 如实回落。9223 离屏。 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.BLOCK322_API || 'http://127.0.0.1:3001';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rest(method, endpoint, body, { timeoutMs = 60_000 } = {}) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: { Authorization: 'Bearer desktop-local', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function evalJs(client, expression, timeoutMs = 25_000) {
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
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 300)}`);
}

async function setFileOnInput(client, selector, absolutePath) {
  await client.send('DOM.enable');
  const document = await client.send('DOM.getDocument', { depth: -1 });
  const found = await client.send('DOM.querySelector', { nodeId: document.root.nodeId, selector });
  if (!found || !found.nodeId) throw new Error(`input_not_found: ${selector}`);
  await client.send('DOM.setFileInputFiles', { nodeId: found.nodeId, files: [absolutePath] });
}

function box(id, width, height, depth, position) {
  return { id, type: 'box', dimensions: { width, height, depth }, transform: { position, rotation: [0, 0, 0] } };
}

function scene(constraints) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [
      box('base', 120, 40, 80, [0, 0, 0]),
      box('cap', 40, 10, 20, [0, 0, 100]),
    ],
    constraints,
    metadata: { title: 'BLOCK-322 P3-03 mate UI' },
  };
}

const readPanel = (client) => evalJs(client, `(function(){
  var p = document.querySelector('[data-testid="model3d-surface"]');
  return p ? (p.textContent || '').replace(/\\s+/g, '') : '';
})()`);
const boundsOf = (text) => {
  const match = /包围盒mm(\d+)×(\d+)×(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};
const objectsOf = (text) => {
  const match = /渲染对象(\d+)/.exec(text);
  return match ? Number(match[1]) : 0;
};

async function run(ctx) {
  const { assert } = ctx;
  let projectId = null;
  let client = null;
  const tempFiles = [];
  try {
    const health = await rest('GET', '/health');
    assert('P0_backend_reachable', health.status === 200 && health.data?.status === 'ok', JSON.stringify(health.data ?? {}).slice(0, 140));
    const project = await rest('POST', '/data/projects', { name: `BLOCK322-P303-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    assert('P1_temp_project', project.status === 200 && Boolean(projectId), JSON.stringify({ projectId }).slice(0, 120));

    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJs(client, `(function(){
      localStorage.setItem('petri.workSurfaceTabs.v1.' + ${JSON.stringify(projectId)},
        JSON.stringify({ version: 1, tabs: [{ id: 'model3d', surfaceId: 'model3d' }], activeId: 'model3d' }));
      location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(projectId)};
      return 'go';
    })()`);
    await poll(async () => {
      const pathname = await evalJs(client, 'location.pathname').catch(() => '');
      return pathname === `/project/${projectId}` ? pathname : null;
    }, { timeoutMs: 30_000, label: 'project_route' });
    await evalJs(client, `(function(){
      var b = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < b.length; i += 1) {
        var t = (b[i].textContent || '').trim();
        if (t === '开始使用' || t === '知道了' || t === '3D 模型') b[i].click();
      }
      return 'ok';
    })()`).catch(() => null);
    await poll(async () => (await evalJs(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false)) === true
      ? true : null, { timeoutMs: 30_000, label: 'model3d_surface' });

    const matedFile = path.join(os.tmpdir(), `block322-p303-mate-${Date.now()}.scene3d.json`);
    fs.writeFileSync(matedFile, JSON.stringify(scene([{ kind: 'mate', a: 'base', b: 'cap', aFace: '+z', bFace: '-z', offset: 5 }])), 'utf8');
    tempFiles.push(matedFile);
    await setFileOnInput(client, '[data-testid="model3d-file-input"]', matedFile);
    const matedPanel = await poll(async () => {
      const text = String(await readPanel(client).catch(() => ''));
      const bounds = boundsOf(text);
      return bounds && bounds[0] === 120 && bounds[1] === 80 && bounds[2] === 55 ? text : null;
    }, { timeoutMs: 45_000, intervalMs: 500, label: 'mated_bounds' });
    assert('U1_mate_bounds_in_preview', JSON.stringify(boundsOf(matedPanel)) === JSON.stringify([120, 80, 55]),
      JSON.stringify({ bounds: boundsOf(matedPanel), expect: [120, 80, 55] }).slice(0, 200));
    assert('U2_mate_label_visible', matedPanel.includes('贴合base+z→cap-z') && matedPanel.includes('offset5mm'),
      matedPanel.slice(0, 420));
    assert('U3_mate_no_fallback_warning', !matedPanel.includes('未能向本地后端取回求值结果') && objectsOf(matedPanel) === 2,
      JSON.stringify({ objects: objectsOf(matedPanel) }).slice(0, 120));

    const conflictFile = path.join(os.tmpdir(), `block322-p303-conflict-${Date.now()}.scene3d.json`);
    fs.writeFileSync(conflictFile, JSON.stringify(scene([{ kind: 'mate', a: 'base', b: 'cap', aFace: '+z', bFace: '+z' }])), 'utf8');
    tempFiles.push(conflictFile);
    await setFileOnInput(client, '[data-testid="model3d-file-input"]', conflictFile);
    const conflictPanel = await poll(async () => {
      const text = String(await readPanel(client).catch(() => ''));
      return text.includes('未能向本地后端取回求值结果') ? text : null;
    }, { timeoutMs: 45_000, intervalMs: 500, label: 'mate_honest_fallback' });
    assert('U4_invalid_mate_keeps_declared_bounds', JSON.stringify(boundsOf(conflictPanel)) === JSON.stringify([120, 80, 125]),
      JSON.stringify({ bounds: boundsOf(conflictPanel), expect: [120, 80, 125] }).slice(0, 200));
    assert('U5_invalid_mate_reason_visible', /需要法向相反|constraint/.test(conflictPanel) && conflictPanel.includes('预览按声明位置显示'),
      conflictPanel.slice(0, 420));

    fs.mkdirSync(path.join(ROOT, 'acceptance', 'block-322-p3'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'acceptance', 'block-322-p3', 'block322-p3-mate-ui-detail.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      api: API,
      projectId,
      mated: { bounds: boundsOf(matedPanel), objects: objectsOf(matedPanel) },
      conflict: { bounds: boundsOf(conflictPanel), objects: objectsOf(conflictPanel) },
    }, null, 2)}\n`, 'utf8');
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* closed */ }
    for (const file of tempFiles) { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'block322-p3-03-mate-ui-live',
  description: 'BLOCK-322 P3-03：mate 求值结果进预览；非法法向如实回落（9223 离屏）',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-322-p3'),
  run,
};
