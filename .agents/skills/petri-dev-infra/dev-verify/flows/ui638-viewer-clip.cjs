#!/usr/bin/env node
'use strict';

/**
 * UI-638 点开腿复验（修复后）——两条缺陷的实机回归：
 *
 *   ① model3d 产物 url 投影：artifacts[] 必须带工作区读面 url
 *      （/api/workspaces/:projectId/file?path=），且该 url 字节 sha256 与导出
 *      manifest 一致；旧回落 /api/tools/file/<job>/<name> 对 model3d 产物 404。
 *   ② Result Studio 3D viewer 尺寸自反馈：宿主 absolute-fill 后 canvas 随面板
 *      伸缩——面板被底部终端压缩时 canvas 跟着变矮、不再被上层 overflow:hidden
 *      裁掉（修复前 canvas 恒 420px：面板 312 → 裁 109px、392 → 29px）。
 *
 * 证据：acceptance/ui-638-viewer-clip/ui638-viewer-clip-live.json（runner 落盘）
 * + tall/compressed 截图。9223 离屏实例，不触碰用户主窗；跑完由调用方立即终止。
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.UI638_API || 'http://127.0.0.1:3001';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rest(method, endpoint, body) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: {
      Authorization: 'Bearer desktop-local',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(240_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function fetchBytes(url) {
  const response = await fetch(`${API}${url}`, {
    headers: { Authorization: 'Bearer desktop-local' },
    signal: AbortSignal.timeout(60_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, buffer };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function boxScene() {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    name: 'UI638 viewer probe',
    parameters: {},
    nodes: [{
      id: 'enclosure',
      type: 'box',
      name: 'Enclosure',
      dimensions: { width: 120, depth: 80, height: 40 },
      transform: { position: [0, 0, 0] },
      material: { color: '#6a8caf', roughness: 0.4 },
    }],
  };
}

const MEASURE = `(() => {
  const surface = document.querySelector('[data-testid="model3d-result-viewer-surface"]');
  const scene = document.querySelector('[data-testid="model3d-scene"]');
  const canvas = document.querySelector('[data-testid="model3d-canvas"]');
  if (!surface || !scene || !canvas) return JSON.stringify({ found: false });
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }; };
  const s = r(surface);
  const cv = r(canvas);
  const panel = surface.closest('[class*="resultSidebarPreviewBody"]') || surface.parentElement.parentElement;
  const pv = r(panel);
  return JSON.stringify({
    found: true,
    panelHeight: pv.height,
    surfaceHeight: s.height,
    hostHeight: Math.round(scene.getBoundingClientRect().height),
    canvasCssHeight: cv.height,
    canvasBitmapHeight: canvas.height,
    hostPosition: getComputedStyle(scene).position,
    hiddenBelowPanelPx: Math.max(0, cv.bottom - pv.bottom),
    canvasFullyInside: cv.bottom <= pv.bottom,
    canvasFillsSurface: Math.abs(cv.height - s.height) <= 2,
    viewerFillsPanel: Math.abs(Math.round(scene.closest('[data-testid="model3d-result-viewer-surface"]').parentElement.getBoundingClientRect().height) - pv.height) <= 2,
    stats: (document.body.innerText.match(/对象\\s*\\d+\\s*·\\s*bounds[^\\n]*/) || [''])[0],
    fallbackVisible: /3D 预览不可用/.test(document.body.innerText)
  });
})()`;

async function clickByText(client, text) {
  return lib.evalJs(client, `(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}));
    if (!btn) return 'not_found';
    btn.click();
    return 'clicked';
  })()`, 15_000);
}

async function clickArtifact(client, name) {
  return lib.evalJs(client, `(() => {
    const span = [...document.querySelectorAll('span')].find((e) => (e.textContent || '').trim() === ${JSON.stringify(name)});
    if (!span) return 'not_found';
    let node = span;
    for (let i = 0; i < 8 && node; i++) {
      if (node.tagName === 'BUTTON') { node.click(); return 'clicked'; }
      node = node.parentElement;
    }
    span.click();
    return 'clicked_span';
  })()`, 15_000);
}

async function dragTerminalToMax(client) {
  return lib.evalJs(client, `(() => {
    const splitter = document.querySelector('[class*="embeddedTerminalResize"]');
    if (!splitter) return 'no_splitter';
    const rect = splitter.getBoundingClientRect();
    const y0 = Math.round(rect.top + rect.height / 2);
    const x = Math.round(rect.left + rect.width / 2);
    splitter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y0, buttons: 1 }));
    for (const step of [0.25, 0.5, 0.75, 1]) {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: Math.round(y0 - 420 * step), buttons: 1 }));
    }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y0 - 420 }));
    return 'dragged';
  })()`, 15_000);
}

module.exports = {
  id: 'ui638-viewer-clip',
  description: 'UI-638 点开腿：model3d 产物 url 投影（工作区读面 200 + sha 对账）+ 3D viewer 宿主 absolute-fill 尺寸随面板伸缩',
  evidenceDir: path.join(ROOT, 'acceptance', 'ui-638-viewer-clip'),

  async run(ctx) {
    const { assert } = ctx;
    const detail = {};
    let projectId = null;
    const client = await lib.connectTestTarget({ timeoutMs: 30_000 });
    try {
      // ===== 前置：Blender 可用（真实导出链） =====
      const capability = await rest('GET', '/model3d/capability');
      assert('capability_ready', capability.status === 200 && capability.data?.status === 'ready',
        JSON.stringify(capability.data).slice(0, 160));

      // ===== 种子：临时项目 + 真实 Blender 导出 glb =====
      const project = await rest('POST', '/data/projects', { name: `UI638-Viewer-${Date.now()}` });
      projectId = project.data?.project?.id || null;
      assert('project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 160));

      const exportV1 = await rest('POST', '/model3d/scene/export', {
        projectId,
        scene: boxScene(),
        scenePath: 'model3d/recipes/ui638-viewer.scene3d.json',
        formats: ['glb'],
        recipeId: 'ui638-viewer-probe',
        recipeVersion: 1,
      });
      const rs = exportV1.data?.resultStudio || {};
      assert('export_registered', exportV1.status === 200 && rs.registered === true && Boolean(rs.toolJobId),
        JSON.stringify(rs).slice(0, 240));
      const glbRevision = (rs.revisions || []).find((r) => r.artifactId.endsWith(':glb')) || null;
      const manifestPath = path.join(
        String(exportV1.data?.outDir || ''),
        'manifest.json',
      );
      const workspacePath = project.data?.project?.workspace_path || '';
      const manifest = fs.existsSync(path.join(workspacePath, manifestPath))
        ? JSON.parse(fs.readFileSync(path.join(workspacePath, manifestPath), 'utf8'))
        : null;
      const glbManifestHash = (manifest?.outputs || []).find((o) => String(o.path).endsWith('.glb'))?.sha256 || null;

      // ===== 缺陷①：artifacts 投影带工作区 url，且字节可读 + sha 对账 =====
      const status = await rest('GET', `/tools/status/${encodeURIComponent(rs.toolJobId)}`);
      const artifacts = status.data?.result?.artifacts || [];
      const glbArtifact = artifacts.find((a) => a.name === 'scene.glb') || null;
      assert('artifact_projected_with_name', Boolean(glbArtifact), JSON.stringify(artifacts.map((a) => a.name)));
      assert('artifact_url_workspace_route',
        Boolean(glbArtifact?.url) && String(glbArtifact.url).startsWith(`/api/workspaces/${projectId}/file?path=`)
          && String(glbArtifact.url).includes(encodeURIComponent('model3d/runs/')),
        String(glbArtifact?.url || 'none'));
      const served = glbArtifact?.url ? await fetchBytes(glbArtifact.url) : { status: 0, buffer: Buffer.alloc(0) };
      assert('artifact_url_serves_bytes', served.status === 200 && served.buffer.length > 0,
        `status=${served.status} bytes=${served.buffer.length}`);
      assert('artifact_bytes_match_manifest_hash',
        glbManifestHash !== null && sha256(served.buffer) === glbManifestHash,
        `manifestHash=${glbManifestHash} servedHash=${sha256(served.buffer)}`);
      detail.projection = { toolJobId: rs.toolJobId, glbUrl: glbArtifact?.url || null, bytes: served.buffer.length };

      // ===== UI：结果面打开 scene.glb（真实点击链） =====
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/${projectId}/result`)}, 'nav'`, 15_000).catch(() => null);
      await sleep(5000);
      const jobClicked = await clickByText(client, 'model3d_export');
      assert('job_card_clicked', jobClicked === 'clicked', jobClicked);
      await sleep(3000);
      const artifactClicked = await clickArtifact(client, 'scene.glb');
      assert('scene_glb_selected', artifactClicked !== 'not_found', artifactClicked);

      // 模型真实加载（GLTF onReady 才有「对象 N · bounds …」行）
      let loaded = null;
      for (let i = 0; i < 20; i += 1) {
        await sleep(1000);
        const raw = JSON.parse(await lib.evalJs(client, MEASURE, 15_000));
        if (raw.found && /对象\s*\d+/.test(raw.stats || '')) { loaded = raw; break; }
        if (raw.found && raw.fallbackVisible) { loaded = raw; break; }
      }
      assert('viewer_mounted', Boolean(loaded?.found), JSON.stringify(loaded || {}).slice(0, 200));
      assert('glb_loaded_no_fallback', Boolean(loaded) && loaded.fallbackVisible === false && /对象\s*\d+/.test(loaded.stats || ''),
        `fallback=${loaded?.fallbackVisible} stats=${loaded?.stats}`);

      // 隐藏窗 Page.captureScreenshot 不合成 WebGL 面、帧外 readPixels 也读不到
      // （实机抓真：帧内采样 maxAlpha=256，帧外恒 0）——在 draw 调用内采样，
      // 直接证明 renderer 真的画出了不透明像素。
      await lib.evalJs(client, `(() => {
        window.__ui638RenderProbe = { maxAlpha: 0, samples: 0 };
        for (const name of ['WebGL2RenderingContext', 'WebGLRenderingContext']) {
          const P = window[name] && window[name].prototype;
          if (!P || P.__ui638Patched) continue;
          P.__ui638Patched = true;
          for (const fn of ['drawArrays', 'drawElements']) {
            const orig = P[fn];
            P[fn] = function (...args) {
              const res = orig.apply(this, args);
              try {
                if (window.__ui638RenderProbe.samples < 400) {
                  const gl = this;
                  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
                  const px = new Uint8Array(4 * 16 * 16);
                  gl.readPixels(Math.max(0, (w >> 1) - 8), Math.max(0, (h >> 1) - 8), 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, px);
                  let a = 0;
                  for (let i = 3; i < px.length; i += 4) if (px[i] > 8) a += 1;
                  if (a > window.__ui638RenderProbe.maxAlpha) window.__ui638RenderProbe.maxAlpha = a;
                  window.__ui638RenderProbe.samples += 1;
                }
              } catch (error) { window.__ui638RenderProbe.error = String(error && error.message || error); }
              return res;
            };
          }
        }
        return 'patched';
      })()`, 15_000);
      await sleep(1500);
      const pixels = JSON.parse(await lib.evalJs(client, 'JSON.stringify(window.__ui638RenderProbe || {})', 15_000));
      assert('render_draws_pixels', pixels.samples > 0 && pixels.maxAlpha > 0,
        `samples=${pixels.samples} maxAlpha=${pixels.maxAlpha} ${pixels.error || ''}`);
      detail.renderProbe = pixels;

      // ===== 缺陷②：宿主 absolute-fill + canvas 随面板伸缩 =====
      assert('host_absolute_fill', loaded.hostPosition === 'absolute', `position=${loaded.hostPosition}`);
      assert('canvas_fills_surface_tall', loaded.canvasFillsSurface === true,
        `surface=${loaded.surfaceHeight} canvas=${loaded.canvasCssHeight}`);
      assert('viewer_fills_panel_tall', loaded.viewerFillsPanel === true,
        `panel=${loaded.panelHeight} surface=${loaded.surfaceHeight}`);
      detail.tall = loaded;
      await lib.screenshotPng(client, path.join(ROOT, 'acceptance', 'ui-638-viewer-clip'), 'viewer-tall.png');

      const opened = await lib.evalJs(client, `(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === '展开底部终端');
        if (!btn) return 'terminal_already_open_or_missing';
        btn.click();
        return 'opened';
      })()`, 15_000);
      await sleep(2000);
      const dragged = await dragTerminalToMax(client);
      assert('terminal_drag_applied', dragged === 'dragged', `${opened} / ${dragged}`);
      await sleep(2500);

      const compressed = JSON.parse(await lib.evalJs(client, MEASURE, 15_000));
      assert('panel_shrank', compressed.panelHeight < loaded.panelHeight - 100,
        `tall=${loaded.panelHeight} compressed=${compressed.panelHeight}`);
      assert('canvas_follows_panel', compressed.canvasCssHeight < loaded.canvasCssHeight - 50,
        `tallCanvas=${loaded.canvasCssHeight} compressedCanvas=${compressed.canvasCssHeight}`);
      assert('canvas_fills_surface_compressed', compressed.canvasFillsSurface === true,
        `surface=${compressed.surfaceHeight} canvas=${compressed.canvasCssHeight}`);
      assert('no_clip_when_panel_below_448', compressed.hiddenBelowPanelPx === 0 && compressed.canvasFullyInside === true,
        `panel=${compressed.panelHeight} hidden=${compressed.hiddenBelowPanelPx}px`);
      detail.compressed = compressed;
      await lib.screenshotPng(client, path.join(ROOT, 'acceptance', 'ui-638-viewer-clip'), 'viewer-compressed.png');

      return true;
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
      if (projectId) {
        await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
      }
    }
  },
};
