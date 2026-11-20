#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect({ port: 9223 });
  await c.evaluate('window.petri.window.zoomReset()');
  await sleep(500);
  const base = await c.evalJson(`({ iw: innerWidth, ih: innerHeight, hasLeft: !!document.querySelector('[class*="leftPanel"]'), body: document.body.innerText.slice(0, 80).replace(/\\n/g, '|') })`);
  console.log('base:', JSON.stringify(base));
  const target = 769;
  const level = Math.log(base.iw / target) / Math.log(1.2);
  await c.evaluate(`window.petri.window.zoomBy(${level.toFixed(4)})`);
  await sleep(700);
  const st = await c.evalJson(`({ iw: innerWidth, mm768: matchMedia('(max-width: 768px)').matches, hasLeft: !!document.querySelector('[class*="leftPanel"]'), dpr: devicePixelRatio })`);
  console.log('level', level.toFixed(4), '→', JSON.stringify(st));
  await c.evaluate('window.petri.window.zoomReset()');
  await sleep(400);
  console.log('reset:', await c.evalJson('innerWidth'));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
