#!/usr/bin/env node
'use strict';

/** UI-714 实机腿：chart 渲染接线（ui709-live 夹具 svg 断言+截图）+ 暗色 hover 单档探针。非产品代码。 */
const fs = require('node:fs');
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const OUT = 'ui714-live';

(async () => {
  const c = await connect();
  const findings = { legs: [] };
  const startUrl = c.page.url;

  // ① chart 接线实机（ui709-live 夹具 = 真实 ComposeCard + 含 chart 的合法 spec）
  await c.navigate('http://localhost:3000/ui709-live.html');
  await sleep(2200);
  const chart = await c.evalJson(`(function(){
    const svgs = document.querySelectorAll('#valid svg').length;
    const raw = document.body.innerText.includes('"series"');
    const bars = document.querySelectorAll('#valid svg rect, #valid svg polygon, #valid svg polyline').length;
    const legend = [...document.querySelectorAll('#valid button')].filter(b => /tok\\/s/.test(b.innerText || '')).length;
    return { svgCount: svgs, rawJsonVisible: raw, dataMarks: bars, legendButtons: legend };
  })()`);
  const region = await c.evalJson(`(function(){ const el = document.querySelector('#valid'); if (!el) return null; const r = el.getBoundingClientRect(); const x = Math.max(0, r.x), y = Math.max(0, r.y); return { x, y, w: Math.min(r.right, innerWidth) - x, h: Math.min(r.bottom, innerHeight) - y }; })()`);
  if (region && region.h > 40) await c.cropFull(outPath(OUT, 'chart-live.png'), region, 8);
  findings.legs.push({ id: 'chart_wired_live', pass: chart.svgCount > 0 && !chart.rawJsonVisible && chart.dataMarks > 0, detail: chart, expectation: 'svg 在场 + 无 raw JSON + 数据标记/图例在场', file: 'chart-live.png', harness: 'ui709-live.html（真实 ComposeCard + 合法五节点 spec，含 chart c1）' });
  console.log('chart:', JSON.stringify(chart));

  // ② 暗色 hover 单档探针（回到项目页）
  await c.navigate(startUrl);
  await sleep(1800);
  const themeBefore = await c.evalJson(`document.documentElement.getAttribute('data-theme') || 'light'`);
  await c.evaluate(`document.documentElement.setAttribute('data-theme', 'dark')`);
  await sleep(350);
  const hoverRead = await c.evalJson(`(function(){
    const el = [...document.querySelectorAll('.sc-model-btn')].find(b => b.offsetParent);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, before: getComputedStyle(el).backgroundColor };
  })()`);
  let hoverLeg = { pass: false };
  if (hoverRead) {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverRead.cx, y: hoverRead.cy, button: 'none' });
    await sleep(250);
    const after = await c.evalJson(`(function(){
      const el = [...document.querySelectorAll('.sc-model-btn')].find(b => b.offsetParent);
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, hoverVar: cs.getPropertyValue('--petri-hover') };
    })()`);
    const rect = await c.evalJson(`(function(){ const el = [...document.querySelectorAll('.sc-model-btn')].find(b => b.offsetParent); const r = el.getBoundingClientRect(); const x = Math.max(0, r.x), y = Math.max(0, r.y); return { x, y, w: Math.min(r.right, innerWidth) - x, h: Math.min(r.bottom, innerHeight) - y }; })()`);
    await c.cropFull(outPath(OUT, 'hover-dark-007.png'), rect, 8);
    hoverLeg = { pass: after.bg === 'rgba(230, 237, 243, 0.07)' && after.hoverVar.trim() === 'rgba(230, 237, 243, 0.07)', before: hoverRead.before, after, expectation: '暗色 hover 与其余元件同档 rgba(230,237,243,0.07)（原 0.06）', file: 'hover-dark-007.png' };
    console.log('hover:', JSON.stringify(hoverLeg));
  }
  findings.legs.push({ id: 'hover_single_tier_dark', ...hoverLeg });

  // ③ aria-current 实机（/extensions 上扩展钮）
  await c.evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(themeBefore)})`);
  await c.navigate('http://localhost:3000/extensions');
  await sleep(1600);
  const aria = await c.evalJson(`(function(){
    const btns = [...document.querySelectorAll('[class*="_leftQuickAction_"]')];
    const cur = btns.filter(b => b.getAttribute('aria-current') === 'page').map(b => (b.innerText || '').trim());
    return { total: btns.length, ariaCurrentPages: cur };
  })()`);
  findings.legs.push({ id: 'aria_current_live', pass: aria.ariaCurrentPages.length === 1 && aria.ariaCurrentPages[0].includes('扩展'), detail: aria });
  console.log('aria:', JSON.stringify(aria));

  await c.navigate(startUrl);
  await sleep(500);
  findings.boundary = 'ui709-live 夹具为只读取证页；主题切换用后复原；未改持久数据。';
  writeJson(OUT, 'live-assertion.json', findings);
  fs.writeFileSync(outPath(OUT, 'live-assertion.json'), JSON.stringify(findings, null, 2));
  console.log('DONE legs=', findings.legs.length, 'allPass=', findings.legs.every((l) => l.pass !== false));
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
