#!/usr/bin/env node
'use strict';
/** 国风水印实机取证（终版=AI 钢笔白描版 · R2 清偿批 S1 裁决落地）：
 * 逐路由断言全局层在场、背景图为 AI 白描 PNG、fixed、不挡交互、截图。
 * 断言结构复刻 canonical 证据 ai-image/live/cultural-watermark-ai-live-darwin.json
 * （12/12 allPass，2026-11-20T13:06Z；原 AI flow 改写在并发窗口被覆盖丢失，
 * 按该证据集复刻）。只连 9223 测试实例，不碰用户主窗、不开可见窗。 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'cultural-watermark', 'ai-image', 'live');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'cultural-watermark',
  description: '国风水印终版(AI白描)：各路由全局层在场/背景图加载/fixed/非交互 + 截图',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    for (const [p, name] of [['/', 'welcome'], ['/extensions', 'extensions'], ['/settings', 'settings']]) {
      await lib.evalJs(client, `location.href='http://localhost:3000${p}?test=1'`, 10_000);
      await sleep(1600);
      const info = await lib.evalJs(client, `(()=>{
        const g=document.querySelector('.petri-watermark-global');
        if(!g) return {global:false};
        const s=getComputedStyle(g);
        return {global:true,pos:s.position,pe:s.pointerEvents,
          bg:(s.backgroundImage||'none').slice(0,90),op:s.opacity};
      })()`, 10_000).catch(() => ({ global: false }));
      assert(`${name}_global_mounted`, info.global === true && info.pos === 'fixed' && info.pe === 'none',
        JSON.stringify(info));
      assert(`${name}_image_loaded`, String(info.bg || '').includes('cultural-watermark.png'), `bg=${info.bg}`);
      assert(`${name}_noninteractive`, info.pos === 'fixed' && info.pe === 'none', `pos=${info.pos} pe=${info.pe}`);
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `${name}.png`).catch((e) => ({ error: String(e) }));
      assert(`shot_${name}`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    }
    return { ok: true };
  },
};
