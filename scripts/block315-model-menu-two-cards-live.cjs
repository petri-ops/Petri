#!/usr/bin/env node
'use strict';
/**
 * scripts/block315-model-menu-two-cards-live.cjs — BLOCK-315 / UI-619 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block315-model-menu-two-cards-live.cjs
 * 证据：acceptance/block-313/live-model-menu-two-cards.json。
 *
 * 用户请求「模仿智谱展开形式，一级和二级页面不要在同一个卡片中；左侧主卡片是供应商 右侧是模型」：
 * A 左主卡=供应商列表（全部供应商 + 当前使用勾），卡内不再有模型列表；
 * B 右侧模型卡是独立第二卡（portal 到 body、fixed、贴主卡右侧 8px、z 高于主卡）；
 * C 点其它供应商 → 模型卡换内容、两卡同时在场（其它供应商始终可见）；
 * D 点模型 → 整组菜单关闭。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-313');
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

const READ_STATE = `(function(){
  function rect(el){
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left), top: Math.round(r.top),
      right: Math.round(r.right), bottom: Math.round(r.bottom),
      width: Math.round(r.width), height: Math.round(r.height),
    };
  }
  var menu = document.querySelector('[data-testid="model-menu"]');
  var supplierBox = document.querySelector('[data-testid="model-menu-suppliers"]');
  var panel = document.querySelector('[data-testid="model-menu-models-panel"]');
  var head = document.querySelector('[data-testid="model-menu-models-head"]');
  var supplierRows = supplierBox ? [...supplierBox.querySelectorAll('.sc-model-supplier')].map(function(row){
    var title = row.querySelector('.sc-model-option-title');
    var meta = row.querySelector('.sc-model-option-meta');
    return {
      testid: row.getAttribute('data-testid'),
      supplier: title ? title.textContent.trim() : '',
      meta: meta ? meta.textContent.trim() : '',
      active: row.getAttribute('data-active'),
      check: !!row.querySelector('svg'),
    };
  }) : [];
  var models = panel ? [...panel.querySelectorAll('.sc-model-option')].map(function(row){
    var title = row.querySelector('.sc-model-option-title');
    return {
      name: title ? title.textContent.trim() : '',
      disabled: row.disabled === true,
      active: row.classList.contains('sc-model-option-active'),
    };
  }) : [];
  return JSON.stringify({
    menu: !!menu,
    menuRect: rect(menu),
    menuWidth: menu ? Math.round(menu.getBoundingClientRect().width) : null,
    auto: !!document.querySelector('[data-testid="model-menu-auto"]'),
    mainHasModelList: menu ? menu.querySelectorAll('[data-testid="model-menu-models"], .sc-model-models-panel').length : null,
    supplierRows: supplierRows,
    panel: !!panel,
    panelParentIsBody: panel ? panel.parentElement === document.body : null,
    panelInsideMenu: panel && menu ? menu.contains(panel) : null,
    panelPlacement: panel ? panel.getAttribute('data-placement') : null,
    panelPosition: panel ? getComputedStyle(panel).position : null,
    panelZ: panel ? Number.parseInt(getComputedStyle(panel).zIndex, 10) : null,
    menuZ: menu ? Number.parseInt(getComputedStyle(menu).zIndex, 10) : null,
    panelRect: rect(panel),
    headText: head ? head.textContent.trim() : null,
    models: models,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
})()`;

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 300) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 220)}`);
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

  const created = await rest('POST', '/data/projects', { name: 'BLOCK315-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root' });
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="model-chip-model"]')`, { label: 'model chip' });
  await sleep(700);
  await evalRetry(client, `(function(){ document.querySelector('[data-testid="model-chip-model"]').click(); return 'open'; })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="model-menu-suppliers"]') && !!document.querySelector('[data-testid="model-menu-models-panel"]')`, { label: 'two cards' });
  await sleep(400);

  const main = JSON.parse(await evalRetry(client, READ_STATE));
  assert('A0_left_card_lists_suppliers',
    main.menu === true && main.supplierRows.length >= 2 && main.panel === true && main.models.length >= 1,
    `suppliers=${JSON.stringify(main.supplierRows.map((r) => r.supplier))} models=${main.models.length}`);
  assert('A1_left_card_has_no_model_list',
    main.mainHasModelList === 0,
    `mainHasModelList=${main.mainHasModelList}（主卡内不应有模型列表）`);
  assert('A2_main_card_compact', main.menuWidth !== null && main.menuWidth <= 380,
    `menuW=${main.menuWidth}（左主卡单卡宽度）`);
  assert('A3_current_supplier_checked',
    main.supplierRows.filter((row) => row.active === 'true').length === 1
      && main.supplierRows.filter((row) => row.check).length === 1,
    `active=${JSON.stringify(main.supplierRows.filter((r) => r.active === 'true').map((r) => r.supplier))} checks=${main.supplierRows.filter((r) => r.check).length}`);

  assert('B0_model_card_separate_dom',
    main.panel === true && main.panelParentIsBody === true && main.panelInsideMenu === false,
    `parentBody=${main.panelParentIsBody} insideMenu=${main.panelInsideMenu}`);
  assert('B1_model_card_fixed_overlay',
    main.panelPosition === 'fixed' && main.panelZ > main.menuZ,
    `position=${main.panelPosition} z=${main.panelZ}/${main.menuZ}`);
  const gap = main.panelRect && main.menuRect ? main.panelRect.left - main.menuRect.right : null;
  assert('B2_model_card_beside_right',
    main.panelPlacement === 'right' && gap !== null && gap >= 4 && gap <= 24,
    `placement=${main.panelPlacement} gap=${gap}px panel=${JSON.stringify(main.panelRect)} menu=${JSON.stringify(main.menuRect)}`);
  assert('B3_model_card_in_viewport',
    Boolean(main.panelRect)
      && main.panelRect.left >= 0 && main.panelRect.right <= main.viewport.width
      && main.panelRect.top >= 0 && main.panelRect.bottom <= main.viewport.height,
    `rect=${JSON.stringify(main.panelRect)} viewport=${JSON.stringify(main.viewport)}`);
  assert('B4_model_card_shows_current_supplier_models',
    Boolean(main.headText) && main.headText.includes(main.supplierRows.find((row) => row.active === 'true')?.supplier || '')
      && main.models.length >= 1,
    `head=${main.headText} models=${JSON.stringify(main.models.map((m) => m.name))}`);

  // C 点其它供应商：右侧模型卡换内容，左主卡全部供应商保持
  const first = main.supplierRows.find((row) => row.active === 'true') || main.supplierRows[0];
  const second = main.supplierRows.find((row) => row.testid !== first.testid);
  const firstModelNames = main.models.map((m) => m.name).join('|');
  await evalRetry(client, `(function(){
    var row = document.querySelector('[data-testid=${JSON.stringify(second.testid)}]');
    if (row) row.click();
    return 'clicked';
  })()`);
  await sleep(450);
  const switched = JSON.parse(await evalRetry(client, READ_STATE));
  const switchedModelNames = switched.models.map((m) => m.name).join('|');
  assert('C0_model_card_follows_supplier',
    Boolean(switched.headText) && switched.headText.includes(second.supplier) && switched.models.length >= 1
      && (switchedModelNames !== firstModelNames || switched.models.length !== main.models.length),
    `head=${switched.headText} models=${switchedModelNames.slice(0, 120)}`);
  assert('C1_both_cards_stay_visible',
    switched.panel === true && switched.panelParentIsBody === true
      && switched.supplierRows.length === main.supplierRows.length,
    `panel=${switched.panel} supplierRows=${switched.supplierRows.length}/${main.supplierRows.length}`);
  assert('C2_active_moves',
    switched.supplierRows.filter((row) => row.active === 'true').length === 1
      && switched.supplierRows.find((row) => row.active === 'true')?.supplier === second.supplier,
    `active=${JSON.stringify(switched.supplierRows.filter((r) => r.active === 'true').map((r) => r.supplier))}`);

  // 回切第一个供应商，模型卡恢复
  await evalRetry(client, `(function(){
    var row = document.querySelector('[data-testid=${JSON.stringify(first.testid)}]');
    if (row) row.click();
    return 'clicked';
  })()`);
  await sleep(400);
  const back = JSON.parse(await evalRetry(client, READ_STATE));
  assert('C3_switch_back_restores',
    Boolean(back.headText) && back.headText.includes(first.supplier)
      && back.models.map((m) => m.name).join('|') === firstModelNames,
    `head=${back.headText} models=${back.models.map((m) => m.name).join('|').slice(0, 120)}`);

  // D 点右侧模型卡里的可用模型 → 整组菜单（含两卡）关闭
  const pickable = back.models.find((m) => !m.disabled);
  assert('D0_pickable_model_available', Boolean(pickable), `models=${JSON.stringify(back.models)}`);
  if (pickable) {
    await evalRetry(client, `(function(){
      var rows = [...document.querySelectorAll('[data-testid="model-menu-models-panel"] .sc-model-option')];
      var row = rows.find(function(r){ return !r.disabled; });
      if (row) row.click();
      return 'clicked';
    })()`);
    await pagePoll(client, `!document.querySelector('[data-testid="model-menu"]') && !document.querySelector('[data-testid="model-menu-models-panel"]')`, { label: 'menu closed' });
    assert('D1_menu_and_model_card_closed', true, '点模型后左主卡与右模型卡同时退场');
  }

  const union = main.menuRect && main.panelRect ? {
    x: Math.min(main.menuRect.left, main.panelRect.left),
    y: Math.min(main.menuRect.top, main.panelRect.top),
    w: Math.max(main.menuRect.right, main.panelRect.right) - Math.min(main.menuRect.left, main.panelRect.left),
    h: Math.max(main.menuRect.bottom, main.panelRect.bottom) - Math.min(main.menuRect.top, main.panelRect.top),
  } : null;
  let screenshot = 'not_attempted';
  if (union) {
    try {
      const shot = await client.send('Page.captureScreenshot', {
        format: 'png', fromSurface: false,
        clip: { x: Math.max(0, Math.floor(union.x - 10)), y: Math.max(0, Math.floor(union.y - 10)), width: Math.ceil(union.w + 20), height: Math.ceil(union.h + 20), scale: 2 },
      }, { timeoutMs: 15000 });
      fs.writeFileSync(path.join(EVIDENCE, 'model-menu-two-cards.png'), Buffer.from(shot.data, 'base64'));
      screenshot = 'saved';
    } catch (e) {
      screenshot = 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 100);
    }
  }

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'composer 模型菜单（BLOCK-315/UI-619：左主卡=供应商 / 右独立卡=模型，仿智谱展开）',
    main, switched, back,
    notes: { screenshot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-model-menu-two-cards.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-315 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block315-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
