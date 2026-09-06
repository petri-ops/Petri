#!/usr/bin/env node
'use strict';

/**
 * BLOCK-59 加映 —— 内存实测探针（plan §8 观察项兑现）。
 *
 * plan §8 资源账：每个独立 BrowserWindow 估算 ≈100–200MB；「多入口轻量
 * bundle」备用方案的启动条件 = 实测超标。本探针在 dev Electron 上实测：
 *
 *   1) 基线：整个 Electron 进程树 RSS（主进程 + 全部 Helper）+ 窗口数
 *   2) 弹出 2 个结果窗（真实作业）→ 稳定后总量再测
 *   3) 每窗增量 = Δ总量 / 2；每窗 JS 堆（CDP Performance.getMetrics）
 *   4) remove 回收 → 总量回落复核
 *
 * 判读（诚实）：实测数字写入 plan §8；若每窗增量 ≤ 200MB（估算上限）→
 * 多入口 bundle 备用方案不启动。
 * 证据：acceptance/block-59/memory-probe.json
 */
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const DB_PATH = process.env.BIOF59_DB
  || path.join(__dirname, '..', '.biof3-dev-user-data', 'data', 'biof3.db');
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-59');
const ELECTRON_MATCH = 'BioF3-workspace/desktop/node_modules/electron/dist/Electron.app';

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
    throw new Error(`evaluate_failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`.slice(0, 300));
  }
  return r.result.value;
}

async function evalJSRetry(client, expr, { tries = 5, delayMs = 2000 } = {}) {
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

/** Electron 进程树 RSS 总量（MB）：主进程 + 全部 Helper（按二进制路径匹配）。 */
function electronTreeRssMB() {
  const out = execFileSync('ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' });
  let totalKB = 0;
  let count = 0;
  for (const line of out.split('\n')) {
    if (!line.includes(ELECTRON_MATCH) && !/ZCode/.test(line)) continue;
    if (!/node_modules\/electron|Electron Helper/.test(line) && !line.includes('Electron.app/Contents/MacOS/Electron')) continue;
    const m = line.trim().match(/^(\d+)\s+(\d+)\s/);
    if (m) { totalKB += Number(m[2]); count += 1; }
  }
  return { totalMB: Math.round(totalKB / 1024), processCount: count };
}

async function listTargets() {
  return fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
}

async function windowTargets() {
  const targets = await listTargets();
  return {
    main: targets.filter((t) => t.type === 'page' && /localhost:3000/.test(t.url || '') && !/(\/window\/)/.test(t.url || '')),
    popouts: targets.filter((t) => t.type === 'page' && (t.url || '').includes('/window/')),
    all: targets,
  };
}

const results = { startedAt: new Date().toISOString(), samples: [], assertions: [] };
function assert(name, pass, detail = '') {
  results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
  log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 140) : ''}`);
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  // 选作业（两个不同产物）
  const rows = JSON.parse(execFileSync(
    'sqlite3',
    [DB_PATH, '-json',
     "SELECT id, result_json FROM tool_jobs WHERE status='completed' AND result_json LIKE '%artifacts%' ORDER BY completed_at DESC LIMIT 10"],
    { encoding: 'utf8' },
  ));
  const picked = [];
  for (const row of rows) {
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
  if (picked.length < 2) throw new Error('need two completed jobs');
  const keys = picked.map((p) => `${p.jobId}:${p.artifactName}`);

  const mainWin = (await windowTargets()).main[0];
  const client = await new CdpClient(mainWin.webSocketDebuggerUrl).connect();

  // 幂等预清理
  await evalJSRetry(client, `(async () => {
    const wm = window.biof3Desktop?.windowManager;
    if (!wm) return false;
    const snap = await wm.snapshot();
    for (const id of ${JSON.stringify(keys.map((k) => `result:${k}`))}) {
      const entry = (snap?.snapshot?.entries || []).find((e) => e.id === id);
      if (entry) {
        if (entry.state === 'popped') await wm.minimizeToRail(id);
        await wm.remove(id);
      }
    }
    return true;
  })()`);
  await delay(1200);

  // 1) 基线
  const base = electronTreeRssMB();
  const baseWins = await windowTargets();
  results.samples.push({ phase: 'baseline', ...base, mainWindows: baseWins.main.length, popoutWindows: baseWins.popouts.length });
  log(`基线：总量 ${base.totalMB}MB / ${base.processCount} 进程 / popout ${baseWins.popouts.length}`);

  // 2) 弹出两个结果窗
  for (const key of keys) {
    const r = await evalJSRetry(client, `window.biof3Desktop.windowManager.popOut('result', ${JSON.stringify(key)})`);
    assert(`弹出 ${key.slice(-24)}`, r?.ok === true, JSON.stringify(r));
  }
  await delay(4000); // 渲染稳定
  const after2 = electronTreeRssMB();
  const wins2 = await windowTargets();
  results.samples.push({ phase: 'two-popouts', ...after2, mainWindows: wins2.main.length, popoutWindows: wins2.popouts.length });
  log(`两窗：总量 ${after2.totalMB}MB / popout ${wins2.popouts.length}`);

  // 3) 每窗 JS 堆（CDP）
  const heaps = [];
  for (const t of wins2.popouts) {
    try {
      const c = await new CdpClient(t.webSocketDebuggerUrl).connect();
      await c.send('Performance.enable', {});
      const m = await c.send('Performance.getMetrics', {});
      const heap = (m.metrics || []).find((x) => x.name === 'JSHeapUsedSize')?.value || 0;
      heaps.push({ url: (t.url || '').slice(-40), heapMB: Math.round(heap / 1024 / 1024 * 10) / 10 });
    } catch (e) {
      heaps.push({ url: (t.url || '').slice(-40), error: e.message.slice(0, 80) });
    }
  }
  results.jsHeaps = heaps;
  log(`每窗 JS 堆：${JSON.stringify(heaps)}`);

  const deltaTotal = after2.totalMB - base.totalMB;
  const perWindow = Math.round(deltaTotal / keys.length);
  results.deltaTotalMB = deltaTotal;
  results.perWindowMB = perWindow;
  assert('两窗总量增量非负（测量有效）', deltaTotal >= -50, `Δ=${deltaTotal}MB`);
  assert(`每窗增量 ${perWindow}MB ≤ plan §8 估算上限 200MB → 多入口 bundle 不启动`,
    perWindow <= 200 && perWindow > -200, `perWindow=${perWindow}MB`);

  // 4) 回收：remove 两窗 → 总量回落
  for (const key of keys) {
    await evalJSRetry(client, `window.biof3Desktop.windowManager.minimizeToRail('result:${key}')`);
    await evalJSRetry(client, `window.biof3Desktop.windowManager.remove('result:${key}')`);
  }
  await delay(2500);
  const afterClose = electronTreeRssMB();
  results.samples.push({ phase: 'after-remove', ...afterClose });
  log(`回收后：总量 ${afterClose.totalMB}MB`);
  assert('移除后总量回落（低于两窗态）', afterClose.totalMB <= after2.totalMB,
    `two=${after2.totalMB} → closed=${afterClose.totalMB}MB`);

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  results.verdict = perWindow <= 200
    ? '多入口轻量 bundle 备用方案不启动（实测在 plan §8 估算带内）'
    : '实测超出估算上限——启动多入口 bundle 备用方案的评估';
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'memory-probe.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-59/memory-probe.json (allPass=${allPass}) verdict=${results.verdict}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL 脚本异常:', e && e.message);
  process.exit(1);
});
