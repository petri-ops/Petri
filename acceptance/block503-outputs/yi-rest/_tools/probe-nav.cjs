#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  await c.navigate('http://localhost:3000/extensions');
  await sleep(2000);
  const info = await c.evalJson(`(() => ({
    url: location.href,
    quickActions: [...document.querySelectorAll('[class*="leftQuickAction"]')].slice(0, 8).map(el => ({
      cls: String(el.className).slice(0, 80),
      text: (el.innerText || '').slice(0, 12),
    })),
  }))()`);
  console.log(JSON.stringify(info, null, 1));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
