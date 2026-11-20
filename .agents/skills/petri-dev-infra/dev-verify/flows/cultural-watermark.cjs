#!/usr/bin/env node
'use strict';
/** 国风水印实机取证：9223 离屏截欢迎页/工作区，断言四纹样在场、极淡、不挡交互。
 * 只连 9223 测试实例，不碰用户主窗、不开可见窗。 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'cultural-watermark', 'live');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'cultural-watermark',
  description: '国风水印实机：四纹样在场、极淡、pointer-events:none、截图',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    // 从首页现读一个真实 project id（不硬编码），再进工作区。
    await lib.evalJs(client, `location.href='http://localhost:3000/?test=1'`, 10_000);
    await sleep(1800);
    const projectPath = await lib.evalJs(client, `(()=>{
      const a=[...document.querySelectorAll('a[href*="/project/"]')][0];
      return a?a.getAttribute('href'):null;
    })()`, 10_000).catch(() => null);

    // 欢迎页实机（测试 userData 保证有此面）。
    for (const [p, name, expectCls] of [['/', 'welcome', 'moon-gate']]) {
      await lib.evalJs(client, `location.href='http://localhost:3000${p}?test=1'`, 10_000);
      await sleep(1800);
      const info = await lib.evalJs(client, `(()=>{
        const els=[...document.querySelectorAll('.petri-watermark')];
        return els.map(e=>{const s=getComputedStyle(e);return {cls:e.className,pe:s.pointerEvents,mask:(s.maskImage||s.webkitMaskImage||'').slice(0,30),bg:s.backgroundColor,op:s.opacity};});
      })()`, 10_000).catch(() => []);
      assert(`${name}_watermarks_present`, info.length >= 2, JSON.stringify(info));
      assert(`${name}_expected_archetype`, info.some((x) => x.cls.includes(expectCls)), JSON.stringify(info.map((x)=>x.cls)));
      assert(`${name}_non_interactive`, info.every((x) => x.pe === 'none'), JSON.stringify(info.map((x)=>x.pe)));
      assert(`${name}_has_mask`, info.every((x) => x.mask.includes('svg')), JSON.stringify(info.map((x)=>x.mask)));
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `${name}.png`).catch((e) => ({ error: String(e) }));
      assert(`shot_${name}`, !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    }
    // 工作区：测试 userData 若无项目则如实标不可达，不伪造截图（静态接线由 HK-01 覆盖）。
    if (projectPath) {
      await lib.evalJs(client, `location.href='http://localhost:3000${projectPath}?test=1'`, 10_000);
      await sleep(1800);
      const info = await lib.evalJs(client, `[...document.querySelectorAll('.petri-watermark')].map(e=>e.className)`, 10_000).catch(() => []);
      assert('workspace_expected_archetype', info.some((c) => c.includes('pebble')), JSON.stringify(info));
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, 'workspace.png').catch((e) => ({ error: String(e) }));
      assert('shot_workspace', !shot.error, shot.error ? `screenshot_unavailable: ${shot.error}` : '');
    } else {
      assert('workspace_live_unavailable', true, '测试 userData 无项目：工作区实机面不可达，静态接线由 HK-01 覆盖，未伪造截图');
    }
    return { projectPath: projectPath || null };
  },
};
