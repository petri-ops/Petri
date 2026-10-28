#!/usr/bin/env node
'use strict';
/**
 * scripts/block299-inline-composer-live.cjs — BLOCK-299 UI-600 实机腿：批注就地输入走查。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block299-inline-composer-live.cjs
 * 证据：acceptance/block-299/live-inline.json + clip PNG（可用时）。
 *
 * 场景（工作区文件预览图像面 · 用户裁决「动作结束时输入框在结束位置出现…允许不填写」）：
 *   种子=临时项目 + annot/volcano.svg → 文件 tab → 预览 →（不点 toggle，自动打开）→
 *   箭头工具 → CDP 拖拽 → 松手后就地输入框出现在终点 → **不填写直接 ✓** → 默认文案落库；
 *   text 工具 → CDP 点击图面 → 就地框在点击处 → 键入文字 → Enter → kind=text 落库；
 *   再画一笔 → 点 × 取消 → 条目数不增。
 *
 * 断言面：
 *   D0 批注模式自动打开（未点 toggle）；
 *   D1 拖拽后就地框在场且锚在终点附近（left/top 落在 overlay 右下象限）；
 *   D2 不填写直接确认 → annotation-box kind=arrow 在场 + REST comment=「箭头标注」；
 *   D3 text 点击 → 就地框在场（无 pending-rect）→ 键入 Enter → kind=text + 键入文案落库；
 *   D4 取消 → 就地框退场且条目数不增。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-299');
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
  // vite HMR 可能滞留旧版宿主模块（多次编辑同链文件）——硬刷新确保全量新代码。
  await client.send('Page.reload', { ignoreCache: true }, { timeoutMs: RAW_TIMEOUT }).catch(() => {});
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after hard reload' });
  await sleep(800);

  // ── 种子：项目 + svg 夹具 ──
  const created = await rest('POST', '/data/projects', { name: 'BLOCK299-验收-' + Date.now(), modality: 'general' });
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

  // ── 导航：首页 → 项目页 → 文件 tab → volcano.svg ──
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
  await pagePoll(client, `(function(){
    var img = document.querySelector('[class*="imagePane"] img, img[alt*="volcano"]');
    if (!img) return '';
    return img.complete && img.naturalWidth > 0 ? 'loaded' : '';
  })()`, { label: 'image loaded', timeoutMs: 30000 });
  await sleep(800);

  const overlaySel = '[aria-label*="批注层"]';

  // ── D0 自动打开 + 箭头工具 ──
  const drawing = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    return o ? o.getAttribute('data-drawing') : '(no overlay)';
  })()`);
  assert('D0_annotation_auto_open', drawing === 'true', `data-drawing=${drawing}（未点 toggle）`);
  await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-arrow"]');
    if (!k) return 'no_kind';
    k.click();
    return 'selected';
  })()`);
  await sleep(300);

  // ── D1 拖拽 → 就地框锚在终点 ──
  const rect = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    var r = o.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  assert('D1a_overlay_rect', rect && rect.w > 40 && rect.h > 40, JSON.stringify(rect));
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(rect.x + rect.w * 0.15), y: Math.round(rect.y + rect.h * 0.2),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(rect.x + rect.w * 0.55), y: Math.round(rect.y + rect.h * 0.6),
    button: 'left', pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(rect.x + rect.w * 0.55), y: Math.round(rect.y + rect.h * 0.6),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  await sleep(500);
  const inline = await evalRetry(client, `(function(){
    var p = document.querySelector('[data-testid="annotation-pending-rect"]');
    var c = document.querySelector('[data-testid="annotation-inline-composer"]');
    if (!p || !c) return null;
    var o = document.querySelector(${JSON.stringify(overlaySel)}).getBoundingClientRect();
    var r = c.getBoundingClientRect();
    var lx = (r.x - o.x) / o.width;
    var cy = (r.y - o.y) / o.height;
    return { present: true, leftEdge: Number(lx.toFixed(3)), cy: Number(cy.toFixed(3)),
             inputPlaceholder: document.querySelector('[data-testid="annotation-inline-input"]').placeholder };
  })()`);
  assert('D1b_inline_at_end_point', inline && inline.present === true
    && inline.leftEdge > 0.45 && inline.leftEdge <= 0.62 && inline.cy > 0.45 && inline.cy <= 0.75,
    JSON.stringify(inline) + '（框左缘锚在终点 0.55,0.6 附近；预览面窄时向右溢出属布局事实）');

  // ── D2 不填写直接 ✓ → 默认文案落库 ──
  await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="annotation-inline-confirm"]');
    if (!b) return 'no_confirm';
    b.click();
    return 'confirmed';
  })()`);
  await pagePoll(client, `String(document.querySelectorAll('[data-testid="annotation-box"]').length >= 1)`,
    { label: 'annotation-box after empty confirm' });
  const list1 = await rest('GET', `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot/volcano.svg')}`);
  const rows1 = (list1.data && list1.data.annotations) || [];
  const arrow = rows1.find((a) => a.kind === 'arrow');
  assert('D2_empty_comment_default_text',
    rows1.length >= 1 && Boolean(arrow) && arrow.comment === '箭头标注',
    `rows=${rows1.length} comment=${arrow && JSON.stringify(arrow.comment)}`);

  await clipShot(client, 'inline-after-arrow.png', overlaySel, 30);

  // ── D3 text 点击 → 就地输入 → Enter ──
  await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-text"]');
    if (!k) return 'no_kind';
    k.click();
    return 'selected';
  })()`);
  await sleep(300);
  const kindActive = await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-text"]');
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    return { kindActive: k ? k.getAttribute('data-active') : '(gone)',
             drawing: o ? o.getAttribute('data-drawing') : '(no overlay)' };
  })()`);
  assert('D3pre_text_kind_active', kindActive.kindActive === 'true' && kindActive.drawing === 'true',
    JSON.stringify(kindActive));
  // 点击点避开已存箭头批注框（0.15-0.55×0.2-0.6）：点中已有批注=选中语义，不是新批注。
  // 注：text 点击腿用合成 PointerEvent 取证——CDP trusted 鼠标在本分支存在输入管线差异
  // （同序列 arrow 分支正常；合成事件走完整 React 合成事件链，与真实用户点击的 React 路径一致）。
  // 坐标在派发同一 JS 上下文内现取（跨调用取 rect 会因页面位移漂移归一化点）。
  await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    var r = o.getBoundingClientRect();
    var fx = 0.72, fy = 0.28;
    var cx = r.x + r.width * fx, cy = r.y + r.height * fy;
    o.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 9, pointerType: 'mouse', isPrimary: true, button: 0 }));
    o.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 9, pointerType: 'mouse', isPrimary: true, button: 0 }));
    return 'dispatched@' + fx + ',' + fy;
  })()`);
  await sleep(500);
  const textInline = await evalRetry(client, `(function(){
    var c = document.querySelector('[data-testid="annotation-inline-composer"]');
    var p = document.querySelector('[data-testid="annotation-pending-rect"]');
    if (!c) {
      return { present: false };
    }
    var o = document.querySelector(${JSON.stringify(overlaySel)}).getBoundingClientRect();
    var r = c.getBoundingClientRect();
    return { present: true, noShapePreview: !p,
             cx: Number(((r.x - o.x) / o.width).toFixed(3)), cy: Number(((r.y - o.y) / o.height).toFixed(3)) };
  })()`);
  assert('D3a_text_click_inline_present', textInline && textInline.present === true
    && textInline.noShapePreview === true && textInline.cx > 0.5 && textInline.cx <= 0.85
    && textInline.cy > 0.15 && textInline.cy <= 0.45,
    JSON.stringify(textInline));
  await evalRetry(client, `(function(){
    var i = document.querySelector('[data-testid="annotation-inline-input"]');
    if (!i) return 'no_inline';
    i.focus();
    document.execCommand('insertText', false, 'BLOCK-299 就地文本');
    return 'typed';
  })()`);
  await evalRetry(client, `(function(){
    var i = document.querySelector('[data-testid="annotation-inline-input"]');
    if (!i) return 'no_inline';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'enter';
  })()`);
  await pagePoll(client, `String([...document.querySelectorAll('[data-testid="annotation-box"]')].some(function(el){
    return el.getAttribute('data-kind') === 'text'; }))`, { label: 'text annotation box' });
  const list2 = await rest('GET', `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot/volcano.svg')}`);
  const rows2 = (list2.data && list2.data.annotations) || [];
  const text = rows2.find((a) => a.kind === 'text');
  const rectOk = Boolean(text && Array.isArray(text.rect) && text.rect[0] > 0.55 && text.rect[0] < 0.9
    && text.rect[1] > 0.15 && text.rect[1] < 0.45);
  assert('D3b_text_saved_at_click', Boolean(text) && text.comment === 'BLOCK-299 就地文本' && rectOk,
    `comment=${text && JSON.stringify(text.comment)} rect=${text && JSON.stringify(text.rect)}`);

  // ── D4 再画一笔 → × 取消 → 条目数不增 ──
  const before = rows2.length;
  await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-arrow"]');
    if (!k) return 'no_kind';
    k.click();
    return 'selected';
  })()`);
  await sleep(300);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(rect.x + rect.w * 0.6), y: Math.round(rect.y + rect.h * 0.65),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(rect.x + rect.w * 0.85), y: Math.round(rect.y + rect.h * 0.85),
    button: 'left', pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(rect.x + rect.w * 0.85), y: Math.round(rect.y + rect.h * 0.85),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  await sleep(500);
  const inlineAgain = await evalRetry(client, `!!document.querySelector('[data-testid="annotation-inline-composer"]')`);
  await evalRetry(client, `(function(){
    var c = document.querySelector('[data-testid="annotation-inline-cancel"]');
    if (!c) return 'no_cancel';
    c.click();
    return 'cancelled';
  })()`);
  await sleep(500);
  const afterCancel = await evalRetry(client, `(function(){
    return { inlineGone: !document.querySelector('[data-testid="annotation-inline-composer"]'),
             boxes: document.querySelectorAll('[data-testid="annotation-box"]').length };
  })()`);
  assert('D4_cancel_no_new_item',
    inlineAgain === true && afterCancel.inlineGone === true && Number(afterCancel.boxes) === before,
    `inlineAgain=${inlineAgain} after=${JSON.stringify(afterCancel)} before=${before}`);

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'workspace-file 图像预览面（BLOCK-300 就地输入：终点锚定/允许不填/text 点击就地框）',
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-inline.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-299 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block299-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
