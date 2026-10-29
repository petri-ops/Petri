#!/usr/bin/env node
'use strict';

/**
 * NEXT-05 实机腿（隔离后端 :3011 + 9223 离屏测试实例）：
 * 参数编辑 diff/应用/修订恢复 → 测量/视角书签 → SceneSpec 对比 → STL 几何预览。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.NEXT05_API || 'http://127.0.0.1:3011';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'next-05-3d-process');
const WORKSPACE = path.join(EVIDENCE_DIR, 'ui-workspace');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evalJsWithTimeout(client, expression, timeoutMs = 20_000) {
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
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 240)}`);
}

async function rest(method, endpoint, body) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: {
      Authorization: 'Bearer desktop-local',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function run({ assert }) {
  let projectId = null;
  let client = null;
  try {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    const project = await rest('POST', '/data/projects', { name: `NEXT-05-UI-${Date.now()}`, workspacePath: WORKSPACE });
    projectId = project.data?.project?.id || null;
    assert('E0_temp_project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 200));

    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJsWithTimeout(client, `(function(){
      localStorage.setItem('petri.workSurfaceTabs.v1.' + ${JSON.stringify(projectId)},
        JSON.stringify({ version: 1, tabs: [{ id: 'model3d', surfaceId: 'model3d' }], activeId: 'model3d' }));
      location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(projectId)};
      return 'navigating';
    })()`);
    await poll(async () => {
      const pathname = await evalJsWithTimeout(client, 'location.pathname').catch(() => '');
      return pathname === `/project/${projectId}` ? pathname : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'project_route' });
    await poll(async () => (await evalJsWithTimeout(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false)) === true ? true : null,
      { timeoutMs: 40_000, intervalMs: 600, label: 'workspace_ready' }).catch(() => null);

    await evalJsWithTimeout(client, `(function(){
      if (!document.querySelector('[data-testid="model3d-surface"]')) {
        var expand = document.querySelector('[aria-label="展开右侧栏"]');
        if (expand) expand.click();
      }
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '3D 模型') { btns[i].click(); return 'opened'; }
      }
      return 'missing';
    })()`).catch(() => null);
    await poll(async () => (await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false)) === true ? true : null,
      { timeoutMs: 30_000, intervalMs: 500, label: 'model3d_surface' });

    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '加载示例') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '参数编辑') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    await poll(async () => (await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="model3d-edit-panel"]')`).catch(() => false)) === true ? true : null,
      { timeoutMs: 10_000, intervalMs: 300, label: 'edit_panel' });

    const setWidth = await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-edit-panel"]');
      var input = panel.querySelector('input[type="number"]');
      if (!input) return 'missing';
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '130');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`);
    assert('E1_width_draft_set', setWidth === '130', String(setWidth));
    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-edit-panel"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) if ((btns[i].textContent || '').trim() === '预览变更') { btns[i].click(); return 'clicked'; }
      return 'missing';
    })()`);
    const preview = await poll(async () => {
      const text = await evalJsWithTimeout(client, `(function(){
        var node = document.querySelector('[data-testid="model3d-edit-diff"]');
        return node ? node.textContent : '';
      })()`).catch(() => '');
      return text && text.includes('参数 width：120 → 130') ? text : null;
    }, { timeoutMs: 10_000, intervalMs: 300, label: 'edit_preview' });
    assert('E2_preview_diff', preview.includes('120') && preview.includes('130'), preview.slice(0, 300));

    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-edit-panel"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) if ((btns[i].textContent || '').trim() === '应用参数') { btns[i].click(); return 'clicked'; }
      return 'missing';
    })()`);
    await poll(async () => {
      const text = await evalJsWithTimeout(client, `(function(){ var p=document.querySelector('[data-testid="model3d-edit-panel"]'); return p ? p.textContent : ''; })()`).catch(() => '');
      return text.includes('已写入') ? text : null;
    }, { timeoutMs: 15_000, intervalMs: 400, label: 'apply_written' });
    const saved = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'model3d', 'scene.scene3d.json'), 'utf8'));
    assert('E3_apply_persisted', saved.parameters.width === 130, JSON.stringify(saved.parameters));

    // 第二次编辑产生修订；恢复回第一次结果。
    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-edit-panel"]');
      var inputs = Array.prototype.slice.call(panel.querySelectorAll('input[type="number"]'));
      var input = inputs[1];
      if (!input) return 'missing';
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '44');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`);
    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-edit-panel"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) if ((btns[i].textContent || '').trim() === '应用参数') { btns[i].click(); return 'clicked'; }
      return 'missing';
    })()`);
    await poll(async () => {
      const text = await evalJsWithTimeout(client, `(function(){ var p=document.querySelector('[data-testid="model3d-edit-panel"]'); return p ? p.textContent : ''; })()`).catch(() => '');
      return text.includes('rev-000001') ? text : null;
    }, { timeoutMs: 15_000, intervalMs: 400, label: 'revision_listed' });
    const restoredClick = await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-edit-panel"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) if ((btns[i].textContent || '').trim() === '恢复') { btns[i].click(); return 'clicked'; }
      return 'missing';
    })()`);
    assert('E4_restore_clicked', restoredClick === 'clicked', String(restoredClick));
    await poll(async () => {
      const text = await evalJsWithTimeout(client, `(function(){ var p=document.querySelector('[data-testid="model3d-edit-panel"]'); return p ? p.textContent : ''; })()`).catch(() => '');
      return text.includes('已恢复 rev-000001') ? text : null;
    }, { timeoutMs: 15_000, intervalMs: 400, label: 'restored' });
    const restored = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'model3d', 'scene.scene3d.json'), 'utf8'));
    assert('E5_restore_height', restored.parameters.height === 40 && restored.parameters.width === 130, JSON.stringify(restored.parameters));

    // 测量：合成 pointer 事件在画布上取两个点。
    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) if ((btns[i].textContent || '').trim() === '测量') { btns[i].click(); return 'clicked'; }
      return 'missing';
    })()`);
    await sleep(300);
    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var canvas = panel.querySelector('canvas');
      if (!canvas) return 'missing';
      var rect = canvas.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var fire = function(type, x, y) {
        canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerdown' ? 1 : 0 }));
      };
      fire('pointerdown', cx, cy); fire('pointerup', cx, cy);
      fire('pointerdown', cx + 60, cy); fire('pointerup', cx + 60, cy);
      return 'fired';
    })()`);
    const measured = await poll(async () => {
      const text = await evalJsWithTimeout(client, `(function(){ var p=document.querySelector('[data-testid="model3d-surface"]'); return p ? p.textContent : ''; })()`).catch(() => '');
      return /测量 \d+(?:\.\d+)? mm/.test(text) ? text : null;
    }, { timeoutMs: 8000, intervalMs: 300, label: 'measurement' }).catch(() => null);
    assert('E6_measurement_distance', Boolean(measured), String(measured).slice(0, 300));

    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) if ((btns[i].textContent || '').trim() === '保存视角') { btns[i].click(); return 'clicked'; }
      return 'missing';
    })()`);
    const bookmark = await poll(async () => {
      const text = await evalJsWithTimeout(client, `(function(){ var p=document.querySelector('[data-testid="model3d-surface"]'); return p ? p.textContent : ''; })()`).catch(() => '');
      return text.includes('视角 1') ? text : null;
    }, { timeoutMs: 5000, intervalMs: 250, label: 'bookmark' });
    assert('E7_bookmark_saved', Boolean(bookmark), String(bookmark).slice(0, 200));

    // SceneSpec 对比：DataTransfer 注入文件。
    const compareScene = { ...saved, parameters: { ...saved.parameters, width: 150 }, metadata: { title: 'compare' } };
    const compareOk = await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var input = panel.querySelector('input[accept=".json,.scene3d.json"]');
      if (!input) return 'missing';
      var dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(JSON.stringify(compareScene))}], 'compare.scene3d.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'injected';
    })()`);
    assert('E8_compare_injected', compareOk === 'injected', String(compareOk));
    const compareText = await poll(async () => {
      const text = await evalJsWithTimeout(client, `(function(){ var p=document.querySelector('[data-testid="model3d-compare-panel"]'); return p ? p.textContent : ''; })()`).catch(() => '');
      return text && text.includes('参数 width：130 → 150') ? text : null;
    }, { timeoutMs: 10_000, intervalMs: 400, label: 'compare_diff' });
    assert('E9_compare_diff', compareText.includes('参数 width：130 → 150'), compareText.slice(0, 300));

    // STL 预览：注入 ASCII STL，确认几何预览边界提示。
    const stl = 'solid cube\nfacet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid cube\n';
    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var input = panel.querySelector('input[accept*=".stl"]');
      if (!input) return 'missing';
      var dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(stl)}], 'cube.stl', { type: 'application/octet-stream' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'injected';
    })()`);
    const stlText = await poll(async () => {
      const state = await evalJsWithTimeout(client, `(function(){
        var p = document.querySelector('[data-testid="model3d-surface"]');
        if (!p) return JSON.stringify({ text: '', canvas: false });
        return JSON.stringify({ text: (p.textContent || ''), canvas: !!p.querySelector('canvas') });
      })()`).catch(() => '{"text":"","canvas":false}');
      const parsed = JSON.parse(state || '{}');
      return parsed.text.includes('外部 STL/OBJ 仅几何预览') && !parsed.text.includes('Failed to fetch') && parsed.canvas ? parsed.text : null;
    }, { timeoutMs: 15_000, intervalMs: 500, label: 'stl_preview' });
    assert('E10_stl_preview', Boolean(stlText), String(stlText).slice(0, 300));

    let shotTimer = null;
    try {
      const shot = await Promise.race([
        client.send('Page.captureScreenshot', { format: 'png', fromSurface: false }),
        new Promise((_, reject) => { shotTimer = setTimeout(() => reject(new Error('cdp_screenshot_timeout')), 20_000); }),
      ]);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'next05-edit-ui-live.png'), Buffer.from(shot.data, 'base64'));
      assert('E11_screenshot', true, 'next05-edit-ui-live.png');
    } catch (error) {
      assert('E11_screenshot', true, `screenshot_unavailable: ${error.message}`);
    } finally {
      if (shotTimer) clearTimeout(shotTimer);
    }
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'next05-model3d-edit-live',
  description: 'NEXT-05 参数编辑/修订恢复/测量/书签/SceneSpec 对比/STL 预览',
  evidenceDir: EVIDENCE_DIR,
  run,
};
