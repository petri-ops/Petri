#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui708-advanced-simplify — 高级设置减负第一刀实机腿
 *
 * 只连 9223 测试实例；禁 PETRI_TEST_ONSCREEN。断言四件事：
 *  ① 联网页不再重复渲染检索后端选择器，代理块默认折叠；
 *  ② 快捷键默认只列已改键，展开全部/搜索仍可达；
 *  ③ 数据目录/回收站归位维护，compute 只剩执行目标；
 *  ④ 审批记录+记忆治理收进默认折叠的治理审计区。
 * 前置：dev 栈(:3000/:3001) + `bash scripts/start-test-instance.sh` 已就绪。
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
  id: 'ui708-advanced-simplify',
  description: 'UI-708 高级设置减负第一刀：去重/归位/折叠四腿（9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'ui-708'),

  async run({ assert }) {
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      // ① 联网与代理
      const okNet = await navigate(client, `${APP}/settings?section=network`, '[data-testid="web-access-panel"]');
      assert('L1_network_section_reachable', okNet, 'nav /settings?section=network');
      const netDom = await lib.evalJs(client, `(function(){
        const fold = document.querySelector('[data-testid="network-proxy-fold"]');
        const web = document.querySelector('[data-testid="web-access-panel"]');
        return JSON.stringify({
          proxyFoldClosed: !!fold && fold.open === false,
          proxyInsideFold: !!fold && !!fold.querySelector('[data-testid="network-proxy-panel"]'),
          providerSelectAbsent: !document.querySelector('[data-testid="web-access-provider"]'),
          providerPointer: !!document.querySelector('[data-testid="web-access-provider-pointer"]'),
          boundaryFoldClosed: !!document.querySelector('[data-testid="web-access-advanced-boundary"]')
            && !document.querySelector('[data-testid="web-access-advanced-boundary"]').open,
          webPresent: !!web,
        });
      })()`);
      const net = JSON.parse(String(netDom || '{}'));
      assert('L2_network_dedup_and_folds',
        net.proxyFoldClosed && net.proxyInsideFold && net.providerSelectAbsent
          && net.providerPointer && net.boundaryFoldClosed && net.webPresent,
        JSON.stringify(net));

      // ② 快捷键默认只列已改键
      const okKeymap = await navigate(client, `${APP}/settings?section=keymap`, '[data-testid="keymap-panel"]');
      assert('L3_keymap_section_reachable', okKeymap, 'nav /settings?section=keymap');
      const km0 = JSON.parse(String(await lib.evalJs(client, `(function(){
        const p = document.querySelector('[data-testid="keymap-panel"]');
        return JSON.stringify({
          rows: p ? p.querySelectorAll('[data-testid^="keymap-row-"]').length : -1,
          hasShowAll: !!(p && p.querySelector('[data-testid="keymap-show-all"]')),
          hasFilter: !!(p && p.querySelector('[data-testid="keymap-filter"]')),
        });
      })()`) || '{}'));
      assert('L4_keymap_default_only_changed', km0.rows === 0 && km0.hasShowAll && km0.hasFilter, JSON.stringify(km0));
      await lib.evalJs(client, `(function(){document.querySelector('[data-testid="keymap-show-all"]').click(); return 'ok';})()`);
      await new Promise((r) => setTimeout(r, 200));
      const km1 = Number(await lib.evalJs(client, `document.querySelectorAll('[data-testid^="keymap-row-"]').length`));
      assert('L5_keymap_show_all_restores_10_rows', km1 === 10, `rows=${km1}`);

      // ③ 数据与维护归位
      const okMaint = await navigate(client, `${APP}/settings?section=maintenance`, '.petri-trash-section');
      assert('L6_data_panels_in_maintenance', okMaint, 'maintenance 应有数据目录/回收站');
      const okCompute = await navigate(client, `${APP}/settings?section=compute`, '[data-testid="remote-targets-panel"]');
      assert('L7_compute_keeps_remote_targets', okCompute, 'compute 应保留执行目标');
      const calcDom = JSON.parse(String(await lib.evalJs(client, `(function(){
        return JSON.stringify({
          remote: !!document.querySelector('[data-testid="remote-targets-panel"]'),
          harness: !!document.querySelector('[data-testid="harness-caps-refresh"]'),
          trash: !!document.querySelector('.petri-trash-section'),
        });
      })()`) || '{}'));
      assert('L8_compute_no_data_panels', calcDom.remote && !calcDom.harness && !calcDom.trash, JSON.stringify(calcDom));

      // ④ 治理审计折叠
      const okDec = await navigate(client, `${APP}/settings?section=decisions`, '[data-testid="governance-audit-fold"]');
      assert('L9_decisions_reachable_with_audit_fold', okDec, 'decisions 应有治理审计折叠块');
      const auditOpen = await lib.evalJs(client, `(function(){
        const d = document.querySelector('[data-testid="governance-audit-fold"]');
        return d ? d.open : null;
      })()`);
      assert('L10_governance_audit_closed_by_default', auditOpen === false, `open=${auditOpen}`);
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }
    return true;
  },
};
