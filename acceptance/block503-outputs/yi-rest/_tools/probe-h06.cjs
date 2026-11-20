#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  const r = await c.evalJson(`(function(){
    const fileMatch = (s, frag) => ((s.dataset && s.dataset.viteDevId) || '').includes(frag);
    const out = {};
    for (const frag of ['desktop.css', 'KnowledgeSpacePanel.module.css', 'AnnotationBar.module.css']) {
      const styles = [...document.querySelectorAll('style')].filter(s => fileMatch(s, frag));
      const hashes = new Set();
      for (const s of styles) {
        for (const m of s.textContent.matchAll(/_([A-Za-z0-9_]+)_([a-z0-9]{5})_\\d+/g)) hashes.add(m[2]);
      }
      const counts = {};
      for (const h of hashes) counts[h] = document.querySelectorAll('[class*="' + h + '"]').length;
      const devIds = styles.slice(0, 2).map(s => (s.dataset.viteDevId || '').slice(-60));
      out[frag] = { styleCount: styles.length, hashes: [...hashes], counts, devIds };
    }
    return out;
  })()`);
  console.log(JSON.stringify(r, null, 1));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
