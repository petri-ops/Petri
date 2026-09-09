#!/usr/bin/env node
'use strict';

/**
 * BLOCK-68 UI-317 实机 CDP 验收（dev Electron + vite HMR 后 reload）：
 *   1) composer 右侧 ⋯ 工具按钮已移除（sc-toolbar-more / 更多工具 不存在），
 *      发送/供应商/模型控件仍在
 *   2) projectWorkspaceChanged 信号派发不报错（自动重解析链路已由
 *      useAutoFileReferenceRefresh 单测覆盖，此处验证实机接线无异常）
 *   3) 右栏工具菜单含「模型 I/O」，点开后 llm-tr-dock 渲染当前会话的调用记录；
 *      新建会话后 dock 内容随会话切换（新会话无记录 → 诚实空态）
 *   4) 右栏 home 空态：头部四件套（emptyResultIcon/Title/Desc/Project）不存在，
 *      六卡片仅 图标+名称（无 <small> 副标题）
 * 前置：dev Electron（--remote-debugging-port=9222）+ vite :3000 + 已有含模型调用的会话。
 * 证据：acceptance/block-68/ui317-live.json + ui317-*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-68');

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
  // 多窗口并存：必须选带左栏项目树 + 右栏的主窗口（另一扇可能是面板全收起的壳窗口）
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

  // reload 让 HMR 增量补丁归位为整页最新 bundle
  await client.send('Page.reload');
  await new Promise((r) => setTimeout(r, 6000));

  // ── 断言 1：⋯ 菜单移除，composer 右侧收敛 ──
  const composerState = JSON.parse(await evalJS(client, `JSON.stringify({
    moreMenu: !!document.querySelector('.sc-toolbar-more'),
    moreBtn: !!document.querySelector('button[aria-label="更多工具"]'),
    send: !!document.querySelector('.sc-send-cta'),
    providerBtn: !!document.querySelector('.sc-model-provider-btn'),
    modelBtn: !!document.querySelector('.sc-model-name-btn'),
    budgetRing: !!document.querySelector('[class*="contextBudget"], [class*="ContextBudget"]'),
    refreshItem: [...document.querySelectorAll('.sc-access-option-title')].some((e) => e.textContent.includes('刷新文件链接')),
    ioItemInComposer: [...document.querySelectorAll('.sc-access-option-title')].some((e) => e.textContent.includes('模型 I/O')),
  })`));
  assert('B1 ⋯ 菜单与「更多工具」按钮已移除', !composerState.moreMenu && !composerState.moreBtn, JSON.stringify(composerState));
  assert('B2 composer 保留 发送/供应商/模型 控件', composerState.send && composerState.providerBtn && composerState.modelBtn,
    `send=${composerState.send} provider=${composerState.providerBtn} model=${composerState.modelBtn}`);
  assert('B3 菜单项「刷新文件链接 / 模型 I/O」不再出现在 composer', !composerState.refreshItem && !composerState.ioItemInComposer,
    `refresh=${composerState.refreshItem} io=${composerState.ioItemInComposer}`);

  // ── 断言 2：projectWorkspaceChanged 派发无异常（接线已由单测覆盖）──
  const evtState = JSON.parse(await evalJS(client, `(async () => {
    try {
      window.dispatchEvent(new CustomEvent('gewu:project-workspace-changed', { detail: { projectId: 'p_live', source: 'agent' } }));
      await new Promise((r) => setTimeout(r, 900));
      return JSON.stringify({ ok: true, composerStill: !!document.querySelector('textarea.sc-input') });
    } catch (e) { return JSON.stringify({ ok: false, err: String(e) }); }
  })()`));
  assert('B4 projectWorkspaceChanged 派发后应用无异常', evtState.ok && evtState.composerStill, JSON.stringify(evtState));

  // ── 断言 3：右栏「模型 I/O」tab 打开且内容随会话 ──
  // 打开工具飞出菜单（TitleBar onMoreAction），点「模型 I/O」
  const flyoutOpened = await evalJS(client, `(() => {
    const btns = [...document.querySelectorAll('button')];
    const more = btns.find((b) => (b.getAttribute('title') || '').includes('更多') || (b.getAttribute('aria-label') || '').includes('更多'));
    if (!more) return JSON.stringify({ ok: false, reason: 'no_more_btn' });
    more.click();
    return JSON.stringify({ ok: true });
  })()`);
  await new Promise((r) => setTimeout(r, 500));
  const ioClick = await evalJS(client, `(() => {
    const items = [...document.querySelectorAll('button, [role="menuitem"]')].filter((e) => e.textContent.trim() === '模型 I/O' || e.textContent.includes('模型 I/O'));
    const item = items.pop();
    if (!item) return JSON.stringify({ ok: false, reason: 'no_io_item' });
    item.click();
    return JSON.stringify({ ok: true });
  })()`);
  await new Promise((r) => setTimeout(r, 1200));
  const ioState = JSON.parse(await evalJS(client, `JSON.stringify({
    dock: !!document.querySelector('.llm-tr-dock'),
    rows: document.querySelectorAll('.llm-tr-row').length,
    headText: (document.querySelector('.llm-tr-title')?.textContent || ''),
    tabOpen: [...document.querySelectorAll('[class*="tab"]')].some((e) => e.textContent.trim() === '模型 I/O'),
  })`));
  const flyoutOk = (flyoutOpened.includes('"ok":true') || flyoutOpened.includes('"ok":true')) && ioClick.includes('"ok":true');
  assert('B5 右栏工具菜单含「模型 I/O」且可打开', flyoutOk, `flyout=${flyoutOpened} ioClick=${ioClick}`);
  assert('B6 llm-tr-dock 渲染当前会话调用记录', ioState.dock && ioState.rows >= 1 && ioState.headText.includes('模型 I/O'),
    JSON.stringify(ioState));

  // 会话切换随动：新建会话（无记录）→ dock 显示诚实空态
  await evalJS(client, `(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.title === '创建新对话' && !b.disabled);
    if (btn) btn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 2500));
  const ioAfterSwitch = JSON.parse(await evalJS(client, `JSON.stringify({
    dock: !!document.querySelector('.llm-tr-dock'),
    emptyText: (document.querySelector('.llm-tr-state')?.textContent || ''),
    rows: document.querySelectorAll('.llm-tr-row').length,
  })`));
  assert('B7 会话切换后 dock 内容随动（新会话诚实空态）',
    ioAfterSwitch.dock && (ioAfterSwitch.rows === 0 || ioAfterSwitch.emptyText.includes('暂无模型调用记录')),
    JSON.stringify(ioAfterSwitch));

  // ── 断言 4：右栏 home 空态极简 ──
  const homeState = JSON.parse(await evalJS(client, `JSON.stringify({
    empty: !!document.querySelector('[class*="emptyResult"]'),
    icon: document.querySelectorAll('[class*="emptyResultIcon"]').length,
    title: document.querySelectorAll('[class*="emptyResultTitle"]').length,
    desc: document.querySelectorAll('[class*="emptyResultDesc"]').length,
    project: document.querySelectorAll('[class*="emptyResultProject"]').length,
    cards: document.querySelectorAll('[class*="emptyResultLaunchCard"]').length,
    smalls: document.querySelectorAll('[class*="emptyResultLaunchCard"] small').length,
  })`));
  assert('B8 home 空态：头部四件套已删除', homeState.empty && !homeState.icon && !homeState.title && !homeState.desc && !homeState.project,
    JSON.stringify(homeState));
  assert('B9 home 空态：六卡片仅 图标+名称（无 small 副标题）', homeState.cards === 6 && homeState.smalls === 0,
    `cards=${homeState.cards} smalls=${homeState.smalls}`);

  await screenshot(client, 'ui317-live.png');

  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui317-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`allPass=${results.allPass}`);
  client.socket.close();
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
