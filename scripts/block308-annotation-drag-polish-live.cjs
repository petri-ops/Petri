#!/usr/bin/env node
'use strict';
/**
 * scripts/block308-annotation-drag-polish-live.cjs — BLOCK-308 UI-610/611 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block308-annotation-drag-polish-live.cjs
 * 证据：acceptance/block-306/live-drag-polish.json。
 *
 * 覆盖：
 *   A 回归：拖矩形 → CDP 真实鼠标点 ✓ → 落库；
 *   B 造一条已保存箭头（拖拽 + ✓）；
 *   C 拖拽跟手：拖拽中位移只直写 DOM transform（style.left 不变、rect 已位移），
 *     松手后 REST 几何落地、内联 transform 清理；
 *   D 箭头可拖：命中热区 pointer-events=stroke，拖拽直写 SVG transform 并 PATCH path；
 *   E 布局两态：窄预览（右栏默认 120px）回退为「工具条在上、画布在下一行」且图片可见
 *     （补 BLOCK-307 缺失的画布分母断言）；拖宽右栏后为「左=图标工具轨 / 中=画布居中 /
 *     右=执行区」三段式，形状工具单列图标（少时单列，增多自动加列）。
 *   F 加入上下文：只写 composer 草稿（含批注 prompt），不自动发送；
 *   G 选择工具：选择态点批注进入选中，绘制态批注层 pointer-events:none 不抢指针。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-306');
const RAW_TIMEOUT = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function pagePoll(client, expr, { timeoutMs = 25000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(800);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

async function waitRest(predicate, { timeoutMs = 10000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last && last.ok) return last;
    await sleep(300);
  }
  throw new Error('rest_poll_timeout: ' + label + ' :: ' + JSON.stringify(last && last.detail || null));
}

async function clipShot(client, file, selector, pad = 30) {
  const rect = await evalRetry(client, `(function(){
    var e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null;
    var r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  if (!rect || rect.w <= 0) return 'no_rect';
  const clip = {
    x: Math.max(0, Math.floor(rect.x - pad)),
    y: Math.max(0, Math.floor(rect.y - pad)),
    width: Math.ceil(rect.w + pad * 2),
    height: Math.ceil(rect.h + pad * 2),
    scale: 2,
  };
  try {
    const shot = await client.send('Page.captureScreenshot',
      { format: 'png', clip, fromSurface: false }, { timeoutMs: 20000 });
    fs.writeFileSync(path.join(EVIDENCE, file), Buffer.from(shot.data, 'base64'));
    console.log(`[probe] clip ${file}: saved`);
    return 'saved';
  } catch (e) {
    return 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 80);
  }
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
<rect width="400" height="300" fill="#ffffff"/>
<rect x="20" y="20" width="160" height="120" fill="#4f46e5"/>
<circle cx="300" cy="150" r="60" fill="#14b8a6"/>
</svg>`;

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 260) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 180)}`);
    return ok === true || ok === 'true';
  };

  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  const client = await lib.connectTarget(target);
  await client.send('Page.enable', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});

  // 右栏宽度会被上一次探针拖宽并持久化：先复位到默认 340，保证「窄态回退」一段可复现。
  await evalRetry(client, `(function(){
    var raw = localStorage.getItem('petri-pw-cols');
    var cols = raw ? JSON.parse(raw) : {};
    cols.rightWidth = 340;
    localStorage.setItem('petri-pw-cols', JSON.stringify(cols));
    return 'reset';
  })()`);

  const created = await rest('POST', '/data/projects', { name: 'BLOCK308-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  const projResp = projectId ? await rest('GET', '/data/projects/' + encodeURIComponent(projectId)) : null;
  const workspacePath = projResp && projResp.data && (projResp.data.project
    ? projResp.data.project.workspace_path : projResp.data.workspace_path);
  assert('P0a_project_created', Boolean(projectId && workspacePath), `id=${projectId || 'none'}`);
  const fixtureDir = path.join(workspacePath, 'annot');
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(path.join(fixtureDir, 'volcano.svg'), SVG, 'utf8');

  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after nav' });
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await sleep(400);
  await pagePoll(client, `(function(){
    var cards = [...document.querySelectorAll('[class*="emptyResultLaunchCard"]')];
    var card = cards.find(function(c){
      var t = c.querySelector('[class*="emptyResultLaunchTitle"]');
      return t && t.textContent === '文件';
    });
    if (!card) return '';
    card.click();
    return 'clicked';
  })()`, { label: 'files tab' });
  await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
    return el.textContent.indexOf('annot') >= 0; }))`, { label: 'annot dir' });
  await evalRetry(client, `(function(){
    var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
      return el.textContent.indexOf('annot') >= 0; });
    if (!row) return 'no_row';
    row.click();
    return 'expanded';
  })()`);
  await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
    return el.textContent.indexOf('volcano.svg') >= 0; }))`, { label: 'svg row' });
  await evalRetry(client, `(function(){
    var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
      return el.textContent.indexOf('volcano.svg') >= 0; });
    row.click();
    return 'opened';
  })()`);
  await pagePoll(client, `(function(){
    var img = document.querySelector('img[alt*="volcano"]');
    if (!img) return '';
    return img.complete && img.naturalWidth > 0 ? 'loaded' : '';
  })()`, { label: 'image loaded', timeoutMs: 30000 });
  await sleep(800);

  const overlaySel = '[aria-label*="批注层"]';
  const cdp = async (type, x, y) => {
    await client.send('Input.dispatchMouseEvent', {
      type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, pointerType: 'mouse',
    }, { timeoutMs: RAW_TIMEOUT });
  };
  const readOverlay = () => evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    if (!o) return null;
    var r = o.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);

  // 离屏实例（show:false）样式/布局要到下一帧才刷：读 rect/computed 前显式冲两帧。
  const flushFrames = () => evalRetry(client, `new Promise(function(resolve){
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve('flushed'); }); });
  })`);

  const readPaneLayout = () => evalRetry(client, `(function(){
    var img = document.querySelector('img[alt*="volcano"]');
    var bar = document.querySelector('[data-testid="annotation-bar"]');
    var actions = document.querySelector('[data-testid="annotation-actions"]');
    var pane = document.querySelector('[data-testid="annotatable-image-pane"]');
    if (!img || !bar || !pane) return null;
    var kinds = [...document.querySelectorAll('[data-testid^="annotation-kind-"]')];
    var canvas = img.closest('[class*="canvas"]') || img.parentElement;
    function R(el){ var r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }
    var cr = R(canvas), br = R(bar), pr = R(pane), ir = R(img);
    var ar = actions ? R(actions) : null;
    var tops = {};
    kinds.forEach(function(k){ tops[Math.round(k.getBoundingClientRect().top)] = 1; });
    return {
      paneW: Math.round(pr.w),
      barW: Math.round(br.w), barX: Math.round(br.x), barY: Math.round(br.y), barH: Math.round(br.h),
      actions: ar ? { x: Math.round(ar.x), y: Math.round(ar.y), w: Math.round(ar.w), h: Math.round(ar.h) } : null,
      actionButtons: actions ? [...actions.querySelectorAll('button')].map(function(b){
        return b.getAttribute('data-testid') || b.getAttribute('aria-label');
      }) : [],
      kindColumns: bar.getAttribute('data-kind-columns'),
      canvasW: Math.round(cr.w), canvasX: Math.round(cr.x), canvasY: Math.round(cr.y),
      imgW: Math.round(ir.w),
      imgCenterOffset: Math.round(Math.abs((ir.x + ir.w / 2) - (cr.x + cr.w / 2))),
      kinds: kinds.map(function(k){ return {
        label: (k.getAttribute('aria-label') || '').replace('批注形状 ', ''),
        title: k.getAttribute('title'),
        hasIcon: !!k.querySelector('svg'),
        text: k.textContent.trim(),
        w: Math.round(k.getBoundingClientRect().width),
      }; }),
      rows: Object.keys(tops).length,
    };
  })()`);

  const kindsOk = (layout) => Boolean(layout)
    && layout.kinds.length === 7
    && layout.kindColumns === '1'
    && layout.kinds.every((k) => k.hasIcon && k.text === '' && k.label && k.title === k.label);

  // ── E0 窄预览回退：图片可见（分母断言）+ 工具条在上 + 图标轨 ──
  const narrow = await readPaneLayout();
  assert('E0_narrow_fallback_image_visible',
    Boolean(narrow) && narrow.canvasW >= 90 && narrow.imgW >= 80,
    `paneW=${narrow && narrow.paneW} canvasW=${narrow && narrow.canvasW} imgW=${narrow && narrow.imgW}`);
  assert('E1_narrow_fallback_bar_stacked',
    Boolean(narrow) && narrow.barY + narrow.barH <= narrow.canvasY + 2,
    `barBottom=${narrow && narrow.barY + narrow.barH} canvasTop=${narrow && narrow.canvasY}`);
  assert('E2_narrow_kinds_icon_rail_single_column', kindsOk(narrow),
    `kinds=${narrow && narrow.kinds.length} columns=${narrow && narrow.kindColumns} 样本=${JSON.stringify(narrow && narrow.kinds.slice(0, 2))}`);

  // 默认右栏预览体约 120px：拖宽右栏（右侧 resizeHandleV）到 ~600px，验证左列形态。
  const wideBefore = await readPaneLayout();
  if (wideBefore && wideBefore.paneW < 380) {
    const handle = await evalRetry(client, `(function(){
      var hs = [...document.querySelectorAll('[class*="resizeHandleV"]')];
      if (!hs.length) return null;
      var r = hs[hs.length - 1].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: 400, innerWidth: window.innerWidth };
    })()`);
    if (handle) {
      // 目标：右栏 ~700px（预览体 = 700 - 文件树 ~220）。
      const targetX = Math.max(200, Math.round(handle.innerWidth - 700));
      await cdp('mousePressed', handle.x, handle.y);
      for (let s = 1; s <= 8; s += 1) {
        await cdp('mouseMoved', handle.x - (handle.x - targetX) * s / 8, handle.y);
        await sleep(60);
      }
      // 松手点落在面板内侧：落在柄左侧的 backdrop 上会被判成「点关闭侧栏」。
      await cdp('mouseReleased', Math.min(handle.innerWidth - 40, targetX + 140), handle.y);
      await sleep(900);
    }
  }
  await flushFrames();
  const wide = await readPaneLayout();
  const toolsLeft = Boolean(wide) && wide.barX + wide.barW + 4 <= wide.canvasX;
  const actionsRight = Boolean(wide && wide.actions)
    && wide.actions.x >= wide.canvasX + wide.canvasW - 1;
  assert('E3_wide_pane_reached', Boolean(wide) && wide.paneW >= 380,
    `paneW=${wide && wide.paneW}（拖宽后）`);
  assert('E4_tools_left_actions_right', toolsLeft && actionsRight,
    `tools=[${wide && wide.barX},${wide && wide.barW}] canvas=[${wide && wide.canvasX},${wide && wide.canvasW}] actions=${JSON.stringify(wide && wide.actions)}`);
  assert('E5_rails_width',
    Boolean(wide) && wide.barW >= 40 && wide.barW <= 70 && wide.actions && wide.actions.w >= 40 && wide.actions.w <= 70,
    `toolsW=${wide && wide.barW} actionsW=${wide && wide.actions && wide.actions.w}`);
  assert('E6_wide_canvas_and_centered_image',
    Boolean(wide) && wide.canvasW >= 320 && wide.imgW >= 300 && wide.imgCenterOffset <= 40,
    `canvasW=${wide && wide.canvasW} imgW=${wide && wide.imgW} offset=${wide && wide.imgCenterOffset}`);
  assert('E7_wide_rails_content',
    kindsOk(wide) && wide.rows === 7
      && ['annotation-toggle', 'annotation-select-mode', 'annotation-add-to-task'].every((id) => wide.actionButtons.includes(id)),
    `kinds=${wide && wide.kinds.length} columns=${wide && wide.kindColumns} rows=${wide && wide.rows} actions=${JSON.stringify(wide && wide.actionButtons)}`);

  const overlay = await readOverlay();
  if (!overlay) throw new Error('no_overlay');

  // ── A 回归：拖矩形 → 真实鼠标点 ✓ → 落库 ──
  await cdp('mousePressed', overlay.x + overlay.w * 0.1, overlay.y + overlay.h * 0.15);
  await cdp('mouseMoved', overlay.x + overlay.w * 0.35, overlay.y + overlay.h * 0.45);
  await cdp('mouseReleased', overlay.x + overlay.w * 0.35, overlay.y + overlay.h * 0.45);
  await sleep(500);
  const confirmBtn = await evalRetry(client, `(function(){
    var c = document.querySelector('[data-testid="annotation-inline-composer"]');
    if (!c) return null;
    var b = c.querySelector('[data-testid="annotation-inline-confirm"]').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  })()`);
  assert('A0_pending_present', Boolean(confirmBtn), '就地框出现');
  if (!confirmBtn) { process.exit(2); }
  await cdp('mousePressed', confirmBtn.x, confirmBtn.y);
  await cdp('mouseReleased', confirmBtn.x, confirmBtn.y);
  await sleep(900);
  const a = JSON.parse(await evalRetry(client, `JSON.stringify({
    boxes: document.querySelectorAll('[data-testid="annotation-box"]').length,
    pendingGone: !document.querySelector('[data-testid="annotation-inline-composer"]') })`));
  assert('A_confirm_via_real_click', a.boxes >= 1 && a.pendingGone === true, JSON.stringify(a));

  // ── B 造一条已保存箭头 ──
  await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-arrow"]');
    if (k) k.click();
    return 'ok';
  })()`);
  await sleep(300);
  const arrowKind = await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-arrow"]');
    return k ? k.getAttribute('data-active') : '(gone)';
  })()`);
  assert('B0_arrow_kind_active', arrowKind === 'true', `data-active=${arrowKind}`);
  await cdp('mousePressed', overlay.x + overlay.w * 0.55, overlay.y + overlay.h * 0.2);
  await cdp('mouseMoved', overlay.x + overlay.w * 0.85, overlay.y + overlay.h * 0.55);
  await cdp('mouseReleased', overlay.x + overlay.w * 0.85, overlay.y + overlay.h * 0.55);
  await sleep(500);
  const arrowConfirm = await evalRetry(client, `(function(){
    var c = document.querySelector('[data-testid="annotation-inline-composer"]');
    if (!c) return null;
    var b = c.querySelector('[data-testid="annotation-inline-confirm"]').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  })()`);
  if (arrowConfirm) {
    await cdp('mousePressed', arrowConfirm.x, arrowConfirm.y);
    await cdp('mouseReleased', arrowConfirm.x, arrowConfirm.y);
  }
  await sleep(900);
  const b = JSON.parse(await evalRetry(client, `JSON.stringify({
    arrows: document.querySelectorAll('[data-testid="annotation-arrow-stroke"]').length,
    pendingGone: !document.querySelector('[data-testid="annotation-inline-composer"]') })`));
  assert('B_arrow_created', b.arrows === 1 && b.pendingGone === true, JSON.stringify(b));

  // ── C 拖拽跟手：先切「选择」态（UI-612 起移动/选中只在选择态生效） ──
  await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="annotation-select-mode"]');
    if (b) b.click();
    return 'select';
  })()`);
  await sleep(300);
  await flushFrames();
  const selectReady = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    var box = document.querySelector('[data-testid="annotation-box"]');
    return JSON.stringify({ dataSelect: o.getAttribute('data-select'),
      pointerEvents: box ? getComputedStyle(box).pointerEvents : null });
  })()`);
  const selectReadyObj = JSON.parse(selectReady);
  assert('C_pre_select_mode',
    selectReadyObj.dataSelect === 'true' && selectReadyObj.pointerEvents === 'auto',
    selectReady);

  const boxBefore = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)}).getBoundingClientRect();
    var b = document.querySelector('[data-testid="annotation-box"]');
    var r = b.getBoundingClientRect();
    return { ox: o.x, oy: o.y, ow: o.width, oh: o.height,
             cx: r.x + r.width / 2, cy: r.y + r.height / 2,
             left: b.style.left, top: b.style.top, w: r.width, h: r.height };
  })()`);
  await cdp('mousePressed', boxBefore.cx, boxBefore.cy);
  await cdp('mouseMoved', boxBefore.cx + 12, boxBefore.cy + 12);

  // 离屏实例（show:false）的 style/布局要到下一帧才刷：轮询到计算值生效再断言。
  let mid = null;
  let tx = null;
  let ty = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(100);
    mid = await evalRetry(client, `(function(){
      var b = document.querySelector('[data-testid="annotation-box"]');
      var r = b.getBoundingClientRect();
      return { transform: b.style.transform, computed: getComputedStyle(b).transform,
               left: b.style.left, top: b.style.top,
               x: r.x, y: r.y, w: r.width, h: r.height };
    })()`);
    const matrix = /matrix\(1, 0, 0, 1,\s*(-?[\d.]+),\s*(-?[\d.]+)\)/.exec(mid.computed || '');
    tx = matrix ? Math.round(Number(matrix[1])) : null;
    ty = matrix ? Math.round(Number(matrix[2])) : null;
    if (tx !== null && Math.abs(tx - 12) <= 2 && Math.abs(ty - 12) <= 2) break;
  }
  const directTransform = Boolean(mid) && typeof mid.transform === 'string'
    && mid.transform.indexOf('translate(') === 0 && mid.transform.indexOf('px') > 0;
  assert('C0_drag_direct_transform', directTransform,
    `transform=${mid && mid.transform || '(empty)'}`);
  assert('C1_react_props_untouched_during_drag',
    Boolean(mid) && mid.left === boxBefore.left && mid.top === boxBefore.top,
    `left=${mid && mid.left}/${boxBefore.left} top=${mid && mid.top}/${boxBefore.top}`);
  // 以浏览器计算后的 transform 矩阵为准（style 已写 + 计算值生效 = 位移已交给合成器）。
  const rectDelta = mid ? Math.round(mid.x - (boxBefore.cx - boxBefore.w / 2)) : null;
  assert('C2_drag_follows_pointer',
    tx !== null && Math.abs(tx - 12) <= 2 && Math.abs(ty - 12) <= 2,
    `computed translate=(${tx},${ty}) rectΔ=${rectDelta}px（期望 translate≈12,12）`);

  const targetX = boxBefore.cx + boxBefore.ow * 0.25;
  const targetY = boxBefore.cy + boxBefore.oh * 0.2;
  for (let s = 1; s <= 4; s += 1) {
    await cdp('mouseMoved', boxBefore.cx + ((targetX - boxBefore.cx) * s) / 4, boxBefore.cy + ((targetY - boxBefore.cy) * s) / 4);
    await sleep(60);
  }
  await cdp('mouseReleased', targetX, targetY);
  const movedRow = await waitRest(async () => {
    const list = await rest('GET', `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot/volcano.svg')}`);
    const rows = (list.data && list.data.annotations) || [];
    const rectRow = rows.find((row) => Array.isArray(row.rect) && row.rect.length === 4);
    const ok = Boolean(rectRow && rectRow.rect[0] > 0.32 && rectRow.rect[0] < 0.38
      && rectRow.rect[1] > 0.32 && rectRow.rect[1] < 0.38);
    return { ok, detail: rectRow ? rectRow.rect : null };
  }, { label: 'box rect moved' }).catch((e) => ({ ok: false, detail: e.message }));
  assert('C3_drag_settles_geometry', movedRow.ok, `rect=${JSON.stringify(movedRow.detail)}`);
  // 客户端落地（props 更新 + 内联位移清理）可能晚于 REST：轮询 DOM 到稳定态（≤8s）。
  let settled = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(200);
    settled = await evalRetry(client, `(function(){
      var b = document.querySelector('[data-testid="annotation-box"]');
      return { transform: b.style.transform, left: b.style.left };
    })()`);
    if (settled.transform === '' && parseFloat(settled.left) > 30) break;
  }
  assert('C4_transform_cleared_after_settle',
    Boolean(settled) && settled.transform === '' && parseFloat(settled.left) > 30,
    `transform=${settled && settled.transform || '(empty)'} left=${settled && settled.left}`);

  // ── D 箭头可拖：命中热区 + 拖拽 PATCH path ──
  const arrowBefore = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)}).getBoundingClientRect();
    var hit = document.querySelector('[data-testid="annotation-arrow-hit"]');
    if (!hit) return null;
    var r = hit.getBoundingClientRect();
    var g = document.querySelector('[data-testid="annotation-arrow-stroke"]');
    return { ox: o.x, oy: o.y, ow: o.width, oh: o.height,
             cx: r.x + r.width / 2, cy: r.y + r.height / 2,
             pointerEvents: getComputedStyle(hit).pointerEvents,
             transform: g.getAttribute('transform') };
  })()`);
  assert('D0_arrow_hit_pointer_events', Boolean(arrowBefore) && arrowBefore.pointerEvents === 'stroke',
    `pointer-events=${arrowBefore && arrowBefore.pointerEvents}`);
  if (!arrowBefore) { process.exit(2); }
  await cdp('mousePressed', arrowBefore.cx, arrowBefore.cy);
  await cdp('mouseMoved', arrowBefore.cx + arrowBefore.ow * 0.04, arrowBefore.cy + arrowBefore.oh * 0.04);
  await sleep(80);
  const arrowMid = await evalRetry(client, `(function(){
    var g = document.querySelector('[data-testid="annotation-arrow-stroke"]');
    return { transform: g.getAttribute('transform'),
             pending: !!document.querySelector('[data-testid="annotation-inline-composer"]') };
  })()`);
  assert('D1_arrow_drag_direct_transform',
    Boolean(arrowMid.transform) && arrowMid.transform.indexOf('translate(') === 0,
    `transform=${arrowMid.transform || '(null)'}`);
  for (let s = 2; s <= 4; s += 1) {
    await cdp('mouseMoved', arrowBefore.cx + arrowBefore.ow * 0.1 * s / 4, arrowBefore.cy + arrowBefore.oh * 0.1 * s / 4);
    await sleep(60);
  }
  await cdp('mouseReleased', arrowBefore.cx + arrowBefore.ow * 0.1, arrowBefore.cy + arrowBefore.oh * 0.1);
  const arrowRow = await waitRest(async () => {
    const list = await rest('GET', `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot/volcano.svg')}`);
    const rows = (list.data && list.data.annotations) || [];
    const row = rows.find((item) => item.kind === 'arrow' && Array.isArray(item.path) && item.path.length === 2);
    const ok = Boolean(row
      && row.path[0][0] > 0.6 && row.path[0][0] < 0.7
      && row.path[0][1] > 0.25 && row.path[0][1] < 0.35);
    return { ok, detail: row ? row.path : null };
  }, { label: 'arrow path moved' }).catch((e) => ({ ok: false, detail: e.message }));
  assert('D2_arrow_drag_geometry', arrowRow.ok, `path=${JSON.stringify(arrowRow.detail)}`);
  let arrowSettled = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await sleep(200);
    arrowSettled = await evalRetry(client, `(function(){
      var g = document.querySelector('[data-testid="annotation-arrow-stroke"]');
      return { transform: g.getAttribute('transform'),
               pending: !!document.querySelector('[data-testid="annotation-inline-composer"]') };
    })()`);
    if (arrowSettled.transform === null && arrowSettled.pending === false) break;
  }
  assert('D3_arrow_drag_no_new_pending',
    arrowSettled.transform === null && arrowSettled.pending === false,
    `transform=${arrowSettled.transform || '(null)'} pending=${arrowSettled.pending}`);

  // ── F 加入上下文：只入 composer 草稿，不发送（UI-612） ──
  const composeBefore = JSON.parse(await evalRetry(client, `JSON.stringify({
    value: (function(){ var ta = document.querySelector('textarea.sc-input'); return ta ? ta.value : null; })(),
    userRows: document.querySelectorAll('.sc-msg-user').length,
  })`));
  const addBtn = await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="annotation-add-to-task"]');
    if (!b) return null;
    var r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
             disabled: b.disabled, aria: b.getAttribute('aria-label') };
  })()`);
  assert('F0_add_to_context_present',
    Boolean(addBtn) && addBtn.disabled === false && addBtn.aria === '加入上下文',
    JSON.stringify(addBtn));
  if (addBtn) {
    await cdp('mousePressed', addBtn.x, addBtn.y);
    await cdp('mouseReleased', addBtn.x, addBtn.y);
  }
  await sleep(800);
  const composeAfter = JSON.parse(await evalRetry(client, `JSON.stringify({
    value: (function(){ var ta = document.querySelector('textarea.sc-input'); return ta ? ta.value : null; })(),
    userRows: document.querySelectorAll('.sc-msg-user').length,
  })`));
  assert('F1_compose_writes_draft',
    Boolean(composeAfter.value)
      && composeAfter.value.includes('volcano.svg')
      && composeAfter.value.includes('批注')
      && composeAfter.value !== composeBefore.value,
    `value=${String(composeAfter.value).slice(0, 160).replace(/\\n/g, '⏎')}`);
  assert('F2_compose_does_not_send',
    composeAfter.userRows === composeBefore.userRows,
    `userRows=${composeBefore.userRows} → ${composeAfter.userRows}`);

  // ── G 选择工具：选择态点批注=选中；绘制态批注层不吃指针（UI-612） ──
  await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="annotation-select-mode"]');
    if (b) b.click();
    return 'select';
  })()`);
  await sleep(300);
  await flushFrames();
  const selState = JSON.parse(await evalRetry(client, `JSON.stringify((function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    var box = document.querySelector('[data-testid="annotation-box"]');
    return { dataSelect: o.getAttribute('data-select'),
             pointerEvents: getComputedStyle(box).pointerEvents,
             aria: document.querySelector('[data-testid="annotation-select-mode"]').getAttribute('aria-pressed') };
  })())`));
  assert('G0_select_mode_active',
    selState.dataSelect === 'true' && selState.aria === 'true' && selState.pointerEvents === 'auto',
    JSON.stringify(selState));
  const boxPoint = await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="annotation-box"]');
    var r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  await cdp('mousePressed', boxPoint.x, boxPoint.y);
  await cdp('mouseReleased', boxPoint.x, boxPoint.y);
  await sleep(300);
  const selected = await evalRetry(client, `document.querySelector('[data-testid="annotation-box"]').getAttribute('data-selected')`);
  assert('G1_click_selects_annotation', selected === 'true', `data-selected=${selected}`);

  await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="annotation-toggle"]');
    if (b) b.click();
    return 'annotate';
  })()`);
  await sleep(300);
  await flushFrames();
  const drawState = JSON.parse(await evalRetry(client, `JSON.stringify((function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    var box = document.querySelector('[data-testid="annotation-box"]');
    return { dataSelect: o.getAttribute('data-select'),
             pointerEvents: getComputedStyle(box).pointerEvents,
             selected: box.getAttribute('data-selected') };
  })())`));
  assert('G2_drawing_mode_ignores_annotation',
    drawState.dataSelect === 'false' && drawState.pointerEvents === 'none' && drawState.selected === 'false',
    JSON.stringify(drawState));
  const countBefore = await evalRetry(client, `document.querySelectorAll('[data-testid="annotation-box"], [data-testid="annotation-arrow-stroke"]').length`);
  await cdp('mousePressed', boxPoint.x, boxPoint.y);
  await cdp('mouseReleased', boxPoint.x, boxPoint.y);
  await sleep(400);
  const countAfter = await evalRetry(client, `document.querySelectorAll('[data-testid="annotation-box"], [data-testid="annotation-arrow-stroke"]').length`);
  assert('G3_drawing_click_creates_no_duplicate', countAfter === countBefore, `${countBefore} → ${countAfter}`);

  // 离屏实例截图可能不可用（-32000/合成帧超时）——如实记录，不计入断言通过率。
  const shot = await clipShot(client, 'drag-polish-layout.png', overlaySel, 40);

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'workspace-file 图像预览面（BLOCK-308：拖拽跟手/箭头可拖/左栏 2 列布局）',
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    notes: { screenshot: shot },
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-drag-polish.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-308 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block308-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
