#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui704-diagnostics — UI-704 加映五（诊断归位维护）
 * 只连 9223 离屏测试实例；禁 PETRI_TEST_ONSCREEN。
 * 断言：诊断不再占高级导航；维护页默认折叠；旧深链归一并自动展开；搜索仍可达。
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
  id: 'ui704-diagnostics',
  description: 'UI-704 加映五：诊断归位维护 + 深链归一 + 搜索可达（9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'ui-704-diagnostics'),

  async run({ assert }) {
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      const okMaint = await navigate(client, `${APP}/settings?section=maintenance`, '[data-testid="diagnostics-fold"]');
      assert('D1_maintenance_reachable_with_diagnostics', okMaint, 'nav /settings?section=maintenance');
      const folded = JSON.parse(String(await lib.evalJs(client, `(function(){
        const fold = document.querySelector('[data-testid="diagnostics-fold"]');
        return JSON.stringify({
          closed: !!fold && fold.open === false,
          hasServiceText: !!fold && fold.innerText.indexOf('本地服务') !== -1,
        });
      })()`) || '{}'));
      assert('D2_diagnostics_folded_by_default', folded.closed && folded.hasServiceText, JSON.stringify(folded));

      const okDeep = await navigate(client, `${APP}/settings?section=diagnostics`, '[data-testid="diagnostics-fold"]');
      assert('D3_old_deeplink_reachable', okDeep, 'nav /settings?section=diagnostics');
      const deep = JSON.parse(String(await lib.evalJs(client, `(function(){
        const active = document.querySelector('.petri-settings-nav__item.active');
        const fold = document.querySelector('[data-testid="diagnostics-fold"]');
        return JSON.stringify({
          activeLabel: active ? active.innerText : '',
          foldOpen: !!fold && fold.open === true,
          hasServiceText: !!fold && fold.innerText.indexOf('本地服务') !== -1,
        });
      })()`) || '{}'));
      assert('D4_deeplink_normalizes_to_maintenance_and_opens_fold',
        deep.activeLabel.indexOf('数据与维护') !== -1 && deep.foldOpen && deep.hasServiceText,
        JSON.stringify(deep));

      await lib.evalJs(client, `(function(){
        const toggle = Array.from(document.querySelectorAll('button')).find((b) => /高级/.test(b.textContent || ''));
        if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
        return 'ok';
      })()`);
      await new Promise((r) => setTimeout(r, 200));
      const navText = await lib.evalJs(client, `document.body.innerText`);
      assert('D5_diagnostics_absent_from_advanced_nav', String(navText).indexOf('服务、运行时与日志') === -1, 'nav text');

      const searchInput = '[data-testid="settings-search-input"]';
      await lib.evalJs(client, `(function(){
        const input = document.querySelector(${JSON.stringify(searchInput)});
        if (!input) return 'missing';
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '日志');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      })()`);
      await new Promise((r) => setTimeout(r, 300));
      const searchDom = JSON.parse(String(await lib.evalJs(client, `(function(){
        const active = Array.from(document.querySelectorAll('.petri-settings-nav__item'))
          .map((n) => n.innerText).join(' | ');
        return JSON.stringify({ active });
      })()`) || '{}'));
      assert('D6_search_keyword_reaches_maintenance', searchDom.active.indexOf('数据与维护') !== -1, JSON.stringify(searchDom));
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }
    return true;
  },
};
