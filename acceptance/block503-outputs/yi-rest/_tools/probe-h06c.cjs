#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  const r = await c.evalJson(`(function(){
    const styleFile = new Map();
    const hashRe = /_([A-Za-z0-9_]+)_([a-z0-9]{5})_\\d+/g;
    let styleTagCount = 0, withDevId = 0, moduleTags = 0;
    for (const s of document.querySelectorAll('style')) {
      styleTagCount += 1;
      const devId = (s.dataset && s.dataset.viteDevId) || '';
      if (!devId) continue;
      withDevId += 1;
      if (devId.includes('.module.css')) {
        moduleTags += 1;
        for (const m of s.textContent.matchAll(hashRe)) {
          if (!styleFile.has(m[2])) styleFile.set(m[2], devId.slice(-70));
        }
      }
    }
    const btn = document.querySelector('[aria-label="搜索会话标题"]');
    const cls = btn ? String(btn.className) : null;
    const tokens = cls ? cls.split(/\\s+/).filter(Boolean) : [];
    const probes = tokens.map(t => {
      const hm = t.match(/_([a-z0-9]{5})_\\d+$|^[a-z0-9]{5}$/);
      const key = hm ? hm[1] : t;
      return { token: t, key, owner: styleFile.get(key) || null };
    });
    // 全表抽 3 条
    const sample = [...styleFile.entries()].slice(0, 3);
    return { styleTagCount, withDevId, moduleTags, mapSize: styleFile.size, btnCls: cls, probes, sample, btnFound: !!btn };
  })()`);
  console.log(JSON.stringify(r, null, 1));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
