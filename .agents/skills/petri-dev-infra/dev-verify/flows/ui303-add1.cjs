#!/usr/bin/env node
'use strict';

/** dev-verify flow：ui303-add1 — 访问模式菜单只保留完全访问 + 计划模式。 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP = 'http://localhost:3000';

module.exports = {
  id: 'ui303-add1',
  description: 'UI-303 加映一：访问模式菜单收敛为两档（9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'ui-303-add1'),

  async run({ assert }) {
    const target = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const client = target.client || target;
    try {
      await lib.evalJs(client, `location.href = ${JSON.stringify(APP + '/')}; 'ok'`);
      let ready = false;
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        ready = await lib.evalJs(client, `!!document.querySelector('[data-testid="access-mode-trigger"]')`);
        if (ready) break;
      }
      assert('A1_composer_ready', ready, 'access-mode-trigger');
      if (!ready) return false;
      await lib.evalJs(client, `(function(){document.querySelector('[data-testid="access-mode-trigger"]').click(); return 'ok';})()`);
      await new Promise((r) => setTimeout(r, 200));
      const menu = JSON.parse(String(await lib.evalJs(client, `(function(){
        const el = document.querySelector('.sc-access-menu');
        return JSON.stringify({
          text: el ? el.innerText : '',
          full: !!document.querySelector('[data-testid="access-option-full"]'),
          plan: !!document.querySelector('[data-testid="access-option-plan"]'),
          buttons: el ? el.querySelectorAll('button').length : -1,
        });
      })()`) || '{}'));
      assert('A2_two_modes_present', menu.full && menu.plan && menu.buttons === 2, JSON.stringify(menu));
      assert('A3_legacy_modes_absent', String(menu.text).indexOf('项目写') === -1 && String(menu.text).indexOf('只读模式') === -1, JSON.stringify(menu));
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }
    return true;
  },
};
