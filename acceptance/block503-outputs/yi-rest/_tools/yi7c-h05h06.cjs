#!/usr/bin/env node
'use strict';

/**
 * 乙7-C · H-05 WCAG 三级文字对比度 + H-06 focus-visible 12 缺口文件（非产品代码）。
 *
 * H-05：亮色下真实三级文字样本（时间戳/占位符/meta 等）——computed color + 有效表面色 +
 *       JS 复算对比度 + 元素截图。路线判据 4.40:1 处是否需调色=人判定。
 * H-06：12 个 focus-gap 文件（P4 snapshot FOCUS_GAP_BASELINE）——vite dev-id 反查各文件
 *       CSS-module hash → 页面上该文件样式的可聚焦元素 → Tab 遍历（60 步）或 focus-fallback
 *       （如实标注 method）→ :focus-visible 布尔 + computed outline + 元素截图。
 *       VoiceOver 朗读部分 Agent 不可得，留真人（路线原文要求）。
 */
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'yi7c-h05h06';

// 12 个 focus-gap 文件 → 页面与反查（dev-id 用文件名片段匹配）
const GAP_FILES = [
  { file: 'components/annotations/AnnotationBar.module.css', page: 'project', n: 1 },
  { file: 'components/desktop/desktop.css', page: 'project', n: 2 },
  { file: 'components/desktop/WorkingTreeReview/CodeReviewDrawer.module.css', page: 'review', n: 2 },
  { file: 'components/desktop/WorkingTreeReview/ReviewMode.css', page: 'review', n: 1 },
  { file: 'components/editor/CodeMirror/CodeMirrorEditor.module.css', page: 'review', n: 1 },
  { file: 'components/knowledge/KnowledgeConsoleChat.module.css', page: 'knowledge', n: 1 },
  { file: 'components/workspace-panels/KnowledgeSpacePanel.module.css', page: 'knowledge', n: 1 },
  { file: 'pages/extensions/McpPolicyEditor.module.css', page: 'extensions', n: 1 },
  { file: 'pages/extensions/styles.module.css', page: 'extensions', n: 2 },
  { file: 'pages/home.module.css', page: 'projects', n: 1 },
  { file: 'pages/welcome.module.css', page: 'home', n: 2 },
  { file: 'pages/window/command-center.module.css', page: 'command-center', n: 1 },
];

const PAGES = {
  project: null, // 保持当前项目页
  review: null, // 项目页内开右栏审阅
  extensions: 'http://localhost:3000/extensions',
  knowledge: 'http://localhost:3000/knowledge',
  home: 'http://localhost:3000/',
  'command-center': 'http://localhost:3000/window/command-center',
};

(async () => {
  const c = await connect();
  const startUrl = c.page.url;
  const findings = { startUrl, legs: [] };

  // ── H-05：三级文字对比度样本 ──
  try {
    const samples = [
      { id: 'convItemTime', sel: '[class*="_convItemTime_"]' },
      { id: 'composerPlaceholder', sel: 'textarea::placeholder', usePseudo: true },
      { id: 'exampleCardSub', sel: '[class*="sc-example-card"] p, .sc-example-card small, .sc-example-card span', pick: 1 },
      { id: 'leftFooter', sel: '[class*="_leftFooterRow_"] *', pick: 0 },
      { id: 'emptyStateHint', sel: '[class*="empty"] p, [class*="EmptyState"] *, .sc-example-card div', pick: 2 },
    ];
    const rows = [];
    for (const s of samples) {
      const read = await c.evalJson(`(function(){
        const lum = (rgbStr) => {
          const m = rgbStr && rgbStr.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
          if (!m) return null;
          const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]);
        };
        const ratio = (c1, c2) => { const l1 = lum(c1), l2 = lum(c2); if (l1 === null || l2 === null) return null; return ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)); };
        const effBg = (el) => { let n = el; while (n && n !== document.documentElement) { const bg = getComputedStyle(n).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg; n = n.parentElement; } return getComputedStyle(document.body).backgroundColor; };
        ${s.usePseudo ? `
        const el = document.querySelector(${JSON.stringify(s.sel.split('::')[0])});
        if (!el) return null;
        const color = getComputedStyle(el, '::placeholder').color;
        const bg = effBg(el);
        const r = el.getBoundingClientRect();
        const fs = getComputedStyle(el).fontSize;
        return { color, bg, ratio: ratio(color, bg), fontSize: fs, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, text: el.placeholder || '' };` : `
        const els = [...document.querySelectorAll(${JSON.stringify(s.sel)})].filter(el => el.offsetParent);
        const el = els[${s.pick || 0}] || els[0];
        if (!el) return null;
        const color = getComputedStyle(el).color;
        const bg = effBg(el);
        const r = el.getBoundingClientRect();
        const fs = getComputedStyle(el).fontSize;
        return { color, bg, ratio: ratio(color, bg), fontSize: fs, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, text: (el.innerText || '').slice(0, 30) };`}
      })()`);
      if (!read) { rows.push({ id: s.id, missing: true }); continue; }
      await c.cropFull(outPath(ITEM, `h05-tertiary-${s.id}.png`), read.rect, 8);
      rows.push({ id: s.id, ...read, file: `h05-tertiary-${s.id}.png`, belowAA: read.ratio !== null && read.ratio < 4.5 });
      console.log('h05', s.id, read.color, 'on', read.bg, '=', read.ratio && read.ratio.toFixed(2));
    }
    findings.legs.push({
      id: 'h05_tertiary_contrast',
      pass: rows.filter((r) => !r.missing).length >= 3,
      detail: { rows, criterion: '路线判据：4.40:1（<4.5，大字 3:1 适用）处是否影响阅读/是否需调色=人判定；机械部分=逐样本 ratio 读数', theme: 'light' },
    });
    console.log('ok h05');
  } catch (e) { findings.legs.push({ id: 'h05_tertiary_contrast', pass: null, error: e.message }); console.log('ERR h05', e.message); }

  // ── H-06：12 缺口文件焦点遍历 ──
  try {
    const pageResults = [];
    for (const gap of GAP_FILES) {
      const url = PAGES[gap.page];
      if (url) { await c.navigate(url); await sleep(1300); }
      else if (gap.page === 'review') {
        // 项目页右栏开审阅 tab：已有审阅元素→点之；否则经「展开更多工具」菜单找审阅项
        const opened = await c.evalJson(`(function(){
          let items = [...document.querySelectorAll('button,[role="menuitem"],div[role="button"]')].filter(el => /^审阅$|^审阅\b/.test((el.innerText || '').trim()) && (el.innerText || '').length < 24);
          if (items.length) { items[0].click(); return 'direct'; }
          const more = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '展开更多工具');
          if (!more) return 'no-more-btn';
          more.click();
          return 'menu-opened';
        })()`);
        await sleep(900);
        if (opened === 'menu-opened') {
          await c.evalJson(`(function(){ const items = [...document.querySelectorAll('button,[role="menuitem"],li,div')].filter(el => /^审阅$|^审阅\b/.test((el.innerText || '').trim()) && (el.innerText || '').length < 24 && el.offsetParent); if (items.length) { items[0].click(); return true; } return false; })()`);
          await sleep(1500);
        }
        const drawerCheck = await c.evalJson(`(function(){ return { drawer: !!document.querySelector('[class*="odeReviewDrawer"], [class*="eviewMode"]'), any: [...document.querySelectorAll('[class*="eview"]')].length }; })()`);
        if (!drawerCheck.drawer && drawerCheck.any < 3) { pageResults.push({ file: gap.file, page: gap.page, missing: `审阅面未打开（flow=${opened}，drawer 探测 ${JSON.stringify(drawerCheck)}；如实标注）` }); continue; }
      }
      const scan = await c.evalJson(`(function(){
        // 倒排映射：全部 style tag（vite dev-id → 所属文件）收集类 token（module=hash，纯 css=类名）；
        // 对页面每个可聚焦元素反查其 class token 归属文件 → 命中缺口文件者入选
        const styleFile = new Map();
        const hashRe = /_([A-Za-z0-9_]+)_([a-z0-9]{5})_\\d+/g;
        const clsRe = /\.([A-Za-z][A-Za-z0-9_-]*)\\s*[,{}]/g;
        for (const s of document.querySelectorAll('style')) {
          const devId = (s.dataset && s.dataset.viteDevId) || '';
          if (!devId) continue;
          if (devId.includes('.module.css')) {
            for (const m of s.textContent.matchAll(hashRe)) {
              if (!styleFile.has(m[2])) styleFile.set(m[2], devId);
            }
          } else {
            for (const m of s.textContent.matchAll(clsRe)) {
              if (!styleFile.has(m[1])) styleFile.set(m[1], devId);
            }
          }
        }
        const tabbable = (el) => {
          if (!el || !el.offsetParent) return false;
          const tag = el.tagName;
          if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return !el.disabled;
          const ti = el.getAttribute('tabindex');
          return ti !== null && Number(ti) >= 0;
        };
        const want = ${JSON.stringify(gap.file)};
        const candidates = [];
        for (const el of document.querySelectorAll('button,a,input,textarea,select,[tabindex]')) {
          if (!tabbable(el)) continue;
          const cls = String(el.className || '');
          for (const token of cls.split(/\\s+/)) {
            let owner = styleFile.get(token);
            if (!owner) {
              const hm = token.match(/_([a-z0-9]{5})_\\d+$/);
              if (hm) owner = styleFile.get(hm[1]);
            }
            if (owner && owner.includes(want)) { candidates.push(el); break; }
          }
        }
        if (!candidates.length) return { focusableEls: 0, marked: false, styleFiles: styleFile.size };
        candidates[0].setAttribute('data-yi7c', 'yi7cTarget');
        return { focusableEls: candidates.length, marked: true };
      })()`);
      if (!scan.marked) { pageResults.push({ file: gap.file, page: gap.page, missing: `无该文件样式的可聚焦元素（倒排反查 0 命中；页面 styleFiles=${scan.styleFiles}）` }); continue; }

      // Tab 遍历（60 步上限）找目标；不达则 focus-fallback（键盘模态）
      let reached = null;
      await c.evaluate(`(document.activeElement||document.body).blur && document.activeElement.blur()`);
      for (let i = 0; i < 60; i += 1) {
        await c.pressTab();
        const hit = await c.evalJson(`(() => { const el = document.querySelector('[data-yi7c="yi7cTarget"]'); return { hit: document.activeElement === el }; })()`);
        if (hit.hit) { reached = { method: 'real-tab-traversal', tabs: i + 1 }; break; }
      }
      if (!reached) {
        await c.pressTab();
        await c.evaluate(`document.querySelector('[data-yi7c="yi7cTarget"]').focus()`);
        reached = { method: 'tab-modality+focus-fallback', tabs: 60 };
      }
      await sleep(250);
      const focusRead = await c.evalJson(`(function(){
        const el = document.querySelector('[data-yi7c="yi7cTarget"]');
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          focusVisible: el.matches(':focus-visible'),
          outline: cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor,
          boxShadow: (cs.boxShadow || '').slice(0, 60),
          tag: el.tagName,
          cls: String(el.className).slice(0, 60),
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          ariaLabel: el.getAttribute('aria-label') || null,
        };
      })()`);
      const fname = `h06-${gap.file.split('/').pop().replace('.css', '')}.png`;
      await c.cropFull(outPath(ITEM, fname), focusRead.rect, 12);
      pageResults.push({ file: gap.file, page: gap.page, gapDeclarations: gap.n, ...reached, ...focusRead, file: fname });
      console.log('h06', gap.file.split('/').pop(), reached.method, 'fv=', focusRead.focusVisible, focusRead.outline);
      await c.evaluate(`document.querySelector('[data-yi7c="yi7cTarget"]').removeAttribute('data-yi7c')`).catch(() => {});
    }
    const reachedCount = pageResults.filter((r) => r.method).length;
    findings.legs.push({
      id: 'h06_focus_visible_12files',
      pass: reachedCount >= 8,
      detail: { results: pageResults, reachedCount, criterion: '焦点环可见（:focus-visible + outline 非裸删）；DOM 顺序与朗读标签机械读数在案；VoiceOver 朗读=留真人（路线原文）', note: 'review 页=右栏审阅 tab best-effort；AnnotationBar 在 artifact 视图，无 artifact 时如实标注' },
    });
    console.log('ok h06 reached=', reachedCount);
  } catch (e) { findings.legs.push({ id: 'h06_focus_visible_12files', pass: null, error: e.message }); console.log('ERR h06', e.message); }

  await c.navigate(startUrl);
  await sleep(600);
  writeJson(ITEM, 'findings.json', findings);
  console.log('DONE legs=', findings.legs.length);
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
