#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 P3-02b 实机腿：预览位置 == 服务端求值后的位置（前端不自解）。
 *
 * 判据是**面板上的包围盒读数**（由 Three 侧实测场景盒得出），不是文案：
 * 同一份 SceneSpec 带 `align` 时，声明态包围盒 X=190、求值后 X=120；若前端偷偷自己解一遍
 * 或根本没消费求值结果，这两个数字就会站错边。第二腿走诚实回落：过约束场景求值端点 400，
 * 预览保持声明位置（190）并把原因写在告警里——不空屏、不假装、也不悄悄吞掉。
 *
 * 运行前提：主 dev 栈 + 9223 测试实例在跑。证据落 acceptance/block-322-p3/。
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

function box(id, width, height, depth, position = [0, 0, 0]) {
  return {
    id,
    type: 'box',
    dimensions: { width, height, depth },
    transform: { position, rotation: [0, 0, 0] },
    material: { color: '#6a8caf', roughness: 0.4 },
  };
}

function sceneOf(nodes, constraints, title) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes,
    constraints,
    metadata: { title },
  };
}

const PAIR = () => [box('base', 120, 40, 80, [0, 0, 0]), box('port', 60, 40, 40, [100, 0, 0])];

function readPanel(client) {
  return evalJs(client, `(function(){
    var p = document.querySelector('[data-testid="model3d-surface"]');
    return p ? (p.textContent || '').replace(/\\s+/g, '') : '';
  })()`);
}

const boundsOf = (panel) => {
  const match = /包围盒mm(\d+)×(\d+)×(\d+)/.exec(panel);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const objectsOf = (panel) => {
  const match = /渲染对象(\d+)/.exec(panel);
  return match ? Number(match[1]) : 0;
};

async function run(ctx) {
  const { assert } = ctx;
  const detail = {};
  let projectId = null;
  let client = null;
  const tempFiles = [];
  try {
    const health = await rest('GET', '/health');
    assert('P0_backend_reachable', health.status === 200 && health.data?.status === 'ok', JSON.stringify(health.data ?? {}).slice(0, 140));
    const project = await rest('POST', '/data/projects', { name: `BLOCK322-P302B-${Date.now()}` });
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

    // —— 腿一：求值后的位置真的进画面（包围盒 X 由 190 变 120，且通用告警消失）——
    const alignedFile = path.join(os.tmpdir(), `block322-p302b-aligned-${Date.now()}.scene3d.json`);
    fs.writeFileSync(alignedFile, JSON.stringify(sceneOf(PAIR(), [{ kind: 'align', a: 'base', b: 'port', axis: 'x' }], 'P3-02b align')), 'utf8');
    tempFiles.push(alignedFile);
    await setFileOnInput(client, '[data-testid="model3d-file-input"]', alignedFile);
    const alignedPanel = await poll(async () => {
      const text = String(await readPanel(client).catch(() => ''));
      const bounds = boundsOf(text);
      return bounds && bounds[0] === 120 && !text.includes('预览未取回求值结果') ? text : null;
    }, { timeoutMs: 45_000, intervalMs: 500, label: 'evaluated_bounds' });
    assert('P2_preview_shows_evaluated_bounds', boundsOf(alignedPanel)[0] === 120
      && boundsOf(alignedPanel)[1] === 80 && boundsOf(alignedPanel)[2] === 40,
      JSON.stringify({ bounds: boundsOf(alignedPanel), expect: [120, 80, 40] }).slice(0, 200));
    assert('P3_evaluated_notice_replaced', alignedPanel.includes('对齐base→port（x）') && alignedPanel.includes('约束1')
      && !alignedPanel.includes('预览未取回求值结果') && !alignedPanel.includes('未能向本地后端取回'), alignedPanel.slice(0, 420));
    assert('P4_both_nodes_render_after_eval', objectsOf(alignedPanel) === 2, JSON.stringify({ objects: objectsOf(alignedPanel) }).slice(0, 160));

    // —— 腿二：过约束场景求值端点 400 → 预览保持声明位置并写出原因（不空屏、不吞错）——
    const conflictFile = path.join(os.tmpdir(), `block322-p302b-conflict-${Date.now()}.scene3d.json`);
    fs.writeFileSync(conflictFile, JSON.stringify(sceneOf(PAIR(), [
      { kind: 'distance', a: 'base', b: 'port', axis: 'x', value: 60 },
      { kind: 'align', a: 'base', b: 'port', axis: 'x' },
    ], 'P3-02b conflict')), 'utf8');
    tempFiles.push(conflictFile);
    await setFileOnInput(client, '[data-testid="model3d-file-input"]', conflictFile);
    const conflictPanel = await poll(async () => {
      const text = String(await readPanel(client).catch(() => ''));
      return text.includes('未能向本地后端取回求值结果') ? text : null;
    }, { timeoutMs: 45_000, intervalMs: 500, label: 'honest_fallback' });
    assert('P5_fallback_keeps_declared_bounds', JSON.stringify(boundsOf(conflictPanel)) === JSON.stringify([190, 80, 40]),
      JSON.stringify({ bounds: boundsOf(conflictPanel), expect: [190, 80, 40] }).slice(0, 200));
    assert('P6_reason_visible_from_server_message', conflictPanel.includes('constraint_conflict')
      && conflictPanel.includes('预览按声明位置显示'), conflictPanel.slice(0, 420));
    assert('P7_still_renders_on_failure', objectsOf(conflictPanel) === 2, JSON.stringify({ objects: objectsOf(conflictPanel) }).slice(0, 160));

    // —— 腿三：场景写盘内容不受预览求值影响（求值是投影，不改 SceneSpec 真值）——
    const scenePath = 'model3d/p302b.scene3d.json';
    const applied = await rest('POST', '/model3d/scene/apply', {
      projectId,
      path: scenePath,
      scene: sceneOf(PAIR(), [{ kind: 'align', a: 'base', b: 'port', axis: 'x' }], 'P3-02b truth'),
      operations: [{ op: 'set_metadata', metadata: { note: 'truth-check' } }],
    });
    const readBack = await rest('POST', '/model3d/scene/read', { projectId, path: scenePath });
    const portNode = (readBack.data?.scene?.nodes || []).find((node) => node.id === 'port') || {};
    assert('P8_stored_scene_keeps_declared_position', applied.status === 200 && applied.data?.ok === true
      && JSON.stringify(portNode.transform?.position) === JSON.stringify([100, 0, 0]),
      JSON.stringify({ status: applied.status, position: portNode.transform?.position }).slice(0, 200));

    detail.aligned = { bounds: boundsOf(alignedPanel), objects: objectsOf(alignedPanel) };
    detail.conflict = { bounds: boundsOf(conflictPanel), objects: objectsOf(conflictPanel), notice: conflictPanel.slice(0, 600) };
    detail.storedPortPosition = portNode.transform?.position;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block322-p3-02b-preview-eval-detail.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      expectation: '声明态包围盒 X=190（base 半宽 60 + port 中心 100 + 半宽 30）；align 求值后 port 中心=0 ⇒ X=120',
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
  id: 'block322-p3-02b-preview-eval-live',
  description: 'BLOCK-322 P3-02b：预览包围盒=服务端求值结果（190→120）、过约束时诚实回落并写出原因、写盘真值不受求值影响',
  evidenceDir: EVIDENCE_DIR,
  run,
};
