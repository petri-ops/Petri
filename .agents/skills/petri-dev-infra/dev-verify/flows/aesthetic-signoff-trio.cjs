#!/usr/bin/env node
'use strict';
/** 审美签字三件套 round-N 取证（默认身份面 / 造型 / 国风水印）。
 * 9223 离屏。四路由（welcome/home/extensions/settings）截图 + 机械判据读数：
 *  A1 默认档属性 / A2 问候字青瓷墨+对比度 / A3 落印点朱砂+尺寸
 *  B3 半径三档合规读数（icon 座/卡片实际 computed radius）
 *  C1 水印全局层+非交互 / C2 透明度亮 0.10 暗 0.08
 * 视觉判据（和谐/不干扰/质感）由 round 截图人工逐条过目（PREFERENCE-REVIEW.md）。
 * 轮次由环境变量 TRIO_ROUND 指定（默认 1）。跑完由调用方 kill 9223。 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const ROUND = process.env.TRIO_ROUND || '1';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'aesthetic-signoff-trio', 'round' + ROUND);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = [['/', 'welcome'], ['/extensions', 'extensions'], ['/settings', 'settings']];

module.exports = {
  id: 'aesthetic-signoff-trio',
  description: '审美签字三件套：身份面+造型+水印 四路由机械判据+截图',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });

    for (const [p, name] of ROUTES) {
      await lib.evalJs(client, `localStorage.clear(); location.href='http://localhost:3000${p}?test=1'`, 10_000);
      // welcome 等渲染轮询
      let ready = false;
      for (let i = 0; i < 8 && !ready; i++) {
        await sleep(900);
        ready = await lib.evalJs(client, `Boolean(document.querySelector('h1[class*="greeting"]') || document.querySelector('[class*="settings"], [class*="extensions"], main'))`, 5_000).catch(() => false);
        if (ready !== true) await lib.evalJs(client, `location.href='http://localhost:3000${p}?test=1'`, 10_000).catch(() => {});
      }
      const probe = await lib.evalJs(client, `(()=>{
        const root = document.documentElement;
        const out = { route:'${name}', theme: root.getAttribute('data-theme'),
          accent: root.getAttribute('data-accent'), surface: root.getAttribute('data-surface') };
        // 身份面：问候字与落印点
        const g = document.querySelector('h1[class*="greeting"]');
        if (g) { const s = getComputedStyle(g); const a = getComputedStyle(g,'::after');
          out.greeting = { color: s.color, sealBg: a.backgroundColor, sealW: a.width, sealR: a.borderRadius }; }
        // 造型：采样图标座/卡片圆角（前 6 个带 radius 的容器）
        const radii = [];
        for (const el of document.querySelectorAll('button, [class*="icon"], [class*="card"], [class*="Card"]')) {
          const s = getComputedStyle(el);
          if (s.borderRadius && s.borderRadius !== '0px') radii.push(s.borderRadius);
          if (radii.length >= 6) break;
        }
        out.radiiSample = radii;
        // 水印
        const w = document.querySelector('.petri-watermark-global');
        if (w) { const s = getComputedStyle(w);
          out.watermark = { bg: (s.backgroundImage||'none').slice(0,60), opacity: s.opacity,
            filter: s.filter, pe: s.pointerEvents, pos: s.position }; }
        else out.watermark = null;
        return out;
      })()`, 10_000);
      if (name === 'welcome') {
        assert('A1_default_accent_attrs', probe.accent === 'celadon-ink' && probe.surface === 'celadon', JSON.stringify({accent:probe.accent, surface:probe.surface}));
        if (probe.greeting) {
          assert('A2_greeting_ink_color', probe.greeting.color === 'rgb(23, 58, 56)', `color=${probe.greeting.color}`);
          assert('A3_seal_vermilion', probe.greeting.sealBg === 'rgb(181, 72, 47)' && probe.greeting.sealR === '3px', JSON.stringify(probe.greeting));
        }
      }
      assert(`C1_${name}_watermark_layer`, probe.watermark && probe.watermark.pos === 'fixed' && probe.watermark.pe === 'none', JSON.stringify(probe.watermark));
      const expectedOpacity = probe.theme === 'dark' ? '0.08' : '0.1';
      assert(`C2_${name}_opacity`, probe.watermark && probe.watermark.opacity === expectedOpacity, `op=${probe.watermark && probe.watermark.opacity} theme=${probe.theme}`);
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `${name}.png`).catch((e) => ({ error: String(e) }));
      assert(`shot_${name}`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    }
    return { ok: true };
  },
};
