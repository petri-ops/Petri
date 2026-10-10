#!/usr/bin/env node
'use strict';

/**
 * BLOCK-57 UI-290 收尾实机：会话级执行目标选择器（composer chip）+ 徽章。
 *   1) chat 模式：composer「执行目标」chip 渲染（有目标时），选 dell
 *   2) 发送 sample-metadata-validator 运行请求（full 档自动执行）
 *   3) 作业落库 execution_target_id=dell → completed（产物拉回）
 *   4) 作业库「远程」徽章可见（会话绑定自动，非直构）
 * 证据：acceptance/block-57/ui-final.json + p57-04-chip.png + p57-05-badge.png
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const PROJECT_ID = process.env.BIOF57_PROJECT || 'p_mtlnsv0f_xpjb';
const DB_PATH = path.join(__dirname, '..', '.petri-dev-user-data', 'data', 'petri.db');
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-57');
const WAIT_MS = 8 * 60 * 1000;

function log(msg) { console.log(`[ui-final] ${msg}`); }
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
    client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('cdp_eval_timeout_30s')), 30000)),
  ]);
  if (r && r.exceptionDetails) throw new Error('cdp_eval_exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
  return r && r.result ? r.result.value : undefined;
}

async function evalJSRetry(client, expr, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try { return await evalJS(client, expr); } catch (e) {
      if (!/-32000|context|cdp_command_failed/i.test(e.message)) throw e;
      last = e;
      await delay(1200);
    }
  }
  throw last;
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

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || ''));
  if (!page) throw new Error('petri_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();

  const results = { startedAt: new Date().toISOString(), projectId: PROJECT_ID, assertions: [] };
  const assert = (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 400) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ' — ' + String(detail).slice(0, 200)}`);
  };

  // 1) chat 模式 + 选 dell
  await client.send('Page.navigate', { url: `http://localhost:3000/project/${PROJECT_ID}` });
  await delay(4500);

  const chip = await evalJSRetry(client, `(async () => {
    const picker = document.querySelector('.sc-exec-target-picker');
    if (!picker) return { ok: false, reason: 'no_chip' };
    const btn = picker.querySelector('button');
    if (!btn) return { ok: false, reason: 'no_chip_btn' };
    if (!btn.textContent.includes('本机')) return { ok: true, note: 'already_dell', label: btn.textContent.trim() };
    btn.click();
    await new Promise(r => setTimeout(r, 300));
    const opts = Array.from(document.querySelectorAll('.sc-access-option'));
    const dell = opts.find((o) => (o.querySelector('.sc-access-option-title') || {}).textContent === 'dell');
    if (!dell) return { ok: false, reason: 'no_dell_option', opts: opts.length };
    dell.click();
    await new Promise(r => setTimeout(r, 300));
    return { ok: picker.querySelector('button').textContent.includes('dell'), label: picker.querySelector('button').textContent.trim() };
  })()`);
  assert('C1 composer 执行目标 chip 选定 dell', chip && chip.ok, JSON.stringify(chip));
  await screenshot(client, path.join(EVIDENCE_DIR, 'p57-04-chip.png'));

  // 2) 发送运行请求（full 档自动执行）
  const sent = await evalJSRetry(client, `(async () => {
    const ta = document.querySelector('.sc-input');
    if (!ta) return { ok: false, reason: 'no_input' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '请调用 run_tool 运行 sample-metadata-validator 工具：counts 输入用项目文件 inputs/counts.csv，metadata 输入用项目文件 inputs/coldata.csv，reference_group=Control，treatment_group=Treatment。这是新的一次校验执行（必须实际调用 run_tool 创建并执行新 Job，不要复用或跳过）。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const send = document.querySelector('.sc-send-cta-send');
    if (!send) return { ok: false, reason: 'no_send_btn' };
    send.click();
    await new Promise(r => setTimeout(r, 1500));
    return { ok: true, cleared: !ta.value };
  })()`);
  assert('C2 发送 sample-metadata-validator 运行请求', sent && sent.ok, JSON.stringify(sent));

  // 3) 轮询 DB：新作业（本会话发起）带 dell 目标 → completed
  const baseline = Date.now() - 60_000;
  const jobDeadline = Date.now() + WAIT_MS;
  let job = null;
  while (Date.now() < jobDeadline) {
    const rows = sqliteRows(`SELECT j.id, j.status, j.error, j.execution_target_id, t.id AS tid, t.alias
      FROM tool_jobs j JOIN execution_targets t ON t.id = j.execution_target_id
      WHERE j.created_at > ${baseline} AND t.alias = 'dell' ORDER BY j.created_at DESC LIMIT 1`);
    if (rows[0]) {
      job = rows[0];
      if (!['pending', 'running'].includes(job.status)) break;
    }
    await delay(4000);
  }
  assert('C3 会话作业自动携带 dell 目标', !!job, JSON.stringify(job || {}).slice(0, 300));
  assert('C4 dell 远程执行 completed（产物拉回）', !!job && job.status === 'completed',
    `status=${job && job.status} error=${job && job.error}`);

  // 4) 作业库徽章（会话自动绑定，非直构）
  await client.send('Page.navigate', { url: `http://localhost:3000/project/${PROJECT_ID}/result` });
  await delay(5000);
  const badge = await evalJSRetry(client, `(() => {
    const titles = Array.from(document.querySelectorAll('[class*=resultsLibraryItemTitle]'));
    const remote = titles.find((t) => t.textContent.includes('远程'));
    return { count: titles.length, remoteSeen: !!remote, text: remote ? remote.textContent.slice(0, 50) : null };
  })()`, 2);
  assert('C5 作业库「远程」徽章可见（会话自动绑定）', badge && badge.remoteSeen, JSON.stringify(badge));
  await screenshot(client, path.join(EVIDENCE_DIR, 'p57-05-badge.png'));

  const allPass = results.assertions.every((a) => a.pass);
  results.allPass = allPass;
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui-final.json'), JSON.stringify(results, null, 2));
  console.log(`\n===== BLOCK-57 UI final：${allPass ? 'ALL PASS' : 'FAILURES PRESENT'} =====`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
