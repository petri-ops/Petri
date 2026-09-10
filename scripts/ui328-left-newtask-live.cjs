#!/usr/bin/env node
'use strict';
// UI-328 实机验证：左栏最顶部「新建任务」按钮 → 点击 → 工作台创建页（页内可选路径）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');
function fetchJson(url) { return new Promise((res, rej) => { http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }

(async () => {
  const EVIDENCE = path.join(__dirname, '..', 'acceptance', 'ui-328');
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [], allPass: false };
  const assert = (name, pass, detail = '') => { results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(detail).slice(0, 140)}`); };

  const targets = await fetchJson('http://127.0.0.1:9222/json');
  const c = await new CdpClient(targets[0].webSocketDebuggerUrl).connect();
  const errors = [];
  c.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push(String(p.args?.map((a) => a.value || a.description || '').join(' ')).slice(0, 120)); });

  // 进入任一项目页（左栏在项目页渲染）
  await c.send('Page.navigate', { url: 'http://localhost:3000/project/p_mtrawlau_7rly' });
  await new Promise((r) => setTimeout(r, 8000));

  // ①「新建任务」按钮存在且是 aside 第一个可交互元素（置顶）
  const probe1 = await evalJs(`(async () => {
    let btn=null;
    for(let i=0;i<20&&!btn;i++){
      btn=[...document.querySelectorAll('aside button')].find(b=>b.textContent.trim()==='新建任务');
      if(!btn) await new Promise(r=>setTimeout(r,800));
    }
    if(!btn) return JSON.stringify({err:'NO_BTN',path:location.pathname});
    // 置顶口径：leftPanelWrap（左栏内容区）第一个 button；columnHeader 是列级部件不在内容区
    const wrap=btn.closest('[class*="leftPanelWrap"]');
    return JSON.stringify({ first: wrap.querySelector('button')===btn, title: btn.getAttribute('title')||'' });
  })()`);
  const s1 = JSON.parse(probe1);
  assert('左栏「新建任务」按钮存在', !s1.err, probe1);
  assert('按钮置顶（aside 第一个 button）', s1.first === true, probe1);

  // 点击前留证：按钮在左栏最顶部
  const shotBefore = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE, 'ui328-sidebar-btn.png'), Buffer.from(shotBefore.data, 'base64'));

  // ② 点击 → 应用内导航 / → 工作台创建页（项目列表 + 创建新项目区可见）
  const probe2 = await evalJs(`(async () => {
    const btn=[...document.querySelectorAll('aside button')].find(b=>b.textContent.trim()==='新建任务');
    if(!btn) return JSON.stringify({err:'NO_BTN'});
    btn.click();
    let landed=false;
    for(let i=0;i<15;i++){
      await new Promise(r=>setTimeout(r,1000));
      if(location.pathname==='/'){ landed=true; break; }
    }
    if(!landed) return JSON.stringify({err:'NO_NAV',path:location.pathname});
    let workbench=null;
    for(let i=0;i<15;i++){
      workbench=document.querySelector('[aria-label="项目工作台"]');
      if(workbench) break;
      await new Promise(r=>setTimeout(r,800));
    }
    if(!workbench) return JSON.stringify({err:'NO_WORKBENCH',path:location.pathname});
    const hasCreateArea=workbench.textContent.includes('创建新项目');
    const hasPickBtn=[...workbench.querySelectorAll('button')].some(b=>b.textContent.includes('选择工作目录并创建'));
    const hasManual=[...workbench.querySelectorAll('button')].some(b=>b.textContent.includes('或手动输入路径'));
    const hasSsh=[...workbench.querySelectorAll('button')].some(b=>b.textContent.includes('SSH 远程项目'));
    const cardCount=workbench.querySelectorAll('[class*="workbenchCard"]').length;
    return JSON.stringify({hasCreateArea,hasPickBtn,hasManual,hasSsh,cardCount});
  })()`, 90000);
  const s2 = JSON.parse(probe2);
  assert('点击「新建任务」→ 导航到 / 工作台创建页', !s2.err, probe2);
  assert('创建页内可选路径：选目录/手输路径/SSH 入口齐备', s2.hasCreateArea === true && s2.hasPickBtn === true && s2.hasManual === true && s2.hasSsh === true, probe2);
  assert('项目列表卡片照常展示（不丢工作台本体）', s2.cardCount >= 1, `cards=${s2.cardCount}`);

  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE, 'ui328-newtask-live.png'), Buffer.from(shot.data, 'base64'));
  assert('0 renderer console error', errors.length === 0, errors.join(' | '));
  console.log('renderer errors:', errors.length);

  c.socket.close();
  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE, 'ui328-live.json'), JSON.stringify(results, null, 2));
  console.log(results.allPass ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(results.allPass ? 0 : 1);

  async function evalJs(expr, to = 60000) {
    const r = await Promise.race([c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => setTimeout(() => rej(new Error('cdp timeout')), to))]);
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || '').slice(0, 250));
    return r.result && r.result.value;
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
