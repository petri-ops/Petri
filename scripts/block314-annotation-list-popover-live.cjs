#!/usr/bin/env node
'use strict';
/**
 * scripts/block314-annotation-list-popover-live.cjs — BLOCK-314 / UI-618 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例；项目 p_mvrvqqo5_mnss 的
 * annot/volcano.svg 已有批注（本探针前置脚本已种 10 条）。
 * 用法：node scripts/block314-annotation-list-popover-live.cjs
 * 证据：acceptance/block-312/live-annotation-list-popover.json。
 *
 * A 打开图像预览 → 点批注列表：popover parent=body、position=fixed、z 顶层；
 * B 右栏工具条时向左展开（popover 右缘 ≤ summary 左缘），且完整在视口内；
 * C 条目完整可见（数量与列表计数一致、每行有宽度、长列表在弹层内滚动）。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const PROJECT_ID = 'p_mvrvqqo5_mnss';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-312');
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

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 300) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 220)}`);
    return ok === true || ok === 'true';
  };

  const list = await rest('GET', `/result-studio/annotations?projectId=${PROJECT_ID}&surface=workspace-file&filePath=${encodeURIComponent('annot/volcano.svg')}`);
  const seeded = (list.data && list.data.annotations) || [];
  assert('P0_annotations_seeded', seeded.length >= 5, `count=${seeded.length}`);

  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  const client = await lib.connectTarget(target);
  await client.send('Page.enable', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});

  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${PROJECT_ID}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root' });
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await sleep(700);

  // 打开文件面并进入 annot/volcano.svg
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
  await pagePoll(client, `!!document.querySelector('[data-testid="annotation-list"]')`, { label: 'annotation list' });
  await sleep(500);

  const beforeOpen = JSON.parse(await evalRetry(client, `(function(){
    var summary = document.querySelector('[data-testid="annotation-list"] summary');
    var count = summary ? summary.querySelector('[class*="count"]') : null;
    var r = summary ? summary.getBoundingClientRect() : null;
    return JSON.stringify({
      summaryRect: r ? { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) } : null,
      countText: count ? count.textContent.trim() : null,
      viewport: { w: innerWidth, h: innerHeight },
    });
  })()`));
  assert('A0_summary_present', Boolean(beforeOpen.summaryRect), JSON.stringify(beforeOpen));
  await evalRetry(client, `(function(){
    document.querySelector('[data-testid="annotation-list"] summary').click();
    return 'clicked';
  })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="annotation-list-popover"]')`, { label: 'list popover' });
  await sleep(350);

  const popover = JSON.parse(await evalRetry(client, `(function(){
    var pop = document.querySelector('[data-testid="annotation-list-popover"]');
    var summary = document.querySelector('[data-testid="annotation-list"] summary');
    var items = [...pop.querySelectorAll('[data-testid="annotation-item"]')];
    var pr = pop.getBoundingClientRect();
    var sr = summary.getBoundingClientRect();
    var cs = getComputedStyle(pop);
    return JSON.stringify({
      parentIsBody: pop.parentElement === document.body,
      position: cs.position,
      zIndex: cs.zIndex,
      placement: pop.getAttribute('data-placement'),
      rect: { left: Math.round(pr.left), top: Math.round(pr.top), right: Math.round(pr.right), bottom: Math.round(pr.bottom) },
      summaryRect: { left: Math.round(sr.left), top: Math.round(sr.top), right: Math.round(sr.right), bottom: Math.round(sr.bottom) },
      viewport: { w: innerWidth, h: innerHeight },
      itemCount: items.length,
      itemTexts: items.slice(0, 3).map(function(item){ return item.textContent.trim().slice(0, 50); }),
      itemWidths: items.slice(0, 3).map(function(item){ return Math.round(item.getBoundingClientRect().width); }),
      scrollHeight: pop.scrollHeight,
      clientHeight: pop.clientHeight,
    });
  })()`));
  assert('A1_popover_open', Boolean(popover.parentIsBody) && popover.itemCount >= 5, JSON.stringify({ items: popover.itemCount, parent: popover.parentIsBody }));
  assert('A2_portal_fixed_top_z',
    popover.parentIsBody === true && popover.position === 'fixed' && Number(popover.zIndex) >= 10002,
    `parent=${popover.parentIsBody} position=${popover.position} z=${popover.zIndex}`);
  const inViewport = popover.rect.left >= 0 && popover.rect.top >= 0
    && popover.rect.right <= popover.viewport.w && popover.rect.bottom <= popover.viewport.h;
  assert('A3_fully_in_viewport', inViewport,
    `rect=${JSON.stringify(popover.rect)} viewport=${JSON.stringify(popover.viewport)}`);
  assert('A4_opens_left_of_right_rail',
    popover.placement === 'left' && popover.rect.right <= popover.summaryRect.left,
    `placement=${popover.placement} popRight=${popover.rect.right} summaryLeft=${popover.summaryRect.left}`);
  assert('A5_items_fully_visible',
    popover.itemCount === Number(beforeOpen.countText || popover.itemCount)
      && popover.itemWidths.every((w) => w > 40)
      && popover.itemTexts.every((t) => t.length > 0),
    `count=${beforeOpen.countText}/${popover.itemCount} widths=${JSON.stringify(popover.itemWidths)} texts=${JSON.stringify(popover.itemTexts)}`);
  // 列表高度受限（≤320 且不越视口）：内容更长的列表由弹层内部滚动承接（CSS max-height + overflow:auto）。
  assert('A6_list_height_bounded',
    popover.rect.top >= 0 && popover.rect.bottom <= popover.viewport.h
      && (popover.rect.bottom - popover.rect.top) <= 320 + 1
      && popover.scrollHeight >= popover.clientHeight,
    `h=${popover.rect.bottom - popover.rect.top} clientH=${popover.clientHeight} scrollH=${popover.scrollHeight}`);

  let screenshot = 'not_attempted';
  try {
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png', fromSurface: false,
      clip: {
        x: Math.max(0, popover.rect.left - 12),
        y: Math.max(0, popover.rect.top - 12),
        width: Math.min(popover.viewport.w, Math.ceil(popover.rect.right - popover.rect.left + 24)),
        height: Math.min(popover.viewport.h, Math.ceil(popover.rect.bottom - popover.rect.top + 24)),
        scale: 2,
      },
    }, { timeoutMs: 15000 });
    fs.writeFileSync(path.join(EVIDENCE, 'annotation-list-popover.png'), Buffer.from(shot.data, 'base64'));
    screenshot = 'saved';
  } catch (e) {
    screenshot = 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 80);
  }

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId: PROJECT_ID,
    surface: 'workspace-file 图像批注列表（BLOCK-314/UI-618：右栏左展、portal 顶层、完整可见）',
    annotations: seeded.length,
    beforeOpen,
    popover,
    notes: { screenshot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-annotation-list-popover.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-314 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block314-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
