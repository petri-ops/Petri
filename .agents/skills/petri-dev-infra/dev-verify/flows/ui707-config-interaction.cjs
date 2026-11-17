#!/usr/bin/env node
'use strict';

/** dev-verify flow：ui707-config-interaction — 配置小页可从模型行移动到并可点击（9223 离屏）。 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP = 'http://localhost:3000';

module.exports = {
  id: 'ui707-config-interaction',
  description: 'UI-707 加映三：模型配置小页悬停桥接与可交互（9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'ui-707-interaction'),

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
      assert('C1_composer_ready', ready, 'model-chip-model');
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
          row.setAttribute('data-interaction-probe', '1');
          const r = row.getBoundingClientRect();
          return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
        })()`) || 'null'));
        if (rowRect) break;
      }
      assert('C2_model_rows_visible', !!rowRect, JSON.stringify(rowRect));
      if (!rowRect) return false;

      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: rowRect.x + Math.min(40, rowRect.width / 2),
        y: rowRect.y + rowRect.height / 2,
        button: 'none',
        buttons: 0,
      });
      let flyoutRect = null;
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => setTimeout(r, 200));
        flyoutRect = JSON.parse(String(await lib.evalJs(client, `(function(){
          const el = document.querySelector('[data-testid^="model-config-flyout-"]');
          if (!el) return 'null';
          const r = el.getBoundingClientRect();
          return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
        })()`) || 'null'));
        if (flyoutRect) break;
      }
      assert('C3_flyout_opened', !!flyoutRect, JSON.stringify(flyoutRect));
      if (!flyoutRect) return false;

      // 关键回归腿：鼠标从行移动到小页内部，停 400ms 后小页必须仍在。
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: flyoutRect.x + Math.min(120, flyoutRect.width / 2),
        y: flyoutRect.y + Math.min(60, flyoutRect.height / 2),
        button: 'none',
        buttons: 0,
      });
      await new Promise((r) => setTimeout(r, 400));
      const stillOpen = await lib.evalJs(client, `!!document.querySelector('[data-testid^="model-config-flyout-"]')`);
      assert('C4_flyout_survives_mouse_transfer', !!stillOpen, 'flyout still open after moving pointer into panel');
      if (!stillOpen) return false;

      const clicked = await lib.evalJs(client, `(function(){
        const el = document.querySelector('[data-testid^="model-config-flyout-"]');
        if (!el) return false;
        const tick = el.querySelector('button[aria-label="思考强度：高"]');
        if (!tick) return false;
        tick.click();
        return true;
      })()`);
      assert('C5_thinking_tick_clickable', !!clicked, 'high thinking tick clicked');
      await new Promise((r) => setTimeout(r, 300));
      const afterClick = await lib.evalJs(client, `(function(){
        const el = document.querySelector('[data-testid^="model-config-flyout-"]');
        const slider = el && el.querySelector('[data-testid^="model-row-thinking-"]');
        return JSON.stringify({ open: !!el, level: slider ? slider.getAttribute('data-level') : null });
      })()`);
      assert('C6_setting_applied', String(afterClick).indexOf('"level":"high"') >= 0, String(afterClick));
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }
    return true;
  },
};
