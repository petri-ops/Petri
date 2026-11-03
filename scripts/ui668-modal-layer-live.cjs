#!/usr/bin/env node
'use strict';

/**
 * UI-668 实机 CDP 断言驱动：整窗编辑预览（SVG 编辑器 modal）不再被会话输入框/列接缝穿透。
 *
 * 背景：右栏 tab 容器（.rightPanelTabContentActive）与预览 keep-alive 容器写了 z-index:1，
 * 各自成为堆叠上下文，把 tab 内的 fixed 浮层困在全局 z≈1；中栏会话祖先链无堆叠上下文，
 * 输入框 z 2 / 消息导轨 25·45 / 滚动条 26 直接参与全局比较 → 压在整窗编辑器之上。
 * 修复：去掉困层 z-index；整窗编辑器与 3D 对话框改 --petri-z-modal；编辑器从标题栏下沿开始；
 * viewer 去掉第二层 fixed；列接缝（z 10000）在 data-petri-layer="modal" 在场时让位。
 *
 * 断言：
 *   L1 关闭态：右栏缩略图「在编辑器打开」可命中；激活 tab 容器 z-index=auto；接缝可见
 *   L2 模态层级：z-index = --petri-z-modal，top = --petri-titlebar-height
 *   L3 网格命中：标题栏以下 12×10 采样点全部命中模态内部（会话/右栏/接缝零穿透）
 *   L4 标题栏带命中不在模态内（列标题栏刻意压在模态之上）
 *   L5 「关闭编辑器」按钮可命中
 *   L6 viewer 非 fixed，且位于模态头部之下、模态之内
 *   L7 编辑器分区（stage/layers/revision/inspector 中已渲染者）两两不重叠且不越出 viewer
 *   L8 模态在场时接缝 visibility=hidden
 *   L9 真实鼠标点击关闭后：模态移除，接缝恢复可见可命中
 *
 * 前置：dev Electron 在跑（默认 :9222），页面停在 /project/:id，右栏「文件」预览着一个 .svg。
 * 证据：acceptance/ui-668/modal-layer-live.json + modal-layer-open.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-668');

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

/** 在页面里执行一个真函数（toString 序列化），避免多层模板串转义。 */
async function evalFn(client, fn, arg) {
  const expression = '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')';
  const r = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) {
    throw new Error(('evaluate_failed: ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')).slice(0, 500));
  }
  return r.result.value;
}

async function realClick(client, x, y) {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

// ---- 页面侧函数 ----

function pageClosedState() {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '在编辑器打开');
  if (!btn) return { precondition: false };
  const r = btn.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const active = document.querySelector('[class*="rightPanelTabContentActive"]');
  const seams = [...document.querySelectorAll('[class*="resizeHandleV"]')].map((el) => {
    const s = el.getBoundingClientRect();
    const h = document.elementFromPoint(s.x + s.width / 2, s.y + s.height / 2);
    return { x: Math.round(s.x), visibility: getComputedStyle(el).visibility, hittable: h === el || el.contains(h) };
  });
  return {
    precondition: true,
    openButton: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
    thumbHittable: hit === btn || btn.contains(hit),
    activeTabZ: active ? getComputedStyle(active).zIndex : null,
    seams,
  };
}

function pageOpenState() {
  const rootCs = getComputedStyle(document.documentElement);
  const modal = document.querySelector('[data-testid="svg-editor-modal"]');
  if (!modal) return { modalPresent: false };
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
  };
  const describe = (el) => {
    if (!el) return 'null';
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '');
    return (el.tagName + '.' + cls.split(' ')[0]).slice(0, 80);
  };
  const mcs = getComputedStyle(modal);
  const mr = modal.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // L3 网格：标题栏以下 12×10
  const cols = 12;
  const rows = 10;
  const offenders = [];
  let samples = 0;
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const x = ((i + 0.5) / cols) * vw;
      const y = mr.top + ((j + 0.5) / rows) * (vh - mr.top);
      const el = document.elementFromPoint(x, y);
      samples += 1;
      if (!el || !modal.contains(el)) {
        offenders.push({ at: [Math.round(x), Math.round(y)], top: describe(el), inChat: !!(el && el.closest('.sc-root')) });
      }
    }
  }
  // L4 标题栏带
  const titleHit = document.elementFromPoint(vw / 2, Math.max(1, mr.top / 2));
  // L5 关闭按钮
  const closeBtn = modal.querySelector('[data-action="close-svg-editor"]');
  const cr = closeBtn ? closeBtn.getBoundingClientRect() : null;
  const closeHit = cr ? document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2) : null;
  // L6 viewer
  const bar = modal.firstElementChild;
  const viewer = modal.querySelector('[data-testid="svg-editor-viewer"]');
  // L7 分区几何
  const parts = {
    stage: viewer ? viewer.querySelector('[class*="_stage_"]') : null,
    layers: viewer ? viewer.querySelector('[class*="_layers_"]') : null,
    revision: viewer ? viewer.querySelector('[data-testid="svg-editor-revision-panel"]') : null,
    inspector: viewer ? viewer.querySelector('[data-testid="svg-editor-inspector"]') : null,
  };
  const partRects = {};
  for (const [k, el] of Object.entries(parts)) {
    if (el && getComputedStyle(el).display !== 'none') partRects[k] = rect(el);
  }
  // L8 接缝
  const seams = [...document.querySelectorAll('[class*="resizeHandleV"]')].map((el) => getComputedStyle(el).visibility);
  return {
    modalPresent: true,
    viewport: { vw, vh },
    modal: { rect: rect(modal), zIndex: mcs.zIndex, top: mcs.top },
    tokens: { zModal: rootCs.getPropertyValue('--petri-z-modal').trim(), titlebar: rootCs.getPropertyValue('--petri-titlebar-height').trim() },
    grid: { samples, offenders },
    titleBandTop: describe(titleHit),
    titleBandInModal: !!(titleHit && modal.contains(titleHit)),
    closeButton: cr ? { center: { x: cr.x + cr.width / 2, y: cr.y + cr.height / 2 }, hittable: !!(closeHit && (closeHit === closeBtn || closeBtn.contains(closeHit))) } : null,
    bar: rect(bar),
    viewer: viewer ? { rect: rect(viewer), position: getComputedStyle(viewer).position, expanded: viewer.getAttribute('data-expanded') } : null,
    parts: partRects,
    seamsVisibility: seams,
  };
}

function overlaps(a, b) {
  const eps = 0.5;
  return a.x < b.r - eps && b.x < a.r - eps && a.y < b.b - eps && b.y < a.b - eps;
}

function within(inner, outer) {
  const eps = 0.5;
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.r <= outer.r + eps && inner.b <= outer.b + eps;
}

async function main() {
  const targets = await fetchJson('http://127.0.0.1:' + DEBUG_PORT + '/json');
  const page = targets.find((t) => t.type === 'page' && /\/project\//.test(t.url || ''));
  if (!page) throw new Error('workspace_page_target_not_found');

  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Runtime.enable');
  await client.send('Page.enable');

  const checks = [];
  const check = (name, pass, detail) => {
    checks.push({ name, pass, detail });
    console.log((pass ? 'PASS ' : 'FAIL ') + name + ' :: ' + detail);
  };

  const closed = await evalFn(client, pageClosedState);
  if (!closed.precondition) {
    throw new Error('precondition_missing: 右栏未预览 .svg（找不到「在编辑器打开」）');
  }
  check('L1a thumb button hittable (closed)', closed.thumbHittable === true, String(closed.thumbHittable));
  check('L1b active right tab is not a stacking context', closed.activeTabZ === 'auto', 'zIndex=' + closed.activeTabZ);
  check('L1c seams visible+hittable (closed)', closed.seams.length > 0 && closed.seams.every((s) => s.visibility === 'visible' && s.hittable), JSON.stringify(closed.seams));

  await realClick(client, closed.openButton.x, closed.openButton.y);
  await delay(900);
  const open = await evalFn(client, pageOpenState);
  if (!open.modalPresent) throw new Error('modal_not_opened');

  check('L2a modal z-index = --petri-z-modal', open.modal.zIndex === open.tokens.zModal, open.modal.zIndex + ' vs ' + open.tokens.zModal);
  check('L2b modal top = --petri-titlebar-height', open.modal.top === open.tokens.titlebar, open.modal.top + ' vs ' + open.tokens.titlebar);
  check('L3 grid below title bar all inside modal', open.grid.offenders.length === 0,
    open.grid.samples + ' samples, offenders=' + JSON.stringify(open.grid.offenders.slice(0, 6)));
  check('L4 title band stays above modal (deliberate chrome)', open.titleBandInModal === false, open.titleBandTop);
  check('L5 close button hittable', !!(open.closeButton && open.closeButton.hittable), JSON.stringify(open.closeButton));
  const v = open.viewer;
  check('L6 viewer not fixed, below modal bar, inside modal',
    !!(v && v.position !== 'fixed' && v.rect.y >= open.bar.b - 0.5 && within(v.rect, open.modal.rect)),
    JSON.stringify({ viewer: v, barBottom: open.bar.b }));
  const names = Object.keys(open.parts);
  const overlapPairs = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      if (overlaps(open.parts[names[i]], open.parts[names[j]])) overlapPairs.push(names[i] + '×' + names[j]);
    }
  }
  const outside = names.filter((n) => v && !within(open.parts[n], v.rect));
  check('L7 editor parts no overlap & inside viewer', names.length > 0 && overlapPairs.length === 0 && outside.length === 0,
    JSON.stringify({ rendered: names, overlapPairs, outside }));
  check('L8 seams hidden while modal open', open.seamsVisibility.length > 0 && open.seamsVisibility.every((s) => s === 'hidden'), JSON.stringify(open.seamsVisibility));

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'modal-layer-open.png'), Buffer.from(shot.data, 'base64'));

  if (open.closeButton) await realClick(client, open.closeButton.center.x, open.closeButton.center.y);
  await delay(600);
  const after = await evalFn(client, pageClosedState);
  const modalGone = await evalFn(client, () => !document.querySelector('[data-testid="svg-editor-modal"]'));
  check('L9a real mouse click closes modal', modalGone === true, String(modalGone));
  check('L9b seams visible+hittable again', after.seams.length > 0 && after.seams.every((s) => s.visibility === 'visible' && s.hittable), JSON.stringify(after.seams));

  const allPass = checks.every((c) => c.pass);
  const evidence = {
    kind: 'ui668-modal-layer-live',
    capturedAt: new Date().toISOString(),
    debugPort: DEBUG_PORT,
    pageUrl: page.url,
    allPass,
    checks,
    closedBefore: closed,
    open,
    closedAfter: after,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'modal-layer-live.json'), JSON.stringify(evidence, null, 2));
  console.log('\nallPass=' + allPass + ' · evidence: acceptance/ui-668/modal-layer-live.json + modal-layer-open.png');
  client.close();
  process.exit(allPass ? 0 : 2);
}

main().catch((err) => {
  console.error('[ui668-modal-layer-live] ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
