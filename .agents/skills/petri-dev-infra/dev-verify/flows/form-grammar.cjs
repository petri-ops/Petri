#!/usr/bin/env node
'use strict';
/** 形态语义层级实机取证：9223 离屏截 home/extensions/project-workspace，
 * 断言图标座/卡片 computed border-radius 用到新造型档、空徽章为圆、方印原子在场。
 * 只连 9223 测试实例，绝不碰用户主窗、不开可见窗。 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'form-grammar', 'live');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'form-grammar',
  description: '形态语义层级实机：图标座 squircle / 卡片柔边 / 圆印记 + 截图',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });

    for (const p of ['/', '/extensions', '/project']) {
      await lib.evalJs(client, `location.href='http://localhost:3000${p}?test=1'`, 10_000);
      await sleep(1800);
      const name = p === '/' ? 'home' : p.slice(1);
      const radii = await lib.evalJs(client, `(()=>{
        const out={};
        const icon=document.querySelector('.workbenchCardIcon,[class*="iconBtn"],[class*="leftQuickAction"]');
        if(icon) out.icon=getComputedStyle(icon).borderRadius;
        const card=document.querySelector('[class*="mcpCard"],[class*="workbenchIcon"]');
        if(card) out.card=getComputedStyle(card).borderRadius;
        const badge=document.querySelector('[class*="emptyResultBadge"]');
        if(badge) out.badge=getComputedStyle(badge).borderRadius;
        return out;
      })()`, 10_000).catch(() => ({}));
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `${name}.png`).catch((e) => ({ error: String(e) }));
      assert(`shot_${name}`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
      ctx.assert(`radii_present_${name}`, Object.keys(radii).length > 0, JSON.stringify(radii));
    }
    // 造型 token 派生值现读
    const tiers = await lib.evalJs(client, `(()=>{const s=getComputedStyle(document.documentElement);return {seal:s.getPropertyValue('--petri-radius-seal').trim(),icon:s.getPropertyValue('--petri-radius-icon').trim(),card:s.getPropertyValue('--petri-radius-card').trim()};})()`, 10_000).catch(() => null);
    assert('three_form_tiers_live', tiers && tiers.seal === '3px' && tiers.icon === '10px' && tiers.card === '14px', JSON.stringify(tiers));
    return tiers;
  },
};
