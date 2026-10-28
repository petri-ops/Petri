#!/usr/bin/env node
'use strict';
/**
 * scripts/block300-lightbox-portal-live.cjs — BLOCK-301 UI-601 实机腿：灯箱 portal 全屏置顶。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block300-lightbox-portal-live.cjs
 * 证据：acceptance/block-300/live-lightbox.json。
 *
 * 场景（用户反馈：图片灯箱盖不住聊天输入框/顶栏——面板 stacking context 降格 fixed 全屏）：
 *   种子=临时项目 + annot/volcano.svg → 文件 tab → 预览 → 点击图片开灯箱 →
 *   断言灯箱 body 直挂（portal）+ 遮罩全屏 + **composer 中心坐标 hit-test 命中灯箱**
 *   （灯箱盖住输入框=用户问题核心）+ Esc 关闭退场。
 *
 * 断言面：
 *   D0 预览面就绪；
 *   D1 点击图片 → 灯箱打开且 parentElement === document.body（portal 契约）；
 *   D2 遮罩全屏（尺寸 = 视口）；
 *   D3 composer 中心 hit-test 命中 petri-lightbox（盖住输入框）+ 顶栏中心同理；
 *   D4 Esc 关闭 → 灯箱退场。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-300');
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

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
<rect width="400" height="300" fill="#ffffff"/>
<rect x="20" y="20" width="160" height="120" fill="#4f46e5"/>
<circle cx="300" cy="150" r="60" fill="#14b8a6"/>
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
  await client.send('Page.reload', { ignoreCache: true }, { timeoutMs: RAW_TIMEOUT }).catch(() => {});
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after hard reload' });
  await sleep(800);

  // ── 种子：项目 + svg 夹具 ──
  const created = await rest('POST', '/data/projects', { name: 'BLOCK300-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  const projResp = projectId ? await rest('GET', '/data/projects/' + encodeURIComponent(projectId)) : null;
  const workspacePath = projResp && projResp.data && (projResp.data.project
    ? projResp.data.project.workspace_path : projResp.data.workspace_path);
  assert('P0a_project_created', Boolean(projectId && workspacePath), `id=${projectId || 'none'}`);
  const fixtureDir = path.join(workspacePath, 'annot');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const svgPath = path.join(fixtureDir, 'volcano.svg');
  fs.writeFileSync(svgPath, SVG, 'utf8');

  // ── 导航：项目页 → 文件 tab → volcano.svg ──
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after nav' });
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
  await sleep(600);
  assert('D0_preview_ready', true, '预览面图像加载完成');

  // ── D1 点击图片开灯箱 → body 直挂 ──
  await evalRetry(client, `(function(){
    var img = document.querySelector('[class*="imagePane"] img, img[alt*="volcano"]');
    var btn = img && img.closest('button');
    if (!btn) return 'no_trigger';
    btn.click();
    return 'opened';
  })()`);
  await pagePoll(client, `String(!!document.querySelector(':scope > .petri-lightbox') || !!document.body.querySelector('.petri-lightbox'))`,
    { label: 'lightbox present' });
  const portal = await evalRetry(client, `(function(){
    var lb = document.querySelector('.petri-lightbox');
    if (!lb) return null;
    return { parentIsBody: lb.parentElement === document.body,
             inPanel: Boolean(lb.closest('[class*="workspacePreview"], [class*="panel"]')) };
  })()`);
  assert('D1_portal_to_body', portal && portal.parentIsBody === true && portal.inPanel === false,
    JSON.stringify(portal));

  // ── D2 遮罩全屏 ──
  const fullscreen = await evalRetry(client, `(function(){
    var lb = document.querySelector('.petri-lightbox');
    var r = lb.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight };
  })()`);
  assert('D2_overlay_fullscreen', fullscreen.w === fullscreen.vw && fullscreen.h === fullscreen.vh,
    JSON.stringify(fullscreen));

  // ── D3 composer/顶栏中心 hit-test 命中灯箱（盖住输入框=用户问题核心）──
  const hit = await evalRetry(client, `(function(){
    function centerHit(sel) {
      var el = document.querySelector(sel);
      if (!el) return { sel: sel, absent: true };
      var r = el.getBoundingClientRect();
      var top = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 40));
      if (!top) return { sel: sel, hit: null };
      return { sel: sel, hit: top.closest('.petri-lightbox') ? 'lightbox' : (top.tagName + '.' + String(top.className).slice(0, 40)) };
    }
    return [centerHit('[data-testid="composer-input"], [placeholder*="输入消息"]'),
            centerHit('[class*="titleBar"], header')];
  })()`);
  const composerHit = hit[0] && hit[0].hit === 'lightbox';
  const topbarHit = hit[1] && (hit[1].hit === 'lightbox' || hit[1].absent === true);
  assert('D3_covers_composer_and_topbar', composerHit && topbarHit, JSON.stringify(hit));

  // ── D4 Esc 关闭退场 ──
  await evalRetry(client, `(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return 'esc';
  })()`);
  await sleep(500);
  const gone = await evalRetry(client, `!document.querySelector('.petri-lightbox')`);
  assert('D4_esc_closes', gone === true, `lightbox gone=${gone}`);

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'workspace-file 图像预览面（BLOCK-301 灯箱 portal：body 直挂/遮罩全屏/盖住 composer 与顶栏）',
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-lightbox.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-300 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block300-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
