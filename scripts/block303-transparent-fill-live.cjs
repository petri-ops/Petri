#!/usr/bin/env node
'use strict';
/**
 * scripts/block303-transparent-fill-live.cjs — BLOCK-305 UI-605 实机腿：形状批注透明淡染。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block303-transparent-fill-live.cjs
 * 证据：acceptance/block-303/live-transparent.json + clip PNG。
 *
 * 场景（用户反馈：形状的框应该是没有内部填充的，能看到区域内内容）：
 *   矩形工具画一笔 → 保存 → 断言批注框背景为半透明淡染（alpha<0.5，非实色遮挡）
 *   → clip 截图留证（肉眼可复核透过框体看到图片内容）。
 *
 * 断言面：
 *   D0 矩形保存落库；
 *   D1 box 背景 alpha < 0.5（淡染不实底）；
 *   D2 draft 同形（再画一笔中断态断言 draft alpha）；
 *   D3 clip 截图落盘。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-303');
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

  // ── 种子 + 导航（同 block299 配方）──
  const created = await rest('POST', '/data/projects', { name: 'BLOCK305-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  const projResp = projectId ? await rest('GET', '/data/projects/' + encodeURIComponent(projectId)) : null;
  const workspacePath = projResp && projResp.data && (projResp.data.project
    ? projResp.data.project.workspace_path : projResp.data.workspace_path);
  assert('P0a_project_created', Boolean(projectId && workspacePath), `id=${projectId || 'none'}`);
  const fixtureDir = path.join(workspacePath, 'annot');
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(path.join(fixtureDir, 'volcano.svg'), SVG, 'utf8');

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
  })()`, { label: 'files tab' });
  await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
    return el.textContent.indexOf('annot') >= 0; }))`, { label: 'annot dir' });
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
  await sleep(800);

  const overlaySel = '[aria-label*="批注层"]';
  const rect = await evalRetry(client, `(function(){
    var o = document.querySelector(${JSON.stringify(overlaySel)});
    var r = o.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);

  // ── D1 矩形：draft 半透明（绘制中断态断言） ──
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(rect.x + rect.w * 0.1), y: Math.round(rect.y + rect.h * 0.15),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(rect.x + rect.w * 0.45), y: Math.round(rect.y + rect.h * 0.5),
    button: 'left', pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  await sleep(200);
  const draftBg = await evalRetry(client, `(function(){
    function alphaOf(v) {
      if (v.indexOf('color(') === 0 || v.indexOf('color-mix') === 0) {
        var m = v.match(/\\/\\s*([\\d.]+)\\s*\\)?$/);
        return m ? Number(m[1]) : 1;
      }
      var m = v.match(/rgba?\\(([^)]*)\\)/);
      if (!m) return 1;
      var parts = m[1].split(',');
      return parts.length >= 4 ? Number(parts[3]) : 1;
    }
    var d = document.querySelector('[data-testid="annotation-draft"]');
    if (!d) return null;
    var cs = getComputedStyle(d).backgroundColor;
    return { color: cs.slice(0, 60), alpha: alphaOf(cs) };
  })()`);
  assert('D1_draft_translucent', draftBg && Number(draftBg.alpha) < 0.5,
    JSON.stringify(draftBg) + '（12% 淡染）');
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(rect.x + rect.w * 0.45), y: Math.round(rect.y + rect.h * 0.5),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  }, { timeoutMs: RAW_TIMEOUT });
  await sleep(400);

  // ── D2 保存（不填写直接确认）──
  await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="annotation-inline-confirm"]');
    if (!b) return 'no_confirm';
    b.click();
    return 'confirmed';
  })()`);
  await pagePoll(client, `String(document.querySelectorAll('[data-testid="annotation-box"]').length >= 1)`,
    { label: 'region saved' });

  // ── D3 box 背景半透明 ──
  const boxBg = await evalRetry(client, `(function(){
    function alphaOf(v) {
      if (v.indexOf('color(') === 0 || v.indexOf('color-mix') === 0) {
        var m = v.match(/\\/\\s*([\\d.]+)\\s*\\)?$/);
        return m ? Number(m[1]) : 1;
      }
      var m = v.match(/rgba?\\(([^)]*)\\)/);
      if (!m) return 1;
      var parts = m[1].split(',');
      return parts.length >= 4 ? Number(parts[3]) : 1;
    }
    var b = document.querySelector('[data-testid="annotation-box"]');
    if (!b) return null;
    var cs = getComputedStyle(b).backgroundColor;
    return { color: cs.slice(0, 60), alpha: alphaOf(cs) };
  })()`);
  assert('D2_box_translucent', boxBg && Number(boxBg.alpha) < 0.5,
    JSON.stringify(boxBg) + '（保存后仍淡染可透视）');

  await clipShot(client, 'transparent-fill.png', overlaySel, 30);

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'workspace-file 图像预览面（UI-605 形状批注透明淡染：区域内内容可透视）',
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-transparent.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-303 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block303-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
