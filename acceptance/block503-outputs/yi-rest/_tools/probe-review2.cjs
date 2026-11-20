#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  // 确保在项目页
  await c.navigate('http://localhost:3000/project/p_mwnkhuj2_okzh');
  await sleep(1600);
  // 开审阅 tab：更多工具 → 审阅
  await c.evaluate(`(function(){ const m = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '展开更多工具'); if (m) m.click(); return !!m; })()`);
  await sleep(700);
  const clicked = await c.evalJson(`(function(){
    const items = [...document.querySelectorAll('button,[role="menuitem"],li,div')].filter(el => /^审阅$/.test((el.innerText || '').trim()) && (el.innerText || '').length <= 6 && el.offsetParent);
    if (items.length) { items[0].click(); return 'clicked'; }
    return 'no-item';
  })()`);
  await sleep(2200);
  const st = await c.evalJson(`(function(){
    const body = document.body.innerText;
    const cm = document.querySelector('.cm-editor, [class*="odeMirror"]');
    const files = [...document.querySelectorAll('[class*="fileRow"],[class*="ileRow"],[class*="changed"],[class*="iffFile"]')].filter(el => el.offsetParent).length;
    return {
      bodyProbe: { hasReview: body.includes('审阅') || body.includes('评审'), hasChanged: body.includes('变更') || body.includes('更改'), sample: body.slice(0, 260).replace(/\\n/g, '|') },
      codeMirror: !!cm,
      cmClasses: cm ? String(cm.className).slice(0, 60) : null,
      fileishCount: files,
      rightPanelActive: [...document.querySelectorAll('[class*="rightPanelTabContent"]')].filter(el => el.offsetParent).length,
    };
  })()`);
  console.log(JSON.stringify(st, null, 1));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
