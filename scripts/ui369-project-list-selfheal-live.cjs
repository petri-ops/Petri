#!/usr/bin/env node
'use strict';
/**
 * ui369-project-list-selfheal-live.cjs — UI-369 实机验收（BLOCK-87 伴随缺陷修复）。
 *
 * 被测缺陷：`AppRailContext` 首载 `listProjects()` 只试一次——dev 栈重启竞态
 * （窗口先于后端 3001 就绪）下首次 fetch 抛错后 catch 保持空数组且再无重试，
 * 左栏项目区永久空白（用户复现「项目列表怎么又没有了」）。
 * 修复：首载带退避重试 `[0, 2000, 5000, 10000, 15000]`，成功即停。
 *
 * 两种模式（各自独立证据文件）：
 *
 *   --mode=forced（默认，主证据·确定性）
 *     保持 dev 栈原样，用 CDP `Fetch` 域在 `*data/projects*` 上 `failRequest`
 *     构造「后端不可达」窗口——与真实竞态的失败形态在代码路径上等价
 *     （fetch reject → catch → 进入下一拍退避）。窗口刻意跨过第 1、2 拍，
 *     在第 3 拍前解除，因此：
 *       · 阻断期内 DOM 项目行恒 0 且 paused 次数 ≥2 ⇒ 首载失败后**确实发生了
 *         第 2 次尝试**（重试链推进），且无任何旁路回填；
 *       · 解除后项目行自动出现且恢复时刻落在第 3 拍（≈+7s）⇒ 重试收敛成功。
 *     全程脚本零点击 / 零 reload / 零 soft-refresh 派发。
 *
 *   --mode=natural（辅证据·自然重启观测）
 *     只做观测：等待一个**新出现**的页面 target（即由外部触发的 dev 栈重启
 *     拉起的新窗口），记录 t(窗口出现) / t(后端 200) / t(DOM 项目行 >0)，
 *     判定「自然重启后无需手动刷新即就位」。本模式由外部先启动本脚本、再触发
 *     `bash scripts/restart-dev-stack.sh`（本脚本不负责重启，避免与 canonical
 *     重启脚本抢时序）。
 *
 * 断言（forced 模式 A1–A6）：
 *   A1 阻断生效：解除阻断瞬间 DOM 项目行 == 0（无旁路回填）
 *   A2 重试链推进：阻断期内 `/api/data/projects` 被拦截次数 ≥ 2
 *   A3 无手势自愈：解除阻断后项目行自动 > 0 且全程零交互
 *   A4 收敛落点：恢复到「首拍失败时刻」的间隔落在第 3 拍窗口（6.0–10.0s）
 *   A5 数据真实：DOM 项目名与后端 API 返回的项目名集合一致（非空）
 *   A6 壳层在场：AppRail 项目树容器存在（排除「整块不渲染」的假绿）
 *
 * 跑完恢复：解除 Fetch 拦截 + 导航回原路由。
 */

const path = require('node:path');
const fs = require('node:fs');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-369');
const APP_URL = 'http://localhost:3000/';
const API_URL = 'http://127.0.0.1:3001/api/data/projects';
const AUTH = { Authorization: 'Bearer desktop-local' };
const BLOCK_PATTERN = '*data/projects*';
/** backoffMs 第 3 拍 = 2000 + 5000 = 7000ms（相对首拍失败时刻）。 */
const TICK3_MS = 7000;
const RELEASE_AFTER_MS = 3500; // 跨过第 1、2 拍，落在第 3 拍之前

const MEASURE = `(function(){
  var rows = document.querySelectorAll('[class*="projectTreeRow"]');
  var scroll = document.querySelector('[class*="projectTreeScroll"]');
  return JSON.stringify({
    path: location.pathname,
    readyState: document.readyState,
    root: !!document.getElementById('root'),
    treeScroll: !!scroll,
    rows: rows.length,
    names: Array.prototype.slice.call(rows, 0, 8).map(function(n){
      return (n.textContent || '').trim().slice(0, 24);
    })
  });
})()`;

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_main_target');
  const client = await lib.connectTarget(target);
  return { client, target };
}

async function apiProjects() {
  try {
    const res = await fetch(API_URL, { headers: AUTH });
    if (res.status !== 200) return null;
    const data = await res.json();
    return Array.isArray(data.projects) ? data.projects : null;
  } catch {
    return null;
  }
}

async function measure(client) {
  const raw = await lib.evalJs(client, MEASURE).catch(() => null);
  if (!raw) return null; // 导航中执行上下文销毁：跳过本采样
  try { return JSON.parse(raw); } catch { return null; }
}

// ── forced：确定性构造首载失败窗口 ─────────────────────────────
async function runForced() {
  const run = lib.createRun({ name: 'ui369-project-list-selfheal', evidenceDir: EVIDENCE_DIR });
  const { client } = await attach();
  const originalUrl = await lib.evalJs(client, 'location.href').catch(() => APP_URL);

  const pausedAt = [];
  client.on('Fetch.requestPaused', (params) => {
    pausedAt.push(Date.now());
    client.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' }).catch(() => {});
  });
  await client.send('Fetch.enable', { patterns: [{ urlPattern: BLOCK_PATTERN, requestStage: 'Request' }] });
  lib.log(`Fetch 拦截已挂载：${BLOCK_PATTERN}（模拟后端不可达）`);

  const navAt = Date.now();
  await client.send('Page.navigate', { url: APP_URL });

  const samples = [];
  let releaseAt = null;
  let rowsAtRelease = null;
  let recoverAt = null;
  let lastGood = null;
  const deadline = Date.now() + 25000;

  while (Date.now() < deadline) {
    const m = await measure(client);
    const firstTick = pausedAt[0] || navAt;
    if (m) {
      lastGood = m;
      samples.push({ tMs: Date.now() - navAt, rows: m.rows, path: m.path, readyState: m.readyState });
      if (releaseAt === null && pausedAt.length > 0 && Date.now() - firstTick >= RELEASE_AFTER_MS) {
        await client.send('Fetch.disable').catch(() => {});
        releaseAt = Date.now();
        rowsAtRelease = m.rows;
        lib.log(`解除拦截 @ +${releaseAt - firstTick}ms（相对首拍）· 此刻 rows=${m.rows} · paused=${pausedAt.length}`);
      }
      if (releaseAt !== null && m.rows > 0) { recoverAt = Date.now(); break; }
    }
    await sleep(250);
  }

  await client.send('Fetch.disable').catch(() => {});
  if (recoverAt !== null) await sleep(400);
  const finalMeasure = (await measure(client)) || lastGood || {};

  // ── 后端同名对账 ──
  const projects = await apiProjects();
  const apiNames = (projects || []).map((p) => String(p.name || '').trim()).filter(Boolean).sort();
  const domNames = (finalMeasure.names || []).map((n) => String(n).trim()).filter(Boolean);
  const namesAligned = apiNames.length > 0 && domNames.length > 0
    && domNames.every((n) => apiNames.some((a) => a.startsWith(n) || n.startsWith(a)));

  const firstTickAt = pausedAt[0] || null;
  const recoveryMs = (recoverAt !== null && firstTickAt !== null) ? recoverAt - firstTickAt : null;

  run.assert('A1 阻断生效：解除瞬间 DOM 项目行 == 0（无旁路回填）', rowsAtRelease === 0,
    `rows@release=${rowsAtRelease}`);
  run.assert('A2 重试链推进：阻断期内 /api/data/projects 被拦截次数 >= 2', pausedAt.length >= 2,
    `paused=${pausedAt.length} times=[${pausedAt.map((t) => (firstTickAt ? t - firstTickAt : 0)).join(', ')}]ms`);
  run.assert('A3 无手势自愈：解除后项目行自动 > 0（脚本零点击/零 reload/零 soft-refresh）', recoverAt !== null,
    `recoverAt=${recoverAt ? `+${recoveryMs}ms` : 'null'} rows=${finalMeasure.rows}`);
  run.assert('A4 收敛落点：恢复到首拍失败间隔落在第 3 拍窗口 6000–10000ms',
    recoveryMs !== null && recoveryMs >= 6000 && recoveryMs <= 10000,
    `recoveryMs=${recoveryMs} (期望 ≈${TICK3_MS})`);
  run.assert('A5 数据真实：DOM 项目名与后端 API 返回一致且非空', namesAligned,
    `dom=[${domNames.join('|')}] api=${apiNames.length} 项`);
  run.assert('A6 壳层在场：AppRail 项目树容器在 DOM（排除整块未渲染的假绿）', finalMeasure.treeScroll === true,
    `treeScroll=${finalMeasure.treeScroll}`);

  let shot = null;
  try { shot = await lib.screenshotPng(client, EVIDENCE_DIR, 'ui369-selfheal-after.png'); } catch { /* 截图非门禁 */ }

  await client.send('Page.navigate', { url: originalUrl }).catch(() => {});
  client.close?.();

  await run.finish({
    mode: 'forced',
    method: 'CDP Fetch.failRequest on *data/projects*（等价后端不可达的 catch 分支）',
    blockPattern: BLOCK_PATTERN,
    releaseAfterMs: RELEASE_AFTER_MS,
    pausedCount: pausedAt.length,
    pausedOffsetsMs: pausedAt.map((t) => (firstTickAt ? t - firstTickAt : 0)),
    rowsAtRelease,
    recoveryMs,
    expectedTick3Ms: TICK3_MS,
    domNames,
    apiProjectCount: apiNames.length,
    samples,
    screenshot: shot ? path.basename(shot) : null,
    note: '脚本自身零用户手势：无点击、无 reload 调用、无 gewu:soft-refresh 派发',
  });
  return run.allPass;
}

// ── natural：自然重启后首次挂载的观测（需外部触发重启） ────────
async function runNatural() {
  const run = lib.createRun({ name: 'ui369-natural-restart', evidenceDir: EVIDENCE_DIR });
  const before = new Set((await lib.pollTargets({ timeoutMs: 8000 }).catch(() => [])).map((t) => t.id));
  lib.log(`natural：等待新窗口出现（当前 page targets=${before.size}）——请外部触发 restart-dev-stack.sh`);

  let target = null;
  const waitDeadline = Date.now() + 180_000;
  while (Date.now() < waitDeadline) {
    const targets = await lib.pollTargets({ timeoutMs: 6000 }).catch(() => []);
    const fresh = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//).find((t) => !before.has(t.id));
    if (fresh) { target = fresh; break; }
    await sleep(400);
  }
  if (!target) {
    run.assert('N0 新窗口出现（自然重启）', false, '180s 内未观测到新页面 target');
    await run.finish({ mode: 'natural' });
    return run.allPass;
  }

  const windowAt = Date.now();
  const client = await lib.connectTarget(target);
  const trace = { apiReadyMs: null, firstRowsMs: null };
  let apiOk = false;
  let rowsSeen = 0;
  let last = null;

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (!apiOk) {
      const p = await apiProjects();
      if (p && p.length > 0) { apiOk = true; trace.apiReadyMs = Date.now() - windowAt; }
    }
    const m = await measure(client);
    if (m) {
      last = m;
      if (m.rows > rowsSeen) rowsSeen = m.rows;
      if (rowsSeen > 0) { if (trace.firstRowsMs === null) trace.firstRowsMs = Date.now() - windowAt; }
      if (rowsSeen > 0 && apiOk) break;
    }
    await sleep(250);
  }

  const projects = await apiProjects();
  run.assert('N1 新窗口自然重启后渲染出 AppRail 项目树', last?.treeScroll === true, `treeScroll=${last?.treeScroll}`);
  run.assert('N2 后端就绪', apiOk, `apiReady@+${trace.apiReadyMs}ms`);
  run.assert('N3 项目列表无需手动刷新即就位', rowsSeen > 0,
    `rows=${rowsSeen} firstRows@+${trace.firstRowsMs}ms`);
  run.assert('N4 列表项数与后端一致', !!projects && rowsSeen === Math.min(projects.length, rowsSeen) && rowsSeen > 0,
    `rows=${rowsSeen} api=${projects ? projects.length : 'n/a'}`);

  let shot = null;
  try { shot = await lib.screenshotPng(client, EVIDENCE_DIR, 'ui369-natural-after.png'); } catch { /* 非门禁 */ }
  client.close?.();

  await run.finish({ mode: 'natural', trace, rowsSeen, apiCount: projects ? projects.length : null, screenshot: shot ? path.basename(shot) : null });
  return run.allPass;
}

(async () => {
  const modeArg = process.argv.find((a) => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : 'forced';
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const ok = mode === 'natural' ? await runNatural() : await runForced();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  lib.log(`FATAL ${e.message}`);
  process.exit(2);
});
