#!/usr/bin/env node
'use strict';

/**
 * BLOCK-59 加映三实机：轨道滚轮换卡 + 卡片垂直钳位（plan §5 补全，用户裁决开干）。
 *   断言：
 *     1) 两个不同作业降格 → 轨道 2 刻度
 *     2) hover 第一个刻度 → 卡标题 = 该条目
 *     3) 条带上滚轮 deltaY>0 → 卡切换到下一（更旧）条目；deltaY<0 → 切回
 *     4) 钳位：卡 rect.top ≥ 12 且 rect.bottom ≤ innerHeight - 12（不越窗口界）
 *     5) 点击恢复 + 清理两个条目
 * 前置：dev Electron 在跑；本地库 ≥2 个带产物的 completed 作业。
 * 证据：acceptance/block-59/rail-wheel-live.json + p59-rail-wheel.png
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const DB_PATH = process.env.BIOF59_DB
  || path.join(__dirname, '..', '.petri-dev-user-data', 'data', 'petri.db');
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

  // 选两个不同作业
  const jobRows = sqliteRows(
    `SELECT id, name, result_json FROM tool_jobs
     WHERE status='completed' AND result_json LIKE '%artifacts%' ORDER BY completed_at DESC LIMIT 10`
  );
  const picked = [];
  for (const row of jobRows) {
    if (picked.length >= 2) break;
    try {
      const parsed = JSON.parse(row.result_json || '{}');
      const res = parsed?.result || parsed;
      const files = res?.artifacts || res?.files || [];
      const name = files[0]?.name || files[0]?.filename;
      if (name && !picked.some((p) => p.jobId === row.id)) {
        picked.push({ jobId: row.id, artifactName: name });
      }
    } catch { /* next */ }
  }
  assert('存在 ≥2 个可用 completed 作业', picked.length === 2, JSON.stringify(picked));
  if (picked.length < 2) throw new Error('need_two_jobs');
  const ids = picked.map((p) => `result:${p.jobId}:${p.artifactName}`);

  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || '') && !/(\/window\/)/.test(t.url || ''));
  if (!page) throw new Error('petri_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();

  // 幂等预清理
  await evalJSRetry(client, `(async () => {
    const wm = window.petriDesktop?.windowManager;
    if (!wm) return false;
    const snap = await wm.snapshot();
    for (const id of ${JSON.stringify(ids)}) {
      const entry = (snap?.snapshot?.entries || []).find((e) => e.id === id);
      if (entry) {
        if (entry.state === 'popped') await wm.minimizeToRail(id);
        await wm.remove(id);
      }
    }
    return true;
  })()`);

  // 两个作业各弹出一次（禁双开：各 created）→ 逐个降格
  for (const p of picked) {
    await evalJSRetry(client, `window.petriDesktop.windowManager.popOut('result', ${JSON.stringify(`${p.jobId}:${p.artifactName}`)})`);
    await pollTarget(`/window/result/${encodeURIComponent(`${p.jobId}:${p.artifactName}`)}`);
    await delay(1000); // 首帧渲染后再降格（快照有内容）
    await evalJSRetry(client, `window.petriDesktop.windowManager.minimizeToRail(${JSON.stringify(`result:${p.jobId}:${p.artifactName}`)})`);
  }
  const railHits = await pollTarget('/window/rail');
  assert('轨道窗出现', Array.isArray(railHits) && railHits.length >= 1, `targets=${railHits?.length}`);
  const railClient = await new CdpClient(railHits[0].webSocketDebuggerUrl).connect();
  // vite HMR 兜底：刷新轨道页加载最新前端代码后重连
  try {
    await railClient.send('Page.reload', {});
    await delay(1800);
  } catch { /* 重连由下面 retry 承接 */ }
  const railClient2 = await new CdpClient((await pollTarget('/window/rail'))[0].webSocketDebuggerUrl).connect();

  const ticks = await evalJSRetry(railClient2, `(() => ({
    count: document.querySelectorAll('button[class*=tick]').length,
  }))()`);
  assert('轨道 2 刻度', ticks?.count === 2, JSON.stringify(ticks));

  // hover 第一个刻度（列表最新 = 最后降格的作业 = picked[1]）
  const firstTitle = await evalJSRetry(railClient2, `(() => {
    const tick = document.querySelectorAll('button[class*=tick]')[0];
    tick.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return true;
  })()`);
  assert('hover 刻度触发', firstTitle === true);
  let card1 = null;
  for (let i = 0; i < 10; i++) {
    await delay(600);
    card1 = await evalJS(railClient2, `(() => {
      const card = document.querySelector('[class*=card]');
      return card ? { title: (card.querySelector('[class*=cardTitle]') || {}).textContent || null } : null;
    })()`);
    if (card1?.title) break;
  }
  const expectFirst = picked[1].artifactName.split('.').slice(0, -1).join('.') || picked[1].artifactName;
  assert('hover 卡标题 = 最新降格条目', !!card1?.title && card1.title.includes(expectFirst), JSON.stringify(card1));

  // 滚轮向下（deltaY>0）→ 切到下一（更旧 = picked[0]）
  await evalJSRetry(railClient2, `(() => {
    const strip = document.querySelector('[class*=strip]');
    strip.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));
    return true;
  })()`);
  let card2 = null;
  for (let i = 0; i < 8; i++) {
    await delay(500);
    card2 = await evalJS(railClient2, `(() => {
      const card = document.querySelector('[class*=card]');
      return card ? { title: (card.querySelector('[class*=cardTitle]') || {}).textContent || null } : null;
    })()`);
    const expectSecond = picked[0].artifactName.split('.').slice(0, -1).join('.') || picked[0].artifactName;
    if (card2?.title && card2.title.includes(expectSecond)) break;
  }
  const expectSecond = picked[0].artifactName.split('.').slice(0, -1).join('.') || picked[0].artifactName;
  assert('滚轮向下 → 卡切换到次新条目', !!card2?.title && card2.title.includes(expectSecond), JSON.stringify(card2));

  // 滚轮向上 → 切回最新
  await evalJSRetry(railClient2, `(() => {
    const strip = document.querySelector('[class*=strip]');
    strip.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    return true;
  })()`);
  let card3 = null;
  for (let i = 0; i < 8; i++) {
    await delay(500);
    card3 = await evalJS(railClient2, `(() => {
      const card = document.querySelector('[class*=card]');
      return card ? { title: (card.querySelector('[class*=cardTitle]') || {}).textContent || null } : null;
    })()`);
    if (card3?.title && card3.title.includes(expectFirst)) break;
  }
  assert('滚轮向上 → 切回最新条目', !!card3?.title && card3.title.includes(expectFirst), JSON.stringify(card3));

  // 钳位：卡在窗口界内（top ≥ 12，bottom ≤ innerHeight - 12）
  const clampState = await evalJSRetry(railClient2, `(() => {
    const card = document.querySelector('[class*=card]');
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      innerHeight: window.innerHeight,
    };
  })()`);
  assert('垂直钳位：卡片完整在窗口界内（12px 边距）',
    !!clampState && clampState.top >= 12 && clampState.bottom <= clampState.innerHeight - 12, JSON.stringify(clampState));
  await screenshot(railClient2, path.join(EVIDENCE_DIR, 'p59-rail-wheel.png'));

  // 清理
  for (const id of ids) {
    await evalJSRetry(client, `window.petriDesktop.windowManager.minimizeToRail(${JSON.stringify(id)})`).catch(() => {});
    await evalJSRetry(client, `window.petriDesktop.windowManager.remove(${JSON.stringify(id)})`);
  }

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'rail-wheel-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-59/rail-wheel-live.json (allPass=${allPass})`);
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
