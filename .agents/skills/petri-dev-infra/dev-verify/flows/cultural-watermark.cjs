#!/usr/bin/env node
'use strict';
/** 国风水印实机取证（全局层）：逐页断言四纹样在场、fixed、不挡交互、截图。
 * 只连 9223 测试实例，不碰用户主窗、不开可见窗。 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'cultural-watermark', 'live');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'cultural-watermark',
  description: '国风水印全局层：各路由四纹样在场/fixed/非交互 + 截图',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    for (const [p, name] of [['/', 'welcome'], ['/projects', 'home'], ['/extensions', 'extensions'], ['/settings', 'settings']]) {
      await lib.evalJs(client, `location.href='http://localhost:3000${p}?test=1'`, 10_000);
      await sleep(1600);
      const info = await lib.evalJs(client, `(()=>{
        const g=document.querySelector('.petri-watermark-global');
        if(!g) return {global:false,count:0};
        const s=getComputedStyle(g);
        const els=[...g.querySelectorAll('.petri-watermark')];
        return {global:true,pos:s.position,pe:s.pointerEvents,count:els.length,
          cls:els.map(e=>e.className),masks:els.map(e=>(getComputedStyle(e).maskImage||'').slice(0,18))};
      })()`, 10_000).catch(() => ({ global: false, count: 0 }));
      assert(`${name}_global_mounted`, info.global === true, JSON.stringify(info));
      assert(`${name}_four_archetypes`, info.count === 4, JSON.stringify(info.cls || []));
      assert(`${name}_fixed_noninteractive`, info.pos === 'fixed' && info.pe === 'none', `pos=${info.pos} pe=${info.pe}`);
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `${name}.png`).catch((e) => ({ error: String(e) }));
      assert(`shot_${name}`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    }
    return { ok: true };
  },
};
