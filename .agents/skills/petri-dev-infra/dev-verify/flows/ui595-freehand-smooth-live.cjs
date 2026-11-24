#!/usr/bin/node
'use strict';

/**
 * dev-verify flow: ui595-freehand-smooth-live — UI-595 批注画笔平滑 + 触屏防误触实机（BLOCK-513 L6）。
 *
 * 台账降档注记：「组件级 62/62 已锚，待图像 artifact 在结果面打开的实机腿」。2026-11-24
 * 核码改判：AnnotationOverlay 当前唯一消费面 = WorkspaceFilePreview（工作区文件预览）——
 * 2026-11-23 P6 裁决已将 resultSurfaces 整体停用、产物回退 core 原生 viewer，「结果面打开」
 * 前提的地基已变；图像批注的现存打开面即工作区文件预览（q6rem-annotations-live 同面）。
 * 本 flow 在该面验证 UI-595 两项新能力的全链实机：
 *
 *   P0_temp_project_created        临时验收项目（带 workspace_path）
 *   A1_fixtures_written            SVG 图 fixture（自造，零外部依赖）
 *   A2_image_bar_mounted           图像预览批注条 annotatable=true
 *   A3_freehand_tool_selected      画笔 kind 按钮选中
 *   A4_stroke_smoothed_render      采点 5 点 → 渲染 d 含 Q（贝塞尔平滑：原始点作控制点、中点作锚）
 *   A5_second_pointer_ignored      笔触期间第二 pointerId 落屏 → 草稿 d 零变化（防误触）
 *   A6_storage_raw_points          落库 path = 原始采点数组（长度=5=采点数，第二指点不在内；存储契约不变）
 *   A7_undo_removes_and_rest_syncs 撤销清空 + REST 同步为空
 *   P9_cleanup_project_deleted     临时项目清理
 *
 * 前置：后端(:3001) + vite(:3000) + 9223 测试实例（离屏）。
 * 证据：acceptance/ui-595/ui595-freehand-smooth-live-darwin.json（run.cjs 落盘）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'ui-595');
const IMG = '[data-testid="annotatable-image-pane"]';

const FIGURE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAPAAAAC0CAIAAAAl/ja/AAAB+klEQVR4nO3SUQkAIBTAwBfBQCaxfxBLCMI4uAD72Kx9IGO+F8BDhibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KRc8opy5HMpipwAAAAASUVORK5CYII=';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1200); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(800);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

module.exports = {
  id: 'ui595-freehand-smooth-live',
  description: 'UI-595 画笔平滑+触屏防误触实机：5 点采点渲染 d 含 Q、第二 pointerId 不篡改笔触、落库=原始采点契约（9223 离屏）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const created = await rest('POST', '/data/projects', { name: 'UI595-验收-' + Date.now(), modality: 'general' });
    const projectId = created.data && created.data.project && created.data.project.id;
    const projResp = projectId ? await rest('GET', '/data/projects/' + encodeURIComponent(projectId)) : null;
    const workspacePath = projResp && projResp.data && (projResp.data.project
      ? projResp.data.project.workspace_path : projResp.data.workspace_path);
    assert('P0_temp_project_created', Boolean(projectId && workspacePath),
      JSON.stringify({ projectId, workspacePath }).slice(0, 160));
    if (!projectId || !workspacePath) throw new Error('temp_project_missing');

    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target');
    const target = await lib.selectPageTarget(pages, {
      probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
    });
    const client = await lib.connectTarget(target);
    const originalUrl = await evalRetry(client, 'location.href');

    try {
      // A1 夹具
      const fixtureDir = path.join(workspacePath, 'annot595');
      fs.mkdirSync(fixtureDir, { recursive: true });
      const figPath = path.join(fixtureDir, 'figure.png');
      fs.writeFileSync(figPath, Buffer.from(FIGURE_PNG_BASE64, 'base64'));
      assert('A1_fixtures_written', fs.statSync(figPath).size > 100, `svg=${fs.statSync(figPath).size}B`);

      // 打开文件面板 → 预览（2026-11-24 核码：UI-593 空态重排后入口=右栏「文件」富卡，
      // 工作区文件树在 workspaceFileTreePane，不用 role=treeitem——那是左侧项目树；
      // SPA keep-alive：先 ?test=1 重置，防上一轮已删项目的面板残留）
      await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/?test=1&_t=${Date.now()}`)}; 'reset'`);
      await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after reset' });
      await sleep(2000);
      await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}?_t=${Date.now()}`)}; 'nav'`);
      await pagePoll(client, `!!document.getElementById('root')`, { label: 'root' });
      await pagePoll(client, `(function(){
        var b = [...document.querySelectorAll('button')].find(function(x){ return x.textContent.indexOf('浏览工作区文件') >= 0; });
        if (!b) return '';
        b.click();
        return 'clicked';
      })()`, { label: 'files entry card' });
      await pagePoll(client, `(function(){
        var pane = document.querySelector('[class*="workspaceFileTreePane"]');
        return pane && pane.textContent.indexOf('暂无文件') < 0 ? 'tree_ready' : '';
      })()`, { label: 'workspace tree non-empty', timeoutMs: 30000 });
      await pagePoll(client, `(function(){
        var pane = document.querySelector('[class*="workspaceFileTreePane"]');
        if (!pane) return '';
        var rows = [...pane.querySelectorAll('button[class*="fileTreeRow"]')].filter(function(el){
          return el.textContent.trim() === 'annot595';
        });
        var row = rows[rows.length - 1];
        if (!row) return '';
        row.click();
        return 'expanded';
      })()`, { label: 'annot595 dir row' });
      await pagePoll(client, `(function(){
        var pane = document.querySelector('[class*="workspaceFileTreePane"]');
        return pane && pane.textContent.indexOf('figure.png') >= 0 ? 'figure_row' : '';
      })()`, { label: 'figure row', timeoutMs: 30000 });
      await evalRetry(client, `(function(){
        var pane = document.querySelector('[class*="workspaceFileTreePane"]');
        var rows = [...pane.querySelectorAll('button[class*="fileTreeRow"]')].filter(function(el){
          return el.textContent.trim().indexOf('figure.png') === 0;
        });
        var row = rows[rows.length - 1];
        if (!row) return 'no_file_row';
        row.click();
        return 'opened';
      })()`);
      await pagePoll(client, `String(!!document.querySelector('${IMG} [data-testid="annotation-bar"]'))`, { label: 'image bar', timeoutMs: 30000 });
      const annotatable = await evalRetry(client,
        `String(document.querySelector('${IMG} [data-testid="annotation-bar"]').dataset.annotatable)`);
      assert('A2_image_bar_mounted', annotatable === 'true', `data-annotatable=${annotatable}`);

      // A3 选画笔
      await evalRetry(client, `(function(){
        var t = document.querySelector('${IMG} [data-testid="annotation-toggle"]');
        if (t) t.click();
        return 'toggled';
      })()`);
      await pagePoll(client, `String(!!document.querySelector('${IMG} [data-testid="annotation-kind-freehand"]'))`, { label: 'freehand kind' });
      await evalRetry(client, `(function(){
        document.querySelector('${IMG} [data-testid="annotation-kind-freehand"]').click();
        return 'selected';
      })()`);
      assert('A3_freehand_tool_selected', true, 'kind=freehand');
      // 等绘制模式生效：freehand 按钮按下态 + overlay data-drawing 落地后再采点
      // （二者是独立状态——kind 未落地时 drawing 已 true，采点会走 rect 分支）
      await pagePoll(client, `(function(){
        var k = document.querySelector('${IMG} [data-testid="annotation-kind-freehand"]');
        return k && k.getAttribute('aria-pressed') === 'true' ? 'kind_active' : '';
      })()`, { label: 'freehand kind pressed', timeoutMs: 15000 });
      await pagePoll(client, `(function(){
        var o = document.querySelector('${IMG} [data-testid="annotation-overlay"]');
        return o && o.dataset.drawing === 'true' ? 'drawing' : '';
      })()`, { label: 'overlay drawing mode', timeoutMs: 15000 });

      // A4/A5 采点绘制：pointerId=1 采 5 点；中段注入 pointerId=7（第二指）应被忽略
      await pagePoll(client, `(function(){
        var overlay = document.querySelector('${IMG} [data-testid="annotation-overlay"]');
        if (!overlay) return '';
        var box = overlay.getBoundingClientRect();
        return (box && box.width >= 60 && box.height >= 40) ? 'ready' : '';
      })()`, { label: 'overlay sized', timeoutMs: 30000 });
      // A4/A5 采点绘制分三阶段：React 草稿渲染异步，fire 与读数不能同 tick
      const pts = await evalRetry(client, `(function(){
        var overlay = document.querySelector('${IMG} [data-testid="annotation-overlay"]');
        var box = overlay.getBoundingClientRect();
        var pts = [
          [box.left + box.width * 0.2, box.top + box.height * 0.3],
          [box.left + box.width * 0.35, box.top + box.height * 0.5],
          [box.left + box.width * 0.5, box.top + box.height * 0.35],
          [box.left + box.width * 0.65, box.top + box.height * 0.55],
          [box.left + box.width * 0.8, box.top + box.height * 0.6],
        ];
        window.__ui595fire = function(type, x, y, pid) {
          overlay.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: pid, pointerType: 'mouse',
            isPrimary: pid === 1, clientX: x, clientY: y,
            buttons: type === 'pointerup' ? 0 : 1,
          }));
          return 'fired';
        };
        window.__ui595pts = pts;
        window.__ui595fire('pointerdown', pts[0][0], pts[0][1], 1);
        window.__ui595fire('pointermove', pts[1][0], pts[1][1], 1);
        window.__ui595fire('pointermove', pts[2][0], pts[2][1], 1);
        return 'started';
      })()`);
      assert('A5_stroke_started', String(pts) === 'started', String(pts));
      // 等草稿渲染（异步 setState）→ 记 dBefore
      await pagePoll(client, `(function(){
        var p = document.querySelector('${IMG} [data-testid="annotation-freehand-draft"] path');
        return p && p.getAttribute('d') ? 'draft' : '';
      })()`, { label: 'draft rendered', timeoutMs: 15000 });
      const dBefore = await evalRetry(client,
        `document.querySelector('${IMG} [data-testid="annotation-freehand-draft"] path').getAttribute('d')`);
      // 第二指/手掌落屏：pointerId=7 down+move——应被忽略（防误触）
      await evalRetry(client, `(function(){
        var pts = window.__ui595pts;
        window.__ui595fire('pointerdown', pts[3][0], pts[3][1], 7);
        window.__ui595fire('pointermove', pts[3][0] + 30, pts[3][1] + 30, 7);
        return 'interfered';
      })()`);
      await sleep(400);
      const dAfter = await evalRetry(client,
        `document.querySelector('${IMG} [data-testid="annotation-freehand-draft"] path').getAttribute('d')`);
      const draftCount = await evalRetry(client,
        `String(document.querySelectorAll('${IMG} [data-testid="annotation-freehand-draft"]').length)`);
      assert('A5_second_pointer_ignored', dBefore === dAfter && draftCount === '1',
        `dSame=${dBefore === dAfter} draftCount=${draftCount} dBeforeLen=${dBefore && dBefore.length}`);
      // 续画 id=1 → pointerup
      await evalRetry(client, `(function(){
        var pts = window.__ui595pts;
        window.__ui595fire('pointermove', pts[3][0], pts[3][1], 1);
        window.__ui595fire('pointerup', pts[4][0], pts[4][1], 1);
        return 'finished';
      })()`);

      // 保存（就地批注输入框 annotation-inline-input → ✓ 确认）
      await pagePoll(client, `String(!!document.querySelector('${IMG} [data-testid="annotation-inline-composer"]'))`, { label: 'inline composer', timeoutMs: 20000 });
      await evalRetry(client, `(function(){
        var input = document.querySelector('${IMG} [data-testid="annotation-inline-input"]');
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'UI-595 平滑笔触验证');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      })()`);
      await evalRetry(client, `(function(){
        document.querySelector('${IMG} [data-testid="annotation-inline-confirm"]').click();
        return 'confirmed';
      })()`);
      await pagePoll(client, `String(document.querySelectorAll('${IMG} [data-testid="annotation-freehand-stroke"]').length >= 1)`, { label: 'stroke rendered', timeoutMs: 20000 });

      // A4 渲染平滑：持久笔画 d 含 Q（贝塞尔）；pending 草稿退场
      const strokeD = await evalRetry(client,
        `String(document.querySelector('${IMG} [data-testid="annotation-freehand-stroke"]').getAttribute('d'))`);
      const draftGone = await evalRetry(client,
        `String(!document.querySelector('${IMG} [data-testid="annotation-freehand-draft"]'))`);
      assert('A4_stroke_smoothed_render', /[Qq]/.test(strokeD) === true && draftGone === 'true',
        `hasQ=${/[Qq]/.test(strokeD)} dHead=${strokeD.slice(0, 60)} draftGone=${draftGone}`);

      // A6 存储契约：REST path = 原始采点数组（长度 5；第二指点不在内）
      const listResp = await rest('GET',
        `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot595/figure.png')}`);
      const rows = (listResp.data && listResp.data.annotations) || [];
      const row = rows.find((r) => r.kind === 'freehand') || rows[0];
      const pathLen = row && Array.isArray(row.path) ? row.path.length : -1;
      assert('A6_storage_raw_points', Boolean(row) && pathLen === 5,
        `kind=${row && row.kind} pathLen=${pathLen}（原始采点 5，第二指点不在内）`);

      // A7 撤销清空 + REST 同步
      await evalRetry(client, `(function(){
        var btns = [...document.querySelectorAll('${IMG} [data-testid="annotation-undo"]')];
        (btns[btns.length - 1] || document.querySelector('[data-testid="annotation-undo"]')).click();
        return 'undone';
      })()`);
      await sleep(600);
      const strokesAfter = await evalRetry(client,
        `String(document.querySelectorAll('${IMG} [data-testid="annotation-freehand-stroke"]').length)`);
      const listAfter = await rest('GET',
        `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot595/figure.png')}`);
      const rowsAfter = (listAfter.data && listAfter.data.annotations) || [];
      assert('A7_undo_removes_and_rest_syncs', Number(strokesAfter) === 0 && rowsAfter.length === 0,
        `strokes=${strokesAfter} restRows=${rowsAfter.length}`);
    } finally {
      const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)).catch(() => null);
      assert('P9_cleanup_project_deleted', Boolean(d && d.ok), `status=${d && d.status}`);
      try {
        await evalRetry(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`);
        await sleep(1500);
      } catch { /* 恢复失败不掩盖断言结果 */ }
    }
    return true;
  },
};
