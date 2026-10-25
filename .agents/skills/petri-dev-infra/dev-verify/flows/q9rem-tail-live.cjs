#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: q9rem-tail-live — BLOCK-260（Q9-REM 余项）实机腿。
 *
 * A0a backend_rest_healthy
 * A0b app_page_ready
 * A1 seeded_conversation_ready
 * A2 context_followups       结果类内容 → 追问 chips 切换为「解释这个结果」
 * A3 quit_items_view         退出摘要逐项可见；点「查看」回结果面
 * A4 crash_dump_summary      本地 minidump 摘要 + 详情可见
 * A5 spa_clean
 *
 * 诚实边界：截图离屏 unavailable；产出为合成消息/合成 dump，只验 UI 链路。
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
let activeClient = null;

async function ensureClient() {
  if (activeClient) {
    try { await lib.evalJs(activeClient, '1', 4000); return activeClient; } catch { activeClient = null; }
  }
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const chosen = await lib.selectPageTarget(pages, { probe: async (candidate) => lib.evalJs(candidate, `!!document.getElementById('root')`).catch(() => false) });
  activeClient = await lib.connectTarget(chosen);
  return activeClient;
}

async function evalRetry(_client, expr, tries = 4) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(await ensureClient(), expr, 8000); } catch (e) { lastErr = e; await sleep(500); }
  }
  throw lastErr;
}

async function navigate(url) {
  const live = await ensureClient();
  try { await live.send('Page.navigate', { url }); } catch { activeClient = null; }
  await sleep(1200);
}

async function pagePoll(_client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await Promise.race([
      evalRetry(null, expr, 1),
      new Promise((resolve) => setTimeout(resolve, 6000, 'poll_timeout')),
    ]).catch((e) => `eval_err:${e.message}`);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(600);
  }
  throw new Error(`page_poll_timeout: ${label} :: ${String(last).slice(0, 200)}`);
}

async function dismissFirstRun() {
  await evalRetry(null, `(function(){
    var btn = document.querySelector('[data-testid="role-reveal-start"]');
    if (btn) { btn.click(); return 'dismissed'; }
    return 'absent';
  })()`).catch(() => 'ignore');
}

module.exports = {
  id: 'q9rem-tail-live',
  description: 'BLOCK-260 Q9-REM 余项：退出摘要逐项 + minidump 摘要 + 上下文追问',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-260'),

  async run(ctx) {
    const { assert, projectId, jobId, dumpBuffer } = ctx;
    let client = null;

    const health = await fetch(API + '/data/projects', { headers: AUTH });
    assert('A0a_backend_rest_healthy', health.ok, `status=${health.status}`);
    client = await ensureClient();
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'root', timeoutMs: 30000 });
    assert('A0b_app_page_ready', true, 'root 就绪');

    await navigate(`${APP_ORIGIN}/project/${encodeURIComponent(projectId)}/chat`);
    await dismissFirstRun();
    await pagePoll(client, `String(document.body.innerText.includes('差异分析结果'))`, { label: 'seeded message', timeoutMs: 30000 });
    assert('A1_seeded_conversation_ready', true, '合成会话与结果类助手消息可见');

    await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="msg-action-suggest-followups"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    const chips = await pagePoll(client, `(function(){ var box=document.querySelector('[data-testid="msg-followups"]'); return box ? String(box.innerText || '') : ''; })()`, { label: 'context followups', timeoutMs: 10000 });
    assert('A2_context_followups', String(chips).includes('解释这个结果') && !String(chips).includes('解释关键结论'), String(chips).slice(0, 120));

    const preview = await evalRetry(null, `(function(){ return window.petriDesktop.app.previewQuitSummary(); })()`);
    assert('A3a_quit_preview_opened', Boolean(preview && preview.ok !== false), JSON.stringify(preview && preview.ok));
    await pagePoll(client, `String(!!document.querySelector('[data-testid="quit-summary-dialog"]'))`, { label: 'quit dialog', timeoutMs: 15000 });
    const itemsText = await evalRetry(null, `(function(){ var box=document.querySelector('[data-testid="quit-summary-items"]'); return box ? String(box.innerText || '') : ''; })()`);
    assert('A3b_quit_items_visible', String(itemsText).includes('运行中的差异分析'), String(itemsText).slice(0, 120));

    const openItem = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="quit-summary-open-${jobId}"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    const pathAfter = await pagePoll(client, `String(location.pathname + location.search)`, { label: 'quit item navigate', timeoutMs: 15000 });
    assert('A3c_quit_item_navigates', openItem === 'clicked' && String(pathAfter).includes(`/project/${projectId}/result`), String(pathAfter));

    // K2：写合成 dump 到真实 crashDumpsDir，再模拟异常退出并重载横幅。
    const status = await evalRetry(null, `(function(){ return window.petriDesktop.diagnostic.crashStatus(); })()`);
    const dumpDir = status && status.crashDumpsDir;
    assert('A4a_crash_dump_dir', Boolean(dumpDir), String(dumpDir));
    if (dumpDir) {
      fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(path.join(dumpDir, 'synthetic-q9.dmp'), dumpBuffer);
    }
    const simulated = await evalRetry(null, `(function(){ return window.petriDesktop.diagnostic.crashSimulate({
      uncleanExit: true,
      previousStartedAt: new Date(Date.now() - 60000).toISOString(),
      dumps: [{ name: 'synthetic-q9.dmp', size: ${dumpBuffer.length}, mtime: new Date().toISOString() }],
    }); })()`);
    assert('A4b_crash_simulated', Boolean(simulated && simulated.ok), JSON.stringify(simulated && simulated.ok));
    await navigate(`${APP_ORIGIN}/?test=1`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="crash-notice"]'))`, { label: 'crash banner', timeoutMs: 30000 });
    const bannerText = await evalRetry(null, `String((document.querySelector('[data-testid="crash-notice"]') || {}).textContent || '')`);
    assert('A4c_crash_summary_visible', String(bannerText).includes('1 个模块') && String(bannerText).includes('x64') && String(bannerText).includes('异常 0xc0000005'), String(bannerText).slice(0, 200));
    await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="crash-notice-details-toggle"]'); if(b) b.click(); return 'clicked'; })()`);
    const details = await pagePoll(client, `(function(){ var d=document.querySelector('[data-testid="crash-notice-details"]'); return d ? String(d.textContent || '') : ''; })()`, { label: 'crash details', timeoutMs: 10000 });
    assert('A4d_crash_details_module', String(details).includes('petri.exe') && String(details).includes('进程 4242'), String(details).slice(0, 160));

    await navigate(`${APP_ORIGIN}/?test=1`);
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'spa reset', timeoutMs: 30000 });
    assert('A5_spa_clean', true, '收尾回 ?test=1');
  },
};
