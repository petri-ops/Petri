#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: q8rem-mcp-tail-live — BLOCK-258（Q8-REM MCP 尾项）实机腿。
 *
 * A0a backend_rest_healthy
 * A0b app_page_ready
 * A1 mcp_shelf_ready
 * A2 sse_added_via_form         SSE + 自定义 Header 经 UI 表单保存
 * A3 sse_connected              连接成功、工具 1、Header 数量可见
 * A4 header_value_not_rendered  Header 值不出现在 DOM
 * A5 oauth_revoke               「断开授权」后已授权徽标消失、server 仍保留
 * A6 spa_clean
 *
 * 诚实边界：截图离屏 unavailable；SSE/OAuth 均为 127.0.0.1 本地夹具。
 */

const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
let activeClient = null;

async function ensureClient() {
  if (activeClient) {
    try { await lib.evalJs(activeClient, '1', 4000); return activeClient; } catch { activeClient = null; }
  }
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const chosen = await lib.selectPageTarget(pages, { probe: async (candidate) => lib.evalJs(candidate, `!!document.getElementById('root')`).catch(() => false) });
  activeClient = await lib.connectTarget(chosen);
  return activeClient;
}

async function evalRetry(_client, expr, tries = 4) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(await ensureClient(), expr, 8000); } catch (e) { lastErr = e; await sleep(500); }
  }
  throw lastErr;
}

async function navigate(url) {
  const live = await ensureClient();
  try { await live.send('Page.navigate', { url }); } catch { activeClient = null; }
  await sleep(1200);
}

async function pagePoll(_client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await Promise.race([
      evalRetry(null, expr, 1),
      new Promise((resolve) => setTimeout(() => resolve('poll_timeout'), 6000)),
    ]).catch((e) => `eval_err:${e.message}`);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(600);
  }
  throw new Error(`page_poll_timeout: ${label} :: ${String(last).slice(0, 200)}`);
}

/** React 受控输入：原生 setter + input/change 冒泡。 */
function setValueScript(selector, value) {
  return `(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'no_element';
    var proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
      : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set';
  })()`;
}

async function dismissFirstRun() {
  await evalRetry(null, `(function(){
    var btn = document.querySelector('[data-testid="role-reveal-start"]');
    if (btn) { btn.click(); return 'dismissed'; }
    return 'absent';
  })()`).catch(() => 'ignore');
}

module.exports = {
  id: 'q8rem-mcp-tail-live',
  description: 'BLOCK-258 Q8-REM：SSE + 自定义 Header + OAuth 本地撤销',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-258'),

  async run(ctx) {
    const { assert, sseUrl, sseHeader, sseKey, oauthId } = ctx;
    let client = null;

    const health = await fetch(API + '/mcp/servers', { headers: AUTH });
    assert('A0a_backend_rest_healthy', health.ok, `status=${health.status}`);
    client = await ensureClient();
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'root', timeoutMs: 30000 });
    assert('A0b_app_page_ready', true, 'root 就绪');

    await navigate(`${APP_ORIGIN}/extensions?tab=mcp`);
    await dismissFirstRun();
    await pagePoll(client, `String(!!document.querySelector('[data-testid="mcp-shelf"]'))`, { label: 'mcp shelf', timeoutMs: 30000 });
    assert('A1_mcp_shelf_ready', true, 'MCP 货架可见');

    await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="mcp-add-toggle"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="mcp-add-form"]'))`, { label: 'add form', timeoutMs: 10000 });

    const setTransport = await evalRetry(null, setValueScript('[data-testid="mcp-form-transport"]', 'sse'));
    const setId = await evalRetry(null, setValueScript('[data-testid="mcp-form-id"]', 'sse-live'));
    const setUrl = await evalRetry(null, setValueScript('[data-testid="mcp-form-url"]', sseUrl));
    const setHeaders = await evalRetry(null, setValueScript('[data-testid="mcp-form-headers"]', `${sseHeader}: ${sseKey}`));
    const submitted = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="mcp-form-submit"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    assert(
      'A2_sse_added_via_form',
      [setTransport, setId, setUrl, setHeaders, submitted].every((v) => v === 'set' || v === 'clicked')
        && await pagePoll(client, `String(!!document.querySelector('[data-testid="mcp-card-sse-live"]'))`, { label: 'sse card', timeoutMs: 15000 }) === 'true',
      `transport=${setTransport} id=${setId} url=${setUrl} headers=${setHeaders} submit=${submitted}`,
    );

    await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="mcp-connect-sse-live"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    const connected = await pagePoll(client, `(function(){
      var card = document.querySelector('[data-testid="mcp-card-sse-live"]');
      if (!card || card.getAttribute('data-status') !== 'connected') return '';
      return JSON.stringify({
        text: card.innerText,
        headerCount: (card.querySelector('[data-testid="mcp-header-count-sse-live"]') || {}).textContent || '',
      });
    })()`, { label: 'sse connected', timeoutMs: 30000 });
    const connectedData = JSON.parse(connected);
    assert(
      'A3_sse_connected',
      connectedData.text.includes('1 个工具') && connectedData.headerCount.includes('1'),
      connected,
    );

    const leaked = await evalRetry(null, `String(document.body.innerText.includes(${JSON.stringify(sseKey)}))`);
    assert('A4_header_value_not_rendered', leaked === 'false', `leaked=${leaked}`);

    await pagePoll(client, `String(!!document.querySelector('[data-testid="mcp-auth-badge-${oauthId}"]'))`, { label: 'oauth badge', timeoutMs: 20000 });
    const revoked = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="mcp-revoke-${oauthId}"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    assert('A5a_oauth_revoke_clicked', revoked === 'clicked', revoked);
    const notice = await pagePoll(
      client,
      `String((document.querySelector('[data-testid="mcp-notice"]') || {}).textContent || '')`,
      { label: 'revoke notice', timeoutMs: 15000 },
    ).catch((e) => `poll_failed:${e.message}`);
    assert('A5b_revoke_notice', String(notice).includes('已撤销'), String(notice).slice(0, 200));
    const badgeGone = await pagePoll(
      client,
      `String(!document.querySelector('[data-testid="mcp-auth-badge-${oauthId}"]'))`,
      { label: 'badge gone', timeoutMs: 15000 },
    ).catch((e) => `poll_failed:${e.message}`);
    assert('A5c_oauth_badge_gone', badgeGone === 'true', badgeGone);
    const kept = await pagePoll(
      client,
      `String(!!document.querySelector('[data-testid="mcp-card-${oauthId}"]'))`,
      { label: 'server kept', timeoutMs: 10000 },
    ).catch((e) => `poll_failed:${e.message}`);
    assert('A5d_server_kept', kept === 'true', kept);

    await navigate(`${APP_ORIGIN}/?test=1`);
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'spa reset', timeoutMs: 30000 });
    assert('A6_spa_clean', true, '收尾回 ?test=1');
  },
};
