#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  // extensions hash 调试
  await c.navigate('http://localhost:3000/extensions');
  await sleep(1500);
  const ext = await c.evalJson(`(function(){
    const styles = [...document.querySelectorAll('style')].filter(s => ((s.dataset && s.dataset.viteDevId) || '').includes('styles.module.css'));
    const hashes = new Set();
    for (const s of styles) for (const m of s.textContent.matchAll(/_([A-Za-z0-9_]+)_([a-z0-9]{5})_\\d+/g)) hashes.add(m[2]);
    const counts = {};
    for (const h of hashes) counts[h] = document.querySelectorAll('[class*="' + h + '"]').length;
    return { styleCount: styles.length, hashes: [...hashes], counts, devId: styles.length ? (styles[0].dataset.viteDevId || '').slice(-50) : null };
  })()`);
  console.log('extensions styles.module:', JSON.stringify(ext));
  const shelfTab = await c.evalJson(`(function(){
    const t = document.querySelector('[class*="shelfTab"]');
    return t ? String(t.className) : null;
  })()`);
  console.log('shelfTab class:', shelfTab);
  // 审阅 tile 调试（项目页）
  await c.navigate('http://localhost:3000/project/p_mwnkhuj2_okzh');
  await sleep(1500);
  const rev = await c.evalJson(`(function(){
    const hits = [...document.querySelectorAll('button,div')].filter(el => (el.innerText || '').trim().startsWith('审阅') && el.innerText.length < 30);
    return { count: hits.length, samples: hits.slice(0, 3).map(el => ({ tag: el.tagName, cls: String(el.className).slice(0, 50), visible: !!el.offsetParent })) };
  })()`);
  console.log('审阅 tiles:', JSON.stringify(rev));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
