#!/usr/bin/env node
'use strict';

/** dev-verify flow：block458-capability-probe — 设置页一键探测思考能力（9223 离屏）。 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP = 'http://localhost:3000/settings?section=models';

module.exports = {
  id: 'block458-capability-probe',
  description: 'BLOCK-458：设置 → 模型接口一键探测思考能力（真实小请求，9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-458'),

  async run({ assert }) {
    const target = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const client = target.client || target;
    try {
      await lib.evalJs(client, `location.href = ${JSON.stringify(APP)}; 'ok'`);
      let expanded = false;
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        expanded = await lib.evalJs(client, `(function(){
          const buttons = [...document.querySelectorAll('button[aria-label*="能力与选择器详情"]')];
          const btn = buttons.find((b) => /bigmodel|coding|glm/i.test((b.getAttribute('aria-label') || '')))
            || buttons[buttons.length - 1];
          if (!btn) return false;
          btn.click();
          return true;
        })()`);
        if (expanded) break;
      }
      assert('B1_endpoint_expand_clicked', !!expanded, 'endpoint detail expand');
      if (!expanded) return false;

      let probeReady = false;
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => setTimeout(r, 200));
        probeReady = await lib.evalJs(client, `!!document.querySelector('[data-testid="capability-probe-default"]')`);
        if (probeReady) break;
      }
      assert('B2_probe_button_ready', !!probeReady, 'capability-probe-default');
      if (!probeReady) return false;

      await lib.evalJs(client, `(function(){document.querySelector('[data-testid="capability-probe-default"]').click(); return 'ok';})()`);
      let status = '';
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        status = String(await lib.evalJs(client, `(function(){
          const rows = [...document.querySelectorAll('[role="status"]')];
          return rows.map((r) => (r.textContent || '').trim()).find((t) => t.includes('探测')) || '';
        })()`) || '');
        if (status && !status.includes('正在探测')) break;
      }
      assert('B3_probe_finished', !!status && !status.includes('正在探测'), status || 'no probe status');
      assert('B4_probe_has_evidence_or_honest_unknown', /探测到思考证据|未找到明确思考证据|明确拒绝思考参数/.test(status), status);
      assert('B5_probe_success_with_current_key', status.includes('探测到思考证据'), status);
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }
    return true;
  },
};
