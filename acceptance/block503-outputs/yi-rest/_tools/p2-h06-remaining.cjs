#!/usr/bin/env node
'use strict';

/** P2 · H-06 剩余文件补腿尝试（knowledge/extensions/home/AnnotationBar）。非产品代码。 */
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'p2-h06-legs';

const SCAN = `(function(){
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
  for (const want of ${JSON.stringify(['components/knowledge/KnowledgeConsoleChat.module.css', 'pages/extensions/McpPolicyEditor.module.css', 'pages/extensions/styles.module.css', 'pages/home.module.css', 'components/annotations/AnnotationBar.module.css'])}) {
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
    const key = want.split('/').pop();
    if (cands.length) { cands[0].setAttribute('data-yi7c', 'yi7cTarget'); out[key] = { count: cands.length, marked: true }; }
    else out[key] = { count: 0, marked: false };
  }
  return out;
})()`;

(async () => {
  const c = await connect();
  const findings = { legs: [] };

  const scanPage = async (url, label) => {
    if (url) { await c.navigate(url); await sleep(2600); }
    const scan = await c.evalJson(SCAN);
    const results = [];
    for (const [fname, info] of Object.entries(scan)) {
      if (!info.marked) { results.push({ file: fname, missing: `${label} 页面倒排 0 命中（组件未挂载或样式未注入）` }); continue; }
      await c.pressTab();
      await c.evaluate(`document.querySelector('[data-yi7c="yi7cTarget"]').focus()`);
      await sleep(200);
      const fr = await c.evalJson(`(function(){ const el = document.querySelector('[data-yi7c="yi7cTarget"]'); const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const x = Math.max(0, r.x), y = Math.max(0, r.y); return { fv: el.matches(':focus-visible'), outline: cs.outlineWidth + '/' + cs.outlineStyle + '/' + cs.outlineColor, rect: { x, y, w: Math.min(r.right, innerWidth) - x, h: Math.min(r.bottom, innerHeight) - y } }; })()`);
      const png = `h06-${fname.replace('.module.css', '').replace('.css', '')}.png`;
      await c.cropFull(outPath(ITEM, png), fr.rect, 12);
      results.push({ file: fname, method: 'tab-modality+focus-fallback', ...fr, file: png });
      await c.evaluate(`document.querySelector('[data-yi7c="yi7cTarget"]').removeAttribute('data-yi7c')`).catch(() => {});
      await c.evaluate(`document.activeElement && document.activeElement.blur()`);
    }
    return results;
  };

  findings.legs.push(...await scanPage('http://localhost:3000/knowledge', 'knowledge'));
  findings.legs.push(...await scanPage('http://localhost:3000/extensions', 'extensions'));
  findings.legs.push(...await scanPage('http://localhost:3000/projects', 'projects'));

  writeJson(ITEM, 'findings.json', findings);
  console.log(JSON.stringify(findings.legs.map((l) => ({ file: l.file, r: l.method || l.missing, fv: l.fv, outline: l.outline })), null, 1));
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
