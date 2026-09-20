#!/usr/bin/env node
'use strict';

/**
 * BLOCK-74 UI-323 实机 CDP 验收：文件预览头部减负 + 自动保存 + Ctrl/Cmd+S。
 *   1) 编辑态预览头部不再有 引用到对话/保存/恢复 按钮，也不再有工具条行
 *      （UI-323 加映 2026-09-10 用户裁决：md 编辑/预览收为右上角悬浮铅笔/眼睛图标，不占行）
 *   2) 自动保存：编辑停顿 ~1.2s 后内容落盘（GET /workspaces/:id/file 可证）
 *   3) Ctrl+S：立即落盘（早于 1.2s 防抖窗口，证明走快捷键链）
 *   4) 眼睛回预览：编辑器卸载、切换钮回铅笔
 *   5) 结束清理：删除验收暂存文件
 * 前置：dev Electron（9222）+ 后端（3001）+ biof3-desktop 本地项目（p_mtrawlau_7rly）。
 * 证据：acceptance/ui-323/ui323-live.json + ui323-*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const PROJECT_ID = 'p_mtrawlau_7rly';
const TARGET = `http://localhost:3000/project/${PROJECT_ID}`;
const SCRATCH = 'ui323-autosave-check.md';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-323');
const WORKSPACE = path.join(__dirname, '..'); // biof3-desktop 工作区根

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

function fileOnDisk() {
  try { return fs.readFileSync(path.join(WORKSPACE, SCRATCH), 'utf8'); } catch { return null; }
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 140) : ''}`);
  };

  // 与并行会话共享同一窗口：整轮验收自愈重试（每轮重建现场：URL/右栏/tab/暂存文件）
  for (let attempt = 1; attempt <= 3; attempt++) {
    log(`attempt ${attempt}`);
    try {
      const ok = await runOnce(results, assert);
      if (ok) break;
    } catch (e) {
      log(`attempt ${attempt} error: ${e.message}`);
    }
    results.assertions.length = 0;
    await new Promise((r) => setTimeout(r, 8000));
  }

  results.allPass = results.assertions.length > 0 && results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui323-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`allPass=${results.allPass}`);
  process.exit(results.allPass ? 0 : 1);
}

async function runOnce(results, assert) {
  {

  // 前置：暂存文件（可复跑）
  fs.writeFileSync(path.join(WORKSPACE, SCRATCH), '# ui323 autosave check\n\nbaseline line\n', 'utf8');

  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  const pages = targets.filter((t) => t.type === 'page' && /localhost:3000\/project\//.test(t.url));
  if (!pages.length) throw new Error('no_project_page_target');
  let main = null;
  for (const p of pages) {
    const c0 = await new CdpClient(p.webSocketDebuggerUrl).connect();
    const probe = await evalJS(c0, `JSON.stringify({ tree: document.querySelectorAll('[class*="projectTree"]').length, right: !!document.querySelector('[class*="rightCol"]') })`).catch(() => null);
    c0.socket.close();
    if (probe && JSON.parse(probe).tree > 0 && JSON.parse(probe).right) { main = p; break; }
  }
  main = main || pages[0];
  const client = await new CdpClient(main.webSocketDebuggerUrl).connect();
  const originalUrl = main.url;
  if (!originalUrl.startsWith(TARGET)) {
    await evalJS(client, `location.href = ${JSON.stringify(TARGET)}; 'nav'`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  // 每轮无条件整页 reload（并行会话 HMR 竞态下，半应用状态必须整页刷新）
  await client.send('Page.reload');
  let interactive = false;
  for (let i = 0; i < 30 && !interactive; i++) {
    interactive = await evalJS(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
    if (!interactive) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!interactive) throw new Error('app_not_interactive');

  // 确保右栏停在「文件」tab（rail 直点；否则经飞出菜单）
  await evalJS(client, `(async () => {
    const expandRight = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('展开右侧栏'));
    if (expandRight) { expandRight.click(); await new Promise((r) => setTimeout(r, 800)); }
    let tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '文件');
    if (!tab) {
      const more = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('展开更多工具'));
      if (more) { more.click(); await new Promise((r) => setTimeout(r, 500)); }
      tab = [...document.querySelectorAll('button, [role="menuitem"]')].find((e) => e.textContent.trim() === '文件');
    }
    if (tab) { tab.click(); await new Promise((r) => setTimeout(r, 1000)); }
    return 'files-tab';
  })()`);

  // 打开暂存文件：点文件树中的条目（树 2s 轮询会自动出现）
  let opened = false;
  for (let i = 0; i < 10 && !opened; i++) {
    opened = await evalJS(client, `(async () => {
      const node = [...document.querySelectorAll('[role="tree"] button')]
        .find((b) => (b.title || '').includes(${JSON.stringify(SCRATCH)}) || b.textContent.includes(${JSON.stringify(SCRATCH)}));
      if (node) { node.click(); await new Promise((r) => setTimeout(r, 1200)); return true; }
      return false;
    })()`);
    if (!opened) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!opened) throw new Error('scratch_file_not_found_in_tree');
  log('scratch file opened in preview');

  // Markdown → 等右上角悬浮切换钮出现（预览态 aria-label=编辑）并进入编辑器
  let editReady = false;
  for (let i = 0; i < 10 && !editReady; i++) {
    editReady = await evalJS(client, `!!document.querySelector('[data-testid="md-view-toggle"][aria-label="编辑"]')`);
    if (!editReady) await new Promise((r) => setTimeout(r, 600));
  }
  if (!editReady) {
    const diag = await evalJS(client, `JSON.stringify({
      url: location.href.slice(0, 80),
      breadcrumb: (document.querySelector('[class*="workspaceBreadcrumb"]')?.textContent || '').slice(0, 120),
      bodyHead: (document.querySelector('[class*="workspacePreviewBody"]')?.innerHTML || 'NO_BODY').slice(0, 400),
      treeText: (document.querySelector('[role="tree"]')?.textContent || '').slice(0, 120),
    })`).catch((e) => 'diag_err ' + e.message);
    log('DIAG ' + diag);
  }
  const toolbarGone = await evalJS(client, `!document.querySelector('[class*="workspaceMarkdownDiffToolbar"]')`).catch(() => false);
  assert('C1a md 悬浮切换钮出现（aria-label=编辑）且工具条行不存在', editReady && toolbarGone);
  await evalJS(client, `(async () => {
    const toggle = document.querySelector('[data-testid="md-view-toggle"]');
    if (toggle) { toggle.click(); await new Promise((r) => setTimeout(r, 800)); }
    return 'edit';
  })()`);

  // 聚焦 CodeMirror：等 .cm-content 挂载（JS focus + execCommand 插入，block67-p1-live 同款已验证配方）
  let cmReady = false;
  for (let i = 0; i < 10 && !cmReady; i++) {
    cmReady = await evalJS(client, `!!document.querySelector('.cm-content[contenteditable="true"]')`);
    if (!cmReady) await new Promise((r) => setTimeout(r, 600));
  }
  if (!cmReady) throw new Error('codemirror_not_mounted');

  // 插入标记文本（CDP Input.insertText 在本场景不达 editor，改 execCommand 走 beforeinput 链）
  const inserted = await evalJS(client, `(async () => {
    const cm = document.querySelector('.cm-content[contenteditable="true"]');
    cm.focus();
    await new Promise((r) => setTimeout(r, 200));
    const ok = document.execCommand('insertText', false, ' autosave-marker-alpha ');
    await new Promise((r) => setTimeout(r, 300));
    return JSON.stringify({ ok, head: cm.textContent.slice(0, 100) });
  })()`);
  log('insert alpha: ' + inserted);

  // ── C1：头部按钮行已移除（工具条行 + 引用/保存/恢复 + 切换钮呈眼睛/预览态）──
  const header = JSON.parse(await evalJS(client, `JSON.stringify({
    quoteBtns: [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === '引用到对话').length,
    saveBtn: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '保存'),
    restoreBtn: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '恢复'),
    toolbarRow: !!document.querySelector('[class*="workspaceMarkdownDiffToolbar"]'),
    toggleNowPreview: document.querySelector('[data-testid="md-view-toggle"]')?.getAttribute('aria-label') === '预览',
  })`));
  assert('C1 头部零按钮行零工具条（编辑态悬浮钮=眼睛/预览）',
    header.quoteBtns === 0 && !header.saveBtn && !header.restoreBtn && !header.toolbarRow && header.toggleNowPreview,
    JSON.stringify(header));

  // ── C2：自动保存（停顿 ~1.2s 后落盘；等 2.5s 取证）──
  await new Promise((r) => setTimeout(r, 2500));
  const afterAuto = fileOnDisk();
  assert('C2 自动保存：编辑停顿后内容落盘（含 marker alpha）', afterAuto !== null && afterAuto.includes('autosave-marker-alpha'),
    `disk=${JSON.stringify((afterAuto || '').slice(-80))}`);

  // ── C3：Ctrl+S 立即保存（0.4s 内取证，早于 1.2s 防抖）──
  await evalJS(client, `(async () => {
    const cm = document.querySelector('.cm-content[contenteditable="true"]');
    if (!cm) return 'no_cm';
    cm.focus();
    await new Promise((r) => setTimeout(r, 150));
    document.execCommand('insertText', false, ' ctrl-s-marker-beta ');
    await new Promise((r) => setTimeout(r, 200));
    return 'inserted';
  })()`);
  await new Promise((r) => setTimeout(r, 200));
  await evalJS(client, `(async () => {
    const body = document.querySelector('[class*="workspacePreviewBody"]');
    if (!body) return 'no_body';
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 600));
    return 'saved';
  })()`);
  const afterCtrlS = fileOnDisk();
  assert('C3 Ctrl+S 立即保存（含 marker beta）', afterCtrlS !== null && afterCtrlS.includes('ctrl-s-marker-beta'),
    `disk=${JSON.stringify((afterCtrlS || '').slice(-80))}`);
  await screenshot(client, 'ui323-autosave.png');

  // ── C4：眼睛回预览（编辑器卸载 + 切换钮回铅笔）──
  await evalJS(client, `(async () => {
    const t = document.querySelector('[data-testid="md-view-toggle"]');
    if (t) { t.click(); await new Promise((r) => setTimeout(r, 600)); }
    return 'toggled';
  })()`);
  const backToPreview = JSON.parse(await evalJS(client, `JSON.stringify({
    cmGone: !document.querySelector('.cm-content'),
    toggleEdit: document.querySelector('[data-testid="md-view-toggle"]')?.getAttribute('aria-label') === '编辑',
  })`));
  assert('C4 眼睛回预览：编辑器卸载 + 切换钮回铅笔', backToPreview.cmGone && backToPreview.toggleEdit, JSON.stringify(backToPreview));

  // ── 清理：删暂存文件 + 恢复原页面 ──
  try { fs.rmSync(path.join(WORKSPACE, SCRATCH), { force: true }); } catch {}
  if (originalUrl && !originalUrl.startsWith(TARGET)) {
    await evalJS(client, `location.href = ${JSON.stringify(originalUrl)}; 'nav'`).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
  }

  client.socket.close();
  return results.assertions.length === 5 && results.assertions.every((a) => a.pass);
  }
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
