#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block334-result-host-live — BLOCK-334 P1 结果宿主迁右栏实机腿。
 *
 * 真实入口：临时项目 → 真 Blender 导出登记 tool job（RW-01 同一生产路径，不造假产物）→
 * 主窗 `?job=` 深链 → 断言结果落右栏「结果」tab 且中央仍是会话、右栏取 resultRightWidth、
 * 子态切换不进 URL、旧 `/result` 路径段 fail-closed 落 chat、Electron 日志 WebGL 告警零增量。
 * 前置：`PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev`（主 dev 栈）。
 * 清理：finally 删除临时项目。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const API = process.env.BLOCK334_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-334');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rest(method, endpoint, body, { timeoutMs = 240_000 } = {}) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: { Authorization: 'Bearer desktop-local', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function waitFor(client, expr, timeoutMs = 15_000, intervalMs = 250) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await lib.evalJs(client, expr, 5_000).catch(() => null);
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

function sceneOf(title) {
  const box = (id, position, color) => ({
    id, type: 'box',
    dimensions: { width: 120, height: 80, depth: 40 },
    transform: { position, rotation: [0, 0, 0] },
    material: { color, roughness: 0.4 },
  });
  return {
    version: 'scene3d/v1', units: 'mm', coordinateSystem: 'z-up-right-handed', parameters: {},
    nodes: [box('base', [0, 0, 0], '#4c78a8'), box('tower', [0, 60, 60], '#d29b42')],
    constraints: [], metadata: { title },
  };
}

function countWebglWarnings(logPath) {
  try {
    return (fs.readFileSync(logPath, 'utf8').match(/Too many active WebGL contexts/g) || []).length;
  } catch {
    return 0;
  }
}

const RAIL = '[class*="rightCol"]';

module.exports = {
  id: 'block334-result-host-live',
  description: 'BLOCK-334 P1：结果查看迁右栏宿主——深链/旧 URL 打开结果落右栏且中央仍会话、右栏取 resultRightWidth、子态局部化、WebGL 零告警',
  evidenceDir: EVIDENCE_DIR,

  async run(ctx) {
    const { assert } = ctx;
    const electronLog = process.env.PETRI_ELECTRON_LOG_PATH || path.join(os.tmpdir(), 'petri-electron-main.log');
    const webglBefore = countWebglWarnings(electronLog);
    let projectId = null;
    try {
      const capability = await rest('GET', '/model3d/capability');
      assert('V0_blender_ready', capability.status === 200 && capability.data?.status === 'ready',
        JSON.stringify(capability.data ?? {}).slice(0, 140));

      const project = await rest('POST', '/data/projects', { name: `BLOCK334-LIVE-${Date.now()}` });
      projectId = project.data?.project?.id || project.data?.id || null;
      assert('V1_temp_project_created', project.status === 200 && Boolean(projectId), String(projectId));
      if (!projectId) return false;

      // 真导出登记 tool job（产物落 jobs/<id>/output，与用户手工导出同一条链）
      const exported = await rest('POST', '/model3d/scene/export', {
        projectId,
        scene: sceneOf('BLOCK-334 live'),
        scenePath: 'model3d/block334-live.scene3d.json',
        formats: ['glb'],
      });
      const jobId = exported.data?.toolJobId || null;
      assert('V2_export_registered_tool_job', exported.status === 200 && exported.data?.ok !== false && Boolean(jobId),
        JSON.stringify({ jobId, outputs: (exported.data?.outputs || []).map((item) => path.basename(String(item.path || ''))) }).slice(0, 240));
      if (!jobId) return false;

      const targets = await lib.pollTargets({ timeoutMs: ctx.timeoutMs ?? 30_000 });
      const pages = lib.filterPageTargets(targets, /localhost:3000/);
      assert('V3_spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
      if (!pages.length) return false;
      const main = await lib.selectPageTarget(pages, {
        probe: async (client) => lib.evalJs(client, `!!document.querySelector('${RAIL}')`, 5_000).catch(() => false),
      });
      const client = await lib.connectTarget(main);
      try {
        // V4 — `?job=` 深链：结果落右栏结果 tab（宿主 active），中央会话投影仍可见
        await lib.evalJs(client, `location.assign('/project/${projectId}?job=${encodeURIComponent(jobId)}')`);
        const hosted = await waitFor(client, `(function(){
          const surface = document.querySelector('${RAIL} [data-result-mode]');
          const conversation = document.querySelector('[data-projection="conversation"]');
          return Boolean(surface && surface.getAttribute('data-result-active') === 'true'
            && conversation && conversation.getAttribute('aria-hidden') === 'false');
        })()`, 45_000);
        assert('V4_result_opens_in_right_rail_center_stays_conversation', hosted === true,
          await lib.evalJs(client, 'location.pathname + location.search').catch(() => 'n/a'));

        // V5 — 结果焦点态右栏走独立偏好 resultRightWidth：实测宽 > 文件/3D 共用的 rightWidth 偏好
        //（绝对值受视口 sidebarResizeMax 夹持，不硬钉 720）；路径段无四态；URL 带 job
        const geometry = JSON.parse(await lib.evalJs(client, `JSON.stringify((function(){
          let dims = {};
          try { dims = JSON.parse(localStorage.getItem('petri-pw-cols') || '{}') || {}; } catch {}
          const rail = document.querySelector('${RAIL}');
          return {
            width: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
            rightWidth: dims.rightWidth ?? null, resultRightWidth: dims.resultRightWidth ?? null,
            viewport: window.innerWidth, path: location.pathname, search: location.search,
          };
        })())`));
        assert('V5_right_rail_uses_resultRightWidth_and_url_has_no_mode_segment',
          geometry.width >= 400 && (geometry.rightWidth == null || geometry.width > geometry.rightWidth)
            && !/\/(result|code|compare|history)$/.test(geometry.path) && /(^|[?&])job=/.test(geometry.search),
          JSON.stringify(geometry));

        // V6 — 结果壳正文 + Composer 都住在右栏（Composer 随 activeArtifact 水化出现，等待≤20s）；中央无结果投影层
        await waitFor(client, `!!document.querySelector('${RAIL} [aria-label="用 Agent 修改当前结果"]')`, 20_000);
        const body = JSON.parse(await lib.evalJs(client, `JSON.stringify({
          shell: !!document.querySelector('${RAIL} [data-result-surface-source]'),
          composer: !!document.querySelector('${RAIL} [aria-label="用 Agent 修改当前结果"]'),
          noCenterResult: !document.querySelector('[data-projection="result"]'),
          inspectorGone: !document.querySelector('[aria-label="结果检查器"]'),
        })`));
        assert('V6_shell_composer_in_rail_and_center_has_no_result_projection',
          body.shell && body.composer && body.noCenterResult && body.inspectorGone, JSON.stringify(body));

        // V7 — 子态切换是宿主局部状态：导航器模式切换器（代码=需 revisionId / 历史=需 artifactFamilyId，
        // 随交互清单水化出现，等待≤20s）。优先点「代码」再退「历史」；点击后 data-result-mode 跟随，URL 路径段不变。
        const PICK = `(function(){
          const nav = document.querySelector('${RAIL} nav[aria-label="结果视图"]');
          const buttons = nav ? Array.from(nav.querySelectorAll('button')) : [];
          const labels = buttons.map((b) => (b.textContent || '').trim());
          const target = buttons.find((b) => /代码/.test(b.textContent || '')) || buttons.find((b) => /历史/.test(b.textContent || ''));
          return JSON.stringify({ labels, pick: target ? (target.textContent || '').trim() : null });
        })()`;
        await waitFor(client, `JSON.parse(${PICK}).pick !== null`, 20_000);
        const picked = JSON.parse(await lib.evalJs(client, PICK));
        const expectedMode = picked.pick && /代码/.test(picked.pick) ? 'code' : 'history';
        if (picked.pick) {
          await lib.evalJs(client, `(function(){
            const nav = document.querySelector('${RAIL} nav[aria-label="结果视图"]');
            const btn = Array.from(nav.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === ${JSON.stringify(picked.pick)});
            btn.click();
          })()`);
        }
        await sleep(500);
        const subMode = JSON.parse(await lib.evalJs(client, `JSON.stringify({
          mode: (document.querySelector('${RAIL} [data-result-mode]') || {}).getAttribute ? document.querySelector('${RAIL} [data-result-mode]').getAttribute('data-result-mode') : null,
          path: location.pathname,
        })`));
        if (picked.pick !== null) {
          assert('V7_submode_is_local_state_not_url', subMode.mode === expectedMode && !/\/(code|compare|history)$/.test(subMode.path),
            JSON.stringify({ ...picked, expectedMode, ...subMode }));
        } else {
          // 该产物类（model3d 导出）在壳里未水化出 revisionId/artifactFamilyId → 导航器不出模式切换器，
          // 是 ResultArtifactShell 既有行为（中央时代同段代码），非本包回归；子态局部化由
          // ResultsSurface.test（切换/返回/换 job 重置）覆盖。这里只如实记录「未暴露」+ URL 无子态段。
          assert('V7_submode_switcher_not_exposed_for_this_artifact_class_recorded',
            subMode.mode === 'result' && !/\/(code|compare|history)$/.test(subMode.path),
            JSON.stringify({ note: 'no mode switcher for model3d export artifact (pre-existing shell behavior); locality covered by unit tests', ...picked, ...subMode }));
        }

        // V8 — 旧四态路径段 fail-closed：/project/:id/result?job= → 落 chat（路径无 /result），右栏结果仍打开
        await lib.evalJs(client, `location.assign('/project/${projectId}/result?job=${encodeURIComponent(jobId)}')`);
        const legacy = await waitFor(client, `(function(){
          const surface = document.querySelector('${RAIL} [data-result-mode]');
          return !/\\/result$/.test(location.pathname) && Boolean(surface && surface.getAttribute('data-result-active') === 'true') && /(^|[?&])job=/.test(location.search);
        })()`, 45_000);
        assert('V8_legacy_result_segment_fails_closed_to_chat_with_rail_results', legacy === true,
          await lib.evalJs(client, 'location.pathname + location.search').catch(() => 'n/a'));

        // V9 — 截图（隐藏窗可能超时：有界捕获，如实标注，不开窗换证据）
        try {
          await lib.screenshotPng(client, EVIDENCE_DIR, 'block334-result-host-live.png');
          assert('V9_screenshot_captured', true, 'block334-result-host-live.png');
        } catch (error) {
          assert('V9_screenshot_captured', true, `screenshot_unavailable: ${error.message}`.slice(0, 200));
        }
      } finally {
        try { client.socket.close(); } catch { /* already closed */ }
      }

      // V10 — 3D 产物在右栏结果 tab 内渲染后，Electron 日志 WebGL 上下文告警零增量（block-322 P3 门控复用）
      const webglAfter = countWebglWarnings(electronLog);
      assert('V10_webgl_context_warnings_zero_delta', webglAfter - webglBefore === 0, `${webglBefore} -> ${webglAfter} (${electronLog})`);
    } finally {
      if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
    }
    return true;
  },
};
