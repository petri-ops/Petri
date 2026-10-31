#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 P5-02 外部文生 3D UI 实机腿（9223 离屏，mock provider）：
 * 打开 3D 工作面 → AI 生成对话框 → 生成 mock GLB → 自动 add_node → 预览/磁盘对账。
 * 真实 Tripo 生成需要 key，属外部条件；本 flow 只验证接线、隐私提示与入链，不冒充真实生成。
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.BLOCK322_API || 'http://127.0.0.1:3002';

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

const panelSnapshot = `(function(){
  var panel = document.querySelector('[data-testid="model3d-surface"]');
  if (!panel) return JSON.stringify({ present: false });
  var canvas = panel.querySelector('[data-testid="model3d-canvas"]');
  var pixels = 0;
  if (canvas) { try { pixels = (canvas.toDataURL('image/png') || '').length; } catch (e) { pixels = -1; } }
  var alert = panel.querySelector('[role="alert"]');
  var gen = panel.querySelector('[data-testid="model3d-generation-capability"]');
  return JSON.stringify({
    present: true,
    hasCanvas: !!canvas,
    text: (panel.textContent || '').replace(/\\s+/g, ''),
    alert: alert ? (alert.textContent || '') : '',
    gen: gen ? (gen.textContent || '').replace(/\\s+/g, '') : '',
    pixels: pixels,
  });
})()`;

async function run(ctx) {
  const { assert } = ctx;
  const detail = {};
  let projectId = null;
  let workspacePath = null;
  let client = null;
  try {
    const capability = await rest('GET', '/model3d/capability');
    assert('A0_mock_generation_ready', capability.status === 200
      && capability.data?.generation?.status === 'ready'
      && capability.data.generation.provider === 'mock'
      && capability.data.generation.privacy?.external === false,
    JSON.stringify(capability.data?.generation).slice(0, 400));
    detail.generationCapability = capability.data?.generation || null;

    const project = await rest('POST', '/data/projects', { name: `BLOCK322-GEN-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    workspacePath = project.data?.project?.workspace_path || project.data?.workspace_path || null;
    assert('A1_project', project.status === 200 && Boolean(projectId) && Boolean(workspacePath) && fs.existsSync(workspacePath),
      JSON.stringify({ projectId, workspacePath }).slice(0, 240));

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
      return /AI生成/.test(parsed.gen) && /mock/.test(parsed.gen) ? parsed : null;
    }, { timeoutMs: 20_000, intervalMs: 500, label: 'generation_badge' });
    assert('U0_generation_badge', /AI生成/.test(capabilityText.gen) && /mock/.test(capabilityText.gen),
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

    const opened = await evalJs(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === 'AI 生成') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('U1a_dialog_open', opened === 'clicked', String(opened));
    await poll(async () => {
      const found = await evalJs(client, `!!document.querySelector('[role="dialog"][aria-label="AI 生成 3D 模型"] textarea')`).catch(() => false);
      return found === true ? true : null;
    }, { timeoutMs: 10_000, intervalMs: 300, label: 'generation_dialog' });
    await evalJs(client, `(function(){
      var textarea = document.querySelector('[role="dialog"][aria-label="AI 生成 3D 模型"] textarea');
      textarea.focus();
      return textarea ? 'focused' : 'missing';
    })()`);
    await client.send('Input.insertText', { text: 'a mock bracket for generation live' });
    const promptText = await evalJs(client, `(document.querySelector('[role="dialog"][aria-label="AI 生成 3D 模型"] textarea') || {}).value || ''`);
    assert('U1b_prompt_typed', /mock bracket/.test(promptText), String(promptText).slice(0, 120));

    const clicked = await evalJs(client, `(function(){
      var dialog = document.querySelector('[role="dialog"][aria-label="AI 生成 3D 模型"]');
      var btns = Array.prototype.slice.call(dialog.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '生成并加入场景') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('U2a_generate_clicked', clicked === 'clicked', String(clicked));
    const generated = await poll(async () => {
      const parsed = JSON.parse(await evalJs(client, panelSnapshot).catch(() => '{}'));
      return /AI生成结果已作为节点/.test(parsed.text) && /mock/.test(parsed.text) ? parsed : null;
    }, { timeoutMs: 60_000, intervalMs: 700, label: 'generation_notice' });
    assert('U2b_generation_notice', generated.alert === '' && /mesh-reference/.test(generated.text),
      JSON.stringify(generated).slice(0, 420));

    const assetsDir = path.join(workspacePath, 'model3d', 'assets');
    const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((name) => /\.glb$/i.test(name)) : [];
    assert('U3_glb_on_disk', assets.length >= 1, JSON.stringify(assets).slice(0, 200));
    const sceneFile = path.join(workspacePath, 'model3d', 'scene.scene3d.json');
    assert('U4_scene_has_generated_node', fs.existsSync(sceneFile)
      && fs.readFileSync(sceneFile, 'utf8').includes('mesh-reference'), sceneFile.slice(-100));
    detail.ui = { badge: capabilityText.gen, notice: generated.text.slice(0, 500), assets };

    fs.mkdirSync(path.join(ROOT, 'acceptance', 'block-322-p5'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'acceptance', 'block-322-p5', 'block322-p5-generation-ui-detail.json'), `${JSON.stringify({
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
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'block322-p5-generation-ui-live',
  description: 'BLOCK-322 P5-02：AI 生成对话框 → mock GLB → add_node → 预览/磁盘对账（9223 离屏）',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-322-p5'),
  run,
};
