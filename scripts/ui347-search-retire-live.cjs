#!/usr/bin/env node
'use strict';
/**
 * ui347-search-retire-live.cjs — UI-347 实机验收：左栏「搜索」退役 + 插件返回风格统一。
 *
 * 用户裁决（2026-09-11）：① 左栏「搜索」无实际意义 → 删除入口并清理搜索面代码；
 * ② 插件页返回风格与其它页面保持一致（原右上角 × → 左上角文字返回按钮）。
 *
 * 断言：
 *   V1 左栏不再渲染「搜索」入口（插件入口仍在）；
 *   V2 插件页头部为「返回对话」文字按钮（同定时分析面），右上角 × 关闭已移除；
 *   V3 点「返回对话」→ 回到对话模式（composer 可见）；
 *   V4 历史深链 /project/:id/search fail-closed 落对话模式（模式集合已删 'search'）。
 */

const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const AUTH = { Authorization: 'Bearer desktop-local' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: 3001, path: p, method, headers: AUTH }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
    });
    r.on('error', reject);
    r.end();
  });
}

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_page_target');
  return lib.connectTarget(target);
}

async function goto(client, url) {
  await lib.evalJs(client, `location.href = ${JSON.stringify(url)}; 'nav'`);
  await sleep(3500);
  return attach();
}

async function waitComposer(client, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await lib.evalJs(client, `(function(){ return document.querySelector('textarea.sc-input') ? 'ready' : null; })()`).catch(() => null);
    if (ok === 'ready') return true;
    await sleep(800);
  }
  return false;
}

(async () => {
  const run = lib.createRun({ name: 'ui347-search-retire', evidenceDir: path.join(ROOT, 'acceptance', 'ui-347') });
  const data = await req('GET', '/api/data/projects');
  const latestProjectId = ((data && data.projects) || [])[0].id;
  if (!latestProjectId) throw new Error('no_projects');

  let client = await attach();
  client = await goto(client, 'http://localhost:3000/');
  await waitComposer(client);

  /* V1 — 左栏入口盘点 */
  const rail = await lib.evalJs(client, `(function(){
    return JSON.stringify({
      search: !!document.querySelector('button[title="搜索项目"]'),
      plugins: !!document.querySelector('button[title="插件"]'),
      scheduled: !!document.querySelector('button[title="定时分析"]'),
    });
  })()`).catch(() => '{}');
  const railState = JSON.parse(rail || '{}');
  run.assert('V1_search_entry_removed', railState.search === false && railState.plugins === true,
    `左栏「搜索」入口已移除（搜索=${railState.search}），「插件」入口保留（${railState.plugins}）`);

  /* V2 — 插件页返回按钮风格 */
  await lib.evalJs(client, `(function(){ var b = document.querySelector('button[title="插件"]'); if (b) b.click(); return 'clicked'; })()`);
  // 工作区挂载 + 面板渲染需要数秒（对话/作业数据加载），轮询等待
  let header = null;
  for (let i = 0; i < 30; i += 1) {
    header = await lib.evalJs(client, `(function(){
      var panel = document.querySelector('.petri-plugin-store-panel');
      if (!panel) return null;
      var back = panel.querySelector('button[aria-label="返回对话"]');
      var closeX = panel.querySelector('button[aria-label="关闭"]');
      return JSON.stringify({ panel: true, back: !!back, backText: back ? back.textContent.trim() : null, closeX: !!closeX });
    })()`).catch(() => null);
    if (header) break;
    await sleep(1000);
  }
  const h = JSON.parse(header || '{}');
  run.assert('V2_plugins_back_style', h.panel === true && h.back === true && h.closeX === false,
    `插件页渲染（panel=${h.panel}），左上角「${h.backText || '无'}」返回按钮存在=${h.back}，右上角 × 关闭已移除=${!h.closeX}`);

  /* V3 — 返回对话走通 */
  await lib.evalJs(client, `(function(){ var b = document.querySelector('.petri-plugin-store-panel button[aria-label="返回对话"]'); if (b) b.click(); return 'clicked'; })()`);
  await sleep(2000);
  const backToChat = await waitComposer(client, 10000);
  const urlBack = await lib.evalJs(client, `location.pathname`).catch(() => null);
  run.assert('V3_back_returns_to_chat', backToChat && String(urlBack) === `/project/${latestProjectId}`,
    `点「返回对话」→ URL=${urlBack}，composer ${backToChat ? '可见' : '不可见'}`);

  /* V4 — 历史深链 fail-closed */
  client = await goto(client, `http://localhost:3000/project/${latestProjectId}/search`);
  const deepLink = await lib.evalJs(client, `(function(){
    return JSON.stringify({ path: location.pathname, composer: !!document.querySelector('textarea.sc-input') });
  })()`).catch(() => '{}');
  const d = JSON.parse(deepLink || '{}');
  run.assert('V4_search_deeplink_failclosed', d.composer === true,
    `深链 /project/:id/search → path=${d.path}，以对话模式渲染（composer=${d.composer}，模式集合已无 search）`);

  await lib.screenshotPng(client, path.join(ROOT, 'acceptance', 'ui-347'), 'ui347-after.png').catch(() => null);

  return await run.finish({ observations: { latestProjectId, railState, pluginHeader: h } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
