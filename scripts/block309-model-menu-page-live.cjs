#!/usr/bin/env node
'use strict';
/**
 * scripts/block309-model-menu-page-live.cjs — BLOCK-309 / UI-613 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block309-model-menu-page-live.cjs
 * 证据：acceptance/block-307/live-model-menu-page.json。
 *
 * 验证：
 *   A 供应商页：只有供应商行 + 自动档；无模型行、无 two-pane 灰底容器、无右列提示；
 *     菜单/供应商页/供应商行背景均不是灰底（页面与行透明）；
 *   B 点供应商 → 模型页：返回按钮 + 供应商标题/数量 + 模型行；自动档退场；
 *     当前模型行透明底 + 左侧 accent 细线（box-shadow inset）；
 *   C 返回 → 供应商页恢复。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-307');
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
    await sleep(500);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

async function clipShot(client, file, selector, pad = 24) {
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
    return 'saved';
  } catch (e) {
    return 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 80);
  }
}

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

  const created = await rest('POST', '/data/projects', { name: 'BLOCK309-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0a_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after nav' });
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="model-chip-model"]')`, { label: 'model chip' });
  await sleep(800);

  // 打开组合菜单
  await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="model-chip-model"]');
    b.click();
    return 'opened';
  })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="model-menu"]')`, { label: 'model menu' });
  await sleep(500);

  const pageOne = await evalRetry(client, `(function(){
    var menu = document.querySelector('[data-testid="model-menu"]');
    var page = document.querySelector('[data-testid="model-menu-suppliers-page"]');
    var rows = [...document.querySelectorAll('[data-testid^="model-menu-supplier-"]')];
    function bg(el){ return el ? getComputedStyle(el).backgroundColor : null; }
    var sample = rows[0] || null;
    return JSON.stringify({
      menu: !!menu,
      menuBg: bg(menu),
      menuW: menu ? Math.round(menu.getBoundingClientRect().width) : null,
      page: !!page,
      pageBg: bg(page),
      auto: !!document.querySelector('[data-testid="model-menu-auto"]'),
      twoPane: !!document.querySelector('[data-testid="model-menu-two-pane"]'),
      hint: !!document.querySelector('[data-testid="model-menu-hint"]'),
      modelRowsInPage: page ? page.querySelectorAll('.sc-model-option').length : null,
      suppliers: rows.map(function(row){
        var title = row.querySelector('.sc-model-option-title');
        var meta = row.querySelector('.sc-model-option-meta');
        return {
          testid: row.getAttribute('data-testid'),
          supplier: title ? title.textContent.trim() : '',
          meta: meta ? meta.textContent.trim() : '',
          bg: bg(row),
          chevron: !!row.querySelector('svg'),
        };
      }),
      firstRowBg: sample ? bg(sample) : null,
      status: (function(){ var s = document.querySelector('[data-testid="model-menu-status"]'); return s ? s.textContent.trim().slice(0, 80) : null; })(),
    });
  })()`);
  const p1 = JSON.parse(pageOne);
  assert('A0_supplier_page', p1.page === true, pageOne.slice(0, 180));
  assert('A1_suppliers_listed', p1.suppliers.length >= 1, `suppliers=${p1.suppliers.length} 样本=${JSON.stringify(p1.suppliers.slice(0, 3))}`);
  assert('A2_no_mixed_models',
    p1.modelRowsInPage === 0 && p1.twoPane === false && p1.hint === false,
    `modelRowsInPage=${p1.modelRowsInPage} twoPane=${p1.twoPane} hint=${p1.hint}`);
  assert('A3_no_gray_blocks',
    p1.pageBg === 'rgba(0, 0, 0, 0)' && p1.firstRowBg === 'rgba(0, 0, 0, 0)',
    `pageBg=${p1.pageBg} rowBg=${p1.firstRowBg} menuBg=${p1.menuBg}`);
  assert('A4_auto_on_supplier_page', p1.auto === true, `auto=${p1.auto}`);

  // 选一个「有可用模型」的供应商进入模型页
  const pick = p1.suppliers.find((row) => /个模型/.test(row.meta) && !row.meta.includes('无可用'));
  assert('B0_supplier_with_models', Boolean(pick), pick ? JSON.stringify(pick) : '没有可进入的供应商');
  if (!pick) { process.exit(2); }
  const expectedCount = (pick.meta.match(/(\d+) 个模型/) || [])[1];
  await evalRetry(client, `(function(){
    var row = document.querySelector('[data-testid=${JSON.stringify(pick.testid)}]');
    if (row) row.click();
    return 'drill';
  })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="model-menu-model-page"]')`, { label: 'model page' });
  await sleep(400);

  const pageTwo = await evalRetry(client, `(function(){
    var menu = document.querySelector('[data-testid="model-menu"]');
    var page = document.querySelector('[data-testid="model-menu-model-page"]');
    var head = page ? page.querySelector('.sc-model-page-head') : null;
    var rows = page ? [...page.querySelectorAll('.sc-model-option')] : [];
    var active = page ? page.querySelector('.sc-model-option-active') : null;
    function bg(el){ return el ? getComputedStyle(el).backgroundColor : null; }
    return JSON.stringify({
      page: !!page,
      back: !!document.querySelector('[data-testid="model-menu-back"]'),
      headText: head ? head.textContent.trim() : null,
      menuW: menu ? Math.round(menu.getBoundingClientRect().width) : null,
      menuBg: bg(menu),
      pageBg: bg(page),
      auto: !!document.querySelector('[data-testid="model-menu-auto"]'),
      twoPane: !!document.querySelector('[data-testid="model-menu-two-pane"]'),
      modelCount: rows.length,
      rows: rows.map(function(r){ return r.querySelector('.sc-model-option-title') ? r.querySelector('.sc-model-option-title').textContent.trim() : ''; }),
      active: active ? { bg: bg(active), boxShadow: getComputedStyle(active).boxShadow } : null,
    });
  })()`);
  const p2 = JSON.parse(pageTwo);
  assert('B1_model_page', p2.page === true && p2.back === true, pageTwo.slice(0, 180));
  assert('B2_head_shows_supplier', Boolean(p2.headText) && p2.headText.includes(pick.supplier) && /个模型/.test(p2.headText), `head=${p2.headText}`);
  assert('B3_models_listed',
    p2.modelCount >= 1 && (expectedCount ? String(p2.modelCount) === String(expectedCount) : true),
    `rows=${p2.modelCount} 期望=${expectedCount} 样本=${JSON.stringify(p2.rows.slice(0, 3))}`);
  assert('B4_page_focus_no_auto_no_mix', p2.auto === false && p2.twoPane === false, `auto=${p2.auto} twoPane=${p2.twoPane}`);
  assert('B5_active_row_clean',
    !p2.active || (p2.active.bg === 'rgba(0, 0, 0, 0)' && p2.active.boxShadow.includes('inset')),
    p2.active ? JSON.stringify(p2.active) : '当前模型不在该供应商（跳过）');
  assert('B6_menu_surface_not_gray', p2.menuBg !== 'rgba(128, 128, 128, 0.15)' && p2.menuBg !== p1.pageBg,
    `menuBg=${p2.menuBg}`);

  await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="model-menu-back"]');
    if (b) b.click();
    return 'back';
  })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="model-menu-suppliers-page"]')`, { label: 'back to suppliers' });
  const backOk = await evalRetry(client, `(function(){
    return JSON.stringify({
      supplierPage: !!document.querySelector('[data-testid="model-menu-suppliers-page"]'),
      modelPage: !!document.querySelector('[data-testid="model-menu-model-page"]'),
      auto: !!document.querySelector('[data-testid="model-menu-auto"]'),
    });
  })()`);
  const backState = JSON.parse(backOk);
  assert('C0_back_returns_to_suppliers',
    backState.supplierPage === true && backState.modelPage === false && backState.auto === true,
    backOk);

  const shot = await clipShot(client, 'model-menu-suppliers-page.png', '[data-testid="model-menu"]', 24);
  const shot2 = await clipShot(client, 'model-menu-model-page.png', '[data-testid="model-menu"]', 24);

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'composer 模型菜单（BLOCK-309/UI-613：供应商页 → 模型页下钻 + 去灰底）',
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    notes: { screenshotSupplier: shot, screenshotModel: shot2, menuWidth: p1.menuW, supplierChosen: pick.supplier },
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-model-menu-page.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-309 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block309-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
