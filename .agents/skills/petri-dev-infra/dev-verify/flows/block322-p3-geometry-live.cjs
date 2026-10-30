#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 P3-01 实机腿：几何操作在唯一执行器（Blender）里的数值回归。
 *
 * 验收重心是**数值**而不是观感：倒角会去料、布尔减会显著去料且刀体消失、阵列按 count
 * 倍增长——这些必须体现在网格报告（体积/包围盒）与导出产物里，否则「SceneSpec 是唯一
 * 真值」就是空话。预览端不重做几何（客户端 CSG = 第二几何执行器，撞 plan §4 红线 2），
 * 因此这里同时验「预览显式声明不加工」的那句话真的出现在面板上。
 *
 * 运行前提：主 dev 栈 + 测试实例在跑。证据落 acceptance/block-322-p3/。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.BLOCK322_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-322-p3');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rest(method, endpoint, body, { timeoutMs = 240_000 } = {}) {
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

function box(id, dimensions, position = [0, 0, 0], extra = {}) {
  return {
    id,
    type: 'box',
    dimensions,
    transform: { position, rotation: [0, 0, 0] },
    material: { color: '#6a8caf', roughness: 0.4 },
    ...extra,
  };
}

function sceneOf(nodes, extra = {}) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes,
    constraints: [],
    metadata: { title: 'BLOCK-322 P3-01 live' },
    ...extra,
  };
}

const BASE = { width: 120, height: 40, depth: 80 };
const BASE_VOLUME = 120 * 40 * 80;

async function buildExport(projectId, scene, scenePath) {
  const response = await rest('POST', '/model3d/scene/export', { projectId, scene, scenePath, formats: ['glb'] });
  return { status: response.status, data: response.data, report: response.data?.report || {} };
}

async function run(ctx) {
  const { assert } = ctx;
  const detail = {};
  let projectId = null;
  let client = null;
  const tempFiles = [];
  try {
    const capability = await rest('GET', '/model3d/capability');
    assert('G0_blender_ready', capability.status === 200 && capability.data?.status === 'ready', JSON.stringify(capability.data ?? {}).slice(0, 140));
    const project = await rest('POST', '/data/projects', { name: `BLOCK322-P3-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    assert('G1_temp_project', project.status === 200 && Boolean(projectId), JSON.stringify({ projectId }).slice(0, 120));

    // G2 基线体积
    const plain = await buildExport(projectId, sceneOf([box('base', BASE)]), 'model3d/plain.scene3d.json');
    const plainVolume = plain.report.mesh?.volumesMm3?.base ?? 0;
    assert('G2_baseline_volume_exact', plain.status === 200 && plain.data?.ok === true
      && Math.abs(plainVolume - BASE_VOLUME) < 1 && (plain.report.geometry?.applied || []).length === 0,
      JSON.stringify({ volume: plainVolume, geometry: plain.report.geometry }).slice(0, 220));

    // G3 倒角去料（体积略降，仍闭合）
    const beveled = await buildExport(projectId, sceneOf([
      box('base', BASE, [0, 0, 0], { modifiers: [{ kind: 'bevel', width: 8, segments: 4 }] }),
    ]), 'model3d/bevel.scene3d.json');
    const bevelVolume = beveled.report.mesh?.volumesMm3?.base ?? 0;
    assert('G3_bevel_removes_material', beveled.data?.ok === true && bevelVolume > plainVolume * 0.8
      && bevelVolume < plainVolume && beveled.report.mesh?.watertight === true,
      JSON.stringify({ plainVolume, bevelVolume, watertight: beveled.report.mesh?.watertight }).slice(0, 220));

    // G4 布尔减：显著去料 + 刀体被消费（不留在导出与报告里）
    const cut = await buildExport(projectId, sceneOf([
      box('cutter', { width: 60, height: 60, depth: 60 }, [30, 0, 0]),
      box('base', BASE, [0, 0, 0], { modifiers: [{ kind: 'boolean', operation: 'difference', target: 'cutter' }] }),
    ]), 'model3d/cut.scene3d.json');
    const cutVolumes = cut.report.mesh?.volumesMm3 || {};
    const cutVolume = cutVolumes.base ?? 0;
    assert('G4_boolean_difference_cuts_and_consumes', cut.data?.ok === true
      && cutVolume < plainVolume * 0.8 && cutVolume > 0
      && !('cutter' in cutVolumes) && (cut.report.geometry?.consumed || []).some((item) => item.target === 'cutter')
      && (cut.report.geometry?.dropped || []).includes('cutter'),
      JSON.stringify({ cutVolume, volumes: Object.keys(cutVolumes), geometry: cut.report.geometry }).slice(0, 300));

    // G5 并：体积≈两者之和（刀体同样不再单列）
    const joined = await buildExport(projectId, sceneOf([
      box('cutter', { width: 60, height: 60, depth: 60 }, [30, 0, 0]),
      box('base', BASE, [0, 0, 0], { modifiers: [{ kind: 'boolean', operation: 'union', target: 'cutter' }] }),
    ]), 'model3d/join.scene3d.json');
    const joinVolume = joined.report.mesh?.volumesMm3?.base ?? 0;
    assert('G5_boolean_union_adds_material', joined.data?.ok === true && joinVolume > plainVolume * 1.05
      && !('cutter' in (joined.report.mesh?.volumesMm3 || {})),
      JSON.stringify({ joinVolume, keys: Object.keys(joined.report.mesh?.volumesMm3 || {}) }).slice(0, 220));

    // G6 阵列：体积按 count 倍增长，包围盒随之变宽
    const arrayed = await buildExport(projectId, sceneOf([
      box('base', BASE, [0, 0, 0], { modifiers: [{ kind: 'array', count: 3, offset: [140, 0, 0] }] }),
    ]), 'model3d/array.scene3d.json');
    const arrayVolume = arrayed.report.mesh?.volumesMm3?.base ?? 0;
    const arrayX = arrayed.report.boundsMm?.size?.[0] ?? 0;
    assert('G6_array_multiplies_volume_and_bounds', arrayed.data?.ok === true
      && Math.abs(arrayVolume - plainVolume * 3) / (plainVolume * 3) < 0.02
      && Math.abs(arrayX - (120 + 2 * 140)) < 1,
      JSON.stringify({ arrayVolume, expectVolume: plainVolume * 3, arrayX, expectX: 400 }).slice(0, 220));

    // G7 导出产物真含加工后几何（不是只有报告数字）
    const glb = (arrayed.data?.outputs || []).find((item) => String(item.path).toLowerCase().endsWith('.glb'));
    assert('G7_export_carries_geometry', Boolean(glb) && glb.bytes > 500 && /^[a-f0-9]{64}$/i.test(String(glb.sha256 || '')),
      JSON.stringify(glb ?? {}).slice(0, 200));

    // UI 线：预览端显式声明不参与几何加工（不假装一致）
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

    const sceneFile = path.join(os.tmpdir(), `block322-p3-modifiers-${Date.now()}.scene3d.json`);
    fs.writeFileSync(sceneFile, JSON.stringify(sceneOf([
      box('cutter', { width: 60, height: 60, depth: 60 }, [30, 0, 0]),
      box('base', BASE, [0, 0, 0], { modifiers: [
        { kind: 'boolean', operation: 'difference', target: 'cutter' },
        { kind: 'bevel', width: 6, segments: 3 },
      ] }),
    ]), null, 2), 'utf8');
    tempFiles.push(sceneFile);
    await setFileOnInput(client, '[data-testid="model3d-file-input"]', sceneFile);
    const panel = await poll(async () => {
      const text = String(await evalJs(client, `(function(){
        var p = document.querySelector('[data-testid="model3d-surface"]');
        return p ? (p.textContent || '').replace(/\\s+/g, '') : '';
      })()`).catch(() => ''));
      return text.includes('预览显示未加工基元') ? text : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'modifier_notice' });
    assert('U1_preview_declares_non_participation', panel.includes('预览显示未加工基元')
      && panel.includes('boolean/bevel') && !panel.includes('mesh_reference_load_failed'), panel.slice(0, 300));
    assert('U2_scene_still_renders_with_modifiers', JSON.parse(await evalJs(client, `(function(){
      var p = document.querySelector('[data-testid="model3d-surface"]');
      var c = p ? p.querySelector('[data-testid="model3d-canvas"]') : null;
      var t = (p && p.textContent || '').replace(/\\s+/g, '');
      var m = t.match(/渲染对象(\\d+)/);
      return JSON.stringify({ canvas: !!c, objects: m ? Number(m[1]) : 0 });
    })()`)).canvas === true);

    detail.volumes = {
      plain: plainVolume,
      bevel: bevelVolume,
      cut: cutVolume,
      join: joinVolume,
      array: arrayVolume,
      arrayBoundsX: arrayX,
    };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block322-p3-geometry-detail.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      capability: capability.data,
      expectedBaseVolumeMm3: BASE_VOLUME,
      geometryReports: {
        bevel: beveled.report.geometry,
        difference: cut.report.geometry,
        union: joined.report.geometry,
        array: arrayed.report.geometry,
      },
      watertight: { bevel: beveled.report.mesh?.watertight, cut: cut.report.mesh?.watertight },
      ...detail,
    }, null, 2)}\n`, 'utf8');
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    for (const file of tempFiles) { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'block322-p3-geometry-live',
  description: 'BLOCK-322 P3-01：bevel/boolean/array 在 Blender 侧的数值回归 + 刀体消费 + 预览如实声明不加工',
  evidenceDir: EVIDENCE_DIR,
  run,
};
