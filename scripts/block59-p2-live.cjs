#!/usr/bin/env node
'use strict';

/**
 * BLOCK-59 P2 用户侧实机 CDP 断言驱动：终端独立窗（升格 Tab）+ 边缘活动轨道（dev Electron）。
 *   场景 C（P2）：
 *     1) 主窗桥 startSession → pty 会话运行
 *     2) popOut('terminal', sessionId) → /window/terminal/ 独立窗 target + xterm 挂载
 *     3) 数据面：主窗 writeSession → pty echo → 受管窗转发 → 弹出窗收到（terminal.js forward 实锤）
 *     4) × 降格 → railed → 轨道容器窗出现（/window/rail visible）
 *     5) 轨道刻度渲染（data-kind=terminal）+ 点击刻度 = 恢复 → popped
 *     6) 恢复后轨道隐藏（visibilityState hidden）
 *     7) 再降格 → 轨道「显式移除」等价路径（remove）→ 轨道隐藏 + 注册表终结
 *   静态 5min 淡出：railEntries.isFadedRailEntry 单测覆盖（14/14），实机不做 5min 等待。
 * 前置：dev Electron 已在跑（主进程已含 P2 代码——terminal.js 转发 + 轨道窗）。
 * 证据：acceptance/block-59/p2-live.json + p59-p2-*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-59');
const SESSION_ID = process.env.BIOF59_SESSION || 'default';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function evalJS(client, expr) {
  const r = await Promise.race([
    client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('cdp_eval_timeout_30s')), 30000)),
  ]);
  if (r.exceptionDetails) {
    throw new Error(`evaluate_failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`.slice(0, 500));
  }
  return r.result.value;
}

async function evalJSRetry(client, expr, { tries = 6, delayMs = 2500 } = {}) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { return await evalJS(client, expr); } catch (e) {
      lastErr = e;
      if (!/-32000|context|cdp_command_failed/i.test(e.message)) throw e;
      await delay(delayMs);
    }
  }
  throw lastErr;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function log(msg) {
  try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {}
}

async function screenshot(client, file) {
  try {
    await client.send('Page.bringToFront', {});
    const r = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  } catch (e) {
    log(`WARN screenshot skipped (${path.basename(file)}): ${e.message}`);
  }
}

async function listTargets() {
  return fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
}

async function pollTarget(needle, { appear = true, tries = 20, delayMs = 700 } = {}) {
  for (let i = 0; i < tries; i++) {
    const targets = await listTargets();
    const hits = targets.filter((t) => t.type === 'page' && (t.url || '').includes(needle));
    if (appear && hits.length > 0) return hits;
    if (!appear && hits.length === 0) return [];
    await delay(delayMs);
  }
  return appear ? null : [];
}

const results = { startedAt: new Date().toISOString(), assertions: [] };
function assert(name, pass, detail = '') {
  results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 500) });
  log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`);
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || '') && !/(\/window\/)/.test(t.url || ''));
  if (!page) throw new Error('biof3_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();
  results.mainPage = page.url;

  // 幂等预清理：上轮残留（terminal 条目 / default 会话）
  const pre = await evalJSRetry(client, `(async () => {
    const wm = window.biof3Desktop?.windowManager;
    if (!wm) return { bridge: false };
    const snap = await wm.snapshot();
    const entry = (snap?.snapshot?.entries || []).find((e) => e.id === 'terminal:${SESSION_ID}');
    if (entry) {
      if (entry.state === 'popped') await wm.minimizeToRail(entry.id);
      await wm.remove(entry.id);
    }
    await window.biof3Desktop.terminal.stopSession('${SESSION_ID}');
    return { bridge: true, cleaned: !!entry };
  })()`);
  assert('主窗 windowManager/terminal 桥可用 + 预清理', pre?.bridge === true, JSON.stringify(pre));

  // 1) 起会话
  const started = await evalJSRetry(client, `window.biof3Desktop.terminal.startSession(undefined, '${SESSION_ID}')`);
  assert('终端会话启动（主窗 tab 语义，pty 运行中）', started?.ok === true && started?.sessionId === '${SESSION_ID}'.replace('${SESSION_ID}', SESSION_ID), JSON.stringify(started));

  // 2) 升格为窗
  const pop = await evalJSRetry(client, `window.biof3Desktop.windowManager.popOut('terminal', '${SESSION_ID}')`);
  assert('终端 Tab 升格 → created（terminal:<sessionId>）', pop?.ok && pop?.action === 'created' && pop?.id === `terminal:${SESSION_ID}`, JSON.stringify(pop));
  const popHits = await pollTarget('/window/terminal/');
  assert('终端独立窗 target 出现', Array.isArray(popHits) && popHits.length === 1, `targets=${popHits?.length}`);
  const popClient = await new CdpClient(popHits[0].webSocketDebuggerUrl).connect();
  await delay(2000);

  const termDom = await evalJSRetry(popClient, `(() => ({
    hasXterm: !!document.querySelector('.xterm'),
    hasHost: !!document.querySelector('[data-terminal-host]'),
    attachNote: (document.querySelector('[class*=subtitle]') || {}).textContent || null,
  }))()`);
  assert('终端独立窗 xterm 挂载', termDom?.hasXterm === true, JSON.stringify(termDom));
  await screenshot(popClient, path.join(EVIDENCE_DIR, 'p59-p2-01-terminal-window.png'));

  // 3) 数据面：主窗写入 → pty echo → 受管窗转发 → 弹出窗收到
  await evalJSRetry(popClient, `(() => { window.__p59probe = ''; window.biof3Desktop.terminal.onData((p) => { if (p.sessionId === '${SESSION_ID}') window.__p59probe += String(p.data || ''); }); return true; })()`);
  const marker = `B59P2-${Date.now()}`;
  await evalJSRetry(client, `window.biof3Desktop.terminal.writeSession('echo ${marker}\\r', '${SESSION_ID}')`);
  let probeHit = false;
  for (let i = 0; i < 15; i++) {
    await delay(600);
    const probe = await evalJS(popClient, `window.__p59probe`);
    if (String(probe).includes(marker)) { probeHit = true; break; }
  }
  assert('数据面实锤：主窗写入 → pty echo → 转发 → 弹出窗收到', probeHit, `marker=${marker}`);
  const termLines = await evalJS(popClient, `(() => { const el = document.querySelector('.xterm-rows'); return el ? el.textContent.length : 0; })()`);
  assert('弹出窗终端有真实渲染内容（xterm rows 非空）', termLines > 0, `chars=${termLines}`);

  // 4) × 降格 → 轨道出现
  const mini = await evalJSRetry(client, `window.biof3Desktop.windowManager.minimizeToRail('terminal:${SESSION_ID}')`);
  assert('× → 降格 railed（终端常驻不淡出）', mini?.ok && mini?.state === 'railed', JSON.stringify(mini));
  const railHits = await pollTarget('/window/rail');
  assert('轨道容器窗 target 出现（懒创建）', Array.isArray(railHits) && railHits.length >= 1, `targets=${railHits?.length}`);
  await delay(1500);
  const railClient = await new CdpClient(railHits[0].webSocketDebuggerUrl).connect();
  const railState1 = await evalJSRetry(railClient, `(() => ({
    visible: document.visibilityState,
    tickCount: document.querySelectorAll('[class*=tick]').length,
    terminalTick: !!document.querySelector('[data-kind="terminal"]'),
    fadedAttr: !!document.querySelector('[data-faded]'),
  }))()`);
  assert('轨道窗可见且渲染终端刻度（data-kind=terminal）', railState1?.visible === 'visible' && railState1?.terminalTick, JSON.stringify(railState1));
  await screenshot(railClient, path.join(EVIDENCE_DIR, 'p59-p2-02-rail.png'));

  // 5) 点击刻度 = 恢复
  await evalJSRetry(railClient, `(() => { const t = document.querySelector('[data-kind="terminal"]'); t.click(); return true; })()`);
  await delay(1500);
  const snapRestored = await evalJSRetry(client, `window.biof3Desktop.windowManager.snapshot()`);
  const restoredEntry = (snapRestored?.snapshot?.entries || []).find((e) => e.id === `terminal:${SESSION_ID}`);
  assert('轨道刻度点击 → popped（hover 恢复路径的点击等价）', restoredEntry?.state === 'popped', JSON.stringify(restoredEntry));

  // 6) 恢复后轨道隐藏
  let railHidden = false;
  for (let i = 0; i < 10; i++) {
    await delay(600);
    const vis = await evalJS(railClient, `document.visibilityState`);
    if (vis === 'hidden') { railHidden = true; break; }
  }
  assert('无降格窗口时轨道自动隐藏（visibilityState hidden）', railHidden);

  // 7) 再降格 → 轨道显式移除 → 轨道隐藏 + 条目终结
  await evalJSRetry(client, `window.biof3Desktop.windowManager.minimizeToRail('terminal:${SESSION_ID}')`);
  await pollTarget('/window/rail');
  await evalJSRetry(client, `window.biof3Desktop.windowManager.remove('terminal:${SESSION_ID}')`);
  const snapFinal = await evalJSRetry(client, `window.biof3Desktop.windowManager.snapshot()`);
  assert('轨道显式移除 → 条目终结', !((snapFinal?.snapshot?.entries || []).some((e) => e.id === `terminal:${SESSION_ID}`)));
  let railHidden2 = false;
  for (let i = 0; i < 10; i++) {
    await delay(600);
    const vis = await evalJS(railClient, `document.visibilityState`).catch(() => 'gone');
    if (vis !== 'visible') { railHidden2 = true; break; }
  }
  assert('移除后轨道隐藏（常驻窗保活不销毁）', railHidden2);

  // 清理：停 pty 会话
  await evalJSRetry(client, `window.biof3Desktop.terminal.stopSession('${SESSION_ID}')`);

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p2-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-59/p2-live.json (allPass=${allPass})`);
  process.exit(allPass ? 0 : 1);
}

const watchdog = setTimeout(() => {
  console.error('FAIL UI 实机脚本 10min 看门狗超时');
  process.exit(1);
}, 10 * 60 * 1000);
watchdog.unref();

main().catch((e) => {
  console.error('FAIL 脚本异常:', e && e.message);
  process.exit(1);
});
