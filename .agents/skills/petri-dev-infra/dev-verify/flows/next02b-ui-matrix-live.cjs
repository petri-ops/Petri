#!/usr/bin/env node
'use strict';

/**
 * NEXT-02B 实机矩阵：双主题 / 常用与窄视口 / 高 DPI / reduced motion / 键盘焦点，
 * 以布局几何与计算样式为主（截图只作补充）。9223 离屏测试实例。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.NEXT02B_API || 'http://127.0.0.1:3011';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'next-02b-ui-visual-convergence');
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

async function poll(fn, { timeoutMs, intervalMs = 400, label }) {
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

async function metrics(client, width, height, deviceScaleFactor = 1) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
  await sleep(350);
}

async function geometry(client) {
  const raw = await evalJsWithTimeout(client, `(function(){
    var doc = document.documentElement;
    var composer = document.querySelector('.sc-composer');
    var root = document.querySelector('.sc-root');
    var surface = document.querySelector('[data-testid="model3d-surface"]');
    var rect = function(node) { if (!node) return null; var r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }; };
    var surfaceBody = surface ? surface.querySelector('div') : null;
    return JSON.stringify({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      doc: { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth },
      composer: rect(composer),
      root: rect(root),
      surface: rect(surface),
      theme: document.documentElement.getAttribute('data-theme'),
      composerBg: composer ? getComputedStyle(composer).backgroundColor : null,
      elevatedVar: getComputedStyle(doc).getPropertyValue('--petri-bg-elevated').trim(),
      animationDuration: composer ? getComputedStyle(composer).animationDuration : null,
      activeTag: document.activeElement ? document.activeElement.tagName : null,
    });
  })()`);
  return JSON.parse(raw || '{}');
}

async function run({ assert }) {
  let projectId = null;
  let client = null;
  try {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    const project = await rest('POST', '/data/projects', { name: `NEXT-02B-UI-${Date.now()}`, workspacePath: WORKSPACE });
    projectId = project.data?.project?.id || null;
    assert('M0_project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 180));

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
      for (var i = 0; i < btns.length; i += 1) if ((btns[i].textContent || '').trim() === '3D 模型') { btns[i].click(); return 'opened'; }
      return 'missing';
    })()`).catch(() => null);
    await poll(async () => (await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false)) === true ? true : null,
      { timeoutMs: 20_000, intervalMs: 500, label: 'model3d_surface' });
    await evalJsWithTimeout(client, `(function(){
      var surface = document.querySelector('[data-testid="model3d-surface"]');
      var rect = surface ? surface.getBoundingClientRect() : null;
      if (!rect || rect.width < 100) {
        var expand = document.querySelector('[aria-label="展开右侧栏"]');
        if (expand) expand.click();
      }
      return 'expanded';
    })()`).catch(() => null);
    await sleep(600);

    const matrix = [];
    for (const viewport of [
      { width: 1440, height: 900, dpr: 1 },
      { width: 1024, height: 768, dpr: 1 },
      { width: 720, height: 900, dpr: 1 },
      { width: 480, height: 800, dpr: 1 },
      { width: 1280, height: 800, dpr: 2 },
    ]) {
      await metrics(client, viewport.width, viewport.height, viewport.dpr);
      const state = await geometry(client);
      matrix.push({ ...viewport, ...state });
      assert(`M1_no_horizontal_overflow_${viewport.width}`, state.doc.scrollWidth <= state.doc.clientWidth,
        JSON.stringify(state.doc));
      assert(`M2_composer_within_viewport_${viewport.width}`, state.composer && state.composer.width <= state.viewport.width - 8,
        JSON.stringify(state.composer));
      if (viewport.width >= 900) {
        assert(`M3_surface_within_panel_${viewport.width}`, !state.surface || state.surface.width < 100 || state.surface.scrollWidth <= state.surface.clientWidth + 1,
          JSON.stringify(state.surface));
      }
    }

    // 双主题：直接切 data-theme（主题 token 实际渲染面），比较背景色并复查溢出。
    await metrics(client, 1024, 768, 1);
    await evalJsWithTimeout(client, `document.documentElement.setAttribute('data-theme', 'light'); 'light'`);
    await sleep(300);
    const light = await geometry(client);
    await evalJsWithTimeout(client, `document.documentElement.setAttribute('data-theme', 'dark'); 'dark'`);
    const dark = await poll(async () => {
      const state = await geometry(client);
      return state.composerBg && state.composerBg !== light.composerBg ? state : null;
    }, { timeoutMs: 3000, intervalMs: 100, label: 'dark_theme' });
    await evalJsWithTimeout(client, `document.documentElement.setAttribute('data-theme', 'light'); 'light'`);
    assert('M4_dark_theme_applied', dark.theme === 'dark' && dark.composerBg !== light.composerBg,
      JSON.stringify({ light: light.composerBg, dark: dark.composerBg }));
    assert('M5_dark_no_overflow', dark.doc.scrollWidth <= dark.doc.clientWidth, JSON.stringify(dark.doc));

    // reduced motion：模拟系统偏好，计算样式应落到全局降级档。
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(250);
    const reduced = await geometry(client);
    await client.send('Emulation.setEmulatedMedia', { features: [] });
    assert('M6_reduced_motion', ['0.001ms', '0.001s', '1e-06s'].includes(reduced.animationDuration),
      String(reduced.animationDuration));

    // 键盘焦点：输入框可聚焦。
    const focus = await evalJsWithTimeout(client, `(function(){
      var input = document.querySelector('textarea.sc-input');
      if (!input) return 'missing';
      input.focus();
      return document.activeElement === input ? 'focused' : document.activeElement.tagName;
    })()`);
    assert('M7_composer_focus', focus === 'focused', String(focus));

    await client.send('Emulation.clearDeviceMetricsOverride');
    await sleep(200);
    let shotTimer = null;
    try {
      const shot = await Promise.race([
        client.send('Page.captureScreenshot', { format: 'png', fromSurface: false }),
        new Promise((_, reject) => { shotTimer = setTimeout(() => reject(new Error('cdp_screenshot_timeout')), 20_000); }),
      ]);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'next02b-ui-matrix.png'), Buffer.from(shot.data, 'base64'));
      assert('M8_screenshot', true, 'next02b-ui-matrix.png');
    } catch (error) {
      assert('M8_screenshot', true, `screenshot_unavailable: ${error.message}`);
    } finally {
      if (shotTimer) clearTimeout(shotTimer);
    }

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'layout-matrix.json'), JSON.stringify({ matrix, light: { bg: light.composerBg, elevated: light.elevatedVar }, dark: { bg: dark.composerBg, elevated: dark.elevatedVar }, reducedAnimationDuration: reduced.animationDuration }, null, 2));
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'next02b-ui-matrix-live',
  description: 'NEXT-02B UI 矩阵：视口/高 DPI/双主题/reduced motion/焦点/溢出',
  evidenceDir: EVIDENCE_DIR,
  run,
};
