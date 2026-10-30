#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 P1 实机腿：外部 mesh 资产一等公民（a 进链已交付 / b 预览渲染 / c UI 导入）。
 *
 * REST 线（:3001，与 agent 工具同一生产路径）：
 *   A0 Blender capability → A1 临时项目 → A2 真实 Blender 导出一个 GLB（作为外部资产来源）
 *   → A3 asset/inspect 服务端算 sha256（与独立重算逐字节对账）
 *   → A4 红面：非法扩展名/缺失/路径逃逸/敏感段 四类拒绝
 *   → A5 scene/apply add_node 写入 mesh-reference（修订留痕）
 *   → A6 篡改 sha 的构建必须失败（mesh_source_hash_mismatch 端到端复验）
 *   → A7 合法 mesh-reference 参与 Blender 构建（对象数含外部资产）
 *   → A8 SceneSpec 校验层提前拒绝非法格式（不再拖到构建才炸）
 * UI 线（测试实例 9223，离屏）：
 *   U1 打开 3D 工作台 → U2 加载示例（基本体基线）
 *   → U3 真实文件句柄走「导入为场景节点」（上传→预检→add_node→重载）→ 预览出现外部 mesh
 *   → U4 磁盘资产被删后重载同一 SceneSpec → 显式报 mesh_reference_load_failed（红线4：不伪造预览）
 *
 * 运行前提：主 dev 栈在跑 + 测试实例已启动（bash scripts/start-test-instance.sh）。
 * 证据由 runner 落 acceptance/block-322-p1/。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.BLOCK322_API || 'http://127.0.0.1:3001';
const SCENE_PATH = 'model3d/scene.scene3d.json';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function rest(method, endpoint, body, { timeoutMs = 240_000 } = {}) {
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

/** 把真实文件塞给隐藏 input（渲染层 File 句柄路径，等价用户点击选择）。 */
async function setFileOnInput(client, selector, absolutePath) {
  await client.send('DOM.enable');
  const document = await client.send('DOM.getDocument', { depth: -1 });
  const found = await client.send('DOM.querySelector', { nodeId: document.root.nodeId, selector });
  if (!found || !found.nodeId) throw new Error(`input_not_found: ${selector}`);
  await client.send('DOM.setFileInputFiles', { nodeId: found.nodeId, files: [absolutePath] });
}

function baseScene(nodes, parameters = {}) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters,
    nodes,
    constraints: [],
    metadata: { title: 'BLOCK-322 P1 live' },
  };
}

function boxNode(id, height = 40) {
  return {
    id,
    type: 'box',
    dimensions: { width: 120, depth: 80, height },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    material: { color: '#6a8caf', roughness: 0.4 },
  };
}

function meshNode(id, assetPath, sha) {
  return {
    id,
    type: 'mesh-reference',
    transform: { position: [60, 0, 0], rotation: [0, 0, 0] },
    source: { path: assetPath, sourceSha256: sha },
    label: id,
  };
}

const panelSnapshot = `(function(){
  var panel = document.querySelector('[data-testid="model3d-surface"]');
  if (!panel) return JSON.stringify({ present: false });
  var canvas = panel.querySelector('[data-testid="model3d-canvas"]');
  var pixels = 0;
  if (canvas) {
    try { pixels = (canvas.toDataURL('image/png') || '').length; } catch (e) { pixels = -1; }
  }
  var alert = panel.querySelector('[role="alert"]');
  return JSON.stringify({
    present: true,
    hasCanvas: !!canvas,
    text: (panel.textContent || '').replace(/\\s+/g, ''),
    alert: alert ? (alert.textContent || '') : '',
    pixels: pixels,
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
    // ── A0 Blender capability ──────────────────────────────────────────
    const capability = await rest('GET', '/model3d/capability');
    assert('A0_blender_ready', capability.status === 200 && capability.data?.status === 'ready'
      && Boolean(capability.data?.version), JSON.stringify(capability.data).slice(0, 200));
    detail.capability = capability.data;

    // ── A1 临时项目 ────────────────────────────────────────────────────
    const project = await rest('POST', '/data/projects', { name: `BLOCK322-P1-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    workspacePath = project.data?.project?.workspace_path || null;
    assert('A1_temp_project', project.status === 200 && Boolean(projectId) && Boolean(workspacePath)
      && fs.existsSync(workspacePath), JSON.stringify({ projectId, workspacePath }).slice(0, 220));

    // ── A2 真实 Blender 产出一个 GLB 作为外部资产来源 ───────────────────
    const seed = await rest('POST', '/model3d/scene/apply', {
      projectId,
      path: 'model3d/source.scene3d.json',
      scene: baseScene([boxNode('donor', 30)]),
      operations: [{ op: 'set_metadata', metadata: { seededBy: 'block322-p1-live' } }],
      reason: 'block322_p1_seed',
    });
    assert('A2a_source_scene', seed.status === 200 && seed.data?.ok === true, JSON.stringify(seed.data).slice(0, 200));
    const donorExport = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: seed.data.scene,
      scenePath: 'model3d/source.scene3d.json',
      formats: ['glb'],
      recipeId: 'block322-p1-donor',
      recipeVersion: 1,
    });
    const donorOutputs = Array.isArray(donorExport.data?.outputs) ? donorExport.data.outputs : [];
    const donorGlb = donorOutputs.find((item) => String(item.path).toLowerCase().endsWith('.glb')) || null;
    assert('A2b_donor_glb_exported', donorExport.status === 200 && donorExport.data?.ok === true && Boolean(donorGlb)
      && /^[a-f0-9]{64}$/i.test(String(donorGlb.sha256 || '')), JSON.stringify(donorExport.data).slice(0, 300));
    const donorAbs = path.join(workspacePath, ...String(donorGlb.path).split('/'));
    assert('A2c_donor_glb_on_disk', fs.existsSync(donorAbs) && fs.statSync(donorAbs).isFile(), donorAbs.slice(-80));
    detail.donorAsset = { path: donorGlb.path, sha256: donorGlb.sha256, bytes: donorGlb.bytes };

    // ── A3 预检：服务端算的 sha 必须等于磁盘独立重算值 ──────────────────
    const inspected = await rest('POST', '/model3d/asset/inspect', { projectId, path: donorGlb.path });
    const diskSha = sha256(fs.readFileSync(donorAbs));
    assert('A3_inspect_matches_disk', inspected.status === 200 && inspected.data?.ok === true
      && inspected.data.format === 'glb'
      && inspected.data.sourceSha256 === diskSha
      && Number(inspected.data.bytes) === fs.statSync(donorAbs).size, JSON.stringify(inspected.data).slice(0, 260));
    assert('A3b_relative_path_only', inspected.data?.path === donorGlb.path
      && !String(inspected.data?.path || '').startsWith(workspacePath), String(inspected.data?.path).slice(0, 120));

    // ── A4 红面：四类拒绝 ──────────────────────────────────────────────
    fs.writeFileSync(path.join(workspacePath, 'notes.txt'), 'not a mesh');
    const badFormat = await rest('POST', '/model3d/asset/inspect', { projectId, path: 'notes.txt' });
    assert('A4a_unsupported_format_400', badFormat.status === 400 && badFormat.data?.error === 'mesh_format_unsupported',
      JSON.stringify(badFormat.data).slice(0, 200));
    const missing = await rest('POST', '/model3d/asset/inspect', { projectId, path: 'model3d/assets/gone.glb' });
    assert('A4b_missing_404', missing.status === 404 && missing.data?.error === 'mesh_not_found',
      JSON.stringify(missing.data).slice(0, 200));
    const escaped = await rest('POST', '/model3d/asset/inspect', { projectId, path: '../outside.glb' });
    assert('A4c_escape_rejected', escaped.status === 403 && escaped.data?.error === 'path_escape',
      JSON.stringify(escaped.data).slice(0, 200));
    const sensitive = await rest('POST', '/model3d/asset/inspect', { projectId, path: '.git/hidden.glb' });
    assert('A4d_sensitive_rejected', sensitive.status === 403 && sensitive.data?.error === 'sensitive_path',
      JSON.stringify(sensitive.data).slice(0, 200));

    // ── A5 写入 mesh-reference（add_node 白名单 + 修订留痕）─────────────
    const applied = await rest('POST', '/model3d/scene/apply', {
      projectId,
      path: 'model3d/main.scene3d.json',
      scene: baseScene([boxNode('base', 40)]),
      operations: [{ op: 'add_node', node: meshNode('asset-donor', inspected.data.path, inspected.data.sourceSha256) }],
      reason: 'block322_p1_add_asset',
    });
    assert('A5a_add_node_written', applied.status === 200 && applied.data?.ok === true
      && applied.data.scene.nodes.some((node) => node.id === 'asset-donor' && node.type === 'mesh-reference')
      && applied.data.beforeHash !== applied.data.afterHash
      && applied.data.revision === null, JSON.stringify(applied.data.diff).slice(0, 240));
    // 首次写入无历史可快照 → revision 为空；第二次编辑时，快照的是「含资产节点的那一版」，
    // revision.reason 记的是触发快照的当前编辑（NEXT-05 既有语义）。
    const secondApply = await rest('POST', '/model3d/scene/apply', {
      projectId,
      path: 'model3d/main.scene3d.json',
      operations: [{ op: 'set_metadata', metadata: { touched: 'twice' } }],
      reason: 'block322_p1_touch',
    });
    assert('A5b_revision_snapshots_asset_version', secondApply.status === 200 && secondApply.data?.ok === true
      && /^rev-\d{6}$/.test(String(secondApply.data.revision?.revisionId || ''))
      && secondApply.data.revision.hash === applied.data.afterHash
      && secondApply.data.revision.reason === 'block322_p1_touch',
    JSON.stringify(secondApply.data.revision).slice(0, 200));
    const revisions = await rest('GET', `/model3d/scene/revisions?projectId=${encodeURIComponent(projectId)}&path=model3d%2Fmain.scene3d.json`);
    assert('A5c_revision_history_lists_asset_version', revisions.status === 200
      && (revisions.data?.revisions || []).some((item) => item.hash === applied.data.afterHash),
      JSON.stringify(revisions.data).slice(0, 220));
    const readBack = await rest('POST', '/model3d/scene/read', { projectId, path: 'model3d/main.scene3d.json' });
    assert('A5d_readback_sha_stable', readBack.data?.scene?.nodes?.some((node) => node.id === 'asset-donor'
      && node.source?.sourceSha256 === diskSha), JSON.stringify(readBack.data?.scene?.nodes).slice(0, 260));

    // ── A6 篡改 sha：Blender 构建必须失败（端到端复验，不是前端自报）────
    const tampered = baseScene([boxNode('base', 40), meshNode('asset-tampered', inspected.data.path, sha256(Buffer.from('tampered')))]);
    const tamperExport = await rest('POST', '/model3d/scene/export', { projectId, scene: tampered, formats: ['glb'] });
    const tamperText = JSON.stringify(tamperExport.data?.report || tamperExport.data);
    assert('A6_tampered_hash_build_fails', tamperExport.status === 400 && tamperExport.data?.ok === false
      && tamperText.includes('mesh_source_hash_mismatch'), tamperText.slice(0, 260));

    // ── A7 合法 mesh-reference 参与构建（外部资产真进场景）───────────────
    const onlyBase = await rest('POST', '/model3d/scene/export', {
      projectId, scene: baseScene([boxNode('base', 40)]), formats: ['glb'],
    });
    const withAsset = await rest('POST', '/model3d/scene/export', {
      projectId, scene: readBack.data.scene, scenePath: 'model3d/main.scene3d.json', formats: ['glb'],
    });
    const baseObjects = onlyBase.data?.report?.mesh?.objects ?? null;
    const assetObjects = withAsset.data?.report?.mesh?.objects ?? null;
    assert('A7a_valid_build_ok', withAsset.status === 200 && withAsset.data?.ok === true
      && withAsset.data?.report?.ok === true, JSON.stringify(withAsset.data?.report).slice(0, 240));
    assert('A7b_asset_increases_objects', typeof baseObjects === 'number' && typeof assetObjects === 'number'
      && assetObjects > baseObjects, `base=${baseObjects} withAsset=${assetObjects}`);
    const assetVolumes = withAsset.data?.report?.mesh?.volumesMm3 || {};
    assert('A7c_volumes_report_asset', Object.keys(assetVolumes).length >= 2
      && Object.keys(assetVolumes).some((key) => key.startsWith('asset-donor')),
      JSON.stringify(assetVolumes).slice(0, 200));
    detail.buildComparison = {
      provider: withAsset.data?.providerVersion,
      baseObjects,
      assetObjects,
      baseVolumeMm3: onlyBase.data?.report?.mesh?.volumesMm3,
      assetVolumeMm3: withAsset.data?.report?.mesh?.volumesMm3,
      outputs: (withAsset.data?.outputs || []).map((item) => ({ path: item.path, bytes: item.bytes })),
    };

    // ── A8 SceneSpec 校验层提前拒绝非法格式 ────────────────────────────
    const badSpec = await rest('POST', '/model3d/scene/apply', {
      projectId,
      path: 'model3d/bad.scene3d.json',
      scene: baseScene([boxNode('base', 40)]),
      operations: [{ op: 'add_node', node: meshNode('asset-bad', 'notes.txt', diskSha) }],
      reason: 'block322_p1_negative',
    });
    assert('A8_spec_layer_rejects', badSpec.status === 400 && badSpec.data?.error === 'mesh_format_unsupported',
      JSON.stringify(badSpec.data).slice(0, 220));

    // ── UI 线：真实文件句柄走「导入为场景节点」+ 预览渲染 ───────────────
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

    const clickedSample = await evalJs(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '加载示例') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('U1_sample_baseline_loaded', clickedSample === 'clicked', String(clickedSample));
    const baseline = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return parsed.hasCanvas && /渲染对象\d+/.test(parsed.text) ? parsed : null;
    }, { timeoutMs: 30_000, intervalMs: 600, label: 'baseline_canvas_objects' });
    const baselineObjects = Number((baseline.text.match(/渲染对象(\d+)/) || [])[1] || 0);
    assert('U2_baseline_objects_and_pixels', baselineObjects >= 2 && baseline.pixels > 1000 && baseline.alert === '',
      JSON.stringify({ baselineObjects, pixels: baseline.pixels, alert: baseline.alert }).slice(0, 240));

    await setFileOnInput(client, '[data-testid="model3d-asset-input"]', donorAbs);
    const imported = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return /已作为节点asset-/.test(parsed.text) && /已导入model3d\/assets\//.test(parsed.text) ? parsed : null;
    }, { timeoutMs: 40_000, intervalMs: 700, label: 'asset_import_notice' });
    const importedObjects = Number((imported.text.match(/渲染对象(\d+)/) || [])[1] || 0);
    assert('U3a_asset_written_into_scene', imported.alert === '' && /写入model3d\/scene\.scene3d\.json/.test(imported.text),
      imported.text.slice(0, 320));
    assert('U3b_asset_rendered_in_preview', importedObjects > baselineObjects && imported.pixels > 1000,
      JSON.stringify({ baselineObjects, importedObjects, pixels: imported.pixels }).slice(0, 240));
    assert('U3c_mesh_node_in_tree', /asset-/.test(imported.text) && /mesh-reference/.test(imported.text),
      imported.text.slice(0, 320));
    const assetsDir = path.join(workspacePath, 'model3d', 'assets');
    const assetNames = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
    assert('U3d_asset_landed_in_workspace', assetNames.some((name) => /\.glb$/i.test(name)),
      JSON.stringify(assetNames).slice(0, 200));
    const uiSceneFile = path.join(workspacePath, ...SCENE_PATH.split('/'));
    assert('U3e_ui_write_wrote_scene_file', fs.existsSync(uiSceneFile)
      && fs.readFileSync(uiSceneFile, 'utf8').includes('mesh-reference'), String(uiSceneFile).slice(-70));

    // U4 诚实失败腿：磁盘资产消失后，同一 SceneSpec 必须显式报错而不是假装渲染
    const sceneForUi = JSON.parse(fs.readFileSync(uiSceneFile, 'utf8'));
    const meshNodes = (sceneForUi.nodes || []).filter((node) => node.type === 'mesh-reference');
    const tempScene = path.join(os.tmpdir(), `block322-p1-ui-${Date.now()}.scene3d.json`);
    fs.writeFileSync(tempScene, JSON.stringify(sceneForUi, null, 2));
    tempFiles.push(tempScene);
    for (const node of meshNodes) {
      const abs = path.join(workspacePath, ...String(node.source?.path || '').split('/'));
      if (fs.existsSync(abs)) fs.rmSync(abs);
    }
    await setFileOnInput(client, '[data-testid="model3d-file-input"]', tempScene);
    const failed = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return String(parsed.text || '').includes('mesh_reference_load_failed') ? parsed : null;
    }, { timeoutMs: 30_000, intervalMs: 600, label: 'honest_failure_warning' });
    assert('U4a_missing_asset_reports_failure', /mesh_reference_load_failed:asset-scene/.test(failed.text)
      && failed.alert === '', `alert=${failed.alert} :: ${failed.text.slice(0, 200)}`);
    assert('U4b_primitives_still_rendered', failed.hasCanvas === true && failed.pixels > 1000
      && /渲染对象(\d+)/.test(failed.text), JSON.stringify({
      alert: String(failed.alert).slice(0, 120), pixels: failed.pixels,
      objects: (failed.text.match(/渲染对象\d+/) || [])[0],
    }).slice(0, 260));
    detail.ui = {
      baselineObjects,
      importedObjects,
      meshNodeIds: meshNodes.map((node) => node.id),
      failureAlert: String(failed.alert).slice(0, 200),
    };

    // runner 的 finish() 只落断言；真实数值另写同目录，供审计与后续复盘引用。
    fs.mkdirSync(path.join(ROOT, 'acceptance', 'block-322-p1'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'acceptance', 'block-322-p1', 'block322-p1-detail.json'), `${JSON.stringify({
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
    for (const file of tempFiles) { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'block322-p1-external-asset-live',
  description: 'BLOCK-322 P1：外部 mesh 资产 sha256 锚定入链 + 预览渲染 + UI 导入为场景节点 + 篡改/缺失如实失败',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-322-p1'),
  run,
};
