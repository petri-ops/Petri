#!/usr/bin/env node
'use strict';
// UI-329 实机验证：右栏空态 launchpad 卡片背景收窄（fit-content）+ 格内居中
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');
function fetchJson(url) { return new Promise((res, rej) => { http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }

(async () => {
  const EVIDENCE = path.join(__dirname, '..', 'acceptance', 'ui-329');
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [], allPass: false };
  const assert = (name, pass, detail = '') => { results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(detail).slice(0, 140)}`); };

  const targets = await fetchJson('http://127.0.0.1:9222/json');
  const c = await new CdpClient(targets[0].webSocketDebuggerUrl).connect();
  const errors = [];
  c.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push(String(p.args?.map((a) => a.value || a.description || '').join(' ')).slice(0, 120)); });

  await c.send('Page.navigate', { url: 'http://localhost:3000/project/p_mtrawlau_7rly' });
  await new Promise((r) => setTimeout(r, 8000));

  // 量测：卡片宽 ≪ 格子宽（背景不再铺满），且卡片在格子内水平居中（左右留白近似相等）
  const probe = await evalJs(`(async () => {
    let pad=null;
    for(let i=0;i<20&&!pad;i++){
      pad=document.querySelector('[class*="emptyResultLaunchpad"]');
      if(!pad) await new Promise(r=>setTimeout(r,800));
    }
    if(!pad) return JSON.stringify({err:'NO_LAUNCHPAD',path:location.pathname});
    const cards=[...pad.querySelectorAll('button')];
    if(cards.length<6) return JSON.stringify({err:'FEW_CARDS',n:cards.length});
    const r0=(x)=>Math.round(x);
    const m=cards[0];
    const cell=m.getBoundingClientRect().width; // grid track 内 item 实际盒宽
    const itemWidth=m.getBoundingClientRect().width;
    const cs=getComputedStyle(m);
    // 居中量测：卡片相对其格子的左右留白（用 offsetLeft 对比同排兄弟）
    // 加映口径：同列卡片左缘对齐（整洁）—— grid 按行流，偶数索引=第1列，奇数=第2列
    const cols=[[cards[0],cards[2],cards[4]],[cards[1],cards[3],cards[5]]];
    const deltas=cols.map(col=>Math.max(...col.map(b=>b.getBoundingClientRect().left))-Math.min(...col.map(b=>b.getBoundingClientRect().left)));
    const centering='colLeftDeltas='+deltas.map(r0).join(',');
    return JSON.stringify({
      n:cards.length,
      itemWidth:r0(itemWidth),
      justifyItems:getComputedStyle(pad).justifyItems,
      textAlign:cs.textAlign,
      labels:cards.map(b=>b.textContent.trim()).join(','),
      centering
    });
  })()`, 60000);
  const s = JSON.parse(probe);
  assert('launchpad 渲染 6 张入口卡', s.n === 6, probe);
  assert('卡片收窄（无最小宽度，贴文字边 ≤140px）', s.itemWidth > 0 && s.itemWidth <= 140, `itemWidth=${s.itemWidth}`);
  assert('格内靠左生效（justify-items: start）', s.justifyItems === 'start', `justifyItems=${s.justifyItems}`);
  assert('文字左对齐（text-align: left）', s.textAlign === 'left', `textAlign=${s.textAlign}`);
  assert('同列卡片左缘对齐（整洁）', /^colLeftDeltas=\d+,\d+$/.test(s.centering) && s.centering.split('=')[1].split(',').every((v) => Number(v) <= 2), s.centering);
  assert('六卡标签齐全', ['结果','后端','浏览器','文件','侧边聊天','审阅'].every((l) => (s.labels || '').includes(l)), s.labels);

  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE, 'ui329-launchpad-live.png'), Buffer.from(shot.data, 'base64'));
  assert('0 renderer console error', errors.length === 0, errors.join(' | '));
  console.log('renderer errors:', errors.length);

  c.socket.close();
  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE, 'ui329-live.json'), JSON.stringify(results, null, 2));
  console.log(results.allPass ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(results.allPass ? 0 : 1);

  async function evalJs(expr, to = 60000) {
    const r = await Promise.race([c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => setTimeout(() => rej(new Error('cdp timeout')), to))]);
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || '').slice(0, 250));
    return r.result && r.result.value;
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
