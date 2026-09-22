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
 * 断言（观测走单一事件通道 task_events，SSE 采集）：
 *   R1 单域任务消息（workspace 类）→ 事件流含 tool_route(family=workspace) 且任务终态
 *      done（路由后能力不损实证）；
 *   R2 纯对话消息（all 类）→ 无 tool_route 采纳事件（弃权=全量，安全阀实证）。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-113');
const TASK_TIMEOUT_MS = Number(process.env.BLOCK113_TASK_TIMEOUT_MS || 180_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

/** 订阅 task SSE 流至 [DONE]（或超时），收集事件信封 {seq, eventType, payload}。 */
async function collectEvents(taskId, timeoutMs) {
  const url = API + '/ai/agent/task/' + encodeURIComponent(taskId) + '?afterSeq=0';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const events = [];
  try {
    const resp = await fetch(url, { headers: { Authorization: 'Bearer desktop-local' }, signal: abort.signal });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const SEP = String.fromCharCode(10) + String.fromCharCode(10);
      let sep;
      while ((sep = buffer.indexOf(SEP)) !== -1) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 2);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return events;
        try { events.push(JSON.parse(data)); } catch {}
      }
    }
  } catch {} finally { clearTimeout(timer); }
  return events;
}

/** 提交一条消息并等 task 终态，再采集全量事件。 */
async function submitAndWait(message, timeoutMs) {
  const sub = await rest('POST', '/ai/agent', { messages: [{ role: 'user', content: message }] });
  if (!sub.ok || !sub.data?.taskId) throw new Error(`提交失败：${sub.status} ${JSON.stringify(sub.data).slice(0, 150)}`);
  const { taskId } = sub.data;
  const deadline = Date.now() + timeoutMs;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(1200);
    const t = await rest('GET', `/ai/agent/task/${encodeURIComponent(taskId)}/meta`);
    const meta = t.data || null;
    const status = meta && (meta.agentStatus || meta.agent_status);
    if (status === 'completed' || status === 'done' || status === 'failed' || status === 'cancelled') { terminal = status; break; }
  }
  if (!terminal) throw new Error(`task ${taskId} 超时未终态`);
  const envelopes = await collectEvents(taskId, 15000);
  const routes = envelopes
    .filter((e) => e.eventType === 'tool_route' || (e.payload && e.payload.event === 'tool_route'))
    .map((e) => e.payload || {});
  return { taskId, terminal, routes };
}

module.exports = {
  id: 'block113-toolroute-live',
  description: 'BLOCK-113 P2 实机腿：工具预路由（单域采纳 tool_route 事件 + all 弃权）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const evidence = { scenarios: [] };

    // R1 — workspace 单域任务：tool_route(family=workspace) 采纳 + 正常终态
    const ws = await submitAndWait('帮我在项目里新建一个 block113-live.txt 文件，内容写 hi', TASK_TIMEOUT_MS);
    const wsRoute = ws.routes.find((r) => r.family === 'workspace');
    assert('R1_workspace_route_adopted', !!wsRoute && typeof wsRoute.confidence === 'number',
      `routes=${JSON.stringify(ws.routes)}`);
    assert('R1b_workspace_task_terminal', ws.terminal === 'done' || ws.terminal === 'completed',
      `terminal=${ws.terminal}（路由后能力不损：任务正常完成）`);
    evidence.scenarios.push({ scenario: 'workspace', taskId: ws.taskId, terminal: ws.terminal, routes: ws.routes });

    // R2 — all 类纯对话：不采纳（弃权=全量，安全阀）
    const chat = await submitAndWait('你好呀', TASK_TIMEOUT_MS);
    assert('R2_chitchat_no_adoption', chat.terminal !== null && chat.routes.length === 0,
      `terminal=${chat.terminal} routes=${JSON.stringify(chat.routes)}`);
    evidence.scenarios.push({ scenario: 'chitchat', taskId: chat.taskId, terminal: chat.terminal, routes: chat.routes });

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'toolroute-live-flow.json'), JSON.stringify(evidence, null, 2));
  },
};
