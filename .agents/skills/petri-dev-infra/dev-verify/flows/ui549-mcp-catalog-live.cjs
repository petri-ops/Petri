#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui549-mcp-catalog-live — BLOCK-241 大目录懒加载实机腿。
 *
 * REST 配置 many-tools stdio server（6 工具）→ connect → 货架显示
 * “目录模式 · 6 个工具按需加载 · 生效入口 2” → 亮/暗截图；收尾移除 server。
 * 后端需以 PETRI_MCP_CATALOG_THRESHOLD=3 启动（flow 只验证状态面/UI）。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const APP = 'http://localhost:3000';
const SERVER_ID = 'ui549-many';
const FIXTURE = path.join(process.cwd(), 'test', 'fixtures', 'mcp-many-tools-server.cjs');
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'ui-549');

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
  id: 'ui549-mcp-catalog-live',
  description: 'BLOCK-241 UI-549 实机腿：大目录 MCP server 货架显示目录模式（9223 离屏）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    let client = null;
    try {
      await rest('DELETE', `/mcp/servers/${SERVER_ID}`);
      const created = await rest('POST', '/mcp/servers', {
        id: SERVER_ID,
        command: process.execPath,
        args: [FIXTURE],
        autoConnect: false,
      });
      assert('R1_many_server_created', created.ok && created.data?.status === 'ok', JSON.stringify(created.data));

      const connect = await rest('POST', `/mcp/servers/${SERVER_ID}/connect`);
      assert('R2_connected_six_tools', connect.ok && connect.data?.toolCount === 6, JSON.stringify(connect.data));

      const listed = await rest('GET', '/mcp/servers');
      const row = listed.data?.servers?.find((item) => item.id === SERVER_ID);
      assert(
        'R3_catalog_mode',
        row?.status === 'connected'
          && row?.policy?.catalogMode?.mode === 'catalog'
          && row?.policy?.catalogMode?.total === 6
          && row?.policy?.projectedToolCount === 2,
        JSON.stringify(row?.policy)
      );

      client = await lib.connectTestTarget({ timeoutMs: 60_000 });
      await lib.evalJs(client, `location.href = '${APP}/extensions?tab=mcp'; 'ok'`);
      const ready = await waitFor(
        client,
        `!!document.querySelector('[data-testid="mcp-policy-metrics-${SERVER_ID}"]')`,
        30_000
      );
      assert('D1_catalog_metrics_present', ready === true);
      const metrics = await lib.evalJs(
        client,
        `document.querySelector('[data-testid="mcp-policy-metrics-${SERVER_ID}"]')?.textContent || ''`
      );
      assert(
        'D2_catalog_mode_copy',
        String(metrics).includes('目录模式')
          && String(metrics).includes('6 个工具按需加载')
          && String(metrics).includes('生效入口 2'),
        String(metrics)
      );

      await lib.evalJs(
        client,
        `document.querySelector('[data-testid="mcp-card-${SERVER_ID}"]')?.scrollIntoView({ block: 'center' }); 'ok'`
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const shot = await lib.screenshotPng(client, EVIDENCE, 'ui549-mcp-catalog-light.png');
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const shotDark = await lib.screenshotPng(client, EVIDENCE, 'ui549-mcp-catalog-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`);
      assert('D3_screenshots', Boolean(shot) && Boolean(shotDark), `${shot} | ${shotDark}`);

      await rest('DELETE', `/mcp/servers/${SERVER_ID}`);
      const after = await rest('GET', '/mcp/servers');
      assert(
        'R4_server_removed',
        !after.data?.servers?.some((item) => item.id === SERVER_ID),
        JSON.stringify(after.data?.servers?.map((item) => item.id))
      );
    } finally {
      if (client) {
        try { await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`); } catch {}
      }
      await rest('DELETE', `/mcp/servers/${SERVER_ID}`).catch(() => {});
    }
  },
};
