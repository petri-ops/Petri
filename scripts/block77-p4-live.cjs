#!/usr/bin/env node
'use strict';

/**
 * BLOCK-77 P4 实机全链验收（两阶段，外层 bash 编排关软件/重开）：
 *
 * phase1:
 *   REST 建 aliyun SSH 项目 → CDP 真实模型对话（resident_task_create 挂机 sleep）
 *   → 断言意图卡落服务器 + 进程存活 → 记录 taskId/pid → 写状态文件
 * phase2（外层已重启软件 = 重开交接班）:
 *   CDP 真实对话：agent 应主动汇报驻留任务（systemPrompt 注入 digest）
 *   → ssh kill 驻留进程（异常路径）→ 回访循环翻转 failed
 *   → 再对话：agent 汇报失败状态（R5 不自动重启）→ 清理
 *
 * 证据：acceptance/block-77/p4-live.json + 截图
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

const results = { startedAt: new Date().toISOString(), phase: PHASE, assertions: [] };
try {
  const prev = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'p4-live.json'), 'utf8'));
  if (prev.phase === 'phase1' && PHASE === 'phase2') results.prevAssertions = prev.assertions;
} catch {}

function assert(name, pass, detail = '') {
  results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
  try { fs.writeSync(1, '[p4-' + PHASE.slice(-1) + '] ' + (pass ? 'PASS' : 'FAIL') + ' ' + name + ' :: ' + String(detail).slice(0, 150) + '\n'); } catch {}
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'aliyun', cmd], { encoding: 'utf8', timeout: 30000, windowsHide: true });
}

// CDP 对话驱动（block67-p2-live 同款）
let lib = null;
async function connectMain(projectId) {
  const targets = await lib.pollTargets({ timeoutMs: 15000 });
  const pages = lib.filterPageTargets(targets, /localhost:3000/);
  if (!pages.length) throw new Error('no_spa_page');
  const main = await lib.selectPageTarget(pages, {
    probe: (client) => lib.evalJs(client, '!!document.querySelector(\'textarea.sc-input\')', 5000).catch(() => false),
  });
  const client = await lib.connectTarget(main);
  await client.send('Page.navigate', { url: `http://localhost:3000/project/${projectId}` }).catch(() => {});
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    ok = await lib.evalJs(client, '!!document.querySelector(\'textarea.sc-input\')').catch(() => false);
    if (!ok) await delay(1000);
  }
  if (!ok) throw new Error('app_not_interactive');
  await delay(2500);
  return client;
}

async function sendAndWaitReply(client, prompt) {
  const sendExpr = `(async () => {
    const ta = document.querySelector('textarea.sc-input');
    if (!ta) return 'no_textarea';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(prompt)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const send = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title || '').includes('发送'));
    if (!send || send.disabled) return 'send_unavailable';
    send.click();
    return 'sent';
  })()`;
  for (let a = 0; a < 3; a += 1) {
    try { if ((await lib.evalJs(client, sendExpr, 10000)) === 'sent') break; } catch { /* retry */ }
    await delay(1500);
  }
  const t0 = Date.now();
  let lastText = '';
  let stableSince = 0;
  while (Date.now() - t0 < 240000) {
    await delay(3000);
    const text = String(await lib.evalJs(client, `(() => {
      const msgs = [...document.querySelectorAll('[class*="sc-msg-assistant"], [class*="assistantMessage"], .markdown-body')];
      return msgs.map((m) => m.innerText).join('\n').trim();
    })()`, 20000).catch(() => lastText));
    const busy = String(await lib.evalJs(client, `!!(document.querySelector('[class*="sc-busy"], [class*="typing"]'))`, 5000).catch(() => false));
    const sendBtn = String(await lib.evalJs(client, `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title || '').includes('发送')); return !!b && !b.disabled; })()`, 5000).catch(() => false));
    if (text && text === lastText && !busy && sendBtn === 'true') {
      stableSince += 3000;
      if (stableSince >= 12000) return text;
    } else stableSince = 0;
    lastText = text;
  }
  return lastText;
}

async function createProject(name) {
  sshDell(`rm -rf ${REMOTE_ROOT} && mkdir -p ${REMOTE_ROOT}`);
  const created = await fetchJson(`${API}/data/projects`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ name, workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: REMOTE_ROOT }),
  });
  const projectId = created.json && created.json.project && created.json.project.id;
  assert('project created', !!projectId, JSON.stringify(created.json || created).slice(0, 120));
  return projectId;
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const libPath = path.join(REPO, '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs');
  lib = require(libPath);
  let projectId = null;

  if (PHASE === 'phase1') {
    // ── ① 建 aliyun SSH 项目 ──
    projectId = await createProject(`P4驻留-${Date.now()}`);
    if (!projectId) process.exit(1);
    const client = await connectMain(projectId);

    // ── ② 真实模型对话：挂机 sleep 900 ──
    const prompt = [
      '请用 resident_task_create 工具创建一个驻留任务，参数：',
      'command 填：sleep 900 && echo done > .gewu/resident/p4-done.txt',
      'intent 填：P4 全链验收：挂机 15 分钟探针',
      'success_criteria 填：900 秒后 p4-done.txt 出现',
      'failure_handling 填：notify-only',
      '创建完成后告诉我 taskId。',
    ].join('\n');
    const reply = await sendAndWaitReply(client, prompt);
    const taskIdMatch = String(reply).match(/res_[0-9a-z_]+/);
    assert('P4-1 agent created resident task (model used tool)', !!taskIdMatch,
      `reply=${String(reply).slice(0, 200)}`);
    if (!taskIdMatch) {
      await lib.screenshotPng(client, EVIDENCE, 'p4-no-card.png').catch(() => {});
      saveAndExit(projectId, null);
      return;
    }
    const taskId = taskIdMatch[0];

    // ── ③ 服务器真值：意图卡 + 进程存活 ──
    const cardRaw = sshDell(`cat ${REMOTE_ROOT}/.gewu/resident/${taskId}.json`);
    const card = JSON.parse(cardRaw);
    assert('P4-2 intent card on server (running)', card.status === 'running', `status=${card.status}`);
    let alive = true;
    try { sshDell(`kill -0 ${card.backingProcess.pid}`); } catch { alive = false; }
    assert('P4-3 backing process alive on aliyun', alive, `pid=${card.backingProcess.pid}`);

    // ── ④ 交接班 Channel B：同会话追问（systemPrompt 已注入 digest）──
    const followup = await sendAndWaitReply(client, '现在项目里有几个驻留任务？请用 resident_task_list 确认并汇报。');
    assert('P4-4 handover Channel B: agent reports via resident_task_list',
      String(followup).includes(taskId) || /running|进行中|1 个/.test(String(followup)),
      `reply=${String(followup).slice(0, 200)}`);
    await lib.screenshotPng(client, EVIDENCE, 'p4-phase1-conversation.png').catch(() => {});

    // ── ⑤ 关软件（外层 bash 编排 kill 栈）+ 写状态 ──
    saveAndExit(projectId, taskId);
  }

  if (PHASE === 'phase2') {
    // ── 读取 phase1 状态 ──
    const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    projectId = state.projectId;
    const taskId = state.taskId;
    const pid = state.pid;
    assert('P4-5 state restored from phase1', !!projectId && !!taskId && !!pid, JSON.stringify(state).slice(0, 160));

    // ── ⑥ 重开后：dell 进程仍存活（关软件不影响 detached 进程）──
    let alive = true;
    try { sshDell(`kill -0 ${pid}`); } catch { alive = false; }
    assert('P4-6 backing process survived app restart', alive, `pid=${pid} alive=${alive}`);

    // ── ⑦ 交接班 Channel A+B：新会话 → agent 主动汇报 ──
    const client = await connectMain(projectId);
    const reply = await sendAndWaitReply(client, '项目当前有什么挂机中的驻留任务？请汇报意图和状态。');
    assert('P4-7 handover: agent reports resident task after restart',
      String(reply).includes(taskId) || /挂机|驻留|P4 全链/.test(String(reply)),
      `reply=${String(reply).slice(0, 240)}`);

    // ── ⑧ 异常路径：kill 进程 → 回访循环翻转 failed → agent 汇报 ──
    sshDell(`kill -9 ${pid} 2>/dev/null; true`);
    // 等回访循环（60s 节奏 + deadTicks 2 轮 → failed 翻转）
    let flipped = false;
    for (let i = 0; i < 10 && !flipped; i++) {
      await delay(15000);
      try {
        const raw = sshDell(`grep -o '"status": "[a-z]*"' ${REMOTE_ROOT}/.gewu/resident/${taskId}.json | head -1`);
        flipped = /failed/.test(raw);
      } catch { /* keep waiting */ }
    }
    assert('P4-8 abnormal exit flipped card to failed (revisit loop)', flipped, 'server card status');
    const reply2 = await sendAndWaitReply(client, '驻留任务的进程已经终止了，请确认状态并汇报。');
    assert('P4-9 agent reports failure honestly (R5 no auto-restart)',
      /failed|失败|异常|终止/.test(String(reply2)), `reply=${String(reply2).slice(0, 200)}`);

    // ── 清理 ──
    try { sshDell(`rm -rf ${REMOTE_ROOT}`); } catch {}
    await fetchJson(`${API}/data/projects/${projectId}`, { method: 'DELETE', headers: AUTH }).catch(() => {});
  }

  saveAndExit(projectId, null);
}

function saveAndExit(projectId, taskId) {
  const merged = {
    phase: PHASE,
    startedAt: results.startedAt,
    finishedAt: new Date().toISOString(),
    assertions: results.assertions,
    allPass: results.assertions.length > 0 && results.assertions.every((a) => a.pass),
    projectId: projectId || null,
    taskId: taskId || null,
  };
  fs.writeFileSync(path.join(EVIDENCE, `p4-${PHASE}.json`), JSON.stringify(merged, null, 2) + '\n');
  console.log(`[p4] ${PHASE}: ${merged.assertions.filter((a) => a.pass).length}/${merged.assertions.length} allPass=${merged.allPass}`);
  process.exit(merged.allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
