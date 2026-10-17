#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block202-network-runtime-live — BLOCK-202 W3 实机腿（UI-519 / UI-520）
 *
 * REST 腿＝真后端：网络代理写入后 `restartRequired=true`（不谎称即时生效）、非法值 400、
 *   运行时策略写入与 env 遮蔽、回环豁免在生效 NO_PROXY 里。
 * DOM 腿＝9223 离屏测试实例：计算与数据节的代理面板、决策节的审批与编排面板真实渲染。
 *
 * 无可见窗口纪律（用户 2026-10-17 裁决）：只连 9223 离屏实例，探针跑完由外层 kill。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const APP = 'http://localhost:3000';

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

async function navigate(client, url, opts = {}) {
  await lib.evalJs(client, `location.href = ${JSON.stringify(url)}; 'ok'`);
  const needles = opts.urlIncludes || [];
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const ready = await lib.evalJs(client, `(function(){
      const here = String(location.href);
      for (const needle of ${JSON.stringify(needles)}) if (here.indexOf(needle) === -1) return false;
      ${opts.selector ? `return !!document.querySelector(${JSON.stringify(opts.selector)});` : 'return document.readyState === "complete";'}
    })()`);
    if (ready) return true;
  }
  return false;
}

module.exports = {
  id: 'block202-network-runtime-live',
  description: 'BLOCK-202 W3 实机腿：代理写入需重启/非法拒绝 + 运行时策略与 env 遮蔽 + 两面板渲染（9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-202'),

  async run({ assert }) {
    fs.mkdirSync(path.join(process.cwd(), 'acceptance', 'block-202'), { recursive: true });

    // ── REST：网络代理 ─────────────────────────────────────────
    const net0 = await rest('GET', '/network');
    assert('R1_network_defaults', net0.ok && net0.data?.network?.configured?.httpProxy === '', JSON.stringify(net0.data?.network?.configured));
    assert('R2_loopback_exemption_present',
      String(net0.data?.network?.noProxyEffective || '').includes('127.0.0.1')
      && String(net0.data?.network?.noProxyEffective || '').includes('localhost'),
      net0.data?.network?.noProxyEffective);

    const putNet = await rest('PUT', '/network', { httpProxy: 'http://127.0.0.1:7890', noProxy: '.corp.example' });
    assert('R3_network_save_marks_restart_required',
      putNet.ok && putNet.data?.restartRequired === true && putNet.data?.network?.configured?.httpProxy === 'http://127.0.0.1:7890',
      JSON.stringify({ restart: putNet.data?.restartRequired, conf: putNet.data?.network?.configured }));

    const badNet = await rest('PUT', '/network', { httpProxy: 'socks5://x' });
    assert('R4_network_invalid_400', badNet.status === 400 && (badNet.data?.diagnostics || []).length > 0, `status=${badNet.status}`);

    const badUnknown = await rest('PUT', '/network', { nope: 'x' });
    assert('R5_network_unknown_key_400', badUnknown.status === 400, `status=${badUnknown.status}`);

    // ── REST：运行时策略 ───────────────────────────────────────
    const rt0 = await rest('GET', '/runtime-policy');
    assert('R6_runtime_defaults',
      rt0.ok && rt0.data?.runtime?.effective?.approvalDefaultMode === 'full'
      && rt0.data.runtime.effective.spawnConcurrency === 3 && rt0.data.runtime.effective.spawnMaxDepth === 1,
      JSON.stringify(rt0.data?.runtime?.effective));

    const putRt = await rest('PUT', '/runtime-policy', { approvalDefaultMode: 'read', spawnConcurrency: 4, toolDeny: 'workspace_exec' });
    assert('R7_runtime_save_applied',
      putRt.ok && putRt.data?.runtime?.effective?.approvalDefaultMode === 'read'
      && putRt.data.runtime.effective.spawnConcurrency === 4
      && putRt.data.runtime.configured.toolDeny === 'workspace_exec',
      JSON.stringify(putRt.data?.runtime));

    const badRt = await rest('PUT', '/runtime-policy', { approvalDefaultMode: 'yolo' });
    assert('R8_runtime_invalid_mode_400', badRt.status === 400 && (badRt.data?.diagnostics || []).length > 0, `status=${badRt.status}`);

    const badRt2 = await rest('PUT', '/runtime-policy', { spawnConcurrency: 99 });
    assert('R9_runtime_out_of_range_400', badRt2.status === 400, `status=${badRt2.status}`);

    // ── DOM：9223 离屏实例 ────────────────────────────────────
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const shots = [];
    try {
      const okCompute = await navigate(client, `${APP}/settings?section=compute`, {
        urlIncludes: ['section=compute'],
        selector: '[data-testid="network-proxy-panel"]',
      });
      assert('D1_network_panel_in_compute', okCompute, 'compute 节应有代理面板');

      const netDom = await lib.evalJs(client, `(function(){
        const p = document.querySelector('[data-testid="network-proxy-panel"]');
        if (!p) return { missing: true };
        return {
          fields: ['network-http-proxy','network-https-proxy','network-no-proxy','network-ca-file'].filter((id) => document.querySelector('[data-testid="' + id + '"]')).length,
          text: p.innerText.slice(0, 160),
        };
      })()`);
      assert('D2_network_fields_present', netDom && netDom.fields === 4, JSON.stringify(netDom));
      shots.push(await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'block-202'), 'ui519-network-proxy.png'));

      const okDecisions = await navigate(client, `${APP}/settings?section=decisions`, {
        urlIncludes: ['section=decisions'],
        selector: '[data-testid="runtime-policy-panel"]',
      });
      assert('D3_runtime_panel_in_decisions', okDecisions, 'decisions 节应有审批与编排面板');

      const rtDom = await lib.evalJs(client, `(function(){
        const sel = document.querySelector('[data-testid="runtime-approval-mode"]');
        const concurrency = document.querySelector('[data-testid="runtime-spawn-concurrency"]');
        const depth = document.querySelector('[data-testid="runtime-spawn-max-depth"]');
        const deny = document.querySelector('[data-testid="runtime-tool-deny"]');
        return {
          options: sel ? sel.options.length : 0,
          value: sel ? sel.value : '',
          concurrency: concurrency ? concurrency.value : '',
          depth: depth ? depth.value : '',
          deny: deny ? deny.value : '',
          effective: (document.querySelector('[data-testid="runtime-effective"]')||{}).textContent || '',
        };
      })()`);
      assert('D4_runtime_panel_values',
        rtDom && rtDom.options === 4 && rtDom.value === 'read' && rtDom.concurrency === '4'
        && rtDom.depth === '1' && rtDom.deny === 'workspace_exec' && rtDom.effective.includes('read'),
        JSON.stringify(rtDom));
      shots.push(await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'block-202'), 'ui520-runtime-policy.png'));

      // ── 复位（探针不把测试值留在真实配置里）──────────────────
      const reset = await rest('POST', '/config/reset', { families: ['network', 'runtime'] });
      assert('R10_reset_restores_defaults', reset.ok, JSON.stringify(reset.data));
      const netAfter = await rest('GET', '/network');
      const rtAfter = await rest('GET', '/runtime-policy');
      assert('R11_reset_verified',
        netAfter.data?.network?.configured?.httpProxy === '' && rtAfter.data?.runtime?.effective?.approvalDefaultMode === 'full',
        JSON.stringify({ net: netAfter.data?.network?.configured, rt: rtAfter.data?.runtime?.effective }));
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }

    return {
      evidence: {
        screenshots: shots.map((f) => path.basename(f)),
        api: { network: '/api/network', runtimePolicy: '/api/runtime-policy' },
      },
    };
  },
};
