#!/usr/bin/env node
'use strict';

/**
 * BLOCK-156 P2 实机校验 flow — MCP 客户端基座（stdio 连接管理 + 配置面）。
 *
 * 前置：主 dev 栈在跑（后端 :3001 已含 routes/mcp-client）+ 测试实例（CDP 9223）。
 * 断言：
 *   ①HTTP 生命周期：add → connect（夹具 server，toolCount=1）→ tools 含 fixture_echo
 *   ②自家回环：petri-mcp stdio server（src/mcp-server.js）作为第三方被连对象 connect ok
 *   ③UI 在场证据：/extensions?tab=mcp 货架呈现已连接卡片（状态徽标+工具计数）
 *   ④断开 → 状态回落 disconnected；清理复原（server 移除）
 * 红线：只连测试实例 9223；绝不触碰 9222 用户主窗口。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REPO = lib.findRepoRoot(__dirname) || process.cwd();
const FIXTURE = path.join(REPO, 'test', 'fixtures', 'mcp-fixture-server.cjs');
const SELF_SERVER = path.join(REPO, 'src', 'mcp-server.js');
const NODE = process.execPath;

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await resp.json(); } catch {}
  return { ok: resp.ok, status: resp.status, data };
}

async function evalRetry(client, expr, tries = 10) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(400); }
  }
  throw lastErr;
}

module.exports = {
  id: 'block156-mcp-client',
  description: 'BLOCK-156 P2：MCP 客户端基座——stdio 连接生命周期 + 自家回环 + 货架 UI 在场',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-156'),

  async run(ctx) {
    const { assert } = ctx;

    // ── 清场（幂等）：移除本 flow 专用 server ──
    for (const id of ['b156-fixture', 'b156-self']) {
      await rest('POST', `/mcp/servers/${id}/disconnect`).catch(() => {});
      await rest('DELETE', `/mcp/servers/${id}`).catch(() => {});
    }

    // ── B1: add（夹具 + 自家 server 双配置） ──
    const addFixture = await rest('POST', '/mcp/servers', {
      id: 'b156-fixture', command: NODE, args: [FIXTURE], autoConnect: false,
    });
    assert('fixture_server_added', addFixture.ok, JSON.stringify(addFixture).slice(0, 160));
    const addSelf = await rest('POST', '/mcp/servers', {
      id: 'b156-self', command: NODE, args: [SELF_SERVER], autoConnect: false,
    });
    assert('self_server_added', addSelf.ok, JSON.stringify(addSelf).slice(0, 160));

    // ── B2: connect 夹具 → 工具发现确定性 ──
    const connFixture = await rest('POST', '/mcp/servers/b156-fixture/connect');
    assert('fixture_connect_toolcount_1',
      connFixture.ok && connFixture.data.toolCount === 1,
      JSON.stringify(connFixture).slice(0, 200));
    const toolsResp = await rest('GET', '/mcp/servers/b156-fixture/tools');
    const toolNames = (toolsResp.data.tools || []).map((t) => t.name);
    assert('fixture_tools_list_has_fixture_echo',
      toolNames.includes('fixture_echo'), JSON.stringify(toolNames));

    // ── B3: 自家 petri-mcp 作为第三方被连对象（回环） ──
    const connSelf = await rest('POST', '/mcp/servers/b156-self/connect');
    assert('self_mcp_loopback_connect_ok',
      connSelf.ok, JSON.stringify(connSelf).slice(0, 200));

    // ── B4: UI 在场证据（测试实例，非只打 API 的全绿） ──
    const client = await lib.connectTestTarget({ timeoutMs: ctx.timeoutMs ?? 30_000 });
    try {
      await lib.evalJs(client, `location.href = 'http://localhost:3000/extensions?tab=mcp'; 'nav'`);
      await sleep(2500);
      const ui = JSON.parse(await evalRetry(client, `(function(){
        const shelf = document.querySelector('[data-testid="mcp-shelf"]');
        if (!shelf) return JSON.stringify({ shelf: false });
        const fixtureCard = document.querySelector('[data-testid="mcp-card-b156-fixture"]');
        const selfCard = document.querySelector('[data-testid="mcp-card-b156-self"]');
        return JSON.stringify({
          shelf: true,
          fixtureStatus: fixtureCard ? fixtureCard.getAttribute('data-status') : 'missing',
          fixtureText: fixtureCard ? fixtureCard.textContent : '',
          selfStatus: selfCard ? selfCard.getAttribute('data-status') : 'missing',
        });
      })()`, 15));
      assert('mcp_shelf_ui_present_with_connected_cards',
        ui.shelf && ui.fixtureStatus === 'connected' && ui.selfStatus === 'connected'
          && ui.fixtureText.includes('1 个工具'),
        `shelf=${ui.shelf} fixture=${ui.fixtureStatus} self=${ui.selfStatus}`);
      await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'block-156'), 'p2-mcp-shelf-connected.png');
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }

    // ── B5: 断开回落 + 清理复原 ──
    const disconn = await rest('POST', '/mcp/servers/b156-fixture/disconnect');
    assert('disconnect_returns_ok', disconn.ok, JSON.stringify(disconn).slice(0, 160));
    const statuses = await rest('GET', '/mcp/servers');
    const fixtureRow = (statuses.data.servers || []).find((s) => s.id === 'b156-fixture');
    assert('status_falls_back_to_disconnected',
      fixtureRow && fixtureRow.status === 'disconnected', JSON.stringify(fixtureRow).slice(0, 160));

    for (const id of ['b156-fixture', 'b156-self']) {
      await rest('POST', `/mcp/servers/${id}/disconnect`).catch(() => {});
      await rest('DELETE', `/mcp/servers/${id}`).catch(() => {});
    }
    const after = await rest('GET', '/mcp/servers');
    const leftovers = (after.data.servers || []).filter((s) => s.id.startsWith('b156-'));
    assert('cleanup_no_b156_leftovers', leftovers.length === 0, JSON.stringify(leftovers.map((s) => s.id)));

    return true;
  },
};
