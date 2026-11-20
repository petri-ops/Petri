#!/usr/bin/env node
'use strict';

/** P1 · 创建对话框（UI-304/326）+ 新建 Petri 主仓项目 + 审阅真实 diff（亮暗双态）。非产品代码。 */
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'p1-review-real';

(async () => {
  const c = await connect();
  await c.navigate('http://localhost:3000/project/p_mwnkhuj2_okzh');
  await sleep(1600);

  // ① 左栏「+」（UI-304 dialog-first）→ 创建对话框
  await c.evaluate(`(function(){
    const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '新建 SSH 远程项目')
      || [...document.querySelectorAll('[class*="projectTreeAddBtn"]')][0];
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(1200);
  await c.shot(outPath(ITEM, 'ui304-create-dialog.png'));
  const dialog = await c.evalJson(`(function(){
    const inputs = [...document.querySelectorAll('input')].filter(el => el.offsetParent).map(el => ({ ph: el.placeholder || '', type: el.type }));
    const tabs = [...document.querySelectorAll('button,[role="tab"]')].filter(el => el.offsetParent && /SSH|本地|手动|IP|密码|远程/.test(el.innerText || '')).map(el => (el.innerText || '').trim().slice(0, 12));
    return { inputCount: inputs.length, inputs: inputs.slice(0, 8), tabs: [...new Set(tabs)] };
  })()`);
  console.log('dialog:', JSON.stringify(dialog));
  if (dialog.inputCount === 0) { console.log('对话框未开（+ 按钮可能只新增目录）；截图留证后停'); writeJson(ITEM, 'findings.json', { legs: [{ id: 'ui304_create_dialog', pass: false, note: '+ 未触发对话框', detail: dialog }], file: 'ui304-create-dialog.png' }); c.close(); return; }
  const findings = { legs: [{ id: 'ui304_create_dialog', pass: true, detail: dialog, file: 'ui304-create-dialog.png', item: 'UI-304 创建 dialog-first 场景' }] };

  // ② UI-326：SSH/IP+密码模式
  const sshTab = dialog.tabs.find((t) => /SSH|IP|密码|远程/.test(t));
  if (sshTab) {
    await c.evaluate(`(function(){ const el = [...document.querySelectorAll('button,[role="tab"]')].find(x => x.offsetParent && (x.innerText || '').trim().startsWith(${JSON.stringify(sshTab)})); if (el) el.click(); })()`);
    await sleep(800);
    await c.shot(outPath(ITEM, 'ui326-ssh-mode.png'));
    const sshInputs = await c.evalJson(`(function(){ return [...document.querySelectorAll('input')].filter(el => el.offsetParent).map(el => el.placeholder || el.type).slice(0, 8); })()`);
    findings.legs.push({ id: 'ui326_ssh_mode', pass: sshInputs.length > 0, detail: { tab: sshTab, inputs: sshInputs }, file: 'ui326-ssh-mode.png', item: 'UI-326 创建面板 IP+密码连接模式' });
    console.log('ui326:', sshTab, JSON.stringify(sshInputs));
    await c.evaluate(`(function(){ const el = [...document.querySelectorAll('button,[role="tab"]')].find(x => x.offsetParent && /本地/.test(x.innerText || '')); if (el) el.click(); })()`);
    await sleep(600);
  }

  // ③ 取消 SSH 框 → 新建任务（工作台）→ 本地目录瓷砖 → 填路径 → 创建
  await c.evalJson(`(function(){ const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '取消' && x.offsetParent); if (b) b.click(); return !!b; })()`);
  await sleep(600);
  await c.evaluate(`(function(){ const b = [...document.querySelectorAll('[class*="_leftQuickAction_"]')].find(x => (x.innerText || '').includes('新建任务')); if (b) b.click(); })()`);
  await sleep(1800);
  await c.shot(outPath(ITEM, 'home-workbench-view.png'));
  const tile = await c.evalJson(`(function(){
    const el = [...document.querySelectorAll('button,[role="button"],div')].filter(x => x.offsetParent && /本地目录|本地路径|本地文件夹/.test(x.innerText || '') && (x.innerText || '').length < 80);
    if (el.length) { el[0].click(); return (el[0].innerText || '').slice(0, 24); }
    return null;
  })()`);
  console.log('local tile:', tile);
  await sleep(1200);
  await c.evalJson(`(function(){
    const input = [...document.querySelectorAll('input')].filter(el => el.offsetParent).find(el => /路径|path/i.test(el.placeholder || '') || el.type === 'text');
    if (!input) return 'no-input';
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '/Users/zhangdiandian/Documents/1.WorkDir/Petri');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  })()`);
  await sleep(900);
  const confirm = await c.evalJson(`(function(){
    const btns = [...document.querySelectorAll('button')].filter(el => el.offsetParent && !el.disabled && /创建|打开|确认|添加|开始/.test(el.innerText || ''));
    if (btns.length) { btns[0].click(); return (btns[0].innerText || '').trim(); }
    return null;
  })()`);
  console.log('confirm:', confirm);
  await sleep(5000);
  const after = await c.evalJson(`({ path: location.pathname, sample: document.body.innerText.slice(0, 140).replace(/\\n/g, '|') })`);
  findings.legs.push({ id: 'create_result', detail: { tile, confirm, after } });
  console.log('after create:', JSON.stringify(after));

  // ④ 审阅真实 diff
  await c.evaluate(`(function(){ const m = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '展开更多工具'); if (m) m.click(); })()`);
  await sleep(700);
  await c.evalJson(`(function(){ const items = [...document.querySelectorAll('button,[role="menuitem"],li,div')].filter(el => /^审阅$/.test((el.innerText || '').trim()) && (el.innerText || '').length <= 6 && el.offsetParent); if (items.length) items[0].click(); return items.length; })()`);
  await sleep(3500);
  const rev = await c.evalJson(`(function(){
    const cm = document.querySelector('.cm-editor');
    const changed = document.querySelectorAll('[class*="cm-changedLine"], [class*="cm-insertedLine"]').length;
    return { codeMirror: !!cm, cmChangedLines: changed, bodySample: document.body.innerText.slice(0, 180).replace(/\\n/g, '|') };
  })()`);
  console.log('review:', JSON.stringify(rev).slice(0, 240));
  findings.legs.push({ id: 'p1_review_real_diff', pass: rev.codeMirror === true && rev.cmChangedLines > 0, detail: rev, expectation: 'P1-1/P1-2' });

  // ⑤ 亮暗双态元素截图
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
  } else {
    findings.legs.push({ id: 'p1_light_dark', pass: false, note: 'cm-editor 矩形不可用（如实标注）' });
  }

  writeJson(ITEM, 'findings.json', findings);
  console.log('DONE legs=', findings.legs.length);
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
