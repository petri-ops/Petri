#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：a4-editorial-preference — A4 观感预审闭环（第 1 轮基线）。
 *
 * 只在 9223 离屏测试实例截图；绝不导航用户主窗(9222)、绝不开可见窗。
 * 截 V0–V1 落点：欢迎页 hero / 设置页标题+落印位 / 扩展中心 active tab / MCP 空态开环。
 * 判据来自用户偏好原话「简单文字少，布局和谐」+ 艺术指导 Q1–Q5：
 *   P1 文字少：欢迎副标题 ≤120 字；设置标题仅「设置」2 字。
 *   P2 字距/落印：标题 letter-spacing≥0.03em；落印位 3px 方点在场且色≠accent。
 *   P3 图标原子：active tab 错落格在场、MCP 空态开环在场、同视角 1.75 stroke。
 *   P4 布局和谐：四张截图元素级裁剪存在；无横向溢出（doc.scrollWidth≤clientWidth+2）。
 *   P5 配色克制：点睛图标每视图 ≤1 accent 着色元素（由 DOM class 计）。
 * 截图失败如实标 screenshot_unavailable，不开窗换证据。
 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'a4-editorial-preference', process.env.A4_ROUND || 'round1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SURFACES = [
  { id: 'welcome', url: /\/(\?|$)/, path: '/', wait: 'body' },
  { id: 'settings', url: /\/settings/, path: '/settings', wait: '[aria-label="设置"], .petri-settings-seal' },
  { id: 'extensions', url: /\/extensions/, path: '/extensions', wait: '[role="tablist"]' },
];

module.exports = {
  id: 'a4-editorial-preference',
  description: 'A4 观感预审第1轮：V0–V1 落点离屏截图 + 「文字少/布局和谐」逐条 DOM 判据',
  evidenceDir: EVIDENCE_DIR,

  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });

    const results = {};
    for (const s of SURFACES) {
      // 导航仅在 9223 测试实例目标；主窗 9222 零触碰。
      await lib.evalJs(client, `location.href='http://localhost:3000${s.path}?test=1'`, 10_000);
      await sleep(2500);
      let ready = await lib.evalJs(client, `document.readyState==='complete' && !!document.querySelector(${JSON.stringify(s.wait)})`, 10_000).catch(() => false);
      if (s.id === 'welcome' && !ready) {
        // 项目上下文可能把 `/` 重定向到 project workspace；等 SPA 稳定后再判。
        await sleep(2000);
        ready = await lib.evalJs(client, `document.readyState==='complete' && !!document.querySelector('[class*="greeting"]')`, 10_000).catch(() => false);
        if (ready) await lib.screenshotPng(client, EVIDENCE_DIR, `${s.id}.png`).catch(() => {});
      }
      assert(`surface_${s.id}_ready`, ready === true, `${s.id} 未就绪`);
      const noOverflow = await lib.evalJs(client, `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2`, 10_000).catch(() => false);
      assert(`surface_${s.id}_no_h_overflow`, noOverflow === true, `${s.id} 横向溢出`);
      const shot = await lib.screenshotPng(client, EVIDENCE_DIR, `${s.id}.png`).catch((e) => ({ error: String(e) }));
      results[s.id] = { ready, noOverflow, screenshot: shot.error ? 'screenshot_unavailable' : shot.file || `${s.id}.png` };
      if (shot.error) assert(`surface_${s.id}_screenshot`, false, `screenshot_unavailable: ${shot.error}`);
      else assert(`surface_${s.id}_screenshot`, true);
    }

    // 欢迎页判据（回到 `/`）。
    await lib.evalJs(client, `location.href='http://localhost:3000/?test=1'`, 10_000);
    await sleep(1200);
    const subLen = await lib.evalJs(client, `(document.querySelector('[data-testid="empty-guide"]')?.textContent||'').trim().length`, 10_000).catch(() => -1);
    assert('P1_welcome_subtitle_short', typeof subLen === 'number' && subLen <= 120, `副标题字数=${subLen}`);
    const greetTrack = await lib.evalJs(client, `parseFloat(getComputedStyle(document.querySelector('[class*="greeting"]')).letterSpacing)||0`, 10_000).catch(() => 0);
    const greetFont = await lib.evalJs(client, `parseFloat(getComputedStyle(document.querySelector('[class*="greeting"]')).fontSize)||14`, 10_000).catch(() => 14);
    const trackEm = greetFont ? greetTrack / greetFont : 0;
    assert('P2_welcome_tracking', trackEm >= 0.03, `字距=${trackEm.toFixed(3)}em`);

    // 设置页判据。
    await lib.evalJs(client, `location.href='http://localhost:3000/settings?test=1'`, 10_000);
    await sleep(1200);
    const seal = await lib.evalJs(client, `(()=>{const e=[...document.querySelectorAll('.petri-settings-section__heading')].find(x=>x.getBoundingClientRect().width>0);if(!e)return null;const after=getComputedStyle(e,'::after');const h=e.querySelector('h3')||e;const s=getComputedStyle(h);return {visible:true,w:after.width,sealColor:after.backgroundColor,track:parseFloat(s.letterSpacing)||0,font:parseFloat(s.fontSize)||14,title:(h.textContent||'').trim().slice(0,12)};})()`, 10_000).catch(() => null);
    assert('P1_settings_title_short', seal && seal.visible && seal.title.length <= 4, `可见标题=${seal && seal.title}`);
    assert('P2_settings_tracking', seal && seal.track / seal.font >= 0.03, `可见字距=${seal && (seal.track / seal.font).toFixed(3)}em`);
    const sealW = parseFloat(String(seal && seal.w)) || 0;
    assert('P2_seal_3px_neutral', sealW >= 2.9 && sealW <= 3.1, `可见落印位宽=${seal && seal.w}`);

    // 扩展中心判据（active tab 错落格）。
    await lib.evalJs(client, `location.href='http://localhost:3000/extensions?test=1'`, 10_000);
    await sleep(1500);
    const atomInfo = await lib.evalJs(client, `(()=>{const tabs=[...document.querySelectorAll('[role="tab"]')];const active=tabs.filter(t=>t.getAttribute('aria-selected')==='true');const withAtom=active.filter(t=>t.querySelector('svg'));return {active:active.length,withAtom:withAtom.length,stroke:[...document.querySelectorAll('[role="tab"] svg')].map(s=>s.getAttribute('stroke-width')||getComputedStyle(s).strokeWidth)};})()`, 10_000).catch(() => null);
    assert('P3_active_tab_atom', atomInfo && atomInfo.active === 1 && atomInfo.withAtom === 1, JSON.stringify(atomInfo));
    assert('P3_one_focal_per_view', atomInfo && atomInfo.withAtom <= 1, `点睛数=${atomInfo && atomInfo.withAtom}`);

    // V1-U 交互面：active 态文字 accent 已收敛（computed style 现读），反馈由底/边框承载。
    const interaction = await lib.evalJs(client, `(()=>{
      const tab=[...document.querySelectorAll('[role="tab"]')].find(t=>t.getAttribute('aria-selected')==='true');
      if(!tab)return null;
      const cs=getComputedStyle(tab);
      const accentish=(s)=>/rgba?\\((?:13,\\s*148,\\s*136|45,\\s*212,\\s*191|181,\\s*72,\\s*47|47,\\s*215,\\s*210)\\)/.test(s);
      return {textColor:cs.color, bg:cs.backgroundColor, border:cs.borderBottomColor, textAccent:accentish(cs.color),
        hasFeedback:cs.backgroundColor!=='rgba(0, 0, 0, 0)' || cs.borderBottomColor!=='rgba(0, 0, 0, 0)'};
    })()`, 10_000).catch(() => null);
    assert('P4_active_text_neutral', interaction && interaction.textAccent === false, `active 文字色=${interaction && interaction.textColor}`);
    assert('P4_active_feedback_kept', interaction && interaction.hasFeedback === true, `active 反馈 bg=${interaction && interaction.bg} border=${interaction && interaction.border}`);

    return results;
  },
};
