#!/usr/bin/env node
'use strict';
/**
 * 临时探针（用完即删）— UI-588 人测失败根因取证。
 * 对用户主实例 9222（可见窗口）做真实指针 hover 前后对比：
 *  - 只 dispatch mouseMoved（不点击、不导航——遵守探针红线）
 *  - 取证对象：workspaceFileTreeResize / resizeHandleV / float-card-resize-handle
 *  - 每处：默认态 clip 截图 → hover → 计算样式 + matches(':hover') + clip 截图
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const OUT = path.join(ROOT, 'acceptance', 'tmp-block273-hover-probe');
const TARGET_ID = process.argv[2];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJs(client, expr) {
  const r = await client.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  }, { timeoutMs: 15000 });
  if (r.exceptionDetails) throw new Error('eval_exc: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result && r.result.value;
}

async function clipShot(client, file, rect, pad = 64) {
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
      fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.data, 'base64'));
      return `saved(fromSurface=${fromSurface})`;
    } catch (e) { /* try next */ }
  }
  return 'screenshot_unavailable';
}

async function probeOne(client, label, findExpr, hoverExpr) {
  const rec = { label };
  const rect = await evalJs(client, `(function(){
    var e = ${findExpr};
    if (!e) return null;
    var r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  if (!rect) { rec.status = 'not_found_or_zero_rect'; return rec; }
  rec.rect = rect;

  // 默认态样式
  rec.default = await evalJs(client, `(function(){
    var e = ${findExpr};
    if (!e) return null;
    var cs = getComputedStyle(e);
    var wrap = e.closest('[class*="workspaceFileTreePaneWrap"]') || e.parentElement;
    var wcs = wrap ? getComputedStyle(wrap) : null;
    return {
      handleHover: e.matches(':hover'),
      width: cs.width,
      bg: cs.backgroundColor,
      beforeOpacity: cs.getPropertyValue('opacity'),
      wrapClass: wrap ? wrap.className : null,
      wrapBorderLeft: wcs ? wcs.borderLeftColor : null,
      dpr: window.devicePixelRatio
    };
  })()`);
  rec.defaultShot = await clipShot(client, `${label}-default.png`, rect);

  // 真实指针移到把手中心
  const mx = Math.round(rect.x + rect.w / 2);
  const my = Math.round(rect.y + Math.min(rect.h / 2, 300));
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my }, { timeoutMs: 5000 });
  await sleep(450); // transition duration-fast 完成

  rec.hover = await evalJs(client, `(function(){
    var e = ${findExpr};
    if (!e) return null;
    var cs = getComputedStyle(e);
    var wrap = e.closest('[class*="workspaceFileTreePaneWrap"]') || e.parentElement;
    var wcs = wrap ? getComputedStyle(wrap) : null;
    var before = getComputedStyle(e, '::before');
    var after = getComputedStyle(e, '::after');
    return {
      hovered: e.matches(':hover'),
      handleHoverActive: ${hoverExpr},
      beforeOpacity: cs.getPropertyValue('opacity'),
      beforeBg: cs.backgroundImage,
      beforeWidth: cs.width,
      afterBg: after.backgroundColor,
      wrapBorderLeft: wcs ? wcs.borderLeftColor : null
    };
  })()`);
  rec.hoverShot = await clipShot(client, `${label}-hover.png`, rect);

  // 指针移回角落，避免残留 hover 态干扰用户
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 }, { timeoutMs: 5000 }).catch(() => {});
  return rec;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const targets = await lib.fetchJson('http://127.0.0.1:9222/json');
  const page = targets.find((t) => t.type === 'page' && (!TARGET_ID || t.id === TARGET_ID));
  if (!page) throw new Error('page_target_not_found');
  const client = await lib.connectTarget(page);
  const out = { url: page.url, dpr: await evalJs(client, 'window.devicePixelRatio') };

  // 全窗截图（看当前用户所见状态）
  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png' }, { timeoutMs: 20000 });
    fs.writeFileSync(path.join(OUT, 'full-window.png'), Buffer.from(shot.data, 'base64'));
    out.fullShot = 'saved';
  } catch (e) { out.fullShot = 'unavailable: ' + e.message.slice(0, 80); }

  // 页面上现存的可调宽边界盘点
  out.inventory = await evalJs(client, `(function(){
    var sels = {
      workspaceFileTreeResize: '[class*="workspaceFileTreeResize"]',
      workspaceFileTreePaneWrap: '[class*="workspaceFileTreePaneWrap"]',
      resizeHandleV: '[class*="resizeHandleV"]',
      floatCardHandle: '[data-testid="float-card-resize-handle"]',
      artifactPinDivider: '[class*="artifactPinDivider"]',
      embeddedTerminalResize: '[class*="embeddedTerminalResize"]'
    };
    var out = {};
    for (var k in sels) {
      var list = document.querySelectorAll(sels[k]);
      out[k] = Array.from(list).map(function(e){
        var r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cls: String(e.className).slice(0, 80) };
      });
    }
    return out;
  })()`);

  out.treeResize = await probeOne(client, 'tree-resize',
    `document.querySelector('[class*="workspaceFileTreeResize"]')`,
    `e.matches(':hover')`);
  out.resizeHandleV = await probeOne(client, 'resize-handle-v',
    `document.querySelector('[class*="resizeHandleV"]')`,
    `e.matches(':hover')`);
  out.floatCard = await probeOne(client, 'float-card',
    `document.querySelector('[data-testid="float-card-resize-handle"]')`,
    `e.matches(':hover')`);

  fs.writeFileSync(path.join(OUT, 'probe-result.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('[probe] failed:', e.message); process.exit(1); });
