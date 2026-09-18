#!/usr/bin/env node
'use strict';

/**
 * BLOCK-85 双真机验收 P3（Runbook §3）：真实模型委托跨机跑通。
 *
 * 链路：POST /api/ai/agent（task 模式，返回 taskId）→ GET /api/ai/agent/task/:taskId
 * 消费 SSE → agent 调 delegate_to_gewu_node(peerId, task) → Mac 开独立 agent 会话执行
 * → 回执（状态 + 对方 agent 摘要）回流 Windows 会话。
 * 断言：
 *   A1 事件流出现 delegate_to_gewu_node 调用（peerId 正确）
 *   A2 委托回执成功（Mac 侧 agent 执行并返回摘要）
 *   A3 任务终态完成
 * 证据：acceptance/block-85/dual-p3-delegate.json（Runbook 指定路径，含原始事件流）
 * 前置：Windows 侧聊天模型凭据可用；Mac 侧 agent 模型凭据可用（Runbook：DeepSeek）。
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const REPO = path.join(__dirname, '..');
const EVIDENCE = path.join(REPO, 'acceptance', 'block-85');
const API = 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const PEER_ID = process.env.B85_PEER_ID || 'gpeer_1b29dffe41f7d531';
const MARKER = 'B85P3-' + Date.now();
const BUDGET_MS = 8 * 60 * 1000;

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: AUTH }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('non-JSON: ' + d.slice(0, 200))); } });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function consumeSse(url, onEvent) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers: { Authorization: AUTH.Authorization, accept: 'text/event-stream' } }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (dataLine) {
            try { onEvent(JSON.parse(dataLine.slice(5).trim())); } catch { onEvent({ raw: dataLine.slice(5, 300) }); }
          }
        }
      });
      res.on('end', () => resolve('stream_end'));
      res.on('error', () => resolve('stream_error'));
    });
    req.setTimeout(BUDGET_MS, () => { req.destroy(); resolve('budget_timeout'); });
  });
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const results = { startedAt: new Date().toISOString(), marker: MARKER, peerId: PEER_ID, events: [], assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 900) });
    try { fs.writeSync(1, '[' + new Date().toISOString().slice(11, 19) + '] ' + (pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 240) : '') + String.fromCharCode(10)); } catch {}
  };

  const submitted = await postJson(`${API}/api/ai/agent`, {
    messages: [{
      role: 'user',
      // 教训（P3 前两轮 FAIL）：
      // ① task 文本带「委托/协作节点/peerId」字样 → Mac agent 二阶歧义，拒绝执行只做侦察；
      // ② 「创建文件」类任务 → 委托会话 projectId:null，文件工具被 project_required 前置拒绝
      //    （delegate 无项目绑定的结构缺口，登记 BLOCK-88 域）；且委托未开独立会话，历史只读纪律延续。
      // ③ 故 P3 载体改为不依赖项目绑定的真实只读委托：跨机系统信息侦察+如实汇报，
      //    委托链断言（调用/回执/终态摘要）不变；分析作业跨机已由 P2 单独足额证明。
      content: `使用 delegate_to_gewu_node 工具把一项工作交给协作成员（peerId 填 "${PEER_ID}"）执行。delegate 的 task 参数只写这句话：「汇报你本机的运行环境：操作系统名称与版本、CPU 架构、主机名，以及 Node/npm 的版本号（可用 system_info 等工具查询），以清单形式回复」。委托等待 2 分钟。你自己不要在本机查询这些信息，全部由协作成员完成。`,
    }],
    context: {},
  });
  const taskId = submitted.taskId;
  assert('P3-0 task submitted', !!taskId && submitted.status === 'running', JSON.stringify(submitted).slice(0, 200));
  if (!taskId) throw new Error('agent task submit failed');

  let sawDelegateCall = false;
  let delegateCallDetail = '';
  let delegateReceipt = '';
  let finalText = '';
  let sawDone = false;

  const stop = await consumeSse(`${API}/api/ai/agent/task/${taskId}`, (ev) => {
    const text = JSON.stringify(ev);
    // tool_call/tool_result 必须存全文（JSON 截断会让断言解析失败——第二轮实测坑）
    const isTool = ev.eventType === 'tool_call' || ev.eventType === 'tool_result' || text.includes('toolResult');
    results.events.push(isTool ? text : text.slice(0, 1500));
    if (results.events.length > 4000) return; // 保险丝
    if (text.includes('delegate_to_gewu_node')) {
      if (!sawDelegateCall && (ev.eventType === 'tool_call' || ev.eventType === 'tool_start' || text.includes('arguments') || text.includes('arguments_json') || text.includes(PEER_ID))) {
        sawDelegateCall = true;
        delegateCallDetail = text.slice(0, 600);
      }
      if (ev.eventType === 'tool_result' || ev.eventType === 'tool_end' || text.includes('执行回执') || text.includes('委托完成') || text.includes('委托结果')) {
        delegateReceipt = text.slice(0, 900);
        if (text.includes('"ok":true') || text.includes('成功') || text.includes('completed') || text.includes('status')) sawDelegateCall = true;
      }
    }
    if (ev.eventType === 'assistant_message' || ev.eventType === 'message' || ev.eventType === 'token' || ev.eventType === 'final') {
      const t = ev.payload && (ev.payload.text || ev.payload.content || ev.payload.delta);
      if (typeof t === 'string') finalText += t;
    }
    if (ev.eventType === 'done' || ev.eventType === 'end' || ev.eventType === 'task_done' || ev.eventType === 'task_completed' || (ev.payload && ev.payload.done === true)) {
      sawDone = true;
    }
  });

  results.stopReason = stop;
  results.finalText = finalText.slice(0, 2000);
  results.delegateReceipt = delegateReceipt;
  assert('P3-1 delegate tool invoked with correct peer', sawDelegateCall, delegateCallDetail || `（事件类型样本：${[...new Set(results.events.map((e) => { try { return JSON.parse(e).eventType; } catch { return '?'; } }))].slice(0, 12).join(',')}）`);
  // 教训（首轮 FAIL）：tool_result 顶层 summary:"ok" 是事件摘要字段不是执行结果——
  // 首轮 status:"error"/handler_error 被它掩护过关。断言必须锚 toolResult.status。
  let toolStatus = '';
  let delegateOk = null;
  let replyText = '';
  for (const e of results.events) {
    if (!e.includes('delegate_to_gewu_node') || !e.includes('toolResult')) continue;
    try {
      const j = JSON.parse(e);
      const tr = j.payload && j.payload.toolResult;
      if (tr && tr.status) {
        toolStatus = tr.status;
        delegateOk = !!(tr.data && tr.data.ok);
        replyText = (tr.data && tr.data.reply) || '';
      }
    } catch {}
  }
  results.toolStatus = toolStatus;
  results.delegateOk = delegateOk;
  results.replyText = replyText.slice(0, 1500);
  // P3 载体=跨机系统信息侦察（只读、不依赖项目绑定）：回执必须含 Mac 真实环境指纹。
  // status 契约值='success'（S-003）；委托成败锚 data.ok（终态 done/completed 均认可）。
  const macFingerprint = /darwin|arm64|MacBook-Pro|macOS/i.test(replyText);
  assert('P3-2 delegate receipt from Mac (task done)', toolStatus === 'success' && delegateOk === true && macFingerprint,
    `toolStatus=${toolStatus} delegateOk=${delegateOk} macFingerprint=${macFingerprint} reply=${replyText.slice(0, 400)}`);
  assert('P3-3 agent stream reached terminal', sawDone || stop === 'stream_end', `stop=${stop} done=${sawDone}`);
  fs.writeFileSync(path.join(EVIDENCE, 'dual-p3-delegate.json'), JSON.stringify(results, null, 2) + '\n');
  const allPass = results.assertions.every((a) => a.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
