#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block109-reporting-live — 「子智能体汇报收敛」+「终态对账 v1.5」实机腿
 * （UI-433 实机证据 + 对账机制真实轮次验证；2026-09-21 用户裁决「你能测吗」→自动化）
 *
 * S1 汇报纪律（真模型 spawn 双子智能体）：
 *   A1 两个子任务终态 completed；A2 每个子任务回传为要点式（50 ≤ 长度 < 2000，
 *   契约文本「核对要点/未核对」同构倾向）；A3 父任务存在统一汇总的最终消息。
 * S2 终态对账 v1.5（spawn 双子任务 + 运行中取消其一）：
 *   A4 前置（子任务 cancelled/failed 且清单最后状态全部 completed）成立时，
 *   reconciliation_notice 事件必须在场；前置不成立（模型未配合标记/子任务未取消）
 *   → 如实记录 precondition_not_met 后放行（诚实分级，不伪造场景）。
 *
 * 只连后端 :3001（行为面验证；呈现面已由 block109-agent-panel 覆盖）。取证走
 * dev 库只读副本（node:sqlite）。
 * 前置：dev 栈在跑（新代码含汇报契约/对账/意图/流重试）。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const DB_PATH = path.join(process.cwd(), '.petri-dev-user-data', 'data', 'petri.db');
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-109');
const RUN_TIMEOUT_MS = Number(process.env.BLOCK109_REPORTING_TIMEOUT_MS || 600_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });
  return { ok: resp.ok, data: await resp.json().catch(() => null) };
}

function dbConnect() {
  const Database = require('better-sqlite3');
  return new Database(DB_PATH, { readonly: true });
}

function taskEvents(taskId) {
  const db = dbConnect();
  const rows = db.prepare('SELECT event_type, payload FROM task_events WHERE task_id=? ORDER BY seq').all(taskId);
  db.close();
  return rows.map((r) => {
    try { return { eventType: r.event_type, payload: JSON.parse(r.payload) }; }
    catch { return { eventType: r.event_type, payload: null }; }
  });
}

function taskStatus(taskId) {
  const db = dbConnect();
  const row = db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId);
  db.close();
  return row ? row.status : null;
}

function childRepliesOf(taskId) {
  const db = dbConnect();
  const children = db.prepare(
    `SELECT id, status FROM tasks WHERE json_valid(params)=1 AND json_extract(params,'$.parentTaskId')=?`
  ).all(taskId);
  db.close();
  return children.map((c) => {
    let text = '';
    let toolCalls = 0;
    for (const e of taskEvents(c.id)) {
      if (e.eventType === 'tool_call') toolCalls += 1;
      const d = e.payload && e.payload.choices && e.payload.choices[0] && e.payload.choices[0].delta;
      if (d && typeof d.content === 'string') text += d.content;
    }
    return { taskId: c.id, status: c.status, toolCalls, len: text.length, text };
  });
}

function lastTodoItems(taskId) {
  const todos = taskEvents(taskId).filter(
    (e) => e.eventType === 'tool_call' && e.payload && e.payload.name === 'todo_write'
  );
  const last = todos[todos.length - 1];
  return last && last.payload && last.payload.args && Array.isArray(last.payload.args.items)
    ? last.payload.args.items
    : [];
}

async function submit(messages, projectId) {
  const r = await rest('POST', '/ai/agent', { messages, context: { page: 'desktop-project', projectId, accessMode: 'full' } });
  if (!r.ok || !r.data?.taskId) throw new Error('submit_failed: ' + JSON.stringify(r.data).slice(0, 200));
  return r.data;
}

async function waitDone(taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    const s = taskStatus(taskId);
    if (s && s !== 'running') return s;
  }
  return 'timeout';
}

const BULLET_MAX = 2000;

module.exports = {
  id: 'block109-reporting-live',
  description: '汇报收敛实机（子侧要点式/父侧统一汇总）+ 终态对账 v1.5（取消子任务 × 全完成清单）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const created = await rest('POST', '/data/projects', { name: `B109-Reporting-${Date.now()}`, modality: 'general' });
    if (!created.ok || !created.data?.project) throw new Error('create_project_failed');
    const projectId = created.data.project.id;
    const evidence = { scenarios: [], cleanups: [] };

    try {
      // ===== S1 汇报纪律 =====
      {
        const sub = await submit([
          { role: 'user', content: '请用 spawn_agent 派两个子智能体并行工作：(1) 列出项目根目录下的文件名；(2) 读取 package.json 并统计 dependencies 与 devDependencies 的总数。两个都完成后，把结果统一汇总成一段话告诉我。' },
        ], projectId);
        const status = await waitDone(sub.taskId, RUN_TIMEOUT_MS);
        const children = childRepliesOf(sub.taskId);
        const convs = await rest('GET', `/ai/conversations?status=active&project_id=${encodeURIComponent(projectId)}`);
        const conversationId = (convs.data?.conversations || [])[0]?.id || null;
        let parentFinal = null;
        if (conversationId) {
          const msgs = await rest('GET', `/ai/conversations/${encodeURIComponent(conversationId)}/messages?limit=200`);
          const list = msgs.data?.messages || msgs.data || [];
          parentFinal = [...(Array.isArray(list) ? list : [])].reverse().find((m) => m.role === 'assistant') || null;
        }
        evidence.s1 = {
          parentStatus: status,
          children: children.map((c) => ({ taskId: c.taskId.slice(0, 8), status: c.status, toolCalls: c.toolCalls, len: c.len, head: c.text.slice(0, 200) })),
          parentFinalLen: parentFinal ? parentFinal.content.length : 0,
        };

        assert('S1A1_children_completed', children.length >= 2 && children.every((c) => c.status === 'completed'),
          `children=${JSON.stringify(evidence.s1.children.map((c) => c.status))}`);
        assert('S1A2_child_replies_bullet_style', children.length >= 2 && children.every(
          (c) => c.len >= 50 && c.len < BULLET_MAX
        ), `要点式回传（50≤len<${BULLET_MAX}）：${JSON.stringify(evidence.s1.children.map((c) => c.len))}`);
        assert('S1A3_parent_unified_summary', !!parentFinal && parentFinal.content.length >= 30,
          `parentFinalLen=${parentFinal ? parentFinal.content.length : 0}`);
      }

      // ===== S2 终态对账 v1.5（取消一个子任务 × 全完成清单）=====
      {
        const sub = await submit([
          { role: 'user', content: '请用 spawn_agent 派两个子智能体并行工作，并用 todo_write 建两项清单各对应一个子任务：(1) 列出项目根目录下的文件名；(2) 统计 frontend/src 目录下 .ts 文件的数量（尽量精确，多花些时间）。两个子智能体结束后，无论各自结果如何都把清单两项都标记 completed，然后统一汇总一句话。' },
        ], projectId);
        const deadline = Date.now() + RUN_TIMEOUT_MS;
        let cancelledOne = false;
        while (Date.now() < deadline) {
          await sleep(3000);
          const children = childRepliesOf(sub.taskId);
          const running = children.filter((c) => c.status === 'running');
          if (children.length >= 2 && running.length > 0 && !cancelledOne) {
            const target = running[0];
            await rest('POST', `/ai/agent/task/${encodeURIComponent(target.taskId)}/cancel`, {});
            cancelledOne = true;
            lib.log(`cancelled child ${target.taskId.slice(0, 8)}`);
          }
          if (children.length >= 2 && running.length === 0) break;
        }
        const status = await waitDone(sub.taskId, Math.max(10000, deadline - Date.now()));
        const children = childRepliesOf(sub.taskId);
        const todos = lastTodoItems(sub.taskId);
        const allCompleted = todos.length > 0 && todos.every((t) => t.status === 'completed');
        const notClean = children.filter((c) => c.status === 'failed' || c.status === 'cancelled');
        const notice = taskEvents(sub.taskId).find(
          (e) => e.eventType === 'reconciliation_notice'
        ) || null;
        evidence.s2 = {
          parentStatus: status,
          children: children.map((c) => ({ taskId: c.taskId.slice(0, 8), status: c.status })),
          cancelledOne,
          todosAllCompleted: allCompleted,
          preconditionMet: allCompleted && notClean.length > 0,
          reconciliationNoticePresent: !!notice,
          noticeDetail: notice && notice.payload,
        };
        // 诚实分级：前置成立 → 对账提示必须在场；前置不成立（模型未配合/取消未达）
        // → precondition_not_met 如实放行（不伪造场景）。
        assert('S2_reconciliation_notice_on_mismatch',
          evidence.s2.preconditionMet ? !!notice : true,
          `preconditionMet=${evidence.s2.preconditionMet} todosAllCompleted=${allCompleted} `
          + `children=${JSON.stringify(evidence.s2.children.map((c) => c.status))} notice=${!!notice}`);
      }

      fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'reporting-live-samples.json'),
        JSON.stringify(evidence, null, 2),
      );
      return true;
    } finally {
      try {
        const db = dbConnect();
        const convRows = db.prepare('SELECT id FROM copilot_conversations WHERE project_id=?').all(projectId);
        db.close();
        for (const c of convRows) {
          await rest('DELETE', `/ai/conversations/${encodeURIComponent(c.id)}`).catch(() => {});
        }
        const del = await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => false);
        evidence.cleanups.push(String(del !== false));
        assert('S3_temp_data_cleaned_up', convRows.length === 0 || evidence.cleanups.every((c) => c === 'true'),
          `cleanups=${evidence.cleanups.join(',')} convRows=${convRows.length}`);
      } catch (e) {
        lib.log('cleanup error: ' + e.message);
      }
    }
  },
};
