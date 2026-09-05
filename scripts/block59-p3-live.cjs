#!/usr/bin/env node
'use strict';

/**
 * BLOCK-59 P3 用户侧实机 CDP 断言驱动：指挥中心（多任务俯瞰单例窗，dev Electron）。
 *   场景 D（P3）：
 *     1) popOut('command-center') → 单例窗创建（/window/command-center target）
 *     2) 重复弹出 → focused（单例不双开）
 *     3) 瓦片只读投影：/api/tools/history 既有真相 → 真实作业名上屏（与 SQLite 交叉核对）
 *     4) 点击瓦片 → 下钻弹出 L1 结果窗（popOut result + target 出现）
 *     5) × 关闭指挥中心（无状态单例随开随关）→ target 消失；下钻窗不受影响
 *   瓦片实时进度形态 = 状态 + 已耗时（tool_jobs 无百分比，不虚构进度条）。
 * 前置：dev Electron 已在跑；本地库存在 completed 作业。
 * 证据：acceptance/block-59/p3-live.json + p59-p3-01-command-center.png
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
  const out = execFileSync('sqlite3', [DB_PATH, '-json', sql], { encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : [];
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

  // 1) 指挥中心弹出（单例）
  const pop = await evalJSRetry(client, `window.biof3Desktop.windowManager.popOut('command-center')`);
  assert('指挥中心弹出 → created（单例通道）', pop?.ok && (pop?.action === 'created' || pop?.action === 'focused'), JSON.stringify(pop));
  const ccHits = await pollTarget('/window/command-center');
  assert('指挥中心 target 出现', Array.isArray(ccHits) && ccHits.length === 1, `targets=${ccHits?.length}`);

  // 2) 单例不双开
  const pop2 = await evalJSRetry(client, `window.biof3Desktop.windowManager.popOut('command-center')`);
  const ccCount = (await listTargets()).filter((t) => (t.url || '').includes('/window/command-center')).length;
  assert('重复弹出 → focused（单例不双开）', pop2?.ok && pop2?.action === 'focused' && ccCount === 1, `action=${pop2?.action} targets=${ccCount}`);

  // 3) 瓦片只读投影（与 SQLite 真相交叉核对）
  const ccClient = await new CdpClient(ccHits[0].webSocketDebuggerUrl).connect();
  await delay(2500);
  const recentJobs = sqliteRows(
    `SELECT id, name, tool_id, status FROM tool_jobs ORDER BY created_at DESC LIMIT 12`
  );
  const expectedName = (recentJobs.find((j) => (j.name || '').trim()) || {}).name || '';
  const tileState = await evalJSRetry(ccClient, `(() => ({
    tiles: document.querySelectorAll('button[class*=tile]').length,
    bodyText: (document.body.textContent || '').slice(0, 1200),
    hasRunningPulse: !!document.querySelector('[data-status="running"]'),
  }))()`);
  assert('指挥中心瓦片渲染（最近 12 作业内）', tileState?.tiles > 0 && tileState?.tiles <= 12, `tiles=${tileState?.tiles}`);
  assert('瓦片内容与 tool_jobs 真相一致（真实作业名上屏）',
    expectedName && tileState?.bodyText?.includes(expectedName.split(' ').slice(0, 2).join(' ')),
    `expected~="${expectedName.slice(0, 40)}"`);
  await screenshot(ccClient, path.join(EVIDENCE_DIR, 'p59-p3-01-command-center.png'));

  // 4) 点击瓦片 → 下钻 L1 结果窗
  const drill = await evalJSRetry(ccClient, `(() => {
    const tile = document.querySelector('[class*=tile]');
    tile.click();
    return { ok: true };
  })()`);
  assert('点击瓦片触发下钻', drill?.ok === true, JSON.stringify(drill));
  const resultHits = await pollTarget('/window/result/');
  const snapDrill = await evalJSRetry(client, `window.biof3Desktop.windowManager.snapshot()`);
  const poppedEntry = (snapDrill?.snapshot?.entries || []).find((e) => e.state === 'popped');
  assert('下钻 → L1 结果窗弹出（popOut result + target 出现）',
    Array.isArray(resultHits) && resultHits.length >= 1 && !!poppedEntry,
    JSON.stringify({ targets: resultHits?.length, entry: poppedEntry?.id }));

  // 5) × 关闭指挥中心（无状态单例随开随关）
  await evalJSRetry(ccClient, `(() => { window.close(); return true; })()`);
  const gone = await pollTarget('/window/command-center', { appear: false });
  assert('× 关闭指挥中心 → target 消失（不进轨道，随开随关）', Array.isArray(gone) && gone.length === 0, `targets=${gone?.length}`);
  const snapFinal = await evalJSRetry(client, `window.biof3Desktop.windowManager.snapshot()`);
  assert('指挥中心关闭不影响已下钻的结果窗（注册表 popped 仍在）',
    (snapFinal?.snapshot?.entries || []).some((e) => e.state === 'popped'), JSON.stringify(snapFinal?.snapshot?.entries?.map((e) => ({ id: e.id, state: e.state }))));

  // 清理：移除下钻残留
  const leftover = (snapFinal?.snapshot?.entries || []).find((e) => e.state === 'popped');
  if (leftover) {
    await evalJSRetry(client, `window.biof3Desktop.windowManager.minimizeToRail(${JSON.stringify(leftover.id)})`);
    await evalJSRetry(client, `window.biof3Desktop.windowManager.remove(${JSON.stringify(leftover.id)})`);
  }

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p3-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-59/p3-live.json (allPass=${allPass})`);
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
