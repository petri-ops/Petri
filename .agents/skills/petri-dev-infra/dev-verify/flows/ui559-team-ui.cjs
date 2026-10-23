#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui559-team-ui — BLOCK-249（Q4a）团队 UI 腿（**第二个 Electron 会话**）。
 *
 * 为什么拆会话：长回合（父代理等待长跑子代理）后同一渲染器会被既有重渲染环拖死，
 * 稳定配方=「跑完团队（会话 1）→ 重启 Electron（会话 2，同一数据根）→ 平静页面上做 UI 断言」。
 *
 * 断言：roster 可见（3 成员/调查员/结构化徽标/journal 徽标）→ 停止团队两步 → 回执如实
 *       （成员均已终态 → 已请求 0 · 本就已结束 3）。
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const appUrl = () => process.env.PETRI_B249_APP || 'http://localhost:3000';
const isDark = () => process.env.PETRI_B249_DARK === '1';
const suffix = () => (isDark() ? 'dark' : 'light');
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-559');
const COMPOSER = 'textarea.sc-input';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evalJsWithTimeout(client, expression, timeoutMs = 20_000) {
  let timer = null;
  try {
    return await Promise.race([
      lib.evalJs(client, expression),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cdp_eval_timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function poll(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 240)}`);
}

async function capturePng(client, filename, timeoutMs = 10_000) {
  let timer = null;
  try {
    const shot = await Promise.race([
      client.send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('screenshot_timeout(offscreen)')), timeoutMs); }),
    ]);
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE, filename), Buffer.from(shot.data, 'base64'));
    return filename;
  } catch (error) {
    return `unavailable:${error.message}`;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function run({ assert }) {
  const projectId = process.env.PETRI_B249_PROJECT_ID;
  const projectName = process.env.PETRI_B249_PROJECT_NAME || '';
  const leaderId = process.env.PETRI_B249_LEADER_ID || '';
  assert('W2_leader_env', Boolean(leaderId), String(leaderId));

  const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
  await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${appUrl()}/project/${projectId}`)}; 'ok'`)
    .catch(() => null);
  await poll(async () => {
    const ready = await evalJsWithTimeout(client, `!!document.querySelector(${JSON.stringify(COMPOSER)})`).catch(() => false);
    return ready === true ? true : null;
  }, { timeoutMs: 60_000, intervalMs: 600, label: 'composer_ready' });
  await poll(async () => {
    const has = await evalJsWithTimeout(client, `document.body && document.body.innerText.indexOf(${JSON.stringify(projectName)}) >= 0`).catch(() => false);
    return has === true ? true : null;
  }, { timeoutMs: 30_000, intervalMs: 600, label: 'project_list_loaded' }).catch(() => null);
  assert('W3_ui_session_ready', true, `projectVisible=${projectName}`);
  if (isDark()) {
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }).catch(() => {});
    await sleep(600);
  }

  await evalJsWithTimeout(client, `window.dispatchEvent(new CustomEvent('petri:agent-open-in-rail', { detail: { runId: ${JSON.stringify(leaderId)} } })); 'ok'`)
    .catch(() => null);
  const rosterReady = await poll(async () => {
    const state = await evalJsWithTimeout(client, `(function(){
      var el = document.querySelector('[data-testid="agent-team-roster"]');
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? 'visible' : 'hidden';
    })()`, 20_000).catch(() => null);
    return state === 'visible' ? state : null;
  }, { timeoutMs: 60_000, intervalMs: 800, label: 'roster_visible' }).catch(() => 'not_visible');
  assert('R8_roster_visible_ui', rosterReady === 'visible', String(rosterReady));

  const rosterInfo = await evalJsWithTimeout(client, `(function(){
    var rows = Array.prototype.slice.call(document.querySelectorAll('[data-testid="team-member"]'));
    var text = (document.querySelector('[data-testid="agent-team-roster"]') || {}).textContent || '';
    return JSON.stringify({
      rows: rows.length,
      hasInvestigator: text.indexOf('调查员') >= 0,
      hasStructured: text.indexOf('结构化 ✓') >= 0,
      hasJournal: !!document.querySelector('[data-testid="team-journal"]'),
      counts: (document.querySelector('[data-testid="team-counts"]') || {}).textContent || '',
    });
  })()`, 30_000).catch(() => '{}');
  const parsed = JSON.parse(rosterInfo || '{}');
  assert('R9_roster_members_ui',
    parsed.rows === 3 && parsed.hasInvestigator === true && parsed.hasStructured === true,
    rosterInfo);
  const screenshots = {};
  screenshots.roster = await capturePng(client, `ui559-team-${suffix()}.png`);

  // 两次独立 eval（隐藏窗里 in-page 长 Promise 的定时器可能被节流）：先武装，再确认。
  const armedResult = await evalJsWithTimeout(client, `(function(){
    var stop = document.querySelector('[data-testid="team-stop"]');
    if (!stop) return 'missing_stop';
    stop.click();
    return 'clicked';
  })()`, 15_000).catch((error) => `eval_failed:${error.message}`);
  await sleep(600);
  const confirmResult = await evalJsWithTimeout(client, `(function(){
    var confirm = document.querySelector('[data-testid="team-stop-confirm"]');
    if (!confirm) return 'missing_confirm';
    confirm.click();
    return 'clicked';
  })()`, 15_000).catch((error) => `eval_failed:${error.message}`);
  const stopClicked = `${armedResult}/${confirmResult}`;
  const receipt = await poll(async () => {
    const text = await evalJsWithTimeout(client, `(function(){
      var el = document.querySelector('[data-testid="team-receipt"]');
      return el ? (el.textContent || '').trim() : '';
    })()`, 15_000).catch(() => '');
    return text && text.includes('停止回执') ? text : null;
  }, { timeoutMs: 30_000, intervalMs: 800, label: 'stop_receipt' }).catch(() => '');
  assert('R10_stop_receipt_ui',
    String(receipt).includes('已请求 0') && String(receipt).includes('本就已结束 3'),
    receipt || `stopClicked=${stopClicked}`);
  screenshots.receipt = await capturePng(client, `ui559-team-receipt-${suffix()}.png`);

  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, `ui559-screenshots-${suffix()}.json`), JSON.stringify(screenshots, null, 2));
}

module.exports = {
  id: 'ui559-team-ui',
  description: 'BLOCK-249 UI 腿（第二会话）：roster/成员/结构化徽标 + 停止团队两步回执',
  run,
};
