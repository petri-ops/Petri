#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block116-decision-platform-live — BLOCK-116 P2 实机腿
 * （决策台账 + 观测面，真实 Jev 轮次；plan §3 P2）。
 *
 * 前置：dev 后端以 PETRI_JEV_INTENT_ROUTE=1 + TYPESAFE_API_KEY 启动
 * （export PETRI_JEV_INTENT_ROUTE=1 && bash scripts/restart-dev-stack.sh；
 * migration 011_decision_log 由后端启动自动应用）。
 * 鉴权缺失负例由契约测试覆盖（auth 中间件同构先例）。
 *
 * 断言：
 *   B1 提交闲聊消息触发意图路由决策 → 台账落行（间接经观测端点验证）；
 *   B2 观测端点：available=true 且 intent-route 行 calls≥1、degraded=0、均延迟>0；
 *   B3 阈值注册表面：观测行涵盖的接点均属注册表已知接点集合（无未知接点泄漏）。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-116');
const TASK_TIMEOUT_MS = Number(process.env.BLOCK116_TASK_TIMEOUT_MS || 120_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

module.exports = {
  id: 'block116-decision-platform-live',
  description: 'BLOCK-116 P2 实机腿：决策台账+观测面（真实 Jev 决策落账、summary 聚合在位）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    // B0 — 提交一条会触发意图路由的消息（chitchat 类，W1-2 接点分类即落台账）
    const sub = await rest('POST', '/ai/agent', { messages: [{ role: 'user', content: '嗨，在忙吗？' }] });
    if (!sub.ok || !sub.data?.taskId) throw new Error(`提交失败：${sub.status} ${JSON.stringify(sub.data).slice(0, 150)}`);
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    let terminal = null;
    while (Date.now() < deadline) {
      await sleep(1200);
      const t = await rest('GET', `/ai/agent/task/${encodeURIComponent(sub.data.taskId)}/meta`);
      const status = t.data && (t.data.agentStatus || t.data.agent_status);
      if (['completed', 'done', 'failed', 'cancelled'].includes(status)) { terminal = status; break; }
    }
    assert('B0_task_reaches_terminal', terminal !== null, `terminal=${terminal}`);

    // 给台账写入留一点缓冲（best-effort 异步记账）
    await sleep(1500);

    // B1 — 观测端点可用且聚合在位
    const s = await rest('GET', '/ai/decisions/summary?days=7');
    const points = (s.data && s.data.points) || [];
    assert('B1_summary_available', s.ok && s.data?.status === 'ok' && s.data?.available === true,
      `http=${s.status} body=${JSON.stringify(s.data).slice(0, 150)}`);
    const intentRow = points.find((p) => p.point === 'intent-route');
    assert('B2_intent_route_logged', !!intentRow && intentRow.calls >= 1 && intentRow.degradedCount === 0,
      `intent-route=${JSON.stringify(intentRow)}`);
    assert('B2b_latency_observed', !!intentRow && Number(intentRow.avgLatencyMs) > 0,
      `avgLatencyMs=${intentRow && intentRow.avgLatencyMs}`);

    // B3 — 已知接点集合（无未知接点泄漏）
    const KNOWN = new Set(['topic-shift', 'knowledge-guard', 'marker-celltype', 'intent-route', 'tool-route', 'failure-triage', 'test-suggest', 'test-probe', 'test-probe-degraded', 'x']);
    const unknown = points.map((p) => p.point).filter((p) => !KNOWN.has(p) && !p.startsWith('test-'));
    assert('B3_no_unknown_points', unknown.length === 0, `unknown=${JSON.stringify(unknown)}`);

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'decision-platform-flow.json'),
      JSON.stringify({ taskId: sub.data.taskId, terminal, summary: s.data }, null, 2));
    lib.log(`决策台账观测：${points.map((p) => `${p.point}×${p.calls}`).join(', ')}`);
  },
};
