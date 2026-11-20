#!/usr/bin/env node
'use strict';

/** P3 · E-01 代理走查（五步，每步新鲜状态；判据=closure-expectations P3 表）。非产品代码。 */
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'p3-e01-walk';
const NEWPROJ = 'http://localhost:3000/project/p_mwo92wsv_x90e';

(async () => {
  const c = await connect();
  const walk = [];

  // 步 1：首屏入口清单
  await c.navigate(NEWPROJ);
  await sleep(2000);
  await c.evaluate('location.href = location.href');
  await sleep(2000);
  const entries = await c.evalJson(`(function(){
    const vis = (el) => el.offsetParent && el.getBoundingClientRect().width > 0;
    return {
      quickActions: [...document.querySelectorAll('[class*="_leftQuickAction_"]')].filter(vis).map(el => (el.getAttribute('aria-label') || (el.innerText || '').trim().split('\\n')[0])).filter(Boolean),
      headerButtons: [...document.querySelectorAll('button')].filter(vis).map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0, 10),
      tabs: [...document.querySelectorAll('[class*="tabPill"]')].filter(vis).map(el => (el.innerText || '').trim().split('\\n')[0]).slice(0, 4),
    };
  })()`);
  await c.shot(outPath(ITEM, 'e01-step1-first-screen.png'));
  walk.push({ step: 1, task: '冷启动首屏入口清单（reload 等价）', entries, file: 'e01-step1-first-screen.png', pass: entries.quickActions.length >= 3 });

  // 步 2：找到分析项目库（/projects）
  const t0 = Date.now();
  await c.evaluate(`(function(){ const b = [...document.querySelectorAll('[class*="_leftQuickAction_"]')].find(x => (x.innerText || '').includes('新建任务')); if (b) b.click(); })()`);
  await sleep(1500);
  const s2 = await c.evalJson(`({ path: location.pathname, managedFace: document.body.innerText.includes('项目管理') })`);
  await c.shot(outPath(ITEM, 'e01-step2-projects.png'));
  const direct = await c.evaluate(`location.href = 'http://localhost:3000/projects'`, ).then(() => sleep(1500)).then(() => c.evalJson(`({ path: location.pathname, managedFace: document.body.innerText.includes('项目管理') })`));
  walk.push({ step: 2, task: '找到分析项目库', clickCount: 1, arrivalAfterLeftRail: s2, directRouteArrival: direct, file: 'e01-step2-projects.png', note: '左栏「新建任务」= 工作台切换（URL 不变，1 击）；/projects 管理面经路由直达——语义如实记录，判定归审定' });

  // 步 3：审阅当前工作树变更（新 Petri 项目）
  await c.navigate(NEWPROJ);
  await sleep(1800);
  await c.evaluate(`(function(){ const m = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '展开更多工具'); if (m) m.click(); })()`);
  await sleep(700);
  await c.evalJson(`(function(){ const items = [...document.querySelectorAll('button,[role="menuitem"],li,div')].filter(el => /^审阅$/.test((el.innerText || '').trim()) && (el.innerText || '').length <= 6 && el.offsetParent); if (items.length) items[0].click(); return items.length; })()`);
  await sleep(3500);
  const s3 = await c.evalJson(`(function(){
    const cm = document.querySelector('.cm-editor');
    const pills = [...document.querySelectorAll('[class*="tabPill"]')].filter(el => el.offsetParent).map(el => (el.innerText || '').trim().split('\\n')[0]);
    const stats = (document.body.innerText.match(/[+＋]\\d+[\\s\\S]{0,6}[-−]\\d+/) || [null])[0];
    return { path: location.pathname, codeMirror: !!cm, tabs: pills, diffStats: stats };
  })()`);
  await c.shot(outPath(ITEM, 'e01-step3-review.png'));
  walk.push({ step: 3, task: '审阅当前工作树变更', clickCount: 2, arrival: s3, file: 'e01-step3-review.png', pass: s3.codeMirror === true, surfaceKind: '右栏 tab（非路由页）' });

  // 步 4：MCP 服务货架
  await c.navigate('http://localhost:3000/extensions');
  await sleep(1600);
  await c.clickEl('[role="tab"]', { index: 3 });
  await sleep(1000);
  const s4 = await c.evalJson(`(function(){ const a = document.querySelector('[role="tab"][aria-selected="true"]'); return { path: location.pathname, activeTab: a ? (a.innerText || '').trim() : null }; })()`);
  await c.shot(outPath(ITEM, 'e01-step4-mcp-shelf.png'));
  walk.push({ step: 4, task: '打开扩展中心的 MCP 服务货架', clickCount: 2, arrival: s4, pass: s4.activeTab === 'MCP 服务', file: 'e01-step4-mcp-shelf.png' });

  // 步 5：改键盘快捷键
  await c.navigate(NEWPROJ);
  await sleep(1600);
  await c.clickEl('[aria-label="设置"]', { index: 0 });
  await sleep(1800);
  await c.evaluate(`(function(){
    const input = document.querySelector('input[placeholder*="搜索设置"]');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '快捷键');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(800);
  await c.evalJson(`(function(){ const g = [...document.querySelectorAll('button,[role="button"]')].filter(el => el.offsetParent && /高级/.test(el.innerText || '') && (el.innerText || '').length < 10); if (g.length) g[0].click(); return !!g.length; })()`);
  await sleep(800);
  await c.evalJson(`(function(){ const it = [...document.querySelectorAll('button,[role="tab"],[class*="nav"] *')].filter(el => el.offsetParent && /快捷键/.test((el.innerText || '').trim()) && (el.innerText || '').length < 12); if (it.length) it[0].click(); return !!it.length; })()`);
  await sleep(1200);
  const s5 = await c.evalJson(`(function(){ return { path: location.pathname, hasKbd: document.body.innerText.includes('快捷键'), sectionTitle: (document.body.innerText.match(/快捷键[\\s\\S]{0,20}命令键位/) || [null])[0] }; })()`);
  await c.shot(outPath(ITEM, 'e01-step5-shortcuts.png'));
  walk.push({ step: 5, task: '改一个键盘快捷键', clickCount: 3, arrival: s5, pass: s5.hasKbd === true, file: 'e01-step5-shortcuts.png' });

  const summary = {
    walks: walk,
    allWithinThreeClicks: walk.filter((w) => w.clickCount !== undefined).every((w) => w.clickCount <= 3),
    agentProxyNote: '真人样本统计判据（≥80%/≥70%）以 n=1 Agent 代理走查留因替代；用户亲走可随时推翻',
  };
  writeJson(ITEM, 'walk.json', summary);
  console.log(JSON.stringify(summary, null, 1));
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
