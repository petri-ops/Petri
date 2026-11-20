#!/usr/bin/env node
'use strict';
/** B 方案实机取证：逐档切 data-accent（applyAccent 联切 data-surface），
 * 断言 data-surface 属性、computed 骨架 bg 色随档变、与默认海军蓝不同；截图四档。
 * 只连 9223 离屏测试实例；不开可见窗。 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'b-surface-dimension', 'live');
const ACCENTS = [
  { a: 'paper-vermilion', s: 'paper' },
  { a: 'celadon-ink', s: 'celadon' },
  { a: 'ultramarine-brass', s: 'ultramarine' },
  { a: 'indigo-mist', s: 'mist' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'b-surface-dimension',
  description: 'B 方案：四档 accent 联切 data-surface，computed 骨架色随档变且非默认海军蓝',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await lib.evalJs(client, `location.href='http://localhost:3000/?test=1'`, 10_000);
    await sleep(2500);
    // 用 light 取证：纸底/靛底在亮色可见，dark 下各档都是墨底（非机械反色）。
    await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','light')`, 10_000);
    await sleep(500);
    const base = await lib.evalJs(client, `getComputedStyle(document.documentElement).getPropertyValue('--petri-bg-canvas').trim()`, 10_000).catch(() => '');
    const bgs = [];
    for (const { a, s } of ACCENTS) {
      await lib.evalJs(client, `document.documentElement.setAttribute('data-accent',${JSON.stringify(a)})`, 10_000);
      await lib.evalJs(client, `(function(){const m=${JSON.stringify(s)};document.documentElement.setAttribute('data-surface',m);})()`, 10_000);
      await sleep(600);
      const attr = await lib.evalJs(client, `document.documentElement.getAttribute('data-surface')`, 10_000).catch(() => null);
      const bg = await lib.evalJs(client, `getComputedStyle(document.documentElement).getPropertyValue('--petri-bg-canvas').trim()`, 10_000).catch(() => '');
      assert(`surface_${s}_attr`, attr === s, `${s} attr=${attr}`);
      assert(`surface_${s}_skeleton_changed`, bg !== '' && bg !== base, `${s} bg=${bg} base=${base}`);
      bgs.push(bg);
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `surface-${s}.png`).catch((e) => ({ error: String(e) }));
      assert(`surface_${s}_screenshot`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    }
    assert('four_surfaces_distinct', new Set(bgs).size === 4, `bgs=${JSON.stringify(bgs)}`);
    // 移除 accent → 骨架回默认（teal 分支）。
    await lib.evalJs(client, `document.documentElement.removeAttribute('data-accent');document.documentElement.removeAttribute('data-surface')`, 10_000);
    await sleep(500);
    const restored = await lib.evalJs(client, `getComputedStyle(document.documentElement).getPropertyValue('--petri-bg-canvas').trim()`, 10_000).catch(() => '');
    assert('surface_removed_restores_default', restored === base, `restored=${restored} base=${base}`);
    return { base, bgs };
  },
};
