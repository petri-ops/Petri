#!/usr/bin/env node
'use strict';

/**
 * UI-310 加映实机 CDP 断言驱动：列间拖拽接缝（resizeHandleV）悬停呈现全高一致。
 *
 * 背景：列内 ColumnHeader（z-index 9999 + 不透明背景）曾盖住接缝悬停高亮
 * （::after hover 2px 横跨列边界的第二像素），呈现为「header 带细、栏体带粗」
 * 的上下断层。修复：.resizeHandleV z-index 5 → 10000。
 *
 * 断言（左接缝）：
 *   H1 header 带 hit：elementFromPoint(线右 1.5px, header 带内) = 接缝元素（修复前为中列 ColumnHeader）
 *   H2 header 带 hit：elementFromPoint(线左 2px,   header 带内) = 接缝元素（修复前为左列 ColumnHeader）
 *   H3 栏体带 hit：elementFromPoint(线右 1.5px, 栏体带内) = 接缝元素
 *   H4 真实悬停（Input.dispatchMouseEvent 在 header 带）：:hover 生效且 ::after 计算宽 2px
 *   H5 截图像素采样（悬停态）：header 带与栏体带的高亮线宽相等（accent 紫判据 b−g>40 且 b>120）；
 *      截图 base64 送回 renderer 用 OffscreenCanvas 解码逐列采样，量得宽度以 CSS px 计
 *
 * 前置：dev Electron 已在跑（:9222），页面停在 /project/:id 工作台 regular 布局，
 *       Vite dev server 已加载修复后 CSS。
 * 证据：acceptance/ui-310/seam-hover-live.json + seam-hover-live.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-310');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function evalJS(client, expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) {
    throw new Error(`evaluate_failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`.slice(0, 500));
  }
  return r.result.value;
}

async function main() {
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  const page = targets.find((t) => t.type === 'page' && /\/project\//.test(t.url || ''));
  if (!page) throw new Error('workspace_page_target_not_found');

  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Runtime.enable');
  await client.send('Page.enable');

  const checks = [];
  const check = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${detail}`); };

  // 接缝几何：第一个 resizeHandleV（左接缝）。lineX = 左缘 + 4（::after 静止线位置）。
  const geo = await evalJS(client, `(() => {
    const h = document.querySelectorAll('[class*="resizeHandleV"]')[0];
    if (!h) return null;
    const r = h.getBoundingClientRect();
    const headerVar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--petri-titlebar-height')) || 38;
    return { x: r.left, y: r.top, w: r.width, h: r.height, lineX: r.left + 4, headerH: Math.round(headerVar), dpr: window.devicePixelRatio };
  })()`);
  if (!geo) throw new Error('resize_handle_not_found');
  console.log('handle rect', JSON.stringify(geo));

  // 命中描述：标签 + class 片段（区分接缝 / 列内 header / 列体）。
  await evalJS(client, `window.__hit = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.tagName + '.' + String(el.className).slice(0, 70) : null;
  }; 'ok';`);

  const yHeader = geo.y + Math.min(12, geo.headerH / 2);
  const yBody = geo.y + Math.round(geo.h * 0.6);
  const h1 = await evalJS(client, `window.__hit(${geo.lineX + 1.5}, ${yHeader})`);
  const h2 = await evalJS(client, `window.__hit(${geo.lineX - 2}, ${yHeader})`);
  const h3 = await evalJS(client, `window.__hit(${geo.lineX + 1.5}, ${yBody})`);
  const isSeam = (s) => !!s && /resizeHandleV/.test(s);
  check('H1 header-band hit (+1.5px)', isSeam(h1), String(h1));
  check('H2 header-band hit (-2px)', isSeam(h2), String(h2));
  check('H3 body-band hit (+1.5px)', isSeam(h3), String(h3));

  // H4 真实悬停（header 带）→ :hover 生效 + ::after 2px；随后移开由 H5 前重新悬停。
  const hover = { x: Math.round(geo.lineX + 1), y: Math.round(yHeader) };
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y, buttons: 0 });
  await delay(120);
  const h4 = await evalJS(client, `(() => {
    const h = document.querySelectorAll('[class*="resizeHandleV"]')[0];
    return { on: [...document.querySelectorAll(':hover')].includes(h), afterW: getComputedStyle(h, '::after').width };
  })()`);
  // 页面可能带 zoom factor，2px 会报成 1.98x px —— 按数值容差判定。
  const afterW = parseFloat(h4.afterW);
  check('H4 hover in header band', h4.on === true && afterW >= 1.8 && afterW <= 2.2, JSON.stringify(h4));

  // H5 悬停态截图 → renderer 内 canvas 解码 → header 带 vs 栏体带逐列量高亮宽度。
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'seam-hover-live.png'), Buffer.from(shot.data, 'base64'));
  const h5 = await evalJS(client, `(async () => {
    const b64 = ${JSON.stringify(shot.data)};
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const scale = bmp.width / window.innerWidth;
    // getImageData 为 RGBA 字节序：小端组装后 R 在低字节、B 在高字节。
    const isAccent = (d) => { const b = (d >> 16) & 0xff, g = (d >> 8) & 0xff, r = d & 0xff; return b > 140 && b - g > 30 && b - r > 20; };
    const measure = (yCss) => {
      const row = Math.round(yCss * scale);
      const d0 = ctx.getImageData(0, row, bmp.width, 1).data;
      const center = Math.round(${JSON.stringify(geo.lineX)} * scale);
      let w = 0;
      for (let dx = -6; dx <= 6; dx++) {
        const p = (center + dx) * 4;
        if (isAccent(d0[p] | (d0[p + 1] << 8) | (d0[p + 2] << 16))) w += 1 / scale;
      }
      return Math.round(w * 10) / 10;
    };
    return { wHeader: measure(${yHeader}), wBody: measure(${yBody}) };
  })()`);
  check('H5 hover line width equal (header vs body)', h5.wHeader > 0 && Math.abs(h5.wHeader - h5.wBody) <= 1 / geo.dpr + 0.05,
    JSON.stringify(h5));

  // 复位：鼠标移开，不把悬停态留给用户。
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, buttons: 0 });

  const allPass = checks.every((c) => c.pass);
  const evidence = {
    generatedAt: new Date().toISOString(),
    target: { url: page.url, title: page.title },
    fix: 'resizeHandleV z-index 5->10000（列内 ColumnHeader 9999 曾遮挡 header 带内悬停高亮第二像素）',
    handleRect: geo,
    hoverPoint: hover,
    checks,
    allPass,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'seam-hover-live.json'), JSON.stringify(evidence, null, 2));
  console.log(`\nallPass=${allPass} · evidence: acceptance/ui-310/seam-hover-live.{json,png}`);
  client.close();
  process.exit(allPass ? 0 : 2);
}

const watchdog = setTimeout(() => {
  console.error('FAIL UI 实机脚本 5min 看门狗超时');
  process.exit(1);
}, 5 * 60 * 1000);
watchdog.unref();

main().catch((e) => {
  console.error('FAIL 脚本异常:', e && e.message);
  process.exit(1);
});
