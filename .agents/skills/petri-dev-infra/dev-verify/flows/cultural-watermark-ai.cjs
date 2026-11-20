#!/usr/bin/env node
'use strict';
/** AI 出图水印实机取证（独立 flow，避开被并发覆盖的 cultural-watermark.cjs）。 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'cultural-watermark', 'ai-image', 'live');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'cultural-watermark-ai',
  description: 'AI 出图水印：各路由全局层/背景图/非交互 + 截图',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    for (const [p, name] of [['/', 'welcome'], ['/settings', 'settings'], ['/extensions', 'extensions']]) {
      await lib.evalJs(client, `location.href='http://localhost:3000${p}?test=1'`, 10_000);
      await sleep(1600);
      const info = await lib.evalJs(client, `(()=>{
        const g=document.querySelector('.petri-watermark-global');
        if(!g) return {global:false};
        const s=getComputedStyle(g);
        return {global:true,pos:s.position,pe:s.pointerEvents,bg:s.backgroundImage,op:s.opacity};
      })()`, 10_000).catch(() => ({ global: false }));
      assert(`${name}_global_mounted`, info.global === true, JSON.stringify(info));
      assert(`${name}_image_loaded`, (info.bg || '').includes('cultural-watermark'), `bg=${info.bg}`);
      assert(`${name}_noninteractive`, info.pos === 'fixed' && info.pe === 'none', `pos=${info.pos} pe=${info.pe}`);
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `${name}.png`).catch((e) => ({ error: String(e) }));
      assert(`shot_${name}`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    }
    return { ok: true };
  },
};
