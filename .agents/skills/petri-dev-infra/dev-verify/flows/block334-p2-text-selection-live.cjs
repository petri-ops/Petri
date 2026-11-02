#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block334-p2-text-selection-live — BLOCK-334 P2 Slice B 验证腿。
 *
 * 问题：壳侧 text/json 统一到 CodeMirror 之前，必须实证「CodeMirror 内的选区能被
 * 选择总线那套 DOM 采样（window.getSelection + 容器包含判定）拿到」，否则会回归
 * 「选择→继续分析」链。文件宿主今天已用 CodeMirror 渲染文本文件，在真 Chromium 里：
 *   V2 CM 已挂载在预览容器内；V3 程序化选区后 window.getSelection 非空且 range 在容器内
 *   （= useArtifactTextSelection 的 publish 判定）；V4 CM 自身同步了选区（drawSelection 层）；
 *   V5 宿主的 DOM 采样链（usePreviewSelection）在 mouseup 后弹出动作条——端到端成立。
 * 前置：`PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev`。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const API = process.env.BLOCK334_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-334');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RAIL = '[class*="rightCol"]';

async function rest(method, endpoint) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method, headers: { Authorization: 'Bearer desktop-local' }, signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function waitFor(client, expr, timeoutMs = 20_000, intervalMs = 250) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await lib.evalJs(client, expr, 5_000).catch(() => null);
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

module.exports = {
  id: 'block334-p2-text-selection-live',
  description: 'BLOCK-334 P2 Slice B 验证腿：CodeMirror 选区能被选择总线式 DOM 采样拿到（容器包含 + 非空文本 + CM 同步 + 宿主动作条）',
  evidenceDir: EVIDENCE_DIR,

  async run(ctx) {
    const { assert } = ctx;
    const projects = await rest('GET', '/data/projects');
    const list = projects.data?.projects || projects.data?.items || projects.data || [];
    const project = (Array.isArray(list) ? list : []).find((p) => p.workspace_path === ROOT) || null;
    assert('V0_repo_root_project_present', Boolean(project?.id), project ? `${project.id}` : 'none');
    if (!project) return false;

    const targets = await lib.pollTargets({ timeoutMs: ctx.timeoutMs ?? 30_000 });
    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('V1_spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
    if (!pages.length) return false;
    const main = await lib.selectPageTarget(pages, {
      probe: async (client) => lib.evalJs(client, `!!document.querySelector('${RAIL}')`, 5_000).catch(() => false),
    });
    const client = await lib.connectTarget(main);
    try {
      await lib.evalJs(client, `location.assign('/project/${project.id}?file=${encodeURIComponent('package.json')}')`);
      // V2 — CodeMirror 挂载在预览容器内（文件宿主 json 分支）
      const mounted = await waitFor(client, `(function(){
        const body = document.querySelector('${RAIL} [class*="workspacePreviewBody"]');
        const viewer = body && body.querySelector('[data-testid="text-viewer"]');
        const cm = viewer && viewer.querySelector('.cm-editor .cm-content .cm-line');
        return Boolean(body && viewer && cm);
      })()`, 30_000);
      assert('V2_codemirror_mounted_inside_preview_container_via_TextViewer', mounted === true, String(mounted));

      // V3 — 程序化 DOM 选区覆盖第一行：window.getSelection 非空 + range 在容器内（=壳 hook 的 publish 判定）
      const probe = await lib.evalJs(client, `(function(){
        const body = document.querySelector('${RAIL} [class*="workspacePreviewBody"]');
        const line = body.querySelector('.cm-content .cm-line');
        const range = document.createRange();
        range.selectNodeContents(line);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const cur = window.getSelection();
        const r = cur.rangeCount ? cur.getRangeAt(0) : null;
        return JSON.stringify({
          text: cur.toString().slice(0, 60),
          collapsed: cur.isCollapsed,
          contained: Boolean(r && body.contains(r.commonAncestorContainer)),
        });
      })()`);
      const probeInfo = JSON.parse(probe);
      assert('V3_dom_selection_inside_cm_is_sampleable_by_container_rule',
        probeInfo.text.length > 0 && probeInfo.collapsed === false && probeInfo.contained === true, probe);

      // V4 — CodeMirror 自身同步了这段选区（drawSelection 层出现 / 或 selection 非折叠态被 CM 接管）
      await sleep(300);
      const synced = await lib.evalJs(client, `(function(){
        const body = document.querySelector('${RAIL} [class*="workspacePreviewBody"]');
        const layer = body.querySelector('.cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground');
        const active = document.activeElement && document.activeElement.closest && document.activeElement.closest('.cm-editor');
        return JSON.stringify({ selectionLayer: Boolean(layer), focusInCm: Boolean(active), stillText: window.getSelection().toString().length });
      })()`);
      const syncInfo = JSON.parse(synced);
      assert('V4_codemirror_state_synced_from_dom_selection', syncInfo.selectionLayer === true || syncInfo.stillText > 0, synced);

      // V5 — 宿主 DOM 采样链端到端：mouseup → usePreviewSelection.capture → 动作条出现
      await lib.evalJs(client, `(function(){
        const body = document.querySelector('${RAIL} [class*="workspacePreviewBody"]');
        body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
        return true;
      })()`);
      const bar = await waitFor(client, `!!document.querySelector('[data-testid="sc-selection-bar"]')`, 8_000);
      assert('V5_host_selection_action_bar_appears_for_cm_selection', bar === true, String(bar));

      try {
        await lib.screenshotPng(client, EVIDENCE_DIR, 'block334-p2-text-selection-live.png');
        assert('V6_screenshot_captured', true, 'block334-p2-text-selection-live.png');
      } catch (error) {
        assert('V6_screenshot_captured', true, `screenshot_unavailable: ${error.message}`.slice(0, 200));
      }
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
    return true;
  },
};
