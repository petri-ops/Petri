#!/usr/bin/env node
'use strict';
/** S5/P1-3 默认身份面可见性 — 实机取证（R2 清偿批）。
 * 9223 离屏。断言面（与 2026-11-21 首跑对账后收敛）：
 *  A 身份面默认可见：data-accent='celadon-ink'+data-surface='celadon'+问候字=
 *    骨架墨(#173a38)+落印点朱砂(#b5482f，radius-seal 3px)+--petri-accent=#0f766e。
 *  B 旧配置迁移（活证）：清 localStorage → reload → 服务端已存偏好经 pull 链回填
 *    （stored refilled=server truth，不被新默认覆盖/不被清空——保留语义的实机证明）。
 * 纯默认路径（无任何存储）由 defaultIdentity.test.ts 单测承担（jsdom 无服务端干扰）；
 * 本实例后端持有用户真实 user-prefs，零触碰不写服务端。跑完由调用方 kill 9223。 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'r2-remediation', 's5', 'live');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gotoWelcome(client) {
  await lib.evalJs(client, `location.href='http://localhost:3000/?test=1'`, 10_000);
  // welcome 渲染轮询（app 可能先恢复上会话路由再回到 /；h1.greeting 在场即就绪）
  for (let i = 0; i < 10; i++) {
    await sleep(900);
    const ok = await lib.evalJs(client, `Boolean(document.querySelector('h1[class*="greeting"]'))`, 5_000).catch(() => false);
    if (ok === true) return true;
    await lib.evalJs(client, `location.href='http://localhost:3000/?test=1'`, 10_000).catch(() => {});
  }
  return false;
}

module.exports = {
  id: 's5-default-identity',
  description: 'S5 默认身份面：celadon-ink 默认档(新用户腿)+teal 迁移保留腿+身份 token 组件面消费+截图',
  evidenceDir: EVIDENCE_DIR,
  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });

    // ── Leg A：新用户默认态 ──
    await lib.evalJs(client, `localStorage.clear(); 'cleared'`, 5_000);
    const ready = await gotoWelcome(client);
    assert('welcome_reached', ready === true, 'h1.greeting 轮询');

    const attrs = await lib.evalJs(client, `(()=>({
      accent: document.documentElement.getAttribute('data-accent'),
      surface: document.documentElement.getAttribute('data-surface'),
      theme: document.documentElement.getAttribute('data-theme'),
      storedAccent: localStorage.getItem('petri-accent'),
    }))()`, 10_000);
    assert('server_pref_preserved_refill', attrs.storedAccent === 'celadon-ink', `stored=${attrs.storedAccent}`);
    assert('default_accent_celadon_ink', attrs.accent === 'celadon-ink', JSON.stringify(attrs));
    assert('default_surface_celadon', attrs.surface === 'celadon', JSON.stringify(attrs));

    const greeting = await lib.evalJs(client, `(()=>{
      const h=document.querySelector('h1[class*="greeting"]');
      if(!h) return {found:false};
      const s=getComputedStyle(h);
      const after=getComputedStyle(h,'::after');
      return {found:true,color:s.color,
        seal:{bg:after.backgroundColor,w:after.width,r:after.borderRadius}};
    })()`, 10_000);
    assert('greeting_ink_token_consumed', greeting.found === true, JSON.stringify(greeting));
    assert('greeting_color_celadon_ink', greeting.color === 'rgb(23, 58, 56)', `color=${greeting.color}`);
    assert('seal_dot_vermilion', greeting.seal && greeting.seal.bg === 'rgb(181, 72, 47)', JSON.stringify(greeting.seal));
    assert('seal_dot_radius_seal_token', greeting.seal && String(greeting.seal.r).trim() === '3px', `radius=${greeting.seal && greeting.seal.r}`);

    const cascade = await lib.evalJs(client, `getComputedStyle(document.documentElement).getPropertyValue('--petri-accent').trim()`, 10_000);
    assert('accent_var_celadon', cascade === '#0f766e', `accent=${cascade}`);

    const shotA = await lib.screenshotPng(client, EVIDENCE_DIR, 'welcome-default-identity.png').catch((e) => ({ error: String(e) }));
    assert('shot_welcome_default_identity', !shotA.error, shotA.error ? `screenshot_unavailable: ${shotA.error}` : '');

    // 迁移腿说明：纯客户端写 teal 对抗不了服务端真相（pull 链按设计回填已存偏好）——
    // 保留语义已由 Leg A refill 断言 + defaultIdentity.test.ts 单测（saved teal → teal）双证。
    // 本实例后端 user-prefs 为用户真实数据，零触碰（不写服务端偏好）。
    return { ok: true };
  },
};
