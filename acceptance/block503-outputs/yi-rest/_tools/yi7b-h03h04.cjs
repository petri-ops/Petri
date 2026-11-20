#!/usr/bin/env node
'use strict';

/**
 * 乙7-B · H-03 暗色 hover 收敛 + H-04 selected 专用 token（非产品代码）。
 *
 * H-03：暗色下 5 类元件（图标钮/文本钮/输入/列表项/导航项）逐个真实 hover——元素截图 +
 *       computed bg 读数（同一 --petri-hover 档位核验）。主题经 data-theme 属性 live 切换（用后复原）。
 * H-04：指挥中心（/window/command-center，真实 jobs tiles）选中卡片（tileSelected 专用 token）
 *       在 5 accent × 明暗共 10 态逐张截图 + computed outline-color 读数。
 *       路线写 4 主题色，现选面板 5 档（teal/blue/violet/rose/amber，accents.ts）——按现面全量取材，差异如实登记。
 * 属性切换 = ThemeProvider/applyAccent 的同一 DOM 面；结束复原原值；零 CSS/组件写面；观感判定归用户。
 */
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'yi7b-h03h04';

(async () => {
  const c = await connect();
  const startUrl = c.page.url;
  const findings = { startUrl, legs: [] };

  const orig = await c.evalJson(`({ dataTheme: document.documentElement.getAttribute('data-theme') || 'light', dataAccent: document.documentElement.getAttribute('data-accent') || 'teal(默认=无属性)', vw: innerWidth })`);
  findings.original = orig;

  // ── H-03：暗色 5 类元件 hover ──
  try {
    await c.navigate(startUrl);
    await sleep(1200);
    await c.evaluate(`document.documentElement.setAttribute('data-theme', 'dark')`);
    await sleep(400);
    const kinds = [
      { id: 'iconButton', sel: '[aria-label="搜索会话标题"]' },
      { id: 'textButton', sel: '.sc-model-btn' },
      { id: 'input', sel: 'textarea' },
      { id: 'listItem', sel: '[class*="_convItem_"]' },
      { id: 'navItem', sel: '[class*="_leftQuickAction_"]' },
    ];
    const states = [];
    for (const k of kinds) {
      const idx = k.id === 'navItem' ? 1 : 0; // navItem 取「扩展」
      const rect = await c.evalJson(`(function(){
        const el = [...document.querySelectorAll(${JSON.stringify(k.sel)})][${idx}];
        if (!el) return null;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })()`);
      if (!rect) { states.push({ kind: k.id, missing: true }); continue; }
      // hover 前读数
      const before = await c.evalJson(`(function(){
        const el = [...document.querySelectorAll(${JSON.stringify(k.sel)})][${idx}];
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, hoverVar: cs.getPropertyValue('--petri-hover') || null };
      })()`);
      // 真实 hover（元素已在视口中央，鼠标移至中心）
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, button: 'none' });
      await sleep(250);
      const after = await c.evalJson(`(function(){
        const el = [...document.querySelectorAll(${JSON.stringify(k.sel)})][${idx}];
        const cs = getComputedStyle(el);
        return { bgHover: cs.backgroundColor, borderHover: cs.borderColor, hoverVar: cs.getPropertyValue('--petri-hover') || null };
      })()`);
      await c.cropFull(outPath(ITEM, `h03-dark-hover-${k.id}.png`), rect, 6);
      states.push({ kind: k.id, sel: k.sel, before, after, hoverChanged: before.bg !== after.bgHover, file: `h03-dark-hover-${k.id}.png` });
      console.log('h03', k.id, before.bg, '→', after.bgHover);
    }
    // 复原主题
    await c.evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(orig.dataTheme === 'light' ? 'light' : orig.dataTheme)})`);
    await sleep(300);
    const hoverVars = [...new Set(states.filter((s) => s.after).map((s) => s.after.hoverVar))];
    const hoverBgs = [...new Set(states.filter((s) => s.after && s.after.bgHover !== 'rgba(0, 0, 0, 0)').map((s) => s.after.bgHover))];
    findings.legs.push({
      id: 'h03_dark_hover_convergence',
      pass: states.filter((s) => !s.missing).length >= 4,
      detail: { states, hoverVarsInPlay: hoverVars, distinctHoverBgs: hoverBgs, criterion: '5 类悬停同一提亮档（--petri-hover 单一档位）；无灰 hover/层级倒挂观感归用户', theme: 'dark（live 属性切换，已复原）' },
    });
    console.log('ok h03');
  } catch (e) {
    await c.evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(orig.dataTheme)})`).catch(() => {});
    findings.legs.push({ id: 'h03_dark_hover_convergence', pass: null, error: e.message });
    console.log('ERR h03', e.message);
  }

  // ── H-04：指挥中心选中卡 × 5 accent × 明暗 ──
  try {
    await c.navigate('http://localhost:3000/window/command-center');
    await sleep(1800);
    const tileProbe = await c.evalJson(`(function(){
      const tiles = [...document.querySelectorAll('[class*="tile"]')].filter(el => el.offsetParent && el.getBoundingClientRect().width > 40);
      return { count: tiles.length, cls: tiles.length ? String(tiles[0].className).slice(0, 60) : null };
    })()`);
    if (tileProbe.count < 1) throw new Error(`指挥中心无 tiles（count=${tileProbe.count}）`);
    // 勾选第一个 history tile 的选择框（纯 UI 态，零数据变更；tile 本体点击=下钻，不能点）
    await c.clickEl('[data-testid="cc-tile-select"]', { index: 0 });
    await sleep(400);
    const selProbe = await c.evalJson(`(function(){
      const sel = document.querySelector('[class*="tileSelected"]');
      return { selected: !!sel, outline: sel ? getComputedStyle(sel).outline : null };
    })()`);
    if (!selProbe.selected) throw new Error('点击后无 tileSelected（选中态未触发）');

    const accents = [
      { id: 'teal', attr: null },
      { id: 'blue', attr: 'blue' },
      { id: 'violet', attr: 'violet' },
      { id: 'rose', attr: 'rose' },
      { id: 'amber', attr: 'amber' },
    ];
    const matrix = [];
    for (const theme of ['light', 'dark']) {
      await c.evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
      await sleep(250);
      for (const a of accents) {
        await c.evaluate(`(function(){ const html = document.documentElement; ${a.attr === null ? "html.removeAttribute('data-accent');" : `html.setAttribute('data-accent', '${a.attr}');`} })()`);
        await sleep(250);
        const read = await c.evalJson(`(function(){
          const sel = document.querySelector('[class*="tileSelected"]');
          if (!sel) return null;
          const cs = getComputedStyle(sel);
          const r = sel.getBoundingClientRect();
          return { outlineColor: cs.outlineColor, outlineWidth: cs.outlineWidth, accentAttr: document.documentElement.getAttribute('data-accent') || 'teal(默认=无属性)', rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
        })()`);
        if (!read) throw new Error(`${theme}/${a.id} 态丢失 tileSelected`);
        await c.cropFull(outPath(ITEM, `h04-selected-${a.id}-${theme}.png`), read.rect, 14);
        matrix.push({ accent: a.id, theme, outlineColor: read.outlineColor, outlineWidth: read.outlineWidth, file: `h04-selected-${a.id}-${theme}.png` });
        console.log('h04', a.id, theme, read.outlineColor);
      }
    }
    // 复原：accent/theme 原值
    await c.evaluate(`(function(){ const html = document.documentElement; ${orig.dataAccent === 'teal(默认=无属性)' ? "html.removeAttribute('data-accent');" : `html.setAttribute('data-accent', '${orig.dataAccent}');`} html.setAttribute('data-theme', ${JSON.stringify(orig.dataTheme)}); })()`);
    await sleep(300);
    const outlineColors = [...new Set(matrix.map((m) => m.outlineColor))];
    findings.legs.push({
      id: 'h04_selected_token_matrix',
      pass: matrix.length === 10,
      detail: { matrix, distinctOutlineColors: outlineColors, criterion: '选中态描边随 accent 且可辨识（专用 token --petri-selected-border；明暗成对派生）；无「选中=hover」混淆观感归用户', note: '路线写 4 主题色 × 明暗 8 态；现选面板 5 档 → 全量 10 态取材（漂移如实登记）', restore: `accent=${orig.dataAccent} / theme=${orig.dataTheme} 已复原` },
    });
    console.log('ok h04');
  } catch (e) {
    await c.evaluate(`(function(){ const html = document.documentElement; html.setAttribute('data-theme', ${JSON.stringify(orig.dataTheme)}); ${orig.dataAccent === 'teal(默认=无属性)' ? "html.removeAttribute('data-accent');" : `html.setAttribute('data-accent', '${orig.dataAccent}');`} })()`).catch(() => {});
    findings.legs.push({ id: 'h04_selected_token_matrix', pass: null, error: e.message });
    console.log('ERR h04', e.message);
  }

  await c.navigate(startUrl);
  await sleep(600);
  writeJson(ITEM, 'findings.json', findings);
  console.log('DONE legs=', findings.legs.length);
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
