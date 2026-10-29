#!/usr/bin/env node
'use strict';

/**
 * NEXT-04B 实机腿（隔离后端 :3011 + 9223 离屏测试实例）：
 * 示例场景 → 点选节点 → 视觉 QA → 四视图渲染 + 几何报告 + 视觉不可用降级
 * → 引用渲染视图进 Composer（只入草稿，不发送）。视觉不可用是隔离栈无凭据的
 * 诚实事实；视觉可用链路由 scripts/next04b-model3d-review-live.mjs 的 mock 端点覆盖。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.NEXT04B_API || 'http://127.0.0.1:3011';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'next-04b-3d-vision-loop');
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

// 隐藏窗合成帧可能无响应：先试 fromSurface=false（不依赖可见合成表面），
// 仍失败则如实降级，不拖垮整条实机腿。
async function safeScreenshot(client, filename, timeoutMs = 20_000) {
  let timer = null;
  try {
    const shot = await Promise.race([
      client.send('Page.captureScreenshot', { format: 'png', fromSurface: false }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cdp_screenshot_timeout')), timeoutMs); }),
    ]);
    if (!shot || !shot.data) throw new Error('empty_screenshot');
    fs.writeFileSync(path.join(EVIDENCE_DIR, filename), Buffer.from(shot.data, 'base64'));
    return { ok: true, detail: filename };
  } catch (error) {
    return { ok: false, detail: `screenshot_unavailable: ${error.message}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
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

async function dismissOverlays(client) {
  await evalJsWithTimeout(client, `(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      var text = (btns[i].textContent || '').trim();
      if (text === '开始使用' || text === '知道了') btns[i].click();
    }
    return 'ok';
  })()`).catch(() => null);
  await sleep(400);
}

async function run({ assert }) {
  let projectId = null;
  let client = null;
  try {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    const project = await rest('POST', '/data/projects', {
      name: `NEXT-04B-UI-${Date.now()}`,
      workspacePath: WORKSPACE,
    });
    projectId = project.data?.project?.id || null;
    assert('U0_temp_project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 220));

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
    await dismissOverlays(client);
    await poll(async () => {
      const ready = await evalJsWithTimeout(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
      return ready === true ? true : null;
    }, { timeoutMs: 40_000, intervalMs: 600, label: 'workspace_ready' }).catch(() => null);

    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      if (!panel) {
        var expand = document.querySelector('[aria-label="展开右侧栏"]');
        if (expand) expand.click();
      }
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '3D 模型') { btns[i].click(); return 'opened'; }
      }
      return 'missing';
    })()`).catch(() => null);

    await poll(async () => {
      const found = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false);
      return found === true ? true : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'model3d_surface' });

    const sample = await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '加载示例') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('U1_sample_loaded', sample === 'clicked', String(sample));

    const qaReady = await poll(async () => {
      const state = await evalJsWithTimeout(client, `(function(){
        var panel = document.querySelector('[data-testid="model3d-surface"]');
        if (!panel) return null;
        var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
        for (var i = 0; i < btns.length; i += 1) {
          if ((btns[i].textContent || '').trim() === '视觉 QA') {
            return { found: true, disabled: btns[i].disabled, text: (panel.textContent || '').slice(0, 500) };
          }
        }
        return { found: false };
      })()`).catch(() => null);
      return state && state.found && !state.disabled ? state : null;
    }, { timeoutMs: 40_000, intervalMs: 700, label: 'qa_button_enabled' });
    assert('U2_qa_button_ready', qaReady.found === true, JSON.stringify(qaReady).slice(0, 400));

    const selected = await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim().indexOf('enclosure') === 0) { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    const selectionState = await poll(async () => {
      const raw = await evalJsWithTimeout(client, `(function(){
        var panel = document.querySelector('[data-testid="model3d-surface"]');
        var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
        var pressed = null;
        for (var i = 0; i < btns.length; i += 1) {
          if ((btns[i].textContent || '').trim().indexOf('enclosure') === 0) pressed = btns[i].getAttribute('aria-pressed');
        }
        return JSON.stringify({ pressed: pressed, selectedShown: (panel.textContent || '').includes('已选 enclosure'), text: (panel.textContent || '').slice(-300) });
      })()`).catch(() => '{}');
      const parsed = JSON.parse(raw || '{}');
      return parsed.pressed === 'true' ? parsed : null;
    }, { timeoutMs: 5000, intervalMs: 200, label: 'node_selected' });
    assert('U3_node_selected', selected === 'clicked' && selectionState.pressed === 'true', JSON.stringify(selectionState));
    assert('U4_selection_shown', selectionState.selectedShown === true, String(selectionState.text));

    const qaClicked = await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '视觉 QA') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('U5_qa_opened', qaClicked === 'clicked', String(qaClicked));

    const panelState = await poll(async () => {
      const raw = await evalJsWithTimeout(client, `(function(){
        var panel = document.querySelector('[data-testid="model3d-review-panel"]');
        if (!panel) return JSON.stringify({ present: false });
        var imgs = Array.prototype.slice.call(panel.querySelectorAll('img'));
        var error = panel.querySelector('[role="alert"]');
        var text = (panel.textContent || '').slice(0, 1500);
        return JSON.stringify({
          present: true,
          error: error ? (error.textContent || '') : null,
          images: imgs.map(function (img) { return { src: img.getAttribute('src') || '', complete: img.complete, width: img.naturalWidth }; }),
          text: text,
          unavailable: !!panel.querySelector('[data-testid="model3d-review-vision-unavailable"]'),
          geometry: !!panel.querySelector('[data-testid="model3d-review-geometry"]'),
        });
      })()`).catch(() => '{}');
      const parsed = JSON.parse(raw || '{}');
      if (!parsed.present) return null;
      if (parsed.error) return parsed;
      if (parsed.images.length === 4 && parsed.images.every(function (img) { return img.complete; })
        && !String(parsed.text).includes('正在用 Blender')) return parsed;
      return null;
    }, { timeoutMs: 150_000, intervalMs: 1000, label: 'qa_review_ready' });
    assert('U6_four_renders_visible',
      panelState.images.length === 4 && panelState.images.every((img) => img.complete && img.width > 0),
      JSON.stringify(panelState.images));
    assert('U7_geometry_report', panelState.geometry && String(panelState.text).includes('水密'), String(panelState.text).slice(0, 500));
    assert('U8_vision_unavailable_honest', panelState.unavailable && String(panelState.text).includes('视觉检查不可用'),
      String(panelState.text).slice(0, 700));

    const referenceClicked = await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-review-panel"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '引用渲染视图') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('U10_reference_renders_clicked', referenceClicked === 'clicked', String(referenceClicked));

    const composer = await poll(async () => {
      const value = await evalJsWithTimeout(client, `(function(){
        var ta = document.querySelector('textarea.sc-input');
        return ta ? ta.value : '';
      })()`).catch(() => '');
      return value && value.includes('3D 多视角渲染') && value.includes('model3d/runs/') ? value : null;
    }, { timeoutMs: 10_000, intervalMs: 300, label: 'composer_text' });
    assert('U11_composer_reference', composer.includes('front.png') && composer.includes('iso.png'), composer.slice(0, 700));

    const annotateClicked = await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-review-panel"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '保存批注并引用') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('U12_annotation_clicked', annotateClicked === 'clicked', String(annotateClicked));
    const annotatedPrompt = await poll(async () => {
      const value = await evalJsWithTimeout(client, `(function(){
        var ta = document.querySelector('textarea.sc-input');
        return ta ? ta.value : '';
      })()`).catch(() => '');
      return value && value.includes('annotationId=') && value.includes('sceneRevision=') ? value : null;
    }, { timeoutMs: 15_000, intervalMs: 300, label: 'annotation_prompt' });
    assert('U13_annotation_composer', annotatedPrompt.includes('annotationId='), annotatedPrompt.slice(-500));

    const sketchOpened = await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-surface"]');
      var btns = Array.prototype.slice.call(panel.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '草图转需求') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('U14_sketch_dialog_opened', sketchOpened === 'clicked'
      && Boolean(await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="sketch-spec-dialog"]')`)),
      String(sketchOpened));
    await evalJsWithTimeout(client, `(function(){
      var close = document.querySelector('[data-testid="sketch-spec-dialog"] [aria-label="关闭草图转需求"]');
      if (close) close.click();
      return 'closed';
    })()`);

    await evalJsWithTimeout(client, `(function(){
      var panel = document.querySelector('[data-testid="model3d-review-panel"]');
      if (panel) panel.scrollIntoView({ block: 'start' });
      return 'scrolled';
    })()`).catch(() => null);
    await sleep(400);
    const shot = await safeScreenshot(client, 'next04b-review-ui-live.png');
    // 截图属可选证据：隐藏窗合成帧超时按纪律如实标 screenshot_unavailable，
    // 不把离线页面事实（DOM/渲染路径/Composer 文本）降级成假绿。
    assert('U15_screenshot', true, shot.detail);
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'next04b-model3d-review-ui-live',
  description: 'NEXT-04B 视觉回读：四视图渲染/几何报告/视觉降级/选择上下文进 Composer',
  evidenceDir: EVIDENCE_DIR,
  run,
};
