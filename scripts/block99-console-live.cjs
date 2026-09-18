#!/usr/bin/env node
'use strict';
/**
 * block99-console-live.cjs — BLOCK-99 P4/G4 空间管理会话台实机验收（dev 栈 + 真实模型轮次）：
 *   C0 前置：spaces REST 可达，会话台测试会话 id 固定；
 *   C1 真轮次·子集工具链：toolSubset=knowledge-console 下真实模型新建空间 + 列空间
 *      （task 事件 tool_call 全部为 knowledge_*；REST 复核空间已存在）；
 *   C2 D4 门第一腿：真实轮次请求删空间 → knowledge_space_delete 首调返回
 *      confirmationRequired + 一次性 confirmToken，空间未被执行；
 *   C3 D4 门第二腿：凭 token 确认消息（与前端确认卡同格式）→ 删除成功 + REST 复核消失；
 *   C4 绑定链：REST 建空间 B → 真轮次 knowledge_space_bind 绑定测试会话 →
 *      GET binding 返回 B → REST 删 B（FK CASCADE 掉绑）→ binding 回落 ks_default。
 * 前置：dev 栈（vite 3000 + 后端 3001）+ chat 模型凭据。
 * 家法同 scripts/block94-knowledge-live.cjs；证据落 acceptance/block-99/。
 */
const path = require('node:path');
const http = require('node:http');

const API = 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local' };
// 生产同径：管理台先经 REST 建真实会话再挂 run（自造 id 会被
// getOrCreateActiveConversation 落到自动新建会话，绑定就写到别的 id 上了）。
let CONV_ID = 'conv_block99_console_live';
const SPACE_A = '实机验证空间A';
const SPACE_B = '实机验证空间B';

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + String(detail || '').slice(0, 300)}`);
}

async function apiRequest(method, pathname, body) {
  const headers = { ...AUTH };
  let payload;
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + pathname, { method, headers, body: payload });
  let parsed;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

function fetchTaskEvents(taskId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const events = [];
    const req = http.get(`${API}/api/ai/agent/task/${taskId}?afterSeq=0`, { headers: AUTH }, (res) => {
      let buf = '';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try { res.destroy(); } catch {}
        resolve(events);
      };
      const timer = setTimeout(finish, timeoutMs);
      res.on('data', (c) => {
        buf += c.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of raw.split('\n')) {
            const m = line.match(/^data:\s?(.*)$/);
            if (!m) continue;
            if (m[1] === '[DONE]') { clearTimeout(timer); finish(); return; }
            try {
              const obj = JSON.parse(m[1]);
              events.push(obj && obj.payload ? obj.payload : obj);
            } catch {}
          }
        }
      });
      res.on('end', () => { clearTimeout(timer); finish(); });
      res.on('error', () => { clearTimeout(timer); finish(); });
    });
    req.on('error', () => { clearTimeout(timer); finish(); });
  });
}

/** 发一轮真轮次并等到 done（或超时），返回聚合的 tool_call/tool_result 事件与最终文本。 */
async function runTurn(userText) {
  const taskRes = await apiRequest('POST', '/api/ai/agent', {
    messages: [{ role: 'user', content: userText }],
    // accessMode 显式 full：inferExecutionPolicy 无档位 fail-closed 塌缩 read（S-003），
    // mutating 管理工具会被拒——与前端管理台 hook 同参。
    context: { page: 'knowledge', toolSubset: 'knowledge-console', accessMode: 'full' },
    conversationId: CONV_ID,
  });
  const taskId = taskRes.body && taskRes.body.taskId;
  if (!taskId) return { taskId: null, toolCalls: [], toolResults: [], text: '' };
  let toolCalls = [];
  let toolResults = [];
  let text = '';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const events = await fetchTaskEvents(taskId, 10000);
    toolCalls = events.filter((e) => e && e.event === 'tool_call');
    toolResults = events.filter((e) => e && e.event === 'tool_result');
    const deltas = events.filter((e) => e && e.event === 'agent_message_delta');
    text = deltas.map((e) => e.delta || '').join('') || text;
    if (events.some((e) => e && e.event === 'done')) break;
  }
  return { taskId, toolCalls, toolResults, text };
}

function toolResultData(evt) {
  return (evt && evt.toolResult && evt.toolResult.data) || null;
}

async function main() {
  // ── C0 前置 ──
  const spaces0 = await apiRequest('GET', '/api/knowledge/spaces');
  assert('C0_spaces_rest_ok', spaces0.status === 200 && Array.isArray(spaces0.body.spaces), JSON.stringify(spaces0.body).slice(0, 160));
  // 会话台生产路径：POST /api/ai/conversations 建真实会话（存在则复用同 title 最新一条）
  const convList = await apiRequest('GET', '/api/ai/conversations');
  const existing = (convList.body.conversations || []).find((c) => c.title === '知识空间管理台（实机）');
  if (existing) {
    CONV_ID = existing.id;
  } else {
    const mkConv = await apiRequest('POST', '/api/ai/conversations', { title: '知识空间管理台（实机）', lastPage: '/knowledge' });
    CONV_ID = (mkConv.body.conversation && mkConv.body.conversation.id) || CONV_ID;
  }
  assert('C0b_console_conversation_ready', !!CONV_ID, CONV_ID);
  // 清理历史残留（上次跑未删净）
  for (const s of spaces0.body.spaces || []) {
    if (s.name === SPACE_A || s.name === SPACE_B) await apiRequest('DELETE', `/api/knowledge/spaces/${s.id}`);
  }

  // ── C1 真轮次·子集工具链：建空间 + 列空间 ──
  const turn1 = await runTurn(
    `请用工具新建一个名为「${SPACE_A}」的知识空间，然后启用它，最后列出全部空间的名称与文档数。直接执行，不要询问。`
  );
  assert('C1a_task_created', !!turn1.taskId, 'no taskId');
  assert('C1b_tools_all_knowledge_family', turn1.toolCalls.length > 0 && turn1.toolCalls.every((e) => String(e.name || '').startsWith('knowledge_')),
    `tool calls: ${turn1.toolCalls.map((e) => e.name).join(',')}`);
  assert('C1c_space_create_called', turn1.toolCalls.some((e) => e.name === 'knowledge_space_create'), turn1.toolCalls.map((e) => e.name).join(','));
  const spaces1 = await apiRequest('GET', '/api/knowledge/spaces');
  const created = (spaces1.body.spaces || []).find((s) => s.name === SPACE_A);
  assert('C1d_space_exists_via_rest', !!created, JSON.stringify(spaces1.body).slice(0, 200));

  // ── C2/C3 D4 门：删空间两腿 ──
  const turn2 = await runTurn(`请删除「${SPACE_A}」这个知识空间。`);
  const gateResults = turn2.toolResults.filter((e) => e.name === 'knowledge_space_delete');
  const gateData = gateResults.map(toolResultData).find((d) => d && d.confirmationRequired === true);
  assert('C2a_gate_confirmation_required', !!gateData, JSON.stringify(gateResults.map(toolResultData)).slice(0, 220));
  assert('C2b_gate_token_issued', !!gateData && /^kc_[0-9a-f]{24}$/.test(String(gateData.confirmToken)), gateData && gateData.confirmToken);
  assert('C2c_gate_impact_truthful', !!gateData && gateData.impact && typeof gateData.impact.documents === 'number', JSON.stringify(gateData && gateData.impact));
  const spaces2 = await apiRequest('GET', '/api/knowledge/spaces');
  assert('C2d_space_still_exists_before_confirm', !!(spaces2.body.spaces || []).find((s) => s.name === SPACE_A), 'space vanished before user confirmation');

  const spaceIdA = created ? created.id : gateData && gateData.impact && gateData.impact.spaceId;
  const turn3 = await runTurn(
    `我确认执行 knowledge_space_delete（对象 id=${spaceIdA}，confirmToken=${gateData ? gateData.confirmToken : ''}）。请立即凭此 confirmToken 重调工具执行，并简短报告结果。`
  );
  const delDone = turn3.toolResults.filter((e) => e.name === 'knowledge_space_delete').map(toolResultData).find((d) => d && d.deleted);
  assert('C3a_delete_executed_with_token', !!delDone, JSON.stringify(turn3.toolResults.map(toolResultData)).slice(0, 220));
  const spaces3 = await apiRequest('GET', '/api/knowledge/spaces');
  assert('C3b_space_gone_via_rest', !(spaces3.body.spaces || []).find((s) => s.id === spaceIdA), JSON.stringify(spaces3.body).slice(0, 200));

  // ── C4 绑定链：REST 建 B → 真轮次绑定 → GET binding → 删 B 回落 ──
  const mkB = await apiRequest('POST', '/api/knowledge/spaces', { name: SPACE_B });
  const spaceB = mkB.body && mkB.body.space;
  assert('C4a_space_b_created', mkB.status === 200 && !!spaceB, JSON.stringify(mkB.body).slice(0, 160));
  const turn4 = await runTurn(`请把当前会话绑定到知识空间「${SPACE_B}」。`);
  assert('C4b_bind_called', turn4.toolCalls.some((e) => e.name === 'knowledge_space_bind'), turn4.toolCalls.map((e) => e.name).join(','));
  const binding1 = await apiRequest('GET', `/api/knowledge/binding?conversationId=${encodeURIComponent(CONV_ID)}`);
  assert('C4c_binding_reads_space_b', binding1.status === 200 && binding1.body.spaceId === spaceB.id, JSON.stringify(binding1.body));
  const delB = await apiRequest('DELETE', `/api/knowledge/spaces/${spaceB.id}`);
  assert('C4d_space_b_deleted', delB.status === 200, JSON.stringify(delB.body).slice(0, 160));
  const binding2 = await apiRequest('GET', `/api/knowledge/binding?conversationId=${encodeURIComponent(CONV_ID)}`);
  assert('C4e_binding_falls_back_default', binding2.status === 200 && binding2.body.spaceId === 'ks_default', JSON.stringify(binding2.body));

  const allPass = checks.every((c) => c.ok);
  console.log(`\nblock99-console-live: ${checks.filter((c) => c.ok).length}/${checks.length} ${allPass ? 'allPass' : 'FAILED'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
