#!/usr/bin/env node
'use strict';
// 复原窗口尺寸（早期 Emulation override 残留把窗口卡在 1154×1350；原为 ~1571×1114）。非产品代码。
const { connect, sleep } = require('./cdp.cjs');

async function converge(c, dim, target) {
  // Emulation on Electron = 真实 resize，带缩放因子；测一次 factor 后两轮收敛
  const probe = dim === 'w' ? { width: 800, height: 900 } : { width: 1200, height: 800 };
  await c.send('Emulation.setDeviceMetricsOverride', { ...probe, deviceScaleFactor: 1, mobile: false });
  await sleep(450);
  const actual = await c.evalJson(dim === 'w' ? 'innerWidth' : 'innerHeight');
  const factor = actual / (dim === 'w' ? 800 : 800);
  const request = Math.round(target / factor);
  await c.send('Emulation.setDeviceMetricsOverride', { width: dim === 'w' ? request : 1200, height: dim === 'w' ? 900 : request, deviceScaleFactor: 1, mobile: false });
  await sleep(450);
  let a = await c.evalJson(dim === 'w' ? 'innerWidth' : 'innerHeight');
  if (a !== target) {
    const r2 = Math.round(request + (target - a) / factor);
    await c.send('Emulation.setDeviceMetricsOverride', { width: dim === 'w' ? r2 : 1200, height: dim === 'w' ? 900 : r2, deviceScaleFactor: 1, mobile: false });
    await sleep(450);
    a = await c.evalJson(dim === 'w' ? 'innerWidth' : 'innerHeight');
  }
  return { target, actual: a, factor: factor.toFixed(4) };
}

(async () => {
  const c = await connect();
  const before = await c.evalJson('({ iw: innerWidth, ih: innerHeight })');
  console.log('before:', JSON.stringify(before));
  const w = await converge(c, 'w', 1571);
  const h = await converge(c, 'h', 1114);
  // 最终一次同时设两维（分开设会互相覆盖高度/宽度）
  const reqW = Math.round(1571 / w.factor);
  const reqH = Math.round(1114 / h.factor);
  await c.send('Emulation.setDeviceMetricsOverride', { width: reqW, height: reqH, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const after = await c.evalJson('({ iw: innerWidth, ih: innerHeight })');
  console.log('w converge:', JSON.stringify(w), 'h converge:', JSON.stringify(h));
  console.log('after:', JSON.stringify(after));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
