#!/usr/bin/env node
'use strict';
/**
 * dev-verify flow：v5-harmony-accents — V5 四档和声可见面实机取证。
 * 在 9223 离屏测试实例上逐档注入 data-accent，截取欢迎页，断言 computed 色值与
 * 档位定义一致、点睛色确实改变（可读出 accent），证明"可见品牌面"生效。
 * 红线：只连 9223 测试实例，绝不导航用户窗；不开可见窗。
 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'v5-harmony-accents', 'live');
const HARMONY = [
  { id: 'paper-vermilion', light: '#b5482f', dark: '#d97055' },
  { id: 'celadon-ink', light: '#0f766e', dark: '#2fd7d2' },
  { id: 'ultramarine-brass', light: '#a87c42', dark: '#c9a063' },
  { id: 'indigo-mist', light: '#6e9ca0', dark: '#8fb8bb' },
];
const toRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'v5-harmony-accents',
  description: 'V5：四档和声经 data-accent 实机切换，computed accent 与档位一致 + 截图取证',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await lib.evalJs(client, `location.href='http://localhost:3000/?test=1'`, 10_000);
    await sleep(2500);

    const theme = await lib.evalJs(client, `document.documentElement.getAttribute('data-theme') || 'light'`, 10_000).catch(() => 'light');
    const colors = [];
    for (const h of HARMONY) {
      await lib.evalJs(client, `document.documentElement.setAttribute('data-accent',${JSON.stringify(h.id)})`, 10_000);
      await sleep(600);
      const expectation = theme === 'dark' ? h.dark : h.light;
      const expectedRgb = toRgb(expectation);
      const actual = await lib.evalJs(client, `getComputedStyle(document.documentElement).getPropertyValue('--petri-accent').trim()`, 10_000).catch(() => '');
      const rgb = await lib.evalJs(client, `(()=>{const d=document.createElement('div');d.style.color='var(--petri-accent)';document.body.appendChild(d);const c=getComputedStyle(d).color;d.remove();return c;})()`, 10_000).catch(() => '');
      assert(`accent_${h.id}_token`, actual.replace(/\s+/g, '').toLowerCase() === expectation.toLowerCase(), `${h.id} theme=${theme} token=${actual} expect=${expectation}`);
      assert(`accent_${h.id}_computed`, rgb === expectedRgb, `${h.id} theme=${theme} computed=${rgb} expect=${expectedRgb}`);
      colors.push(rgb);
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `${h.id}.png`).catch((e) => ({ error: String(e) }));
      assert(`accent_${h.id}_screenshot`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    }
    assert('four_harmony_colors_distinct', new Set(colors).size === 4, `colors=${JSON.stringify(colors)}`);

    // 双套证明：显式切到另一主题，每档 accent 必须变化（非机械反色）。
    const other = theme === 'dark' ? 'light' : 'dark';
    for (const h of HARMONY) {
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme',${JSON.stringify(other)})`, 10_000);
      await lib.evalJs(client, `document.documentElement.setAttribute('data-accent',${JSON.stringify(h.id)})`, 10_000);
      await sleep(400);
      const actual = await lib.evalJs(client, `getComputedStyle(document.documentElement).getPropertyValue('--petri-accent').trim()`, 10_000).catch(() => '');
      const expected = other === 'dark' ? h.dark : h.light;
      assert(`accent_${h.id}_pair_${other}`, actual.replace(/\s+/g, '').toLowerCase() === expected.toLowerCase(), `${h.id} ${other}=${actual} expect=${expected}`);
    }
    return { theme, colors };
  },
};
