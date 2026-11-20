#!/usr/bin/env node
'use strict';
const { connect, sleep, outPath } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  const btns = await c.evalJson(`(function(){
    return [...document.querySelectorAll('[class*="projectTreeAddBtn"]')].map((el, i) => ({
      i, label: el.getAttribute('aria-label'), pressed: el.getAttribute('aria-pressed'),
      rect: (r => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }))(el.getBoundingClientRect()),
    }));
  })()`);
  console.log('add buttons:', JSON.stringify(btns));
  // 逐个试：点开 → 截图+读面板标题 → Escape 关
  for (const b of btns) {
    await c.clickEl('[class*="projectTreeAddBtn"]', { index: b.i });
    await sleep(900);
    const st = await c.evalJson(`(function(){
      const dlg = [...document.querySelectorAll('[role="dialog"],[class*="dialog"],[class*="Dialog"],[class*="Modal"],[class*="modal"]')].filter(el => el.offsetParent)[0];
      const inputs = [...document.querySelectorAll('input')].filter(el => el.offsetParent).map(el => el.placeholder || el.type).slice(0, 6);
      const text = dlg ? (dlg.innerText || '').slice(0, 120).replace(/\\n/g, '|') : (inputs.length ? '(inputs only)' : '');
      return { hasDialog: !!dlg, inputs, text };
    })()`);
    console.log('btn', b.i, JSON.stringify(st));
    await c.shot(outPath('p1-review-real', `probe-add-btn-${b.i}.png`));
    await c.evaluate(`(function(){ const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '取消' && x.offsetParent); if (b) b.click(); document.activeElement && document.activeElement.blur(); })()`);
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);
  }
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
