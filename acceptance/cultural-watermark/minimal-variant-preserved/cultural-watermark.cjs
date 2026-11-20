#!/usr/bin/env node
'use strict';
/** 国风水印实机取证（极简几何单线版）：逐页断言四原型 SVG stroke 在场、零位图/反相、非交互、截图。 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'cultural-watermark', 'live-minimal');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROTOTYPES = ['moon-gate', 'seal', 'pebble', 'open-ring'];

module.exports = {
  id: 'cultural-watermark',
  description: '国风水印极简几何单线版：四路由四原型 stroke mask 在场/零位图滤镜/非交互 + 截图',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    // 就绪探测：等 Vite HMR 把极简单线 CSS 编进页面再断言，避免拿到旧 bundle 的假红。
    // 清缓存：强制 reload 绕过 Vite 模块缓存，避免复用到旧位图 bundle。
    await lib.evalJs(client, `location.href='http://localhost:3000/?test=1&wc='+Date.now()`, 10_000);
    await sleep(1000);
    await lib.evalJs(client, `location.reload(true)`, 10_000).catch(() => {});
    await sleep(1500);
    let ready = false;
    for (let i = 0; i < 12 && !ready; i += 1) {
      ready = await lib
        .evalJs(
          client,
          `(()=>{const el=document.querySelector('.petri-watermark--moon-gate');
           return !!el && (getComputedStyle(el).maskImage||getComputedStyle(el).webkitMaskImage||'').includes('stroke');})()`,
          10_000,
        )
        .catch(() => false);
      if (!ready) await sleep(500);
    }
    assert('vite_bundle_ready', ready === true, '极简单线 CSS 未在强制 reload 后 12 轮内生效');
    for (const [p, name] of [['/', 'welcome'], ['/projects', 'home'], ['/extensions', 'extensions'], ['/settings', 'settings']]) {
      await lib.evalJs(client, `location.href='http://localhost:3000${p}?test=1&wc='+Date.now()`, 10_000);
      await sleep(1600);
      const info = await lib.evalJs(client, `(()=>{
        const g=document.querySelector('.petri-watermark-global');
        if(!g) return {global:false};
        const gs=getComputedStyle(g);
        const prototypes=['moon-gate','seal','pebble','open-ring'].map(n=>{
          const el=g.querySelector('.petri-watermark--'+n);
          if(!el) return {n,ok:false};
          const s=getComputedStyle(el);
          const mask=(s.maskImage||s.webkitMaskImage||'');
          return {n,ok:mask.includes('svg')&&mask.includes('stroke'),stroke:mask.includes('stroke'),mask:mask.slice(0,60)};
        });
        const first=g.querySelector('.petri-watermark');
        const ps=first?getComputedStyle(first):null;
        return {global:true,pos:gs.position,pe:gs.pointerEvents,globalBg:gs.backgroundImage,globalFilter:gs.filter,
          prototypes,inkBg:ps?ps.backgroundColor:'',bgImage:ps?ps.backgroundImage:'',peItem:ps?ps.pointerEvents:''};
      })()`, 10_000).catch(() => ({ global: false }));
      assert(`${name}_global_mounted`, info.global === true, JSON.stringify(info));
      assert(`${name}_four_stroke_prototypes`, (info.prototypes || []).length === 4 && info.prototypes.every((x) => x.ok),
        JSON.stringify(info.prototypes));
      assert(`${name}_fixed_noninteractive`, info.pos === 'fixed' && info.pe === 'none', `pos=${info.pos} pe=${info.pe}`);
      assert(`${name}_no_bitmap_no_filter`, (info.globalBg === 'none' || !info.globalBg) && (info.globalFilter === 'none' || !info.globalFilter) && !String(info.bgImage).includes('.png'),
        `globalBg=${info.globalBg} filter=${info.globalFilter} bgImage=${info.bgImage}`);
      const ink = String(info.inkBg || '');
      // color-mix() 经浏览器计算后序列化为 color(srgb …) 或 rgba()，两者都是 token 派生结果。
      assert(`${name}_ink_color_from_token`, /^(rgba?\(|color\(srgb)/.test(ink) && !ink.includes('rgba(0, 0, 0, 0)'), `inkBg=${ink}`);
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `${name}.png`).catch((e) => ({ error: String(e) }));
      assert(`shot_${name}`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    }
    return { ok: true };
  },
};
