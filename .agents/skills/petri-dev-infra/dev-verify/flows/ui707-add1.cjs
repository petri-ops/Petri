#!/usr/bin/env node
'use strict';

/** dev-verify flow：ui707-add1 — 模型行右侧独立配置小页（9223 离屏）。 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP = 'http://localhost:3000';

module.exports = {
  id: 'ui707-add1',
  description: 'UI-707 加映一：模型行右侧 portal 配置小页（上下文/思考，9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'ui-707-add1'),

  async run({ assert }) {
    const target = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const client = target.client || target;
    try {
      await lib.evalJs(client, `location.href = ${JSON.stringify(APP + '/')}; 'ok'`);
      let ready = false;
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        ready = await lib.evalJs(client, `!!document.querySelector('[data-testid="model-chip-model"]')`);
        if (ready) break;
      }
      assert('F1_composer_ready', ready, 'model-chip-model');
      if (!ready) return false;

      await lib.evalJs(client, `(function(){document.querySelector('[data-testid="model-chip-model"]').click(); return 'ok';})()`);
      let rowRect = null;
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 300));
        rowRect = JSON.parse(String(await lib.evalJs(client, `(function(){
          const rows = [...document.querySelectorAll('[data-testid^="model-row-"]')];
          const row = rows.find((r) => /glm-(?:4\\.[5-9]|5(?:\\.\\d+)?)/i.test(
            r.querySelector('.sc-model-option-title')?.textContent || ''
          )) || rows[0];
          if (!row) return 'null';
          row.setAttribute('data-live-probe', '1');
          const r = row.getBoundingClientRect();
          return JSON.stringify({
            x: r.x, y: r.y, width: r.width, height: r.height, right: r.right,
            model: row.querySelector('.sc-model-option-title')?.textContent || '',
          });
        })()`) || 'null'));
        if (rowRect) break;
      }
      assert('F2_model_rows_visible', !!rowRect, JSON.stringify(rowRect));
      if (!rowRect) return false;
      assert('F2a_glm_probe_selected', /glm-(?:4\.[5-9]|5(?:\.\d+)?)/i.test(rowRect.model || ''), JSON.stringify(rowRect));

      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: rowRect.x + Math.min(40, rowRect.width / 2),
        y: rowRect.y + rowRect.height / 2,
        button: 'none',
        buttons: 0,
      });

      let flyout = null;
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => setTimeout(r, 200));
        flyout = JSON.parse(String(await lib.evalJs(client, `(function(){
          const el = document.querySelector('[data-testid^="model-config-flyout-"]');
          if (!el) return 'null';
          const r = el.getBoundingClientRect();
          const think = el.querySelector('[data-testid^="model-row-thinking-"]');
          return JSON.stringify({
            placement: el.getAttribute('data-placement'),
            left: r.left,
            top: r.top,
            width: r.width,
            context: !!el.querySelector('[data-testid^="model-row-context-"]'),
            thinking: !!think,
            thinkingDisabled: think ? think.hasAttribute('disabled') : null,
            missingReason: (el.innerText || '').includes('未声明思考能力'),
          });
        })()`) || 'null'));
        if (flyout) break;
      }
      assert('F3_config_flyout_opened', !!flyout && flyout.context && flyout.thinking, JSON.stringify(flyout));
      assert('F4_flyout_anchored_right', !!flyout && (flyout.placement === 'right' || flyout.placement === 'left') && flyout.width > 200, JSON.stringify(flyout));
      assert('F5_glm_thinking_enabled', !!flyout && flyout.thinkingDisabled === false, JSON.stringify(flyout));
      assert('F6_no_missing_reason_warning', !!flyout && flyout.missingReason === false, JSON.stringify(flyout));
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }
    return true;
  },
};
