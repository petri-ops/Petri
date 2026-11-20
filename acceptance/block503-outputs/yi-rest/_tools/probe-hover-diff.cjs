#!/usr/bin/env node
'use strict';
const { connect, sleep } = require('./cdp.cjs');

(async () => {
  const c = await connect();
  const targets = [
    ['button', '[aria-label="搜索会话标题"]'],
    ['input', 'textarea'],
  ];
  for (const [label, sel] of targets) {
    const p = await c.evalJson(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    const dump = `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      const cs = getComputedStyle(el);
      const out = { self: {}, before: {}, after: {}, childSvg: null };
      for (const k of cs) out.self[k] = cs.getPropertyValue(k);
      const bfs = getComputedStyle(el, '::before');
      const afs = getComputedStyle(el, '::after');
      out.before = { content: bfs.content, bg: bfs.backgroundColor, opacity: bfs.opacity };
      out.after = { content: afs.content, bg: afs.backgroundColor, opacity: afs.opacity };
      const svg = el.querySelector('svg');
      if (svg) { const s = getComputedStyle(svg); out.childSvg = { color: s.color, opacity: s.opacity, fill: s.fill }; }
      return out;
    })()`;
    const def = await c.evalJson(dump);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await sleep(250);
    const hov = await c.evalJson(dump);
    const diffs = [];
    for (const k of Object.keys(def.self)) {
      if (def.self[k] !== hov.self[k]) diffs.push(`${k}: ${def.self[k]} → ${hov.self[k]}`);
    }
    console.log(`=== ${label} self diffs(${diffs.length}):`, diffs.slice(0, 12).join(' | ') || '(none)');
    console.log(`    before: ${JSON.stringify(def.before)} → ${JSON.stringify(hov.before)}`);
    console.log(`    after : ${JSON.stringify(def.after)} → ${JSON.stringify(hov.after)}`);
    console.log(`    svg   : ${JSON.stringify(def.childSvg)} → ${JSON.stringify(hov.childSvg)}`);
  }
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
