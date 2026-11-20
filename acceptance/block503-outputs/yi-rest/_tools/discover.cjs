#!/usr/bin/env node
'use strict';
const { connect } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  console.log('url:', c.page.url);
  const expr = `(() => {
    const q = (sel) => document.querySelectorAll(sel).length;
    const btns = [...document.querySelectorAll('button')]
      .filter(b => b.offsetParent && !b.closest('[class*="itleBar"],[class*="indowControl"],[class*="itlebar"]'))
      .slice(0, 16)
      .map(b => ({ cls: String(b.className).slice(0, 60), label: (b.getAttribute('aria-label') || b.innerText || '').replace(/\\n/g, ' ').slice(0, 20), disabled: b.disabled, pressed: b.getAttribute('aria-pressed') }));
    const listish = {};
    for (const el of document.querySelectorAll('[class*="Item"],[class*="item"],[class*="Row"],[class*="row"],[class*="Card"],[class*="card"]')) {
      if (!el.offsetParent) continue;
      const k = String(el.className).slice(0, 44);
      listish[k] = (listish[k] || 0) + 1;
    }
    return {
      sendBtn: q('.sc-send-cta-send'),
      sendDisabled: (document.querySelector('.sc-send-cta-send') || {}).disabled,
      textareas: q('textarea'),
      leftQuickActions: q('[class*="leftQuickAction"]'),
      ariaPressedEls: q('[aria-pressed]'),
      ariaCurrentEls: q('[aria-current]'),
      dataStateEls: q('[data-state]'),
      roleTabs: q('[role="tab"]'),
      buttons: btns,
      listTop: Object.entries(listish).sort((a, b) => b[1] - a[1]).slice(0, 14),
    };
  })()`;
  console.log(JSON.stringify(await c.evalJson(expr), null, 1));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
