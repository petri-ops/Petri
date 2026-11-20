#!/usr/bin/env node
'use strict';

/** P1c · 新 Petri 项目审阅面：真实 diff 亮暗双态 + H-06 审阅三件 + UI-200。非产品代码。 */
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'p1-review-real';
const PROJ = 'http://localhost:3000/project/p_mwo92wsv_x90e';

(async () => {
  const c = await connect();
  await c.navigate(PROJ);
  await sleep(2500);
  const findings = { legs: [], projectUrl: PROJ };

  // 审阅 tab
  await c.evaluate(`(function(){ const m = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '展开更多工具'); if (m) m.click(); })()`);
  await sleep(800);
  await c.evalJson(`(function(){ const items = [...document.querySelectorAll('button,[role="menuitem"],li,div')].filter(el => /^审阅$/.test((el.innerText || '').trim()) && (el.innerText || '').length <= 6 && el.offsetParent); if (items.length) items[0].click(); return items.length; })()`);
  await sleep(4500);
  const rev = await c.evalJson(`(function(){
    const cm = document.querySelector('.cm-editor');
    const changed = document.querySelectorAll('[class*="cm-changedLine"], [class*="cm-insertedLine"]').length;
    const fileList = [...document.querySelectorAll('[class*="odeReviewDrawer"] [class*="file"], [class*="eviewMode"] [class*="file"]')].filter(el => el.offsetParent).length;
    return { codeMirror: !!cm, cmChangedLines: changed, reviewFileEls: fileList, bodySample: document.body.innerText.slice(0, 240).replace(/\\n/g, '|') };
  })()`);
  console.log('review:', JSON.stringify(rev).slice(0, 320));
  findings.legs.push({ id: 'p1_review_real_diff', pass: rev.codeMirror === true && rev.cmChangedLines > 0, detail: rev, expectation: 'P1-1/P1-2' });

  // 亮暗双态（diff 区元素裁剪）
  const cmRect = await c.evalJson(`(function(){ const el = document.querySelector('.cm-editor'); if (!el) return null; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); const x = Math.max(0, r.x), y = Math.max(0, r.y); return { x, y, w: Math.min(r.right, innerWidth) - x, h: Math.min(r.bottom, innerHeight) - y }; })()`);
  if (cmRect && cmRect.w > 60 && cmRect.h > 40) {
    await c.cropFull(outPath(ITEM, 'ui200-codemirror-diff-light.png'), cmRect, 6);
    const themeBefore = await c.evalJson(`document.documentElement.getAttribute('data-theme') || 'light'`);
    await c.evaluate(`document.documentElement.setAttribute('data-theme', 'dark')`);
    await sleep(450);
    await c.cropFull(outPath(ITEM, 'ui200-codemirror-diff-dark.png'), cmRect, 6);
    await c.evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(themeBefore)})`);
    await sleep(250);
    findings.legs.push({ id: 'p1_light_dark', pass: true, files: ['ui200-codemirror-diff-light.png', 'ui200-codemirror-diff-dark.png'], expectation: 'P1-3' });
    console.log('light/dark captured');
  } else {
    await c.shot(outPath(ITEM, 'review-fallback-full.png'));
    findings.legs.push({ id: 'p1_light_dark', pass: false, note: 'cm-editor 不可用，全页 fallback 截图' });
  }

  // H-06 审阅三件：倒排映射焦点扫描（drawer 已挂载）
  const scan = await c.evalJson(`(function(){
    const styleFile = new Map();
    const hashRe = /_([A-Za-z0-9_]+)_([a-z0-9]{5})_\\d+/g;
    const clsRe = /\\.([A-Za-z][A-Za-z0-9_-]*)\\s*[,{}]/g;
    for (const s of document.querySelectorAll('style')) {
      const devId = (s.dataset && s.dataset.viteDevId) || '';
      if (!devId) continue;
      if (devId.includes('.module.css')) {
        for (const m of s.textContent.matchAll(hashRe)) { if (!styleFile.has(m[2])) styleFile.set(m[2], devId); }
      } else {
        for (const m of s.textContent.matchAll(clsRe)) { if (!styleFile.has(m[1])) styleFile.set(m[1], devId); }
      }
    }
    const tabbable = (el) => {
      if (!el || !el.offsetParent) return false;
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return !el.disabled;
      const ti = el.getAttribute('tabindex');
      return ti !== null && Number(ti) >= 0;
    };
    const out = {};
    for (const want of ['components/desktop/WorkingTreeReview/CodeReviewDrawer.module.css', 'components/desktop/WorkingTreeReview/ReviewMode.css', 'components/editor/CodeMirror/CodeMirrorEditor.module.css']) {
      const cands = [];
      for (const el of document.querySelectorAll('button,a,input,textarea,select,[tabindex]')) {
        if (!tabbable(el)) continue;
        const cls = String(el.className || '');
        for (const token of cls.split(/\\s+/)) {
          let owner = styleFile.get(token);
          if (!owner) { const hm = token.match(/_([a-z0-9]{5})_\\d+$/); if (hm) owner = styleFile.get(hm[1]); }
          if (owner && owner.includes(want)) { cands.push(el); break; }
        }
      }
      if (cands.length) {
        cands[0].setAttribute('data-yi7c', 'yi7cTarget');
        out[want.split('/').pop()] = { count: cands.length, marked: true };
      } else out[want.split('/').pop()] = { count: 0, marked: false };
    }
    return out;
  })()`);
  console.log('h06 drawer files:', JSON.stringify(scan));
  const h06 = [];
  for (const [fname, info] of Object.entries(scan)) {
    if (!info.marked) { h06.push({ file: fname, missing: '审阅面内无可聚焦归属元素' }); continue; }
    await c.pressTab();
    await c.evaluate(`document.querySelector('[data-yi7c="yi7cTarget"]').focus()`);
    await sleep(200);
    const fr = await c.evalJson(`(function(){ const el = document.querySelector('[data-yi7c="yi7cTarget"]'); const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const x = Math.max(0, r.x), y = Math.max(0, r.y); return { fv: el.matches(':focus-visible'), outline: cs.outlineWidth + '/' + cs.outlineStyle + '/' + cs.outlineColor, rect: { x, y, w: Math.min(r.right, innerWidth) - x, h: Math.min(r.bottom, innerHeight) - y }, cls: String(el.className).slice(0, 50) }; })()`);
    const png = `h06-${fname.replace('.module.css', '').replace('.css', '')}.png`;
    await c.cropFull(outPath('p2-h06-legs', png), fr.rect, 12);
    h06.push({ file: fname, method: 'tab-modality+focus-fallback', ...fr, file: png });
    await c.evaluate(`document.querySelector('[data-yi7c="yi7cTarget"]').removeAttribute('data-yi7c')`).catch(() => {});
    await c.evaluate(`document.activeElement && document.activeElement.blur()`);
  }
  findings.legs.push({ id: 'h06_review_three', results: h06, expectation: 'P2' });

  writeJson(ITEM, 'findings.json', findings);
  console.log('DONE legs=', findings.legs.length);
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
