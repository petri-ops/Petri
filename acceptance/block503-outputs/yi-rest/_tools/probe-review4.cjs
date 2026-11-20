#!/usr/bin/env node
'use strict';
const { connect, sleep, outPath } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  await c.shot(outPath('yi8-e01e02', 'review-surface-probe.png'));
  const st = await c.evalJson(`(function(){
    const tabs = [...document.querySelectorAll('[class*="rightPanelTabContent"]')].map(el => ({
      visible: !!el.offsetParent, cls: String(el.className).slice(0, 90),
      text: (el.innerText || '').slice(0, 200).replace(/\\n/g, '|'),
    }));
    const pills = [...document.querySelectorAll('[class*="tabPill"]')].filter(el => el.offsetParent).map(el => (el.innerText || '').trim());
    return { tabs: tabs.slice(0, 6), pills };
  })()`);
  console.log(JSON.stringify(st, null, 1));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
