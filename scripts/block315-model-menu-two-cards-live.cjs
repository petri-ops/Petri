#!/usr/bin/env node
'use strict';
/**
 * scripts/block315-model-menu-two-cards-live.cjs — BLOCK-315 / UI-619 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block315-model-menu-two-cards-live.cjs
 * 证据：acceptance/block-313/live-model-menu-two-cards.json。
 *
 * 用户请求「模仿智谱展开形式，一级和二级页面不要在同一个卡片中」：
 * A 主卡只放当前供应商的模型（供应商入口行 + 模型段），不含供应商列表；
 * B 点入口 → 供应商列表是独立第二卡（portal 到 body、fixed、贴主卡右侧、z 高于主卡）；
 * C 点其它供应商 → 主卡模型切换，第二卡保持展开（其它供应商始终可见）；
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
  var trigger = document.querySelector('[data-testid="model-menu-supplier-trigger"]');
  var panel = document.querySelector('[data-testid="model-menu-supplier-panel"]');
  var modelsBox = document.querySelector('[data-testid="model-menu-models"]');
  var inlineSupplierRows = menu ? menu.querySelectorAll('.sc-model-supplier').length : 0;
  var models = modelsBox ? [...modelsBox.querySelectorAll('.sc-model-option')].map(function(row){
    var title = row.querySelector('.sc-model-option-title');
    return {
      name: title ? title.textContent.trim() : '',
      disabled: row.disabled === true,
      active: row.classList.contains('sc-model-option-active'),
    };
  }) : [];
  var panelRows = panel ? [...panel.querySelectorAll('[data-testid^="model-menu-supplier-"]')].map(function(row){
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
  var triggerTitle = trigger ? trigger.querySelector('.sc-model-option-title') : null;
  return JSON.stringify({
    menu: !!menu,
    menuRect: rect(menu),
    menuWidth: menu ? Math.round(menu.getBoundingClientRect().width) : null,
    inlineSupplierRows: inlineSupplierRows,
    triggerText: trigger ? trigger.textContent.trim() : null,
    triggerSupplier: triggerTitle ? triggerTitle.textContent.trim() : null,
    panel: !!panel,
    panelParentIsBody: panel ? panel.parentElement === document.body : null,
    panelInsideMenu: panel && menu ? menu.contains(panel) : null,
    panelPlacement: panel ? panel.getAttribute('data-placement') : null,
    panelPosition: panel ? getComputedStyle(panel).position : null,
    panelZ: panel ? Number.parseInt(getComputedStyle(panel).zIndex, 10) : null,
    menuZ: menu ? Number.parseInt(getComputedStyle(menu).zIndex, 10) : null,
    panelRect: rect(panel),
    panelRows: panelRows,
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
  await pagePoll(client, `!!document.querySelector('[data-testid="model-menu-supplier-trigger"]')`, { label: 'supplier trigger' });
  await sleep(400);

  const main = JSON.parse(await evalRetry(client, READ_STATE));
  assert('A0_main_card_models_only',
    main.menu === true && Boolean(main.triggerSupplier) && main.models.length >= 1 && main.panel === false,
    `trigger=${main.triggerSupplier} models=${main.models.length} panel=${main.panel}`);
  assert('A1_no_inline_supplier_list',
    main.inlineSupplierRows === 0,
    `inline rows=${main.inlineSupplierRows}（主卡内不应有供应商行）`);
  assert('A2_main_card_compact', main.menuWidth !== null && main.menuWidth <= 380,
    `menuW=${main.menuWidth}（主卡单卡宽度）`);

  // B 打开独立供应商第二卡
  await evalRetry(client, `(function(){
    document.querySelector('[data-testid="model-menu-supplier-trigger"]').click();
    return 'open';
  })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="model-menu-supplier-panel"]')`, { label: 'supplier panel' });
  await sleep(400);
  const panel = JSON.parse(await evalRetry(client, READ_STATE));
  assert('B0_second_card_separate_dom',
    panel.panel === true && panel.panelParentIsBody === true && panel.panelInsideMenu === false,
    `parentBody=${panel.panelParentIsBody} insideMenu=${panel.panelInsideMenu}`);
  assert('B1_second_card_fixed_overlay',
    panel.panelPosition === 'fixed' && panel.panelZ > panel.menuZ,
    `position=${panel.panelPosition} z=${panel.panelZ}/${panel.menuZ}`);
  const gap = panel.panelRect && panel.menuRect ? panel.panelRect.left - panel.menuRect.right : null;
  assert('B2_second_card_beside_right',
    panel.panelPlacement === 'right' && gap !== null && gap >= 4 && gap <= 24,
    `placement=${panel.panelPlacement} gap=${gap}px panel=${JSON.stringify(panel.panelRect)} menu=${JSON.stringify(panel.menuRect)}`);
  assert('B3_second_card_in_viewport',
    Boolean(panel.panelRect)
      && panel.panelRect.left >= 0 && panel.panelRect.right <= panel.viewport.width
      && panel.panelRect.top >= 0 && panel.panelRect.bottom <= panel.viewport.height,
    `rect=${JSON.stringify(panel.panelRect)} viewport=${JSON.stringify(panel.viewport)}`);
  assert('B4_all_suppliers_with_current_check',
    panel.panelRows.length >= 2
      && panel.panelRows.filter((row) => row.active === 'true').length === 1
      && panel.panelRows.filter((row) => row.check).length === 1,
    `rows=${JSON.stringify(panel.panelRows.map((r) => r.supplier + (r.active === 'true' ? '*' : '')))} checks=${panel.panelRows.filter((r) => r.check).length}`);

  // C 点其它供应商：主卡换模型，第二卡保持展开
  const first = panel.panelRows[0];
  const second = panel.panelRows[1];
  const firstModelNames = panel.models.map((m) => m.name).join('|');
  await evalRetry(client, `(function(){
    var row = document.querySelector('[data-testid=${JSON.stringify(second.testid)}]');
    if (row) row.click();
    return 'clicked';
  })()`);
  await sleep(450);
  const switched = JSON.parse(await evalRetry(client, READ_STATE));
  const switchedModelNames = switched.models.map((m) => m.name).join('|');
  assert('C0_main_card_follows_supplier',
    switched.triggerSupplier === second.supplier && switched.models.length >= 1
      && (switchedModelNames !== firstModelNames || switched.models.length !== panel.models.length),
    `trigger=${switched.triggerSupplier} models=${switchedModelNames.slice(0, 120)}`);
  assert('C1_second_card_stays_open',
    switched.panel === true && switched.panelParentIsBody === true
      && switched.panelRows.length === panel.panelRows.length,
    `panel=${switched.panel} rows=${switched.panelRows.length}/${panel.panelRows.length}`);
  assert('C2_selected_moves_back',
    switched.panelRows.filter((row) => row.active === 'true').length === 1
      && switched.panelRows.find((row) => row.active === 'true')?.supplier === second.supplier,
    `active=${JSON.stringify(switched.panelRows.filter((r) => r.active === 'true').map((r) => r.supplier))}`);

  // 回切第一个供应商，主卡恢复
  await evalRetry(client, `(function(){
    var row = document.querySelector('[data-testid=${JSON.stringify(first.testid)}]');
    if (row) row.click();
    return 'clicked';
  })()`);
  await sleep(400);
  const back = JSON.parse(await evalRetry(client, READ_STATE));
  assert('C3_switch_back_restores',
    back.triggerSupplier === first.supplier && back.models.map((m) => m.name).join('|') === firstModelNames,
    `trigger=${back.triggerSupplier} models=${back.models.map((m) => m.name).join('|').slice(0, 120)}`);

  // D 点一个可用模型 → 整组菜单（含第二卡）关闭
  const pickable = back.models.find((m) => !m.disabled);
  assert('D0_pickable_model_available', Boolean(pickable), `models=${JSON.stringify(back.models)}`);
  if (pickable) {
    await evalRetry(client, `(function(){
      var rows = [...document.querySelectorAll('[data-testid="model-menu-models"] .sc-model-option')];
      var row = rows.find(function(r){ return !r.disabled; });
      if (row) row.click();
      return 'clicked';
    })()`);
    await pagePoll(client, `!document.querySelector('[data-testid="model-menu"]') && !document.querySelector('[data-testid="model-menu-supplier-panel"]')`, { label: 'menu closed' });
    assert('D1_menu_and_panel_closed', true, '点模型后主卡与第二卡同时退场');
  }

  const union = panel.menuRect && panel.panelRect ? {
    x: Math.min(panel.menuRect.left, panel.panelRect.left),
    y: Math.min(panel.menuRect.top, panel.panelRect.top),
    w: Math.max(panel.menuRect.right, panel.panelRect.right) - Math.min(panel.menuRect.left, panel.panelRect.left),
    h: Math.max(panel.menuRect.bottom, panel.panelRect.bottom) - Math.min(panel.menuRect.top, panel.panelRect.top),
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
    surface: 'composer 模型菜单（BLOCK-315/UI-619：主卡 + 独立供应商第二卡，仿智谱展开）',
    main, panel, switched, back,
    notes: { screenshot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-model-menu-two-cards.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-315 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block315-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
