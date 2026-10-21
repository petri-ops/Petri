#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block229-computer-use-status-live — BLOCK-229 E7 状态面（UI-542）
 *
 * REST＝真后端：/api/computer-use/status（built=true）+ /probe（真实 sidecar probe）。
 * DOM＝9223 离屏测试实例：设置「决策与调度」节的面板显示已构建，点「测试连接」返回 verbs；亮/暗截图。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const APP = 'http://localhost:3000';
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'block-229');

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: AUTH,
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
  id: 'block229-computer-use-status-live',
  description: 'BLOCK-229 E7 实机腿：sidecar 状态（已构建）+ 真实 probe verbs + 设置面板（9223 离屏）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    const status = await rest('GET', '/computer-use/status');
    assert(
      'R1_status_built',
      status.ok && status.data?.ok === true && status.data?.built === true && status.data?.supported === true,
      JSON.stringify(status.data)
    );
    const probe = await rest('POST', '/computer-use/probe');
    assert(
      'R2_real_probe',
      probe.ok && probe.data?.ok === true && Array.isArray(probe.data?.probe?.verbs) && probe.data.probe.verbs.includes('snapshot'),
      JSON.stringify(probe.data)
    );

    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      await lib.evalJs(client, `location.href = '${APP}/settings?section=decisions'; 'ok'`);
      const ready = await waitFor(client, `!!document.querySelector('[data-testid="computer-use-panel"]')`, 30_000);
      assert('D1_panel_present', ready === true, '设置决策节应有电脑控制面板');
      const statusText = await waitFor(
        client,
        `(function(){
          const el = document.querySelector('[data-testid="computer-use-status"]');
          return el && el.textContent && el.textContent.includes('已构建 是') ? el.textContent : null;
        })()`,
        20_000
      );
      assert('D2_status_built_in_ui', typeof statusText === 'string' && statusText.includes('已构建 是'), String(statusText));

      await lib.evalJs(
        client,
        `(function(){
          const panel = document.querySelector('[data-testid="computer-use-panel"]');
          const btn = panel && [...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === '测试连接');
          if (btn) btn.click();
          return 'ok';
        })()`
      );
      const probeText = await waitFor(
        client,
        `document.querySelector('[data-testid="computer-use-probe"]')?.textContent || null`,
        20_000
      );
      assert('D3_probe_verbs_in_ui', typeof probeText === 'string' && probeText.includes('snapshot'), String(probeText));
      await lib.evalJs(
        client,
        `(function(){
          document.querySelector('[data-testid="crash-notice-dismiss"]')?.click();
          document.querySelector('[data-testid="computer-use-panel"]')?.scrollIntoView({ block: 'center' });
          return 'ok';
        })()`
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      const shot = await lib.screenshotPng(client, EVIDENCE, 'ui542-computer-use-panel.png');
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
      const shotDark = await lib.screenshotPng(client, EVIDENCE, 'ui542-computer-use-panel-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`);
      assert('D4_screenshots', Boolean(shot) && Boolean(shotDark), `${shot} | ${shotDark}`);
    } finally {
      try { await lib.evalJs(client, `document.querySelector('.sc-model-overlay')?.click(); 'ok'`); } catch {}
    }
  },
};
