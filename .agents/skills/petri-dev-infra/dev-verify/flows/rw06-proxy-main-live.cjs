#!/usr/bin/env node
'use strict';

/**
 * RW-06 c 档代行评估 Phase A（主栈 :3001 面）——用户裁决「你能直接帮我搞定吗」=
 * UI-496~509 代行评估先例（同问句同处置）复用：真栈 + CDP 真界面驱动 + DOM/几何证据。
 *
 * 断言：
 *   A1 UI-443：非法项目路由 → 错误边界兜底（非白屏）
 *   A2 UI-445：会话标题搜索跨项目命中（双项目种子 + 唯一 token）
 *   A3 UI-638 点开腿：指挥中心瓦片内层下钻按钮 → 实例内主窗（隐藏）结果视图
 *      内嵌 3D viewer 挂载（9223 CDP 可见，不触碰 9222 用户主窗——下钻事件是
 *      实例内行为，探针全程留在 9223 侧）
 *
 * 证据：acceptance/rw-06-hygiene/rw06-proxy-main-live.json（runner 落盘）
 */

const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.RW06_API || 'http://127.0.0.1:3001';

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

function boxScene(height) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    name: 'RW06 proxy probe',
    parameters: {},
    nodes: [{
      id: 'enclosure',
      type: 'box',
      name: 'Enclosure',
      dimensions: { width: 100, depth: 70, height },
      transform: { position: [0, 0, 0] },
      material: { color: '#6a8caf', roughness: 0.4 },
    }],
  };
}

module.exports = {
  id: 'rw06-proxy-main-live',
  description: 'RW-06 c 档代行评估 Phase A：UI-443 错误边界 / UI-445 跨项目搜索 / UI-638 点开腿（主窗只读断言）',
  evidenceDir: path.join(ROOT, 'acceptance', 'rw-06-hygiene'),

  async run(ctx) {
    const { assert } = ctx;
    const client = await lib.connectTestTarget({ timeoutMs: 30_000 });
    const seededProjects = [];
    try {
      // ===== A1 UI-443：非法项目路由 → 错误边界 =====
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/rw06-nonexistent-proj`)}, 'nav'`).catch(() => null);
      await sleep(3000);
      const err443 = await lib.evalJs(client, `(function(){
        var text = document.body.innerText || '';
        return JSON.stringify({
          blank: text.trim().length < 10,
          boundaryHint: /出错|错误|重试|刷新|加载失败|不存在/.test(text),
          snippet: text.slice(0, 160),
        });
      })()`).catch(() => '"eval_error"');
      try {
        const parsed = JSON.parse(err443);
        // 诚实口径：非法路由必须有兜底 UI（错误卡或「不存在」提示），不得白屏
        assert('a1_ui443_error_boundary', parsed.boundaryHint === true && parsed.blank === false,
          `err443=${JSON.stringify(parsed).slice(0, 260)}`);
      } catch (e) {
        assert('a1_ui443_error_boundary', false, String(err443).slice(0, 200));
      }

      // ===== A2 UI-445：跨项目会话搜索 =====
      const token = `rw06xsearch${Date.now().toString(36)}`;
      const projA = await rest('POST', '/data/projects', { name: `RW06-A-${Date.now()}` });
      const projB = await rest('POST', '/data/projects', { name: `RW06-B-${Date.now()}` });
      const idA = projA.data?.project?.id || null;
      const idB = projB.data?.project?.id || null;
      if (idA) seededProjects.push(idA);
      if (idB) seededProjects.push(idB);
      assert('a2_projects_seeded', Boolean(idA && idB), `a=${idA} b=${idB}`);
      // 项目 B 建带唯一 token 标题的会话
      const conv = await fetch(`${API}/api/ai/conversations`, {
        method: 'POST',
        headers: { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `跨项目探针 ${token}`, projectId: idB }),
        signal: AbortSignal.timeout(15_000),
      }).then((r) => r.json()).catch(() => null);
      assert('a2_conv_b_seeded', conv?.status === 'ok', JSON.stringify(conv).slice(0, 160));

      // 打开项目 A → 点搜索按钮（title=搜索会话标题）→ 输入 token → 断言结果含项目 B 会话
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/${idA}`)}, 'nav'`).catch(() => null);
      await sleep(3500);
      await lib.evalJs(client, `(function(){
        var btn = document.querySelector('button[title="搜索会话标题"]');
        if (btn) btn.click();
        return 'ok';
      })()`).catch(() => null);
      await sleep(500);
      await lib.evalJs(client, `(function(){
        var input = document.querySelector('input[aria-label="搜索会话标题"]');
        if (!input) return 'input_missing';
        input.focus();
        document.execCommand('insertText', false, ${JSON.stringify(token)});
        return 'typed';
      })()`).catch(() => null);
      await sleep(1200);
      const search445 = await lib.evalJs(client, `(function(){
        var text = document.body.innerText || '';
        var hits = Array.prototype.slice.call(document.querySelectorAll('[class*="searchResult"], [class*="convItem"]'));
        return JSON.stringify({
          tokenVisible: text.indexOf(${JSON.stringify(token)}) >= 0,
          hitCount: hits.filter(function (el) { return (el.innerText || '').indexOf(${JSON.stringify(token)}) >= 0; }).length,
        });
      })()`).catch(() => '"eval_error"');
      try {
        const parsed = JSON.parse(search445);
        assert('a2_ui445_cross_project_search', parsed.tokenVisible === true && parsed.hitCount > 0,
          `search=${JSON.stringify(parsed)}`);
      } catch (e) {
        assert('a2_ui445_cross_project_search', false, String(search445).slice(0, 200));
      }

      // ===== A3 UI-638 点开腿：瓦片点击 → 主窗 3D viewer =====
      const sceneApply = await rest('POST', '/model3d/scene/apply', {
        projectId: idA,
        path: 'model3d/recipes/rw06-proxy.scene3d.json',
        scene: boxScene(42),
        operations: [{ op: 'set_metadata', metadata: { seededBy: 'rw06-proxy' } }],
        reason: 'rw06_proxy_seed',
      });
      const sceneRead = await rest('POST', '/model3d/scene/read', { projectId: idA, path: 'model3d/recipes/rw06-proxy.scene3d.json' });
      const export638 = await rest('POST', '/model3d/scene/export', {
        projectId: idA,
        scene: sceneRead.data?.scene,
        scenePath: 'model3d/recipes/rw06-proxy.scene3d.json',
        formats: ['glb'],
        recipeId: 'rw06-proxy',
        recipeVersion: 1,
      });
      assert('a3_export_registered', export638.status === 200 && export638.data?.resultStudio?.registered === true,
        JSON.stringify(export638.data?.resultStudio || export638.data || null).slice(0, 220));

      // 刷新项目 A → 指挥中心 → 点 model3d 瓦片（应用自身行为：openResultInMainWindow）
      await lib.evalJs(client, `location.reload(), 'reload'`).catch(() => null);
      await sleep(3500);
      await lib.evalJs(client, `(function(){
        var targets = Array.prototype.slice.call(document.querySelectorAll('button, [role="tab"], [class*="panelCard"]'));
        var card = targets.find(function (el) { return (el.innerText || '').indexOf('指挥中心') >= 0; });
        if (card) card.click();
        return 'ok';
      })()`).catch(() => null);
      await sleep(2000);
      // 精确点内层下钻按钮（handleDrill 绑定处；外层 div 点击不冒泡到 handler）
      const pick = await lib.evalJs(client, `(function(){
        var btns = Array.prototype.slice.call(document.querySelectorAll('button[title="点击下钻到结果独立窗"]'));
        var btn = btns.find(function (el) { return (el.innerText || '').indexOf('model3d_export') >= 0; })
          || (btns.length === 1 ? btns[0] : null);
        if (!btn) return JSON.stringify({ found: false, total: btns.length });
        btn.click();
        return 'picked';
      })()`).catch(() => '"eval_error"');
      // 下钻转发「实例内主窗」打开结果（9223 实例自己的主窗，show:false 但 CDP 可见）
      // → 轮询 9223 targets 新 page 上的 viewer 挂载
      let viewerOnMain = null;
      for (let i = 0; i < 10 && !viewerOnMain; i += 1) {
        await sleep(1500);
        try {
          const targets = await lib.pollTargets({ port: 9223, timeoutMs: 5000 });
          const pages = lib.filterPageTargets(targets, /localhost:3000/);
          for (const page of pages) {
            let c = null;
            try {
              c = await lib.connectTarget(page);
              const r = await lib.evalJs(c, `(function(){
                var viewer = document.querySelector('[data-testid="model3d-result-viewer-surface"]');
                var canvas = document.querySelector('[data-testid="model3d-canvas"], canvas');
                return JSON.stringify({
                  viewerMounted: !!viewer,
                  hasCanvas: !!canvas,
                  url: location.pathname,
                });
              })()`, 8000);
              const parsed = JSON.parse(r);
              if (parsed.viewerMounted === true) { viewerOnMain = r; break; }
            } catch { /* 该 page 非 target */ } finally { if (c) { try { c.socket.close(); } catch {} } }
          }
        } catch { /* 轮询重试 */ }
      }
      try {
        const parsed = JSON.parse(viewerOnMain || '{}');
        assert('a3_ui638_viewer_on_main', parsed.viewerMounted === true,
          `pick=${String(pick).slice(0, 60)} main=${JSON.stringify(parsed).slice(0, 240)}`);
      } catch (e) {
        assert('a3_ui638_viewer_on_main', false, `pick=${String(pick).slice(0, 60)} last=${String(viewerOnMain).slice(0, 200)}`);
      }

      return true;
    } finally {
      try { client.socket.close(); } catch { /* closed */ }
      // 种子清理（临时项目连带会话/产物）
      for (const pid of seededProjects) {
        await fetch(`${API}/api/data/projects/${encodeURIComponent(pid)}`, {
          method: 'DELETE', headers: { Authorization: 'Bearer desktop-local' }, signal: AbortSignal.timeout(15_000),
        }).catch(() => null);
      }
    }
  },
};
