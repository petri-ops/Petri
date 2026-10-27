#!/usr/bin/env node
'use strict';
/**
 * scripts/block275-ui-feedback-live.cjs — BLOCK-275 UI 反馈批实机取证。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例（bash scripts/start-test-instance.sh，离屏）。
 * 用法：node scripts/block275-ui-feedback-live.cjs
 * 证据：acceptance/block-275/live.json + clip PNG。
 *
 * 断言面（UI-589 / UI-590）：
 *   A 模型菜单两级导航（welcome 首页 composer 并钮）：
 *     A1 开菜单 → 供应商行在场且无平铺模型行/无返回行；
 *     A2 点供应商 → 返回行 + 该渠道模型行在场；点返回 → 复位供应商列表；
 *     A3 点供应商行数 ≥2（多渠道才谈得上两级导航）。
 *   B 左栏页脚图标化右对齐：两钮无文字（textContent 空）且含 svg；
 *     右对齐=两钮右缘与行右缘对齐（容差 6px）。
 *   C clip 截图：菜单两级 + 页脚。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-275');
const RAW_TIMEOUT = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1200); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(800);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

async function clipShot(client, file, selector, pad = 40) {
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
    const reason = 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 80);
    console.log(`[probe] clip ${file}: ${reason}`);
    return reason;
  }
}

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
  await client.send('Page.bringToFront', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});

  // ── A 模型菜单两级导航（welcome 首页 composer）──
  const chipReady = await pagePoll(client, `!!document.querySelector('[data-testid="model-chip-model"]')`,
    { label: 'model chip renders' });
  assert('A0_model_chip_present', chipReady === true || chipReady === 'true', 'welcome composer');
  await evalRetry(client, `document.querySelector('[data-testid="model-chip-model"]').click(); 'clicked'`);
  await pagePoll(client, `!!document.querySelector('[data-testid="model-menu"]')`, { label: 'menu opens' });
  await sleep(500);

  const level1 = await evalRetry(client, `(function(){
    var menu = document.querySelector('[data-testid="model-menu"]');
    var suppliers = menu.querySelectorAll('[data-testid^="model-menu-supplier-"]');
    var rows = menu.querySelectorAll('.sc-model-option:not(.sc-model-group-header):not([data-testid="model-menu-auto"])');
    var back = document.querySelector('[data-testid="model-menu-back"]');
    return { suppliers: suppliers.length, plainModelRows: rows.length, back: !!back };
  })()`);
  assert('A1_level1_suppliers_only',
    Number(level1.suppliers) >= 2 && Number(level1.plainModelRows) === 0 && !level1.back,
    JSON.stringify(level1));
  await clipShot(client, 'menu-level1-suppliers.png', '[data-testid="model-menu"]');

  // 点第一个供应商钻取
  await evalRetry(client, `(function(){
    var s = document.querySelector('[data-testid^="model-menu-supplier-"]');
    s.click(); return 'drilled';
  })()`);
  await sleep(400);
  const level2 = await evalRetry(client, `(function(){
    var menu = document.querySelector('[data-testid="model-menu"]');
    var back = document.querySelector('[data-testid="model-menu-back"]');
    var rows = menu.querySelectorAll('.sc-model-option:not(.sc-model-group-header):not([data-testid="model-menu-back"])');
    return { back: !!back, modelRows: rows.length };
  })()`);
  assert('A2_level2_drilled', level2.back === true && Number(level2.modelRows) >= 1, JSON.stringify(level2));
  await clipShot(client, 'menu-level2-models.png', '[data-testid="model-menu"]');

  // 返回复位
  await evalRetry(client, `document.querySelector('[data-testid="model-menu-back"]').click(); 'back'`);
  await sleep(300);
  const restored = await evalRetry(client, `(function(){
    var back = document.querySelector('[data-testid="model-menu-back"]');
    var suppliers = document.querySelectorAll('[data-testid^="model-menu-supplier-"]');
    return { back: !!back, suppliers: suppliers.length };
  })()`);
  assert('A3_back_restores_level1', restored.back === false && Number(restored.suppliers) >= 2,
    JSON.stringify(restored));

  // 关菜单（点 overlay）
  await evalRetry(client, `(function(){
    var o = document.querySelector('.sc-model-overlay');
    if (o) o.click();
    return 'closed';
  })()`);
  await sleep(300);

  // ── B 左栏页脚图标化右对齐 ──
  const foot = await evalRetry(client, `(function(){
    var row = document.querySelector('[class*="leftFooterRow"]');
    var fed = document.querySelector('[data-testid="sidebar-federation"]');
    var set = document.querySelector('[data-testid="sidebar-settings"]');
    if (!row || !fed || !set) return null;
    var rr = row.getBoundingClientRect();
    var fr = fed.getBoundingClientRect();
    var sr = set.getBoundingClientRect();
    var cs = getComputedStyle(row);
    var padRight = parseFloat(cs.paddingRight) || 0;
    var gap = parseFloat(cs.gap) || 0;
    return {
      fedText: fed.textContent.trim(), setText: set.textContent.trim(),
      fedSvg: !!fed.querySelector('svg'), setSvg: !!set.querySelector('svg'),
      fedLabel: fed.getAttribute('aria-label'), setLabel: set.getAttribute('aria-label'),
      padRight: padRight, gap: gap,
      fedRight: Math.round(fr.right), setRight: Math.round(sr.right),
      setWidth: Math.round(sr.width),
      expectSetRight: Math.round(rr.right - padRight),
      expectFedRight: Math.round(rr.right - padRight - sr.width - gap),
    };
  })()`);
  if (!foot) {
    assert('B_footer_present', false, 'leftFooterRow/sidebar buttons not found（本态未渲染，如实标注）');
  } else {
    assert('B1_icon_only', foot.fedText === '' && foot.setText === ''
      && foot.fedSvg === true && foot.setSvg === true
      && foot.fedLabel === '联邦' && foot.setLabel === '设置', JSON.stringify(foot));
    // 右对齐=扣行内边距后设置钮贴行右缘、联邦钮贴设置钮左缘（间隙=gap），容差 3px
    assert('B2_right_aligned',
      Math.abs(foot.setRight - foot.expectSetRight) <= 3
        && Math.abs(foot.fedRight - foot.expectFedRight) <= 3,
      `actual fed=${foot.fedRight} set=${foot.setRight}; expected fed=${foot.expectFedRight} set=${foot.expectSetRight} (pad=${foot.padRight} gap=${foot.gap})`);
    await clipShot(client, 'footer-icons.png', '[class*="leftFooterRow"]', 24);
  }

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-275 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block275-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
