#!/usr/bin/env node
'use strict';
/**
 * scripts/block277-empty-state-live.cjs — BLOCK-277 右栏空态重排实机取证。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例（bash scripts/start-test-instance.sh，离屏）。
 * 用法：node scripts/block277-empty-state-live.cjs
 * 证据：acceptance/block-277/live.json + clip PNG（截图可用时）。
 *
 * 断言面（welcome 首页 → 临时项目 /project/:id 右栏 home tab 空态）：
 *   A1 头部块：「工作区」标题 + 描述（含「Agent 会在这里看文件」）在场；
 *   A2 六入口卡：每卡=图标章+标题+一句说明；2 列网格（同行卡等宽、3 行）；
 *   A3 垂直居中：内容块顶部距容器顶 ≈ (容器高-内容高)/2（±40px，不沉底）；
 *   A4 审阅徽章：新项目无未看改动 → review-tile-count 不在场。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-277');
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

  const created = await rest('POST', '/data/projects', { name: 'BLOCK277-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0_temp_project_created', Boolean(projectId), `id=${projectId || 'none'}`);

  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after nav' });
  // 右栏 home tab 空态等渲染
  await pagePoll(client, `(function(){
    var el = document.querySelector('[class*="emptyResultInner"]');
    return el && el.querySelectorAll('[class*="emptyResultLaunchCard"]').length >= 6 ? 'ready' : '';
  })()`, { label: 'empty state cards' });
  await sleep(800);

  // A1 头部块
  const head = await evalRetry(client, `(function(){
    var t = document.querySelector('[class*="emptyResultTitle"]');
    var d = document.querySelector('[class*="emptyResultDesc"]');
    var b = document.querySelector('[class*="emptyResultBadge"]');
    return { title: t && t.textContent, desc: d && d.textContent.slice(0, 40), badgeSvg: !!(b && b.querySelector('svg')) };
  })()`);
  assert('A1_header_block', head && head.title === '工作区'
    && (head.desc || '').includes('Agent 会在这里看文件') && head.badgeSvg === true, JSON.stringify(head));

  // A2 六入口卡：标题+说明+图标章，2 列网格（同行等宽、共 3 行）
  const grid = await evalRetry(client, `(function(){
    var cards = [...document.querySelectorAll('[class*="emptyResultLaunchCard"]')];
    var withDesc = cards.filter(function(c){
      return c.querySelector('[class*="emptyResultLaunchDesc"]') && c.querySelector('[class*="emptyResultLaunchIcon"] svg');
    }).length;
    var rows = {};
    cards.forEach(function(c){
      var y = Math.round(c.getBoundingClientRect().top);
      rows[y] = (rows[y] || 0).concat ? rows[y] : [];
      (rows[y] = rows[y] || []).push(Math.round(c.getBoundingClientRect().width));
    });
    var rowKeys = Object.keys(rows);
    var twoCol = rowKeys.length === 3 && rowKeys.every(function(k){
      return rows[k].length === 2 && Math.abs(rows[k][0] - rows[k][1]) <= 2;
    });
    return { cards: cards.length, withDesc: withDesc, rowCount: rowKeys.length, twoCol: twoCol };
  })()`);
  assert('A2_six_rich_cards_two_col',
    Number(grid.cards) === 6 && Number(grid.withDesc) === 6 && grid.twoCol === true, JSON.stringify(grid));

  // A3 垂直居中（不沉底）：内容块顶部 ≈ 容器居中位
  const center = await evalRetry(client, `(function(){
    var c = document.querySelector('[class*="emptyResult"]');
    var i = document.querySelector('[class*="emptyResultInner"]');
    if (!c || !i) return null;
    var cr = c.getBoundingClientRect(); var ir = i.getBoundingClientRect();
    return { cTop: Math.round(cr.top), cH: Math.round(cr.height),
             iTop: Math.round(ir.top), iH: Math.round(ir.height) };
  })()`);
  const expectTop = center ? center.cTop + Math.round((center.cH - center.iH) / 2) : 0;
  assert('A3_vertically_centered', center && Math.abs(center.iTop - expectTop) <= 40,
    JSON.stringify({ ...center, expectTop }));

  // A4 新项目无未看改动 → 无审阅徽章
  const badge = await evalRetry(client, `!!document.querySelector('[data-testid="review-tile-count"]')`);
  assert('A4_no_review_badge_on_fresh', badge === false, 'fresh project has no unread changes');

  await clipShot(client, 'empty-state-light.png', '[class*="emptyResult"]', 20);

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-277 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block277-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
