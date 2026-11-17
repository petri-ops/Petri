#!/usr/bin/env node
'use strict';

/** dev-verify flow：ui538-add1 — composer 模型按钮显示当前模型名（9223 离屏）。 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP = 'http://localhost:3000';

module.exports = {
  id: 'ui538-add1',
  description: 'UI-538 加映一：模型按钮显示当前模型短名（9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'ui-538-add1'),

  async run({ assert }) {
    const target = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const client = target.client || target;
    try {
      await lib.evalJs(client, `location.href = ${JSON.stringify(APP + '/')}; 'ok'`);
      let chip = null;
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        chip = JSON.parse(String(await lib.evalJs(client, `(function(){
          const el = document.querySelector('[data-testid="model-chip-model"]');
          if (!el) return 'null';
          const label = el.querySelector('[data-testid="model-chip-label"]');
          const r = el.getBoundingClientRect();
          return JSON.stringify({
            label: label ? (label.textContent || '').trim() : '',
            title: el.getAttribute('title') || '',
            width: r.width,
            auto: el.getAttribute('data-auto'),
          });
        })()`) || 'null'));
        if (chip && chip.label) break;
      }
      assert('N1_chip_label_visible', !!chip && chip.label.length > 0, JSON.stringify(chip));
      assert('N2_chip_wider_than_icon', !!chip && chip.width > 80, JSON.stringify(chip));
      assert('N3_title_keeps_full_info', !!chip && chip.title.length >= chip.label.length, JSON.stringify(chip));

      await lib.evalJs(client, `(function(){document.querySelector('[data-testid="model-chip-model"]').click(); return 'ok';})()`);
      await new Promise((r) => setTimeout(r, 300));
      const menuOpen = await lib.evalJs(client, `!!document.querySelector('[data-testid="model-menu"]')`);
      assert('N4_click_still_opens_menu', !!menuOpen, 'model-menu');
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }
    return true;
  },
};
