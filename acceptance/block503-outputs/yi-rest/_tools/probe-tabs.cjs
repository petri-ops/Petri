#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  await c.navigate('http://localhost:3000/extensions');
  await sleep(1500);
  const info = await c.evalJson(`(() => {
    const tabs = [...document.querySelectorAll('[role="tab"],[aria-selected]')].slice(0, 10).map(el => ({
      tag: el.tagName, sel: el.getAttribute('aria-selected'), role: el.getAttribute('role'),
      cls: String(el.className).slice(0, 70), text: (el.innerText || '').slice(0, 14),
    }));
    return { url: location.href, tabs, tabCount: tabs.length };
  })()`);
  console.log(JSON.stringify(info, null, 1));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
