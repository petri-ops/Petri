#!/usr/bin/env node
'use strict';

/**
 * BLOCK-59 加映二实机：边缘活动轨道 hover 预览 + 可辨识刻度（用户反馈修复验证）。
 *   根因1：轨道窗 28px 宽，320px hover 卡整体被窗体裁剪（预览全无）。
 *   根因2：刻度是纯色块，无法辨认内容类型。
 *   修复：轨道窗 364px（预览区336+条带28）；刻度带类型图标；hover 卡含
 *   降格瞬间内容快照（window:thumbnail / capturePage 可见态采集）。
 *   断言：
 *     1) 弹出结果窗 → 降格 → 轨道窗 target 宽 364（outerWidth）
 *     2) 刻度渲染图标（svg 存在 + bar-chart 类图标元素）
 *     3) hover 刻度 → 卡片渲染且**未被窗体裁剪**（card 右缘 ≤ 窗口 innerWidth）
 *     4) 快照预览：img[data-thumb] 出现且 naturalWidth > 0（真实位图）
 *     5) hover 卡文本（类型 · 产物名）可读
 *     6) 点击恢复 → popped；清理
 * 证据：acceptance/block-59/rail-preview-live.json + p59-rail-preview.png
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

  // 选作业
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

  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || '') && !/(\/window\/)/.test(t.url || ''));
  if (!page) throw new Error('petri_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();

  // 幂等预清理
  const pre = await evalJSRetry(client, `(async () => {
    const wm = window.petriDesktop?.windowManager;
    if (!wm) return { bridge: false };
    const snap = await wm.snapshot();
    const entry = (snap?.snapshot?.entries || []).find((e) => e.id === ${JSON.stringify(contentId)});
    if (entry) {
      if (entry.state === 'popped') await wm.minimizeToRail(entry.id);
      await wm.remove(entry.id);
    }
    return { bridge: true, cleaned: !!entry };
  })()`);
  assert('主窗桥可用 + 预清理', pre?.bridge === true, JSON.stringify(pre));

  // 弹出 → × 降格（走 window:minimize，含快照采集）
  const pop = await evalJSRetry(client, `window.petriDesktop.windowManager.popOut('result', ${JSON.stringify(contentKey)})`);
  assert('结果窗弹出', pop?.ok && pop?.action === 'created', JSON.stringify(pop));
  await pollTarget('/window/result/');
  await delay(1200); // 首帧渲染完成再降格，快照才有内容
  const mini = await evalJSRetry(client, `window.petriDesktop.windowManager.minimizeToRail(${JSON.stringify(contentId)})`);
  assert('× 降格（minimize 含快照采集）', mini?.ok && mini?.state === 'railed', JSON.stringify(mini));

  // 轨道窗出现：宽 364
  const railHits = await pollTarget('/window/rail');
  assert('轨道窗 target 出现', Array.isArray(railHits) && railHits.length >= 1, `targets=${railHits?.length}`);
  await delay(1500);
  const railClient = await new CdpClient(railHits[0].webSocketDebuggerUrl).connect();
  const railGeo = await evalJSRetry(railClient, `(() => ({
    outerWidth: window.outerWidth,
    innerWidth: window.innerWidth,
    visible: document.visibilityState,
    tickCount: document.querySelectorAll('button[class*=tick]').length,
    tickHasSvg: !!document.querySelector('button[class*=tick] svg'),
    tickKind: document.querySelector('button[class*=tick]')?.getAttribute('data-kind') || null,
  }))()`);
  assert('轨道窗宽 364（预览区+条带，卡不再被裁剪）', railGeo?.outerWidth === 364, JSON.stringify(railGeo));
  assert('刻度带类型图标（svg 渲染，非纯色块）', railGeo?.tickHasSvg === true && railGeo?.tickKind === 'result', JSON.stringify(railGeo));

  // hover 刻度 → 卡片渲染 + 快照预览（React 从 mouseover 合成 onMouseEnter）
  await evalJSRetry(railClient, `(() => {
    const tick = document.querySelector('button[class*=tick]');
    tick.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    tick.focus();
    return true;
  })()`);
  let cardState = null;
  for (let i = 0; i < 12; i++) {
    await delay(700);
    cardState = await evalJS(railClient, `(() => {
      const card = document.querySelector('[class*=card]:not([class*=cardMeta])');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      const img = card.querySelector('img');
      return {
        cardRight: Math.round(rect.right),
        innerWidth: window.innerWidth,
        title: (card.querySelector('[class*=cardTitle]') || {}).textContent || null,
        hasThumbImg: !!img,
        thumbLoaded: img ? img.naturalWidth > 0 : false,
        thumbW: img ? img.naturalWidth : 0,
      };
    })()`);
    if (cardState && (cardState.hasThumbImg || cardState.title)) break;
  }
  assert('hover 卡渲染且右缘在窗口内（不被窗体裁剪）',
    !!cardState && cardState.cardRight <= cardState.innerWidth, JSON.stringify(cardState));
  assert('卡标题可读（类型 · 产物名）', !!cardState?.title && cardState.title.includes(picked.artifactName.split('.').pop()), JSON.stringify(cardState?.title));
  assert('快照预览为真实位图（naturalWidth>0）', cardState?.hasThumbImg === true && cardState?.thumbLoaded === true, JSON.stringify({ w: cardState?.thumbW }));
  await screenshot(railClient, path.join(EVIDENCE_DIR, 'p59-rail-preview.png'));

  // 点击恢复 + 清理
  await evalJSRetry(railClient, `(() => { document.querySelector('button[class*=tick]').click(); return true; })()`);
  await delay(1200);
  const snap = await evalJSRetry(client, `window.petriDesktop.windowManager.snapshot()`);
  const entry = (snap?.snapshot?.entries || []).find((e) => e.id === contentId);
  assert('点击刻度 → popped（恢复路径完好）', entry?.state === 'popped', JSON.stringify(entry));
  await evalJSRetry(client, `window.petriDesktop.windowManager.minimizeToRail(${JSON.stringify(contentId)})`);
  const removed = await evalJSRetry(client, `window.petriDesktop.windowManager.remove(${JSON.stringify(contentId)})`);
  assert('清理：降格 + 显式移除', removed?.ok === true, JSON.stringify(removed));

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'rail-preview-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-59/rail-preview-live.json (allPass=${allPass})`);
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
