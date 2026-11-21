#!/usr/bin/env node
'use strict';
/* 暗色工作区诊断：attr-hack 切暗后探针卡片 computed 色 + 截图（判定 washed 归因） */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'aesthetic-signoff-trio', 'dark-diag');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = {
  id: 'trio-dark-diag',
  description: '暗色工作区诊断：卡片 computed 色+截图（washed 归因）',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await lib.evalJs(client, `location.reload(); 'reloaded'`, 10_000);
    await sleep(2500);
    await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'darked'`, 5_000);
    await sleep(1500);
    const probe = await lib.evalJs(client, `(()=>{
      const out={theme:document.documentElement.getAttribute('data-theme'),cards:[]};
      const sels=['[class*="packCard"]','[class*="workbenchIcon"]','[class*="panelCard"]','[class*="card"]','button'];
      for(const sel of sels){
        const el=document.querySelector(sel);
        if(el){const s=getComputedStyle(el);
          out.cards.push({sel,bg:s.backgroundColor,color:s.color,r:s.borderRadius});}
        if(out.cards.length>=4)break;
      }
      const body=getComputedStyle(document.body);
      out.bodyBg=body.backgroundColor;
      return out;
    })()`, 10_000);
    console.log('[diag]', JSON.stringify(probe));
    assert('diag_theme_dark', probe.theme === 'dark', probe.theme);
    const shot = await lib.screenshotPng(client, EVIDENCE_DIR, 'workspace-dark-diag.png').catch((e) => ({ error: String(e) }));
    assert('diag_shot', !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    return { ok: true };
  },
};
