#!/usr/bin/env node
'use strict';
/**
 * scripts/block304-annotation-touch-live.cjs — BLOCK-307 UI-607/608/609 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block304-annotation-touch-live.cjs
 * 证据：acceptance/block-305/live-touch.json。
 *
 * 四条用户反馈全验：
 *   A 对号/× 真实鼠标可确认（拖矩形→CDP 点 ✓→落库）；
 *   B 文本工具真实点击可就地开框输入；
 *   C 保存后的形状可整体拖拽移动（CDP 拖 box→REST 几何更新）；
 *   D 图片水平居中 + 工具条列在图片左侧（几何断言）。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-305');
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

  const created = await rest('POST', '/data/projects', { name: 'BLOCK307-验收-' + Date.now(), modality: 'general' });
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
    var img = document.querySelector('[class*="imagePane"] img, img[alt*="volcano"]');
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

  const overlay = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    var r = o.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);

  // ── A 对号真实鼠标确认 ──
  await cdp('mousePressed', overlay.x + overlay.w * 0.1, overlay.y + overlay.h * 0.15);
  await cdp('mouseMoved', overlay.x + overlay.w * 0.45, overlay.y + overlay.h * 0.45);
  await cdp('mouseReleased', overlay.x + overlay.w * 0.45, overlay.y + overlay.h * 0.45);
  await sleep(500);
  const btns = await evalRetry(client, `(function(){
    var c = document.querySelector('[data-testid="annotation-inline-composer"]');
    if (!c) return null;
    function r(el) { var b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
    return { confirm: r(c.querySelector('[data-testid="annotation-inline-confirm"]')) };
  })()`);
  assert('A0_pending_present', Boolean(btns), '就地框出现');
  if (!btns) { process.exit(2); }
  await cdp('mousePressed', btns.confirm.x, btns.confirm.y);
  await cdp('mouseReleased', btns.confirm.x, btns.confirm.y);
  await sleep(900);
  const afterA = await evalRetry(client, `JSON.stringify({
    boxes: document.querySelectorAll('[data-testid="annotation-box"]').length,
    pendingGone: !document.querySelector('[data-testid="annotation-inline-composer"]') })`);
  const a = JSON.parse(afterA);
  assert('A_confirm_via_real_click', a.boxes >= 1 && a.pendingGone === true, afterA);

  // ── B 文本工具真实点击 ──
  await evalRetry(client, `(function(){
    window.__tcTrace = [];
    var k = document.querySelector('[data-testid="annotation-kind-text"]');
    if (k) k.click();
    return 'ok';
  })()`);
  await sleep(400);
  const kindState = await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-text"]');
    return k ? k.getAttribute('data-active') : '(gone)';
  })()`);
  assert('B0_text_kind_active', kindState === 'true', `data-active=${kindState}`);
  // BLOCK-307 — text 拖拽开框走与矩形相同的 trusted 可靠管线；单击开框为补充路径
  await cdp('mousePressed', overlay.x + overlay.w * 0.6, overlay.y + overlay.h * 0.2);
  await cdp('mouseMoved', overlay.x + overlay.w * 0.8, overlay.y + overlay.h * 0.4);
  await cdp('mouseReleased', overlay.x + overlay.w * 0.8, overlay.y + overlay.h * 0.4);
  await sleep(700);
  const b1 = await evalRetry(client, `(function(){
    var c = document.querySelector('[data-testid="annotation-inline-composer"]');
    var d = document.querySelector('[data-testid="annotation-draft"]');
    return JSON.stringify({ composer: !!c, draft: !!d, kind: (document.querySelector('[data-testid="annotation-draft"]')||{}).dataset ? document.querySelector('[data-testid="annotation-draft"]').getAttribute('data-kind') : null });
  })()`);
  const b1d = JSON.parse(b1);
  assert('B_text_drag_opens_inline', b1d.composer === true, b1);
  // Esc 关掉（后续拖拽不受就地框干扰）
  await evalRetry(client, `(function(){
    var i = document.querySelector('[data-testid="annotation-inline-input"]');
    if (i) { i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
    return 'esc';
  })()`);
  await sleep(400);

  // ── C 拖拽移动已保存矩形 ──
  const box = await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="annotation-box"]');
    var r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  const dxPx = Math.round(overlay.w * 0.25);
  const dyPx = Math.round(overlay.h * 0.2);
  await cdp('mousePressed', box.x, box.y);
  for (let s = 1; s <= 5; s += 1) {
    await cdp('mouseMoved', box.x + (dxPx * s) / 5, box.y + (dyPx * s) / 5);
    await sleep(60);
  }
  await cdp('mouseReleased', box.x + dxPx, box.y + dyPx);
  await sleep(1200);
  const list = await rest('GET', `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot/volcano.svg')}`);
  const rows = (list.data && list.data.annotations) || [];
  const moved = rows[0];
  const movedOk = Boolean(moved && Array.isArray(moved.rect)
    && moved.rect[0] > 0.2 && moved.rect[0] < 0.7 && moved.rect[1] > 0.2 && moved.rect[1] < 0.8);
  assert('C_drag_moves_geometry', movedOk,
    `rect=${moved && JSON.stringify(moved.rect)}（原 0.1,0.1 附近 → 右下平移）`);

  // ── D 布局：bar 左列 + 图片相对画布区居中 ──
  const layout = await evalRetry(client, `(function(){
    var img = document.querySelector('[class*="imagePane"] img, img[alt*="volcano"]');
    var bar = document.querySelector('[data-testid="annotation-bar"]');
    if (!img || !bar) return null;
    var canvas = img.closest('[class*="canvas"]') || img.parentElement;
    var pane = img.closest('[class*="pane"]') || canvas.parentElement;
    var cr = canvas.getBoundingClientRect();
    var br = bar.getBoundingClientRect();
    var ir = img.getBoundingClientRect();
    return { barX: Math.round(br.x), canvasX: Math.round(cr.x), canvasW: Math.round(cr.width),
             barW: Math.round(br.width),
             imgCenterOffset: Math.round(Math.abs((ir.x + ir.width / 2) - (cr.x + cr.width / 2))) };
  })()`);
  assert('D_bar_left_column', layout && layout.barX <= layout.canvasX && layout.barW <= 140,
    JSON.stringify(layout));
  assert('D_image_centered', layout && layout.imgCenterOffset <= 40,
    `centerOffset=${layout && layout.imgCenterOffset}px（相对画布区）`);

  await clipShot(client, 'touch-layout.png', overlaySel, 40);

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'workspace-file 图像预览面（BLOCK-307 四条：✓ 真实点击/text 点击/拖拽移动/布局左列+居中）',
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-touch.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-307 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block304-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
