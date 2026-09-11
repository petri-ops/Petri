#!/usr/bin/env node
'use strict';
/**
 * ui346-rail-mode-live.cjs — UI-346 实机验收：左栏「搜索/插件」无项目上下文不再假死。
 *
 * 用户实机反馈（2026-09-11）：欢迎页（/）点「插件/搜索」原地不动——
 * AppRailContext.openWorkspaceMode 无 adapter 且无 currentProjectId 时 navigate('/')＝no-op。
 * 修复＝回退最近项目（listProjects ORDER BY updated_at DESC，与欢迎页项目预选同口径）打开同一模式。
 *
 * 断言：
 *   V1 欢迎页点「插件」 → /project/<最新项目>/plugins 且插件商店面板渲染；
 *   V2 欢迎页点「搜索」 → /project/<最新项目>/search 且跨项目搜索面板渲染；
 *   V3 项目内（adapter 路径回归）点「插件」 → 模式切到 plugins 且项目不变。
 */

const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
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

const PATH_NOW = `location.pathname`;

async function goto(client, url) {
  await lib.evalJs(client, `location.href = ${JSON.stringify(url)}; 'nav'`);
  await sleep(3500);
  return attach();
}

async function waitUrl(client, prefix, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = await lib.evalJs(client, PATH_NOW).catch(() => null);
    if (p && String(p).startsWith(prefix)) return String(p);
    await sleep(500);
  }
  return null;
}

async function clickRailItem(client, title) {
  return lib.evalJs(client, `(function(){
    var b = document.querySelector('button[title=${JSON.stringify(title)}]');
    if (!b) return 'button_missing';
    b.click();
    return 'clicked';
  })()`).catch((e) => 'err:' + String(e.message).slice(0, 60));
}

async function waitPanel(client, selector, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await lib.evalJs(client, `!!document.querySelector(${JSON.stringify(selector)})`).catch(() => false);
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

(async () => {
  const run = lib.createRun({ name: 'ui346-rail-mode', evidenceDir: path.join(ROOT, 'acceptance', 'ui-346') });
  const data = await req('GET', '/api/data/projects');
  const projects = (data && data.projects) || [];
  if (projects.length === 0) throw new Error('no_projects');
  const latestProjectId = projects[0].id; // 与修复同口径：listProjects ORDER BY updated_at DESC
  lib.log(`latest project (fix fallback target): ${latestProjectId}`);

  let client = await attach();
  client = await goto(client, 'http://localhost:3000/');

  // V1 — 欢迎页点「插件」
  const before1 = await lib.evalJs(client, PATH_NOW);
  await clickRailItem(client, '插件');
  const url1 = await waitUrl(client, `/project/${latestProjectId}/plugins`);
  const panel1 = url1 ? await waitPanel(client, '.gewu-plugin-store-panel') : false;
  run.assert('V1_welcome_plugins_opens', url1 !== null && panel1,
    `欢迎页（${before1}）点「插件」→ ${url1 || 'URL 未变'}，插件商店面板${panel1 ? '已渲染' : '未渲染'}`);

  // V2 — 回欢迎页点「搜索」（进入项目后返回，adapter 会被工作区卸载清理置 null）
  client = await goto(client, 'http://localhost:3000/');
  const before2 = await lib.evalJs(client, PATH_NOW);
  await clickRailItem(client, '搜索项目');
  const url2 = await waitUrl(client, `/project/${latestProjectId}/search`);
  const panel2 = url2 ? await waitPanel(client, '[class*="workspaceSearch"]') : false;
  run.assert('V2_welcome_search_opens', url2 !== null && panel2,
    `欢迎页（${before2}）点「搜索」→ ${url2 || 'URL 未变'}，搜索面板${panel2 ? '已渲染' : '未渲染'}`);

  // V3 — 项目内 adapter 路径回归：chat 模式点「插件」，模式切换且项目不变
  client = await goto(client, `http://localhost:3000/project/${latestProjectId}`);
  await lib.evalJs(client, `(function(){
    var ta = document.querySelector('textarea.sc-input');
    return ta ? 'composer_ready' : 'no_composer';
  })()`);
  await sleep(1000);
  const urlBefore3 = await lib.evalJs(client, PATH_NOW);
  await clickRailItem(client, '插件');
  const url3 = await waitUrl(client, `/project/${latestProjectId}/plugins`);
  const panel3 = url3 ? await waitPanel(client, '.gewu-plugin-store-panel') : false;
  const projectPreserved = url3 !== null && url3.startsWith(`/project/${latestProjectId}/`);
  run.assert('V3_in_project_switch_preserved', projectPreserved && panel3,
    `项目内（${urlBefore3}）点「插件」→ ${url3 || 'URL 未变'}，项目未变且面板${panel3 ? '已渲染' : '未渲染'}`);

  await lib.screenshotPng(client, path.join(ROOT, 'acceptance', 'ui-346'), 'ui346-plugins-open.png').catch(() => null);

  return await run.finish({ observations: { latestProjectId } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
