#!/usr/bin/env node
'use strict';
/**
 * scripts/block312-image-preview-layers-live.cjs — BLOCK-312 / UI-616 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block312-image-preview-layers-live.cjs
 * 证据：acceptance/block-310/live-image-preview-layers.json。
 *
 * A 输入框图片预览（ImagePreviewModal）：drop 图片附件 → 点缩略图开预览：
 *   overlay 父节点=body、覆盖视口、z=100000；标题栏与所有列分隔（resizeHandleV）
 *   位置 elementFromPoint 命中 overlay（不再被顶栏/左右分隔线压住）。
 * B 灯箱（Lightbox，工作区文件图像）：open 工作区 fixture 图像 → 点图开灯箱：
 *   同口径（body/视口/100000/命中最上层）。两处都验完即覆盖当前所有模态图片预览。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-310');
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
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1000); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 25000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(500);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
<rect width="400" height="300" fill="#ffffff"/>
<rect x="20" y="20" width="160" height="120" fill="#4f46e5"/>
<circle cx="300" cy="150" r="60" fill="#14b8a6"/>
</svg>`;

async function clipShot(client, file, selector, pad = 12) {
  const rect = await evalRetry(client, `(function(){
    var e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null;
    var r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  if (!rect || rect.w <= 0) return 'no_rect';
  try {
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png', fromSurface: false,
      clip: {
        x: Math.max(0, Math.floor(rect.x - pad)),
        y: Math.max(0, Math.floor(rect.y - pad)),
        width: Math.ceil(rect.w + pad * 2),
        height: Math.ceil(rect.h + pad * 2),
        scale: 2,
      },
    }, { timeoutMs: 20000 });
    fs.writeFileSync(path.join(EVIDENCE, file), Buffer.from(shot.data, 'base64'));
    return 'saved';
  } catch (e) {
    return 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 80);
  }
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 280) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 200)}`);
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

  const created = await rest('POST', '/data/projects', { name: 'BLOCK312-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  const projResp = projectId ? await rest('GET', '/data/projects/' + encodeURIComponent(projectId)) : null;
  const workspacePath = projResp && projResp.data && (projResp.data.project
    ? projResp.data.project.workspace_path : projResp.data.workspace_path);
  assert('P0_project_created', Boolean(projectId && workspacePath), `id=${projectId || 'none'}`);
  const fixtureDir = path.join(workspacePath, 'annot');
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(path.join(fixtureDir, 'volcano.svg'), SVG, 'utf8');

  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root' });
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await pagePoll(client, `!!document.querySelector('.sc-composer')`, { label: 'composer' });
  await sleep(700);

  const readLayers = (selector) => evalRetry(client, `(function(){
    var overlay = document.querySelector(${JSON.stringify(selector)});
    if (!overlay) return null;
    var rect = overlay.getBoundingClientRect();
    var handles = [...document.querySelectorAll('[class*="resizeHandleV"]')].map(function(h){
      var r = h.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    var points = [{ x: Math.round(innerWidth / 2), y: 16 }].concat(handles);
    var hits = points.map(function(point){
      var el = document.elementFromPoint(point.x, point.y);
      return {
        x: point.x, y: point.y,
        ok: !!el && (el === overlay || overlay.contains(el)),
        hit: el ? el.tagName + '.' + String(el.className || '').slice(0, 32) : null,
      };
    });
    var panel = overlay.querySelector('[class*="sc-preview-container"], img');
    var pr = panel ? panel.getBoundingClientRect() : null;
    return JSON.stringify({
      parentIsBody: overlay.parentElement === document.body,
      zIndex: getComputedStyle(overlay).zIndex,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      viewport: { w: innerWidth, h: innerHeight },
      panelInViewport: !!pr && pr.x >= -1 && pr.y >= -1 && pr.right <= innerWidth + 1 && pr.bottom <= innerHeight + 1,
      handles,
      hits,
    });
  })()`);

  // ── A 输入框图片预览（ImagePreviewModal） ──
  await evalRetry(client, `(async function(){
    var canvas = document.createElement('canvas');
    canvas.width = 24; canvas.height = 24;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#4f46e5'; ctx.fillRect(0, 0, 24, 24);
    var blob = await new Promise(function(resolve){ canvas.toBlob(resolve, 'image/png'); });
    var file = new File([blob], 'layer-test.png', { type: 'image/png' });
    var dt = new DataTransfer();
    dt.items.add(file);
    var el = document.querySelector('.sc-composer');
    ['dragenter', 'dragover', 'drop'].forEach(function(type){
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    return 'dropped';
  })()`);
  await pagePoll(client, `!!document.querySelector('.sc-attachment-preview-btn')`, { label: 'attachment preview' });
  await evalRetry(client, `(function(){
    document.querySelector('.sc-attachment-preview-btn').click();
    return 'preview';
  })()`);
  await pagePoll(client, `!!document.querySelector('.sc-preview-overlay')`, { label: 'image preview modal' });
  await sleep(400);
  const modalLayer = JSON.parse(await readLayers('.sc-preview-overlay'));
  assert('A0_modal_open', Boolean(modalLayer), '图片预览打开');
  assert('A1_modal_parent_body', Boolean(modalLayer) && modalLayer.parentIsBody === true,
    `parentBody=${modalLayer && modalLayer.parentIsBody}`);
  assert('A2_modal_covers_viewport',
    Boolean(modalLayer) && modalLayer.rect.x === 0 && modalLayer.rect.y === 0
      && modalLayer.rect.w === modalLayer.viewport.w && modalLayer.rect.h === modalLayer.viewport.h,
    JSON.stringify(modalLayer && { rect: modalLayer.rect, viewport: modalLayer.viewport }));
  assert('A3_modal_z_top', Boolean(modalLayer) && Number(modalLayer.zIndex) >= 100000,
    `z-index=${modalLayer && modalLayer.zIndex}`);
  assert('A4_modal_panel_in_viewport', Boolean(modalLayer) && modalLayer.panelInViewport === true,
    `panelInViewport=${modalLayer && modalLayer.panelInViewport}`);
  const modalMisses = modalLayer ? modalLayer.hits.filter((h) => !h.ok) : [];
  assert('A5_modal_hits_titlebar_and_dividers',
    Boolean(modalLayer) && modalLayer.hits.length >= 3 && modalMisses.length === 0,
    `points=${modalLayer && modalLayer.hits.length} misses=${JSON.stringify(modalMisses)}`);
  const modalShot = await clipShot(client, 'image-preview-modal-layer.png', '.sc-preview-overlay', 0);

  // 关闭预览
  await evalRetry(client, `(function(){
    var close = document.querySelector('.sc-preview-close-btn');
    if (close) { close.click(); return 'closed'; }
    return 'no_close';
  })()`);
  await sleep(400);

  // ── B 灯箱（Lightbox：工作区文件图像） ──
  // 通过标题栏工具菜单打开文件面（避免依赖空态卡片）
  await evalRetry(client, `(function(){
    var b = document.querySelector('[aria-label="展开更多工具"]');
    if (b) b.click();
    return 'menu';
  })()`);
  await pagePoll(client, `!!document.getElementById('titlebar-tool-menu')`, { label: 'tool menu' });
  await evalRetry(client, `(function(){
    var menu = document.getElementById('titlebar-tool-menu');
    if (!menu) return 'no_menu';
    var item = [...menu.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '文件'; });
    if (item) item.click();
    return item ? 'files' : 'no_item';
  })()`);
  await sleep(700);
  await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){ return el.textContent.indexOf('annot') >= 0; }))`, { label: 'annot dir' });
  await evalRetry(client, `(function(){
    var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){ return el.textContent.indexOf('annot') >= 0; });
    if (row) row.click();
    return 'expand';
  })()`);
  await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){ return el.textContent.indexOf('volcano.svg') >= 0; }))`, { label: 'svg row' });
  await evalRetry(client, `(function(){
    var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){ return el.textContent.indexOf('volcano.svg') >= 0; });
    if (row) row.click();
    return 'open';
  })()`);
  await pagePoll(client, `(function(){
    var img = document.querySelector('img[alt*="volcano"]');
    return img && img.complete && img.naturalWidth > 0 ? 'loaded' : '';
  })()`, { label: 'image loaded', timeoutMs: 30000 });
  await sleep(400);
  await evalRetry(client, `(function(){
    var img = document.querySelector('img[alt*="volcano"]');
    var btn = img ? img.closest('button') : null;
    if (btn) { btn.click(); return 'open_lightbox'; }
    return 'no_trigger';
  })()`);
  await pagePoll(client, `!!document.querySelector('.petri-lightbox')`, { label: 'lightbox' });
  await sleep(400);
  const lightboxLayer = JSON.parse(await readLayers('.petri-lightbox'));
  assert('B0_lightbox_open', Boolean(lightboxLayer), '工作区灯箱打开');
  assert('B1_lightbox_parent_body', Boolean(lightboxLayer) && lightboxLayer.parentIsBody === true,
    `parentBody=${lightboxLayer && lightboxLayer.parentIsBody}`);
  assert('B2_lightbox_z_top', Boolean(lightboxLayer) && Number(lightboxLayer.zIndex) >= 100000,
    `z-index=${lightboxLayer && lightboxLayer.zIndex}`);
  const lightboxMisses = lightboxLayer ? lightboxLayer.hits.filter((h) => !h.ok) : [];
  assert('B3_lightbox_hits_titlebar_and_dividers',
    Boolean(lightboxLayer) && lightboxLayer.hits.length >= 3 && lightboxMisses.length === 0,
    `points=${lightboxLayer && lightboxLayer.hits.length} misses=${JSON.stringify(lightboxMisses)}`);
  const lightboxShot = await clipShot(client, 'lightbox-layer.png', '.petri-lightbox', 0);

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: '图片预览层级（BLOCK-312/UI-616：输入框预览 portal/顶层 + 灯箱同口径复核）',
    modal: modalLayer,
    lightbox: lightboxLayer,
    notes: { modalShot, lightboxShot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-image-preview-layers.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-312 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block312-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
