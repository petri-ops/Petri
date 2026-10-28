#!/usr/bin/env node
'use strict';
/**
 * scripts/block298-pending-preview-live.cjs — BLOCK-298 UI-599 实机腿：批注 pending 预览走查。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block298-pending-preview-live.cjs
 * 证据：acceptance/block-298/live-pending.json + clip PNG（可用时）。
 *
 * 场景（工作区文件预览图像面 · 用户原话场景「假如我使用了箭头批注」）：
 *   种子=临时项目 + annot/volcano.svg（BLOCK-219/278 同款夹具）；
 *   文件 tab → volcano.svg 预览 → **不点批注 toggle**（UI-599 自动打开语义）→
 *   选箭头工具 → CDP 真实鼠标拖拽 → 松手**立即**断言 pending 预览在场 →
 *   填评论 → 保存 → pending 退场 + 转正为 annotation-box；
 *   再画一笔 → pending 在场 → 取消 → pending 退场且无新条目。
 *
 * 断言面：
 *   D0 批注模式自动打开（不点 toggle，overlay data-drawing=true）；
 *   D1 箭头工具选中；
 *   D2 松手后 annotation-pending-rect 立即可见（用户裁决「批注不要隐藏」核心）；
 *   D3 composer 激活（input 未禁用 + save/cancel 在场）；
 *   D4 填评论保存 → pending 退场、annotation-box 转正在场；
 *   D5 REST：kind=arrow + rect 归一化（0..1）；
 *   D6 再画→取消 → pending 退场且条目数不增。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-298');
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
  const created = await rest('POST', '/data/projects', { name: 'BLOCK298-验收-' + Date.now(), modality: 'general' });
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
  // 崩溃横幅摘除（上实例强杀残留）
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

  // ── D0 批注模式自动打开（不点 toggle）──
  const drawing = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    return o ? o.getAttribute('data-drawing') : '(no overlay)';
  })()`);
  assert('D0_annotation_auto_open', drawing === 'true', `data-drawing=${drawing}（未点 toggle）`);

  // ── D1 箭头工具选中 ──
  await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-arrow"]');
    if (!k) return 'no_kind';
    k.click();
    return 'selected';
  })()`);
  await sleep(300);
  const kind = await evalRetry(client, `(function(){
    var k = document.querySelector('[data-testid="annotation-kind-arrow"]');
    return k ? k.getAttribute('data-active') : '(gone)';
  })()`);
  assert('D1_arrow_kind_active', kind === 'true', `data-active=${kind}`);

  // ── D2 拖拽画箭头 → 松手后 pending 预览立即可见 ──
  const rect = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    var r = o.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  assert('D2a_overlay_rect', rect && rect.w > 40 && rect.h > 40, JSON.stringify(rect));
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
  const pending = await evalRetry(client, `(function(){
    var p = document.querySelector('[data-testid="annotation-pending-rect"]');
    if (!p) return null;
    var r = p.getBoundingClientRect();
    var i = document.querySelector('[data-testid="annotation-comment-input"]');
    var s = document.querySelector('[data-testid="annotation-save"]');
    var c = document.querySelector('[data-testid="annotation-cancel"]');
    return { visible: r.width > 0 && r.height > 0, left: p.style.left, width: p.style.width,
             inputEnabled: !!i && !i.disabled, savePresent: !!s, cancelPresent: !!c };
  })()`);
  assert('D2b_pending_preview_visible', pending && pending.visible === true,
    JSON.stringify(pending || 'no pending element'));
  assert('D3_composer_active', pending && pending.inputEnabled === true
    && pending.savePresent === true && pending.cancelPresent === true,
    `input=${pending && pending.inputEnabled} save=${pending && pending.savePresent} cancel=${pending && pending.cancelPresent}`);

  await clipShot(client, 'pending-preview.png', overlaySel, 30);

  // ── D4 填评论 → 保存 → pending 退场转正 ──
  await evalRetry(client, `(function(){
    var i = document.querySelector('[data-testid="annotation-comment-input"]');
    i.focus();
    document.execCommand('insertText', false, 'BLOCK-298 箭头 pending 预览走查');
    return 'typed';
  })()`);
  await evalRetry(client, `(function(){
    var s = document.querySelector('[data-testid="annotation-save"]');
    if (!s) return 'no_save';
    s.click();
    return 'saved';
  })()`);
  await pagePoll(client, `String(document.querySelectorAll('[data-testid="annotation-box"]').length >= 1)`,
    { label: 'annotation-box after save' });
  const afterSave = await evalRetry(client, `(function(){
    var p = document.querySelector('[data-testid="annotation-pending-rect"]');
    var b = document.querySelector('[data-testid="annotation-box"]');
    return { pendingGone: !p, boxKind: b ? b.getAttribute('data-kind') : '(none)' };
  })()`);
  assert('D4_saved_converted', afterSave.pendingGone === true && afterSave.boxKind === 'arrow',
    JSON.stringify(afterSave));

  // ── D5 REST 契约：kind=arrow + rect 归一化 ──
  const list = await rest('GET', `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot/volcano.svg')}`);
  const rows = (list.data && list.data.annotations) || [];
  const arrow = rows.find((a) => a.kind === 'arrow');
  const inRange = Boolean(arrow && Array.isArray(arrow.rect) && arrow.rect.length === 4
    && arrow.rect.every((v) => v >= 0 && v <= 1));
  assert('D5_rest_arrow_contract',
    rows.length >= 1 && Boolean(arrow) && Boolean(inRange),
    `rows=${rows.length} arrow=${Boolean(arrow)} rect=${arrow && JSON.stringify(arrow.rect)}`);

  // ── D6 再画 → 取消 → pending 退场且条目数不增 ──
  const itemsBefore = await evalRetry(client, `document.querySelectorAll('[data-testid="annotation-box"]').length`);
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
  const pendingAgain = await evalRetry(client, `!!document.querySelector('[data-testid="annotation-pending-rect"]')`);
  await evalRetry(client, `(function(){
    var c = document.querySelector('[data-testid="annotation-cancel"]');
    if (!c) return 'no_cancel';
    c.click();
    return 'cancelled';
  })()`);
  await sleep(500);
  const afterCancel = await evalRetry(client, `(function(){
    var p = document.querySelector('[data-testid="annotation-pending-rect"]');
    return { pendingGone: !p, boxes: document.querySelectorAll('[data-testid="annotation-box"]').length };
  })()`);
  assert('D6_cancel_no_new_item',
    pendingAgain === true && afterCancel.pendingGone === true && Number(afterCancel.boxes) === Number(itemsBefore),
    `pendingAgain=${pendingAgain} after=${JSON.stringify(afterCancel)} before=${itemsBefore}`);

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'workspace-file 图像预览面（用户原话场景：箭头批注画完保持可见）',
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-pending.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-298 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block298-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
