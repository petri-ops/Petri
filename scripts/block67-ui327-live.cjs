#!/usr/bin/env node
'use strict';
// UI-327 实机验证：左栏 globe → 行内向导（连接 → 浏览远端目录 → 创建项目 → 导航进入）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');
function fetchJson(url) { return new Promise((res, rej) => { http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
function req(url, opts = {}) { return new Promise((res, rej) => { const r = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (x) => { let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(d); } }); }); r.on('error', rej); if (opts.body) r.write(opts.body); r.end(); }); }
const ev = async (c, expr, to = 60000) => { const r = await Promise.race([c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), to))]); if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || '').slice(0, 250)); return r.result && r.result.value; };

(async () => {
  const EVIDENCE = path.join(__dirname, '..', 'acceptance', 'ui-327');
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [], allPass: false };
  const assert = (name, pass, detail = '') => { results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(detail).slice(0, 120)}`); };

  const targets = await fetchJson('http://127.0.0.1:9222/json');
  const c = await new CdpClient(targets[0].webSocketDebuggerUrl).connect();
  const errors = [];
  c.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push(String(p.args?.map((a) => a.value || a.description || '').join(' ')).slice(0, 120)); });

  // 前置：落地 /skills → shadow history.length → 「返回首页」PUSH 到工作台（isInitialEntry 教训）→ 进入任一项目（左栏在项目页才有）
  await c.send('Page.navigate', { url: 'http://localhost:3000/skills' });
  await new Promise((r) => setTimeout(r, 6000));
  await ev(c, `(async () => {
    try { Object.defineProperty(window.history, 'length', { get: () => 1, configurable: true }); } catch {}
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').includes('返回首页'));
    if (b) b.click();
    await new Promise((r) => setTimeout(r, 2500));
    return location.pathname;
  })()`);
  await c.send('Page.navigate', { url: 'http://localhost:3000/project/p_mtrawlau_7rly' });
  await new Promise((r) => setTimeout(r, 8000));

  // 起始 ssh 项目 id 集合（创建断言 = API 对账出现新 id）
  const before = await req('http://127.0.0.1:3001/api/data/projects', { headers: { Authorization: 'Bearer desktop-local' } });
  const beforeIds = new Set((before.projects || []).map((p) => p.id));

  const out = await ev(c, `(async () => {
    let globe=null;
    for(let i=0;i<25&&!globe;i++){
      globe=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'')==='新建 SSH 远程项目');
      if(!globe) await new Promise(r=>setTimeout(r,800));
    }
    if(!globe) return JSON.stringify({err:'NO_GLOBE',path:location.pathname});
    globe.click();
    await new Promise(r=>setTimeout(r,600));
    const panel=document.querySelector('[data-testid="left-ssh-create-panel"]');
    if(!panel) return JSON.stringify({err:'NO_PANEL'});
    const setVal=(label,v)=>{const input=panel.querySelector('input[aria-label="'+label+'"]');const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(input,v);input.dispatchEvent(new Event('input',{bubbles:true}));};
    setVal('SSH 主机别名','aliyun');
    const connectBtn=[...panel.querySelectorAll('button')].find(b=>b.textContent.trim()==='连接');
    connectBtn.click();
    for(let i=0;i<30;i++){
      await new Promise(r=>setTimeout(r,1000));
      const chip=panel.querySelector('[data-testid="ssh-connected-chip"]');
      if(chip&&!panel.textContent.includes('读取目录')){
        const dir=[...panel.querySelectorAll('[data-testid="ssh-dir-browser"] button')].find(b=>b.textContent.trim()==='gewu-block67-demo/');
        if(!dir) return JSON.stringify({step:'browse',err:'NO_DEMO_DIR',dirs:panel.textContent.slice(0,150)});
        dir.click();
        await new Promise(r=>setTimeout(r,2500));
        const sel=panel.querySelector('[data-testid="ssh-selected-path"]');
        return JSON.stringify({step:'pick',chip:chip.textContent.trim(),selected:sel?sel.textContent:''});
      }
    }
    return JSON.stringify({step:'connect',err:'browse timeout',text:panel.textContent.slice(0,150)});
  })()`, 120000);
  const s = JSON.parse(out);
  const step1ok = s.step === 'pick' && s.chip === 'aliyun';
  assert('向导① 连接主机（chip=aliyun）+ 进入浏览步', step1ok, out);
  assert('向导② 路径浏览进入 gewu-block67-demo', s.selected === '/root/gewu-block67-demo', String(s.selected));

  // 步骤③：点「在此目录创建项目」（页面留在向导上，创建结果走 API 对账 + 导航对账）
  await ev(c, `(async () => {
    const create=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='在此目录创建项目');
    if(create){ create.click(); }
    return 'clicked';
  })()`, 20000);
  let created = null;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = await req('http://127.0.0.1:3001/api/data/projects', { headers: { Authorization: 'Bearer desktop-local' } });
    const newSsh = (now.projects || []).find((p) => p.workspace_kind === 'ssh' && !beforeIds.has(p.id));
    if (newSsh) { created = newSsh; break; }
  }
  assert('向导③ 创建项目（API 对账：新 ssh 项目出现）', !!created, JSON.stringify(created && { id: created.id, name: created.name }));

  // 导航对账：窗口落在新建项目页
  let navigatedOk = false;
  if (created) {
    for (let i = 0; i < 15; i += 1) {
      const state = await ev(c, `location.pathname`, 15000).catch(() => '');
      if (String(state).includes(created.id)) { navigatedOk = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  assert('导航进入新建项目页', navigatedOk, created ? `expect /project/${created.id}` : 'no project');

  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE, 'ui327-wizard-live.png'), Buffer.from(shot.data, 'base64'));
  console.log('renderer errors:', errors.length);

  c.socket.close();
  const projects = await req('http://127.0.0.1:3001/api/data/projects', { headers: { Authorization: 'Bearer desktop-local' } });
  const mine = (projects.projects || []).filter((p) => p.workspace_kind === 'ssh' && !beforeIds.has(p.id));
  for (const p of mine) { await req('http://127.0.0.1:3001/api/data/projects/' + p.id, { method: 'DELETE', headers: { Authorization: 'Bearer desktop-local' } }); }
  console.log('cleaned probe projects:', mine.length);

  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE, 'ui327-live.json'), JSON.stringify(results, null, 2));
  console.log(results.allPass ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(results.allPass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
