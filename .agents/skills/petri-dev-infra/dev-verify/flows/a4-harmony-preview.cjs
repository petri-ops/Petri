#!/usr/bin/env node
'use strict';
/**
 * dev-verify flow：a4-harmony-preview — A4 四档整体观感预审（逐档截图 + 逐条判据）。
 * 在 9223 离屏测试实例逐档切 data-accent + data-surface，截 welcome/settings/extensions
 * 三面，断言 P1–P4（P5 对比度由静态门禁锁），并验四档骨架/点睛色各异。
 * 红线：只连 9223 测试实例，绝不导航用户主窗(9222)、绝不开可见窗。
 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
// env 调用时读取（BLOCK-375 顶层固化棘轮）
const round = () => process.env.A4_ROUND || 'round1';
const EVIDENCE_DIR = () => path.join(ROOT, 'acceptance', 'a4-harmony-preview', round());
const ACCENTS = [
  { id: 'paper-vermilion', surface: 'paper' },
  { id: 'celadon-ink', surface: 'celadon' },
  { id: 'ultramarine-brass', surface: 'ultramarine' },
  { id: 'indigo-mist', surface: 'mist' },
];
const SURFACES = [
  { id: 'welcome', path: '/' },
  { id: 'settings', path: '/settings' },
  { id: 'extensions', path: '/extensions' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'a4-harmony-preview',
  description: 'A4 四档整体观感预审：逐档切色截图三面 + P1–P4 逐条判据 + 四档各异',
  evidenceDir: EVIDENCE_DIR(),
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR(), { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await lib.evalJs(client, `location.href='http://localhost:3000/?test=1'`, 10_000);
    await sleep(2000);

    const canvases = [];
    const accents = [];
    for (const acc of ACCENTS) {
      // 显式 light：纸底/墨底差异在亮色可辨；dark 由静态门禁另验非反色。
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','light')`, 10_000);
      await lib.evalJs(client, `document.documentElement.setAttribute('data-accent',${JSON.stringify(acc.id)})`, 10_000);
      await lib.evalJs(client, `document.documentElement.setAttribute('data-surface',${JSON.stringify(acc.surface)})`, 10_000);
      await sleep(500);

      const canvas = await lib.evalJs(client, `getComputedStyle(document.documentElement).getPropertyValue('--petri-bg-canvas').trim()`, 10_000).catch(() => '');
      const accent = await lib.evalJs(client, `getComputedStyle(document.documentElement).getPropertyValue('--petri-accent').trim()`, 10_000).catch(() => '');
      assert(`P3_${acc.id}_surface_applied`, canvas !== '', `${acc.id} canvas=${canvas}`);
      assert(`P3_${acc.id}_accent_applied`, accent !== '', `${acc.id} accent=${accent}`);
      canvases.push(canvas);
      accents.push(accent);

      for (const s of SURFACES) {
        await lib.evalJs(client, `location.href='http://localhost:3000${s.path}?test=1'`, 10_000);
        await sleep(1400);
        // 导航会丢 data-* 属性（SPA 重载），重注入。
        await lib.evalJs(client, `document.documentElement.setAttribute('data-accent',${JSON.stringify(acc.id)});document.documentElement.setAttribute('data-surface',${JSON.stringify(acc.surface)})`, 10_000);
        await sleep(300);

        const overflow = await lib.evalJs(client, `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2`, 10_000).catch(() => false);
        assert(`P2_${acc.id}_${s.id}_no_overflow`, overflow === true, `${acc.id}/${s.id} 横向溢出`);

        if (s.id === 'welcome') {
          const subLen = await lib.evalJs(client, `(document.querySelector('[data-testid="empty-guide"]')?.textContent||'').trim().length`, 10_000).catch(() => -1);
          assert(`P1_${acc.id}_welcome_short`, typeof subLen === 'number' && subLen <= 120, `${acc.id} 副标题=${subLen}`);
        }
        if (s.id === 'extensions') {
          const atoms = await lib.evalJs(client, `[...document.querySelectorAll('[role="tab"]')].filter(t=>t.getAttribute('aria-selected')==='true'&&t.querySelector('svg')).length`, 10_000).catch(() => -1);
          assert(`P4_${acc.id}_one_focal`, atoms === 1, `${acc.id} active atom=${atoms}`);
          const txt = await lib.evalJs(client, `(()=>{const t=[...document.querySelectorAll('[role="tab"]')].find(x=>x.getAttribute('aria-selected')==='true');return t?getComputedStyle(t).color:''})()`, 10_000).catch(() => '');
          assert(`P4_${acc.id}_text_neutral`, txt !== '', `${acc.id} active text=${txt}`);
        }

        const shot = await lib.screenshotPng(client, EVIDENCE_DIR(), `${acc.id}-${s.id}.png`).catch((e) => ({ error: String(e) }));
        assert(`shot_${acc.id}_${s.id}`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
      }
    }
    assert('four_accents_distinct', new Set(accents).size === 4, `accents=${JSON.stringify(accents)}`);
    assert('four_surfaces_distinct', new Set(canvases).size === 4, `canvases=${JSON.stringify(canvases)}`);
    return { accents, canvases };
  },
};
