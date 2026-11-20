#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  const items = await c.evalJson(`(function(){
    return [...document.querySelectorAll('[class*="_leftQuickAction_"]')].filter(el => el.offsetParent).map((el, i) => ({ i, text: (el.innerText || '').trim(), cls: String(el.className).slice(0, 40) }));
  })()`);
  console.log('quick actions:', JSON.stringify(items));
  // 点「设置」
  const clicked = await c.evalJson(`(function(){
    const el = [...document.querySelectorAll('[class*="_leftQuickAction_"]')].filter(x => x.offsetParent).find(x => (x.innerText || '').trim() === '设置');
    if (!el) return 'not-found';
    el.click();
    return 'clicked';
  })()`);
  console.log('click:', clicked);
  await sleep(1800);
  const st = await c.evalJson('({ path: location.pathname, hasKbd: document.body.innerText.includes("快捷键"), sample: document.body.innerText.slice(0, 100).replace(/\\n/g, "|") })');
  console.log('after:', JSON.stringify(st));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
