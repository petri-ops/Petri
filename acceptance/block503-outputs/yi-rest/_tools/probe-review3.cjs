#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  const st = await c.evalJson(`(function(){
    const panel = [...document.querySelectorAll('[class*="rightPanelTabContent"]')].filter(el => el.offsetParent)[0];
    const text = panel ? (panel.innerText || '') : '(no active tab content)';
    return { text: text.slice(0, 400).replace(/\\n/g, '|') };
  })()`);
  console.log(JSON.stringify(st, null, 1));
  const rect = await c.evalJson(`(function(){ const el = [...document.querySelectorAll('[class*="rightPanel"]')].filter(el => el.offsetParent)[0] || document.querySelector('[class*="rightPanel"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  if (rect && rect.w > 50) await c.cropFull('acceptance/block503-outputs/yi-rest/yi8-e01e02/review-empty-state-probe.png', rect, 4);
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
