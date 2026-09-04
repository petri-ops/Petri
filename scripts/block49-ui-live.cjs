#!/usr/bin/env node
'use strict';

/**
 * BLOCK-49 P4 用户侧实机 CDP 断言驱动：多 Agent 派生（dev Electron + 真实模型）。
 *   1) 连接 dev Electron :9222 → 项目 chat 模式
 *   2) 真实模型驱动：一句话要求 spawn_agent 派生两个子 agent → 并发运行 → wait_agent 收结果 → 父整合汇报
 *   3) 子 agent 任务落库（kind=subagent + spawnSource=tool:spawn_agent + parentTaskId 溯源）
 *   4) 截图：子 agent 运行中任务条 + 父整合完成回复
 * 前置：dev Electron 已在跑（wrapper 自带 --remote-debugging-port=9222）。
 * 证据：acceptance/block-49/ui-live.json + p49-0*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const PROJECT_ID = process.env.BIOF49_PROJECT || 'p_mtlnsv0f_xpjb';
const DB_PATH = process.env.BIOF49_DB
  || path.join(__dirname, '..', '.biof3-dev-user-data', 'data', 'biof3.db');
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-49');
const WAIT_MS = 8 * 60 * 1000;
const POLL_MS = 4000;

const PROMPT = [
  '请严格按以下步骤操作（必须使用 spawn_agent 工具，不要自己直接完成）：',
  '1) 用 spawn_agent 派生子 agent A，任务：给出 BRCA1、TP53、EGFR 三个基因各一句话功能说明。',
  '2) 用 spawn_agent 派生子 agent B，任务：把字符串 biof3 反转，并写出一句话说明。',
  '3) 用 wait_agent 分别等待 A 和 B 结束，取得各自结论。',
  '4) 最后把两份结论合并成一段话汇报给我。',
].join('\n');

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
  const r = await client.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(`evaluate_failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`.slice(0, 500));
  }
  return r.result.value;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function screenshot(client, file) {
  try {
    await client.send('Page.bringToFront', {});
    const r = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  } catch (e) {
    console.log(`WARN screenshot skipped (${path.basename(file)}): ${e.message}`);
  }
}

function sqliteRows(sql) {
  const out = execFileSync('sqlite3', [DB_PATH, '-json', sql], { encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : [];
}

function newSpawnedChildren(baselineIso) {
  return sqliteRows(
    `SELECT id, status, agent_status, created_at, finished_at, params, user_id
     FROM tasks WHERE type='agent_loop'
       AND params LIKE '%"spawnSource":"tool:spawn_agent"%'
       AND created_at > '${baselineIso}'
     ORDER BY created_at`
  ).map((row) => {
    let params = {};
    try { params = JSON.parse(row.params || '{}'); } catch {}
    return {
      agentId: row.id,
      status: row.status,
      agentStatus: row.agent_status,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      kind: params.kind,
      parentTaskId: params.parentTaskId,
      task: String(params.messages && params.messages[0] && params.messages[0].content || '').slice(0, 60),
    };
  });
}

function parentFinalMessage(parentTaskId) {
  const rows = sqliteRows(
    `SELECT content, ts FROM copilot_messages
     WHERE task_id='${parentTaskId}' AND role='assistant'
     ORDER BY ts DESC, id DESC LIMIT 1`
  );
  return rows[0] || null;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || ''));
  if (!page) throw new Error('biof3_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();

  const results = {
    startedAt: new Date().toISOString(),
    page: page.url,
    projectId: PROJECT_ID,
    assertions: [],
  };
  const assert = (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 400) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
  };

  // 0. 基线：本次会话前已有的 spawn_agent 子任务数
  const baselineChildren = newSpawnedChildren('1970-01-01');
  results.baselineChildrenCount = baselineChildren.length;
  results.baselineIso = results.startedAt;

  // 1. 导航到项目 chat 模式（Page.navigate 而非 location.href：后者会在
  // awaitPromise 下随上下文销毁抛 -32000）
  const targetUrl = `http://localhost:3000/project/${PROJECT_ID}?mode=chat`;
  await client.send('Page.navigate', { url: targetUrl });
  await delay(3500);
  console.log('NOTICE: 已导航到 chat 模式');

  // 2. composer 输入多 agent 指令 + Enter 发送
  const typed = await evalJS(client, `(async () => {
    const ta = document.querySelector('.sc-input');
    if (!ta) return { ok: false, reason: 'no_textarea' };
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(PROMPT)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return { ok: true };
  })()`);
  assert('composer 输入多 agent 指令并发送', typed && typed.ok, JSON.stringify(typed));
  await delay(2500);
  await screenshot(client, path.join(EVIDENCE_DIR, 'p49-01-sent.png'));

  // 3. 轮询：等待真实模型 spawn 出 ≥2 个子 agent，且全部到达终态
  const deadline = Date.now() + WAIT_MS;
  let children = [];
  let shotRunning = false;
  let parentTaskId = null;
  let parentFinal = null;
  while (Date.now() < deadline) {
    await delay(POLL_MS);
    children = newSpawnedChildren(results.baselineIso);
    if (children.length >= 1 && !shotRunning) {
      shotRunning = true;
      await screenshot(client, path.join(EVIDENCE_DIR, 'p49-02-children-running.png'));
      console.log(`NOTICE: 已捕获子 agent 运行截图（当前 ${children.length} 个子任务）`);
    }
    parentTaskId = parentTaskId || (children[0] && children[0].parentTaskId) || null;
    const terminal = children.filter((c) => ['completed', 'failed', 'cancelled'].includes(c.status));
    if (children.length >= 2 && terminal.length === children.length) {
      // 父任务最后一条 assistant 消息可能稍晚于子任务终态落库，多等两拍
      await delay(6000);
      parentFinal = parentTaskId ? parentFinalMessage(parentTaskId) : null;
      if (parentFinal) break;
    }
  }

  // 4. 断言
  results.children = children;
  results.parentTaskId = parentTaskId;
  results.parentFinal = parentFinal;

  assert(
    '真实模型经 spawn_agent 派生 ≥2 个子 agent（spawnSource=tool:spawn_agent）',
    children.length >= 2 && children.every((c) => c.kind === 'subagent' && !!c.parentTaskId),
    JSON.stringify(children.map((c) => ({ agentId: c.agentId, status: c.status, kind: c.kind })))
  );
  assert(
    '父子溯源成立（两个子 agent 同一 parentTaskId）',
    children.length >= 2 && new Set(children.map((c) => c.parentTaskId)).size === 1,
    JSON.stringify(children.map((c) => c.parentTaskId))
  );
  assert(
    '子 agent 全部到达终态',
    children.length >= 2 && children.every((c) => ['completed', 'failed', 'cancelled'].includes(c.status)),
    JSON.stringify(children.map((c) => ({ agentId: c.agentId, status: c.status, error: undefined })))
  );
  assert(
    '父任务最终回复整合两份子 agent 结论（wait_agent 回传协议可见）',
    !!parentFinal && String(parentFinal.content || '').length > 20,
    parentFinal ? String(parentFinal.content || '').slice(0, 200) : 'no final message'
  );

  await screenshot(client, path.join(EVIDENCE_DIR, 'p49-03-integrated.png'));

  const shotsExist = ['p49-01-sent.png', 'p49-02-children-running.png', 'p49-03-integrated.png']
    .filter((f) => fs.existsSync(path.join(EVIDENCE_DIR, f)));
  results.screenshots = shotsExist;
  assert('实机截图证据齐备（≥2 张）', shotsExist.length >= 2, JSON.stringify(shotsExist));

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui-live.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n证据已写入 acceptance/block-49/ui-live.json (allPass=${allPass})`);
  // CDP websocket 句柄会挂住事件循环，显式退出防止 10min 看门狗误杀（exit 2 假阴性）
  process.exit(allPass ? 0 : 1);
}

const watchdog = setTimeout(() => {
  console.error('FAIL UI 实机脚本 10min 看门狗超时');
  process.exit(2);
}, 600000);
watchdog.unref();

main().catch((e) => {
  console.error('FAIL UI 实机脚本异常:', e && e.stack || e);
  process.exit(1);
});
