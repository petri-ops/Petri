#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui550-install-deeplink-live — BLOCK-242 深链安装安全面实机腿。
 *
 * 隔离 9223（main 进程 PETRI_INSTALL_ALLOW_PRIVATE=1 + 隔离数据根）：
 * - pack 预览：mock manifest（loopback）→ 弹层显示名称/来源/下载地址/大小/SHA-256/
 *   风险/替换警告（同名 MCP）；
 * - mcp 深链真实安装：新 id 直接安装；冲突 id 未勾选拒绝、勾选后替换；
 *   安装后经 REST 核对 mcp-servers.json（隔离数据根）。
 * 亮/暗截图；收尾删除测试 MCP server 与 mock 服务。
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const APP = 'http://localhost:3000';
const TARGET_ID = 'ui550-target';
const NEW_ID = 'ui550-new';
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'ui-550');

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

function mcpLink(config) {
  const encoded = Buffer.from(JSON.stringify(config), 'utf8').toString('base64url');
  return `petri-install://mcp?config=${encoded}`;
}

function openDialogExpr(url) {
  return `(function(){ window.dispatchEvent(new CustomEvent('petri:open-install-deep-link', { detail: { url: ${JSON.stringify(url)} } })); return 'ok'; })()`;
}

module.exports = {
  id: 'ui550-install-deeplink-live',
  description: 'BLOCK-242 UI-550 实机腿：深链安装预览/风险/MCP 真实安装与替换（隔离 9223）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const manifestServer = http.createServer((req, res) => {
      const base = `http://127.0.0.1:${req.socket.localPort}`;
      if (req.url === '/manifest.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          pack: {
            packId: 'ui550-pack',
            name: 'UI-550 演示包',
            version: '1.0.0',
            archive: { url: `${base}/pack.zip`, sizeBytes: 4, sha256: 'a'.repeat(64) },
            mcpServers: [{ id: TARGET_ID, command: 'node', args: [] }],
          },
        }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((resolve) => manifestServer.listen(0, '127.0.0.1', resolve));
    const mockBase = `http://127.0.0.1:${manifestServer.address().port}`;
    let client = null;

    try {
      // 预置冲突 MCP server（触发替换警告）
      await rest('DELETE', `/mcp/servers/${TARGET_ID}`);
      await rest('POST', '/mcp/servers', { id: TARGET_ID, command: 'node', args: [], autoConnect: false });

      client = await lib.connectTestTarget({ timeoutMs: 60_000 });
      await lib.evalJs(client, `location.href = '${APP}/extensions'; 'ok'`);
      const entryReady = await waitFor(client, `!!document.querySelector('[data-testid="extensions-install-from-link"]')`, 30_000);
      assert('D1_manual_entry_present', entryReady === true);
      await lib.evalJs(client, `document.querySelector('[data-testid="extensions-install-from-link"]').click(); 'ok'`);

      // pack 预览：只读字段/风险/替换警告
      const packLink = `petri-install://pack?manifest=${encodeURIComponent(`${mockBase}/manifest.json`)}`;
      await lib.evalJs(client, `(function(){ const el=document.querySelector('[data-testid="install-deep-link-url"]'); const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; setter.call(el, ${JSON.stringify(packLink)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
      await lib.evalJs(client, `document.querySelector('[data-testid="install-deep-link-preview-button"]').click(); 'ok'`);
      const packText = await waitFor(
        client,
        `(function(){ const el=document.querySelector('[data-testid="install-deep-link-preview"]'); return el && el.textContent.includes('UI-550 演示包') ? el.textContent : null; })()`,
        20_000,
      );
      assert(
        'D2_pack_preview_fields',
        typeof packText === 'string'
          && packText.includes('UI-550 演示包')
          && packText.includes(mockBase)
          && packText.includes('a'.repeat(16))
          && packText.includes('来源未验证')
          && packText.includes(`将替换已有 MCP 配置 ${TARGET_ID}`),
        String(packText)
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const shot1 = await lib.screenshotPng(client, EVIDENCE, 'ui550-deeplink-preview-light.png');
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
      const shot2 = await lib.screenshotPng(client, EVIDENCE, 'ui550-deeplink-preview-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`);
      assert('D3_preview_screenshots', Boolean(shot1) && Boolean(shot2), `${shot1} | ${shot2}`);

      // mcp 深链：新 id 安装
      await lib.evalJs(client, openDialogExpr(mcpLink({ id: NEW_ID, command: process.execPath, args: [] })));
      const newPreview = await waitFor(
        client,
        `(function(){ const el=document.querySelector('[data-testid="install-deep-link-preview"]'); return el && el.textContent.includes('${NEW_ID}') ? el.textContent : null; })()`,
        20_000,
      );
      assert('D4_mcp_preview', String(newPreview).includes(NEW_ID), String(newPreview));
      await lib.evalJs(client, `document.querySelector('[data-testid="install-deep-link-install"]').click(); 'ok'`);
      const newResult = await waitFor(client, `document.querySelector('[data-testid="install-deep-link-result"]')?.textContent || null`, 20_000);
      assert('D5_mcp_installed', String(newResult).includes('安装完成'), String(newResult));
      const afterNew = await rest('GET', '/mcp/servers');
      assert('R1_new_mcp_persisted', afterNew.data?.servers?.some((row) => row.id === NEW_ID), JSON.stringify(afterNew.data?.servers?.map((row) => row.id)));

      // mcp 深链：冲突 id 未勾选拒绝、勾选后替换
      await lib.evalJs(client, openDialogExpr(mcpLink({ id: TARGET_ID, command: process.execPath, args: [] })));
      const conflictText = await waitFor(
        client,
        `(function(){ const el=document.querySelector('[data-testid="install-deep-link-preview"]'); return el && el.textContent.includes('${TARGET_ID}') ? el.textContent : null; })()`,
        20_000,
      );
      assert('D6_conflict_warning', String(conflictText).includes(`将替换已有 MCP 配置 ${TARGET_ID}`), String(conflictText));
      const disabledBefore = await waitFor(
        client,
        `document.querySelector('[data-testid="install-deep-link-install"]')?.disabled === true ? true : null`,
        10_000,
      );
      assert('D7_install_gated', disabledBefore === true, String(disabledBefore));
      await lib.evalJs(client, `document.querySelector('[data-testid="install-deep-link-replace-mcp"]').click(); 'ok'`);
      await lib.evalJs(client, `document.querySelector('[data-testid="install-deep-link-install"]').click(); 'ok'`);
      const replaced = await waitFor(client, `document.querySelector('[data-testid="install-deep-link-result"]')?.textContent || null`, 20_000);
      assert('D8_mcp_replaced', String(replaced).includes('安装完成'), String(replaced));

      await rest('DELETE', `/mcp/servers/${TARGET_ID}`);
      await rest('DELETE', `/mcp/servers/${NEW_ID}`);
      const after = await rest('GET', '/mcp/servers');
      assert(
        'R2_cleanup',
        !after.data?.servers?.some((row) => row.id === TARGET_ID || row.id === NEW_ID),
        JSON.stringify(after.data?.servers?.map((row) => row.id))
      );
    } finally {
      if (client) {
        try { await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`); } catch { /* ignore */ }
      }
      await rest('DELETE', `/mcp/servers/${TARGET_ID}`).catch(() => {});
      await rest('DELETE', `/mcp/servers/${NEW_ID}`).catch(() => {});
      manifestServer.closeAllConnections?.();
      await new Promise((resolve) => manifestServer.close(resolve));
    }
  },
};