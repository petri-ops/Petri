#!/usr/bin/env node
'use strict';
/**
 * scripts/ui591-glow-follow-live.cjs — UI-591 指针跟随渐晕实机取证（常驻探针）。
 *
 * 前置：主 dev 栈（vite:3000 + 后端:3001）+ 9223 测试实例（bash scripts/start-test-instance.sh --onscreen）。
 * 用法：node scripts/ui591-glow-follow-live.cjs [port] [tag]   （默认 9222 win）
 * 证据：<tag>-glow-follow-result.json + <tag>-resize-handle-v-glow-y{150,600}.png 落 acceptance/ui-591/。
 *
 * 方法论（2026-10-27 实测沉淀，修正 BLOCK-273 老结论）：
 *   - 真实指针 = CDP Input.dispatchMouseEvent(mouseMoved)。**屏内可见窗口可用**（9222 主实例
 *     与 9223 --onscreen 均实测触发 :hover + React 合成事件）；离屏窗口 -32000 拒入，
 *     屏内实例必须 --onscreen。
 *   - CSS.forcePseudoState 静默不生效（BLOCK-273 已入册）；合成 PointerEvent 冒泡派发
 *     不触发 React 合成事件（props 缺失时），不得作为接线证据。
 *   - 接线判定 = 读元素 `__reactProps$` keys 是否含 onPointerMove + inlineGlowY 是否随
 *     指针刷新；Windows Vite watcher 可能漏 .tsx 事件（CSS 热更正常、组件陈旧）——
 *     props 陈旧时对改动文件 utimesSync touch 强制 transform 失效。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const OUT = path.join(ROOT, 'acceptance', 'ui-591');
const PORT = process.argv[2] || '9222';
const TAG = process.argv[3] || 'win';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJs(client, expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true }, { timeoutMs: 15000 });
  if (r.exceptionDetails) throw new Error('eval_exc: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result && r.result.value;
}

async function clipShot(client, file, rect, pad = 56) {
  const clip = {
    x: Math.max(0, Math.floor(rect.x - pad)),
    y: Math.max(0, Math.floor(rect.y - pad)),
    width: Math.ceil(rect.w + pad * 2),
    height: Math.ceil(rect.h + pad * 2),
    scale: 2,
  };
  for (const fromSurface of [true, false]) {
    try {
      const shot = await client.send('Page.captureScreenshot', { format: 'png', clip, fromSurface }, { timeoutMs: 20000 });
      fs.writeFileSync(path.join(OUT, `${TAG}-${file}`), Buffer.from(shot.data, 'base64'));
      return `saved(fromSurface=${fromSurface})`;
    } catch (e) { /* try next */ }
  }
  return 'screenshot_unavailable';
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const targets = await lib.fetchJson(`http://127.0.0.1:${PORT}/json`);
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('page_target_not_found');
  const client = await lib.connectTarget(page);
  const out = { url: page.url };

  const rect = await evalJs(client, `(function(){
    var e = document.querySelector('[class*="resizeHandleV"]');
    if (!e) return null;
    var r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  if (!rect) throw new Error('resizeHandleV_not_found');
  out.rect = rect;

  out.cssApplied = await evalJs(client, `(function(){
    var e = document.querySelector('[class*="resizeHandleV"]');
    var b = getComputedStyle(e, '::before');
    var cs = getComputedStyle(e);
    return { bgImage: (b.backgroundImage || '').slice(0, 140), defaultOpacity: b.opacity,
             hoverAfterRule: cs.getPropertyValue('--petri-resize-glow-y') };
  })()`);

  out.checks = [];
  for (const [label, yOffset] of [['glow-y150', 150], ['glow-y600', 600]]) {
    const mx = Math.round(rect.x + rect.w / 2);
    const my = Math.round(rect.y + yOffset);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my }, { timeoutMs: 8000 });
    await sleep(450);
    const state = await evalJs(client, `(function(){
      var e = document.querySelector('[class*="resizeHandleV"]');
      var cs = getComputedStyle(e);
      var b = getComputedStyle(e, '::before');
      var a = getComputedStyle(e, '::after');
      return {
        hovered: e.matches(':hover'),
        inlineGlowY: e.style.getPropertyValue('--petri-resize-glow-y'),
        usedGlowY: cs.getPropertyValue('--petri-resize-glow-y'),
        beforeOpacity: b.opacity,
        afterBg: a.backgroundColor,
        afterWidth: a.width
      };
    })()`);
    state.pointerY = my;
    state.shot = await clipShot(client, `resize-handle-v-${label}.png`, { x: rect.x, y: my - 130, w: rect.w, h: 260 });
    out.checks.push({ label, ...state });
  }

  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 }, { timeoutMs: 8000 }).catch(() => {});
  fs.writeFileSync(path.join(OUT, `${TAG}-glow-follow-result.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('[probe] failed:', e.message); process.exit(1); });
