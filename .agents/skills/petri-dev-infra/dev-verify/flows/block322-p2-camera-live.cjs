#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 P2-01 实机腿：声明相机与渲染分辨率（SceneSpec → Blender → 预览同机位）。
 *
 * REST 线：
 *   B0 capability → B1 临时项目
 *   → B2 无 camera 场景：仍只出 front/top/side/iso 四图 + 分辨率回显 800×600（向后兼容，不新增假机位图）
 *   → B3 透视声明机位：report.camera 回显 projection/sensorFit/declaredFovDeg/effectiveAngleYDeg，
 *      且生效垂直张角与声明一致（与 Three.js 的垂直 fov 同轴）；camera.png 真出图且与 front.png 不同图
 *   → B4 非法相机声明在 scene/apply 层 fail-closed
 *   → B5 正交声明：projection=ORTHO + orthoScaleMm 回显
 *   → B6 分辨率声明生效（report.render）
 * UI 线（9223 离屏）：
 *   U1 加载示例（无 camera）→ 视角组不出现「机位」按钮（不提供假选项）
 *   → U2 载入声明机位的 SceneSpec → 「机位」按钮出现 → 点击后 aria-pressed 且画面帧变化
 *
 * 运行前提：主 dev 栈 + 测试实例已启动。证据落 acceptance/block-322-p2/。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.BLOCK322_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-322-p2');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function rest(method, endpoint, body, { timeoutMs = 240_000 } = {}) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: { Authorization: 'Bearer desktop-local', ...(body ? { 'Content-Type': 'application/json' } : {}) },
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

function boxScene(extra = {}) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [{
      id: 'base',
      type: 'box',
      dimensions: { width: 120, depth: 80, height: 40 },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      material: { color: '#6a8caf', roughness: 0.4 },
    }],
    constraints: [],
    metadata: { title: 'BLOCK-322 P2-01 live' },
    ...extra,
  };
}

const panelSnapshot = `(function(){
  var panel = document.querySelector('[data-testid="model3d-surface"]');
  if (!panel) return JSON.stringify({ present: false });
  var canvas = panel.querySelector('[data-testid="model3d-canvas"]');
  var frame = '';
  if (canvas) { try { frame = canvas.toDataURL('image/png'); } catch (e) { frame = ''; } }
  var views = Array.prototype.slice.call(panel.querySelectorAll('[aria-label="3D 视角"] button'));
  return JSON.stringify({
    present: true,
    hasCanvas: !!canvas,
    frameLength: frame.length,
    frameHash: frame ? frame.slice(-64) : '',
    viewLabels: views.map(function (b) { return (b.textContent || '').trim(); }),
    pressedLabels: views.filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; }).map(function (b) { return (b.textContent || '').trim(); }),
    alert: (function(){ var a = panel.querySelector('[role="alert"]'); return a ? (a.textContent || '') : ''; })(),
  });
})()`;

async function run(ctx) {
  const { assert } = ctx;
  const detail = {};
  let projectId = null;
  let workspacePath = null;
  let client = null;
  const tempFiles = [];
  try {
    const capability = await rest('GET', '/model3d/capability');
    assert('B0_blender_ready', capability.status === 200 && capability.data?.status === 'ready',
      JSON.stringify(capability.data).slice(0, 160));
    detail.capability = capability.data;

    const project = await rest('POST', '/data/projects', { name: `BLOCK322-P2-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    workspacePath = project.data?.project?.workspace_path || null;
    assert('B1_temp_project', project.status === 200 && Boolean(projectId) && Boolean(workspacePath),
      JSON.stringify({ projectId }).slice(0, 160));

    // B2 无 camera：向后兼容（只出四图，默认分辨率，不伪造机位图）
    const plain = await rest('POST', '/model3d/scene/export', {
      projectId, scene: boxScene(), scenePath: 'model3d/plain.scene3d.json', formats: ['glb'],
    });
    const plainReport = plain.data?.report || {};
    const plainRenders = Object.keys(plainReport.renders || {}).sort();
    assert('B2a_no_camera_no_fake_shot', plain.status === 200 && plain.data?.ok === true
      && plainReport.camera?.declared === false && plainReport.camera?.applied === false,
      JSON.stringify(plainReport.camera).slice(0, 200));
    assert('B2b_four_standard_views_only', JSON.stringify(plainRenders) === JSON.stringify(['front', 'iso', 'side', 'top']),
      JSON.stringify(plainRenders));
    assert('B2c_default_resolution_echo', plainReport.render?.width === 800 && plainReport.render?.height === 600,
      JSON.stringify(plainReport.render).slice(0, 160));

    // B3 透视声明机位
    const declared = { position: [420, -380, 300], target: [0, 0, 20], fovDeg: 35, up: [0, 0, 1] };
    const shot = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: boxScene({ camera: declared, render: { width: 1200, height: 800 } }),
      scenePath: 'model3d/camera.scene3d.json',
      formats: ['glb'],
    });
    const shotReport = shot.data?.report || {};
    const cameraReport = shotReport.camera || {};
    assert('B3a_declared_camera_applied', shot.status === 200 && shot.data?.ok === true
      && cameraReport.declared === true && cameraReport.applied === true
      && cameraReport.projection === 'PERSP' && cameraReport.sensorFit === 'VERTICAL'
      && cameraReport.upApplied === true,
      JSON.stringify(cameraReport).slice(0, 300));
    assert('B3b_fov_vertical_parity', typeof cameraReport.effectiveAngleYDeg === 'number'
      && Math.abs(cameraReport.effectiveAngleYDeg - 35) < 0.01,
      `declared=35 effective=${cameraReport.effectiveAngleYDeg}`);
    assert('B3c_resolution_declaration_effective', shotReport.render?.width === 1200 && shotReport.render?.height === 800
      && shotReport.render?.declared === true, JSON.stringify(shotReport.render ?? {}).slice(0, 160));
    const shotRenders = Object.keys(shotReport.renders || {}).sort();
    assert('B3d_camera_render_produced', shotRenders.includes('camera'), JSON.stringify(shotRenders));

    const cameraPng = shotReport.renders?.camera;
    const frontPng = shotReport.renders?.front;
    const cameraBytes = cameraPng && fs.existsSync(cameraPng) ? fs.readFileSync(cameraPng) : null;
    const frontBytes = frontPng && fs.existsSync(frontPng) ? fs.readFileSync(frontPng) : null;
    assert('B3e_camera_png_is_real_and_distinct', Boolean(cameraBytes) && cameraBytes.length > 1000
      && Boolean(frontBytes) && sha256(cameraBytes) !== sha256(frontBytes),
      JSON.stringify({ cameraBytes: cameraBytes?.length || 0, frontBytes: frontBytes?.length || 0 }));
    detail.cameraShot = {
      declared,
      report: cameraReport,
      render: shotReport.render,
      renders: shotRenders,
      cameraPngBytes: cameraBytes?.length || 0,
      cameraPngSha: cameraBytes ? sha256(cameraBytes).slice(0, 16) : null,
      frontPngSha: frontBytes ? sha256(frontBytes).slice(0, 16) : null,
    };

    // B4 非法声明 fail-closed
    const badApply = await rest('POST', '/model3d/scene/apply', {
      projectId,
      path: 'model3d/bad.scene3d.json',
      scene: boxScene(),
      operations: [{ op: 'set_metadata', metadata: { note: 'camera 走场景声明而非 ops' } }],
      reason: 'p2_seed',
    });
    assert('B4a_metadata_seed_ok', badApply.status === 200 && badApply.data?.ok === true, JSON.stringify(badApply.data).slice(0, 160));
    const badRead = await rest('POST', '/model3d/scene/read', { projectId, path: 'model3d/bad.scene3d.json' });
    const degenerate = boxScene({ camera: { position: [10, 10, 10], target: [10, 10, 10] } });
    const badExport = await rest('POST', '/model3d/scene/export', { projectId, scene: degenerate, formats: ['glb'] });
    assert('B4b_degenerate_camera_rejected', badExport.status === 400
      && (badExport.data?.errors || []).some((error) => String(error).includes('视线退化')),
      JSON.stringify(badExport.data).slice(0, 220));
    assert('B4c_scene_read_still_valid', badRead.status === 200 && badRead.data?.ok === true,
      JSON.stringify(badRead.data ?? {}).slice(0, 160));
    const collinear = boxScene({ camera: { position: [0, 0, 0], target: [0, 0, 100], up: [0, 0, 1] } });
    const collinearExport = await rest('POST', '/model3d/scene/export', { projectId, scene: collinear, formats: ['glb'] });
    assert('B4d_collinear_up_rejected', collinearExport.status === 400
      && (collinearExport.data?.errors || []).some((error) => String(error).includes('与视线共线')),
      JSON.stringify(collinearExport.data ?? {}).slice(0, 220));

    // B5 正交声明
    const ortho = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: boxScene({ camera: { position: [0, -600, 300], target: [0, 0, 0], projection: 'orthographic', orthoScaleMm: 320 } }),
      scenePath: 'model3d/ortho.scene3d.json',
      formats: ['glb'],
    });
    const orthoReport = ortho.data?.report || {};
    assert('B5_orthographic_applied', ortho.status === 200 && ortho.data?.ok === true
      && orthoReport.camera?.projection === 'ORTHO' && Math.abs((orthoReport.camera?.orthoScaleMm || 0) - 320) < 0.01,
      JSON.stringify(orthoReport.camera ?? {}).slice(0, 220));

    // UI 线：机位按钮只在声明后出现，且点击真的换机位
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
    }, { timeoutMs: 30_000, label: 'project_route' });
    await evalJs(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        var text = (btns[i].textContent || '').trim();
        if (text === '开始使用' || text === '知道了' || text === '3D 模型') btns[i].click();
      }
      return 'ok';
    })()`).catch(() => null);
    await poll(async () => (await evalJs(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false)) === true
      ? true : null, { timeoutMs: 30_000, label: 'model3d_surface' });

    await evalJs(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '加载示例') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    const baseline = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return parsed.hasCanvas && parsed.frameLength > 1000 ? parsed : null;
    }, { timeoutMs: 30_000, intervalMs: 600, label: 'sample_canvas_frame' });
    assert('U1_no_camera_no_shot_button', baseline.viewLabels.indexOf('机位') === -1
      && JSON.stringify(baseline.viewLabels) === JSON.stringify(['等轴', '前', '顶', '侧']),
      JSON.stringify(baseline.viewLabels));

    const sceneFile = path.join(os.tmpdir(), `block322-p2-camera-${Date.now()}.scene3d.json`);
    fs.writeFileSync(sceneFile, JSON.stringify(boxScene({ camera: declared }), null, 2), 'utf8');
    tempFiles.push(sceneFile);
    await setFileOnInput(client, '[data-testid="model3d-file-input"]', sceneFile);
    const withShot = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return parsed.viewLabels.indexOf('机位') >= 0 ? parsed : null;
    }, { timeoutMs: 30_000, intervalMs: 600, label: 'shot_button_appears' });
    assert('U2a_shot_button_appears_on_declaration', withShot.alert === ''
      && JSON.stringify(withShot.viewLabels) === JSON.stringify(['等轴', '前', '顶', '侧', '机位']),
      JSON.stringify({ labels: withShot.viewLabels, alert: withShot.alert }).slice(0, 220));

    await evalJs(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('[aria-label="3D 视角"] button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '机位') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    const moved = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return parsed.pressedLabels.indexOf('机位') >= 0 && parsed.frameHash !== withShot.frameHash ? parsed : null;
    }, { timeoutMs: 20_000, intervalMs: 500, label: 'declared_shot_frames' });
    assert('U2b_declared_shot_adopted_and_framing_changes', moved.pressedLabels.indexOf('机位') >= 0
      && moved.frameLength > 1000 && moved.frameHash !== withShot.frameHash,
      JSON.stringify({ pressed: moved.pressedLabels, before: withShot.frameHash.slice(0, 12), after: moved.frameHash.slice(0, 12) }));
    detail.ui = {
      baselineLabels: baseline.viewLabels,
      declaredLabels: withShot.viewLabels,
      pressedAfterClick: moved.pressedLabels,
      frameLengthBefore: withShot.frameLength,
      frameLengthAfter: moved.frameLength,
    };

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block322-p2-camera-detail.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      api: API,
      projectId,
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
  id: 'block322-p2-camera-live',
  description: 'BLOCK-322 P2-01：声明相机/分辨率在 Blender 与预览两侧一致生效（含向后兼容与非法声明拒绝）',
  evidenceDir: EVIDENCE_DIR,
  run,
};
