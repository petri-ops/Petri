#!/usr/bin/env node
'use strict';
/**
 * scripts/block317-composer-attachments-containment-live.cjs — BLOCK-317 / UI-621 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block317-composer-attachments-containment-live.cjs
 * 证据：acceptance/block-315/live-composer-attachments-containment.json。
 *
 * 用户截图反馈：粘贴/拖入的图片区域自带方形底色，画进 composer 24px 圆角外，
 * 看起来图片与背景越出输入框边界。修复后：
 * A 附件区无独立底色/顶边线（transparent + border-top 0）；
 * B 附件区与每张图片卡片都在 composer 卡片边界内；
 * C composer 直接子块无分段底色（引用条同规则）；窄视口下图片换行仍在界内。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-315');
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
    await sleep(400);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 180));
}

const DROP_IMAGES = `(async function(){
  var files = [];
  for (var i = 0; i < 8; i += 1) {
    var canvas = document.createElement('canvas');
    canvas.width = 24; canvas.height = 24;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444'][i % 4];
    ctx.fillRect(0, 0, 12, 12);
    ctx.fillStyle = '#14b8a6';
    ctx.beginPath(); ctx.arc(18, 18, 6, 0, Math.PI * 2); ctx.fill();
    var blob = await new Promise(function(resolve){ canvas.toBlob(resolve, 'image/png'); });
    files.push(new File([blob], 'containment-' + i + '.png', { type: 'image/png' }));
  }
  var dt = new DataTransfer();
  files.forEach(function(file){ dt.items.add(file); });
  var target = document.querySelector('.sc-composer');
  ['dragenter', 'dragover', 'drop'].forEach(function(type){
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  return 'dropped:' + files.length;
})()`;

const READ_STATE = `(function(){
  var composer = document.querySelector('.sc-composer');
  var strip = document.querySelector('.sc-attachments');
  var cards = [...document.querySelectorAll('.sc-attachments .sc-attachment')];
  function rect(el){
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
  }
  var cs = composer ? getComputedStyle(composer) : null;
  var ss = strip ? getComputedStyle(strip) : null;
  var cr = rect(composer);
  var sr = rect(strip);
  var composerChildren = composer ? [...composer.children].map(function(el){
    return { cls: String(el.className || '').slice(0, 80), bg: getComputedStyle(el).backgroundColor, borderTop: getComputedStyle(el).borderTopWidth };
  }) : [];
  return JSON.stringify({
    composer: cr,
    composerRadius: cs ? cs.borderTopLeftRadius : null,
    composerOverflow: cs ? cs.overflow : null,
    strip: sr,
    stripBg: ss ? ss.backgroundColor : null,
    stripBorderTop: ss ? ss.borderTopWidth : null,
    stripFlexWrap: ss ? ss.flexWrap : null,
    cardCount: cards.length,
    cards: cards.map(rect),
    cardsInside: cards.every(function(card){
      var r = card.getBoundingClientRect();
      return Boolean(cr) && r.left >= cr.left - 1 && r.right <= cr.right + 1 && r.top >= cr.top - 1 && r.bottom <= cr.bottom + 1;
    }),
    stripInside: Boolean(cr) && Boolean(sr) && sr.left >= cr.left - 1 && sr.right <= cr.right + 1 && sr.top >= cr.top - 1,
    composerChildren: composerChildren,
    notices: [...document.querySelectorAll('.sc-attachment-notice')].map(function(n){ return n.textContent.trim(); }),
  });
})()`;

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 320) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 240)}`);
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

  const created = await rest('POST', '/data/projects', { name: 'BLOCK317-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root' });
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await pagePoll(client, `!!document.querySelector('.sc-composer')`, { label: 'composer' });
  await sleep(700);

  const dropped = await evalRetry(client, DROP_IMAGES);
  assert('A0_images_dropped', String(dropped) === 'dropped:8', String(dropped));
  await pagePoll(client, `document.querySelectorAll('.sc-attachments .sc-attachment').length >= 3`, { label: 'attachments' });
  await sleep(500);

  const wide = JSON.parse(await evalRetry(client, READ_STATE));
  assert('A1_attachments_strip_has_no_band',
    wide.stripBg === 'rgba(0, 0, 0, 0)' && Number.parseFloat(wide.stripBorderTop || '1') === 0,
    `bg=${wide.stripBg} borderTop=${wide.stripBorderTop}`);
  assert('A2_strip_inside_composer',
    wide.stripInside === true,
    `strip=${JSON.stringify(wide.strip)} composer=${JSON.stringify(wide.composer)}`);
  assert('A3_strip_wraps', wide.stripFlexWrap === 'wrap', `flex-wrap=${wide.stripFlexWrap}`);
  assert('B0_every_image_card_inside_composer',
    wide.cardsInside === true && wide.cardCount >= 3,
    `cards=${wide.cardCount} inside=${wide.cardsInside}`);
  const banded = wide.composerChildren.filter((child) =>
    child.bg !== 'rgba(0, 0, 0, 0)' && !child.cls.includes('sc-composer'));
  assert('B1_no_composer_child_band',
    banded.length === 0,
    `children=${JSON.stringify(wide.composerChildren.map((c) => c.cls + ':' + c.bg))}`);
  assert('B2_composer_radius_intact', wide.composerRadius === '24px', `radius=${wide.composerRadius}`);

  // C 窄视口：图片换行后仍在 composer 内（不越右缘）
  let narrow = null;
  try {
    await client.send('Emulation.setDeviceMetricsOverride', { width: 560, height: 900, deviceScaleFactor: 1, mobile: false }, { timeoutMs: RAW_TIMEOUT });
    await sleep(700);
    narrow = JSON.parse(await evalRetry(client, READ_STATE));
    assert('C0_emulated_narrow_cards_inside',
      narrow.cardsInside === true && narrow.stripInside === true && narrow.cardCount >= 3,
      `viewport=560 composerW=${narrow.composer.width} cards=${narrow.cardCount} inside=${narrow.cardsInside}（composer 受工作区最小列宽约束；横向不溢出由 flex-wrap 保证）`);
  } finally {
    await client.send('Emulation.clearDeviceMetricsOverride', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});
  }

  let screenshot = 'not_attempted';
  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: false }, { timeoutMs: 15000 });
    fs.writeFileSync(path.join(EVIDENCE, 'composer-attachments-containment.png'), Buffer.from(shot.data, 'base64'));
    screenshot = 'saved';
  } catch (e) {
    screenshot = 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 100);
  }

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'composer 图片附件（BLOCK-317/UI-621：附件区与图片卡片完全落在输入框圆角卡内，无分段底色）',
    wide, narrow,
    notes: { screenshot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-composer-attachments-containment.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-317 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block317-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
