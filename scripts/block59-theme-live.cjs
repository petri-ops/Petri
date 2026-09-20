#!/usr/bin/env node
'use strict';

/**
 * BLOCK-59 加映（用户反馈）—— 弹出窗外观主题与主窗一致性实机断言。
 *   根因：窗口 CSS 模块引用了不存在的 --biof3-bg-primary 等编造令牌，
 *   全部吃硬编码暗色兜底 → 弹窗永远是暗色，与主窗主题脱钩。
 *   修复：全部改用 custom.css 语义令牌（bg-canvas/surface/subtle、
 *   status-success、text/accent 族，明暗双主题自动适配）。
 *   验证：
 *     1) 主窗切 light → 弹出结果窗：html[data-theme=light] + shell 背景为亮色画布
 *     2) 主窗切 dark → 已打开的弹窗经 storage 事件实时跟随（data-theme=dark + 暗色画布）
 *     3) 指挥中心瓦片背景随主题（同一令牌面）
 *     4) 恢复原主题偏好 + 清理
 * 证据：acceptance/block-59/theme-live.json + p59-theme-light/dark.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const DB_PATH = process.env.BIOF59_DB
  || path.join(__dirname, '..', '.biof3-dev-user-data', 'data', 'biof3.db');
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-59');

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

function sqliteRows(sql) {
  const out = execFileSync2('sqlite3', [DB_PATH, '-json', sql]);
  return out.trim() ? JSON.parse(out) : [];
}

function execFileSync2(cmd, args) {
  const { execFileSync } = require('node:child_process');
  return execFileSync(cmd, args, { encoding: 'utf8' });
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

const LIGHT_CANVAS = 'rgb(255, 255, 255)';
const DARK_CANVAS = 'rgb(11, 18, 32)';

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || '') && !/(\/window\/)/.test(t.url || ''));
  if (!page) throw new Error('biof3_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();
  results.mainPage = page.url;

  const origPref = await evalJSRetry(client, `localStorage.getItem('biof3-theme') || localStorage.getItem('theme') || 'system'`);
  const setTheme = (pref) => evalJSRetry(client, `(() => {
    window.dispatchEvent(new CustomEvent('gewu:theme-change', { detail: { preference: '${pref}' } }));
    return document.documentElement.getAttribute('data-theme');
  })()`);
  const restoreTheme = () => evalJSRetry(client, `(() => {
    window.dispatchEvent(new CustomEvent('gewu:theme-change', { detail: { preference: ${JSON.stringify(origPref)} } }));
    return true;
  })()`);

  // 幂等预清理：移除残留 result 条目
  const jobRows = sqliteRows(
    `SELECT id, name, result_json FROM tool_jobs
     WHERE status='completed' AND result_json LIKE '%artifacts%' ORDER BY completed_at DESC LIMIT 5`
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
  if (!picked) throw new Error('no_completed_job');
  const contentKey = `${picked.jobId}:${picked.artifactName}`;
  const contentId = `result:${contentKey}`;
  const pre = await evalJSRetry(client, `(async () => {
    const wm = window.biof3Desktop?.windowManager;
    if (!wm) return { bridge: false };
    const snap = await wm.snapshot();
    const entry = (snap?.snapshot?.entries || []).find((e) => e.id === ${JSON.stringify(contentId)});
    if (entry) {
      if (entry.state === 'popped') await wm.minimizeToRail(entry.id);
      await wm.remove(entry.id);
    }
    return { bridge: true };
  })()`);
  assert('主窗桥可用 + 预清理', pre?.bridge === true, JSON.stringify(pre));

  // 1) light 主题 → 弹出结果窗
  await setTheme('light');
  await delay(600);
  const pop = await evalJSRetry(client, `window.biof3Desktop.windowManager.popOut('result', ${JSON.stringify(contentKey)})`);
  assert('结果窗弹出（light 主题下）', pop?.ok === true, JSON.stringify(pop));
  const hits = await pollTarget('/window/result/');
  const popClient = await new CdpClient(hits[0].webSocketDebuggerUrl).connect();
  await delay(1500);
  const lightState = await evalJSRetry(popClient, `(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    shellBg: getComputedStyle(document.querySelector('[class*=shell]')).backgroundColor,
    headerBg: getComputedStyle(document.querySelector('[class*=header]')).backgroundColor,
    titleColor: getComputedStyle(document.querySelector('[class*=title]')).color,
  }))()`);
  assert('弹窗 data-theme=light（与主窗一致）', lightState?.theme === 'light', JSON.stringify(lightState));
  assert('弹窗外壳背景 = 亮色画布（真实令牌生效）', lightState?.shellBg === LIGHT_CANVAS, JSON.stringify(lightState));
  await screenshot(popClient, path.join(EVIDENCE_DIR, 'p59-theme-light.png'));

  // 2) 主窗切 dark → 已打开弹窗实时跟随（storage 事件）
  await setTheme('dark');
  let darkState = null;
  for (let i = 0; i < 10; i++) {
    await delay(700);
    darkState = await evalJS(popClient, `(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      shellBg: getComputedStyle(document.querySelector('[class*=shell]')).backgroundColor,
    }))()`);
    if (darkState?.theme === 'dark' && darkState?.shellBg === DARK_CANVAS) break;
  }
  assert('主窗切暗 → 弹窗实时跟随（data-theme=dark）', darkState?.theme === 'dark', JSON.stringify(darkState));
  assert('弹窗外壳背景 = 暗色画布（#0b1220）', darkState?.shellBg === DARK_CANVAS, JSON.stringify(darkState));
  const mainTheme = await evalJSRetry(client, `document.documentElement.getAttribute('data-theme')`);
  assert('弹窗与主窗 data-theme 一致（dark）', mainTheme === darkState?.theme, `main=${mainTheme} pop=${darkState?.theme}`);
  await screenshot(popClient, path.join(EVIDENCE_DIR, 'p59-theme-dark.png'));

  // 3) 指挥中心瓦片同一令牌面（dark 下暗色表面）
  await evalJSRetry(client, `window.biof3Desktop.windowManager.popOut('command-center')`);
  const ccHits = await pollTarget('/window/command-center');
  const ccClient = await new CdpClient(ccHits[0].webSocketDebuggerUrl).connect();
  await delay(2000);
  const ccState = await evalJSRetry(ccClient, `(() => {
    const tile = document.querySelector('button[class*=tile]');
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      tileBg: tile ? getComputedStyle(tile).backgroundColor : null,
    };
  })()`);
  assert('指挥中心瓦片暗色表面（bg-surface 令牌）', ccState?.theme === 'dark' && ccState?.tileBg === 'rgb(17, 26, 46)', JSON.stringify(ccState));
  await evalJSRetry(ccClient, `(() => { window.close(); return true; })()`);

  // 4) 清理 + 恢复原主题
  await evalJSRetry(client, `window.biof3Desktop.windowManager.minimizeToRail(${JSON.stringify(contentId)})`);
  await evalJSRetry(client, `window.biof3Desktop.windowManager.remove(${JSON.stringify(contentId)})`);
  await restoreTheme();
  log(`主题偏好已恢复: ${origPref}`);

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'theme-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-59/theme-live.json (allPass=${allPass})`);
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
