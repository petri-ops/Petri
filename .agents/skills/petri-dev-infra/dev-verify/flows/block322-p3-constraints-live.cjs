#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 P3-02a 实机腿：装配约束求值真的到达唯一执行器，且数值可解析核对。
 *
 * 存量缺陷是「align 从未被任何执行面求值」——写了约束但几何不动。本腿的验收重心：
 * ①只读求值端点给出与手工推算逐值相同的 transform；②过约束在端点上显式 400
 * constraint_conflict（不静默取后值）；③同一场景经真实 Blender 构建后，**包围盒尺寸**
 * 按求值结果改变（包围盒由网格实测得出，不是 SceneSpec 里的自述数字）；④预览端不自行
 * 求解（第二求解器=红线 2），但如实声明差异并把三类约束都显示出来。
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

function box(id, width, height, depth, position = [0, 0, 0], rotation = [0, 0, 0]) {
  return {
    id,
    type: 'box',
    dimensions: { width, height, depth },
    transform: { position, rotation },
    material: { color: '#6a8caf', roughness: 0.4 },
  };
}

function sceneOf(nodes, constraints) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes,
    constraints,
    metadata: { title: 'BLOCK-322 P3-02a live' },
  };
}

const near = (actual, expected, tolerance = 1) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const sizeOf = (report) => (report?.boundsMm?.size || []).map((value) => Math.round(value));

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
    assert('C0_blender_ready', capability.status === 200 && capability.data?.status === 'ready',
      JSON.stringify(capability.data ?? {}).slice(0, 140));

    const project = await rest('POST', '/data/projects', { name: `BLOCK322-P302-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    assert('C1_temp_project', project.status === 200 && Boolean(projectId), JSON.stringify({ projectId }).slice(0, 120));

    // —— 只读求值端点（纯函数：请求体不含 projectId，能通即证明无项目前置）——
    const aligned = await rest('POST', '/model3d/scene/resolve', {
      scene: sceneOf([box('base', 120, 40, 80, [0, 0, 0]), box('port', 60, 40, 40, [100, 0, 0])], [
        { kind: 'align', a: 'base', b: 'port', axis: 'x' },
      ]),
    });
    const portPosition = aligned.data?.scene?.nodes?.find((node) => node.id === 'port')?.transform?.position || [];
    assert('C2_resolve_endpoint_moves_target', aligned.status === 200 && aligned.data?.ok === true
      && near(portPosition[0], 0) && near(portPosition[1], 0) && near(portPosition[2], 0)
      && aligned.data?.appliedConstraints?.[0]?.to === 0
      && aligned.data?.appliedConstraints?.[0]?.from === 100
      && /^[a-f0-9]{64}$/i.test(String(aligned.data?.sceneHash || '')),
      JSON.stringify({ status: aligned.status, portPosition, ledger: aligned.data?.appliedConstraints }).slice(0, 300));

    const mixed = await rest('POST', '/model3d/scene/resolve', {
      scene: sceneOf([
        box('base', 120, 40, 80, [0, 0, 0], [0, 0, 10]),
        box('port', 60, 40, 40, [100, 5, 5]),
        box('cap', 20, 20, 20, [-70, -70, -70]),
      ], [
        { kind: 'distance', a: 'base', b: 'port', axis: 'x', value: 60 },
        { kind: 'distance', a: 'port', b: 'cap', axis: 'x', value: -60 },
        { kind: 'angle', a: 'base', b: 'port', axis: 'z', value: 90 },
      ]),
    });
    const moved = (id, field) => (mixed.data?.scene?.nodes?.find((node) => node.id === id)?.transform?.[field] || []);
    assert('C3_distance_and_angle_values', mixed.status === 200 && mixed.data?.ok === true
      && near(moved('port', 'position')[0], 60)
      && near(moved('cap', 'position')[0], 0)
      && near(moved('port', 'rotation')[2], 100),
      JSON.stringify({ port: moved('port', 'position'), cap: moved('cap', 'position'), portRot: moved('port', 'rotation') }).slice(0, 240));
    assert('C4_chain_uses_evaluated_anchor', (mixed.data?.appliedConstraints || []).length === 3
      && mixed.data.appliedConstraints[1].to === 0 && mixed.data.appliedConstraints[1].index === 1,
      JSON.stringify(mixed.data?.appliedConstraints).slice(0, 300) + '（cap 参照的是 port 求值后的 x=60，故 60-60=0）');

    const conflict = await rest('POST', '/model3d/scene/resolve', {
      scene: sceneOf([box('base', 120, 40, 80), box('port', 60, 40, 40, [100, 0, 0])], [
        { kind: 'distance', a: 'base', b: 'port', axis: 'x', value: 60 },
        { kind: 'align', a: 'base', b: 'port', axis: 'x' },
      ]),
    });
    assert('C5_over_constrained_fails_closed', conflict.status === 400 && conflict.data?.error === 'constraint_conflict'
      && String(conflict.data?.errors?.[0] || '').includes('constraint_conflict'),
      JSON.stringify(conflict.data ?? {}).slice(0, 300));

    const badKind = await rest('POST', '/model3d/scene/resolve', {
      scene: sceneOf([box('base', 120, 40, 80), box('port', 60, 40, 40)], [
        { kind: 'mate', a: 'base', b: 'port', axis: 'x' },
      ]),
    });
    assert('C6_unsupported_kind_rejected', badKind.status === 400 && badKind.data?.error === 'scene_invalid'
      && String((badKind.data?.errors || []).join('；')).includes('kind 只支持 align/distance/angle'),
      JSON.stringify(badKind.data ?? {}).slice(0, 300));

    const outOfRange = await rest('POST', '/model3d/scene/resolve', {
      scene: sceneOf([box('base', 120, 40, 80, [999999, 0, 0]), box('port', 60, 40, 40)], [
        { kind: 'distance', a: 'base', b: 'port', axis: 'x', value: 999999 },
      ]),
    });
    assert('C6b_out_of_range_rejected', outOfRange.status === 400 && outOfRange.data?.error === 'constraint_out_of_range',
      JSON.stringify(outOfRange.data ?? {}).slice(0, 240));

    // —— 真实 Blender 构建：包围盒由网格实测，能反证约束真的改了被喂给执行器的 transform ——
    const plainPair = sceneOf([box('base', 120, 40, 80), box('port', 60, 40, 40, [100, 0, 0])], []);
    const plainBuild = await buildExport(projectId, plainPair, 'model3d/c-plain.scene3d.json');
    const alignBuild = await buildExport(projectId,
      sceneOf([box('base', 120, 40, 80), box('port', 60, 40, 40, [100, 0, 0])], [{ kind: 'align', a: 'base', b: 'port', axis: 'x' }]),
      'model3d/c-align.scene3d.json');
    const spacedBuild = await buildExport(projectId,
      sceneOf([box('base', 120, 40, 80), box('port', 60, 40, 40, [100, 0, 0])], [{ kind: 'distance', a: 'base', b: 'port', axis: 'x', value: 60 }]),
      'model3d/c-distance.scene3d.json');
    assert('C7_align_changes_built_bounds', alignBuild.data?.ok === true
      && near(sizeOf(plainBuild.report)[0], 190) && near(sizeOf(alignBuild.report)[0], 120),
      JSON.stringify({ plain: sizeOf(plainBuild.report), aligned: sizeOf(alignBuild.report) }).slice(0, 200));
    assert('C8_distance_changes_built_bounds', spacedBuild.data?.ok === true
      && near(sizeOf(spacedBuild.report)[0], 150),
      JSON.stringify({ distance: sizeOf(spacedBuild.report), expect: [150, 80, 40] }).slice(0, 200));

    const plainTurn = sceneOf([box('base', 120, 40, 80), box('wing', 200, 40, 40)], []);
    const turnBuild = await buildExport(projectId, plainTurn, 'model3d/c-turn-plain.scene3d.json');
    const angledBuild = await buildExport(projectId,
      sceneOf([box('base', 120, 40, 80), box('wing', 200, 40, 40)], [{ kind: 'angle', a: 'base', b: 'wing', axis: 'z', value: 90 }]),
      'model3d/c-angle.scene3d.json');
    assert('C9_angle_changes_built_bounds', angledBuild.data?.ok === true
      && near(sizeOf(turnBuild.report)[0], 200) && near(sizeOf(turnBuild.report)[1], 80)
      && near(sizeOf(angledBuild.report)[0], 120) && near(sizeOf(angledBuild.report)[1], 200),
      JSON.stringify({ plain: sizeOf(turnBuild.report), angled: sizeOf(angledBuild.report), expect: [120, 200, 40] }).slice(0, 240));

    const conflictBuild = await buildExport(projectId,
      sceneOf([box('base', 120, 40, 80), box('port', 60, 40, 40, [100, 0, 0])], [
        { kind: 'distance', a: 'base', b: 'port', axis: 'x', value: 60 },
        { kind: 'align', a: 'base', b: 'port', axis: 'x' },
      ]), 'model3d/c-conflict.scene3d.json');
    assert('C10_export_refuses_over_constrained', conflictBuild.status === 400
      && conflictBuild.data?.error === 'constraint_conflict',
      JSON.stringify(conflictBuild.data ?? {}).slice(0, 240));

    const glb = (alignBuild.data?.outputs || []).find((item) => String(item.path).toLowerCase().endsWith('.glb'));
    assert('C11_export_artifact_intact', Boolean(glb) && glb.bytes > 500 && /^[a-f0-9]{64}$/i.test(String(glb.sha256 || '')),
      JSON.stringify(glb ?? {}).slice(0, 200));

    // —— 预览线：不求解但如实声明，三类约束都要看得见 ——
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

    const sceneFile = path.join(os.tmpdir(), `block322-p302-constraints-${Date.now()}.scene3d.json`);
    fs.writeFileSync(sceneFile, JSON.stringify(sceneOf([
      box('base', 120, 40, 80, [0, 0, 0], [0, 0, 10]),
      box('port', 60, 40, 40, [100, 0, 0]),
      box('cap', 20, 20, 20, [-70, 0, 0]),
    ], [
      { kind: 'align', a: 'base', b: 'port', axis: 'y' },
      { kind: 'distance', a: 'base', b: 'port', axis: 'x', value: 60 },
      { kind: 'angle', a: 'base', b: 'cap', axis: 'z', value: 45 },
    ])), 'utf8');
    tempFiles.push(sceneFile);
    await setFileOnInput(client, '[data-testid="model3d-file-input"]', sceneFile);
    const panel = await poll(async () => {
      const text = String(await evalJs(client, `(function(){
        var p = document.querySelector('[data-testid="model3d-surface"]');
        return p ? (p.textContent || '').replace(/\\s+/g, '') : '';
      })()`).catch(() => ''));
      return text.includes('按声明位置显示') ? text : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'constraint_notice' });
    assert('U1_preview_declares_non_evaluation', panel.includes('装配约束在服务端求值后烘进transform')
      && panel.includes('按声明位置显示') && !panel.includes('mesh_reference_load_failed'), panel.slice(0, 300));
    assert('U2_three_kinds_visible', panel.includes('对齐base→port') && panel.includes('间距base→port（x60mm')
      && panel.includes('转角base→cap（z45°') && panel.includes('约束3'), panel.slice(0, 420));
    // 硬规则（dev-verify/README）：面板计数来自异步 state，落在下一个 React commit——必须轮询到目标态，
    // 单次读取会稳定读到「正在加载3D渲染器…」占位（本腿首跑即因此判空）。
    const canvasObjects = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, `(function(){
        var p = document.querySelector('[data-testid="model3d-surface"]');
        var t = (p && p.textContent || '').replace(/\\s+/g, '');
        var m = t.match(/渲染对象(\\d+)/);
        return JSON.stringify({ canvas: !!(p && p.querySelector('[data-testid="model3d-canvas"]')), objects: m ? Number(m[1]) : 0 });
      })()`));
      return parsed.canvas === true && parsed.objects >= 3 ? parsed : null;
    }, { timeoutMs: 40_000, intervalMs: 500, label: 'preview_objects' });
    assert('U3_scene_still_renders', canvasObjects.canvas === true && canvasObjects.objects >= 3,
      JSON.stringify(canvasObjects).slice(0, 200));

    detail.resolve = {
      align: aligned.data?.appliedConstraints,
      mixed: mixed.data?.appliedConstraints,
      conflict: conflict.data,
    };
    detail.builtBounds = {
      plain: sizeOf(plainBuild.report),
      aligned: sizeOf(alignBuild.report),
      distance: sizeOf(spacedBuild.report),
      turnPlain: sizeOf(turnBuild.report),
      angled: sizeOf(angledBuild.report),
    };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block322-p3-constraints-detail.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      capability: capability.data,
      expectedBuiltBounds: { alignedX: 120, distanceX: 150, plainX: 190, angle: [120, 200, 40], turnPlain: [200, 80, 40] },
      reports: {
        align: alignBuild.report?.boundsMm,
        distance: spacedBuild.report?.boundsMm,
        angle: angledBuild.report?.boundsMm,
      },
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
  id: 'block322-p3-constraints-live',
  description: 'BLOCK-322 P3-02a：align/distance/angle 求值端点 + 过约束 fail-closed + Blender 包围盒数值回归 + 预览如实声明未求解',
  evidenceDir: EVIDENCE_DIR,
  run,
};
