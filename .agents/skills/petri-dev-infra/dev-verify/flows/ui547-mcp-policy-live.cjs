#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui547-mcp-policy-live — UI-547 MCP 货架工具治理实机腿。
 *
 * REST＝真后端 :3001：创建 fixture server（test/fixtures/mcp-fixture-server.cjs）→ 连接
 * → 默认投影 2；DOM＝9223 离屏测试实例：/extensions?tab=mcp → 治理编辑器 → 阻断
 * fixture_lookup_readonly → 保存 → 投影计数 2→1；亮/暗截图。收尾重置策略并移除 fixture。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const APP = 'http://localhost:3000';
const SERVER_ID = 'ui547-fixture';
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'ui-547');

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

function setInputExpr(testId, value) {
  return `(function(){
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
}

module.exports = {
  id: 'ui547-mcp-policy-live',
  description: 'UI-547 实机腿：MCP 货架工具治理 allow/block 编辑 → 保存 → 投影计数变化（9223 离屏）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    await rest('DELETE', `/mcp/servers/${SERVER_ID}`);
    const created = await rest('POST', '/mcp/servers', {
      id: SERVER_ID,
      command: 'node',
      args: [path.join(process.cwd(), 'test', 'fixtures', 'mcp-fixture-server.cjs')],
      autoConnect: false,
    });
    assert('R1_fixture_created', created.ok && created.data?.status === 'ok', JSON.stringify(created.data));

    await rest('PUT', `/mcp/servers/${SERVER_ID}/policy`, { allow: [], block: [] });
    const connected = await rest('POST', `/mcp/servers/${SERVER_ID}/connect`);
    assert(
      'R2_fixture_connected',
      connected.ok && connected.data?.toolCount === 2,
      JSON.stringify(connected.data)
    );

    const before = await rest('GET', '/mcp/servers');
    const beforeRow = before.data?.servers?.find((server) => server.id === SERVER_ID);
    assert(
      'R3_default_projection',
      beforeRow?.toolCount === 2 && beforeRow?.policy?.projectedToolCount === 2,
      JSON.stringify(beforeRow)
    );

    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      await lib.evalJs(client, `location.href = '${APP}/extensions?tab=mcp'; 'ok'`);
      const ready = await waitFor(
        client,
        `!!document.querySelector('[data-testid="mcp-policy-${SERVER_ID}"]')`,
        30_000
      );
      assert('D1_policy_editor_present', ready === true, 'MCP 货架应出现工具治理编辑器');

      const trust = await lib.evalJs(
        client,
        `document.querySelector('[data-testid="mcp-policy-trust-${SERVER_ID}"]')?.textContent || ''`
      );
      assert(
        'D2_trust_readonly',
        String(trust).includes('ask') && String(trust).includes('仅标记') === false,
        String(trust)
      );

      const metrics0 = await lib.evalJs(
        client,
        `document.querySelector('[data-testid="mcp-policy-metrics-${SERVER_ID}"]')?.textContent || ''`
      );
      assert(
        'D3_initial_metrics',
        String(metrics0).includes('生效 2') && String(metrics0).includes('已连接 2'),
        String(metrics0)
      );

      await lib.evalJs(client, setInputExpr(`mcp-policy-block-${SERVER_ID}`, 'fixture_lookup_readonly'));
      const saveClicked = await lib.evalJs(
        client,
        `(function(){
          const button = document.querySelector('[data-testid="mcp-policy-save-${SERVER_ID}"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      assert('D4_save_clicked', saveClicked === true);

      const notice = await waitFor(
        client,
        `(function(){
          const el = document.querySelector('[data-testid="mcp-notice"]');
          return el && el.textContent.includes('已保存 ${SERVER_ID}') ? el.textContent : null;
        })()`,
        20_000
      );
      assert('D5_saved_notice', typeof notice === 'string', String(notice));

      const metrics1 = await waitFor(
        client,
        `(function(){
          const el = document.querySelector('[data-testid="mcp-policy-metrics-${SERVER_ID}"]');
          return el && el.textContent.includes('生效 1') ? el.textContent : null;
        })()`,
        20_000
      );
      assert('D6_projected_count_drops', typeof metrics1 === 'string', String(metrics1));

      const policyAfter = await rest('GET', `/mcp/servers/${SERVER_ID}/policy`);
      assert(
        'R3_policy_persisted',
        policyAfter.ok
          && Array.isArray(policyAfter.data?.policy?.block)
          && policyAfter.data.policy.block.includes('fixture_lookup_readonly'),
        JSON.stringify(policyAfter.data)
      );

      await lib.evalJs(
        client,
        `document.querySelector('[data-testid="mcp-policy-${SERVER_ID}"]')?.scrollIntoView({ block: 'center' }); 'ok'`
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const shot = await lib.screenshotPng(client, EVIDENCE, 'ui547-mcp-policy-light.png');
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const shotDark = await lib.screenshotPng(client, EVIDENCE, 'ui547-mcp-policy-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`);
      assert('D7_screenshots', Boolean(shot) && Boolean(shotDark), `${shot} | ${shotDark}`);
    } finally {
      await rest('PUT', `/mcp/servers/${SERVER_ID}/policy`, { allow: [], block: [] });
      await rest('DELETE', `/mcp/servers/${SERVER_ID}`);
    }

    const after = await rest('GET', '/mcp/servers');
    const afterRow = after.data?.servers?.find((server) => server.id === SERVER_ID);
    assert('R4_fixture_removed', !afterRow, JSON.stringify(afterRow ?? null));
  },
};
