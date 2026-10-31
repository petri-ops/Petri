#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 RULING-01 / P4-04a+P4-05 UI 实机腿（9223 离屏）：
 * 真实 STEP 文件经「导入为场景节点」→ 派生 GLB 节点出现 → 生成 HLR 工程图 → 打开 SVG。
 * 前提：后端 :3001 + 测试实例 9223（bash scripts/start-test-instance.sh）。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.BLOCK322_API || 'http://127.0.0.1:3001';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rest(method, endpoint, body, { timeoutMs = 120_000 } = {}) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: {
      Authorization: 'Bearer desktop-local',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function evalJs(client, expression, timeoutMs = 20_000) {
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
  let rounds = 0;
  while (Date.now() < deadline) {
    rounds += 1;
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} rounds=${rounds} :: ${JSON.stringify(last).slice(0, 300)}`);
}

async function setFileOnInput(client, selector, absolutePath) {
  await client.send('DOM.enable');
  const document = await client.send('DOM.getDocument', { depth: -1 });
  const found = await client.send('DOM.querySelector', { nodeId: document.root.nodeId, selector });
  if (!found || !found.nodeId) throw new Error(`input_not_found: ${selector}`);
  await client.send('DOM.setFileInputFiles', { nodeId: found.nodeId, files: [absolutePath] });
}

function baseScene() {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: { width: 120 },
    nodes: [{ id: 'base', type: 'box', dimensions: { width: 'width', height: 40, depth: 80 }, material: { color: '#6a8caf' } }],
    constraints: [],
    metadata: { title: 'BLOCK-322 RULING-01 CAD UI live' },
  };
}

const panelSnapshot = `(function(){
  var panel = document.querySelector('[data-testid="model3d-surface"]');
  if (!panel) return JSON.stringify({ present: false });
  var canvas = panel.querySelector('[data-testid="model3d-canvas"]');
  var pixels = 0;
  if (canvas) { try { pixels = (canvas.toDataURL('image/png') || '').length; } catch (e) { pixels = -1; } }
  var alert = panel.querySelector('[role="alert"]');
  var cad = panel.querySelector('[data-testid="model3d-cad-capability"]');
  return JSON.stringify({
    present: true,
    hasCanvas: !!canvas,
    text: (panel.textContent || '').replace(/\\s+/g, ''),
    alert: alert ? (alert.textContent || '') : '',
    cad: cad ? (cad.textContent || '').replace(/\\s+/g, '') : '',
    pixels: pixels,
  });
})()`;

async function makeStepFile() {
  const { OcctKernel } = await import('occt-wasm');
  const kernel = await OcctKernel.init();
  try {
    const step = kernel.exportStep(kernel.makeBox(60, 40, 20));
    const file = path.join(os.tmpdir(), `block322-ruling01-${crypto.randomBytes(4).toString('hex')}.step`);
    fs.writeFileSync(file, step);
    return file;
  } finally {
    kernel[Symbol.dispose]();
  }
}

async function run(ctx) {
  const { assert } = ctx;
  const detail = {};
  let projectId = null;
  let workspacePath = null;
  let client = null;
  let stepFile = null;
  try {
    const capability = await rest('GET', '/model3d/capability');
    assert('A0_capability', capability.status === 200 && capability.data?.cad?.status === 'ready'
      && capability.data.cad.formats.stepImport === true && capability.data.cad.formats.drawingSvg === true,
    JSON.stringify(capability.data?.cad).slice(0, 300));
    detail.capability = capability.data?.cad || null;

    const project = await rest('POST', '/data/projects', { name: `BLOCK322-CAD-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    workspacePath = project.data?.project?.workspace_path || project.data?.workspace_path || null;
    assert('A1_project', project.status === 200 && Boolean(projectId) && Boolean(workspacePath) && fs.existsSync(workspacePath),
      JSON.stringify({ projectId, workspacePath }).slice(0, 240));

    stepFile = await makeStepFile();

    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJs(client, `(function(){
      localStorage.setItem('petri.workSurfaceTabs.v1.' + ${JSON.stringify(projectId)},
        JSON.stringify({ version: 1, tabs: [{ id: 'model3d', surfaceId: 'model3d' }], activeId: 'model3d' }));
      location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(projectId)};
      return 'navigating';
    })()`);
    await poll(async () => {
      const pathname = await evalJs(client, 'location.pathname').catch(() => '');
      return pathname === `/project/${projectId}` ? pathname : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'project_route' });
    await evalJs(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        var text = (btns[i].textContent || '').trim();
        if (text === '开始使用' || text === '知道了') btns[i].click();
        if (text === '3D 模型') btns[i].click();
      }
      return 'ok';
    })()`).catch(() => null);
    await poll(async () => {
      const found = await evalJs(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false);
      return found === true ? true : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'model3d_surface' });

    const capabilityText = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return /CAD/.test(parsed.cad) && /occt-wasm/.test(parsed.cad) ? parsed : null;
    }, { timeoutMs: 20_000, intervalMs: 500, label: 'cad_capability_badge' });
    assert('U0_cad_capability_visible', /CAD/.test(capabilityText.cad) && /occt-wasm/.test(capabilityText.cad),
      JSON.stringify(capabilityText).slice(0, 300));

    await evalJs(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '加载示例') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return parsed.hasCanvas && parsed.pixels > 1000 ? parsed : null;
    }, { timeoutMs: 30_000, intervalMs: 600, label: 'baseline_canvas' });

    await setFileOnInput(client, '[data-testid="model3d-asset-input"]', stepFile);
    const imported = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return /已作为节点asset-/.test(parsed.text) && /可生成HLR线框工程图/.test(parsed.text) ? parsed : null;
    }, { timeoutMs: 60_000, intervalMs: 700, label: 'cad_import_notice' });
    assert('U1_cad_imported_as_node', imported.alert === '' && /mesh-reference/.test(imported.text),
      JSON.stringify(imported).slice(0, 420));
    const assetsDir = path.join(workspacePath, 'model3d', 'assets');
    const derived = fs.existsSync(assetsDir)
      ? fs.readdirSync(assetsDir).filter((name) => /\.(glb|stl)$/i.test(name))
      : [];
    assert('U2_derived_mesh_on_disk', derived.length >= 1, JSON.stringify(derived).slice(0, 200));
    const sceneFile = path.join(workspacePath, 'model3d', 'scene.scene3d.json');
    assert('U3_scene_references_derived_mesh', fs.existsSync(sceneFile)
      && fs.readFileSync(sceneFile, 'utf8').includes('mesh-reference'), sceneFile.slice(-80));

    const clicked = await evalJs(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '生成工程图') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('U4a_drawing_button_clicked', clicked === 'clicked', String(clicked));
    const drawing = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return /打开工程图/.test(parsed.text) && /线框工程图/.test(parsed.text) ? parsed : null;
    }, { timeoutMs: 60_000, intervalMs: 700, label: 'drawing_link' });
    assert('U4b_drawing_link_present', drawing.alert === '' && /隐藏线已画\/尺寸链与GD&T未包含/.test(drawing.text),
      JSON.stringify(drawing).slice(0, 420));
    const drawingsDir = path.join(workspacePath, 'model3d', 'drawings');
    const svgFiles = fs.existsSync(drawingsDir) ? fs.readdirSync(drawingsDir).filter((name) => /\.svg$/i.test(name)) : [];
    assert('U4c_svg_on_disk', svgFiles.length >= 1
      && fs.readFileSync(path.join(drawingsDir, svgFiles[0]), 'utf8').includes('<svg'), JSON.stringify(svgFiles).slice(0, 200));
    detail.ui = { capability: capabilityText.cad, importedText: imported.text.slice(0, 500), derived, svgFiles };

    fs.mkdirSync(path.join(ROOT, 'acceptance', 'block-322-ruling01'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'acceptance', 'block-322-ruling01', 'block322-ruling01-cad-ui-detail.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      api: API,
      projectId,
      ...detail,
    }, null, 2)}\n`, 'utf8');
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    if (stepFile) { try { fs.rmSync(stepFile, { force: true }); } catch { /* best effort */ } }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'block322-ruling01-cad-ui-live',
  description: 'BLOCK-322 RULING-01：UI 导入 STEP → 派生网格节点 → 生成 HLR 工程图并打开 SVG（9223 离屏）',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-322-ruling01'),
  run,
};
