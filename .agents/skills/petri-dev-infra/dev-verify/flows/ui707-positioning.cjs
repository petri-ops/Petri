#!/usr/bin/env node
'use strict';

/** dev-verify flow：ui707-positioning — 配置小页紧贴下方模型行且不越视口（9223 离屏）。 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP = 'http://localhost:3000';

module.exports = {
  id: 'ui707-positioning',
  description: 'UI-707 加映四：配置小页按实际行位置动态定位（9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'ui-707-positioning'),

  async run({ assert }) {
    const target = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const client = target.client || target;
    try {
      // 小视口才暴露固定 420px 估算导致的“上提到右上角”问题。
      await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 600, deviceScaleFactor: 1, mobile: false });
      await lib.evalJs(client, `location.href = ${JSON.stringify(APP + '/')}; 'ok'`);
      let ready = false;
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        ready = await lib.evalJs(client, `!!document.querySelector('[data-testid="model-chip-model"]')`);
        if (ready) break;
      }
      assert('P1_composer_ready', ready, 'model-chip-model');
      if (!ready) return false;

      await lib.evalJs(client, `(function(){document.querySelector('[data-testid="model-chip-model"]').click(); return 'ok';})()`);
      await lib.evalJs(client, `(function(){const p=document.querySelector('[data-testid="model-menu-models-panel"]'); if(p) p.scrollTop = p.scrollHeight; return 'ok';})()`);
      await new Promise((r) => setTimeout(r, 300));

      const probe = JSON.parse(String(await lib.evalJs(client, `(function(){
        const rows = [...document.querySelectorAll('[data-testid^="model-row-"]')];
        const vh = window.innerHeight;
        const visible = rows
          .map((row) => ({ row, r: row.getBoundingClientRect() }))
          .filter(({ r }) => r.top > 0 && r.bottom < vh - 8)
          .sort((a, b) => b.r.top - a.r.top);
        const hit = visible[0];
        if (!hit) return 'null';
        hit.row.setAttribute('data-position-probe', '1');
        return JSON.stringify({ x: hit.r.x, y: hit.r.y, width: hit.r.width, height: hit.r.height, right: hit.r.right, top: hit.r.top, vh });
      })()`) || 'null'));
      assert('P2_lower_row_visible', !!probe && probe.top > 300, JSON.stringify(probe));
      if (!probe) return false;

      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: probe.x + Math.min(40, probe.width / 2),
        y: probe.y + probe.height / 2,
        button: 'none',
        buttons: 0,
      });
      let result = null;
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => setTimeout(r, 200));
        result = JSON.parse(String(await lib.evalJs(client, `(function(){
          const el = document.querySelector('[data-testid^="model-config-flyout-"]');
          if (!el) return 'null';
          const r = el.getBoundingClientRect();
          return JSON.stringify({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, placement: el.getAttribute('data-placement'), vh: window.innerHeight });
        })()`) || 'null'));
        if (result) break;
      }
      assert('P3_flyout_opened', !!result, JSON.stringify(result));
      if (!result) return false;
      assert('P4_right_adjacent', result.placement === 'right' && result.left >= probe.right && result.left - probe.right < 40, JSON.stringify({ probe, result }));
      assert('P5_vertically_tight', Math.abs(result.top - probe.top) <= 80, JSON.stringify({ probe, result }));
      assert('P6_within_viewport', result.top >= 8 && result.bottom <= result.vh - 8, JSON.stringify(result));
    } finally {
      try { await client.send('Emulation.clearDeviceMetricsOverride'); } catch { /* 测试实例即将关闭 */ }
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }
    return true;
  },
};
