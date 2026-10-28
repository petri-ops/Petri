#!/usr/bin/env node
'use strict';
/**
 * scripts/block320-notification-center-live.cjs — BLOCK-320 / UI-625 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block320-notification-center-live.cjs
 * 证据：acceptance/block-320/live-notification-center.json
 *
 * 用户反馈原话：「通知中心这里咋回事，乱乱的」——弹层复用通用 toolMenu
 * （直系 button 固定 32px 高 + grid + span{flex:1}）导致多行通知互相压叠、
 * 未读圆点被拉成长条。本探针按内容逐条量测修复后的形态：
 * A 结构：独立弹层（不再带 toolMenu 类）、四类通知各成一行、行序不重叠；
 * B 行内：类型标签语义底色、标题单行省略、正文两行截断、相对时间（刚刚/N 分钟前/今天 HH:mm）；
 * C 未读：圆点是圆（宽≈高）而非长条；已读行无圆点；
 * D 视口：弹层完整落在视口内且行中心 elementFromPoint 命中本行（证明无遮挡压叠）；
 * F 可读性：面板基准字号 = 全局正文 token（rootFont×0.875），不再继承标题栏图标按钮的小字；
 * E 操作：全部已读→圆点与徽章归零、清空→空态文案 + 两个操作钮禁用。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-320');
const STORAGE_KEY = 'petri:notification-center:v1';
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

const LONG_BODY = '这段正文用于验证通知行的多行截断：以前它会被固定 32px 高的通用工具菜单按钮压住，'
  + '第二行直接叠到下一条通知上，看起来整块都是乱的。现在正文最多两行，超出用省略号收尾，标题仍单行。';
const LONG_TITLE = '回合完成·超长标题用于验证单行省略不会把行高撑开也不会挤压相邻元素';

function seedNotices(projectId, conversationId) {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  return [
    { id: 'n_seed_now', kind: 'turn_completed', title: '对话已完成', body: '上一轮任务已经跑完，可以查看结果。',
      conversationId, projectId, createdAt: iso(now - 20_000), read: false },
    { id: 'n_seed_5m', kind: 'approval_required', title: LONG_TITLE, body: LONG_BODY,
      conversationId, projectId, ackToken: 'ack_probe_1', createdAt: iso(now - 5 * 60_000), read: false },
    { id: 'n_seed_2h', kind: 'turn_failed', title: '回合失败', body: '模型返回超时，已保留上下文可直接重试。',
      conversationId, projectId, createdAt: iso(now - 2 * 3_600_000), read: false },
    // 5 天前：一定落在「M/D HH:mm」档（-30h 那种相对小时数会在午夜前后跨档，探针不可重复）。
    { id: 'n_seed_5d', kind: 'schedule_reminder', title: '定时提醒已完成', body: '每日数据检查任务已执行。',
      conversationId, projectId, createdAt: iso(now - 5 * 86_400_000), read: true },
  ];
}

const MEASURE = `(function(){
  var panel = document.querySelector('[data-testid="notification-center-panel"]');
  var vw = window.innerWidth, vh = window.innerHeight;
  if (!panel) return JSON.stringify({ panel: false, vw: vw, vh: vh });
  var pr = panel.getBoundingClientRect();
  var head = panel.querySelector('header');
  var items = [].slice.call(panel.querySelectorAll('[data-testid="notification-center-item"]'));
  function pick(el, sel) { return el.querySelector('[class*="' + sel + '"]'); }
  var rows = items.map(function(el){
    var r = el.getBoundingClientRect();
    var title = pick(el, 'noticeItemTitle');
    var body = pick(el, 'noticeBody');
    var kind = pick(el, 'noticeKind');
    var meta = pick(el, 'noticeMeta');
    var dot = el.querySelector('[data-testid="notification-center-dot"]');
    var cs = function(n){ return n ? getComputedStyle(n) : null; };
    var bodyCS = cs(body);
    var titleCS = cs(title);
    var rect = function(n){ if (!n) return null; var b = n.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left),
               right: Math.round(b.right), width: Math.round(b.width), height: Math.round(b.height) }; };
    var dotR = rect(dot);
    var center = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + Math.min(12, r.height / 2)));
    return {
      kindAttr: el.getAttribute('data-kind'),
      readAttr: el.getAttribute('data-read'),
      disabled: el.disabled === true,
      row: rect(el),
      rowScrollOverflow: Math.round(el.scrollHeight - el.clientHeight),
      titleClipped: title ? (title.scrollWidth > title.clientWidth + 1) : null,
      titleWhiteSpace: titleCS ? titleCS.whiteSpace : null,
      titleFont: titleCS ? parseFloat(titleCS.fontSize) : 0,
      bodyFont: bodyCS ? parseFloat(bodyCS.fontSize) : 0,
      metaFont: meta ? parseFloat(getComputedStyle(meta).fontSize) : 0,
      kindFont: kind ? parseFloat(getComputedStyle(kind).fontSize) : 0,
      titleRect: rect(title),
      bodyRect: rect(body),
      bodyLineHeight: bodyCS ? (parseFloat(bodyCS.lineHeight) || 0) : 0,
      bodyClamp: bodyCS ? (bodyCS.webkitLineClamp || bodyCS.lineClamp || 'none') : null,
      bodyScrollHeight: body ? body.scrollHeight : null,
      metaText: meta ? meta.textContent.trim() : null,
      kindText: kind ? kind.textContent.trim() : null,
      kindBg: kind ? cs(kind).backgroundColor : null,
      kindColor: kind ? cs(kind).color : null,
      dotW: dotR ? dotR.width : null,
      dotH: dotR ? dotR.height : null,
      hitSelf: center ? panel.contains(center) : false,
    };
  });
  var badge = document.querySelector('[data-testid="notification-center-unread"]');
  var dotCount = document.querySelectorAll('[data-testid="notification-center-dot"]').length;
  var prefInputs = panel.querySelectorAll('[data-testid^="notice-pref-"]').length;
  var actions = [].slice.call(panel.querySelectorAll('button')).filter(function(b){
    var t = b.textContent.trim(); return t === '全部已读' || t === '清空';
  }).map(function(b){ return { label: b.textContent.trim(), disabled: b.disabled === true }; });
  return JSON.stringify({
    panel: true,
    className: String(panel.className),
    panelFont: parseFloat(getComputedStyle(panel).fontSize) || 0,
    panelLineHeight: getComputedStyle(panel).lineHeight,
    rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize) || 0,
    vw: vw, vh: vh,
    rect: { top: Math.round(pr.top), bottom: Math.round(pr.bottom), left: Math.round(pr.left),
            right: Math.round(pr.right), width: Math.round(pr.width), height: Math.round(pr.height) },
    computedOverflow: getComputedStyle(panel).overflow,
    headText: head ? head.textContent.trim() : null,
    emptyText: (function(){ var e = panel.querySelector('[class*="noticeEmpty"]'); return e ? e.textContent.trim() : null; })(),
    itemCount: items.length,
    rows: rows,
    badge: badge ? badge.textContent.trim() : null,
    dotCount: dotCount,
    prefInputs: prefInputs,
    actions: actions,
  });
})()`;

function parse(json) { return JSON.parse(json); }

async function openPanel(client) {
  await evalRetry(client, `(function(){
    var bell = document.querySelector('[data-testid="notification-center-bell"]');
    if (bell) bell.click();
    return bell ? 'clicked' : 'no_bell';
  })()`);
  await pagePoll(client, `!!document.querySelector('[data-testid="notification-center-panel"]')`, { label: 'notice panel' });
  await sleep(400);
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    const pass = ok === true;
    records.push({ id, ok: pass, detail: String(detail).slice(0, 340) });
    console.log(`${pass ? '✔' : '✘'} ${id} ${String(detail).slice(0, 260)}`);
    return pass;
  };

  const created = await rest('POST', '/data/projects', { name: 'BLOCK320-验收-' + Date.now(), modality: 'general' });
  const project = created.data && created.data.project;
  const projectId = project && project.id;
  assert('P0_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
  const conversationId = 'conv_seed_block320';

  const notices = seedNotices(projectId, conversationId);
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  const client = await lib.connectTarget(target);
  await client.send('Page.enable', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});

  // 种本地通知历史 → 重载 → 打开弹层
  await evalRetry(client, `localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(notices))}); 'seeded'`);
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}/chat`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root' });
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await sleep(800);
  const badgeBefore = await evalRetry(client, `(function(){
    var b = document.querySelector('[data-testid="notification-center-unread"]');
    return b ? b.textContent.trim() : 'none';
  })()`);
  assert('P1_seed_badge_unread', badgeBefore === '3', `badge=${badgeBefore}（3 未读 / 共 4 条）`);

  await openPanel(client);
  const snap = parse(await evalRetry(client, MEASURE));

  // A — 结构与行序
  assert('A0_panel_open', snap.panel === true, `items=${snap.itemCount}`);
  assert('A1_not_toolmenu_anymore', /noticePanel/.test(snap.className) && !/toolMenu/.test(snap.className),
    `class=${snap.className}`);
  assert('A2_four_rows_in_order', snap.itemCount === 4
    && snap.rows.map((r) => r.kindAttr).join(',') === 'turn_completed,approval_required,turn_failed,schedule_reminder',
    `kinds=${snap.rows.map((r) => r.kindAttr).join('|')}`);
  const overlaps = [];
  for (let i = 0; i < snap.rows.length - 1; i += 1) {
    const cur = snap.rows[i].row;
    const next = snap.rows[i + 1].row;
    if (cur.bottom > next.top + 1) overlaps.push(`${i}:${cur.bottom}>${next.top}`);
  }
  assert('A3_rows_do_not_overlap', overlaps.length === 0, `overlaps=${JSON.stringify(overlaps)}`);
  const shortRows = snap.rows.filter((r) => r.row.height < 44).map((r) => `${r.kindAttr}:${r.row.height}`);
  assert('A4_rows_tall_enough_for_three_lines', shortRows.length === 0, `short=${JSON.stringify(shortRows)}`);
  const clipped = snap.rows.filter((r) => r.rowScrollOverflow > 1).map((r) => `${r.kindAttr}:${r.rowScrollOverflow}`);
  assert('A5_no_content_clipped_inside_row', clipped.length === 0, `overflow=${JSON.stringify(clipped)}`);

  // B — 行内内容分层
  const kindColors = snap.rows.map((r) => `${r.kindText || ''}=${r.kindBg}`);
  const distinct = new Set(snap.rows.map((r) => r.kindBg)).size;
  assert('B0_kind_chip_label_and_semantic_bg', snap.rows.every((r) => r.kindText && r.kindBg) && distinct >= 3,
    `kinds=${kindColors.join(' | ')}`);
  assert('B1_title_single_line_ellipsis', snap.rows.every((r) => r.titleWhiteSpace === 'nowrap'
    && r.titleRect && Math.round(r.titleRect.height) <= Math.ceil(Number(r.titleRect.height) * 2)
    && Math.round(r.titleRect.height) < 40),
    `heights=${snap.rows.map((r) => (r.titleRect ? r.titleRect.height : -1)).join(',')}`);
  const longRow = snap.rows[1];
  const bodyMax = longRow.bodyLineHeight > 0 ? longRow.bodyLineHeight * 2 + 2 : 0;
  assert('B2_long_body_clamped_two_lines', longRow.bodyClamp === '2'
    && longRow.bodyLineHeight > 0 && longRow.bodyRect.height <= bodyMax
    && longRow.bodyScrollHeight > longRow.bodyRect.height,
    `clamp=${longRow.bodyClamp} lineH=${longRow.bodyLineHeight} shown=${longRow.bodyRect.height} full=${longRow.bodyScrollHeight}`);
  // F — 可读性下限：修复前面板没有自己的基准字号，继承标题栏工具按钮（11px 级），
  //     整块看着像挤成一团的乱码；现在面板基准=全局正文 token（rootFont×0.875，
  //     本应用 root=14px → 12.25px，与聊天正文同源；随 --petri-font-scale 用户缩放联动）。
  const bodySize = snap.rootFont * 0.875;
  const tiny = snap.rows
    .filter((r) => Math.abs(r.titleFont - bodySize) > 0.6 || Math.abs(r.bodyFont - bodySize) > 0.6)
    .map((r) => `${r.kindAttr}:${r.titleFont}/${r.bodyFont}`);
  assert('F0_panel_uses_body_font_size', snap.rootFont > 0
    && Math.abs(snap.panelFont - bodySize) <= 0.6 && tiny.length === 0,
    `panelFont=${snap.panelFont} bodySize=${bodySize} rootFont=${snap.rootFont} lh=${snap.panelLineHeight} tiny=${JSON.stringify(tiny)}`);
  const metas = snap.rows.map((r) => r.metaText);  // meta[2] 是 2 小时前的通知：00:00–01:59 之间跑会落「昨天」档，故两档都算命中（跨档属预期分桶，非缺陷）。
  assert('B3_relative_time_per_row', /^刚刚 · 点击打开$/.test(metas[0] || '')
    && /^\d+ 分钟前 · 点击打开/.test(metas[1] || '')
    && /^(今天|昨天) \d{2}:\d{2} · 点击打开$/.test(metas[2] || '')
    && /^\d+\/\d+ \d{2}:\d{2} · 点击打开$/.test(metas[3] || ''),
    `meta=${JSON.stringify(metas)}`);
  // 修复前这里是 new Date().toLocaleString() 整串绝对时间戳（含年份与秒），视觉上就是一团乱码。
  assert('B3b_no_absolute_locale_dump', metas.every((m) => !/\d{4}/.test(m || '')
    && !/\d{2}:\d{2}:\d{2}/.test(m || '')), `meta=${JSON.stringify(metas)}`);
  assert('B4_header_unread_count', /3 未读/.test(snap.headText || '') && /通知中心/.test(snap.headText || ''),
    `head=${snap.headText}`);

  // C — 未读标记是圆不是条
  const dots = snap.rows.filter((r) => r.readAttr === 'false').map((r) => ({ k: r.kindAttr, w: r.dotW, h: r.dotH }));
  assert('C0_unread_dot_is_circle', dots.length === 3
    && dots.every((d) => d.w > 0 && Math.abs(d.w - d.h) <= 2 && d.w <= 12),
    `dots=${JSON.stringify(dots)}`);
  const readRow = snap.rows[3];
  assert('C1_read_row_has_no_dot', readRow.dotW === null && readRow.disabled === false,
    `dot=${readRow.dotW} disabled=${readRow.disabled}`);

  // D — 弹层完整可见 + 命中本行
  const rc = snap.rect;
  assert('D0_panel_inside_viewport', rc.left >= 0 && rc.top >= 0
    && rc.right <= snap.vw && rc.bottom <= snap.vh && rc.width <= 360,
    `rect=${JSON.stringify(rc)} vw=${snap.vw} vh=${snap.vh}`);
  assert('D1_row_center_hits_panel', snap.rows.every((r) => r.hitSelf === true),
    `hits=${snap.rows.map((r) => r.hitSelf).join(',')}`);
  assert('D2_prefs_row_present', snap.prefInputs === 5, `inputs=${snap.prefInputs}`);

  // E — 操作
  const markAll = await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('[data-testid="notification-center-panel"] button')].find(function(b){ return b.textContent.trim() === '全部已读'; });
    if (!btn) return 'no_btn';
    btn.click(); return 'clicked';
  })()`);
  await sleep(500);
  const afterRead = parse(await evalRetry(client, MEASURE));
  assert('E0_mark_all_read_clears_dots_and_badge', markAll === 'clicked'
    && afterRead.dotCount === 0 && afterRead.badge === null
    && afterRead.rows.every((r) => r.readAttr === 'true'),
    `markAll=${markAll} dots=${afterRead.dotCount} badge=${afterRead.badge === null ? 'gone' : afterRead.badge}`);

  const cleared = await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('[data-testid="notification-center-panel"] button')].find(function(b){ return b.textContent.trim() === '清空'; });
    if (!btn) return 'no_btn';
    btn.click(); return 'clicked';
  })()`);
  await sleep(500);
  const afterClear = parse(await evalRetry(client, MEASURE));
  assert('E1_clear_shows_empty_state', cleared === 'clicked' && afterClear.itemCount === 0
    && /暂无通知/.test(afterClear.emptyText || ''),
    `cleared=${cleared} items=${afterClear.itemCount} empty=${afterClear.emptyText}`);
  assert('E2_actions_disabled_when_empty', afterClear.actions.length === 2
    && afterClear.actions.every((a) => a.disabled === true),
    `actions=${JSON.stringify(afterClear.actions)}`);

  const storageLeft = await evalRetry(client, `localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null'`);
  assert('E3_storage_cleared', storageLeft === '[]' || storageLeft === 'null', `stored=${String(storageLeft).slice(0, 60)}`);

  let screenshot = 'not_attempted';
  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: false }, { timeoutMs: 15000 });
    fs.writeFileSync(path.join(EVIDENCE, 'notification-center.png'), Buffer.from(shot.data, 'base64'));
    screenshot = 'saved';
  } catch (e) {
    screenshot = 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 100);
  }

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: '标题栏通知中心弹层（BLOCK-320/UI-625：独立弹层 + 类型标签/标题/正文两行/相对时间/未读圆点，不再复用 toolMenu）',
    seedCount: notices.length,
    panel: snap,
    afterRead, afterClear,
    notes: { screenshot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-notification-center.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-320 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block320-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
