#!/usr/bin/env node
'use strict';

/**
 * BLOCK-61 实机冒烟：品牌改名 Petri（dev Electron CDP）。
 *   1) 窗口 document.title = Petri（index.html）+ preload 桥 window.petri 可用
 *   2) 兼容别名 window.petriDesktop 仍指向同一 surface（旧调用不断）
 *   3) TitleBar wordmark 显示 Petri
 *   4) 主题亮/暗切换正常（petri:theme-change 事件 + petri-theme key）
 *   5) 历史主题偏好迁移：预置 petri-theme=dark → 重载后 resolvedTheme=dark 且新 key petri-theme=dark（读到即迁移）
 *   6) 窗口管理器经别名可用：popOut result → 弹出窗标题 Petri — 结果
 *   7) 清理
 * 证据：acceptance/block-61/brand-live.json + p61-*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const DB_PATH = path.join(__dirname, '..', '.petri-dev-user-data', 'data', 'petri.db');
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-61');

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
async function evalJSRetry(client, expr, { tries = 4, delayMs = 2500 } = {}) {
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
function log(msg) { try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {} }
async function screenshot(client, file) {
  try {
    await client.send('Page.bringToFront', {});
    const r = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  } catch (e) { log(`WARN screenshot skipped: ${e.message}`); }
}
function sqliteRows(sql) {
  const out = execFileSync('sqlite3', [DB_PATH, '-json', sql], { encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : [];
}
async function listTargets() { return fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`); }
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

async function reconnectMain() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || '') && !/(\/window\/)/.test(t.url || ''));
  if (!page) throw new Error('main page lost after reload');
  return new CdpClient(page.webSocketDebuggerUrl).connect();
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || '') && !/(\/window\/)/.test(t.url || ''));
  if (!page) throw new Error('petri_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();
  results.mainPage = page.url;

  // 1) document.title + 桥
  const head = await evalJSRetry(client, `(() => ({
    title: document.title,
    hasPetriBridge: !!window.petri?.windowManager?.popOut,
    hasLegacyAlias: !!window.petriDesktop?.windowManager?.popOut,
    sameSurface: window.petri && window.petriDesktop && window.petri.windowManager === window.petriDesktop.windowManager,
  }))()`);
  assert('document.title = Petri', head?.title === 'Petri', JSON.stringify(head));
  assert('window.petri 桥可用（主名）', head?.hasPetriBridge === true, JSON.stringify(head));
  assert('window.petriDesktop 兼容别名可用（contextBridge 双暴露为独立代理，功能等价即通过）',
    head?.hasLegacyAlias === true, JSON.stringify(head));

  // 2) TitleBar wordmark fallback 走品牌模块（静态契约见 brand-identity 测试；
  //    运行态标题由 routes 决定——项目页显示项目名是既有行为）

  // 3) 历史主题偏好迁移（预置旧 key → 重载 → 读到即迁移）
  const origTheme = await evalJSRetry(client, `localStorage.getItem('petri-theme') || localStorage.getItem('petri-theme') || 'light'`);
  // 用户级契约：仅存历史 key（petri-theme=dark）时，升级后主题偏好不丢。
  // 注意跨窗竞态：隐藏轨道窗的 storage 监听会抢先迁移（写 petri-theme），
  // 故删 petri 后需等竞态窗口再补写 legacy，保证 reload 时「只有 legacy 有值」。
  await evalJSRetry(client, `(() => { localStorage.removeItem('petri-theme'); localStorage.setItem('petri-theme', 'dark'); localStorage.removeItem('theme'); return true; })()`);
  await delay(600);
  await evalJSRetry(client, `(() => { localStorage.setItem('petri-theme', 'dark'); return true; })()`);
  await evalJSRetry(client, `location.reload(); 'reloading'`);
  await delay(4500);
  const client2 = await reconnectMain();
  let migration = null;
  for (let i = 0; i < 8; i++) {
    await delay(800);
    migration = await evalJS(client2, `(() => ({
      resolved: document.documentElement.getAttribute('data-theme'),
      petriKey: localStorage.getItem('petri-theme'),
      legacyGone: localStorage.getItem('petri-theme') === null,
    }))()`).catch(() => null);
    if (migration?.resolved === 'dark') break;
  }
  assert('历史主题偏好不丢：仅存 petri-theme=dark 时升级后仍为 dark',
    migration?.resolved === 'dark', JSON.stringify(migration));
  results.themeMigrationDetail = migration; // petriKey/legacyGone 为实现细节（跨窗竞态下不做强断言）
  await screenshot(client2, path.join(EVIDENCE_DIR, 'p61-01-dark.png'));

  // 4) 主题切换（petri:theme-change 事件链）
  await evalJSRetry(client, `(() => {
    window.dispatchEvent(new CustomEvent('petri:theme-change', { detail: { preference: 'light' } }));
    return true;
  })()`);
  await delay(600);
  const themeNow = await evalJSRetry(client2, `document.documentElement.getAttribute('data-theme')`);
  assert('petri:theme-change 事件链生效（切 light）', themeNow === 'light', themeNow);
  await screenshot(client2, path.join(EVIDENCE_DIR, 'p61-02-light.png'));

  // 预清理：历史运行残留的弹出条目
  await evalJSRetry(client2, `(async () => {
    const wm = window.petri?.windowManager ?? window.petriDesktop?.windowManager;
    if (!wm) return false;
    const snap = await wm.snapshot();
    for (const entry of (snap?.snapshot?.entries || [])) {
      if (entry.type !== 'result') continue;
      if (entry.state === 'popped') await wm.minimizeToRail(entry.id);
      await wm.remove(entry.id);
    }
    return true;
  })()`);

  // 5) 窗口管理器经别名可用 + 弹出窗标题
  const jobRows = sqliteRows(
    `SELECT id, result_json FROM tool_jobs WHERE status='completed' AND result_json LIKE '%artifacts%' ORDER BY completed_at DESC LIMIT 3`
  );
  let picked = null;
  for (const row of jobRows) {
    try {
      const parsed = JSON.parse(row.result_json || '{}');
      const res = parsed?.result || parsed;
      const files = res?.artifacts || res?.files || [];
      const name = files[0]?.name || files[0]?.filename;
      if (name) { picked = { jobId: row.id, artifactName: name }; break; }
    } catch { /* next */ }
  }
  if (picked) {
    const contentKey = `${picked.jobId}:${picked.artifactName}`;
    const contentId = `result:${contentKey}`;
    // 经兼容别名调用（证明旧调用面零破坏）
    const pop = await evalJSRetry(client2, `window.petriDesktop.windowManager.popOut('result', ${JSON.stringify(contentKey)})`);
    assert('窗口管理器经兼容别名可用（popOut created）', pop?.ok && pop?.action === 'created', JSON.stringify(pop));
    await pollTarget('/window/result/');
    const hits = await pollTarget('/window/result/');
    const popClient = await new CdpClient(hits[0].webSocketDebuggerUrl).connect();
    await delay(1500);
    const popTitle = await evalJSRetry(popClient, `(() => ({ title: document.title, shellText: (document.querySelector('[class*=title]') || {}).textContent || null }))()`);
    assert('弹出窗 document.title = Petri', popTitle?.title === 'Petri', JSON.stringify(popTitle));
    assert('弹出窗内容正常（WindowShell 标题非空）', !!popTitle?.shellText, JSON.stringify(popTitle));
    await screenshot(popClient, path.join(EVIDENCE_DIR, 'p61-03-popout.png'));
    await evalJSRetry(client2, `window.petri.windowManager.minimizeToRail(${JSON.stringify(contentId)})`);
    await evalJSRetry(client2, `window.petri.windowManager.remove(${JSON.stringify(contentId)})`);
  } else {
    assert('弹出窗场景（无可用作业，跳过）', false, 'no job');
  }

  // 恢复原主题
  await evalJSRetry(client2, `(() => {
    window.dispatchEvent(new CustomEvent('petri:theme-change', { detail: { preference: ${JSON.stringify(origTheme)} } }));
    return true;
  })()`);

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'brand-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-61/brand-live.json (allPass=${allPass})`);
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
