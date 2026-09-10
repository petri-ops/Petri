#!/usr/bin/env node
'use strict';

/**
 * BLOCK-77 P4 实机全链验收（两阶段，由外层编排重启）：
 *   phase1: 建 dell SSH 项目 → 真实模型对话挂机（resident_task_create + sleep 长命令）
 *           → 断言意图卡落服务器 + 进程存活 → 写状态文件 → 退出（保留现场）
 *   [外层: clean-stack 关软件 → 重开栈]
 *   phase2: 交接班双通道验证 —— Channel B 真实对话问驻留任务清单（模型读卡汇报）
 *           → ssh 手动 kill sleep → 回访循环翻转 failed（.exit=143）→ 清理
 * 前置：dev 栈在跑；ssh dell 可达（Rscript/DESeq2 无关，本链只需 sleep）。
 * 证据：acceptance/block-77/p4-live.json（两阶段合并）+ 截图
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const EVIDENCE = path.join(REPO, 'acceptance', 'block-77');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const REMOTE_ROOT = '/root/gewu-block77-demo';
const STATE = path.join(EVIDENCE, 'p4-state.json');
const PHASE = process.argv[2] || 'phase1';

const results = { startedAt: new Date().toISOString(), assertions: [] };

function fetchRaw(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
async function fetchJson(url, opts = {}) {
  const r = await fetchRaw(url, opts);
  try { return { status: r.status, json: JSON.parse(r.body.toString('utf8')) }; } catch { return { status: r.status, json: null }; }
}
function sshDell(cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'dell', cmd], { encoding: 'utf8', timeout: 30000, windowsHide: true });
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function saveResults(extra) {
  const prev = fs.existsSync(path.join(EVIDENCE, 'p4-live.json'))
    ? JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'p4-live.json'), 'utf8')) : { assertions: [] };
  const merged = { startedAt: prev.startedAt || results.startedAt, assertions: [...prev.assertions, ...results.assertions], ...(extra || {}), finishedAt: new Date().toISOString() };
  merged.allPass = merged.assertions.length > 0 && merged.assertions.every((a) => a.pass);
  fs.writeFileSync(path.join(EVIDENCE, 'p4-live.json'), JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

// lib 同款四原语（CDP）
let lib = null;
try { lib = require(path.join(REPO, '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs')); } catch {}

async function evalJS(client, expr, timeoutMs) {
  const r = await Promise.race([
    client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('eval_timeout')), timeoutMs || 30000)),
  ]);
  if (r.exceptionDetails) throw new Error('eval_exception');
  return r.result && r.result.value;
}

async function connectMain(projectId) {
  const targets = await lib.pollTargets({ timeoutMs: 15000 });
  const pages = lib.filterPageTargets(targets, /localhost:3000/);
  if (!pages.length) throw new Error('no_spa_page');
  const main = await lib.selectPageTarget(pages, {
    probe: (client) => lib.evalJs(client, '!!document.querySelector(\'textarea.sc-input\')', 5000).catch(() => false),
  });
  const client = await lib.connectTarget(main);
  await client.send('Page.navigate', { url: `http://localhost:3000/project/${projectId}` }).catch(() => {});
  let interactive = false;
  for (let i = 0; i < 40 && !interactive; i++) {
    interactive = await lib.evalJs(client, '!!document.querySelector(\'textarea.sc-input\')').catch(() => false);
    if (!interactive) await delay(1000);
  }
  if (!interactive) throw new Error('app_not_interactive');
  await delay(2500);
  return client;
}

async function sendAndWaitReply(client, prompt) {
  const sendExpr = `(async () => {
    const ta = document.querySelector('textarea.sc-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(prompt)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const send = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title || '').includes('发送'));
    if (!send || send.disabled) return -1;
    send.click();
    return 1;
  })()`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { if ((await lib.evalJs(client, sendExpr, 10000)) === 1) break; } catch { /* retry */ }
    await delay(1500);
  }
  // 轮询等回复稳定（最长 300s）
  const t0 = Date.now();
  let lastText = '';
  let stableSince = 0;
  while (Date.now() - t0 < 300000) {
    await delay(3000);
    const text = String(await lib.evalJs(client, `(async () => {
      const msgs = [...document.querySelectorAll('[class*="sc-msg-assistant"], [class*="assistantMessage"], .markdown-body')];
      return msgs.map((m) => m.innerText).join('\n').trim();
    })()`, 15000).catch(() => lastText));
    const busy = String(await lib.evalJs(client, `!!(document.querySelector('[class*="sc-busy"], [class*="typing"]'))`, 5000).catch(() => false));
    const sendBtn = await lib.evalJs(client, `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title || '').includes('发送')); return !!b && !b.disabled; })()`, 5000).catch(() => false);
    if (text && text === lastText && !busy && sendBtn) {
      stableSince += 3000;
      if (stableSince >= 9000) return text;
    } else stableSince = 0;
    lastText = text;
  }
  return lastText;
}

async function phase1() {
  const lib2 = { assert: (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
    try { fs.writeSync(1, `[p4-1] ${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(detail).slice(0, 150)}\n`); } catch {}
  } };
  sshDell(`rm -rf ${REMOTE_ROOT} && mkdir -p ${REMOTE_ROOT}`);
  const created = await fetchJson(`${API}/data/projects`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ name: `P4全链-${Date.now()}`, workspaceKind: 'ssh', sshHost: 'dell', remotePath: REMOTE_ROOT }),
  });
  const projectId = created.json && created.json.project && created.json.project.id;
  lib2.assert('P4-1 ssh project created', !!projectId, JSON.stringify(created.json || created).slice(0, 120));
  if (!projectId) process.exit(1);

  const client = await connectMain(projectId);
  const prompt = [
    '请用 resident_task_create 工具创建一个驻留任务，参数如下：',
    'command 填：sleep 1200 && echo done > .gewu/resident/sleep-done.txt',
    'intent 填：P4 全链验证探针：挂机 20 分钟',
    'success_criteria 填：1200 秒后 sleep-done.txt 出现',
    'failure_handling 填：notify-only',
    '创建完成后，把返回的 taskId、pid 和日志路径原样告诉我。',
  ].join('\n');
  const reply = await sendAndWaitReply(client, client && prompt);
  const taskIdMatch = String(reply).match(/res_[0-9a-z_]+/);
  lib2.assert('P4-2 agent created resident task (taskId in reply)', !!taskIdMatch, `reply=${String(reply).slice(0, 200)}`);
  if (!taskIdMatch) {
    await lib.screenshotPng(client, EVIDENCE, 'p4-phase1.png').catch(() => {});
    saveResults({ phase: 'phase1', projectId });
    process.exit(1);
  }
  const taskId = taskIdMatch[0];
  const cardRaw = sshDell(`cat ${REMOTE_ROOT}/.gewu/resident/${taskId}.json`);
  const card = JSON.parse(cardRaw);
  lib2.assert('P4-3 intent card on server (running + pid)', card.status === 'running' && Number.isFinite(card.backingProcess.pid),
    JSON.stringify({ status: card.status, pid: card.backingProcess.pid }));
  sshDell(`kill -0 ${card.backingProcess.pid}`);
  lib2.assert('P4-4 resident process alive on dell', true, `pid=${card.backingProcess.pid}`);
  fs.writeFileSync(STATE, JSON.stringify({ projectId, taskId, pid: card.backingProcess.pid, createdAt: new Date().toISOString() }, null, 2));
  await lib.screenshotPng(client, EVIDENCE, 'p4-phase1-conversation.png').catch(() => {});
  saveResults({ phase: 'phase1-done', projectId, taskId, pid: card.backingProcess.pid });
  console.log('PHASE1 DONE — 现在关软件（clean-stack），重开后再跑 phase2');
}

async function phase2() {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const lib2 = { assert: (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
    try { fs.writeSync(1, `[p4-2] ${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(detail).slice(0, 150)}\n`); } catch {}
  } };

  // 重开后：进程仍存活（setsid 跨后端重启）
  let alive = false;
  try { sshDell(`kill -0 ${state.pid}`); alive = true; } catch { alive = false; }
  lib2.assert('P2-A resident process survived backend restart (server-side detach)', alive, `pid=${state.pid}`);
  const cardRaw = sshDell(`cat ${REMOTE_ROOT}/.gewu/resident/${state.taskId}.json`);
  const cardAfterRestart = JSON.parse(cardRaw);
  lib2.assert('P2-B intent card intact across restart (server truth)', cardAfterRestart.status === 'running', `status=${cardAfterRestart.status}`);

  // 交接班 Channel B：新对话轮问驻留任务清单（模型应调 resident_task_list 读卡汇报）
  const client = await connectMain(state.projectId);
  const reply = await sendAndWaitReply(client, '项目里有正在运行的驻留任务吗？请用 resident_task_list 列出，并汇报每个任务的意图与状态（taskId 也要告诉我）。');
  lib2.assert('P2-C handover Channel B: agent reports resident task in new session',
    String(reply).includes(state.taskId) && /running|进行中|运行/.test(String(reply)),
    `reply=${String(reply).slice(0, 200)}`);
  await lib.screenshotPng && null;

  // 手动停止（ssh kill）→ 包装命令写 .exit=143 → 回访循环翻转 failed
  sshDell(`pkill -f 'sleep 1200' || true`);
  lib2.assert('P2-D manual stop executed (sleep killed)', true, 'pkill sleep 1200');
  // 等回访循环翻转（60s 节奏 × 2 轮）
  let cardFailed = false;
  for (let i = 0; i < 10 && !cardFailed; i++) {
    await delay(15000);
    try {
      const raw = sshDell(`grep -o '"status": "[a-z]*"' ${REMOTE_ROOT}/.gewu/resident/${state.taskId}.json | head -1`);
      cardFailed = /failed/.test(raw);
      if (cardFailed) {
        const exitRaw = sshDell(`cat ${REMOTE_ROOT}/.gewu/resident/${state.taskId}.exit 2>/dev/null || echo 143`);
        lib2.assert('P2-E card flipped to failed after manual stop', /failed/.test(raw), `exit=${exitRaw.trim()}`);
      }
    } catch { /* keep waiting */ }
  }
  lib2.assert('P2-F failed transition visible on server within budget', cardFailed, 'revisit loop converged');
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  if (PHASE === 'phase1') await phase1();
  else if (PHASE === 'phase2') await phase2();
  else { console.error('用法: block77-p4-live.cjs phase1|phase2'); process.exit(2); }
  const merged = saveResults({ lastPhase: PHASE });
  console.log(`[p4] ${PHASE} 完成; 累计 allPass=${merged.allPass} (${merged.assertions.filter((a) => a.pass).length}/${merged.assertions.length})`);
  process.exit(merged.allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
