#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui708-wave2 — UI-704 加映四（零行为变更的呈现合并）
 * 只连 9223 离屏测试实例；禁 PETRI_TEST_ONSCREEN。断言四处呈现合并，不改任何配置。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP = 'http://localhost:3000';

async function navigate(client, url, selector) {
  await lib.evalJs(client, `location.href = ${JSON.stringify(url)}; 'ok'`);
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const ready = await lib.evalJs(client, `(function(){
      if (String(location.href).indexOf(${JSON.stringify(new URL(url).search)}) === -1) return false;
      return !!document.querySelector(${JSON.stringify(selector)});
    })()`);
    if (ready) return true;
  }
  return false;
}

module.exports = {
  id: 'ui708-wave2',
  description: 'UI-704 加映四：工具合卡 / 决策供给折叠 / 代理合卡 / 审计页签（9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'ui-708-wave2'),

  async run({ assert }) {
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      const okDec = await navigate(client, `${APP}/settings?section=decisions`, '[data-testid="runtime-policy-panel"]');
      assert('W1_decisions_reachable', okDec, 'nav /settings?section=decisions');
      const dec = JSON.parse(String(await lib.evalJs(client, `(function(){
        const scope = document.querySelector('[data-testid="runtime-tool-scope-group"]');
        const fold = document.querySelector('[data-testid="decision-supply-fold"]');
        return JSON.stringify({
          scope: !!scope && !!scope.querySelector('[data-testid="runtime-tool-allow"]')
            && !!scope.querySelector('[data-testid="runtime-tool-deny"]'),
          supplyClosed: !!fold && fold.open === false,
          supplyFields: !!fold && !!fold.querySelector('[data-testid="decision-provider-url"]')
            && !!fold.querySelector('[data-testid="decision-provider-key"]')
            && !!fold.querySelector('[data-testid="decision-provider-model"]'),
          auditTabs: !!document.querySelector('[data-testid="audit-tab-ack"]')
            && !!document.querySelector('[data-testid="audit-tab-memory"]'),
          ackShown: !!document.querySelector('[data-testid="audit-panel-ack"]'),
          memoryHidden: !document.querySelector('[data-testid="audit-panel-memory"]'),
        });
      })()`) || '{}'));
      assert('W2_tool_scope_and_supply_fold', dec.scope && dec.supplyClosed && dec.supplyFields, JSON.stringify(dec));
      assert('W3_audit_tabs_default_ack', dec.auditTabs && dec.ackShown && dec.memoryHidden, JSON.stringify(dec));
      await lib.evalJs(client, `(function(){const b=document.querySelector('[data-testid="audit-tab-memory"]'); if(b) b.click(); return 'ok';})()`);
      await new Promise((r) => setTimeout(r, 200));
      const switched = await lib.evalJs(client, `JSON.stringify({
        memory: !!document.querySelector('[data-testid="audit-panel-memory"]'),
        ack: !!document.querySelector('[data-testid="audit-panel-ack"]')
      })`);
      const sw = JSON.parse(String(switched || '{}'));
      assert('W4_audit_tab_switch', sw.memory && !sw.ack, JSON.stringify(sw));

      const okNet = await navigate(client, `${APP}/settings?section=network`, '[data-testid="network-proxy-panel"]');
      assert('W5_network_reachable', okNet, 'nav /settings?section=network');
      const net = JSON.parse(String(await lib.evalJs(client, `(function(){
        const g = document.querySelector('[data-testid="network-proxy-address-group"]');
        return JSON.stringify({
          group: !!g,
          http: !!g && !!g.querySelector('[data-testid="network-http-proxy"]'),
          https: !!g && !!g.querySelector('[data-testid="network-https-proxy"]'),
        });
      })()`) || '{}'));
      assert('W6_proxy_address_group', net.group && net.http && net.https, JSON.stringify(net));
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }
    return true;
  },
};
