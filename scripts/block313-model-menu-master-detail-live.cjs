#!/usr/bin/env node
'use strict';
/**
 * scripts/block313-model-menu-master-detail-live.cjs — BLOCK-313 / UI-617 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block313-model-menu-master-detail-live.cjs
 * 证据：acceptance/block-311/live-model-menu-master-detail.json。
 *
 * A 打开模型菜单：主从两栏 + 自动档；默认右栏=当前模型所在供应商的模型（打开即见）；
 *   菜单宽 620；左/右透明底、1px 边框分隔、选中供应商 accent 细线（无灰底）；
 * B 点第二个供应商：右栏标题/模型切换，左列供应商行数不变（不消失）；
 * C 再点回第一个供应商：右栏恢复。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-311');
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

  const created = await rest('POST', '/data/projects', { name: 'BLOCK313-验收-' + Date.now(), modality: 'general' });
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
  await pagePoll(client, `!!document.querySelector('[data-testid="model-menu-two-pane"]')`, { label: 'two-pane' });
  await sleep(400);

  const read = () => evalRetry(client, `(function(){
    var menu = document.querySelector('[data-testid="model-menu"]');
    var pane = document.querySelector('[data-testid="model-menu-two-pane"]');
    var models = document.querySelector('[data-testid="model-menu-models"]');
    var head = document.querySelector('[data-testid="model-menu-models-head"]');
    var rows = [...document.querySelectorAll('[data-testid^="model-menu-supplier-"]')];
    function bg(el){ return el ? getComputedStyle(el).backgroundColor : null; }
    return JSON.stringify({
      menu: !!menu,
      menuW: menu ? Math.round(menu.getBoundingClientRect().width) : null,
      menuBg: bg(menu),
      paneBg: bg(pane),
      modelsBorderLeft: models ? getComputedStyle(models).borderLeftWidth : null,
      auto: !!document.querySelector('[data-testid="model-menu-auto"]'),
      supplierCount: rows.length,
      suppliers: rows.map(function(row){
        var t = row.querySelector('.sc-model-option-title');
        var m = row.querySelector('.sc-model-option-meta');
        return {
          testid: row.getAttribute('data-testid'),
          supplier: t ? t.textContent.trim() : '',
          meta: m ? m.textContent.trim() : '',
          active: row.getAttribute('data-active'),
          bg: bg(row),
          shadow: getComputedStyle(row).boxShadow,
        };
      }),
      headText: head ? head.textContent.trim() : null,
      models: models ? [...models.querySelectorAll('.sc-model-option')].map(function(r){
        var t = r.querySelector('.sc-model-option-title');
        return {
          name: t ? t.textContent.trim() : '',
          active: r.classList.contains('sc-model-option-active') || r.getAttribute('data-active') === 'true',
          bg: bg(r),
        };
      }) : [],
    });
  })()`);

  const open = JSON.parse(await read());
  assert('A0_master_detail_open',
    Boolean(open.menu) && open.supplierCount >= 2 && open.auto === true && open.models.length >= 1,
    `suppliers=${open.supplierCount} models=${open.models.length} auto=${open.auto}`);
  assert('A1_menu_width_620', open.menuW >= 600 && open.menuW <= 640, `menuW=${open.menuW}`);
  assert('A2_default_selected_supplier_with_models',
    open.suppliers.filter((row) => row.active === 'true').length === 1
      && Boolean(open.headText) && open.models.length >= 1,
    `head=${open.headText} 选中=${JSON.stringify(open.suppliers.filter((r) => r.active === 'true').map((r) => r.supplier))} models=${JSON.stringify(open.models.map((m) => m.name))}`);
  const grayFails = [];
  if (open.paneBg !== 'rgba(0, 0, 0, 0)') grayFails.push('pane=' + open.paneBg);
  const selectedRow = open.suppliers.find((row) => row.active === 'true');
  if (selectedRow && selectedRow.bg !== 'rgba(0, 0, 0, 0)') grayFails.push('selectedRow=' + selectedRow.bg);
  const borderWidth = Number.parseFloat(open.modelsBorderLeft || '0');
  // 缩放环境下 1px 计算值可能是 0.8px；只要是细线（0<w≤2）即合规。
  if (!(borderWidth > 0 && borderWidth <= 2)) grayFails.push('border=' + open.modelsBorderLeft);
  assert('A3_clean_no_gray_and_border', grayFails.length === 0, `menuBg=${open.menuBg} ${grayFails.join(' ')}`);
  assert('A4_selected_accent_line',
    Boolean(selectedRow) && selectedRow.shadow.includes('inset'),
    `shadow=${selectedRow && selectedRow.shadow}`);

  // B 点第二个供应商：右栏切换，左列不消失
  const second = open.suppliers[1];
  const firstSupplier = open.suppliers[0];
  assert('B0_second_supplier_available', Boolean(second), JSON.stringify(second));
  await evalRetry(client, `(function(){
    var row = document.querySelector('[data-testid=${JSON.stringify(second.testid)}]');
    if (row) row.click();
    return 'clicked';
  })()`);
  await sleep(400);
  const afterSecond = JSON.parse(await read());
  const expectedSecond = (second.meta.match(/(\d+) 个模型/) || [])[1];
  assert('B1_right_pane_switches',
    Boolean(afterSecond.headText) && afterSecond.headText.includes(second.supplier)
      && afterSecond.models.length >= 1
      && (!expectedSecond || afterSecond.models.length === Number(expectedSecond)),
    `head=${afterSecond.headText} models=${afterSecond.models.length} 期望=${expectedSecond}`);
  assert('B2_left_list_persists',
    afterSecond.supplierCount === open.supplierCount
      && afterSecond.suppliers.some((r) => r.supplier === firstSupplier.supplier),
    `count=${open.supplierCount}→${afterSecond.supplierCount} first=${firstSupplier.supplier}`);
  assert('B3_selected_moves',
    afterSecond.suppliers.find((row) => row.active === 'true')?.supplier === second.supplier,
    JSON.stringify(afterSecond.suppliers.filter((r) => r.active === 'true').map((r) => r.supplier)));

  // C 点回第一个供应商：右栏恢复
  await evalRetry(client, `(function(){
    var row = document.querySelector('[data-testid=${JSON.stringify(firstSupplier.testid)}]');
    if (row) row.click();
    return 'clicked';
  })()`);
  await sleep(400);
  const afterBack = JSON.parse(await read());
  assert('C0_switch_back_restores',
    Boolean(afterBack.headText) && afterBack.headText.includes(firstSupplier.supplier)
      && afterBack.models.length === open.models.length,
    `head=${afterBack.headText} models=${afterBack.models.length}/${open.models.length}`);

  const shot = await evalRetry(client, `(function(){
    var m = document.querySelector('[data-testid="model-menu"]');
    if (!m) return 'no_menu';
    var r = m.getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
  })()`).catch(() => null);
  let screenshot = 'not_attempted';
  try {
    const rect = JSON.parse(shot);
    const page = await client.send('Page.captureScreenshot', {
      format: 'png', fromSurface: false,
      clip: { x: Math.max(0, Math.floor(rect.x - 8)), y: Math.max(0, Math.floor(rect.y - 8)), width: Math.ceil(rect.w + 16), height: Math.ceil(rect.h + 16), scale: 2 },
    }, { timeoutMs: 15000 });
    fs.writeFileSync(path.join(EVIDENCE, 'model-menu-master-detail.png'), Buffer.from(page.data, 'base64'));
    screenshot = 'saved';
  } catch (e) {
    screenshot = 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 80);
  }

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'composer 模型菜单（BLOCK-313/UI-617：供应商常驻左列 + 右侧二级模型页）',
    open, afterSecond, afterBack,
    notes: { screenshot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-model-menu-master-detail.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-313 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block313-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
