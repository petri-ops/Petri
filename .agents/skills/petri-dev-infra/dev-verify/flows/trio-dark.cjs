#!/usr/bin/env node
'use strict';
/* 三件套暗色补充取证：welcome+settings 切 dark，读水印 opacity/滤镜/对比 + 截图 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'aesthetic-signoff-trio', 'dark');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = {
  id: 'trio-dark',
  description: '三件套暗色模式补充：水印暗 0.08/身份色暗档/截图',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    for (const [p, name] of [['/', 'welcome'], ['/settings', 'settings']]) {
      await lib.evalJs(client, `location.reload(); 'reloaded'`, 10_000);
      await sleep(2500);
      // 暗色（零触碰）：服务端偏好 theme=light 为用户已选，不写服务端——加载后直设 data-theme
      // 属性走暗档 CSS（与 s5 亮档断言同栈）；settle 1.5s 过渡完成后才探针/截图（washed=过早截屏残影，dark-diag 已定性）
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'darked'`, 5_000);
      await sleep(1500);
      const probe = await lib.evalJs(client, `(()=>{
        const root=document.documentElement;
        const out={ theme: root.getAttribute('data-theme'), accent: root.getAttribute('data-accent'), surface: root.getAttribute('data-surface') };
        const w=document.querySelector('.petri-watermark-global');
        if(w){const s=getComputedStyle(w); out.watermark={opacity:s.opacity,filter:s.filter,pe:s.pointerEvents};}
        const g=document.querySelector('h1[class*=\\"greeting\\"]');
        if(g){const s=getComputedStyle(g); const a=getComputedStyle(g,'::after'); out.greeting={color:s.color,sealBg:a.backgroundColor};}
        return out;
      })()`, 10_000);
      assert(`dark_${name}_theme`, probe.theme === 'dark', JSON.stringify({theme:probe.theme}));
      assert(`dark_${name}_watermark_008`, probe.watermark && probe.watermark.opacity === '0.08', JSON.stringify(probe.watermark));
      assert(`dark_${name}_identity_attrs`, probe.accent === 'celadon-ink' && probe.surface === 'celadon', JSON.stringify({accent:probe.accent,surface:probe.surface}));
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `${name}-dark.png`).catch((e) => ({ error: String(e) }));
      assert(`dark_shot_${name}`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    }
    // 还原亮色（不留暗偏好给后续实例）
    await lib.evalJs(client, `localStorage.clear(); document.documentElement.setAttribute('data-theme','light'); 'restored'`, 5_000);
    return { ok: true };
  },
};
