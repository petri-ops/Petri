#!/usr/bin/env node
'use strict';

/** P1b · /projects 手动路径建项（真实 Petri 仓）→ 审阅真实 diff → 亮暗双态。非产品代码。 */
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'p1-review-real';
const REPO = '/Users/zhangdiandian/Documents/1.WorkDir/Petri';

(async () => {
  const c = await connect();
  await c.navigate('http://localhost:3000/projects');
  await sleep(2000);

  // ① 手动输入路径
  await c.evaluate(`(function(){
    const btn = [...document.querySelectorAll('button')].find(b => b.offsetParent && /手动输入路径/.test(b.innerText || ''));
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(800);
  await c.evalJson(`(function(){
    const input = [...document.querySelectorAll('input')].filter(el => el.offsetParent).find(el => /路径|path/i.test(el.placeholder || ''));
    if (!input) return 'no-path-input';
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(REPO)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  })()`);
  await sleep(700);
  await c.shot(outPath(ITEM, 'manual-path-filled.png'));

  // ② 创建/确认按钮
  const confirm = await c.evalJson(`(function(){
    const btns = [...document.querySelectorAll('button')].filter(el => el.offsetParent && !el.disabled && /创建|打开|确认|添加/.test(el.innerText || ''));
    if (btns.length) { const t = (btns[0].innerText || '').trim(); btns[0].click(); return t; }
    return null;
  })()`);
  console.log('confirm:', confirm);
  await sleep(6000);
  const after = await c.evalJson(`({ path: location.pathname, sample: document.body.innerText.slice(0, 160).replace(/\\n/g, '|') })`);
  console.log('after:', JSON.stringify(after));

  // ③ 若落在项目工作区 → 开审阅
  if (!String(after.path).includes('/project/')) {
    // 尝试从项目树点第一个匹配 Petri 主仓的项
    await c.evalJson(`(function(){ const b = [...document.querySelectorAll('[class*="_leftQuickAction_"]')].find(x => (x.innerText || '').includes('新建任务')); return !!b; })()`);
  }
  await c.evaluate(`(function(){ const m = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '展开更多工具'); if (m) m.click(); })()`);
  await sleep(700);
  await c.evalJson(`(function(){ const items = [...document.querySelectorAll('button,[role="menuitem"],li,div')].filter(el => /^审阅$/.test((el.innerText || '').trim()) && (el.innerText || '').length <= 6 && el.offsetParent); if (items.length) items[0].click(); return items.length; })()`);
  await sleep(4000);
  const rev = await c.evalJson(`(function(){
    const cm = document.querySelector('.cm-editor');
    const changed = document.querySelectorAll('[class*="cm-changedLine"], [class*="cm-insertedLine"]').length;
    const fileRows = [...document.querySelectorAll('[class*="review"], [class*="Review"]')].filter(el => el.offsetParent).length;
    return { codeMirror: !!cm, cmChangedLines: changed, reviewEls: fileRows, path: location.pathname, bodySample: document.body.innerText.slice(0, 200).replace(/\\n/g, '|') };
  })()`);
  console.log('review:', JSON.stringify(rev).slice(0, 300));
  const findings = { legs: [
    { id: 'manual_path_create', detail: { confirm, after }, pass: String(after.path).includes('/project/') },
    { id: 'p1_review_real_diff', pass: rev.codeMirror === true && rev.cmChangedLines > 0, detail: rev, expectation: 'P1-1/P1-2' },
  ] };

  // ④ 亮暗双态
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
  }
  await c.shot(outPath(ITEM, 'review-real-full.png'));
  writeJson(ITEM, 'findings.json', findings);
  console.log('DONE legs=', findings.legs.length);
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
