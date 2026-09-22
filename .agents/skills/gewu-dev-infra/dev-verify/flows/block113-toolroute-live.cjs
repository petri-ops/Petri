#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block113-toolroute-live — BLOCK-113 P2 实机腿
 * （工具两跳预路由，真实 Jev 分类 + 真实 agent loop；plan §4 P2）。
 *
 * 前置：dev 后端以 BIOF3_JEV_TOOL_ROUTE=1 + TYPESAFE_API_KEY 启动
 * （export BIOF3_JEV_TOOL_ROUTE=1 && bash scripts/restart-dev-stack.sh）。
 * 本 flow 验证显式开启形态；默认关/缺 key/超时等降级形态由契约测试
 * test/block113-tool-prerouting.test.mjs 覆盖。
 *
 * 断言：
 *   R1 单域任务消息（workspace 类）→ 后端日志出现 [block113] tool route adopted
 *      （决策真实发生且采纳），任务正常终态（路由后能力不损实证）；
 *   R2 纯对话消息（all 类）→ 不出现新的 adopted 行（弃权=全量，安全阀实证）；
 *   R3 日志偏移复位（flow 幂等：读日志从基线偏移起算）。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-113');
const DEV_LOG = path.join(process.cwd(), '.dev-stack-live.log');
const TASK_TIMEOUT_MS = Number(process.env.BLOCK113_TASK_TIMEOUT_MS || 180_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logTailFrom(offset) {
  try {
    return { text: fs.readFileSync(DEV_LOG, 'utf8').slice(offset), newOffset: fs.statSync(DEV_LOG).size };
  } catch {
    return { text: '', newOffset: offset };
  }
}

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

async function submitAndWait(message, timeoutMs) {
  const sub = await rest('POST', '/ai/agent', { messages: [{ role: 'user', content: message }] });
  if (!sub.ok || !sub.data?.taskId) throw new Error(`提交失败：${sub.status} ${JSON.stringify(sub.data).slice(0, 150)}`);
  const { taskId } = sub.data;
  const deadline = Date.now() + timeoutMs;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(1500);
    const t = await rest('GET', `/ai/agent/task/${encodeURIComponent(taskId)}/meta`);
    const meta = t.data || null;
    const status = meta && (meta.agentStatus || meta.agent_status);
    if (status === 'completed' || status === 'done' || status === 'failed' || status === 'cancelled') { terminal = status; break; }
  }
  return { taskId, terminal };
}

module.exports = {
  id: 'block113-toolroute-live',
  description: 'BLOCK-113 P2 实机腿：工具预路由（单域采纳 + all 弃权，日志与终态双证）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const evidence = { scenarios: [] };

    // R3 — 日志基线偏移
    const base = logTailFrom(0);
    let offset = base.newOffset;

    // R1 — workspace 单域任务：采纳日志 + 任务正常终态
    const ws = await submitAndWait('帮我在项目里新建一个 block113-live.txt 文件，内容写 hi', TASK_TIMEOUT_MS);
    const tail1 = logTailFrom(offset);
    offset = tail1.newOffset;
    const adoptedLines = tail1.text.split('\n').filter((l) => l.includes('[block113] tool route adopted'));
    assert('R1_workspace_route_adopted', adoptedLines.some((l) => l.includes('family=workspace')),
      `adopted=${JSON.stringify(adoptedLines)}`);
    assert('R1b_workspace_task_terminal', ws.terminal === 'done' || ws.terminal === 'completed',
      `terminal=${ws.terminal}（路由后能力不损：任务正常完成）`);
    evidence.scenarios.push({ scenario: 'workspace', taskId: ws.taskId, terminal: ws.terminal, adopted: adoptedLines });

    // R2 — all 类纯对话：不采纳（弃权=全量）
    const chat = await submitAndWait('你好呀', TASK_TIMEOUT_MS);
    const tail2 = logTailFrom(offset);
    offset = tail2.newOffset;
    const adopted2 = tail2.text.split('\n').filter((l) => l.includes('[block113] tool route adopted'));
    assert('R2_chitchat_no_adoption', chat.terminal !== null && adopted2.length === 0,
      `terminal=${chat.terminal} adoptedAfter=${JSON.stringify(adopted2)}`);
    evidence.scenarios.push({ scenario: 'chitchat', taskId: chat.taskId, terminal: chat.terminal });

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'toolroute-live-flow.json'), JSON.stringify(evidence, null, 2));
  },
};
