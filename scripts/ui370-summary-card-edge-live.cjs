#!/usr/bin/env node
'use strict';
/**
 * ui370-summary-card-edge-live.cjs — UI-370 实机验收（摘要卡右缘灰带根除 + 双形态右对齐）。
 *
 * 被测缺陷（用户截图指认「这条每次摘要图都有，影响视觉」）：
 * `.workspaceSummaryFloat` 带 `box-shadow: 0 12px 32px rgba(15,23,42,.18)`，其祖先
 * `.workspaceSessionLayout` / `.workspaceSessionContent` 是 `overflow: hidden`；
 * 而 `right: 4px` 把卡片内缩 4px → 阴影右侧几乎全落在裁切区外，只剩 4px 一条
 * 贯穿全卡高的灰带。修复 = `right: 0` 贴齐会话区右缘（阴影右侧让位给裁切区）
 * + 悬浮宿主卡片 `max-width: 100%`（撤掉与 shrink-to-fit 互为循环的 24px 预留）
 * + 钉住列 `padding-right: 0` / `align-items: flex-end` + 入场动画 `translateX(-16px)`。
 *
 * 形态驱动方式（不依赖视口模拟）：`summaryVisibility` 由 `sessionFrameWidth`
 * （ResizeObserver 实测会话框宽度）+ 阈值 1120px 决定，而 CDP 的
 * `Emulation.setDeviceMetricsOverride` 在本 Electron 下不会可靠触发该测量
 * （实测形态会卡住不切换）。故改为**临时给会话框元素注入宽度覆盖**，让 App 用
 * 自身响应式逻辑切到目标形态，测完立即移除（产品代码零改动）：
 *   float  用例 → 会话框 width:700px（真实用户窗口 ~722px 即长期处于此形态）
 *   column 用例 → 会话框 width:1300px + 布局 translateX(-620px)（把卡片移入视口可见区，
 *                便于像素级取证；布局右缘/裁切边界不变，几何断言不受影响）
 *
 * 断言（A1/A2 = 悬浮形态，A3/A4 = 钉住列形态）：
 *   A1/A3 卡片右缘与会话区（.workspaceSessionLayout）右缘对齐 = 0px（修复前 4px / 28px）
 *   A2/A4 卡片右缘无灰带：解码截图 PNG，卡片右缘向右的连续非白列 ≤ 1px（= 卡片自身
 *         1px 边框）。修复前为 5px（4px 阴影残渣 + 边框）
 *   A5 祖先仍是 overflow:hidden（证明 A2/A4 测的是「阴影被裁切后的可见结果」）
 *
 * 用法：dev 栈在跑（Vite:3000 + CDP:9222）→ `node scripts/ui370-summary-card-edge-live.cjs`
 * 证据：acceptance/ui-370/ui370-summary-card-edge-live.json + ui370-edge-{float,column}.png
 */

const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-370');
const OVERRIDE_ID = 'ui370-acceptance-override';

// ── 极简 PNG 解码（Chromium 截图：8bit / 非隔行 / colorType 2|6）──
function decodePng(buf) {
  let off = 8;
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('png_bit_depth_' + data[8]);
      colorType = data[9];
      if (colorType !== 2 && colorType !== 6) throw new Error('png_color_type_' + colorType);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : 3;
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return {
    width, height,
    nonWhite(x, y) {
      const i = y * stride + x * ch;
      return out[i] < 252 || out[i + 1] < 252 || out[i + 2] < 252;
    },
  };
}

const MEASURE = `(function(){
  var card=document.querySelector('[class*="workspacePinnedSummary"]');
  var wrap=document.querySelector('[class*="workspaceSummaryFloat"]');
  var col=document.querySelector('[class*="workspaceSummaryColumn"]');
  var lay=document.querySelector('[class*="workspaceSessionLayout"]');
  if(!card||!lay) return JSON.stringify({err:'no_card'});
  var cr=card.getBoundingClientRect(), lr=lay.getBoundingClientRect();
  return JSON.stringify({
    vw:innerWidth, mode: wrap?'float':(col?'column':'none'),
    cardRight:cr.right, cardTop:cr.top, cardHeight:cr.height, cardWidth:cr.width,
    layoutRight:lr.right, gap: Math.round((lr.right-cr.right)*100)/100,
    cssRight: wrap?getComputedStyle(wrap).right:null,
    columnPadR: col?getComputedStyle(col).paddingRight:null,
    cardMaxWidth: getComputedStyle(card).maxWidth,
    ancestorClipped: [document.querySelector('[class*="workspaceSessionLayout"]'),
                      document.querySelector('[class*="workspaceSessionContent"]')]
                      .some(function(e){return e && getComputedStyle(e).overflow==='hidden';})
  });
})()`;

const TOGGLE_OPEN = `(function(){
  var b=Array.prototype.slice.call(document.querySelectorAll('button'))
    .find(function(n){return (n.getAttribute('aria-label')||'').indexOf('展开摘要概览')>=0;});
  if(!b) return 'no_button_or_open'; b.click(); return 'clicked_open';
})()`;
const TOGGLE_CLOSE = `(function(){
  var b=Array.prototype.slice.call(document.querySelectorAll('button'))
    .find(function(n){return (n.getAttribute('aria-label')||'').indexOf('收起摘要概览')>=0;});
  if(!b) return 'no_button'; b.click(); return 'clicked_close';
})()`;
const injectCss = (css) => `(function(){
  var el=document.getElementById('${OVERRIDE_ID}');
  if(!el){ el=document.createElement('style'); el.id='${OVERRIDE_ID}'; document.head.appendChild(el); }
  el.textContent=${JSON.stringify(css)};
  /* 形态由 sessionFrameWidth（RO 实测）决定；本 Electron 下 RO 对节点替换会失联，
     故注入后补一次 window resize —— 该 hook 的 resize 监听会重读会话框宽度，
     正是 App 自己的重测入口。 */
  window.dispatchEvent(new Event('resize'));
  return el.textContent;})()`;
const removeCss = `(function(){var el=document.getElementById('${OVERRIDE_ID}'); if(el) el.remove(); window.dispatchEvent(new Event('resize')); return true;})()`;
const FRAME = '[class*="workspaceSessionFrame"]';
const LAYOUT = '[class*="workspaceSessionLayout"]';
// 会话框是 flex 项（flex:1 → flex-basis:0%），仅设 width 不生效，必须给 flex-basis。
const CASES = [
  { tag: 'float', css: `${FRAME}{flex:0 0 700px !important;width:700px !important;}`, expect: 'float' },
  { tag: 'column', css: `${FRAME}{flex:0 0 1300px !important;width:1300px !important;}${LAYOUT}{transform:translateX(-620px) !important;}`, expect: 'column' },
];

/** 卡片右缘起向右的「连续非白列」宽度（image px，含卡片自身边框列）。 */
function bandWidth(png, cssCardRight, cssTop, cssHeight, scale) {
  const imgRight = Math.round(cssCardRight * scale);
  const y0 = Math.max(0, Math.round((cssTop + 12) * scale));
  const y1 = Math.min(png.height, Math.round((cssTop + cssHeight - 12) * scale));
  const rows = y1 - y0;
  let w = 0;
  for (let x = imgRight - 3; x < Math.min(png.width, imgRight + 12); x++) {
    let n = 0;
    for (let y = y0; y < y1; y++) if (png.nonWhite(x, y)) n++;
    if (n > rows * 0.9) w++; else break;
  }
  return w;
}

(async () => {
  const run = lib.createRun({ name: 'ui370-summary-card-edge', evidenceDir: EVIDENCE_DIR });
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_main_target');
  const client = await lib.connectTarget(target);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const hadCard = await lib.evalJs(client, `!!document.querySelector('[class*="workspacePinnedSummary"]')`);
  if (!hadCard) { await lib.evalJs(client, TOGGLE_OPEN); await sleep(1000); }

  const results = {};
  for (const { tag, css, expect } of CASES) {
    await lib.evalJs(client, injectCss(css));
    let m = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await sleep(500);
      if (!(await lib.evalJs(client, `!!document.querySelector('[class*="workspacePinnedSummary"]')`))) {
        await lib.evalJs(client, TOGGLE_OPEN);
        await sleep(700);
      }
      m = JSON.parse(await lib.evalJs(client, MEASURE));
      if (m.mode === expect) break;
    }
    if (m.mode !== expect) throw new Error(`mode_not_reached expected=${expect} got=${m.mode}`);
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.data, 'base64');
    const file = path.join(EVIDENCE_DIR, `ui370-edge-${tag}.png`);
    fs.writeFileSync(file, buf);
    const png = decodePng(buf);
    const scale = png.width / m.vw;
    const band = bandWidth(png, m.cardRight, m.cardTop, m.cardHeight, scale);
    results[tag] = {
      ...m, imgWidth: png.width, scale: Math.round(scale * 1000) / 1000,
      bandWidthPx: band, screenshot: path.basename(file), overrideCss: css,
    };
    lib.log(`${tag}: mode=${m.mode} gap=${m.gap}px band=${band}px cardW=${Math.round(m.cardWidth)} maxW=${m.cardMaxWidth}`);
    await lib.evalJs(client, removeCss);
    await sleep(400);
  }

  const f = results.float, c = results.column;
  run.assert('A1 悬浮形态：卡片右缘贴齐会话区右缘（gap = 0px；修复前 4px）', f.gap === 0, `gap=${f.gap} cardRight=${Math.round(f.cardRight)} layoutRight=${Math.round(f.layoutRight)}`);
  run.assert('A2 悬浮形态：卡片右缘无灰带（连续非白列 ≤ 1px = 卡片边框；修复前 5px）', f.bandWidthPx <= 1, `band=${f.bandWidthPx}px`);
  run.assert('A3 钉住列形态：卡片右缘贴齐会话区右缘（gap = 0px；修复前 28px）', c.gap === 0, `gap=${c.gap} cardRight=${Math.round(c.cardRight)} layoutRight=${Math.round(c.layoutRight)}`);
  run.assert('A4 钉住列形态：卡片右缘无灰带（连续非白列 ≤ 1px）', c.bandWidthPx <= 1, `band=${c.bandWidthPx}px`);
  run.assert('A5 祖先裁切前提仍成立（A2/A4 测的是裁切后的可见结果）', f.ancestorClipped === true && c.ancestorClipped === true,
    `float=${f.ancestorClipped} column=${c.ancestorClipped}`);

  await lib.evalJs(client, removeCss).catch(() => {});
  if (!hadCard) { await lib.evalJs(client, TOGGLE_CLOSE).catch(() => {}); await sleep(400); }
  client.close?.();

  await run.finish({
    cases: results,
    rootCause: 'shadow(0 12px 32px rgba(15,23,42,.18)) + 祖先 overflow:hidden + float right:4px → 仅剩 4px 阴影残渣',
    fix: 'float right:0 + 悬浮宿主卡片 max-width:100% + 钉住列 padding-right:0/flex-end + 动画 translateX(-16px)',
    userReport: '用户截图指认摘要卡右缘灰带「每次摘要图都有，影响视觉效果」',
    modeDriveNote: '形态经会话框宽度覆盖触发（App 自身响应式逻辑），CDP 视口模拟在本 Electron 下不可靠',
  });
  process.exit(run.allPass ? 0 : 1);
})().catch((e) => { lib.log(`FATAL ${e.message}`); process.exit(2); });
