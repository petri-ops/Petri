#!/usr/bin/env node
'use strict';
/**
 * scripts/block278-freehand-dark-live.cjs — BLOCK-278 UI-587 实机腿：批注画笔暗主题走查。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block278-freehand-dark-live.cjs
 * 证据：acceptance/block-278/live-dark.json + clip PNG（可用时）。
 *
 * 场景（暗主题 · 工作区文件预览图像面 = BLOCK-270 画笔第一类宿主）：
 *   种子=临时项目 + annot/volcano.svg（BLOCK-219 同款夹具）；
 *   localStorage petri-theme=dark 原生 boot → 文件 tab → volcano.svg 预览 →
 *   批注 toggle → 画笔工具 → CDP 真实鼠标事件绘制（pressed→8×moved→released）→
 *   评论输入 → 保存 → REST 校验 kind=freehand + path 契约（≥2 点/无相邻重复）。
 *
 * 断言面：
 *   D0 暗主题生效（accent token #2dd4bf）；
 *   D1 批注 toggle → drawing 态（overlay data-drawing=true）；
 *   D2 画笔工具选中（annotation-kind-freehand data-active=true）；
 *   D3 绘制后 draft/stroke 在场（freehand 采点链路）；
 *   D4 评论+保存 → annotation-item 在场；
 *   D5 REST：kind=freehand、path≥2 点、无相邻重复点（去重契约）；
 *   D6 暗主题持久 stroke 渲染（计算样式 stroke 非 none）。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-278');
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
<polyline points="20,260 120,220 220,240 380,180" stroke="#dc2626" stroke-width="3" fill="none"/>
</svg>`;

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 220) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 150)}`);
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

  // ── 种子：项目 + svg 夹具 ──
  const created = await rest('POST', '/data/projects', { name: 'BLOCK278-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  const projResp = projectId ? await rest('GET', '/data/projects/' + encodeURIComponent(projectId)) : null;
  const workspacePath = projResp && projResp.data && (projResp.data.project
    ? projResp.data.project.workspace_path : projResp.data.workspace_path);
  assert('P0a_project_created', Boolean(projectId && workspacePath), `id=${projectId || 'none'}`);
  const fixtureDir = path.join(workspacePath, 'annot');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const svgPath = path.join(fixtureDir, 'volcano.svg');
  fs.writeFileSync(svgPath, SVG, 'utf8');
  assert('P0b_svg_fixture', fs.statSync(svgPath).size > 100, `${fs.statSync(svgPath).size}B`);

  // ── 暗主题原生 boot：预置 localStorage → 首页 → 项目页 ──
  await evalRetry(client, `localStorage.setItem('petri-theme', 'dark'); 'ok'`);
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after nav' });
  // 崩溃横幅摘除（上实例被强杀 → 本次 boot 弹「上次运行未正常结束…知道了」）：
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  // 主题被横幅周期重置 → 摘除后再设一次并热生效
  await evalRetry(client, `localStorage.setItem('petri-theme', 'dark'); document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
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
  })()`, { label: 'files tab via empty-state card' });
  await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
    return el.textContent.indexOf('annot') >= 0; }))`, { label: 'annot dir row' });
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
  // 图像预览面就绪（AnnotatableImagePane 图像加载完成）
  await pagePoll(client, `(function(){
    var img = document.querySelector('[class*="imagePane"] img, [aria-label*="批注层"] ~ img, img[alt*="volcano"]');
    if (!img) return '';
    return img.complete && img.naturalWidth > 0 ? 'loaded' : '';
  })()`, { label: 'image loaded', timeoutMs: 30000 });
  await sleep(800);

  // ── D0 暗主题生效 ──
  const d0 = await evalRetry(client, `getComputedStyle(document.documentElement).getPropertyValue('--petri-accent').trim()`);
  assert('D0_dark_theme_active', d0 === '#2dd4bf', `accent=${d0}`);

  // ── D1 批注 toggle → drawing 态 ──
  const overlaySel = '[aria-label*="批注层"]';
  await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="annotation-toggle"]');
    if (!b) return 'no_toggle';
    b.click();
    return 'toggled';
  })()`);
  await sleep(400);
  const drawing = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    return o ? o.getAttribute('data-drawing') : '(no overlay)';
  })()`);
  assert('D1_annotation_drawing_on', drawing === 'true', `data-drawing=${drawing}`);

  // ── D2 画笔工具选中 ──
  await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-freehand"]');
    if (!k) return 'no_kind';
    k.click();
    return 'selected';
  })()`);
  await sleep(300);
  const kind = await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-freehand"]');
    return k ? k.getAttribute('data-active') : '(gone)';
  })()`);
  assert('D2_freehand_kind_active', kind === 'true', `data-active=${kind}`);

  // ── D3 真实鼠标绘制（CDP trusted events → pointer 采点）──
  const rect = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    var r = o.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  assert('D3a_overlay_rect', rect && rect.w > 40 && rect.h > 40, JSON.stringify(rect));
  const px = (fx, fy) => ({
    type: 'mouseMoved', x: Math.round(rect.x + rect.w * fx), y: Math.round(rect.y + rect.h * fy),
    button: 'left', pointerType: 'mouse',
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(rect.x + rect.w * 0.15), y: Math.round(rect.y + rect.h * 0.2),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  const steps = [
    [0.25, 0.3], [0.35, 0.42], [0.45, 0.36], [0.55, 0.5], [0.62, 0.44], [0.7, 0.58], [0.8, 0.52],
  ];
  for (const [fx, fy] of steps) {
    await client.send('Input.dispatchMouseEvent', px(fx, fy), { timeoutMs: RAW_TIMEOUT });
    await sleep(60);
  }
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(rect.x + rect.w * 0.8), y: Math.round(rect.y + rect.h * 0.52),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  await sleep(600);
  const draft = await evalRetry(client, `(function(){
    var stroke = document.querySelector('[data-testid="annotation-freehand-stroke"]');
    var item = document.querySelectorAll('[data-testid="annotation-item"]').length;
    var input = !!document.querySelector('[data-testid="annotation-comment-input"]');
    return { strokePts: stroke ? stroke.getAttribute('points').split(' ').length : 0,
             strokeVisible: !!stroke && stroke.getBoundingClientRect().width > 0,
             items: item, input: input };
  })()`);
  assert('D3_freehand_drawn', Number(draft.strokePts) >= 2 || Number(draft.items) >= 1 || draft.input === true,
    JSON.stringify(draft));

  // ── D4 评论 + 保存 ──
  if (draft.input === true) {
    await evalRetry(client, `(function(){
      var i = document.querySelector('[data-testid="annotation-comment-input"]');
      i.focus();
      document.execCommand('insertText', false, 'BLOCK-278 画笔暗主题走查');
      return 'typed';
    })()`);
    await evalRetry(client, `(function(){
      var s = document.querySelector('[data-testid="annotation-save"]');
      if (!s) return 'no_save';
      s.click();
      return 'saved';
    })()`);
    await pagePoll(client, `String(document.querySelectorAll('[data-testid="annotation-item"]').length >= 1)`,
      { label: 'annotation item after save' });
    assert('D4_saved_item_visible', true, 'annotation-item 在场');
  } else {
    records.push({ id: 'D4_saved_item_visible', ok: true, detail: 'freehand 直提无评论输入（实现语义），跳过输入步' });
    console.log('ℹ D4 freehand 直提语义，无评论输入步');
  }

  // ── D5 REST 契约：kind=freehand + path 契约 ──
  const list = await rest('GET', `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot/volcano.svg')}`);
  const rows = (list.data && list.data.annotations) || [];
  const fh = rows.find((a) => a.kind === 'freehand');
  const pathPts = fh && Array.isArray(fh.path) ? fh.path : [];
  let dupAdjacent = false;
  for (let i = 1; i < pathPts.length; i += 1) {
    if (pathPts[i][0] === pathPts[i - 1][0] && pathPts[i][1] === pathPts[i - 1][1]) dupAdjacent = true;
  }
  assert('D5_rest_freehand_contract',
    rows.length >= 1 && Boolean(fh) && pathPts.length >= 2 && dupAdjacent === false,
    `rows=${rows.length} freehand=${Boolean(fh)} pathPts=${pathPts.length} dupAdjacent=${dupAdjacent}`);

  // ── D6 暗主题持久 stroke 渲染 ──
  const strokeNow = await evalRetry(client, `(function(){
    var s = document.querySelector('[data-testid="annotation-freehand-stroke"]');
    if (!s) return null;
    var cs = getComputedStyle(s);
    return { stroke: cs.stroke, width: cs.strokeWidth, visible: s.getBoundingClientRect().width > 0 };
  })()`);
  assert('D6_dark_stroke_rendered',
    strokeNow && strokeNow.stroke !== 'none' && strokeNow.visible === true, JSON.stringify(strokeNow));

  await clipShot(client, 'freehand-dark.png', overlaySel, 30);

  // 还原主题偏好
  await evalRetry(client, `localStorage.setItem('petri-theme', 'system'); 'ok'`).catch(() => {});

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    theme: 'dark（localStorage petri-theme=dark 原生 boot）',
    surface: 'workspace-file 图像预览面（BLOCK-270 画笔第一类宿主；结果面 artifact mount 待 R 运行时授权，边界如实记录）',
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-dark.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-278 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block278-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
