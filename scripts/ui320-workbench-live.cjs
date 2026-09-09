#!/usr/bin/env node
'use strict';

/**
 * BLOCK-72 UI-320 实机 CDP 验收：知识空间+后端迁工作台全局入口。
 *   1) 左栏工作台区含「知识空间」「后端」入口（与 搜索/插件/Skills 同区）
 *   2) 右栏 tab 栏与飞出菜单不再含「后端」「知识」项（RightPanelMode 已删两值）
 *   3) 左栏「知识空间」→ /knowledge 全局页渲染（面板+上传+检索框+返回头）
 *   4) 左栏「后端」→ /backend 全局页渲染（进程卡 + 全局态回退 meta）
 *   5) composer 大脑开关保留在会话内
 * 前置：dev Electron（--remote-debugging-port=9222）+ vite :3000（纯前端变更，HMR/reload 生效）。
 * 证据：acceptance/ui-320/ui320-live.json + ui320-*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-320');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function log(msg) { try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {} }

async function evalJS(client, expr) {
  const r = await Promise.race([
    client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('eval_timeout_30s')), 30_000)),
  ]);
  if (r.exceptionDetails) throw new Error('eval_exception: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300));
  return r.result?.value;
}

async function screenshot(client, file) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, file), Buffer.from(shot.data, 'base64'));
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 140) : ''}`);
  };

  // 主窗探测（projectTree + rightCol；多窗并存 visibilityState 不可靠）
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  const pages = targets.filter((t) => t.type === 'page' && /localhost:3000\/project\//.test(t.url));
  if (!pages.length) throw new Error('no_project_page_target');
  let main = null;
  let fallback = null;
  for (const p of pages) {
    const c0 = await new CdpClient(p.webSocketDebuggerUrl).connect();
    const probe = await evalJS(c0, `JSON.stringify({
      tree: document.querySelectorAll('[class*="projectTree"]').length,
      right: !!document.querySelector('[class*="rightCol"]'),
      composer: !!document.querySelector('textarea.sc-input'),
    })`).catch(() => null);
    c0.socket.close();
    if (!probe) continue;
    const s = JSON.parse(probe);
    if (s.tree > 0 && s.right) { main = p; break; }
    if (!fallback && s.composer) fallback = p;
  }
  main = main || fallback || pages[0];
  const client = await new CdpClient(main.webSocketDebuggerUrl).connect();
  await client.send('Page.reload');
  let interactive = false;
  for (let i = 0; i < 30 && !interactive; i++) {
    interactive = await evalJS(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
    if (!interactive) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!interactive) throw new Error('app_not_interactive_after_reload');
  await new Promise((r) => setTimeout(r, 1500));

  // ── A1：左栏工作台区含「知识空间」「后端」入口 ──
  const leftState = JSON.parse(await evalJS(client, `JSON.stringify({
    section: [...document.querySelectorAll('[class*="leftQuickSectionLabel"]')].some((e) => e.textContent.trim() === '工作台'),
    knowledge: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '知识空间'),
    backend: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '后端'),
    skills: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Skills'),
  })`));
  assert('A1 左栏工作台区含 知识空间/后端 入口（Skills 同区）',
    leftState.section && leftState.knowledge && leftState.backend && leftState.skills, JSON.stringify(leftState));

  // ── A2：右栏 tab 栏与飞出菜单不再含「后端」「知识」项 ──
  const rightState = JSON.parse(await evalJS(client, `(async () => {
    const more = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('展开更多工具') || (b.getAttribute('aria-label') || '').includes('展开更多工具'));
    if (more) { more.click(); await new Promise((r) => setTimeout(r, 600)); }
    // 只查飞出菜单容器内（全页扫描会把左栏新入口误算进去）
    const menu = document.getElementById('titlebar-tool-menu');
    const items = [...(menu ? menu.querySelectorAll('button, [role="menuitem"]') : document.querySelectorAll('[role="menuitem"]'))].map((e) => e.textContent.trim());
    return JSON.stringify({
      hasBackendItem: items.includes('后端'),
      hasKnowledgeItem: items.includes('知识'),
      hasIoItem: items.includes('模型 I/O'),
      itemsSample: items.slice(0, 12),
    });
  })()`));
  assert('A2 右栏工具面不再含 后端/知识 项（模型 I/O 仍在）',
    !rightState.hasBackendItem && !rightState.hasKnowledgeItem && rightState.hasIoItem, JSON.stringify(rightState));

  // ── A3：左栏「知识空间」→ /knowledge 渲染 ──
  await evalJS(client, `(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '知识空间');
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 1500));
    return 'clicked';
  })()`);
  const knowledgeState = JSON.parse(await evalJS(client, `JSON.stringify({
    page: !!document.querySelector('[data-testid="knowledge-page"]'),
    panel: !!document.querySelector('[data-testid="knowledge-panel"]'),
    upload: !!document.querySelector('[data-testid="knowledge-upload"]'),
    searchInput: !!document.querySelector('[data-testid="knowledge-search-input"]'),
    url: location.pathname,
  })`));
  assert('A3 左栏「知识空间」→ /knowledge 全局页渲染（面板/上传/检索框齐备）',
    knowledgeState.page && knowledgeState.panel && knowledgeState.upload && knowledgeState.searchInput && knowledgeState.url === '/knowledge',
    JSON.stringify(knowledgeState));
  await screenshot(client, 'ui320-knowledge-page.png');

  // 返回项目页（返回头）
  await evalJS(client, `(async () => {
    const back = document.querySelector('[aria-label="返回"]');
    if (back) back.click();
    await new Promise((r) => setTimeout(r, 1200));
    return 'back';
  })()`);

  // ── A4：左栏「后端」→ /backend 渲染 ──
  await evalJS(client, `(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '后端');
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 1500));
    return 'clicked';
  })()`);
  const backendState = JSON.parse(await evalJS(client, `JSON.stringify({
    page: !!document.querySelector('[data-testid="backend-page"]'),
    refreshBtn: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '刷新'),
    shellBtn: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '系统终端'),
    metaGlobal: [...document.querySelectorAll('[class*="terminalPanelMeta"]')].some((e) => e.textContent.includes('全局')),
    url: location.pathname,
  })`));
  assert('A4 左栏「后端」→ /backend 全局页渲染（进程面 + 全局态回退 meta）',
    backendState.page && backendState.refreshBtn && backendState.shellBtn && backendState.metaGlobal && backendState.url === '/backend',
    JSON.stringify(backendState));
  await screenshot(client, 'ui320-backend-page.png');

  // 返回项目页，验证 composer 大脑开关仍在
  await evalJS(client, `(async () => {
    const back = document.querySelector('[aria-label="返回"]');
    if (back) back.click();
    await new Promise((r) => setTimeout(r, 1500));
    return 'back';
  })()`);
  const composerState = JSON.parse(await evalJS(client, `JSON.stringify({
    brain: !!document.querySelector('[data-testid="knowledge-composer-toggle"]'),
    composer: !!document.querySelector('textarea.sc-input'),
  })`));
  assert('A5 composer 大脑开关保留在会话内', composerState.composer && composerState.brain, JSON.stringify(composerState));

  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui320-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`allPass=${results.allPass}`);
  client.socket.close();
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
