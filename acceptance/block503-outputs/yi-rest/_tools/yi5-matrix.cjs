#!/usr/bin/env node
'use strict';

/**
 * 乙5 · C-53 P4 八态矩阵 12 人眼格证据（非产品代码）。
 *
 * 12 格 = 4 类元件（button/input/listItem/navItem）× 3 观感态（hover/active/focus-visible）。
 * 每格：默认态+触发态元素级截图 ×2 + DOM 读数（computed 样式/aria/focus-visible 布尔）。
 * 判据引用 = docs/ui-design-acceptance-checklist-v1.md §1；观感判定归用户，本脚本只产证据。
 */
const fs = require('node:fs');
const path = require('node:path');
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'yi5-matrix';
const SEL = {
  button: '[aria-label="搜索会话标题"]',
  buttonAriaPressed: '[class*="_projectTreeAddBtn_"][aria-pressed]',
  input: 'textarea',
  listItem: '[class*="_convItem_"]',
  listItemActive: '[class*="_convItemActive_"]',
  listItemPressedSafe: '[class*="_convItemActive_"]',
  navItem: '[class*="_leftQuickAction_"]',
  navItemActive: '[class*="_leftQuickActionActive_"]',
};

const results = [];
const push = (r) => { results.push(r); console.log(`${r.pass === false ? 'WARN' : 'ok  '} ${r.id}: ${r.note || ''}`); };

async function cellDefault(c, kind, sel, index = 0) {
  const rect = await c.shotEl(outPath(ITEM, `cell-${kind}-default.png`), sel, { index });
  return rect;
}

// 取矩形（scrollIntoView 一次定位）；hover 采集期间不再滚动，避免元素移位丢 hover
async function rectOf(c, sel, index = 0) {
  return c.evalJson(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})][${index}];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
}

async function shotRect(c, file, rect, pad = 3) {
  return c.cropFull(file, rect, pad);
}

// hover 全程一次定位：rect → 居中 hover → 截图 → 读数（鼠标保持不动）
async function hoverSequence(c, file, sel, index, props) {
  const rect = await rectOf(c, sel, index);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none' });
  await sleep(220);
  await shotRect(c, file, rect);
  const style = await readStyle(c, sel, index, props);
  return { rect, style };
}

async function readStyle(c, sel, index, props) {
  return c.evalJson(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})][${index}];
    if (!el) return null;
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of ${JSON.stringify(props)}) out[p] = cs.getPropertyValue(p);
    out.__hoverVar = cs.getPropertyValue('--petri-hover') || null;
    out.__tag = el.tagName;
    out.__cls = String(el.className).slice(0, 90);
    return out;
  })()`);
}

async function tabTo(c, sel, index, maxTabs = 120) {
  await c.evaluate(`(document.activeElement||document.body).blur && document.activeElement.blur()`);
  for (let i = 0; i < maxTabs; i += 1) {
    await c.pressTab();
    const hit = await c.evalJson(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})][${index}];
      if (!el) return { hit: false, exists: false };
      const ae = document.activeElement;
      return { hit: ae === el, fv: ae === el ? ae.matches(':focus-visible') : null, exists: true };
    })()`);
    if (hit.hit) return { reached: true, focusVisible: hit.fv, tabs: i + 1, method: 'real-tab-traversal' };
  }
  // fallback：1 次真实 Tab 建立键盘模态 → el.focus() 继承 modality → :focus-visible 生效（如实标注 method）
  await c.pressTab();
  const fb = await c.evalJson(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})][${index}];
    if (!el) return { ok: false };
    el.focus();
    return { ok: document.activeElement === el, fv: el.matches(':focus-visible') };
  })()`);
  return fb.ok ? { reached: true, focusVisible: fb.fv, tabs: maxTabs, method: 'tab-modality+focus-fallback' } : { reached: false, tabs: maxTabs };
}

(async () => {
  const c = await connect();
  const startUrl = c.page.url;
  const meta = { startUrl, cells: [] };

  // 状态自愈：点击类触发可能开浮层（如会话搜索）挤掉 textarea/会话行——缺了就重载复原
  const pressEscape = async () => {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(150);
  };
  const ensureHome = async () => {
    const probe = () => c.evalJson(`(() => {
      const ta = document.querySelector('textarea');
      const vis = (el) => !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
      return { ta: vis(ta), conv: [...document.querySelectorAll('[class*="_convItem_"]')].filter(vis).length, url: location.href };
    })()`);
    let ok = await probe();
    if (!ok.ta || ok.conv < 1 || !ok.url.includes('/project/')) {
      await c.navigate(startUrl);
      // 重载后 React 异步挂载：轮询至 textarea+会话行就位（最多 ~6s），不行再重载一次
      for (let i = 0; i < 12; i += 1) {
        await sleep(500);
        ok = await probe();
        if (ok.ta && ok.conv >= 1 && ok.url.includes('/project/')) return;
      }
      await c.navigate(startUrl);
      for (let i = 0; i < 12; i += 1) {
        await sleep(500);
        ok = await probe();
        if (ok.ta && ok.conv >= 1) return;
      }
    }
  };

  // ── button:hover ──
  try {
    const rect = await cellDefault(c, 'button', SEL.button);
    const def = await readStyle(c, SEL.button, 0, ['background-color', 'border-color', 'color']);
    const hovSeq = await hoverSequence(c, outPath(ITEM, 'cell-button-hover.png'), SEL.button, 0, ['background-color', 'border-color', 'color']);
    push({ id: 'button:hover', pass: def['background-color'] !== hovSeq.style['background-color'] || def['border-color'] !== hovSeq.style['border-color'], rect, def, hover: hovSeq.style, sel: SEL.button, criterion: '§1 hover：单一 --petri-hover 档' });
  } catch (e) { push({ id: 'button:hover', pass: null, error: e.message }); }

  // ── button:active（同元素按压视觉 + aria-pressed 机判证据） ──
  try {
    const p = await c.evalJson(`(() => {
      const el = document.querySelector(${JSON.stringify(SEL.button)});
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await c.mouseDown(p.x, p.y);
    await sleep(150);
    await c.shotEl(outPath(ITEM, 'cell-button-active-pressed.png'), SEL.button);
    const pressedStyle = await readStyle(c, SEL.button, 0, ['background-color', 'border-color']);
    await c.mouseUp(p.x, p.y);
    await pressEscape();
    const ariaEl = await c.evalJson(`(() => {
      const el = document.querySelector(${JSON.stringify(SEL.buttonAriaPressed)});
      return el ? { cls: String(el.className).slice(0, 70), ariaPressed: el.getAttribute('aria-pressed') } : null;
    })()`);
    push({ id: 'button:active', pass: true, pressedStyle, ariaPressedEvidence: ariaEl, sel: SEL.button, criterion: '§1 active/pressed：aria-pressed 或 data-state；按下态视觉', clickNote: 'mouseDown+Up 会真实点击「会话搜索」钮——已补 Escape 关浮层' });
  } catch (e) { push({ id: 'button:active', pass: null, error: e.message }); }

  // ── button:focus-visible ──
  try {
    const t = await tabTo(c, SEL.button, 0);
    if (t.reached) {
      const st = await readStyle(c, SEL.button, 0, ['outline-width', 'outline-style', 'outline-color', 'box-shadow']);
      const fv = await c.evalJson(`document.activeElement.matches(':focus-visible')`);
      await c.shotEl(outPath(ITEM, 'cell-button-focus-visible.png'), SEL.button);
      push({ id: 'button:focus-visible', pass: fv === true, tabs: t.tabs, focusVisible: fv, style: st, sel: SEL.button, criterion: '§1 focus-visible：键盘可见焦点（非 outline:none 裸删）' });
    } else { push({ id: 'button:focus-visible', pass: null, error: `Tab ${t.tabs} 次未达`, sel: SEL.button }); }
  } catch (e) { push({ id: 'button:focus-visible', pass: null, error: e.message }); }

  // ── input:hover ──
  try {
    await ensureHome();
    await c.shotEl(outPath(ITEM, 'cell-input-default.png'), SEL.input);
    const def = await readStyle(c, SEL.input, 0, ['border-color', 'box-shadow', 'background-color']);
    const hovSeq = await hoverSequence(c, outPath(ITEM, 'cell-input-hover.png'), SEL.input, 0, ['border-color', 'box-shadow', 'background-color']);
    // CSS 真源：simple-chat.css .sc-input 只有 :focus（2107）无 :hover 规则——零差异为真实读数，观感判定归用户
    push({ id: 'input:hover', pass: def['border-color'] !== hovSeq.style['border-color'] || def['box-shadow'] !== hovSeq.style['box-shadow'], def, hover: hovSeq.style, cssNote: 'simple-chat.css 无 .sc-input:hover 规则（仅 :focus §2107）——元素级 hover 零差异为真实读数', sel: SEL.input, criterion: '§1 hover：边框强调' });
  } catch (e) { push({ id: 'input:hover', pass: null, error: e.message }); }

  // ── input:active（聚焦环） ──
  try {
    await ensureHome();
    const p = await c.evalJson(`(() => {
      const el = document.querySelector(${JSON.stringify(SEL.input)});
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await c.mouseDown(p.x, p.y);
    await c.mouseUp(p.x, p.y);
    await sleep(200);
    const st = await readStyle(c, SEL.input, 0, ['outline-width', 'outline-style', 'outline-color', 'box-shadow', 'border-color']);
    const focusBool = await c.evalJson(`document.activeElement === document.querySelector(${JSON.stringify(SEL.input)})`);
    await c.shotEl(outPath(ITEM, 'cell-input-active-focus.png'), SEL.input);
    await c.evaluate(`document.activeElement && document.activeElement.blur()`);
    push({ id: 'input:active', pass: focusBool === true, focusBool, style: st, sel: SEL.input, criterion: '§1 active/pressed（输入）：聚焦环' });
  } catch (e) { push({ id: 'input:active', pass: null, error: e.message }); }

  // ── input:focus-visible ──
  try {
    await ensureHome();
    const t = await tabTo(c, SEL.input, 0, 60);
    if (t.reached) {
      const st = await readStyle(c, SEL.input, 0, ['outline-width', 'outline-style', 'outline-color', 'box-shadow']);
      await c.shotEl(outPath(ITEM, 'cell-input-focus-visible.png'), SEL.input);
      await c.evaluate(`document.activeElement && document.activeElement.blur()`);
      push({ id: 'input:focus-visible', pass: t.focusVisible === true, tabs: t.tabs, focusVisible: t.focusVisible, style: st, sel: SEL.input, criterion: '§1 focus-visible：键盘可见焦点' });
    } else { push({ id: 'input:focus-visible', pass: null, error: `Tab ${t.tabs} 次未达`, sel: SEL.input }); }
  } catch (e) { push({ id: 'input:focus-visible', pass: null, error: e.message }); }

  // ── listItem:hover（非激活会话行；只有 1 条会话则用项目树行） ──
  try {
    await ensureHome();
    let liSel = SEL.listItem; let liIdx = 0;
    const n = await c.evalJson(`document.querySelectorAll(${JSON.stringify(SEL.listItem)}).length`);
    if (n < 2) { liSel = '[class*="_projectTreeRow_"]:not([class*="Act"])'; liIdx = 0; }
    const rowInfo = await c.evalJson(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(liSel)})][${liIdx}];
      return el ? { cls: String(el.className).slice(0, 80), role: el.getAttribute('role'), tabindex: el.getAttribute('tabindex') } : null;
    })()`);
    await c.shotEl(outPath(ITEM, 'cell-listItem-default.png'), liSel, { index: liIdx });
    const def = await readStyle(c, liSel, liIdx, ['background-color', 'color']);
    await c.hoverEl(liSel, { index: liIdx });
    await c.shotEl(outPath(ITEM, 'cell-listItem-hover.png'), liSel, { index: liIdx });
    const hov = await readStyle(c, liSel, liIdx, ['background-color', 'color']);
    push({ id: 'listItem:hover', pass: def['background-color'] !== hov['background-color'], def, hover: hov, rowInfo, sel: liSel, criterion: '§1 hover：提亮不跳布局' });
  } catch (e) { push({ id: 'listItem:hover', pass: null, error: e.message }); }

  // ── listItem:active（已激活会话行 = aria/active 变体在场 + 按压） ──
  try {
    await ensureHome();
    const act = await c.evalJson(`(() => {
      const el = document.querySelector(${JSON.stringify(SEL.listItemActive)});
      return el ? { cls: String(el.className).slice(0, 90), role: el.getAttribute('role'), ariaCurrent: el.getAttribute('aria-current'), dataState: el.getAttribute('data-state') } : null;
    })()`);
    if (act) {
      const p = await c.evalJson(`(() => {
        const el = document.querySelector(${JSON.stringify(SEL.listItemPressedSafe)});
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      await c.mouseDown(p.x, p.y);
      await sleep(150);
      await c.shotEl(outPath(ITEM, 'cell-listItem-active-pressed.png'), SEL.listItemActive);
      const pressedStyle = await readStyle(c, SEL.listItemActive, 0, ['background-color']);
      await c.mouseUp(p.x, p.y);
      push({ id: 'listItem:active', pass: true, activeVariant: act, pressedStyle, sel: SEL.listItemActive, criterion: '§1 active/pressed：按下态 / aria-current' });
    } else push({ id: 'listItem:active', pass: null, error: '无激活会话行（_convItemActive 缺席）' });
  } catch (e) { push({ id: 'listItem:active', pass: null, error: e.message }); }

  // ── listItem:focus-visible ──
  try {
    await ensureHome();
    let liSel = SEL.listItem; let liIdx = 0;
    const n = await c.evalJson(`document.querySelectorAll(${JSON.stringify(SEL.listItem)}).length`);
    if (n < 2) { liSel = '[class*="_projectTreeRow_"]'; liIdx = 0; }
    const t = await tabTo(c, liSel, liIdx, 60);
    if (t.reached) {
      const st = await readStyle(c, liSel, liIdx, ['outline-width', 'outline-style', 'outline-color', 'box-shadow']);
      await c.shotEl(outPath(ITEM, 'cell-listItem-focus-visible.png'), liSel, { index: liIdx });
      push({ id: 'listItem:focus-visible', pass: t.focusVisible === true, tabs: t.tabs, focusVisible: t.focusVisible, style: st, sel: liSel, criterion: '§1 focus-visible：键盘可见焦点' });
    } else push({ id: 'listItem:focus-visible', pass: null, error: `Tab ${t.tabs} 次未达（行可能不可键盘聚焦=真实 a11y 读数）`, sel: liSel });
  } catch (e) { push({ id: 'listItem:focus-visible', pass: null, error: e.message }); }

  // ── navItem:hover ──
  try {
    const idx = 2; // 「知识空间」safe hover
    await c.shotEl(outPath(ITEM, 'cell-navItem-default.png'), SEL.navItem, { index: idx });
    const def = await readStyle(c, SEL.navItem, idx, ['background-color', 'color']);
    await c.hoverEl(SEL.navItem, { index: idx });
    await c.shotEl(outPath(ITEM, 'cell-navItem-hover.png'), SEL.navItem, { index: idx });
    const hov = await readStyle(c, SEL.navItem, idx, ['background-color', 'color']);
    push({ id: 'navItem:hover', pass: def['background-color'] !== hov['background-color'] || def['color'] !== hov['color'], def, hover: hov, sel: SEL.navItem, criterion: '§1 hover：提亮不跳布局' });
  } catch (e) { push({ id: 'navItem:hover', pass: null, error: e.message }); }

  // ── navItem:active（/extensions 四货架真 tabs：aria-selected + shelfTabActive） ──
  try {
    await c.navigate('http://localhost:3000/extensions');
    let tabs = null;
    for (let i = 0; i < 10 && !tabs; i += 1) {
      await sleep(300);
      tabs = await c.evalJson(`(() => {
        const els = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')];
        if (!els.length) return null;
        const active = els[0];
        const all = [...document.querySelectorAll('[role="tab"]')];
        return {
          active: { cls: String(active.className).slice(0, 90), text: (active.innerText || '').slice(0, 14), ariaSelected: active.getAttribute('aria-selected') },
          inactive: all.filter((el) => el.getAttribute('aria-selected') !== 'true').slice(0, 1).map((el) => ({ cls: String(el.className).slice(0, 90), text: (el.innerText || '').slice(0, 14) }))[0] || null,
          leftQuickAriaCurrent: [...document.querySelectorAll('[class*="leftQuickAction"]')].filter((el) => el.getAttribute('aria-current')).length,
        };
      })()`);
    }
    if (tabs) {
      await c.shotEl(outPath(ITEM, 'cell-navItem-active-tab.png'), '[role="tab"][aria-selected="true"]');
      const st = await readStyle(c, '[role="tab"][aria-selected="true"]', 0, ['background-color', 'color', 'border-color']);
      push({ id: 'navItem:active', pass: true, tabActive: tabs, style: st, sel: '[role="tab"][aria-selected="true"]', criterion: '§1 active/pressed：aria-current / 当前项可辨识', cssNote: '左栏 QuickActions isActive 恒 false（LeftPanel.tsx items mode:null）→ 导航项无 aria-current；active 判据由 /extensions 四货架真 tabs 承载' });
    } else push({ id: 'navItem:active', pass: null, error: '/extensions 上未发现 aria-selected=true tab（读数如实）' });
  } catch (e) { push({ id: 'navItem:active', pass: null, error: e.message }); }

  // ── navItem:focus-visible（当前 /extensions 页） ──
  try {
    const t = await tabTo(c, SEL.navItem, 2, 60);
    if (t.reached) {
      const st = await readStyle(c, SEL.navItem, 2, ['outline-width', 'outline-style', 'outline-color', 'box-shadow']);
      await c.shotEl(outPath(ITEM, 'cell-navItem-focus-visible.png'), SEL.navItem, { index: 2 });
      push({ id: 'navItem:focus-visible', pass: t.focusVisible === true, tabs: t.tabs, focusVisible: t.focusVisible, style: st, sel: SEL.navItem, criterion: '§1 focus-visible：键盘可见焦点' });
    } else push({ id: 'navItem:focus-visible', pass: null, error: `Tab ${t.tabs} 次未达`, sel: SEL.navItem });
  } catch (e) { push({ id: 'navItem:focus-visible', pass: null, error: e.message }); }

  // 复原：回起始页
  await c.navigate(startUrl);
  await sleep(400);

  meta.cells = results;
  meta.boundary = '只读观察+状态触发（hover/按压/键盘 Tab）；未改 CSS/配置/持久数据；观感判定归用户，Agent 不代签。';
  writeJson(ITEM, 'findings.json', meta);

  // 勾选表（判定列留用户）
  const lines = [
    '# 乙5 · P4 八态矩阵 12 人眼格勾选表（证据批 · 判定归用户）',
    '',
    `- 采集时间：${new Date().toISOString()}　页面：${startUrl}（dev Electron 可见窗 + CDP）`,
    '- 判据：docs/ui-design-acceptance-checklist-v1.md §1（八态×四类）；12 人眼格=4 类×{hover, active, focus-visible}（scripts/ui-design-a11y.mjs STATE_MATRIX terminal=done-partial 三态）',
    '- 每格证据：默认态+触发态元素级截图 ×2 + DOM 读数（findings.json）',
    '- **判定列留空——观感 verified/cancelled 由用户按 BLOCK-503 口令回填，Agent 零代签**',
    '',
    '| 格 | 判据（§1） | 截图 | 机械读数摘要 | 判定（用户填） |',
    '|---|---|---|---|---|',
  ];
  for (const r of results) {
    const shots = fs.readdirSync(outPath(ITEM, '')).filter((f) => f.startsWith(`cell-${r.id.replace(':', '-')}`)).map((f) => f).join(' + ') || '(见 findings)';
    const reading = r.error ? `⚠️ ${r.error}` : [
      r.def && r.hover ? `hover bg ${r.def['background-color']}→${r.hover['background-color']}` : '',
      r.focusVisible !== undefined ? `focus-visible=${r.focusVisible}(Tab×${r.tabs})` : '',
      r.ariaPressedEvidence ? `aria-pressed=${r.ariaPressedEvidence.ariaPressed}` : '',
      r.style ? `outline=${r.style['outline-width']}/${r.style['outline-style']}` : '',
    ].filter(Boolean).join('；');
    lines.push(`| ${r.id} | ${r.criterion || ''} | ${shots} | ${reading} | ______ |`);
  }
  lines.push('', 'G0 开发期常态 · 不外推 packaged/Provider/GA。', '');
  fs.writeFileSync(outPath(ITEM, 'matrix-checklist.md'), lines.join('\n'));
  console.log('DONE cells=', results.length);
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
