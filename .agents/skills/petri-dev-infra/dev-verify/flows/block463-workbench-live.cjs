#!/usr/bin/env node
'use strict';

/**
 * dev-verify/flows/block463-workbench-live.cjs — BLOCK-463 实机腿（9223 离屏）。
 *
 * 真实链路：sand3d 端到端产物（model3d/runs/block463-live/：GLB + scene.json 含
 * joints + provenance + three-live verifierResults）→ 建临时项目 → 导航项目工作台 →
 * dispatch petri:model3d-open（与 ComposeCard 跳转/Result Studio 按钮同契约）→
 * 断言右栏 model3d 面在场 + GLB 装载（canvas）。跑完即终止测试实例并清理项目
 *（BLOCK-231 纪律；不设 PETRI_TEST_ONSCREEN）。
 */

const path = require('node:path');
const lib = require('../lib.cjs');

// 守卫（R2 清偿批清退票 2026-11-21）：本文件历史上无 module.exports 且 IIFE 顶层自执行——
// dev-verify run.cjs 装载全部 flows 找 id 时被连带真实执行（建垃圾项目/改写证据），同类事故
// 多次复发。守卫语义：仅直接调用（node 本文件 / npm run verify -- block463-workbench-live）执行。
if (require.main !== module) {
  module.exports = { id: 'block463-workbench-live', description: 'BLOCK-463 实机腿（自执行已守卫，run.cjs 装载安全）' };
} else {
const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
// BLOCK-493 清偿：env 调用时读取（BLOCK-267/BLOCK-375 顶层固化棘轮；原顶层 const 固化在导入期取值）
const apiBase = () => process.env.BLOCK463_API || 'http://127.0.0.1:3001';
const SCENE_PATH = 'model3d/runs/block463-live/scene.json';
const MESH_PATH = 'model3d/runs/block463-live/model.glb';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block463');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function rest(method, endpoint, body) {
  const resp = await fetch(`${apiBase()}/api${endpoint}`, {
    method,
    headers: { Authorization: 'Bearer desktop-local', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  return { status: resp.status, data: await resp.json().catch(() => null) };
}

(async () => {
  const run = lib.createRun({ name: 'block463-workbench-live', evidenceDir: EVIDENCE_DIR });
  let projectId = null;
  let client = null;

  try {
    // ① 建临时项目
    const project = await rest('POST', '/data/projects', { name: `BLOCK463-LIVE-${Date.now()}` });
    projectId = project.data?.project?.id || null;
    run.assert('project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 160));

    // ①b 产物写进项目工作区（model3d 路由按项目 workspace_path 解析——scene_not_found 根因）：
    //    sqlite 只读取 workspace_path → 从仓库 model3d/runs/block463-live/ 拷贝三件（GLB/scene.json 含
    //    BLOCK-462 truth 链 verifierResults/diagnostics.json）。
    const Database = require('better-sqlite3');
    const dbRow = new Database(path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db'), { readonly: true })
      .prepare('SELECT workspace_path FROM projects WHERE id = ?').get(projectId);
    const workspacePath = dbRow?.workspace_path;
    run.assert('workspace_path_resolved', Boolean(workspacePath), { workspacePath: String(workspacePath).slice(0, 120) });
    if (workspacePath) {
      const fsMod = require('node:fs');
      const targetDir = path.join(workspacePath, 'model3d', 'runs', 'block463-live');
      fsMod.mkdirSync(targetDir, { recursive: true });
      for (const name of ['model.glb', 'scene.json']) {
        fsMod.copyFileSync(path.join(ROOT, 'model3d', 'runs', 'block463-live', name), path.join(targetDir, name));
      }
      fsMod.copyFileSync(path.join(ROOT, 'model3d', 'runs', 'block463-live', 'verify', 'diagnostics.json'), path.join(targetDir, 'diagnostics.json'));
      // scene.json 的 mesh-reference 引用 acceptance/block460/e2e-out/cabinet.glb（仓库相对路径）——
      // 工作台 mesh 从项目工作区解析（截图实测 mesh_reference_load_failed 根因），按引用路径同放一份。
      fsMod.mkdirSync(path.join(workspacePath, 'acceptance', 'block460', 'e2e-out'), { recursive: true });
      fsMod.copyFileSync(path.join(ROOT, 'model3d', 'runs', 'block463-live', 'model.glb'), path.join(workspacePath, 'acceptance', 'block460', 'e2e-out', 'cabinet.glb'));
      run.assert('artifacts_placed_into_project_workspace', true, { dir: targetDir.slice(0, 140) });
    }

    // ② 连接 9223 并导航项目工作台（监听器挂载页）
    client = await lib.connectTestTarget({ timeoutMs: 30_000 });
    await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/${projectId}`)}`, 15_000).catch(() => null);
    await sleep(4000);
    const routeProbe = await lib.evalJs(client, 'location.pathname');
    run.assert('workspace_route_mounted', String(routeProbe).includes(`/project/${projectId}`), { route: String(routeProbe).slice(0, 120) });

    // ③ dispatch petri:model3d-open（ComposeCard 跳转 / Result Studio 按钮同契约）
    await lib.evalJs(client, `
      window.dispatchEvent(new CustomEvent('petri:model3d-open', { detail: {
        projectId: ${JSON.stringify(projectId)},
        scenePath: ${JSON.stringify(SCENE_PATH)},
        meshPath: ${JSON.stringify(MESH_PATH)},
        label: 'block463-live',
      }}));
      'dispatched'
    `, 10_000);
    run.assert('model3d_open_dispatched', true);

    // ④ 右栏 model3d 面在场 + GLB 装载（canvas 离屏可用；Model3DResultViewer/Model3DSurface 挂载）
    await sleep(6000);
    const probe = JSON.parse(await lib.evalJs(client, `JSON.stringify({
      canvases: document.querySelectorAll('canvas').length,
      model3dFaces: document.querySelectorAll('[data-testid*="model3d"], [class*="model3d"], [class*="Model3D"]').length,
      workbenchHints: (document.body.innerText.match(/在 3D 工作台打开|点击模型面/g) || []).length,
      bodyChars: document.body.innerText.length,
    })`));
    run.assert('model3d_face_present', probe.model3dFaces >= 1 || probe.workbenchHints >= 1, probe);
    run.assert('glb_canvas_rendering', probe.canvases >= 1, probe);

    // ⑤ 证据截图（离屏；不可得则如实红）
    try {
      await lib.screenshotPng(client, EVIDENCE_DIR, 'block463-workbench.png');
      run.assert('screenshot_captured', true);
    } catch (error) {
      run.assert('screenshot_captured', false, { error: String(error).slice(0, 200) });
    }
  } catch (error) {
    run.assert('flow_error', false, String(error).slice(0, 300));
  } finally {
    // ⑥ 清理：删临时项目（跑完即清）；9223 终止由外层调用方统一执行
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
    try { await client?.close?.(); } catch { /* 连接已断 */ }
  }

  const summary = run.finish();
  console.log(JSON.stringify(summary).slice(0, 400));
  process.exit(summary.allPass ? 0 : 1);
})();
}
