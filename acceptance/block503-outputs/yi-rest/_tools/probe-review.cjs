#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  const btns = await c.evalJson(`(function(){
    return [...document.querySelectorAll('button')].filter(b => b.offsetParent && (b.getAttribute('aria-label') || '').length > 1).slice(0, 24).map(b => ({ label: b.getAttribute('aria-label'), cls: String(b.className).slice(0, 40) }));
  })()`);
  console.log(JSON.stringify(btns, null, 1));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
