#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block112-intent-live — BLOCK-112 P2 实机腿
 * （copilot 发送前意图路由，真实 Jev 分类 + 真实模型直答；plan §5 P2）。
 *
 * 前置：dev 后端以 PETRI_JEV_INTENT_ROUTE=1 + TYPESAFE_API_KEY 启动
 * （export PETRI_JEV_INTENT_ROUTE=1 && bash scripts/restart-dev-stack.sh）。
 * 本 flow 验证显式开启形态；默认关/缺 key/超时等降级形态由契约测试
 * test/block112-intent-routing.test.mjs 覆盖（单后端进程无法运行中翻 env）。
 *
 * 断言：
 *   N1 闲聊消息 → 快路径 task：run_started+delta 事件、无 tool 事件、终态 done；
 *   N2 闲聊直答文本落会话（meta.chitchatFastPath=true 权威标记）；
 *   N3 任务消息 → 正常 agent loop（会话回复无 chitchatFastPath 标记）；
 *   N4 临时会话清理。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-112');
const TASK_TIMEOUT_MS = Number(process.env.BLOCK112_TASK_TIMEOUT_MS || 180_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

/** 订阅 task SSE 流至 [DONE]（或超时），收集事件信封。 */
async function collectEvents(taskId, timeoutMs) {
  const authHeader = { Authorization: 'Bearer desktop-local' };
  const url = API + '/ai/agent/task/' + encodeURIComponent(taskId) + '?afterSeq=0';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const events = [];
  try {
    const resp = await fetch(url, { headers: authHeader, signal: abort.signal });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      const SEP = String.fromCharCode(10) + String.fromCharCode(10);
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

/** 提交一条消息并等 task 终态，返回 {taskId, conversationId, events, terminalTask}。 */
async function submitAndWait(message, timeoutMs) {
  const sub = await rest('POST', '/ai/agent', { messages: [{ role: 'user', content: message }] });
  if (!sub.ok || !sub.data?.taskId) throw new Error(`提交失败：${sub.status} ${JSON.stringify(sub.data).slice(0, 150)}`);
  const { taskId, conversationId } = sub.data;
  const deadline = Date.now() + timeoutMs;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(1000);
    const t = await rest('GET', `/ai/agent/task/${encodeURIComponent(taskId)}/meta`);
    const meta = t.data || null;
    const status = meta && (meta.agentStatus || meta.agent_status);
    if (status === 'completed' || status === 'done' || status === 'failed' || status === 'cancelled') { terminal = status; break; }
  }
  if (!terminal) throw new Error(`task ${taskId} 超时未终态`);
  const envelopes = await collectEvents(taskId, 15000);
  const events = envelopes.map((e) => ({ seq: e.seq, eventType: e.eventType, event: e.payload && e.payload.event }));
  return { taskId, conversationId, events, terminal };
}

/** 取会话最近一条 assistant 消息（含 meta）。 */
async function lastAssistantMessage(conversationId) {
  const r = await rest('GET', `/ai/conversations/${encodeURIComponent(conversationId)}/messages?limit=10`);
  const msgs = (r.data && r.data.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return msgs[i];
  }
  return null;
}

module.exports = {
  id: 'block112-intent-live',
  description: 'BLOCK-112 P2 实机腿：意图路由（闲聊快路径 delta+done / 任务走正常 loop）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const evidence = { scenarios: [] };
    const convIds = [];

    try {
      // N1/N2 — 闲聊消息走快路径
      const chat = await submitAndWait('你好呀，今天有点累，陪我聊两句', TASK_TIMEOUT_MS);
      if (chat.conversationId) convIds.push(chat.conversationId);
      const evTypes = chat.events.map((e) => e.eventType || e.event);
      assert('N1_chitchat_fast_path_events', (chat.terminal === 'done' || chat.terminal === 'completed')
        && evTypes.includes('run_started') && evTypes.includes('delta'),
        `terminal=${chat.terminal} eventTypes=${JSON.stringify(evTypes)}`);
      assert('N1b_chitchat_no_tool_events', !evTypes.includes('tool_call') && !evTypes.includes('tool_result'),
        `快路径不得有工具事件：${JSON.stringify(evTypes)}`);
      const assistantMsg = await lastAssistantMessage(chat.conversationId);
      assert('N2_chitchat_reply_persisted_with_marker', !!assistantMsg
        && assistantMsg.meta && assistantMsg.meta.chitchatFastPath === true
        && String(assistantMsg.content || '').length > 0,
        `assistant meta=${JSON.stringify(assistantMsg && assistantMsg.meta)}`);
      evidence.scenarios.push({ scenario: 'chitchat', taskId: chat.taskId, terminal: chat.terminal, evTypes, replyHead: assistantMsg && String(assistantMsg.content).slice(0, 60) });

      // N3 — 任务消息走正常 agent loop（回复不带快路径标记）
      const task = await submitAndWait('帮我写一句话总结：火山图用于展示差异基因的倍数变化与显著性', TASK_TIMEOUT_MS);
      if (task.conversationId) convIds.push(task.conversationId);
      assert('N3_task_message_goes_normal_loop', task.terminal === 'done' || task.terminal === 'completed',
        `terminal=${task.terminal}`);
      const taskAssistantMsg = await lastAssistantMessage(task.conversationId);
      assert('N3b_task_reply_no_fastpath_marker', !!taskAssistantMsg
        && !(taskAssistantMsg.meta && taskAssistantMsg.meta.chitchatFastPath === true),
        `task 回复 meta=${JSON.stringify(taskAssistantMsg && taskAssistantMsg.meta)}`);
      evidence.scenarios.push({ scenario: 'task', taskId: task.taskId, terminal: task.terminal });
    } finally {
      // N4 — 临时会话清理（best-effort）
      const cleanups = [];
      for (const convId of [...new Set(convIds)]) {
        const r = await rest('DELETE', `/ai/conversations/${encodeURIComponent(convId)}`).catch(() => null);
        // 200=已删；404=活跃会话语义下两次提交复用同会话、首删已完成——幂等视为 ok
        const ok = (r && r.ok) || (r && r.status === 404);
        cleanups.push(`${String(convId).slice(0, 8)}=${ok ? 'ok' : 'fail(' + (r && r.status) + ')'}`);
      }
      assert('N4_temp_conversations_cleaned', cleanups.length >= 1 && cleanups.every((c) => c.endsWith('ok')),
        `cleanups=${JSON.stringify(cleanups)}`);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'intent-live-flow.json'), JSON.stringify({ evidence, cleanups }, null, 2));
    }
  },
};
