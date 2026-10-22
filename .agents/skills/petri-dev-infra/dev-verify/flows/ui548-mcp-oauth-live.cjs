#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui548-mcp-oauth-live — BLOCK-239 MCP OAuth 实机腿。
 *
 * 真实链路：mock OAuth auth server + Bearer 保护的 MCP /mcp（test/fixtures/mcp-oauth-server.mjs）
 * → REST 配置 HTTP server → 9223 离屏货架显示“需要授权”+ url + 授权按钮 →
 * 页面内点击授权（window.open 被探针截获，避免真的拉起系统浏览器）→ flow 模拟浏览器
 * 打开授权 URL（auto-approve → backend callback）→ 后端 connected → UI 显示已连接/已授权。
 * 收尾删除 server 并关闭 mock server。亮/暗截图。
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const APP = 'http://localhost:3000';
const SERVER_ID = 'ui548-oauth';
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'ui-548');

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: { 'content-type': 'application/json', Authorization: 'Bearer desktop-local' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

async function waitFor(client, expr, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await lib.evalJs(client, expr);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

module.exports = {
  id: 'ui548-mcp-oauth-live',
  description: 'BLOCK-239 UI-548 实机腿：MCP HTTP server OAuth 授权 → connected + 工具出现（9223 离屏）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const fixture = await import(pathToFileURL(path.join(process.cwd(), 'test', 'fixtures', 'mcp-oauth-server.mjs')).href);
    const mock = await fixture.startMcpOAuthServer();
    let client = null;

    try {
      await rest('DELETE', `/mcp/servers/${SERVER_ID}`);
      const created = await rest('POST', '/mcp/servers', {
        id: SERVER_ID,
        command: 'ignored',
        transport: 'http',
        url: mock.mcpUrl,
        autoConnect: false,
      });
      assert('R1_http_server_created', created.ok && created.data?.status === 'ok', JSON.stringify(created.data));

      const connect = await rest('POST', `/mcp/servers/${SERVER_ID}/connect`);
      assert(
        'R2_connect_requires_auth',
        connect.status === 502 && connect.data?.error === 'authorization_required',
        `HTTP ${connect.status} ${JSON.stringify(connect.data)}`
      );
      const before = await rest('GET', '/mcp/servers');
      const rowBefore = before.data?.servers?.find((row) => row.id === SERVER_ID);
      assert(
        'R3_auth_required_zero_tools',
        rowBefore?.status === 'auth_required' && rowBefore?.auth === 'required' && rowBefore?.toolCount === 0,
        JSON.stringify(rowBefore)
      );

      client = await lib.connectTestTarget({ timeoutMs: 60_000 });
      await lib.evalJs(client, `location.href = '${APP}/extensions?tab=mcp'; 'ok'`);
      const cardReady = await waitFor(
        client,
        `!!document.querySelector('[data-testid="mcp-card-${SERVER_ID}"]')`,
        30_000,
      );
      assert('D1_card_present', cardReady === true);
      const cardText = await lib.evalJs(
        client,
        `document.querySelector('[data-testid="mcp-card-${SERVER_ID}"]')?.textContent || ''`,
      );
      assert(
        'D2_card_shows_auth_required_and_url',
        String(cardText).includes('需要授权') && String(cardText).includes(mock.mcpUrl),
        String(cardText)
      );

      await lib.evalJs(
        client,
        `(function(){
          window.__petriOpened = [];
          window.open = function(url) { window.__petriOpened.push(String(url)); return null; };
          return 'ok';
        })()`
      );
      await lib.evalJs(
        client,
        `(function(){
          const btn = document.querySelector('[data-testid="mcp-authenticate-${SERVER_ID}"]');
          if (!btn) return false;
          btn.click();
          return true;
        })()`
      );
      const authorizationUrl = await waitFor(
        client,
        `(window.__petriOpened && window.__petriOpened.length) ? window.__petriOpened[0] : null`,
        20_000,
      );
      assert(
        'D3_authorize_clicked_opens_url',
        typeof authorizationUrl === 'string' && authorizationUrl.includes('/authorize'),
        String(authorizationUrl)
      );

      const browser = await fetch(String(authorizationUrl), { redirect: 'follow' });
      assert('R4_callback_completed', browser.status === 200, `HTTP ${browser.status}`);

      const connected = await (async () => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const current = await rest('GET', '/mcp/servers');
          const row = current.data?.servers?.find((item) => item.id === SERVER_ID);
          if (row && row.status === 'connected' && row.toolCount === 2) return row;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return null;
      })();
      assert(
        'R5_connected_with_tools',
        connected?.auth === 'authorized' && connected?.toolCount === 2,
        JSON.stringify(connected)
      );

      const uiConnected = await waitFor(
        client,
        `(function(){
          const card = document.querySelector('[data-testid="mcp-card-${SERVER_ID}"]');
          const badge = document.querySelector('[data-testid="mcp-auth-badge-${SERVER_ID}"]');
          return card && card.textContent.includes('已连接') && badge ? card.textContent : null;
        })()`,
        20_000,
      );
      assert('D4_ui_shows_connected_and_authorized', typeof uiConnected === 'string', String(uiConnected));

      await lib.evalJs(
        client,
        `document.querySelector('[data-testid="mcp-card-${SERVER_ID}"]')?.scrollIntoView({ block: 'center' }); 'ok'`
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const shot = await lib.screenshotPng(client, EVIDENCE, 'ui548-mcp-oauth-light.png');
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const shotDark = await lib.screenshotPng(client, EVIDENCE, 'ui548-mcp-oauth-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`);
      assert('D5_screenshots', Boolean(shot) && Boolean(shotDark), `${shot} | ${shotDark}`);

      await rest('DELETE', `/mcp/servers/${SERVER_ID}`);
      const after = await rest('GET', '/mcp/servers');
      const rowAfter = after.data?.servers?.find((row) => row.id === SERVER_ID);
      assert('R6_server_removed', !rowAfter, JSON.stringify(rowAfter ?? null));
    } finally {
      if (client) {
        try { await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`); } catch {}
      }
      await rest('DELETE', `/mcp/servers/${SERVER_ID}`).catch(() => {});
      await mock.close();
    }
  },
};
