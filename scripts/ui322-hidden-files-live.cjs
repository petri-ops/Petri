#!/usr/bin/env node
'use strict';

/**
 * BLOCK-73 UI-322 实机 CDP 验收：文件树「显示隐藏文件」开关（方案 A）。
 *   1) 工具条 toggle 存在且默认关（aria-pressed=false）
 *   2) 默认态：树中无点开头条目（以 biof3-desktop 工作区 .gitignore 为标记）
 *   3) toggle 开：.gitignore 等点文件出现（HMR/reload 后服务端参数生效）
 *   4) 偏好持久化：localStorage gewu.fileTree.showHidden=1，reload 后仍开
 *   5) toggle 关：点文件消失
 * 前置：dev Electron（9222）+ 后端（3001，载入 BLOCK-73 files.js）+ 打开的本地项目（biof3-desktop）。
 * 证据：acceptance/ui-322/ui322-live.json + ui322-*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-322');

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

  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  const pages = targets.filter((t) => t.type === 'page' && /localhost:3000\/project\//.test(t.url));
  if (!pages.length) throw new Error('no_project_page_target');
  let main = null;
  for (const p of pages) {
    const c0 = await new CdpClient(p.webSocketDebuggerUrl).connect();
    const probe = await evalJS(c0, `JSON.stringify({
      tree: document.querySelectorAll('[class*="projectTree"]').length,
      right: !!document.querySelector('[class*="rightCol"]'),
    })`).catch(() => null);
    c0.socket.close();
    if (probe && JSON.parse(probe).tree > 0 && JSON.parse(probe).right) { main = p; break; }
  }
  main = main || pages[0];
  const client = await new CdpClient(main.webSocketDebuggerUrl).connect();

  // 记录原页面（并行会话可能在用）；本验收在 biof3-desktop 本地项目上跑，结束后恢复
  const originalUrl = main.url;
  const TARGET = 'http://localhost:3000/project/p_mtrawlau_7rly';
  const restoreOriginal = async () => {
    if (originalUrl && !originalUrl.startsWith(TARGET)) {
      await evalJS(client, `location.href = ${JSON.stringify(originalUrl)}; 'navigating'`).catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
    }
  };

  if (!originalUrl.startsWith(TARGET)) {
    await evalJS(client, `location.href = ${JSON.stringify(TARGET)}; 'navigating'`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  // 右栏需处于 files tab 且树展开；先确保右栏打开在「文件」
  await client.send('Page.reload');
  let interactive = false;
  for (let i = 0; i < 30 && !interactive; i++) {
    interactive = await evalJS(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
    if (!interactive) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!interactive) throw new Error('app_not_interactive');

  // 打开右栏「文件」tab（飞出菜单若在 tab rail 未含则经更多菜单）
  await evalJS(client, `(async () => {
    const expandRight = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('展开右侧栏'));
    if (expandRight) { expandRight.click(); await new Promise((r) => setTimeout(r, 800)); }
    const fileTab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '文件');
    if (fileTab) { fileTab.click(); await new Promise((r) => setTimeout(r, 1000)); return 'tab'; }
    const more = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('展开更多工具'));
    if (more) { more.click(); await new Promise((r) => setTimeout(r, 500)); }
    const item = [...document.querySelectorAll('button, [role="menuitem"]')].find((e) => e.textContent.trim() === '文件');
    if (item) { item.click(); await new Promise((r) => setTimeout(r, 1000)); }
    return 'done';
  })()`);

  // 清偏好 → 初始态为关
  await evalJS(client, `(() => { localStorage.removeItem('gewu.fileTree.showHidden'); return 'cleared'; })()`);
  await client.send('Page.reload');
  await new Promise((r) => setTimeout(r, 5000));
  // reload 后重新确保 files tab
  await evalJS(client, `(async () => {
    const fileTab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '文件');
    if (fileTab) { fileTab.click(); await new Promise((r) => setTimeout(r, 1000)); }
    return 'tab';
  })()`);

  const initial = JSON.parse(await evalJS(client, `(async () => {
    await new Promise((r) => setTimeout(r, 1200));
    const toggle = document.querySelector('[data-testid="file-tree-show-hidden"]');
    const treeText = document.querySelector('[role="tree"]')?.textContent || '';
    return JSON.stringify({
      toggle: !!toggle,
      pressed: toggle?.getAttribute('aria-pressed') ?? null,
      disabled: toggle?.disabled ?? null,
      hasGitignore: treeText.includes('.gitignore'),
    });
  })()`));
  assert('B1 toggle 存在且默认关（aria-pressed=false）', initial.toggle && initial.pressed === 'false', JSON.stringify(initial));
  assert('B2 默认态树中无 .gitignore（现状体感）', initial.hasGitignore === false, JSON.stringify(initial));

  // toggle 开
  await evalJS(client, `(async () => {
    const toggle = document.querySelector('[data-testid="file-tree-show-hidden"]');
    toggle.click();
    await new Promise((r) => setTimeout(r, 2000));
    return 'toggled';
  })()`);
  const shown = JSON.parse(await evalJS(client, `JSON.stringify({
    pressed: document.querySelector('[data-testid="file-tree-show-hidden"]')?.getAttribute('aria-pressed'),
    persisted: localStorage.getItem('gewu.fileTree.showHidden'),
    hasGitignore: (document.querySelector('[role="tree"]')?.textContent || '').includes('.gitignore'),
  })`));
  assert('B3 toggle 开：.gitignore 等点文件出现在树中', shown.pressed === 'true' && shown.hasGitignore === true, JSON.stringify(shown));
  assert('B4 偏好持久化 localStorage=1', shown.persisted === '1', shown.persisted);
  await screenshot(client, 'ui322-shown.png');

  // reload 后仍开（持久化生效）
  await client.send('Page.reload');
  await new Promise((r) => setTimeout(r, 5000));
  await evalJS(client, `(async () => {
    const fileTab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '文件');
    if (fileTab) { fileTab.click(); await new Promise((r) => setTimeout(r, 1200)); }
    return 'tab';
  })()`);
  const afterReload = JSON.parse(await evalJS(client, `(async () => {
    await new Promise((r) => setTimeout(r, 1200));
    return JSON.stringify({
      pressed: document.querySelector('[data-testid="file-tree-show-hidden"]')?.getAttribute('aria-pressed'),
      hasGitignore: (document.querySelector('[role="tree"]')?.textContent || '').includes('.gitignore'),
    });
  })()`));
  assert('B5 reload 后偏好保持（仍开且可见）', afterReload.pressed === 'true' && afterReload.hasGitignore === true, JSON.stringify(afterReload));

  // toggle 关 → 恢复
  await evalJS(client, `(async () => {
    document.querySelector('[data-testid="file-tree-show-hidden"]').click();
    await new Promise((r) => setTimeout(r, 2000));
    return 'off';
  })()`);
  const off = JSON.parse(await evalJS(client, `JSON.stringify({
    pressed: document.querySelector('[data-testid="file-tree-show-hidden"]')?.getAttribute('aria-pressed'),
    hasGitignore: (document.querySelector('[role="tree"]')?.textContent || '').includes('.gitignore'),
  })`));
  assert('B6 toggle 关：点文件消失（恢复现状）', off.pressed === 'false' && off.hasGitignore === false, JSON.stringify(off));
  await screenshot(client, 'ui322-default.png');

  await restoreOriginal();

  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui322-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`allPass=${results.allPass}`);
  client.socket.close();
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
