#!/usr/bin/env node
'use strict';

/**
 * BLOCK-59 P1 用户侧实机 CDP 断言驱动：结果窗弹出 / 收回 / × 降格 / 轨道恢复（dev Electron）。
 *   场景 A（P1 结果窗）：
 *     1) SQLite 选最近 completed 且有 artifacts 的 tool_job → jobId + artifactName
 *     2) 主窗桥快照：maxPopped=4、bridge 可用
 *     3) popOut('result', jobId:artifactName) → created；/window/result/ 独立窗 target 出现
 *     4) 独立窗内：WindowShell chrome 渲染（拖拽区 + 收回/×）+ self() contentId 正确 + 产物内容上屏
 *     5) 同内容再弹出 → focused（同内容禁双开，target 数不变）
 *     6) returnToDock → 收回：独立窗 target 消失，注册表 docked
 *     7) 再弹出 → × 降格（minimizeToRail）：注册表 railed，**target 仍在（hide 保活，× 永远不是销毁）**
 *     8) restore（window:restore）→ popped，窗口重新可见
 *     9) remove（轨道显式移除）→ 唯一销毁路径，注册表条目终结
 *    10) geometry 持久化文件存在且含该内容键（位置记忆归主进程）
 *   诚实范围：重启后弹出窗不恢复（plan §7 P1 验收门明示），以 geometry 文件 + 注册表内存态佐证。
 * 前置：dev Electron 已在跑（wrapper 自带 --remote-debugging-port=9222）。
 * 证据：acceptance/block-59/ui-live.json + p59-0*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const DB_PATH = process.env.BIOF59_DB
  || path.join(__dirname, '..', '.biof3-dev-user-data', 'data', 'biof3.db');
const USER_DATA_DIR = process.env.BIOF3_ELECTRON_USER_DATA_DIR
  || path.join(__dirname, '..', '.biof3-dev-user-data');
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
    client.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }),
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
    try {
      return await evalJS(client, expr);
    } catch (e) {
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

async function pollWindowTarget(key, { appear = true, tries = 20, delayMs = 700 } = {}) {
  // key 给定时按具体内容键 URL 过滤（encodeURIComponent 后单段），避免
  // 其他残留窗口干扰计数断言
  const needle = key
    ? `/window/result/${encodeURIComponent(key)}`
    : '/window/result/';
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

  // 1) 选最近 completed 且有 artifacts 的 job
  const jobRows = sqliteRows(
    `SELECT id, name, status, result_json FROM tool_jobs
     WHERE status='completed' AND result_json LIKE '%artifacts%'
     ORDER BY completed_at DESC LIMIT 8`
  );
  let picked = null;
  for (const row of jobRows) {
    try {
      const parsed = JSON.parse(row.result_json || '{}');
      // result_json 顶层即 result 对象（artifacts 直接在顶层，无 .result 包装）
      const res = parsed?.result || parsed;
      const files = res?.artifacts || res?.files || [];
      const name = files[0]?.name || files[0]?.filename;
      if (name) { picked = { jobId: row.id, jobName: row.name, artifactName: name }; break; }
    } catch { /* try next */ }
  }
  assert('存在可用的 completed 作业（jobId + artifactName）', !!picked, JSON.stringify(picked));
  if (!picked) throw new Error('no_completed_job_with_artifacts');
  const contentKey = `${picked.jobId}:${picked.artifactName}`;
  const contentId = `result:${contentKey}`;
  results.contentKey = contentKey;

  // 2) 主窗桥
  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || '') && !/(\/window\/)/.test(t.url || ''));
  if (!page) throw new Error('biof3_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();
  results.mainPage = page.url;

  const bridgeReady = await evalJSRetry(client, `!!window.biof3Desktop?.windowManager?.popOut`);
  assert('主窗 preload 暴露 windowManager 桥', bridgeReady === true, String(bridgeReady));

  const snap0 = await evalJSRetry(client, `window.biof3Desktop.windowManager.snapshot()`);
  assert('初始快照：maxPopped=4（≤4 并发契约）', snap0?.ok && snap0?.snapshot?.maxPopped === 4, JSON.stringify(snap0).slice(0, 120));

  // 幂等预清理：上一次运行残留的同键条目（popped → 降格；随后轨道移除销毁残留窗）
  const preEntry = (snap0?.snapshot?.entries || []).find((e) => e.id === contentId);
  if (preEntry) {
    if (preEntry.state === 'popped') {
      await evalJSRetry(client, `window.biof3Desktop.windowManager.minimizeToRail(${JSON.stringify(contentId)})`);
    }
    await evalJSRetry(client, `window.biof3Desktop.windowManager.remove(${JSON.stringify(contentId)})`);
    await pollWindowTarget(contentKey, { appear: false });
    log(`预清理：移除残留条目 ${contentId}（state=${preEntry.state}）`);
  }

  // 3) 弹出
  const pop1 = await evalJSRetry(client, `window.biof3Desktop.windowManager.popOut('result', ${JSON.stringify(contentKey)})`);
  assert('popOut → created（白名单键通过，注册表入 popped）', pop1?.ok && pop1?.action === 'created' && pop1?.id === contentId, JSON.stringify(pop1));

  const hits1 = await pollWindowTarget(contentKey, { appear: true });
  assert('独立窗 target 出现（/window/result/ 路由）', Array.isArray(hits1) && hits1.length === 1, `targets=${hits1?.length}`);

  // 4) 独立窗内断言
  const popClient = await new CdpClient(hits1[0].webSocketDebuggerUrl).connect();
  await delay(1800); // 首帧 + 状态自举
  const selfInfo = await evalJSRetry(popClient, `window.biof3Desktop.windowManager.self()`);
  assert('独立窗 self() 身份正确', selfInfo?.ok && selfInfo?.contentId === contentId, JSON.stringify(selfInfo));
  const shellInfo = await evalJSRetry(popClient, `(() => {
    const header = document.querySelector('[data-drag-region]');
    const buttons = header ? Array.from(header.querySelectorAll('button')).map((b) => b.textContent.trim()) : [];
    const bodyText = document.body.textContent || '';
    return {
      hasHeader: !!header,
      buttons,
      hasReturn: buttons.includes('收回'),
      hasDemote: buttons.includes('×'),
      jobTitleSeen: bodyText.includes(${JSON.stringify(picked.jobName || picked.jobId)}) || bodyText.includes(${JSON.stringify(picked.jobId)}),
      hasDegradedNote: !!document.querySelector('[role="note"]'),
      artifactNameSeen: bodyText.includes(${JSON.stringify(picked.artifactName)}),
      bodyChars: bodyText.length,
    };
  })()`);
  assert('WindowShell chrome 渲染（拖拽区 + 收回 + ×）', shellInfo?.hasHeader && shellInfo?.hasReturn && shellInfo?.hasDemote, JSON.stringify(shellInfo));
  assert('独立窗无降级提示（桥可用）', shellInfo?.hasDegradedNote === false, JSON.stringify(shellInfo?.hasDegradedNote));
  assert('只读内容上屏（任务标题 / 产物名可见）', shellInfo?.jobTitleSeen || shellInfo?.artifactNameSeen, JSON.stringify(shellInfo));
  await screenshot(popClient, path.join(EVIDENCE_DIR, 'p59-01-popout.png'));

  // 5) 同内容禁双开
  const pop2 = await evalJSRetry(client, `window.biof3Desktop.windowManager.popOut('result', ${JSON.stringify(contentKey)})`);
  const targetsAfterDup = (await listTargets()).filter((t) => t.type === 'page' && (t.url || '').includes('/window/result/'));
  assert('同内容再弹出 = focused（不建第二窗）', pop2?.ok && pop2?.action === 'focused', JSON.stringify(pop2));
  assert('同内容双开后独立窗 target 数不变（=1）', targetsAfterDup.length === 1, `targets=${targetsAfterDup.length}`);

  // 6) 收回
  const ret = await evalJSRetry(client, `window.biof3Desktop.windowManager.returnToDock(${JSON.stringify(contentId)})`);
  assert('returnToDock → docked（状态零丢失路径）', ret?.ok && ret?.state === 'docked', JSON.stringify(ret));
  const goneTargets = await pollWindowTarget(contentKey, { appear: false });
  assert('收回后独立窗 target 消失（BrowserWindow 销毁）', Array.isArray(goneTargets) && goneTargets.length === 0, `targets=${goneTargets?.length}`);

  // 7) 再弹出 → × 降格（hide 保活，不可变契约）
  const pop3 = await evalJSRetry(client, `window.biof3Desktop.windowManager.popOut('result', ${JSON.stringify(contentKey)})`);
  assert('再次弹出 → created', pop3?.ok && pop3?.action === 'created', JSON.stringify(pop3));
  await pollWindowTarget(contentKey, { appear: true });
  const mini = await evalJSRetry(client, `window.biof3Desktop.windowManager.minimizeToRail(${JSON.stringify(contentId)})`);
  assert('× → minimizeToRail（降格不是销毁）', mini?.ok && mini?.state === 'railed', JSON.stringify(mini));
  const targetsAfterMini = (await listTargets()).filter((t) => t.type === 'page' && (t.url || '').includes('/window/result/'));
  assert('降格后 target 仍在（隐藏保活，注册表保活可恢复）', targetsAfterMini.length === 1, `targets=${targetsAfterMini.length}`);
  const snapRailed = await evalJSRetry(client, `window.biof3Desktop.windowManager.snapshot()`);
  const railedEntry = (snapRailed?.snapshot?.entries || []).find((e) => e.id === contentId);
  assert('注册表条目 railed + static 淡出时间戳', !!railedEntry && railedEntry.state === 'railed' && typeof railedEntry.fadeAfter === 'number', JSON.stringify(railedEntry));

  // 8) 轨道恢复
  const restored = await evalJSRetry(client, `window.biof3Desktop.windowManager.restore(${JSON.stringify(contentId)})`);
  assert('restore → popped（回记忆位置）', restored?.ok && restored?.state === 'popped', JSON.stringify(restored));
  const targetsAfterRestore = (await listTargets()).filter((t) => t.type === 'page' && (t.url || '').includes('/window/result/'));
  assert('恢复后独立窗 target 存在', targetsAfterRestore.length === 1, `targets=${targetsAfterRestore.length}`);
  // 隐藏/重显后 CDP socket 可能更换：重连当前 target 再截图
  const freshTargets = await listTargets();
  const freshPopout = freshTargets.find((t) => t.type === 'page' && (t.url || '').includes('/window/result/'));
  if (freshPopout) {
    const shotClient = await new CdpClient(freshPopout.webSocketDebuggerUrl).connect();
    await screenshot(shotClient, path.join(EVIDENCE_DIR, 'p59-02-restored.png'));
  }

  // 9) 唯一销毁路径：先降格入轨道，再从轨道显式移除（popped 态直接移除必须被拒——契约实证）
  const removeWhilePopped = await evalJSRetry(client, `window.biof3Desktop.windowManager.remove(${JSON.stringify(contentId)})`);
  assert('契约：popped 态 remove 被拒（销毁只有轨道显式移除一条路）',
    removeWhilePopped?.ok === false && removeWhilePopped?.code === 'invalid_transition', JSON.stringify(removeWhilePopped));
  await evalJSRetry(client, `window.biof3Desktop.windowManager.minimizeToRail(${JSON.stringify(contentId)})`);
  const removed = await evalJSRetry(client, `window.biof3Desktop.windowManager.remove(${JSON.stringify(contentId)})`);
  assert('remove → closed（轨道内显式移除）', removed?.ok && removed?.state === 'closed', JSON.stringify(removed));
  const snapAfterRemove = await evalJSRetry(client, `window.biof3Desktop.windowManager.snapshot()`);
  assert('注册表条目终结（终态后不在注册表）', !((snapAfterRemove?.snapshot?.entries || []).some((e) => e.id === contentId)), JSON.stringify(snapAfterRemove?.entries?.length));

  // 10) geometry 持久化（位置记忆归主进程）
  const geoPath = path.join(USER_DATA_DIR, 'window-manager-state.json');
  let geo = null;
  try { geo = JSON.parse(fs.readFileSync(geoPath, 'utf8')); } catch {}
  assert('geometry 持久化文件含该内容键（重启后记忆位置仍可恢复）',
    !!geo?.geometry && !!geo.geometry[contentId], JSON.stringify(geo?.geometry?.[contentId] || null));
  results.geometry = geo?.geometry?.[contentId] || null;

  // ── 场景 B（P1b）：主窗 ResultView「弹出」按钮真实点击 → 独立窗出现 ──
  const projRows = sqliteRows(`SELECT project_id FROM tool_jobs WHERE id='${picked.jobId}'`);
  const projectId = projRows[0]?.project_id;
  if (projectId) {
    const resultUrl = `http://localhost:3000/project/${projectId}/result?job=${picked.jobId}`;
    await client.send('Page.navigate', { url: resultUrl });
    await delay(6000);
    const probe = await evalJSRetry(client, `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '弹出');
      return {
        path: location.pathname + location.search,
        hasPopBtn: !!btn,
        popDisabled: btn ? btn.disabled : null,
        resultViewShown: !!document.querySelector('[class*=resultView]'),
        techName: (document.querySelector('[class*=resultReportTechnicalName]') || {}).textContent || null,
      };
    })()`);
    assert('P1b 主窗结果视图渲染（result mode 深链）', probe?.resultViewShown && !!probe?.techName, JSON.stringify(probe));
    assert('P1b「弹出」按钮可见且可用', probe?.hasPopBtn && probe?.popDisabled === false, JSON.stringify(probe));
    await evalJSRetry(client, `(() => {
      Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '弹出').click();
      return true;
    })()`);
    const uiHits = await pollWindowTarget('', { appear: true });
    const uiSnap = await evalJSRetry(client, `window.biof3Desktop.windowManager.snapshot()`);
    const uiEntry = (uiSnap?.snapshot?.entries || []).find((e) => e.state === 'popped');
    assert('P1b 真实点击「弹出」→ 独立窗出现且注册表 popped',
      Array.isArray(uiHits) && uiHits.length >= 1 && !!uiEntry, JSON.stringify({ targets: uiHits?.length, entry: uiEntry }));
    await screenshot(client, path.join(EVIDENCE_DIR, 'p59-03-mainwindow-button.png'));
    // 清理（场景 B 残留）：降格 + 移除
    if (uiEntry) {
      await evalJSRetry(client, `window.biof3Desktop.windowManager.minimizeToRail(${JSON.stringify(uiEntry.id)})`);
      await evalJSRetry(client, `window.biof3Desktop.windowManager.remove(${JSON.stringify(uiEntry.id)})`);
    }
  } else {
    assert('P1b 主窗「弹出」按钮场景（job 无 project_id，跳过）', false, 'no project_id');
  }

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-59/ui-live.json (allPass=${allPass})`);
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
