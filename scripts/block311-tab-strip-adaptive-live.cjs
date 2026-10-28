#!/usr/bin/env node
'use strict';
/**
 * scripts/block311-tab-strip-adaptive-live.cjs — BLOCK-311 / UI-615 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block311-tab-strip-adaptive-live.cjs
 * 证据：acceptance/block-309/live-tab-strip-adaptive.json。
 *
 * 覆盖：
 *   A 打开多个右栏 surface（文件/浏览器/分析/审阅/生成文件/指挥中心/轨迹/
 *     模型 I/O/智能体/计划/证据）→ 标签条拥挤时 data-compact=true、标签文本隐藏、
 *     图标仍在、工具菜单/窗口控件不受影响；
 *   B 通过标签右键「关闭其他」只留 1 个 → 空间足够时 data-compact=false、
 *     文本恢复（宽度/数量变化自适应）。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-309');
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

async function pagePoll(client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(400);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

async function clipShot(client, file, selector, pad = 16) {
  const rect = await evalRetry(client, `(function(){
    var e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null;
    var r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  if (!rect || rect.w <= 0) return 'no_rect';
  try {
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: false,
      clip: {
        x: Math.max(0, Math.floor(rect.x - pad)),
        y: Math.max(0, Math.floor(rect.y - pad)),
        width: Math.ceil(rect.w + pad * 2),
        height: Math.ceil(rect.h + pad * 2),
        scale: 2,
      },
    }, { timeoutMs: 20000 });
    fs.writeFileSync(path.join(EVIDENCE, file), Buffer.from(shot.data, 'base64'));
    return 'saved';
  } catch (e) {
    return 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 80);
  }
}

const SURFACE_LABELS = [
  '文件', '生成文件', '浏览器', '分析', '审阅',
  '指挥中心', '轨迹', '模型 I/O', '智能体', '计划', '证据',
];

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

  const created = await rest('POST', '/data/projects', { name: 'BLOCK311-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root' });
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await sleep(800);

  // 右栏必须在场（标签条只在 rightOpen 渲染）
  await evalRetry(client, `(function(){
    var open = document.querySelector('[aria-label="展开右侧栏"]');
    if (open) { open.click(); return 'opened'; }
    return 'already';
  })()`);
  await pagePoll(client, `!!document.querySelector('[aria-label="展开更多工具"]')`, { label: 'more button' });
  await sleep(500);

  async function openSurface(label) {
    const hasMenu = await evalRetry(client, `!!document.getElementById('titlebar-tool-menu')`);
    if (hasMenu !== true) {
      await evalRetry(client, `(function(){
        var b = document.querySelector('[aria-label="展开更多工具"]');
        if (b) b.click();
        return 'open';
      })()`);
      await pagePoll(client, `!!document.getElementById('titlebar-tool-menu')`, { label: 'tool menu' });
      await sleep(200);
    }
    const result = await evalRetry(client, `(function(){
      var menu = document.getElementById('titlebar-tool-menu');
      if (!menu) return 'no_menu';
      var buttons = [...menu.querySelectorAll('button')];
      var exact = buttons.find(function(b){ return b.textContent.trim() === ${JSON.stringify(label)}; });
      var item = exact || buttons.find(function(b){ return b.textContent.trim().indexOf(${JSON.stringify(label)}) === 0; });
      if (!item) return 'no_item';
      item.click();
      return 'clicked';
    })()`);
    await sleep(350);
    return result;
  }

  const opened = [];
  const missed = [];
  for (const label of SURFACE_LABELS) {
    const result = await openSurface(label).catch((e) => 'err:' + e.message);
    if (result === 'clicked') opened.push(label); else missed.push(label + ':' + result);
  }
  await sleep(800);

  const readRail = () => evalRetry(client, `(function(){
    var rail = document.querySelector('[class*="tabsRail"]');
    if (!rail) return null;
    var tabs = [...rail.querySelectorAll('[data-tab-id]')];
    var texts = [...rail.querySelectorAll('[class*="tabPillText"]')];
    return JSON.stringify({
      compact: rail.getAttribute('data-compact'),
      count: tabs.length,
      labels: tabs.map(function(t){ return t.getAttribute('data-tab-id'); }),
      textDisplays: texts.map(function(t){ return getComputedStyle(t).display; }),
      textCount: texts.length,
      iconCount: tabs.filter(function(t){ return !!t.querySelector('svg'); }).length,
      railW: rail.clientWidth,
      scrollW: rail.scrollWidth,
      more: !!document.querySelector('[aria-label="展开更多工具"]'),
      windowToolButtons: document.querySelectorAll('[class*="windowTools"] button').length,
    });
  })()`);

  const crowded = JSON.parse(await readRail());
  assert('A0_tabs_opened', Boolean(crowded) && crowded.count >= 6,
    `count=${crowded && crowded.count} opened=${opened.length} missed=${JSON.stringify(missed)}`);
  assert('A1_compact_when_crowded', Boolean(crowded) && crowded.compact === 'true',
    `compact=${crowded && crowded.compact} railW=${crowded && crowded.railW} scrollW=${crowded && crowded.scrollW} count=${crowded && crowded.count}`);
  assert('A2_labels_hidden',
    Boolean(crowded) && crowded.textCount >= 1 && crowded.textDisplays.every((d) => d === 'none'),
    `texts=${crowded && crowded.textCount} displays=${crowded && JSON.stringify(crowded.textDisplays)}`);
  assert('A3_icons_remain',
    Boolean(crowded) && crowded.iconCount === crowded.count,
    `icons=${crowded && crowded.iconCount}/${crowded && crowded.count}`);
  assert('A4_controls_intact',
    Boolean(crowded) && crowded.more === true && crowded.windowToolButtons >= 2,
    `more=${crowded && crowded.more} windowTools=${crowded && crowded.windowToolButtons}`);
  assert('A5_icons_fit_no_overflow',
    Boolean(crowded) && crowded.scrollW <= crowded.railW + 1,
    `railW=${crowded && crowded.railW} scrollW=${crowded && crowded.scrollW}`);

  // 右键激活标签 → 关闭其他 → 只剩 1 个，空间足够应恢复全标签
  const menuReady = await evalRetry(client, `(function(){
    var active = document.querySelector('[class*="tabPillActive"]');
    var tab = active || document.querySelector('[class*="tabsRail"] [data-tab-id]');
    if (!tab) return 'no_tab';
    var r = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: Math.round(r.x + 8), clientY: Math.round(r.y + 8),
    }));
    return 'context';
  })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="work-surface-tab-menu"]')`, { label: 'tab menu' });
  const closedOthers = await evalRetry(client, `(function(){
    var menu = document.querySelector('[data-testid="work-surface-tab-menu"]');
    if (!menu) return 'no_menu';
    var item = [...menu.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '关闭其他'; });
    if (!item) return 'no_item';
    item.click();
    return 'closed';
  })()`);
  await sleep(700);
  const single = JSON.parse(await readRail());
  assert('B0_close_others_ready', menuReady === 'context' && closedOthers === 'closed',
    `context=${menuReady} close=${closedOthers}`);
  assert('B1_few_tabs_full_labels',
    Boolean(single) && single.count === 1 && single.compact === 'false'
      && single.textDisplays.length === 1 && single.textDisplays[0] !== 'none',
    `count=${single && single.count} compact=${single && single.compact} displays=${single && JSON.stringify(single.textDisplays)}`);

  const shot = await clipShot(client, 'tab-strip-compact.png', '[class*="tabsRail"]', 20);
  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: '右栏顶部标签条（BLOCK-311/UI-615：多标签自动折叠图标 / 少标签恢复全标签）',
    opened, missed,
    crowded, single,
    notes: { screenshot: shot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-tab-strip-adaptive.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-311 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block311-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
