#!/usr/bin/env node
'use strict';

/**
 * BLOCK-59 P4 用户侧实机 CDP 断言驱动：agent 详情窗（dev Electron）。
 *   场景 E（P4）：
 *     1) SQLite 选真实历史子 agent 任务（type='agent_loop' 且有 tool_call 事件）
 *     2) popOut('agent', taskId) → /window/agent/ 独立窗 target
 *     3) SSE 全量回放（/api/ai/agent/task/:taskId 既有真相，复用主窗订阅路径）：
 *        时间线渲染工具调用 + 终态摘要（delta 回放累积）+ 终态徽章（已完成）
 *     4) 清理：轨道降格 + 显式移除
 *   入口（活动行「详情窗」按钮）由 toolActivity.test.ts 数据面单测覆盖
 *   （agentRunId 提取），实机以 bridge 驱动同一 popOut IPC。
 * 证据：acceptance/block-59/p4-live.json + p59-p4-01-agent-window.png
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

  // 1) 真实历史子 agent 任务（有 tool_call 事件、agent_status 终态）
  const rows = sqliteRows(
    `SELECT t.id, t.agent_status, t.status,
            (SELECT COUNT(*) FROM task_events e WHERE e.task_id = t.id AND e.event_type='tool_call') AS toolCalls,
            (SELECT COUNT(*) FROM task_events e WHERE e.task_id = t.id AND e.event_type='delta') AS deltas
     FROM tasks t WHERE t.type='agent_loop' AND t.params LIKE '%subagent%'
     ORDER BY t.created_at DESC LIMIT 20`
  );
  const picked = rows.find((r) => r.toolCalls > 0 && r.deltas > 0 && r.agent_status === 'done');
  assert('存在可用的历史子 agent 任务（done + tool_call + delta）', !!picked, JSON.stringify(picked));
  if (!picked) throw new Error('no_subagent_task');

  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || '') && !/(\/window\/)/.test(t.url || ''));
  if (!page) throw new Error('biof3_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();
  results.mainPage = page.url;

  // 幂等预清理
  const contentId = `agent:${picked.id}`;
  const pre = await evalJSRetry(client, `(async () => {
    const wm = window.biof3Desktop?.windowManager;
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

  // 2) 弹出 agent 详情窗
  const pop = await evalJSRetry(client, `window.biof3Desktop.windowManager.popOut('agent', ${JSON.stringify(picked.id)})`);
  assert('popOut(agent) → created（BLOCK-49 链路键）', pop?.ok && pop?.action === 'created' && pop?.id === contentId, JSON.stringify(pop));
  const hits = await pollTarget('/window/agent/');
  assert('agent 详情窗 target 出现', Array.isArray(hits) && hits.length === 1, `targets=${hits?.length}`);
  const agentClient = await new CdpClient(hits[0].webSocketDebuggerUrl).connect();

  // 3) SSE 回放渲染（等待 delta 回放 + 时间线 + 终态徽章）
  let rendered = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await delay(1500);
    rendered = await evalJS(agentClient, `(() => ({
      timelineRows: document.querySelectorAll('[class*=timelineRow]').length,
      summaryChars: (document.querySelector('[class*=agentSummary]') || {}).textContent?.length || 0,
      doneBadge: (document.querySelector('[class*=statusChip]') || {}).textContent || '',
      errorNote: (document.querySelector('[role="alert"]') || {}).textContent || null,
    }))()`);
    if (rendered?.timelineRows > 0 && rendered?.summaryChars > 0 && /已完成|失败/.test(rendered?.doneBadge || '')) break;
  }
  assert('时间线渲染工具调用（task_events 回放）', (rendered?.timelineRows || 0) >= 1 && rendered.timelineRows <= 200, JSON.stringify(rendered));
  assert('终态摘要非空（delta 回放累积，与父会话同源）', (rendered?.summaryChars || 0) > 0, `chars=${rendered?.summaryChars}`);
  assert('终态徽章如实（已完成）', /已完成/.test(rendered?.doneBadge || ''), JSON.stringify(rendered?.doneBadge));
  assert('无错误横幅（流健康）', !rendered?.errorNote, JSON.stringify(rendered?.errorNote));
  await screenshot(agentClient, path.join(EVIDENCE_DIR, 'p59-p4-01-agent-window.png'));

  // 4) 清理
  await evalJSRetry(client, `window.biof3Desktop.windowManager.minimizeToRail(${JSON.stringify(contentId)})`);
  const removed = await evalJSRetry(client, `window.biof3Desktop.windowManager.remove(${JSON.stringify(contentId)})`);
  assert('清理：轨道降格 + 显式移除', removed?.ok === true, JSON.stringify(removed));

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p4-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-59/p4-live.json (allPass=${allPass})`);
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
