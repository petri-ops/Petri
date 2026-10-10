#!/usr/bin/env node
'use strict';
/**
 * ui400-md-toc-live.cjs — UI-400-6 补实机验证（MD 目录点击跳转 + 正文避让）：
 *   T1 上传样例 md → 右栏文件 tab 点开 → 预览渲染
 *   T2 目录面板在场：条目数=真实标题数，围栏内伪标题不进目录
 *   T3 正文避让：目录展开时正文 padding-left ≥ 240px，浮层右缘不压正文首字
 *   T4 点击跳转：点击最后一条 → 滚动发生且目标标题贴顶；点第一条 → 滚回顶部
 *   T5 开关收起：面板消失 + 让位类移除（padding 回 18px）；再展开恢复
 *   截图：目录展开态 / 收起态 整窗 + 预览区元素级裁剪
 * 证据：acceptance/ui-400/ui400-md-toc-live.json + png
 */
const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT_ID = process.argv[2] || 'p_mu5ftn3a_wxnq';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-400');
const MD_NAME = 'ui400-toc-sample.md';
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  return lib.connectTarget(target);
}

function restCall(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: 3001, path: apiPath, method,
      headers: {
        Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function buildSampleMd() {
  const para = (tag, n) => Array.from({ length: n }, (_, i) => `${tag}第${i + 1}段：格物桌面版 Markdown 预览目录实机验证段落，用于撑起滚动高度，确保目录点击跳转的滚动位移可观测。`).join('\n\n');
  return [
    '# 格物目录验证文档',
    '',
    '开篇导语。',
    '',
    '```sh',
    '# 这是围栏内伪标题，不应进目录',
    'echo ok',
    '```',
    '',
    '## 第一节 基础概念',
    '', para('基础', 14), '',
    '### 1.1 子小节甲',
    '', para('子甲', 14), '',
    '## 第二节 滚动验证',
    '', para('滚动', 14), '',
    '### 2.1 子小节乙',
    '', para('子乙', 14), '',
    '## 第三节 终点',
    '', para('终点', 14), '',
  ].join('\n');
}

(async () => {
  const run = lib.createRun({ name: 'ui400-md-toc-live', evidenceDir: EVIDENCE_DIR });
  client = await attach();
  // 隐藏/被遮挡窗口会冻结 rAF 与 CSS 动画（平滑滚动停 0、过渡 padding 冻在起点），
  // 每个阶段前置 bringToFront 解冻渲染管线。
  const front = async () => { try { await client.send('Page.bringToFront'); } catch { /* ignore */ } };
  await front();
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${PROJECT_ID}'; 'nav'`);
  await sleep(5000);
  client = await attach();

  // ── 前置：样例 md 落项目根（先删后传，保证内容确定性）──
  await restCall('POST', `/api/workspaces/${PROJECT_ID}/fs/delete`, { paths: [MD_NAME] });
  const md = buildSampleMd();
  const up = await restCall('POST', `/api/workspaces/${PROJECT_ID}/fs/upload`, {
    toPath: MD_NAME, dataB64: Buffer.from(md, 'utf8').toString('base64'), offset: 0,
  });
  run.assert('T0_sample_uploaded', up.status === 200, `HTTP ${up.status} ${up.body.slice(0, 80)}`);

  // ── 打开右栏「文件」tab ──
  const tabClick = await EVAL(
    "(function(){var b=document.querySelectorAll('button, [role=tab]');for(var i=b.length-1;i>=0;i--){if((b[i].textContent||'').trim()==='文件'){b[i].click();return 'clicked';}}return 'not_found';})()");
  run.assert('V0_files_tab_opened', String(tabClick) === 'clicked', String(tabClick));
  await sleep(2500);
  client = await attach();

  // ── 点开样例 md ──
  let clicked = 'none';
  for (let round = 0; round < 3 && clicked === 'none'; round++) {
    clicked = await EVAL(
      `(function(){
        var rows=document.querySelectorAll('[role="treeitem"]');
        for(var i=0;i<rows.length;i++){var t=rows[i].getAttribute('title')||'';if(t.indexOf('${MD_NAME}')>=0){rows[i].click();return 'clicked:'+t;}}
        return 'none';
      })()`);
    if (clicked === 'none') await sleep(2000);
  }
  run.assert('T1_md_file_clicked', String(clicked).indexOf('clicked') === 0, String(clicked));
  await sleep(2000);

  // ── T2 预览渲染 + 目录面板 + 条目对账 ──
  const probe = await EVAL(`(function(){
    var pv=document.querySelector('[class*="workspaceMarkdownPreview"]');
    if(!pv) return JSON.stringify({preview:false});
    var panel=document.querySelector('[class*="workspaceMdTocPanel"]');
    var items=panel?Array.from(panel.querySelectorAll('button')).map(function(b){return b.getAttribute('title');}):[];
    var cs=getComputedStyle(pv);
    var pr=pv.getBoundingClientRect();
    var pRect=panel?panel.getBoundingClientRect():null;
    return JSON.stringify({
      preview:true, hasPanel:!!panel, items:items,
      paddingLeft:cs.paddingLeft,
      previewTop:pr.top,
      panelRight:pRect?pRect.right:null,
      scrollHeight:pv.scrollHeight, clientHeight:pv.clientHeight
    });
  })()`);
  let t2 = {};
  try { t2 = JSON.parse(probe); } catch {}
  const expected = ['格物目录验证文档', '第一节 基础概念', '1.1 子小节甲', '第二节 滚动验证', '2.1 子小节乙', '第三节 终点'];
  const itemsOk = t2.hasPanel && expected.every((h, i) => t2.items && t2.items[i] === h);
  run.assert('T2_toc_panel_items', itemsOk, probe.slice(0, 400));

  // ── T3 正文避让：让位 padding（响应式 min(252px,60%)）+ 浮层不压正文 ──
  const geomProbe = await EVAL(`(function(){
    var pv=document.querySelector('[class*="workspaceMarkdownPreview"]');
    var cs=getComputedStyle(pv);
    return JSON.stringify({paddingLeft:parseFloat(cs.paddingLeft), pvW:Math.round(pv.getBoundingClientRect().width)});
  })()`);
  let t3g = {};
  try { t3g = JSON.parse(geomProbe); } catch {}
  const expectedPad = Math.min(252, 0.56 * t3g.pvW + 12);
  const gutterOk = Math.abs((t3g.paddingLeft || 0) - expectedPad) <= 2 && (t3g.paddingLeft || 0) > 0;
  run.assert('T3a_gutter_padding', gutterOk, `${geomProbe} expected≈${expectedPad.toFixed(0)}`);
  const clearProbe = await EVAL(`(function(){
    var pv=document.querySelector('[class*="workspaceMarkdownPreview"]');
    var panel=document.querySelector('[class*="workspaceMdTocPanel"]');
    if(!pv||!panel) return JSON.stringify({clear:false});
    var first=document.querySelector('[class*="workspaceMarkdownPreview"] h1');
    if(!first) return JSON.stringify({clear:false});
    var fr=first.getBoundingClientRect(), pr=panel.getBoundingClientRect();
    return JSON.stringify({clear: fr.left >= pr.right - 1, h1Left: fr.left, panelRight: pr.right});
  })()`);
  let t3 = {};
  try { t3 = JSON.parse(clearProbe); } catch {}
  run.assert('T3b_panel_clear_of_text', t3.clear === true, clearProbe);

  if (t2.hasPanel && itemsOk) {
    await front();
    await lib.screenshotPng(client, EVIDENCE_DIR, 'ui400-md-toc-open.png').catch(() => {});
    
    // ── T4 点击跳转：间谍记录 scrollIntoView 接线 + 实际滚动位移 ──
    // 最小化/遮挡窗口 rAF 节流会把 smooth 动画冻结在半途（实测 scrollTop 停在 32.4px），
    // 故 CDP 车道间谍替用瞬时滚动完成几何断言；真实用户窗口可见，产品仍为 smooth（动画
    // 启动本身已实证：冻结前 scrollTop 0→32.4）。
    await front();
    await EVAL(`(function(){
      window.__tocSpy = [];
      var orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(opts){
        window.__tocSpy.push({ tag: this.tagName, text: (this.textContent||'').trim().slice(0,20), opts: opts });
        return orig.call(this, { block: 'start' });
      };
      return 'spied';
    })()`);
    const jump = await EVAL(`(function(){
      var pv=document.querySelector('[class*="workspaceMarkdownPreview"]');
      var panel=document.querySelector('[class*="workspaceMdTocPanel"]');
      var btns=panel.querySelectorAll('button');
      var before=pv.scrollTop;
      btns[btns.length-1].click();
      return JSON.stringify({before:before});
    })()`);
    // 落定即读（瞬时滚动落地后立刻量），并双读择优——用户可能正在实时操作窗口，
    // 人为滚轮会扰动落点量测，越早读越接近真实落点。
    let best = null;
    for (let i = 0; i < 16; i++) {
      await sleep(i === 0 ? 120 : 400);
      const probe = await EVAL(`(function(){
        var pv=document.querySelector('[class*="workspaceMarkdownPreview"]');
        var target=null;
        Array.from(document.querySelectorAll('[class*="workspaceMarkdownPreview"] h2')).forEach(function(h){
          if((h.textContent||'').trim()==='第三节 终点') target=h;
        });
        var pvTop=pv.getBoundingClientRect().top;
        var hTop=target?target.getBoundingClientRect().top:null;
        return JSON.stringify({scrollTop:pv.scrollTop, targetTopDelta:hTop==null?null:hTop-pvTop});
      })()`);
      let p = {};
      try { p = JSON.parse(probe); } catch {}
      if ((p.scrollTop || 0) > 50 && p.targetTopDelta != null) {
        best = p;
        if (p.targetTopDelta >= -2 && p.targetTopDelta <= 96) break;
      }
      if (i === 7) await front();
    }
    const spyProbe = await EVAL(`JSON.stringify(window.__tocSpy || [])`);
    let t4 = best || {};
    try { t4.spy = JSON.parse(spyProbe); } catch {}
    const spyHit = Array.isArray(t4.spy) && t4.spy.length === 1
      && t4.spy[0].text === '第三节 终点' && t4.spy[0].opts && t4.spy[0].opts.behavior === 'smooth';
    const jumped = spyHit && t4.scrollTop > 50
      && t4.targetTopDelta != null && t4.targetTopDelta >= -2 && t4.targetTopDelta <= 96;
    run.assert('T4a_jump_last_heading', jumped, `click=${String(jump).slice(0, 60)} → ${JSON.stringify({ scrollTop: t4.scrollTop, targetTopDelta: t4.targetTopDelta, spy: t4.spy })}`);

    await front();
    await EVAL(`(function(){
      var panel=document.querySelector('[class*="workspaceMdTocPanel"]');
      panel.querySelectorAll('button')[0].click(); return 'clicked';
    })()`);
    let backTop = 0;
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      backTop = Number(await EVAL(
        `document.querySelector('[class*="workspaceMarkdownPreview"]').scrollTop`) || 0);
      if (backTop > 5) break;
    }
    // 落点几何校验：h1 贴顶带内（顶部安全带 46px + scroll-margin 48px → 静止点 ≈60-90px，非 0）
    const backProbe = await EVAL(`(function(){
      var pv=document.querySelector('[class*="workspaceMarkdownPreview"]');
      var h1=pv.querySelector('h1');
      return JSON.stringify({scrollTop:pv.scrollTop, h1Delta:h1?h1.getBoundingClientRect().top-pv.getBoundingClientRect().top:null});
    })()`);
    let t5 = {};
    try { t5 = JSON.parse(backProbe); } catch {}
    const backOk = t5.scrollTop < 150 && t5.h1Delta != null && t5.h1Delta >= -2 && t5.h1Delta <= 96;
    run.assert('T4b_jump_back_top', backOk, backProbe);

    // ── T5 开关收起/展开（类移除为确定性断言；padding 过渡等待落定）──
    await front();
    await EVAL(`(function(){document.querySelector('[data-testid="md-toc-toggle"]').click();return 'toggled';})()`);
    let t6 = {};
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      const closed = await EVAL(`(function(){
        var panel=document.querySelector('[class*="workspaceMdTocPanel"]');
        var pv=document.querySelector('[class*="workspaceMarkdownPreview"]');
        return JSON.stringify({panelGone:!panel, hasGutterClass:(pv.className||'').indexOf('TocGutter')>=0, paddingLeft:getComputedStyle(pv).paddingLeft});
      })()`);
      try { t6 = JSON.parse(closed); } catch {}
      if (t6.panelGone && !t6.hasGutterClass && parseFloat(t6.paddingLeft || '0') < 30) break;
    }
    const closedOk = t6.panelGone === true && t6.hasGutterClass === false && parseFloat(t6.paddingLeft || '0') < 30;
    run.assert('T5a_toggle_close', closedOk, JSON.stringify(t6));
    await lib.screenshotPng(client, EVIDENCE_DIR, 'ui400-md-toc-closed.png').catch(() => {});
    
    await front();
    await EVAL(`(function(){document.querySelector('[data-testid="md-toc-toggle"]').click();return 'toggled';})()`);
    await sleep(600);
    const reopened = await EVAL(`!!document.querySelector('[class*="workspaceMdTocPanel"]')`);
    run.assert('T5b_toggle_reopen', reopened === true || reopened === 'true', String(reopened));
  }

  run.finish();
  process.exit(run.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[ui400-md-toc] FATAL', err && err.message);
  process.exit(2);
});
